import { FINDING_CODES } from "../schemas.js";
import { makeFinding } from "./_helpers.js";

/**
 * Regras de build, mídia e deploy (plano §7.11).
 */
export function checkDeployment(ctx) {
	const findings = [];
	const { fileGroups } = ctx;

	// DEPLOY-001: output antigo detectado.
	const generated = fileGroups?.generated || [];
	if (generated.length > 0) {
		findings.push(
			makeFinding({
				ruleId: FINDING_CODES.DEPLOY_001,
				severity: "info",
				title: `${generated.length} arquivos em output/ detectados`,
				impact: `Output pode conter pacotes de versões anteriores.`,
				evidenceRefs: [],
			}),
		);
	}

	return findings;
}
