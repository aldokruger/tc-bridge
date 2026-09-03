import { FINDING_CODES } from "../schemas.js";
import { makeFinding } from "./_helpers.js";

/**
 * Regras de relations, GRM e deep copy (plano §7.6).
 */
export function checkRelations(ctx) {
	const findings = [];
	const { entities, references } = ctx;

	const grmRules = entities.filter((e) => e.kind === "grm-rule");
	const grmAttaches = references.filter(
		(r) => r.referenceKind === "grm-attach",
	);

	// REL-001: GRM rule sem definição correspondente.
	for (const ref of grmAttaches) {
		if (ref.resolution === "unresolved") {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.REL_001,
					severity: "high",
					title: `GRM attach "${ref.fromEntityId}" não encontrada`,
					impact: `Attach referência GRM rule inexistente.`,
					evidenceRefs: [ref.sourceRef],
				}),
			);
		}
	}

	return findings;
}
