import fs from "node:fs/promises";
import path from "node:path";

// Detector de project root BMIDE e leitor de metadados.
// Lê ProjectInfo.xml (NameValue pairs) e dependency.xml (atributos raiz).
// Todos os acessos a filesystem são injetáveis para testabilidade.

const DEFAULT_FS = {
	readFile: fs.readFile,
	readdir: fs.readdir,
	stat: fs.stat,
};

/**
 * Sobe diretórios a partir de startDir procurando ProjectInfo.xml + extensions/master.xml.
 * @returns {{ root: string, projectInfoPath: string, masterXmlPath: string } | null}
 */
export async function detectProjectRoot(startDir, io = DEFAULT_FS) {
	let dir = path.resolve(startDir);
	const seen = new Set();

	for (let i = 0; i < 20; i++) {
		if (seen.has(dir)) return null;
		seen.add(dir);

		const projectInfoPath = path.join(dir, "ProjectInfo.xml");
		const masterXmlPath = path.join(dir, "extensions", "master.xml");

		try {
			await io.stat(projectInfoPath);
			await io.stat(masterXmlPath);
			return { root: dir, projectInfoPath, masterXmlPath };
		} catch {
			// Arquivo não existe neste nível; sobe.
		}

		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
	return null;
}

/**
 * Parse ProjectInfo.xml extraindo NameValue pairs em objeto flat.
 * Não usa XML parser — regex é suficiente para este formato simples.
 */
export async function readProjectInfo(projectRoot, io = DEFAULT_FS) {
	const filePath = path.join(projectRoot, "ProjectInfo.xml");
	const xml = await io.readFile(filePath, "utf-8");
	const result = {};

	// Captura cada <NameValue key="..." value="..."/>
	const re = /<NameValue\s+key="([^"]*)"\s+value="([^"]*?)"\s*\/?>/g;
	let m = re.exec(xml);
	while (m !== null) {
		result[m[1]] = m[2];
		m = re.exec(xml);
	}
	return result;
}

/**
 * Parse dependency.xml extraindo atributos do elemento raiz.
 * O raiz contém: name, displayName, guid, prefixes, currentTemplateVersion,
 * optional, isDescriptionMandatory, teamcenterTemplate, enableOpsDataDeploy.
 */
export async function readDependencyInfo(projectRoot, io = DEFAULT_FS) {
	const filePath = path.join(projectRoot, "extensions", "dependency.xml");
	let xml;
	try {
		xml = await io.readFile(filePath, "utf-8");
	} catch (err) {
		if (err.code === "ENOENT") return null;
		throw err;
	}

	// Encontrar atributos da tag raiz.
	const rootMatch = xml.match(/<TcBusinessDataIncludes\s+([^>]*)>/);
	if (!rootMatch) return null;

	const raw = rootMatch[1];
	const attrs = {};
	const re = /([A-Za-z_][\w.-]*)\s*=\s*"([^"]*?)"/g;
	let m = re.exec(raw);
	while (m !== null) {
		attrs[m[1]] = m[2];
		m = re.exec(raw);
	}

	// Extrair dependências (includes de templates).
	const dependencies = [];
	const incRe = /<include\s+file="([^"]*)"\s*\/?>/g;
	let im = incRe.exec(xml);
	while (im !== null) {
		if (!im[1].startsWith("<!--")) {
			dependencies.push(im[1]);
		}
		im = incRe.exec(xml);
	}

	return {
		name: attrs.name || null,
		displayName: attrs.displayName || null,
		guid: attrs.guid || null,
		prefixes: attrs.prefixes
			? attrs.prefixes.split(",").map((s) => s.trim())
			: [],
		templateVersion: attrs.currentTemplateVersion || null,
		optional: attrs.optional === "true",
		isDescriptionMandatory: attrs.isDescriptionMandatory === "true",
		teamcenterTemplate: attrs.teamcenterTemplate === "true",
		enableOpsDataDeploy: attrs.enableOpsDataDeploy === "true",
		dependencies,
	};
}

/**
 * Lista recursivamente todos os arquivos sob um diretório.
 * @returns {Array<{ relativePath: string, size: number, isDir: boolean }>}
 */
export async function listProjectFiles(projectRoot, io = DEFAULT_FS) {
	const results = [];
	const root = path.resolve(projectRoot);

	async function walk(dir, prefix) {
		let entries;
		try {
			entries = await io.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const fullPath = path.join(dir, entry.name);
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				results.push({ relativePath: rel, size: 0, isDir: true });
				await walk(fullPath, rel);
			} else {
				let size = 0;
				try {
					const st = await io.stat(fullPath);
					size = st.size;
				} catch {
					// ignora
				}
				results.push({ relativePath: rel, size, isDir: false });
			}
		}
	}

	await walk(root, "");
	return results;
}
