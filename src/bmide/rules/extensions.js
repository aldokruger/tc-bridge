import { FINDING_CODES } from "../schemas.js";
import { makeFinding } from "./_helpers.js";

/**
 * Regras de extensions (plano §7.7).
 */
export function checkExtensions(ctx) {
	const findings = [];
	const { references } = ctx;

	const extAttaches = references.filter(
		(r) => r.referenceKind === "extension-attach",
	);

	// EXT-001: extension attachment sem operação válida.
	for (const ref of extAttaches) {
		if (ref.targetName === "unknown" || !ref.targetName) {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.EXT_001,
					severity: "medium",
					title: `Extension "${ref.fromEntityId}" sem operação associada`,
					impact: `Extensão pode não ser acionada corretamente.`,
					evidenceRefs: [ref.sourceRef],
				}),
			);
		}
	}

	return findings;
}
