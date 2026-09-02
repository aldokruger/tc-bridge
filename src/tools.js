import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readBmideModel } from "./bmide-reader.js";
import { makeBrowserTools } from "./browser-agent.js";
import { soaCheckResult } from "./collectors/collector-sdk.js";
import { isWithinAllowed } from "./config.js";
import {
	checkUpgradeReadiness,
	compareEnvironments,
	runDbDiagnostic,
} from "./db-diagnostics.js";
import { runDiagnostic } from "./diagnostics.js";
import { SOA_ACTION_BUDGETS, validateSoaAction } from "./soa-actions.js";
import { makeTeamcenterLogTool } from "./teamcenter-logs.js";
import {
	createSoaContext,
	enabledSoaActions,
	ensureSoaPolicy,
	runTeamcenterSoa,
	soaAdapterFingerprint,
	soaPreflightChecks,
} from "./teamcenter-soa.js";
import { AuthorizedTaskRunner } from "./zero-trust/task-runner.js";

const MAX_READ_BYTES = 2_000_000;
const LATIN1 = new TextDecoder("iso-8859-1");
const DEFAULT_MAX_DEPTH = 6;
const DEFAULT_MAX_RESULTS = 500;
const DEFAULT_GREP_MAX_FILES = 500;
const DEFAULT_GREP_MAX_MATCHES = 200;
const GREP_MAX_FILE_BYTES = 5_000_000;
const GREP_CONTEXT_CHARS = 80;
const SKIP_DIR_NAMES = new Set([
	"node_modules",
	".git",
	"$RECYCLE.BIN",
	"System Volume Information",
]);

async function decodeText(buffer) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		return LATIN1.decode(buffer);
	}
}

function globToRegExp(pattern) {
	return new RegExp(
		`^${pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*")
			.replace(/\?/g, ".")}$`,
		"i",
	);
}

function looksBinary(buffer) {
	const sample = buffer.subarray(0, 8000);
	for (const byte of sample) {
		if (byte === 0) return true;
	}
	return false;
}

function sha256(content) {
	return crypto.createHash("sha256").update(content).digest("hex");
}

function assertSha256(value) {
	if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
		throw new Error("expected_sha256 deve ser um hash SHA-256 hexadecimal");
	}
	return value.toLowerCase();
}

// Percorre a arvore de diretorios em largura, ignorando pastas de sistema/lixo
// (SKIP_DIR_NAMES) e parando em max_depth para nao explodir em volumes grandes.
async function* walkDir(rootPath, maxDepth) {
	const queue = [{ dirPath: rootPath, depth: 0 }];
	while (queue.length > 0) {
		const { dirPath, depth } = queue.shift();
		let entries;
		try {
			entries = await fs.readdir(dirPath, { withFileTypes: true });
		} catch (err) {
			yield { dirPath, depth, error: err.message, entries: null };
			continue;
		}
		yield { dirPath, depth, error: null, entries };
		if (depth >= maxDepth) continue;
		for (const entry of entries) {
			if (entry.isDirectory() && !SKIP_DIR_NAMES.has(entry.name)) {
				queue.push({
					dirPath: path.join(dirPath, entry.name),
					depth: depth + 1,
				});
			}
		}
	}
}

