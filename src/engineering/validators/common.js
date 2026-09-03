// Validadores comuns a todos os artefatos (schema, release, namespace).

import { artifactDraftSchema, validationFindingSchema } from "../schemas.js";
import { validateCustomizationDraft } from "./customization.js";
import { validateSavedQuerySpec } from "./saved-query.js";
import { validateWorkflowGraph } from "./workflow.js";

export function getCategoryValidator(artifactKind) {
	switch (artifactKind) {
		case "saved-query":
		case "soa-saved-query":
			return validateSavedQuerySpec;
		case "workflow":
			return validateWorkflowGraph;
		case "itk":
		case "bmide":
		case "soa":
		case "awc":
			return validateCustomizationDraft;
		default:
			return null;
	}
}

export function validateArtifactDraft(draft) {
	const findings = [];
	const parsed = artifactDraftSchema.safeParse(draft);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			findings.push({
				code: "schema.invalid",
				severity: "blocker",
				message: `${issue.path.join(".") || "raiz"}: ${issue.message}`,
				location: "draft",
			});
		}
		return findings;
	}
	const data = parsed.data;
	// Hash de fontes obrigatorio para status validated
	if (data.status === "validated" && data.source_refs.length === 0) {
		findings.push({
			code: "provenance.missing",
			severity: "blocker",
			message: "rascunho validated exige pelo menos uma fonte documental",
			location: "source_refs",
		});
	}
	// Evidencias nao sao obrigatorias, mas se houver devem ter referencia
	if (
		data.status === "validated" &&
		data.environment_evidence_refs.length > 0
	) {
		// validacao futura: verificar se evidencias existem no registry
	}
	// Rascunho expirado
	if (new Date(data.expires_at) <= new Date()) {
		findings.push({
			code: "draft.expired",
			severity: "error",
			message: "rascunho expirado; gere um novo",
			location: "expires_at",
		});
	}
	return findings.map((f) => validationFindingSchema.parse(f));
}
