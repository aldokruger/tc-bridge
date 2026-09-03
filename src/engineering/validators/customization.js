// Validador de customizacoes (plano, secao 11.3).
// Regras: namespace, API existente, APIs internas bloqueadas, dependencias,
// tratamento de erro em ITK, contrato SOA, modulo/locale AWC.

import { validationFindingSchema } from "../schemas.js";

const BLOCKED_INTERNAL_APIS = [
	"internal_",
	"_internal",
	"ITK_internal",
	"POM_internal",
	"AOM_internal",
];

export function validateCustomizationDraft(draft) {
	const findings = [];
	const kind = draft.artifact_kind;
	const content = draft.content || {};

	// 1. Namespace obrigatorio
	const namespace =
		content.namespacePrefix || draft.constraints?.namespace_prefix;
	if (!namespace || namespace.length < 2) {
		findings.push({
			code: "customization.namespace.missing",
			severity: "blocker",
			message: "prefixo de namespace e obrigatorio para customizacoes",
			location: "namespacePrefix",
		});
	}

	// 2. Release alvo declarada
	if (!content.targetRelease && !draft.target_release) {
		findings.push({
			code: "customization.release.missing",
			severity: "error",
			message: "release alvo deve ser declarada",
			location: "targetRelease",
		});
	}

	// 3. Validacoes especificas por categoria
	if (kind === "itk") {
		findings.push(...validateItkDraft(content));
	} else if (kind === "bmide") {
		findings.push(...validateBmideDraft(content));
	} else if (kind === "soa") {
		findings.push(...validateSoaDraft(content));
	} else if (kind === "awc") {
		findings.push(...validateAwcDraft(content));
	}

	return findings.map((f) => validationFindingSchema.parse(f));
}

function validateItkDraft(content) {
	const findings = [];
	const code = content.code || "";

	// APIs internas bloqueadas
	for (const blocked of BLOCKED_INTERNAL_APIS) {
		if (code.toLowerCase().includes(blocked.toLowerCase())) {
			findings.push({
				code: "customization.itk.internal-api",
				severity: "blocker",
				message: `API interna bloqueada encontrada: ${blocked}`,
				location: "code",
			});
		}
	}

	// Tratamento de erro
	if (!code.includes("ifail") || !code.includes("ITK_ok")) {
		findings.push({
			code: "customization.itk.error-handling",
			severity: "error",
			message: "ITK deve incluir tratamento de erro (ifail != ITK_ok)",
			location: "code",
		});
	}

	// Liberacao de recursos
	if (!code.includes("MEM_free")) {
		findings.push({
			code: "customization.itk.resource-cleanup",
			severity: "warning",
			message: "ITK deve liberar recursos alocados (MEM_free)",
			location: "code",
		});
	}

	// Funcao de registro
	if (
		!code.includes("EPM_register_action_handler") &&
		!code.includes("EPM_register_rule_handler")
	) {
		findings.push({
			code: "customization.itk.registration",
			severity: "error",
			message: "handler ITK deve declarar funcao de registro",
			location: "code",
		});
	}

	// Dependencias/toolchain declaradas
	if (!content.buildSteps || content.buildSteps.length === 0) {
		findings.push({
			code: "customization.itk.dependencies",
			severity: "warning",
			message: "declare passos de build e dependencias",
			location: "buildSteps",
		});
	}

	return findings;
}

function validateBmideDraft(content) {
	const findings = [];

	// Impacto de deploy declarado
	if (!content.deployImpact) {
		findings.push({
			code: "customization.bmide.deploy-impact",
			severity: "warning",
			message: "BMIDE deve declarar impacto em template/deploy",
			location: "deployImpact",
		});
	}

	// Propriedades com namespace
	for (const prop of content.properties || []) {
		if (!prop.name || !prop.name.includes(content.namespacePrefix)) {
			findings.push({
				code: "customization.bmide.property.namespace",
				severity: "error",
				message: `propriedade deve usar namespace do projeto: ${prop.name || "?"}`,
				location: `properties.${prop.name || "?"}`,
			});
		}
	}

	return findings;
}

function validateSoaDraft(content) {
	const findings = [];

	// Contrato declarado
	if (!content.contract) {
		findings.push({
			code: "customization.soa.contract",
			severity: "error",
			message: "SOA custom deve declarar contrato (operacao, payload)",
			location: "contract",
		});
	}

	// Partial errors
	if (content.contract && !content.contract.partialErrors) {
		findings.push({
			code: "customization.soa.partial-errors",
			severity: "warning",
			message: "SOA custom deve declarar tratamento de partial errors",
			location: "contract.partialErrors",
		});
	}

	return findings;
}

function validateAwcDraft(content) {
	const findings = [];

	// Modulo declarado
	if (!content.module) {
		findings.push({
			code: "customization.awc.module",
			severity: "error",
			message: "AWC custom deve declarar modulo",
			location: "module",
		});
	}

	// Locale declarado
	if (!content.locale) {
		findings.push({
			code: "customization.awc.locale",
			severity: "warning",
			message: "AWC custom deve declarar locale suportado",
			location: "locale",
		});
	}

	return findings;
}
