import { BMIDE_SCHEMA_VERSION, makeEntityId } from "./schemas.js";
import {
	findElements,
	getAttributeValue,
	getTextContent,
	parseXmlDocument,
	walk,
} from "./xml-parser.js";

// Mapeamento de elementos XML → kinds de entidade (keys minúsculas).
const ELEMENT_KIND_MAP = {
	tcclass: "class",
	tcstandardtype: "standard-type",
	tcform: "form",
	tcruntimetype: "runtime-type",
	tcattribute: "attribute",
	tcproperty: "property",
	tclov: "lov-static",
	lovdynamic: "lov-dynamic",
	tcnamingrule: "naming-rule",
	tcrevnamingrule: "revision-naming-rule",
	tcgrmrule: "grm-rule",
	tcdeepcopyrule: "deep-copy-rule",
	tcdcompoundpropertyrule: "compound-property",
	tcrelation: "relation",
	condition: "condition",
	tcextensionattach: "extension",
	tctypeconstantattach: "type-constant-attach",
	tpropertyconstantattach: "property-constant-attach",
	tclovattach: "lov-attach",
	tcnamingruleattach: "naming-rule-attach",
	tcgrmattach: "grm-attach",
	operationinputtype: "operation-input",
	tcstatus: "status",
	tcunitofmeasure: "unit-of-measure",
	irdc: "irdc",
	dispatcherserviceconfig: "dispatcher-config",
	verificationrule: "verification-rule",
	propagationrule: "propagation-rule",
	tctyperule: "type-display-rule",
	functionality: "global-constant",
	tcglobalconstantattach: "global-constant-attach",
};

/**
 * Constrói o modelo normalizado a partir de fragmentos XML já parseados.
 * Duas passagens: (1) declarações, (2) vínculos/referências.
 */
export function buildModel(parsedFiles) {
	const entities = [];
	const references = [];
	const stats = {
		TcClass: 0,
		TcStandardType: 0,
		TcForm: 0,
		TcRuntimeType: 0,
		LOVDynamic: 0,
		TcLOV: 0,
		TcNamingRule: 0,
		TcRevNamingRule: 0,
		TcAttribute: 0,
		TcProperty: 0,
		TcGRMRule: 0,
		TcRelation: 0,
		Condition: 0,
		TcExtensionAttach: 0,
		TcTypeConstantAttach: 0,
		TcPropertyConstantAttach: 0,
		OperationInputType: 0,
	};
	const wellFormednessErrors = [];

	// Pass 1: Extrair declarações.
	for (const { fileName, parseResult, xml } of parsedFiles) {
		if (!parseResult.root) {
			wellFormednessErrors.push({ file: fileName, errors: parseResult.errors });
			continue;
		}
		wellFormednessErrors.push(
			...parseResult.errors.map((e) => ({ file: fileName, error: e })),
		);

		extractDeclarations(parseResult.root, fileName, entities, stats);
	}

	// Pass 2: Extrair vínculos/referências.
	for (const { fileName, parseResult } of parsedFiles) {
		if (!parseResult.root) continue;
		extractReferences(parseResult.root, fileName, entities, references);
	}

	return { entities, references, stats, wellFormednessErrors };
}

function extractDeclarations(root, fileName, entities, stats) {
	walk(root, (node) => {
		if (node.type !== "element") return;
		const tagLower = node.name.toLowerCase();
		const kind = ELEMENT_KIND_MAP[tagLower];
		if (!kind) return;

		if (tagLower.endsWith("attach")) return;

		const name = extractName(node);
		if (!name) return;

		const entityId = makeEntityId(kind, name);
		const sourceRef = {
			file: fileName,
			line: node.location?.line ?? 0,
			element: node.name,
		};

		const attrs = extractAttributes(node, tagLower);

		entities.push({
			entityId,
			kind,
			name,
			parentName:
				getAttributeValue(node, "parentClassName") ||
				getAttributeValue(node, "parentTypeName") ||
				undefined,
			className: getAttributeValue(node, "className") || undefined,
			artifactName: getAttributeValue(node, "artifactName") || undefined,
			functionality: undefined,
			abstract: getAttributeValue(node, "isAbstract") === "true",
			attributes: attrs,
			sourceRef,
			operation: "add",
		});

		if (stats[node.name] !== undefined) stats[node.name]++;
	});
}

