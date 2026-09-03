import crypto from "node:crypto";

let findingCounter = 0;

/**
 * Helper para criar findings padronizados.
 * @param {Object} params
 * @returns {Object} finding validado
 */
export function makeFinding({
	ruleId,
	severity,
	title,
	impact,
	evidenceRefs = [],
}) {
	findingCounter++;
	const hash = crypto
		.createHash("sha256")
		.update(`${ruleId}:${title}:${findingCounter}`)
		.digest("hex")
		.slice(0, 8);

	return {
		findingId: `fnd-${hash}`,
		ruleId,
		severity,
		classification: "observed",
		title: title.slice(0, 200),
		impact: impact.slice(0, 2000),
		evidenceRefs: evidenceRefs.map((e) => ({
			file: e.file || "unknown",
			line: e.line ?? 0,
			element: e.element ?? "unknown",
		})),
		missingChecks: [],
		recommendedNextStep: `Verificar ${ruleId} manualmente.`,
	};
}

/**
 * Reseta contador (para testes).
 */
export function resetFindingCounter() {
	findingCounter = 0;
}