export function makeTools(cfg, { metrics } = {}) {
	async function assertReadable(file) {
		if (!isWithinAllowed(file, cfg.readPaths)) {
			throw new Error(
				`Path fora da whitelist de leitura: ${file} (permitido: ${cfg.readPaths.join(", ")})`,
			);
		}
	}

	async function assertWritable(file) {
		if (!cfg.allowWrite) {
			throw new Error("Escrita desabilitada (TC_ALLOW_WRITE=0)");
		}
		if (!isWithinAllowed(file, cfg.writePaths)) {
			throw new Error(
				`Path fora da whitelist de escrita: ${file} (permitido: ${cfg.writePaths.join(", ")})`,
			);
		}
	}

	const tools = {
		bmide_model: {
			description:
				"Le o modelo BMIDE (default.xml) do Teamcenter: business objects, properties, LOVs e naming rules com contagens (respeita a whitelist de leitura)",
			input: { tc_data_path: "string" },
			async run({ tc_data_path }) {
				await assertReadable(tc_data_path);
				return readBmideModel(tc_data_path);
			},
		},

		list_dir: {
			description: "Lista o conteudo de um diretorio (nao recursivo)",
			input: { remote_path: "string" },
			async run({ remote_path }) {
				await assertReadable(remote_path);
				const entries = await fs.readdir(remote_path, { withFileTypes: true });
				return entries.map((e) => ({
					name: e.name,
					is_directory: e.isDirectory(),
				}));
			},
		},

		read_file: {
			description:
				"Le arquivo de texto do ambiente de upgrade (UTF-8 ou latin-1)",
			input: { remote_path: "string", max_bytes: "number?" },
			async run({ remote_path, max_bytes = MAX_READ_BYTES }) {
				await assertReadable(remote_path);
				const buffer = await fs.readFile(remote_path);
				const slice = buffer.subarray(0, max_bytes);
				return {
					content: await decodeText(slice),
					truncated: buffer.length > max_bytes,
				};
			},
		},

		stat_file: {
			description: "Metadados de arquivo/diretorio (tamanho, mtime, tipo)",
			input: { remote_path: "string" },
			async run({ remote_path }) {
				await assertReadable(remote_path);
				const s = await fs.stat(remote_path);
				return {
					name: path.basename(remote_path),
					size: s.size,
					mtime_millis: s.mtimeMs,
					is_directory: s.isDirectory(),
					is_file: s.isFile(),
				};
			},
		},

		search_files: {
			description:
				"Busca por nome de arquivo/pasta com padrao simples (* e ?). Com recursive=true, percorre subdiretorios (limitado por max_depth e max_results)",
			input: {
				remote_path: "string",
				pattern: "string",
				recursive: "boolean?",
				max_depth: "number?",
				max_results: "number?",
			},
			async run({
				remote_path,
				pattern,
				recursive = false,
				max_depth = DEFAULT_MAX_DEPTH,
				max_results = DEFAULT_MAX_RESULTS,
			}) {
				await assertReadable(remote_path);
				const re = globToRegExp(pattern);

				if (!recursive) {
					const entries = await fs.readdir(remote_path, {
						withFileTypes: true,
					});
					return entries
						.filter((e) => re.test(e.name))
						.map((e) => ({ name: e.name, is_directory: e.isDirectory() }));
				}

				const results = [];
				let truncated = false;
				for await (const { dirPath, entries, error } of walkDir(
					remote_path,
					max_depth,
				)) {
					if (error) continue;
					for (const entry of entries) {
						if (!re.test(entry.name)) continue;
						if (results.length >= max_results) {
							truncated = true;
							break;
						}
						results.push({
							name: entry.name,
							path: path.join(dirPath, entry.name),
							is_directory: entry.isDirectory(),
						});
					}
					if (truncated) break;
				}
				return { results, truncated };
			},
		},

		list_tree: {
			description:
				"Lista o conteudo de um diretorio recursivamente, ate max_depth niveis (padrao 6). Retorna cada entrada com seu path completo e profundidade",
			input: {
				remote_path: "string",
				max_depth: "number?",
				max_results: "number?",
			},
			async run({
				remote_path,
				max_depth = DEFAULT_MAX_DEPTH,
				max_results = DEFAULT_MAX_RESULTS,
			}) {
				await assertReadable(remote_path);
				const results = [];
				const errors = [];
				let truncated = false;
				for await (const { dirPath, depth, entries, error } of walkDir(
					remote_path,
					max_depth,
				)) {
					if (error) {
						errors.push({ path: dirPath, error });
						continue;
					}
					for (const entry of entries) {
						if (results.length >= max_results) {
							truncated = true;
							break;
						}
						results.push({
							path: path.join(dirPath, entry.name),
							depth: depth + 1,
							is_directory: entry.isDirectory(),
						});
					}
					if (truncated) break;
				}
				return { results, truncated, errors };
			},
		},

		grep_content: {
			description:
				"Busca um padrao (texto ou regex) dentro do conteudo de arquivos de texto em um diretorio, opcionalmente recursivo. Pula arquivos binarios e maiores que 5MB",
			input: {
				remote_path: "string",
				pattern: "string",
				file_glob: "string?",
				recursive: "boolean?",
				max_depth: "number?",
				use_regexp: "boolean?",
				case_sensitive: "boolean?",
				max_files: "number?",
				max_matches: "number?",
			},
			async run({
				remote_path,
				pattern,
				file_glob = "*",
				recursive = true,
				max_depth = DEFAULT_MAX_DEPTH,
				use_regexp = false,
				case_sensitive = false,
				max_files = DEFAULT_GREP_MAX_FILES,
				max_matches = DEFAULT_GREP_MAX_MATCHES,
			}) {
				await assertReadable(remote_path);
				const fileRe = globToRegExp(file_glob);
				const flags = case_sensitive ? "g" : "gi";
				const contentRe = use_regexp
					? new RegExp(pattern, flags)
					: new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags);

				const matches = [];
				const skipped = [];
				let filesScanned = 0;
				let truncated = false;

				const dirs = recursive
					? walkDir(remote_path, max_depth)
					: (async function* single() {
							const entries = await fs.readdir(remote_path, {
								withFileTypes: true,
							});
							yield { dirPath: remote_path, depth: 0, error: null, entries };
						})();

				outer: for await (const { dirPath, entries, error } of dirs) {
					if (error) continue;
					for (const entry of entries) {
						if (entry.isDirectory()) continue;
						if (!fileRe.test(entry.name)) continue;
						if (filesScanned >= max_files) {
							truncated = true;
							break outer;
						}
						filesScanned += 1;
						const filePath = path.join(dirPath, entry.name);
						let buffer;
						try {
							const s = await fs.stat(filePath);
							if (s.size > GREP_MAX_FILE_BYTES) {
								skipped.push({
									path: filePath,
									reason: "arquivo maior que 5MB",
								});
								continue;
							}
							buffer = await fs.readFile(filePath);
						} catch (err) {
							skipped.push({ path: filePath, reason: err.message });
							continue;
						}
						if (looksBinary(buffer)) {
							skipped.push({ path: filePath, reason: "arquivo binario" });
							continue;
						}
						const text = await decodeText(buffer);
						const lines = text.split(/\r\n|\r|\n/);
						for (let i = 0; i < lines.length; i += 1) {
							contentRe.lastIndex = 0;
							if (!contentRe.test(lines[i])) continue;
							if (matches.length >= max_matches) {
								truncated = true;
								break outer;
							}
							matches.push({
								path: filePath,
								line: i + 1,
								text: lines[i].trim().slice(0, GREP_CONTEXT_CHARS * 2),
							});
						}
					}
				}
				return { matches, skipped, files_scanned: filesScanned, truncated };
			},
		},

		write_file: {
			description:
				"Escreve arquivo de forma atomica (off por padrao; exige allow_write + whitelist). Para substituir um arquivo existente, use overwrite=true.",
			input: {
				remote_path: "string",
				content: "string",
				overwrite: "boolean?",
				expected_sha256: "string?",
			},
			async run({ remote_path, content, overwrite = false, expected_sha256 }) {
				await assertWritable(remote_path);
				await fs.mkdir(path.dirname(remote_path), { recursive: true });
				let replaced = false;
				let currentHash;
				try {
					const stat = await fs.stat(remote_path);
					if (!stat.isFile()) {
						throw new Error(`Nao e um arquivo: ${remote_path}`);
					}
					replaced = true;
					if (!overwrite) {
						throw new Error(
							"Arquivo ja existe; use overwrite=true para substitui-lo",
						);
					}
					currentHash = sha256(await fs.readFile(remote_path));
				} catch (err) {
					if (err.code !== "ENOENT") throw err;
				}
				if (expected_sha256) {
					const expectedHash = assertSha256(expected_sha256);
					if (!currentHash || currentHash !== expectedHash) {
						throw new Error("Hash atual nao corresponde a expected_sha256");
					}
				}

				const tempPath = path.join(
					path.dirname(remote_path),
					`.${path.basename(remote_path)}.${crypto.randomUUID()}.tmp`,
				);
				await fs.writeFile(tempPath, content, "utf8");
				try {
					await fs.rename(tempPath, remote_path);
				} finally {
					await fs.rm(tempPath, { force: true });
				}
				return {
					written: true,
					path: remote_path,
					replaced,
					sha256: sha256(content),
				};
			},
		},

		copy_to_staging: {
			description:
				"Copia um arquivo permitido para o diretorio de staging (TC_STAGING_DIR)",
			input: { remote_path: "string", name: "string?" },
			async run({ remote_path, name }) {
				await assertReadable(remote_path);
				const fileName = String(name || path.basename(remote_path));
				if (fileName !== path.basename(fileName)) {
					throw new Error("Nome de staging nao pode conter diretorios");
				}
				const s = await fs.stat(remote_path);
				if (!s.isFile()) {
					throw new Error(`Nao e um arquivo: ${remote_path}`);
				}
				const target = path.join(cfg.staging, fileName);
				await fs.mkdir(cfg.staging, { recursive: true });
				await fs.copyFile(remote_path, target);
				return { copied: true, from: remote_path, to: target, size: s.size };
			},
		},
	};

	if (cfg.allowDiagnostics) {
		tools.run_diagnostic = {
			description:
				"Executa somente diagnosticos PowerShell allowlisted: path_exists, service_status ou tcp_connect. Nao aceita comandos arbitrarios.",
			input: {
				check: "string",
				remote_path: "string?",
				service_name: "string?",
				host: "string?",
				port: "number?",
			},
			async run(request) {
				return runDiagnostic(request, cfg);
			},
		};
	}

	if (cfg.allowDbDiagnostics) {
		tools.run_db_diagnostic = {
			description:
				"Executa diagnosticos MSSQL somente leitura e predefinidos. Nao aceita SQL arbitrario e nao altera o banco.",
			input: { check: "string", limit: "number?" },
			async run(request) {
				return runDbDiagnostic(request, cfg);
			},
		};
		tools.upgrade_readiness = {
			description:
				"Verifica pre-requisitos MSSQL para upgrade Teamcenter (somente leitura; cada check reporta ok/warning/critical/info)",
			input: {},
			async run() {
				return checkUpgradeReadiness(cfg);
			},
		};
	}

	if (cfg.allowDbCompare) {
		tools.compare_environments = {
			description:
				"Compara o ambiente Teamcenter configurado com o alvo declarado em TC_DB_TARGET_SERVER/TC_DB_TARGET_NAME (mesma conta SQL de diagnostico; somente leitura)",
			input: {},
			async run() {
				return compareEnvironments(cfg);
			},
		};
	}

	if (cfg.allowTeamcenterRead) {
		const soaCtx = createSoaContext(cfg);
		const soaActionsList = enabledSoaActions(cfg);
		metrics?.attachGate(soaCtx.gate);

		// Avisa na inicializacao sem bloquear; cada action revalida ao rodar.
		soaPreflightChecks(cfg).then(
			(problems) => {
				for (const problem of problems) {
					console.warn(`[tc-bridge] preflight SOA: ${problem}`);
				}
			},
			(error) => {
				console.warn(
					`[tc-bridge] preflight SOA indisponivel: ${error.message}`,
				);
			},
		);

		async function runSoaAction(request, context = {}) {
			if (typeof request?.action !== "string" || !request.action) {
				throw new Error("Parametro obrigatorio: action");
			}
			if (!soaActionsList.includes(request.action)) {
				throw new Error(
					`Acao SOA desabilitada: ${request.action} (habilite via TC_ALLOW_TEAMCENTER_READ + flag granular)`,
				);
			}
			const policy = await ensureSoaPolicy(soaCtx, cfg);
			const body = validateSoaAction(request.action, request, policy);

			if (request.action === "teamcenter.soa.preflight") {
				const problems = await soaPreflightChecks(cfg);
				if (problems.length > 0) {
					return {
						ok: false,
						source: "node",
						problems,
						check_result: soaCheckResult(
							{ ok: false, problems },
							{
								action: request.action,
								impactBudget: SOA_ACTION_BUDGETS[request.action],
								environmentRegistry: cfg.environmentRegistry,
							},
						),
					};
				}
				const fingerprint = await soaAdapterFingerprint(cfg);
				const result = await runTeamcenterSoa(
					body,
					{ ...cfg, soaGate: soaCtx.gate },
					{
						correlationId: context.auditId,
						user: context.userId,
					},
				);
				return {
					...result,
					adapter_sha256: fingerprint.sha256,
					adapter_jar_corrupt: fingerprint.corrupt,
					check_result: soaCheckResult(result, {
						action: request.action,
						impactBudget: SOA_ACTION_BUDGETS[request.action],
						environmentRegistry: cfg.environmentRegistry,
					}),
				};
			} else {
				const problems = await soaPreflightChecks(cfg);
				if (problems.length > 0) {
					throw new Error(`Preflight SOA falhou: ${problems.join("; ")}`);
				}
			}

			const result = await runTeamcenterSoa(
				body,
				{ ...cfg, soaGate: soaCtx.gate },
				{
					correlationId: context.auditId,
					user: context.userId,
				},
			);
			return {
				...result,
				check_result: soaCheckResult(result, {
					action: request.action,
					impactBudget: SOA_ACTION_BUDGETS[request.action],
					environmentRegistry: cfg.environmentRegistry,
				}),
			};
		}

		tools.tc_soa_read = {
			description: `Executa ações Teamcenter SOA somente leitura e autorizadas por policy local. Ações habilitadas: ${soaActionsList.join(", ")}. A capability de saúde não executa query; object.inspect não lê preferências; saved_query.execute usa UID da policy.`,
			input: {
				action: "string",
				profile: "string?",
				scope: "string?",
				preference_names_json: "string?",
				object_uid: "string?",
				property_name: "string?",
				dataset_uid: "string?",
				entries_json: "string?",
				values_json: "string?",
			},
			async run(request, context) {
				const startedAt = Date.now();
				try {
					const result = await runSoaAction(request, context);
					metrics?.recordCheck({
						failed: result?.ok === false,
						truncated: result?.truncated === true,
						partialErrors: result?.partial_errors?.length ?? 0,
						durationMs: Date.now() - startedAt,
						bytesReturned: JSON.stringify(result).length,
					});
					return result;
				} catch (error) {
					metrics?.recordCheck({
						failed: true,
						durationMs: Date.now() - startedAt,
					});
					throw error;
				}
			},
		};
	}

	if (cfg.allowBrowserDiagnostics) {
		Object.assign(tools, makeBrowserTools(cfg));
	}

	if (cfg.allowLogRead) {
		tools.teamcenter_log_inspect = makeTeamcenterLogTool({
			logDirectory: cfg.teamcenterLogDir,
		});
	}

	if (cfg.allowCapabilityTasks) {
		const handlers = {};
		const policy = {};
		const addHandler = (action, toolName) => {
			const tool = tools[toolName];
			if (!tool) return;
			handlers[action] = (parameters, context) => tool.run(parameters, context);
			policy[action] = true;
		};
		addHandler("browser.status", "browser_status");
		addHandler("browser.pages", "browser_pages");
		addHandler("browser.capture_diagnostics", "browser_capture_diagnostics");
		addHandler("browser.performance", "browser_performance");
		addHandler("diagnostic.run", "run_diagnostic");
		addHandler("database.diagnostic", "run_db_diagnostic");
		addHandler("database.upgrade_readiness", "upgrade_readiness");
		addHandler("database.compare", "compare_environments");
		if (cfg.allowTeamcenterRead) {
			for (const action of enabledSoaActions(cfg)) {
				addHandler(action, "tc_soa_read");
			}
		}
		addHandler("teamcenter.logs.read", "teamcenter_log_inspect");

		const runner = new AuthorizedTaskRunner({
			agentId: cfg.agentId,
			issuer: cfg.capabilityIssuer,
			publicKeyPath: cfg.capabilityPublicKey,
			auditLogPath: cfg.auditLogPath,
			handlers,
			policy,
		});
		tools.tc_authorized_task = {
			description:
				"Executa uma capability assinada e de uso unico. Somente acoes locais allowlisted, auditadas e dentro do escopo autorizado.",
			input: { capability: "string", task_json: "string" },
			run: (request) => runner.run(request),
			setIssuer: (issuer) => runner.setIssuer(issuer),
		};
		if (cfg.enforceCapabilities) {
			for (const toolName of Object.values({
				browserStatus: "browser_status",
				browserPages: "browser_pages",
				browserCapture: "browser_capture_diagnostics",
				browserPerformance: "browser_performance",
				diagnostic: "run_diagnostic",
				database: "run_db_diagnostic",
				databaseUpgrade: "upgrade_readiness",
				databaseCompare: "compare_environments",
				teamcenter: "tc_soa_read",
				teamcenterLogs: "teamcenter_log_inspect",
			})) {
				delete tools[toolName];
			}
		}
	}

	return tools;
}
