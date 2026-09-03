import { FINDING_CODES } from "../schemas.js";
import { makeFinding } from "./_helpers.js";

/**
 * Regras de naming rules (plano §7.5).
 */
export function checkNaming(ctx) {
	const findings = [];
	const { entities, references } = ctx;

	const namingRules = entities.filter(
		(e) => e.kind === "naming-rule" || e.kind === "revision-naming-rule",
	);
	const namingAttaches = references.filter(
		(r) => r.referenceKind === "naming-rule-attach",
	);

	// NAMING-002: attach para regra inexistente.
	for (const ref of namingAttaches) {
		if (ref.resolution === "unresolved") {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.NAMING_002,
					severity: "high",
					title: `Naming rule attach "${ref.fromEntityId}" não encontrada`,
					impact: `Attach referência regra inexistente.`,
					evidenceRefs: [ref.sourceRef],
				}),
			);
		}
	}

	// NAMING-001: regra definida sem attach.
	const attachedRules = new Set(namingAttaches.map((r) => r.fromEntityId));
	for (const rule of namingRules) {
		const refKey = `${rule.kind}:${rule.name}`;
		if (!attachedRules.has(refKey)) {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.NAMING_001,
					severity: "low",
					title: `Naming rule "${rule.name}" sem attach`,
					impact: `Pode estar sem uso ativo.`,
					evidenceRefs: [rule.sourceRef],
				}),
			);
		}
	}

	return findings;
}
