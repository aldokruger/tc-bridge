import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { isWithinAllowed } from "./config.js";
import { runDiagnostic } from "./diagnostics.js";
import { runDbDiagnostic } from "./db-diagnostics.js";
import { runTeamcenterRead } from "./teamcenter-soa.js";

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

export function makeTools(cfg) {
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
	}

	if (cfg.allowTeamcenterRead) {
		tools.tc_soa_read = {
			description:
				"Executa consultas Teamcenter SOA somente leitura: session_info, get_preferences ou execute_saved_query. Nao aceita servicos SOA arbitrarios.",
			input: {
				check: "string",
				scope: "string?",
				preference_names_json: "string?",
				query_uid: "string?",
				entries_json: "string?",
				values_json: "string?",
				limit: "number?",
			},
			async run(request) {
				return runTeamcenterRead(request, cfg);
			},
		};
	}

	return tools;
}
