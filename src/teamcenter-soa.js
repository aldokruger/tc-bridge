import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import { actionTimeoutMs, enabledSoaActions } from "./soa-actions.js";
import { SoaGate, SoaGateError } from "./soa-gate.js";
import { loadSoaPolicy } from "./soa-policy.js";

const MAX_OUTPUT_BYTES = 2_000_000;
const ADAPTER_MAIN = "com.aldokruger.tcbridge.TeamcenterSoaAdapter";
const ENVELOPE_SCHEMA_VERSION = "1";

// Variáveis de ambiente mínimas herdadas pelo adaptador Java. O resto do
// ambiente do host (inclusive credenciais de outros sistemas) não é repassado.
// Allowlist nominal: somente as variáveis que o adaptador realmente lê em
// runtime (confirmadas no TeamcenterSoaAdapter.java) entram no processo.
const JAVA_ENV_ALLOWLIST = new Set([
	"PATH",
	"SystemRoot",
	"WINDIR",
	"TEMP",
	"TMP",
	"USERPROFILE",
	"JAVA_HOME",
	"TC_TEAMCENTER_URL",
	"TC_TEAMCENTER_USER",
	"TC_TEAMCENTER_PASSWORD",
	"TC_TEAMCENTER_GROUP",
	"TC_TEAMCENTER_ROLE",
	"TC_TEAMCENTER_LOCALE",
	"TC_TEAMCENTER_SOA_CLIENT_ENCODING",
]);

export const SOA_ENV_ALLOWLIST = [...JAVA_ENV_ALLOWLIST];

