import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_MAX_FILES = 100;
const DEFAULT_MAX_MATCHES = 100;
const DEFAULT_MAX_LINES = 200;
const MAX_FILE_BYTES = 5_000_000;
const MAX_TAIL_BYTES = 250_000;
const MAX_TEXT_LENGTH = 1_000;
const LATIN1 = new TextDecoder("iso-8859-1");

function positiveInteger(value, name, fallback, maximum) {
	if (value === undefined) return fallback;
	if (!Number.isInteger(value) || value < 1 || value > maximum) {
		throw new Error(`${name} deve ser um inteiro entre 1 e ${maximum}`);
	}
	return value;
}

function globToRegExp(pattern) {
	if (
		typeof pattern !== "string" ||
		pattern.length === 0 ||
		pattern.length > 120
	) {
		throw new Error("file_glob deve ter entre 1 e 120 caracteres");
	}
	return new RegExp(
		`^${pattern
			.replace(/[.+^${}()|[\]\\]/g, "\\$&")
			.replace(/\*/g, ".*")
			.replace(/\?/g, ".")}$`,
		"i",
	);
}

function redact(text) {
	return text
		.replace(/\b(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[REDACTED]")
		.replace(
			/\b(password|passwd|pwd|token|secret|cookie|set-cookie)\s*([:=])\s*([^\s,;]+)/gi,
			"$1$2[REDACTED]",
		);
}

async function decodeText(buffer) {
	try {
		return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	} catch {
		return LATIN1.decode(buffer);
	}
}

function isWithin(root, target) {
	const relative = path.relative(root, target);
	return (
		relative === "" ||
		(!relative.startsWith(`..${path.sep}`) &&
			relative !== ".." &&
			!path.isAbsolute(relative))
	);
}

async function resolveLogFile(root, relativePath) {
	if (
		typeof relativePath !== "string" ||
		!relativePath ||
		path.isAbsolute(relativePath)
	) {
		throw new Error("relative_path deve ser um caminho relativo nao vazio");
	}
	const candidate = path.resolve(root, relativePath);
	if (!isWithin(root, candidate))
		throw new Error("Arquivo fora do diretorio de logs permitido");
	const resolved = await fs.realpath(candidate);
	if (!isWithin(root, resolved))
		throw new Error("Arquivo fora do diretorio de logs permitido");
	const stat = await fs.stat(resolved);
	if (!stat.isFile())
		throw new Error("relative_path deve apontar para um arquivo");
	return { path: resolved, stat };
}

async function listLogFiles(root, fileGlob, maxFiles) {
	const matches = [];
	const matcher = globToRegExp(fileGlob);
	const queue = [root];
	while (queue.length > 0 && matches.length < maxFiles) {
		const directory = queue.shift();
		const entries = await fs.readdir(directory, { withFileTypes: true });
		for (const entry of entries) {
			const entryPath = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				queue.push(entryPath);
				continue;
			}
			if (entry.isFile() && matcher.test(entry.name)) matches.push(entryPath);
			if (matches.length >= maxFiles) break;
		}
	}
	return { files: matches, truncated: queue.length > 0 };
}

async function tailFile(root, request) {
	const { path: filePath, stat } = await resolveLogFile(
		root,
		request.relative_path,
	);
	const maxLines = positiveInteger(
		request.max_lines,
		"max_lines",
		DEFAULT_MAX_LINES,
		1_000,
	);
	const start = Math.max(0, stat.size - MAX_TAIL_BYTES);
	const handle = await fs.open(filePath, "r");
	try {
		const buffer = Buffer.alloc(stat.size - start);
		await handle.read(buffer, 0, buffer.length, start);
		const lines = (await decodeText(buffer))
			.split(/\r\n|\r|\n/)
			.filter((line, index, values) => line !== "" || index < values.length - 1)
			.slice(-maxLines)
			.map((line) => redact(line).slice(0, MAX_TEXT_LENGTH));
		return {
			path: path.relative(root, filePath),
			lines,
			truncated: start > 0,
		};
	} finally {
		await handle.close();
	}
}

async function searchLogs(root, request) {
	if (
		typeof request.pattern !== "string" ||
		!request.pattern ||
		request.pattern.length > 300
	) {
		throw new Error("pattern deve ter entre 1 e 300 caracteres");
	}
	const maxFiles = positiveInteger(
		request.max_files,
		"max_files",
		DEFAULT_MAX_FILES,
		500,
	);
	const maxMatches = positiveInteger(
		request.max_matches,
		"max_matches",
		DEFAULT_MAX_MATCHES,
		500,
	);
	const { files, truncated: filesTruncated } = await listLogFiles(
		root,
		request.file_glob ?? "*.log",
		maxFiles,
	);
	const needle = request.pattern.toLocaleLowerCase();
	const matches = [];
	const skipped = [];
	for (const filePath of files) {
		const stat = await fs.stat(filePath);
		if (stat.size > MAX_FILE_BYTES) {
			skipped.push({
				path: path.relative(root, filePath),
				reason: "arquivo maior que 5MB",
			});
			continue;
		}
		const lines = (await decodeText(await fs.readFile(filePath))).split(
			/\r\n|\r|\n/,
		);
		for (let index = 0; index < lines.length; index += 1) {
			if (!lines[index].toLocaleLowerCase().includes(needle)) continue;
			matches.push({
				path: path.relative(root, filePath),
				line: index + 1,
				text: redact(lines[index]).slice(0, MAX_TEXT_LENGTH),
			});
			if (matches.length >= maxMatches) {
				return {
					matches,
					skipped,
					files_scanned: files.length,
					truncated: true,
				};
			}
		}
	}
	return {
		matches,
		skipped,
		files_scanned: files.length,
		truncated: filesTruncated,
	};
}

export function makeTeamcenterLogTool({ logDirectory }) {
	return {
		description:
			"Inspeciona logs Teamcenter permitidos: list, tail ou search. Apenas leitura, com limites e mascaramento de segredos.",
		input: {
			operation: "list | tail | search",
			relative_path: "string?",
			pattern: "string?",
			file_glob: "string?",
			max_lines: "number?",
			max_files: "number?",
			max_matches: "number?",
		},
		async run(request) {
			const root = await fs.realpath(logDirectory);
			switch (request.operation) {
				case "list": {
					const maxFiles = positiveInteger(
						request.max_files,
						"max_files",
						DEFAULT_MAX_FILES,
						500,
					);
					const { files, truncated } = await listLogFiles(
						root,
						request.file_glob ?? "*.log",
						maxFiles,
					);
					return {
						files: await Promise.all(
							files.map(async (filePath) => {
								const stat = await fs.stat(filePath);
								return {
									path: path.relative(root, filePath),
									size: stat.size,
									mtime_millis: stat.mtimeMs,
								};
							}),
						),
						truncated,
					};
				}
				case "tail":
					return tailFile(root, request);
				case "search":
					return searchLogs(root, request);
				default:
					throw new Error("operation deve ser list, tail ou search");
			}
		},
	};
}
