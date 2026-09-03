import { FINDING_CODES } from "../schemas.js";
import { makeFinding } from "./_helpers.js";

/**
 * Regras de localização (plano §7.10).
 */
export function checkLocalization(ctx) {
	const findings = [];
	const { fileGroups, projectInfo } = ctx;

	// LOC-001: Fnd0SelectedLocales vs pastas disponíveis.
	const localeFiles = fileGroups?.localization || [];
	const availableLocales = new Set();
	for (const f of localeFiles) {
		const match = f.match(
			/_(en_US|fr_FR|de_DE|it_IT|ja_JP|ko_KR|pt_BR|pl_PL|es_ES|zh_CN|ru_RU)/i,
		);
		if (match) availableLocales.add(match[1]);
	}

	// Se não há arquivos de localização, não verificar.
	if (availableLocales.size === 0) return findings;

	// Encontrar Fnd0SelectedLocales no default.xml.
	// Nota: isso é verificado pelo analyzer que lê o conteúdo.

	return findings;
}
