import { FINDING_CODES } from "../schemas.js";
import { makeFinding } from "./_helpers.js";

/**
 * Regras de estrutura e integridade (plano §7.1).
 * @param {Object} ctx - contexto do analyzer
 * @returns {Array} findings
 */
export function checkStructure(ctx) {
	const findings = [];
	const {
		includeGraph,
		entities,
		fileGroups,
		wellFormednessErrors,
		projectInfo,
	} = ctx;

	// STRUCT-001: arquivos críticos ausentes.
	const criticalMissing = includeGraph?.missing || [];
	for (const m of criticalMissing) {
		if (/ProjectInfo\.xml|master\.xml|dependency\.xml/.test(m)) {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.STRUCT_001,
					severity: "critical",
					title: `Arquivo crítico ausente: ${m}`,
					impact: `Projeto pode não ser carregado pelo BMIDE ou Teamcenter.`,
					evidenceRefs: [{ file: m, line: 0, element: "include" }],
				}),
			);
		}
	}

	// STRUCT-002: XML malformado.
	for (const err of wellFormednessErrors || []) {
		if (err.error) {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.STRUCT_002,
					severity: "critical",
					title: `XML malformado em ${err.file}`,
					impact: `Fragmento pode ser ignorado pelo parser.`,
					evidenceRefs: [{ file: err.file, line: 0, element: "xml" }],
				}),
			);
		}
	}

	// STRUCT-003: includes ausentes ou fora da raiz.
	for (const m of includeGraph?.missing || []) {
		if (!/ProjectInfo\.xml|master\.xml|dependency\.xml/.test(m)) {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.STRUCT_003,
					severity: "high",
					title: `Include ausente: ${m}`,
					impact: `Fragmentos dependentes podem não ser carregados.`,
					evidenceRefs: [{ file: m, line: 0, element: "include" }],
				}),
			);
		}
	}

	// STRUCT-004: ciclos no grafo de includes.
	for (const c of includeGraph?.cycles || []) {
		findings.push(
			makeFinding({
				ruleId: FINDING_CODES.STRUCT_004,
				severity: "critical",
				title: `Ciclo detectado no grafo de includes: ${c}`,
				impact: `Parse pode falhar ou entrar em loop infinito.`,
				evidenceRefs: [{ file: c, line: 0, element: "include" }],
			}),
		);
	}

	// STRUCT-006: declarações duplicadas.
	const seenEntities = new Map();
	for (const e of entities) {
		const key = `${e.kind}:${e.name}`;
		if (seenEntities.has(key)) {
			findings.push(
				makeFinding({
					ruleId: FINDING_CODES.STRUCT_006,
					severity: "high",
					title: `Declaração duplicada: ${e.kind} ${e.name}`,
					impact: `Conflito de definição — a última definição vence, mas pode causar comportamento inesperado.`,
					evidenceRefs: [e.sourceRef],
				}),
			);
		}
		seenEntities.set(key, e);
	}

	return findings;
}
