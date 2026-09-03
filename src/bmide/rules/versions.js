import { FINDING_CODES } from "../schemas.js";
import { makeFinding } from "./_helpers.js";

/**
 * Regras de release, build e compatibilidade (plano §7.2).
 */
export function checkVersions(ctx) {
	const findings = [];
	const { projectInfo, dependencyInfo } = ctx;

	const templateVersion =
		dependencyInfo?.templateVersion || projectInfo?.templateVersion;

	// VER-001: template version incompatível com release alvo.
	if (!templateVersion) {
		findings.push(
			makeFinding({
				ruleId: FINDING_CODES.VER_006,
				severity: "unverified",
				title: "Versão do template não identificada",
				impact: "Não é possível verificar compatibilidade com release alvo.",
				evidenceRefs: [],
			}),
		);
	}

	// VER-006: informação insuficiente para concluir compatibilidade.
	const foundationRelease = projectInfo?.foundationRelease;
	if (templateVersion && !foundationRelease) {
		findings.push(
			makeFinding({
				ruleId: FINDING_CODES.VER_006,
				severity: "unverified",
				title: "Foundation release não identificada",
				impact:
					"Não é possível verificar se o template é compatível com a instalação.",
				evidenceRefs: [],
			}),
		);
	}

	return findings;
}
