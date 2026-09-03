// Gerador de extensao BMIDE tipo/propriedade (plano, secao 10.4).
// Declara namespace, LOV, impacto de deploy e convenções do projeto.

import crypto from "node:crypto";

export function generateBmideExtension({
	requirements,
	release,
	environmentId,
	constraints = {},
}) {
	const draftId = `draft-${crypto.randomUUID()}`;
	const namespacePrefix = constraints.namespace_prefix || "custom";
	const typeName = constraints.type_name || `${namespacePrefix}_BusinessObject`;
	const parentType = constraints.parent_type || "Item";

	const properties = [];
	const reqLower = requirements.toLowerCase();
	if (reqLower.includes("descricao") || reqLower.includes("description")) {
		properties.push({
			name: `${namespacePrefix}_description`,
			type: "string",
			maxLength: 256,
			required: false,
		});
	}
	if (reqLower.includes("status") || reqLower.includes("estado")) {
		properties.push({
			name: `${namespacePrefix}_status`,
			type: "string",
			lovName: `${namespacePrefix}_status_lov`,
			required: true,
		});
	}
	if (properties.length === 0) {
		properties.push({
			name: `${namespacePrefix}_custom_attr`,
			type: "string",
			maxLength: 128,
			required: false,
		});
	}

	const lovs = properties
		.filter((p) => p.lovName)
		.map((p) => ({
			name: p.lovName,
			values: ["ativo", "inativo", "pendente"],
		}));

	return {
		draft_id: draftId,
		schema_version: 1,
		artifact_kind: "bmide",
		target_release: release,
		environment_id: environmentId,
		status: "draft",
		requirements,
		content: {
			typeName,
			parentType,
			namespacePrefix,
			properties,
			lovs,
			deployImpact: {
				requiresTemplateUpdate: true,
				requiresClientCache: true,
				affectsQueryBuilder: properties.some((p) => p.type === "string"),
			},
			targetRelease: release,
			steps: [
				`Criar tipo ${typeName} estendendo ${parentType} no BMIDE`,
				`Adicionar propriedades: ${properties.map((p) => p.name).join(", ")}`,
				...(lovs.length > 0
					? [`Configurar LOVs: ${lovs.map((l) => l.name).join(", ")}`]
					: []),
				`Gerar template e sincronizar com o ambiente`,
				`Recompilar cliente rico e AWC se aplicavel`,
			],
		},
		assumptions: [
			"Extensao BMIDE gerada como rascunho",
			"Deploy requer homologacao em QA antes de PRD",
		],
		source_refs: [],
		environment_evidence_refs: [],
		validation_findings: [],
		created_at: new Date().toISOString(),
	};
}
