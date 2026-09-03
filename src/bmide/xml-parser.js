// Parser XML seguro e leve para fragmentos BMIDE. Sem dependências externas.
// Requisitos do plano §5.2: DTD/entidades externas desabilitadas, preservação
// de atributos/ordem/localização, suporte a namespaces, erros com arquivo e
// linha, consumo previsível de memória.
//
// Estrutura de saída:
// { type, name, attributes, children, text, location: { file, line } }

const MAX_DEPTH = 64;
const MAX_ELEMENTS = 200_000;

function decodeEntities(text) {
	return text
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-fA-F]+);/g, (_, hex) =>
			String.fromCodePoint(Number.parseInt(hex, 16)),
		);
}

function stripNamespace(name) {
	const idx = name.indexOf(":");
	return idx >= 0 ? name.slice(idx + 1) : name;
}

function createNode(name, attributes, location) {
	return {
		type: "element",
		name: stripNamespace(name),
		attributes: attributes || {},
		children: [],
		text: "",
		location,
	};
}

// Extrai atributos de uma string de tag. Não processa entidades em nomes.
function parseAttributes(raw) {
	const attrs = {};
	if (!raw || raw.trim() === "") return attrs;
	// Padrão: name="value" ou name='value'
	const re = /([A-Za-z_][\w.-]*)(?:\s*=\s*(?:"([^"]*?)"|'([^']*?)'))?/g;
	let m = re.exec(raw);
	while (m !== null) {
		const key = stripNamespace(m[1]);
		const value =
			m[2] !== undefined
				? decodeEntities(m[2])
				: m[3] !== undefined
					? decodeEntities(m[3])
					: "";
		attrs[key] = value;
		m = re.exec(raw);
	}
	return attrs;
}

/**
 * Parse um documento XML de texto em uma árvore de elementos.
 * Desabilita DTD e entidades externas (XXE protection).
 *
 * @param {string} xmlString - Conteúdo XML
 * @param {{ fileName?: string }} opts
 * @returns {{ root: object, errors: Array, elementCount: number }}
 */
