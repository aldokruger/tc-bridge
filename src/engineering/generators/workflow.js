// Gerador de WorkflowGraph a partir de requisitos (plano, secao 10.3).
// Recomenda handlers OOTB do catalogo e marca customizados.

import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let _handlerCatalog = null;
function getHandlerCatalog() {
	if (_handlerCatalog) return _handlerCatalog;
	try {
		// Resolve relativo a este modulo em ESM
		const base = fileURLToPath(import.meta.url);
		const catalogPath = path.resolve(
			path.dirname(base),
			"../../../knowledge/catalog/workflow-handlers.json",
		);
		const raw = readFileSync(catalogPath, "utf8");
		_handlerCatalog = JSON.parse(raw);
	} catch {
		_handlerCatalog = { version: 1, handlers: [] };
	}
	return _handlerCatalog;
}

function recommendHandlers(requirements, release) {
	const catalog = getHandlerCatalog();
	const reqLower = requirements.toLowerCase();
	const recommendations = [];
	for (const h of catalog.handlers || []) {
		const compatible = (h.releases || []).includes(release);
		if (!compatible) continue;
		// Heuristica simples: palavras-chave do nome do handler no requisito
		const nameWords = h.name.toLowerCase().split(/[-_]/);
		const matches = nameWords.filter(
			(w) => w.length > 2 && reqLower.includes(w),
		);
		if (matches.length > 0 || reqLower.includes(h.handler_type)) {
			recommendations.push({
				...h,
				is_custom: false,
				arguments: h.arguments || [],
				attachments: h.attachments || [],
			});
		}
	}
	return recommendations.slice(0, 4);
}

export function generateWorkflowGraph({
	requirements,
	release,
	environmentId,
	constraints = {},
}) {
	const draftId = `draft-${crypto.randomUUID()}`;
	const namespacePrefix = constraints.namespace_prefix || "custom";
	const recommended = recommendHandlers(requirements, release);

	// Grafo padrao minimo: start -> task -> terminal
	const startTask = {
		task_id: "start",
		name: "Inicio",
		type: "start",
		responsible: undefined,
		handlers: [],
		conditions: [],
		branches: undefined,
		require_attachment: false,
	};

	const mainTask = {
		task_id: "task-1",
		name: "Revisao",
		type: "task",
		responsible: "Revisor",
		handlers: recommended.map((h) => ({
			handler_id: h.handler_id,
			handler_type: h.handler_type,
			name: h.name,
			is_custom: h.is_custom,
			arguments: h.arguments,
			attachments: h.attachments || [],
			privilege_flag: h.privilege_flag || false,
		})),
		conditions: [],
		branches: undefined,
		require_attachment: false,
	};

	// Se o requisito menciona decisao/condicao, adiciona no decisao
	const decisionKeywords = [
		"decisao",
		"decision",
		"aprovar",
		"rejeitar",
		"if",
		"se ",
	];
	const hasDecision = decisionKeywords.some((k) =>
		requirements.toLowerCase().includes(k),
	);

	const tasks = [startTask, mainTask];
	const transitions = [{ from: "start", to: "task-1", type: "success" }];

	if (hasDecision) {
		const decisionTask = {
			task_id: "decision-1",
			name: "Decisao",
			type: "decision",
			responsible: "Aprovador",
			handlers: [],
			conditions: [
				{
					condition_id: "cond-1",
					expression: "resultado == aprovado",
					language: "text",
				},
			],
			branches: ["aprovado", "rejeitado"],
			require_attachment: false,
		};
		const approvedTerminal = {
			task_id: "terminal-approved",
			name: "Aprovado",
			type: "terminal",
			responsible: undefined,
			handlers: [],
			conditions: [],
			branches: undefined,
			require_attachment: false,
		};
		const rejectedTerminal = {
			task_id: "terminal-rejected",
			name: "Rejeitado",
			type: "terminal",
			responsible: undefined,
			handlers: [],
			conditions: [],
			branches: undefined,
			require_attachment: false,
		};
		tasks.push(decisionTask, approvedTerminal, rejectedTerminal);
		transitions.push(
			{ from: "task-1", to: "decision-1", type: "success" },
			{
				from: "decision-1",
				to: "terminal-approved",
				type: "conditional",
				condition_id: "cond-1",
			},
			{
				from: "decision-1",
				to: "terminal-rejected",
				type: "conditional",
			},
		);
	} else {
		const terminalTask = {
			task_id: "terminal-end",
			name: "Fim",
			type: "terminal",
			responsible: undefined,
			handlers: [],
			conditions: [],
			branches: undefined,
			require_attachment: false,
		};
		tasks.push(terminalTask);
		transitions.push({
			from: "task-1",
			to: "terminal-end",
			type: "success",
		});
	}

	const terminalStates = tasks
		.filter((t) => t.type === "terminal")
		.map((t) => t.task_id);

	const graph = {
		graph_id: `wf-${namespacePrefix}-${release}`,
		name: `Workflow ${namespacePrefix}`,
		version: "1.0",
		target_release: release,
		tasks,
		transitions,
		terminal_states: terminalStates,
	};

	return {
		draft_id: draftId,
		schema_version: 1,
		artifact_kind: "workflow",
		target_release: release,
		environment_id: environmentId,
		status: "draft",
		requirements,
		content: graph,
		assumptions: [
			"Grafo intermediario; nao gera XML de importacao",
			"Handlers OOTB validados contra catalogo versionado",
			"Handlers customizados devem ser explicitamente marcados",
		],
		source_refs: [],
		environment_evidence_refs: [],
		validation_findings: [],
		created_at: new Date().toISOString(),
	};
}