// Redação de segredos: kind "keyValue" mantém a chave, "whole" apaga tudo,
// "url" mascara só a senha em user:pass@ (preserva URLs úteis sem credencial).
const SECRET_TRANSFORMS = [
	{
		re: /(password|passwd|pwd|token|bearer|authorization|cookie)\s*[=:]\s*[^\s,;]+/gi,
		kind: "keyValue",
	},
	{ re: /\bOBF:[A-Za-z0-9+/=:_-]+/g, kind: "whole" },
	{ re: /(?:bearer|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, kind: "whole" },
	{
		re: /\b(grip|ticket|sig(?:nature)?)\s*=\s*[A-Za-z0-9+/=_-]{16,}/gi,
		kind: "keyValue",
	},
	{ re: /((?:jdbc|http|https):\/\/[^/\s]*?):([^@\s/]+)@/gi, kind: "url" },
];

function redactKeyValue(match) {
	const eq = match.indexOf("=");
	const colon = match.indexOf(":");
	const sep =
		eq > -1 && (colon < 0 || eq < colon) ? eq : colon > -1 ? colon : -1;
	if (sep < 0) return "[REDACTED]";
	return `${match.slice(0, sep + 1)}[REDACTED]`;
}

export function sanitizeText(text) {
	if (typeof text !== "string") return String(text ?? "");
	let out = text;
	for (const { re, kind } of SECRET_TRANSFORMS) {
		out = out.replace(re, (match) => {
			if (kind === "whole") return "[REDACTED]";
			if (kind === "url")
				return `${match.slice(0, match.indexOf(":") + 1)}${match.slice(match.indexOf(":") + 1).replace(/:([^@\s/]+)@/, ":[REDACTED]@")}`;
			return redactKeyValue(match);
		});
	}
	return out;
}

export function buildJavaEnv(cfg) {
	const env = {};
	for (const [key, value] of Object.entries(process.env)) {
		if (JAVA_ENV_ALLOWLIST.has(key) && value !== undefined) env[key] = value;
	}
	// TC_TEAMCENTER_SOA_CLIENT_ENCODING sempre entra a partir da config
	// (autodetecção quando vazio); nada além da allowlist nominal acima.
	env.TC_TEAMCENTER_SOA_CLIENT_ENCODING = cfg.teamcenterSoaClientEncoding ?? "";
	return env;
}

// Gera o classpath com os JARs explicitamente listados (sem wildcard) para
// evitar ambiguidades de versão e facilitar a auditoria.
async function buildClasspath(cfg) {
	const entries = [cfg.teamcenterSoaAdapterJar];
	if (cfg.teamcenterSoaLib) {
		let names;
		try {
			names = await fs.readdir(cfg.teamcenterSoaLib);
		} catch (error) {
			throw new Error(
				`Diretorio de jars SOA inacessivel (${cfg.teamcenterSoaLib}): ${error.message}`,
			);
		}
		const jars = names
			.filter((name) => name.toLowerCase().endsWith(".jar"))
			.sort();
		if (jars.length === 0) {
			throw new Error(
				`Nenhum jar encontrado em TC_TEAMCENTER_SOA_LIB: ${cfg.teamcenterSoaLib}`,
			);
		}
		entries.push(...jars.map((name) => path.join(cfg.teamcenterSoaLib, name)));
	}
	entries.push(...cfg.teamcenterSoaExtraJars);
	return entries.join(cfg.pathSeparator);
}

async function fileNonEmpty(filePath) {
	try {
		const stat = await fs.stat(filePath);
		return stat.isFile() && stat.size > 0;
	} catch {
		return false;
	}
}

async function adapterJarExists(cfg) {
	return fileNonEmpty(cfg.teamcenterSoaAdapterJar);
}

async function sha256File(filePath) {
	try {
		const data = await fs.readFile(filePath);
		return createHash("sha256").update(data).digest("hex");
	} catch {
		return null;
	}
}

// JAR é um ZIP: os primeiros 4 bytes devem ser o magic PK\x03\x04.
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

async function isCorruptJar(filePath) {
	try {
		const handle = await fs.open(filePath, "r");
		try {
			const header = Buffer.alloc(4);
			const { bytesRead } = await handle.read(header, 0, 4, 0);
			return bytesRead !== 4 || !header.equals(ZIP_MAGIC);
		} finally {
			await handle.close();
		}
	} catch {
		return true;
	}
}

async function javaExecutableResolves(cfg) {
	if (!cfg.teamcenterJava || cfg.teamcenterJava === "java") return true;
	// Caminho explícito do Java (TC_TEAMCENTER_JAVA): precisa existir.
	try {
		const stat = await fs.stat(cfg.teamcenterJava);
		return stat.isFile();
	} catch {
		return false;
	}
}

// Pré-condições verificadas localmente antes de qualquer operação SOA.
// A action "preflight" vai além e reporta o estado do ambiente Java/jars.
export async function soaPreflightChecks(cfg) {
	const problems = [];
	const teamcenterUrl = cfg.teamcenterUrl ?? cfg.teamcenterSoaUrl;
	const teamcenterUser = cfg.teamcenterUser ?? cfg.teamcenterSoaUser;
	const teamcenterPassword =
		cfg.teamcenterPassword ?? cfg.teamcenterSoaPassword;
	if (!(await javaExecutableResolves(cfg))) {
		problems.push(
			`Executavel Java nao encontrado: ${cfg.teamcenterJava} (configure TC_TEAMCENTER_JAVA)`,
		);
	}
	if (!(await adapterJarExists(cfg))) {
		problems.push(
			`Jar do adaptador SOA nao encontrado ou vazio: ${cfg.teamcenterSoaAdapterJar}`,
		);
	} else if (await isCorruptJar(cfg.teamcenterSoaAdapterJar)) {
		problems.push(
			`Jar do adaptador SOA corrompido (magic ZIP invalido): ${cfg.teamcenterSoaAdapterJar}`,
		);
	}
	if (cfg.teamcenterSoaLib) {
		try {
			const names = await fs.readdir(cfg.teamcenterSoaLib);
			const jars = names.filter((name) => name.toLowerCase().endsWith(".jar"));
			if (jars.length === 0) {
				problems.push(
					`Nenhum jar SOA em TC_TEAMCENTER_SOA_LIB: ${cfg.teamcenterSoaLib}`,
				);
			}
			for (const name of jars.sort()) {
				const full = path.join(cfg.teamcenterSoaLib, name);
				if (await isCorruptJar(full)) {
					problems.push(
						`Jar SOA vazio ou corrompido (magic ZIP invalido): ${name}`,
					);
				}
			}
			// Duplicidade: mesmo basename em lib e extraJars, ou varias
			// versoes do mesmo artefato (ex.: log4j-core-2.17.1 + 2.17.2).
			const artifactOf = (file) =>
				path.basename(file).replace(/-\d+(\.\d+)*.*\.jar$/i, "");
			const seenBasename = new Set();
			const seenArtifact = new Map();
			const allJars = [
				...jars.map((name) => path.join(cfg.teamcenterSoaLib, name)),
				...(cfg.teamcenterSoaExtraJars ?? []),
			];
			for (const file of allJars) {
				const base = path.basename(file);
				if (seenBasename.has(base)) {
					problems.push(`Jar duplicado no classpath SOA: ${base}`);
				}
				seenBasename.add(base);
				const artifact = artifactOf(file);
				if (seenArtifact.has(artifact)) {
					problems.push(
						`Multiplas versoes do mesmo jar no classpath SOA: ${seenArtifact.get(artifact)} e ${base}`,
					);
				} else {
					seenArtifact.set(artifact, base);
				}
			}
		} catch (error) {
			problems.push(
				`Diretorio de jars SOA inacessivel (${cfg.teamcenterSoaLib}): ${error.message}`,
			);
		}
	}
	if (cfg.teamcenterSoaTrustStore) {
		if (!(await fileNonEmpty(cfg.teamcenterSoaTrustStore))) {
			problems.push(
				`Truststore nao encontrado ou vazio: ${cfg.teamcenterSoaTrustStore}`,
			);
		}
	}
	if (!teamcenterUrl) {
		problems.push("TC_TEAMCENTER_URL nao configurado");
	}
	if (!teamcenterUser || !teamcenterPassword) {
		problems.push("Credencial SOA nao configurada (user/password)");
	}
	if (cfg.teamcenterSoaRequireTls) {
		try {
			const url = new URL(teamcenterUrl);
			if (url.protocol !== "https:") {
				problems.push(
					"TC_TEAMCENTER_SOA_REQUIRE_TLS=1 exige URL https; protocolo atual: " +
						url.protocol.replace(":", ""),
				);
			}
		} catch (error) {
			problems.push(
				`TC_TEAMCENTER_URL invalida: ${sanitizeText(error.message)}`,
			);
		}
	}
	return problems;
}

export async function soaAdapterFingerprint(cfg) {
	const jar = cfg.teamcenterSoaAdapterJar;
	const [sha256, corrupt] = await Promise.all([
		sha256File(jar),
		isCorruptJar(jar),
	]);
	if (!sha256) return { sha256: null, corrupt: true };
	return { sha256, corrupt };
}

function runAdapter(request, cfg, { signal } = {}) {
	return new Promise((resolve, reject) => {
		let settled = false;
		let child = null;
		const finish = (fn, value) => {
			if (settled) return;
			settled = true;
			fn(value);
		};

		buildClasspath(cfg)
			.then((classpath) => {
				const jvmArgs = [];
				if (cfg.teamcenterSoaTrustStore) {
					jvmArgs.push(
						`-Djavax.net.ssl.trustStore=${cfg.teamcenterSoaTrustStore}`,
					);
				}
				child = spawn(
					cfg.teamcenterJava,
					[...jvmArgs, "-cp", classpath, ADAPTER_MAIN],
					{
						windowsHide: true,
						env: buildJavaEnv(cfg),
						stdio: ["pipe", "pipe", "pipe"],
					},
				);

				const onAbort = () => {
					if (child && child.exitCode === null) child.kill();
				};
				signal?.addEventListener("abort", onAbort, { once: true });

				const stdoutChunks = [];
				let stderr = "";
				let stdoutBytes = 0;
				const appendStderr = (chunk) => {
					stderr = `${stderr}${String(chunk)}`.slice(-64_000);
				};

				child.stdout.on("data", (chunk) => {
					stdoutBytes += chunk.length;
					if (stdoutBytes > MAX_OUTPUT_BYTES) {
						finish(
							reject,
							new Error("Saida do adaptador SOA excedeu o limite de bytes"),
						);
						if (child.exitCode === null) child.kill();
						return;
					}
					stdoutChunks.push(Buffer.from(chunk));
				});
				child.stderr.on("data", appendStderr);
				child.once("error", (error) => finish(reject, error));
				child.once("exit", (code) => {
					signal?.removeEventListener("abort", onAbort);
					if (settled) return;
					if (code !== 0) {
						finish(
							reject,
							new Error(
								sanitizeText(stderr.trim()) ||
									`Adaptador SOA encerrou com codigo ${code}`,
							),
						);
						return;
					}
					try {
						const stdout = Buffer.concat(stdoutChunks).toString("utf8");
						const envelope = JSON.parse(stdout.trim());
						if (
							envelope.schemaVersion !== ENVELOPE_SCHEMA_VERSION ||
							typeof envelope !== "object" ||
							envelope === null
						) {
							throw new Error("Envelope SOA com schemaVersion desconhecido");
						}
						finish(resolve, envelope);
					} catch (error) {
						finish(
							reject,
							error instanceof Error
								? error
								: new Error("Resposta invalida do adaptador SOA"),
						);
					}
				});

				// Requisição inteira em UTF-8 via stdin; nada sensível em args.
				const body = Buffer.from(JSON.stringify(request), "utf8");
				child.stdin.end(body);
			})
			.catch((error) => finish(reject, error));
	});
}

export async function runTeamcenterSoa(
	request,
	cfg,
	{ correlationId, user } = {},
) {
	const envelope = await cfg.soaGate.run(
		request.action,
		user ?? request.user,
		(signal) =>
			runAdapter(
				{
					...request,
					// correlationId chega ao adaptador para correlacionar
					// logs do WebTier com a auditoria do bridge.
					correlationId: correlationId ?? request.correlationId ?? "",
				},
				cfg,
				{ signal },
			),
		{ timeoutMs: actionTimeoutMs(request.action, cfg) },
	);

	if (envelope.status !== "completed") {
		const message = sanitizeText(
			envelope.error?.message ?? `Status SOA inesperado: ${envelope.status}`,
		);
		const error = new Error(`${request.action}: ${message}`);
		if (envelope.error?.code) error.code = envelope.error.code;
		throw error;
	}

	const result = envelope.result ?? {};
	if (envelope.truncated) result.truncated = true;
	if (envelope.warnings?.length) result.warnings = envelope.warnings;
	if (envelope.partialErrors?.length) {
		result.partial_errors = envelope.partialErrors;
	}
	return {
		...result,
		_meta: {
			action: request.action,
			correlationId: correlationId ?? envelope.correlationId,
			durationMs: envelope.durationMs,
		},
	};
}

export function createSoaContext(cfg) {
	return {
		gate: new SoaGate({
			maxConcurrency: cfg.teamcenterSoaMaxConcurrency,
			queueLimit: cfg.teamcenterSoaQueueLimit,
			rateLimitPerMinute: cfg.teamcenterSoaRateLimit,
		}),
		policy: null, // carregada lazy e cacheada
	};
}

export async function ensureSoaPolicy(ctx, cfg) {
	if (ctx.policy === null) {
		ctx.policy = await loadSoaPolicy(cfg.teamcenterSoaPolicyFile);
	}
	return ctx.policy;
}

export { enabledSoaActions, SoaGateError };
