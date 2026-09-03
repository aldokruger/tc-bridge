// EngineeringAssistant: orquestra draft e validate para artefatos.
// Interface proposta pelo plano, secao 7.3:
//   engineeringAssistant.draft(request)
//   engineeringAssistant.validate(draft)

import { createDraftStore } from "./draft-store.js";
import { generateAwcCustom } from "./generators/awc.js";
import { generateBmideExtension } from "./generators/bmide.js";
import { generateItkHandlerSkeleton } from "./generators/itk-handler.js";
import { generateSavedQuerySpec } from "./generators/saved-query.js";
import { generateSoaCustom } from "./generators/soa.js";
import { generateWorkflowGraph } from "./generators/workflow.js";
import { validateArtifactDraft } from "./validators/common.js";
import { validateCustomizationDraft } from "./validators/customization.js";
import { validateSavedQuerySpec } from "./validators/saved-query.js";
import { validateWorkflowGraph } from "./validators/workflow.js";

export function createEngineeringAssistant({
	draftStore,
	bmideReader,
	soaPolicy,
	auditLog,
} = {}) {
	const store = draftStore ?? createDraftStore();
	return {
		async draft({
			artifact_kind,
			release,
			requirements,
			environment_id,
			constraints = {},
			user,
		}) {
			if (!requirements || requirements.trim().length === 0) {
				throw new Error("requirements e obrigatorio");
			}
			if (!release || !/^\d{4}$/.test(release)) {
				throw new Error("release invalida; deve ter 4 digitos");
			}
			let draft;
			switch (artifact_kind) {
				case "saved-query":
				case "soa-saved-query": {
					let bmideModel = null;
					if (bmideReader && constraints.bmide_path) {
						try {
							bmideModel = await bmideReader.readBmideModel(
								constraints.bmide_path,
							);
						} catch {
							// BMIDE opcional; falha nao bloqueia geracao
						}
					}
					draft = generateSavedQuerySpec({
						requirements,
						release,
						environmentId: environment_id,
						constraints,
						bmideModel,
					});
					if (artifact_kind === "soa-saved-query") {
						draft.artifact_kind = "soa-saved-query";
						draft.content.queryKind = "soa-saved-query";
						// UID allowlist da policy
						const profile =
							soaPolicy?.profiles?.[constraints.soa_profile ?? "default"];
						if (profile?.saved_query?.saved_query_uid) {
							draft.content.allowedUid = profile.saved_query.saved_query_uid;
						}
					}
					break;
				}
				case "workflow": {
					draft = generateWorkflowGraph({
						requirements,
						release,
						environmentId: environment_id,
						constraints,
					});
					break;
				}
				case "itk": {
					draft = generateItkHandlerSkeleton({
						requirements,
						release,
						environmentId: environment_id,
						constraints,
					});
					break;
				}
				case "bmide": {
					draft = generateBmideExtension({
						requirements,
						release,
						environmentId: environment_id,
						constraints,
					});
					break;
				}
				case "soa": {
					draft = generateSoaCustom({
						requirements,
						release,
						environmentId: environment_id,
						constraints,
					});
					break;
				}
				case "awc": {
					draft = generateAwcCustom({
						requirements,
						release,
						environmentId: environment_id,
						constraints,
					});
					break;
				}
				default:
					throw new Error(
						`artifact_kind nao suportado no MVP: ${artifact_kind}`,
					);
			}
			const record = store.save(draft);
			if (auditLog) {
				await auditLog.write({
					event: "engineering.draft",
					artifact_kind,
					release,
					draft_id: record.draft_id,
					user: user ?? null,
				});
			}
			return record;
		},
		async validate({ draft_id, validation_profile = "qa-standard", user }) {
			const draft = store.get(draft_id);
			if (!draft) {
				throw new Error(`rascunho nao encontrado ou expirado: ${draft_id}`);
			}
			const findings = validateArtifactDraft(draft);
			// Validadores especificos por categoria
			if (
				draft.artifact_kind === "saved-query" ||
				draft.artifact_kind === "soa-saved-query"
			) {
				const specFindings = validateSavedQuerySpec(draft.content, {
					bmideTypes: [],
					bmideProperties: [],
				});
				findings.push(...specFindings);
			} else if (draft.artifact_kind === "workflow") {
				const specFindings = validateWorkflowGraph(draft.content);
				findings.push(...specFindings);
			} else if (
				draft.artifact_kind === "itk" ||
				draft.artifact_kind === "bmide" ||
				draft.artifact_kind === "soa" ||
				draft.artifact_kind === "awc"
			) {
				const specFindings = validateCustomizationDraft(draft);
				findings.push(...specFindings);
			}
			const updated = {
				...draft,
				validation_findings: findings.map((f) => f.code),
				status: findings.some(
					(f) => f.severity === "blocker" || f.severity === "error",
				)
					? "draft"
					: "validated",
			};
			store.save(updated);
			if (auditLog) {
				await auditLog.write({
					event: "engineering.validate",
					draft_id,
					validation_profile,
					status: updated.status,
					findingCount: findings.length,
					user: user ?? null,
				});
			}
			return { draft: updated, findings };
		},
		getStore() {
			return store;
		},
	};
}