function extractReferences(root, fileName, entities, references) {
	walk(root, (node) => {
		if (node.type !== "element") return;
		const tagLower = node.name.toLowerCase();

		if (tagLower === "tclovattach") {
			const lovName = getAttributeValue(node, "lovName");
			const typeName = getAttributeValue(node, "typeName");
			const propName = getAttributeValue(node, "propertyName");
			if (lovName && (typeName || propName)) {
				references.push({
					referenceId: `ref-lov-${fileName}-${references.length}`,
					referenceKind: "lov-attach",
					fromEntityId: makeEntityId("lov-static", lovName),
					targetName: typeName || propName,
					resolution: "local",
					sourceRef: {
						file: fileName,
						line: node.location?.line ?? 0,
						element: node.name,
					},
				});
			}
			return;
		}

		if (tagLower === "tcnamingruleattach") {
			const ruleName = getAttributeValue(node, "namingRuleName");
			const typeName = getAttributeValue(node, "typeName");
			if (ruleName && typeName) {
				references.push({
					referenceId: `ref-naming-${fileName}-${references.length}`,
					referenceKind: "naming-rule-attach",
					fromEntityId: makeEntityId("naming-rule", ruleName),
					targetName: typeName,
					resolution: "local",
					sourceRef: {
						file: fileName,
						line: node.location?.line ?? 0,
						element: node.name,
					},
				});
			}
			return;
		}

		if (tagLower === "tpropertyconstantattach") {
			const typeName = getAttributeValue(node, "typeName");
			const propName = getAttributeValue(node, "propertyName");
			if (typeName && propName) {
				references.push({
					referenceId: `ref-pconst-${fileName}-${references.length}`,
					referenceKind: "property-constant-attach",
					fromEntityId: makeEntityId("property", propName),
					targetName: `${typeName}.${propName}`,
					resolution: "local",
					sourceRef: {
						file: fileName,
						line: node.location?.line ?? 0,
						element: node.name,
					},
				});
			}
			return;
		}

		if (tagLower === "tcextensionattach") {
			const extName = getAttributeValue(node, "extensionName");
			const opName = getAttributeValue(node, "operationName");
			if (extName) {
				references.push({
					referenceId: `ref-ext-${fileName}-${references.length}`,
					referenceKind: "extension-attach",
					fromEntityId: makeEntityId("extension", extName),
					targetName: opName || "unknown",
					resolution: "local",
					sourceRef: {
						file: fileName,
						line: node.location?.line ?? 0,
						element: node.name,
					},
				});
			}
			return;
		}

		if (tagLower === "tctypeconstantattach") {
			const typeName = getAttributeValue(node, "typeName");
			const value = getAttributeValue(node, "value");
			if (typeName && value) {
				references.push({
					referenceId: `ref-tconst-${fileName}-${references.length}`,
					referenceKind: "type-constant-attach",
					fromEntityId: makeEntityId("class", typeName),
					targetName: value,
					resolution: "local",
					sourceRef: {
						file: fileName,
						line: node.location?.line ?? 0,
						element: node.name,
					},
				});
			}
			return;
		}

		if (tagLower === "tcgrmattach") {
			const ruleName = getAttributeValue(node, "grmRuleName");
			const typeName = getAttributeValue(node, "typeName");
			if (ruleName) {
				references.push({
					referenceId: `ref-grm-${fileName}-${references.length}`,
					referenceKind: "grm-attach",
					fromEntityId: makeEntityId("grm-rule", ruleName),
					targetName: typeName || "unknown",
					resolution: "local",
					sourceRef: {
						file: fileName,
						line: node.location?.line ?? 0,
						element: node.name,
					},
				});
			}
			return;
		}
	});
}

function extractName(node, tagName) {
	// TcClass usa className, TcStandardType usa typeName, LOV usa name, etc.
	return (
		getAttributeValue(node, "className") ||
		getAttributeValue(node, "typeName") ||
		getAttributeValue(node, "name") ||
		getAttributeValue(node, "constantName") ||
		getAttributeValue(node, "extensionName") ||
		null
	);
}

function extractAttributes(node, tagName) {
	const attrs = {};
	if (tagName === "tcclass" || tagName === "tcstandardtype") {
		for (const child of node.children) {
			if (
				child.type === "element" &&
				child.name.toLowerCase() === "tcattribute"
			) {
				const attrName = getAttributeValue(child, "attributeName");
				if (attrName) {
					attrs[attrName] = {
						type: getAttributeValue(child, "attributeType"),
						maxLength: getAttributeValue(child, "maxStringLength"),
						isArray: getAttributeValue(child, "isArray") === "true",
					};
				}
			}
		}
	}

	if (tagName === "tclov") {
		const values = [];
		for (const child of node.children) {
			if (
				child.type === "element" &&
				child.name.toLowerCase() === "tclovvalue"
			) {
				values.push(getAttributeValue(child, "value") || getTextContent(child));
			}
		}
		if (values.length > 0) attrs.values = values;
	}

	return attrs;
}

/**
 * Parse um único arquivo XML e retorna o resultado parseado.
 */
export function parseFragment(xml, fileName) {
	return parseXmlDocument(xml, { fileName });
}
