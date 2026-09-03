// Gerador de especificacao de Saved Query (plano, secao 10.2).
// Usa tipo e propriedades confirmados pelo ambiente (BMIDE reader).
// Gera somente especificacao; nao cria nem executa no Teamcenter.

import crypto from "node:crypto";

export function generateSavedQuerySpec({
	requirements,
	release,
	environmentId,
	constraints = {},
	bmideModel = null,
}) {
	const draftId = `draft-${crypto.randomUUID()}`;
	const namespacePrefix = constraints.namespace_prefix || "custom";
	const maxResults = constraints.max_results ?? 200;

	// Extrai tipos e propriedades do BMIDE quando disponivel
	const types = bmideModel?.business_objects?.map((bo) => bo.name) ?? [];
	const properties = bmideModel?.properties?.map((p) => p.name) ?? [];

	// Heuristica simples: escolhe tipo raiz e propriedades com base no texto do requisito
	const reqLower = requirements.toLowerCase();
	let rootType = "Item";
	if (types.length > 0) {
		const found = types.find((t) => reqLower.includes(t.toLowerCase()));
		if (found) rootType = found;
	}
	const selectedProperties = [];
	for (const prop of properties.slice(0, 10)) {
		if (reqLower.includes(prop.toLowerCase().replace(/_/g, " "))) {
			selectedProperties.push(prop);
		}
	}
	if (selectedProperties.length === 0) {
		selectedProperties.push("object_name", "object_desc");
	}

	const spec = {
		queryKind: "saved-query",
		rootType,
		properties: selectedProperties.slice(0, 8),
		inputs: [{ name: "Name", type: "string", required: true }],
		maxResults,
		namespacePrefix,
		targetRelease: release,
		steps: [
			`Abrir Query Builder no ambiente ${environmentId ?? release}`,
			`Criar Saved Query com prefixo ${namespacePrefix}`,
			`Selecionar tipo raiz: ${rootType}`,
			`Adicionar propriedades: ${selectedProperties.join(", ")}`,
			`Definir entradas e limitar a ${maxResults} resultados`,
			`Salvar e validar no cliente rico antes de publicar`,
		],
		testCases: [
			{ description: "Busca por nome exato", expected: "Retorna objeto unico" },
			{
				description: "Busca parcial",
				expected: "Retorna lista dentro do limite",
			},
		],
	};

	return {
		draft_id: draftId,
		schema_version: 1,
		artifact_kind: "saved-query",
		target_release: release,
		environment_id: environmentId,
		status: "draft",
		requirements,
		content: spec,
		assumptions: [
			"Tipo e propriedades confirmados pelo modelo BMIDE do ambiente",
			"Query Builder disponivel no cliente rico da release alvo",
		],
		source_refs: [],
		environment_evidence_refs: [],
		validation_findings: [],
		created_at: new Date().toISOString(),
	};
}
