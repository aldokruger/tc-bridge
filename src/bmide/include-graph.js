import crypto from "node:crypto";
import path from "node:path";

// Carregador de grafo de includes a partir de master.xml.
// O projeto é um grafo de includes (plano §4.1), não um único XML.
// Bloqueia symlinks, traversal e ciclos. Todos os acessos a fs são injetáveis.

const MAX_INCLUDE_DEPTH = 50;
const MAX_TOTAL_FILES = 5000;

/**
 * Lê master.xml recursivamente e constrói o grafo de includes.
 * @param {string} projectRoot - Raiz do projeto BMIDE
 * @param {string} extensionsDir - Diretório extensions/ dentro do projeto
 * @param {{ readFile: Function, stat: Function }} io
 * @returns {{ includes: Array, missing: string[], cycles: string[], totalDepth: number, totalFiles: number }}
 */
export async function loadIncludeGraph(projectRoot, extensionsDir, io) {
	const includes = [];
	const missing = [];
	const cycles = [];
	const visited = new Set();
	let totalDepth = 0;

	const masterPath = path.join(extensionsDir, "master.xml");
	let masterXml;
	try {
		masterXml = await io.readFile(masterPath, "utf-8");
	} catch (err) {
		return {
			includes: [],
			missing: [path.relative(projectRoot, masterPath)],
			cycles: [],
			totalDepth: 0,
			totalFiles: 0,
			error: `master.xml não lido: ${err.message}`,
		};
	}

	await walkIncludes(
		masterXml,
		extensionsDir,
		projectRoot,
		0,
		visited,
		includes,
		missing,
		cycles,
		io,
	);
	totalDepth = includes.reduce((max, inc) => Math.max(max, inc.depth), 0);

	return {
		includes,
		missing,
		cycles,
		totalDepth,
		totalFiles: includes.length,
	};
}

async function walkIncludes(
	xml,
	dir,
	projectRoot,
	depth,
	visited,
	includes,
	missing,
	cycles,
	io,
) {
	if (depth > MAX_INCLUDE_DEPTH) return;
	if (includes.length > MAX_TOTAL_FILES) return;

	// Extrai <include file="..."/> da string XML.
	const re = /<include\s+file="([^"]+)"\s*\/?>/g;
	let m = re.exec(xml);
	while (m !== null) {
		const fileName = m[1];
		const resolved = path.resolve(dir, fileName);

		// Symlink check.
		try {
			const st = await io.stat(resolved);
			if (st.isSymbolicLink()) {
				missing.push(
					path.relative(projectRoot, resolved) + " (symlink bloqueado)",
				);
				m = re.exec(xml);
				continue;
			}
		} catch {
			// Arquivo ausente — registra e continua.
			const rel = path.relative(projectRoot, resolved);
			if (!missing.includes(rel)) missing.push(rel);
			m = re.exec(xml);
			continue;
		}

		// Path traversal check.
		const relToRoot = path.relative(projectRoot, resolved);
		if (relToRoot.startsWith("..") || path.isAbsolute(relToRoot)) {
			const rel = path.relative(projectRoot, resolved);
			if (!missing.includes(rel + " (traversal bloqueado)"))
				missing.push(rel + " (traversal bloqueado)");
			m = re.exec(xml);
			continue;
		}

		// Ciclo check.
		if (visited.has(resolved)) {
			const rel = path.relative(projectRoot, resolved);
			if (!cycles.includes(rel)) cycles.push(rel);
			m = re.exec(xml);
			continue;
		}

		visited.add(resolved);
		includes.push({
			file: fileName,
			resolvedPath: relToRoot,
			exists: true,
			depth: depth + 1,
		});

		// Lê o arquivo incluído e recursa.
		let childXml;
		try {
			childXml = await io.readFile(resolved, "utf-8");
		} catch {
			m = re.exec(xml);
			continue;
		}

		await walkIncludes(
			childXml,
			path.dirname(resolved),
			projectRoot,
			depth + 1,
			visited,
			includes,
			missing,
			cycles,
			io,
		);
		m = re.exec(xml);
	}
}

/**
 * Valida well-formedness básica de um XML (tags balanceadas).
 * Retorna true se parece válido, false se suspeito.
 */
export function validateWellFormedness(xmlString) {
	let depth = 0;
	const re = /<(\/?)([A-Za-z_][\w.-]*)[^>]*?(\/?)>/g;
	let m = re.exec(xmlString);
	while (m !== null) {
		const isClosing = m[1] === "/";
		const isSelfClosing = m[3] === "/";
		if (isClosing) {
			depth--;
			if (depth < 0) return false;
		} else if (!isSelfClosing) {
			depth++;
		}
		m = re.exec(xmlString);
	}
	return depth === 0;
}

/**
 * Gera SHA-256 de conteúdo de arquivo.
 */
export function hashContent(content) {
	return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}
