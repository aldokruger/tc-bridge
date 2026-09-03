import { FINDING_CODES } from "../schemas.js";
import { makeFinding } from "./_helpers.js";

/**
 * Regras de propriedades e atributos (plano §7.3, parte propriedades).
 */
export function checkProperties(ctx) {
	const findings = [];
	const { references } = ctx;

	// TYPE-005: propriedade anexada referencia atributo/propriedade válido.
	const propAttaches = references.filter(
		(r) => r.referenceKind === "property-constant-attach",
	);
	for (const ref of propAttaches) {
		if (ref.resolution === "unresolved") {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.TYPE_005,
					severity: "medium",
					title: `Propriedade "${ref.fromEntityId}" referenciada não encontrada`,
					impact: `Attach de constante sem propriedade válida.`,
					evidenceRefs: [ref.sourceRef],
				}),
			);
		}
	}

	return findings;
}