export function parseXmlDocument(xmlString, { fileName = "<unknown>" } = {}) {
	const errors = [];
	let elementCount = 0;

	if (!xmlString || typeof xmlString !== "string") {
		return {
			root: null,
			errors: ["input vazio ou não é string"],
			elementCount: 0,
		};
	}

	// Bloquear DTD/entidades externas (XXE protection).
	if (/<!DOCTYPE\b/i.test(xmlString) || /<!ENTITY\b/i.test(xmlString)) {
		errors.push(
			`DTD/entidades externas detectadas em ${fileName}; ignoradas por segurança`,
		);
		xmlString = xmlString
			.replace(/<!DOCTYPE[^>]*>/gi, "")
			.replace(/<!ENTITY[^>]*>/gi, "");
	}

	// Remover BOM.
	if (xmlString.charCodeAt(0) === 0xfeff) {
		xmlString = xmlString.slice(1);
	}

	// Remover declaração XML.
	xmlString = xmlString.replace(/<\?xml[^?]*\?>/g, "");

	// Remover comentários.
	xmlString = xmlString.replace(/<!--[\s\S]*?-->/g, "");

	// Remover CDATA wrappers mas preservar conteúdo.
	xmlString = xmlString.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");

	const root = createNode("__root", {}, { file: fileName, line: 1 });
	const stack = [root];
	let pos = 0;
	let line = 1;
	const len = xmlString.length;

	while (pos < len && elementCount < MAX_ELEMENTS) {
		// Contar novas linhas no texto consumido.
		const nlBefore = xmlString.lastIndexOf("\n", pos);
		if (nlBefore >= 0) {
			line += pos - nlBefore > 0 ? 0 : 0;
		}

		const ltIdx = xmlString.indexOf("<", pos);
		if (ltIdx === -1) {
			// Texto restante.
			const text = decodeEntities(xmlString.slice(pos).trim());
			if (text && stack.length > 0) {
				stack[stack.length - 1].text += text;
			}
			break;
		}

		// Texto antes do '<'.
		if (ltIdx > pos) {
			const text = decodeEntities(xmlString.slice(pos, ltIdx).trim());
			if (text && stack.length > 0) {
				stack[stack.length - 1].text += text;
			}
		}

		// Contar linhas até ltIdx.
		for (let i = pos; i < ltIdx; i++) {
			if (xmlString.charCodeAt(i) === 10) line++;
		}
		pos = ltIdx;

		if (xmlString.startsWith("<!--", pos)) {
			// Pular comentário (já removido acima, mas por segurança).
			const end = xmlString.indexOf("-->", pos + 4);
			pos = end === -1 ? len : end + 3;
			continue;
		}

		if (xmlString.startsWith("<?", pos)) {
			// Pular processing instruction.
			const end = xmlString.indexOf("?>", pos + 2);
			pos = end === -1 ? len : end + 2;
			continue;
		}

		if (xmlString.startsWith("<!", pos)) {
			// PularCDATA ou outra declaração.
			const end = xmlString.indexOf(">", pos + 2);
			pos = end === -1 ? len : end + 1;
			continue;
		}

		// Tag de fechamento: </name>.
		if (xmlString.charAt(pos + 1) === "/") {
			const end = xmlString.indexOf(">", pos + 2);
			if (end === -1) {
				errors.push(`Tag de fechamento não terminada em ${fileName}:${line}`);
				break;
			}
			// Avançar linha.
			for (let i = pos; i <= end; i++) {
				if (xmlString.charCodeAt(i) === 10) line++;
			}
			pos = end + 1;
			if (stack.length > 1) {
				stack.pop();
			}
			continue;
		}

		// Tag de abertura ou self-closing: <name attrs...> ou <name attrs.../>.
		const tagEnd = findTagEnd(xmlString, pos);
		if (tagEnd === -1) {
			errors.push(`Tag não terminada em ${fileName}:${line}`);
			break;
		}

		const tagBody = xmlString.slice(pos + 1, tagEnd);
		const selfClosing = tagBody.endsWith("/");
		const rawContent = selfClosing
			? tagBody.slice(0, -1).trimEnd()
			: tagBody.trimEnd();

		// Separar nome e atributos.
		const spaceIdx = rawContent.search(/\s/);
		const tagName = spaceIdx >= 0 ? rawContent.slice(0, spaceIdx) : rawContent;
		const rawAttrs = spaceIdx >= 0 ? rawContent.slice(spaceIdx + 1) : "";
		const attrs = parseAttributes(rawAttrs);

		// Contar linhas até tagEnd.
		for (let i = pos; i <= tagEnd; i++) {
			if (xmlString.charCodeAt(i) === 10) line++;
		}

		if (!tagName || tagName.startsWith("?") || tagName.startsWith("!")) {
			pos = tagEnd + 1;
			continue;
		}

		const node = createNode(tagName, attrs, { file: fileName, line });

		// Validar profundidade.
		if (stack.length >= MAX_DEPTH) {
			errors.push(
				`Profundidade máxima (${MAX_DEPTH}) excedida em ${fileName}:${line}`,
			);
			break;
		}

		stack[stack.length - 1].children.push(node);
		elementCount++;

		if (!selfClosing) {
			stack.push(node);
		}

		pos = tagEnd + 1;
	}

	return { root, errors, elementCount };
}

// Encontra o '>' de fechamento de uma tag, respeitando aspas.
function findTagEnd(xml, start) {
	let inSingle = false;
	let inDouble = false;
	for (let i = start + 1; i < xml.length; i++) {
		const ch = xml.charCodeAt(i);
		if (ch === 39)
			inSingle = !inSingle; // '
		else if (ch === 34)
			inDouble = !inDouble; // "
		else if (ch === 62 && !inSingle && !inDouble) return i; // >
	}
	return -1;
}

/**
 * Busca todos os elementos com o nome especificado (case-insensitive, strip namespace).
 */
export function findElements(node, tagName) {
	if (!node) return [];
	const results = [];
	const target = tagName.toLowerCase();
	walk(node, (n) => {
		if (n.type === "element" && n.name.toLowerCase() === target) {
			results.push(n);
		}
	});
	return results;
}

// Walk simples em profundidade.
function walk(node, visitor) {
	if (!node) return;
	visitor(node);
	if (node.children) {
		for (const child of node.children) {
			walk(child, visitor);
		}
	}
}

/**
 * Extrai valor de atributo de um elemento.
 */
export function getAttributeValue(element, attrName) {
	if (!element || !element.attributes) return null;
	// Busca case-insensitive.
	const lower = attrName.toLowerCase();
	for (const [key, value] of Object.entries(element.attributes)) {
		if (key.toLowerCase() === lower) return value;
	}
	return null;
}

/**
 * Extrai texto content de um elemento.
 */
export function getTextContent(element) {
	if (!element) return "";
	if (element.text) return element.text;
	if (element.children) {
		return element.children
			.filter((c) => c.type === "text" || c.text)
			.map((c) => c.text || "")
			.join("");
	}
	return "";
}

export { walk };
