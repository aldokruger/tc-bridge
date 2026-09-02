import fs from "node:fs/promises";
import path from "node:path";

// Leitor do modelo BMIDE (default.xml) de um ambiente Teamcenter. Somente
// leitura: o arquivo precisa estar dentro dos paths permitidos (whitelist de
// leitura e validada na tool, em tools.js). O formato do default.xml varia
// entre versoes e templates, entao a extracao e tolerante a namespace e a
// hifen/underscore nos nomes de tag, e o resultado carrega contagens para o
// agente decidir se precisa de um grep mais fino no arquivo bruto.

const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_ITEMS_PER_LIST = 5_000;
const MODEL_RELATIVE = path.join("xml", "teamcenter", "default.xml");
const FALLBACK_RELATIVE = "default.xml";
const LATIN1 = new TextDecoder("iso-8859-1");

function decodeXml(buffer) {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
	return text.startsWith("\uFEFF") ? text.slice(1) : text;
}

function readText(buffer) {
	try {
		return decodeXml(buffer);
	} catch {
		return LATIN1.decode(buffer);
	}
}

// Case do XML pode usar "business-object" ou "business_object"; namespace
// opcional na frente (ex.: "t_li:business-object"). Nao casa tag de
// fechamento nem contentores plurais ("business-objects"): apos "<" precisa
// haver letra/_ e apos o nome nao pode haver outra letra/digito/_.
function openTagMatcher(tagName) {
	const core = tagName.replace(/[_-]/g, "[_-]?");
	return new RegExp(
		`<((?:[A-Za-z_][A-Za-z0-9_.-]*:)?${core})(?![A-Za-z0-9_])([^>]*)>`,
		"gi",
	);
}

function attributeValue(tagText, attrName) {
	const match = tagText.match(
		new RegExp(`\\b${attrName}\\s*=\\s*"([^"]*)"`, "i"),
	);
	return match ? match[1] : null;
}

// Percorre todas as ocorrencias da tag (para a contagem real), mas mantem no
// maximo MAX_ITEMS_PER_LIST itens no array para nao estourar o payload.
function extractTagged(xml, tagName, attrNames) {
	const matcher = openTagMatcher(tagName);
	const items = [];
	let count = 0;
	let match = matcher.exec(xml);
	while (match !== null) {
		count += 1;
		if (items.length < MAX_ITEMS_PER_LIST) {
			const item = {};
			for (const attrName of attrNames) {
				item[attrName] = attributeValue(match[2], attrName);
			}
			items.push(item);
		}
		match = matcher.exec(xml);
	}
	return { items, count, truncated: count > MAX_ITEMS_PER_LIST };
}

function shapeResult(xml, sourceFile, fileBytes) {
	const businessObjects = extractTagged(xml, "business-object", [
		"name",
		"extends",
	]);
	const properties = extractTagged(xml, "property", ["name", "type", "owner"]);
	const lovs = extractTagged(xml, "lov", ["name"]);
	const namingRules = extractTagged(xml, "naming-rule", ["name", "pattern"]);

	const recognized =
		businessObjects.count + properties.count + lovs.count + namingRules.count;
	const parseWarning =
		recognized === 0
			? "Nenhuma tag esperada (business-object, property, lov, naming-rule) foi encontrada; o arquivo pode ter outro formato ou ser apenas um fragmento."
			: undefined;

	return {
		business_objects: businessObjects.items,
		business_object_count: businessObjects.count,
		properties: properties.items,
		property_count: properties.count,
		lovs: lovs.items,
		lov_count: lovs.count,
		naming_rules: namingRules.items,
		naming_rule_count: namingRules.count,
		truncated: {
			business_objects: businessObjects.truncated,
			properties: properties.truncated,
			lovs: lovs.truncated,
			naming_rules: namingRules.truncated,
		},
		source_file: sourceFile,
		file_bytes: fileBytes,
		read_at: new Date().toISOString(),
		...(parseWarning ? { parse_warning: parseWarning } : {}),
	};
}

export async function readBmideModel(tcDataPath) {
	if (typeof tcDataPath !== "string" || tcDataPath.trim() === "") {
		throw new Error("tc_data_path e obrigatorio");
	}
	const root = tcDataPath.trim();
	const candidates = [
		path.join(root, MODEL_RELATIVE),
		path.join(root, FALLBACK_RELATIVE),
	];

	let sourceFile = null;
	let buffer = null;
	for (const candidate of candidates) {
		let stat;
		try {
			stat = await fs.stat(candidate);
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw error;
		}
		if (!stat.isFile()) continue;
		if (stat.size > MAX_FILE_BYTES) {
			throw new Error(
				`default.xml excede o limite de leitura (${stat.size} bytes > ${MAX_FILE_BYTES}); use grep_content ou read_file com max_bytes no arquivo bruto`,
			);
		}
		sourceFile = candidate;
		buffer = await fs.readFile(candidate);
		break;
	}
	if (!sourceFile) {
		throw new Error(`default.xml nao encontrado em ${candidates.join(" ou ")}`);
	}
	return shapeResult(readText(buffer), sourceFile, buffer.length);
}
