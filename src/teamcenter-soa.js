import { spawn } from "node:child_process";
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
	// TC_TEAMCENTER_* entram mesmo quando não estão na allowlist acima, mas
	// nada além deles.
	for (const [key, value] of Object.entries(process.env)) {
		if (key.startsWith("TC_TEAMCENTER_")) env[key] = value;
	}
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

async function adapterJarExists(cfg) {
	try {
		const stat = await fs.stat(cfg.teamcenterSoaAdapterJar);
		return stat.isFile() && stat.size > 0;
	} catch {
		return false;
	}
}

// Pré-condições verificadas localmente antes de qualquer operação SOA.
// A action "preflight" vai além e reporta o estado do ambiente Java/jars.
export async function soaPreflightChecks(cfg) {
	const problems = [];
	if (!(await adapterJarExists(cfg))) {
		problems.push(
			`Jar do adaptador SOA nao encontrado ou vazio: ${cfg.teamcenterSoaAdapterJar}`,
		);
	}
	if (cfg.teamcenterSoaLib) {
		try {
			const names = await fs.readdir(cfg.teamcenterSoaLib);
			if (!names.some((name) => name.toLowerCase().endsWith(".jar"))) {
				problems.push(
					`Nenhum jar SOA em TC_TEAMCENTER_SOA_LIB: ${cfg.teamcenterSoaLib}`,
				);
			}
		} catch (error) {
			problems.push(
				`Diretorio de jars SOA inacessivel (${cfg.teamcenterSoaLib}): ${error.message}`,
			);
		}
	}
	if (!cfg.teamcenterSoaUrl) {
		problems.push("TC_TEAMCENTER_URL nao configurado");
	}
	if (!cfg.teamcenterSoaUser || !cfg.teamcenterSoaPassword) {
		problems.push("Credencial SOA nao configurada (user/password)");
	}
	if (cfg.teamcenterSoaRequireTls) {
		try {
			const url = new URL(cfg.teamcenterSoaUrl);
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
				child = spawn(cfg.teamcenterJava, ["-cp", classpath, ADAPTER_MAIN], {
					windowsHide: true,
					env: buildJavaEnv(cfg),
					stdio: ["pipe", "pipe", "pipe"],
				});

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
		throw new Error(`${request.action}: ${message}`);
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
