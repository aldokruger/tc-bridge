// Validador estrutural de WorkflowGraph (plano, secao 11.2).
// Regras: alcancabilidade, terminal path, decisoes completas, handlers, argumentos.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { workflowGraphSchema } from "../schemas/workflow.js";
import { validationFindingSchema } from "../schemas.js";

let _handlerCatalog = null;
function getHandlerCatalog() {
	if (_handlerCatalog) return _handlerCatalog;
	try {
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

function findReachableNodes(graph) {
	const adj = new Map();
	for (const t of graph.transitions) {
		if (!adj.has(t.from)) adj.set(t.from, []);
		adj.get(t.from).push(t.to);
	}
	const start = graph.tasks.find((t) => t.type === "start");
	if (!start) return new Set();
	const reachable = new Set();
	const queue = [start.task_id];
	while (queue.length > 0) {
		const node = queue.shift();
		if (reachable.has(node)) continue;
		reachable.add(node);
		for (const next of adj.get(node) || []) {
			if (!reachable.has(next)) queue.push(next);
		}
	}
	return reachable;
}

export function validateWorkflowGraph(graph) {
	const findings = [];

	// Validacao de schema
	const parsed = workflowGraphSchema.safeParse(graph);
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			findings.push({
				code: "workflow.schema.invalid",
				severity: "blocker",
				message: `${issue.path.join(".") || "raiz"}: ${issue.message}`,
				location: "graph",
			});
		}
		return findings.map((f) => validationFindingSchema.parse(f));
	}

	const data = parsed.data;
	const catalog = getHandlerCatalog();
	const catalogMap = new Map();
	for (const h of catalog.handlers || []) {
		catalogMap.set(h.handler_id, h);
	}

	// 1. Todos os nos sao alcancaveis a partir do start
	const reachable = findReachableNodes(data);
	for (const task of data.tasks) {
		if (!reachable.has(task.task_id)) {
			findings.push({
				code: "workflow.node.unreachable",
				severity: "error",
				message: `no nao alcancavel: ${task.task_id}`,
				location: `tasks.${task.task_id}`,
			});
		}
	}

	// 2. Caminho terminal valido: pelo menos um terminal e alcancavel
	const reachableTerminals = data.terminal_states.filter((ts) =>
		reachable.has(ts),
	);
	if (reachableTerminals.length === 0) {
		findings.push({
			code: "workflow.terminal.missing",
			severity: "blocker",
			message: "nenhum estado terminal alcancavel a partir do start",
			location: "terminal_states",
		});
	}

	// 3. Decision branches completas
	for (const task of data.tasks) {
		if (task.type === "decision") {
			if (!task.branches || task.branches.length === 0) {
				findings.push({
					code: "workflow.decision.branches.empty",
					severity: "error",
					message: `decisao sem branches: ${task.task_id}`,
					location: `tasks.${task.task_id}.branches`,
				});
			} else {
				// Conta transicoes saindo da decisao
				const outTransitions = data.transitions.filter(
					(t) => t.from === task.task_id,
				);
				if (outTransitions.length < task.branches.length) {
					findings.push({
						code: "workflow.decision.branches.incomplete",
						severity: "error",
						message: `decisao ${task.task_id} possui ${task.branches.length} branches mas apenas ${outTransitions.length} transicoes`,
						location: `tasks.${task.task_id}`,
					});
				}
			}
		}
	}

	// 4. Handlers existem no catalogo ou estao marcados como custom
	for (const task of data.tasks) {
		for (const h of task.handlers) {
			const catalogEntry = catalogMap.get(h.handler_id);
			if (!catalogEntry && !h.is_custom) {
				findings.push({
					code: "workflow.handler.unknown",
					severity: "warning",
					message: `handler nao catalogado e nao marcado como custom: ${h.handler_id}`,
					location: `tasks.${task.task_id}.handlers.${h.handler_id}`,
				});
			}
			if (h.is_custom) {
				if (!h.registration || !h.registration.function) {
					findings.push({
						code: "workflow.handler.custom.registration",
						severity: "warning",
						message: `handler customizado deve declarar funcao de registro: ${h.handler_id}`,
						location: `tasks.${task.task_id}.handlers.${h.handler_id}.registration`,
					});
				}
			}
			// 5. Argumentos obrigatorios presentes
			const requiredArgs = (
				catalogEntry?.arguments ||
				h.arguments ||
				[]
			).filter((a) => a.required);
			// Verifica apenas estrutura: o gerador ja preenche; validador so alerta se vazio
			if (
				requiredArgs.length > 0 &&
				(!h.arguments || h.arguments.length === 0)
			) {
				findings.push({
					code: "workflow.handler.arguments.missing",
					severity: "error",
					message: `handler ${h.handler_id} requer argumentos obrigatorios`,
					location: `tasks.${task.task_id}.handlers.${h.handler_id}.arguments`,
				});
			}
			// 6. Privilegio/protecao
			if (h.privilege_flag) {
				findings.push({
					code: "workflow.handler.privilege",
					severity: "warning",
					message: `handler de privilégio/protecao requer revisao: ${h.handler_id}`,
					location: `tasks.${task.task_id}.handlers.${h.handler_id}`,
				});
			}
		}
	}

	return findings.map((f) => validationFindingSchema.parse(f));
}
