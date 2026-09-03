import { FINDING_CODES } from "../schemas.js";
import { makeFinding } from "./_helpers.js";

/**
 * Regras de LOV (plano §7.4).
 */
export function checkLOVs(ctx) {
	const findings = [];
	const { entities, references, stats } = ctx;

	const lovs = entities.filter(
		(e) => e.kind === "lov-static" || e.kind === "lov-dynamic",
	);
	const lovAttaches = references.filter(
		(r) => r.referenceKind === "lov-attach",
	);

	// LOV-001: LOV estática e dinâmica no mesmo catálogo.
	const staticNames = new Set(
		entities.filter((e) => e.kind === "lov-static").map((e) => e.name),
	);
	const dynamicNames = new Set(
		entities.filter((e) => e.kind === "lov-dynamic").map((e) => e.name),
	);
	for (const name of staticNames) {
		if (dynamicNames.has(name)) {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.LOV_001,
					severity: "high",
					title: `Colisão static/dynamic: "${name}" definido como ambos`,
					impact: `Ambiguidade — Teamcenter pode usar a definição errada.`,
					evidenceRefs: [],
				}),
			);
		}
	}

	// LOV-003: LOV definida e nunca anexada.
	const attachedLovs = new Set(lovAttaches.map((r) => r.fromEntityId));
	for (const lov of lovs) {
		const refKey = `${lov.kind}:${lov.name}`;
		if (!attachedLovs.has(refKey)) {
			// Nem toda LOV precisa de attach — apenas informativo.
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.LOV_003,
					severity: "low",
					title: `LOV "${lov.name}" definida mas sem attach`,
					impact: `Pode estar sem uso ativo.`,
					evidenceRefs: [lov.sourceRef],
				}),
			);
		}
	}

	// LOV-004: attach para LOV inexistente.
	for (const ref of lovAttaches) {
		if (ref.resolution === "unresolved") {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.LOV_004,
					severity: "high",
					title: `LOV attach "${ref.fromEntityId}" não encontrada`,
					impact: `Attach referência LOV inexistente.`,
					evidenceRefs: [ref.sourceRef],
				}),
			);
		}
	}

	return findings;
}
