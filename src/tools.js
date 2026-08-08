import fs from "node:fs/promises";
import path from "node:path";
import { isWithinAllowed } from "./config.js";

const MAX_READ_BYTES = 2_000_000;
const LATIN1 = new TextDecoder("iso-8859-1");

async function decodeText(buffer) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		return LATIN1.decode(buffer);
	}
}

export function makeTools(cfg) {
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

	return {
		list_dir: {
			description: "Lista o conteudo de um diretorio (nao recursivo)",
			input: { remote_path: "string" },
			async run({ remote_path }) {
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
				"Busca por nome de arquivo em um diretorio (padrao simples * e ?)",
			input: { remote_path: "string", pattern: "string" },
			async run({ remote_path, pattern }) {
				const re = new RegExp(
					`^${pattern
						.replace(/[.+^${}()|[\]\\]/g, "\\$&")
						.replace(/\*/g, ".*")
						.replace(/\?/g, ".")}$`,
					"i",
				);
				const entries = await fs.readdir(remote_path, { withFileTypes: true });
				return entries
					.filter((e) => re.test(e.name))
					.map((e) => ({ name: e.name, is_directory: e.isDirectory() }));
			},
		},

		write_file: {
			description:
				"Escreve arquivo (off por padrao; exige allow_write + whitelist)",
			input: { remote_path: "string", content: "string" },
			async run({ remote_path, content }) {
				await assertWritable(remote_path);
				await fs.mkdir(path.dirname(remote_path), { recursive: true });
				await fs.writeFile(remote_path, content, "utf8");
				return { written: true, path: remote_path };
			},
		},

		copy_to_staging: {
			description:
				"Copia um arquivo para o diretorio de staging (TC_STAGING_DIR); seguro em modo somente-leitura",
			input: { remote_path: "string", name: "string?" },
			async run({ remote_path, name }) {
				const s = await fs.stat(remote_path);
				if (!s.isFile()) {
					throw new Error(`Nao e um arquivo: ${remote_path}`);
				}
				const target = path.join(
					cfg.staging,
					String(name || path.basename(remote_path)),
				);
				await fs.mkdir(cfg.staging, { recursive: true });
				await fs.copyFile(remote_path, target);
				return { copied: true, from: remote_path, to: target, size: s.size };
			},
		},
	};
}
