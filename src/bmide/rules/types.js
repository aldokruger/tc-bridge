import { FINDING_CODES } from "../schemas.js";
import { makeFinding } from "./_helpers.js";

/**
 * Regras de tipos, classes e propriedades (plano §7.3).
 */
export function checkTypes(ctx) {
	const findings = [];
	const { entities } = ctx;

	const classes = entities.filter((e) => e.kind === "class");
	const stdTypes = entities.filter((e) => e.kind === "standard-type");
	const forms = entities.filter((e) => e.kind === "form");
	const attrs = entities.filter((e) => e.kind === "attribute");

	// TYPE-001: toda classe customizada possui business type correspondente.
	const stdTypeNames = new Set(stdTypes.map((t) => t.name));
	for (const cls of classes) {
		if (!stdTypeNames.has(cls.name)) {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.TYPE_001,
					severity: "medium",
					title: `Classe "${cls.name}" sem TcStandardType correspondente`,
					impact: `Pode indicar tipo incompleto ou uso indevido de tipo OOTB.`,
					evidenceRefs: [cls.sourceRef],
				}),
			);
		}
	}

	// TYPE-003: herança customizada — verifica se parentName é resolúvel.
	const allNames = new Set(entities.map((e) => e.name));
	for (const e of [...classes, ...stdTypes, ...forms]) {
		if (
			e.parentName &&
			!allNames.has(e.parentName) &&
			!isOOTBName(e.parentName)
		) {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.TYPE_003,
					severity: "high",
					title: `Herança "${e.parentName}" de "${e.name}" não resolvida localmente`,
					impact: `Depende de template externo ou instalação.`,
					evidenceRefs: [e.sourceRef],
				}),
			);
		}
	}

	return findings;
}

function isOOTBName(name) {
	const lower = name.toLowerCase();
	const ootbPrefixes = [
		"item",
		"itemrevision",
		"workspaceobject",
		"dataset",
		"folder",
		"content",
		"document",
		"specification",
		"organization",
		"group",
		"user",
		"imantype",
		"relationtype",
		"tcrepresentation",
	];
	return ootbPrefixes.some((p) => lower.startsWith(p));
}
