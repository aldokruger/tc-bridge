import assert from "node:assert/strict";
import test from "node:test";
import { createEngineeringAssistant } from "../src/engineering/assistant.js";
import { generateWorkflowGraph } from "../src/engineering/generators/workflow.js";
import { validateWorkflowGraph } from "../src/engineering/validators/workflow.js";

test("draft cria rascunho de workflow com grafo", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "workflow",
		release: "2606",
		requirements: "Processo de revisao e aprovacao de documentos",
		environment_id: "tc2606-dev",
	});
	assert.ok(draft.draft_id.startsWith("draft-"));
	assert.equal(draft.artifact_kind, "workflow");
	assert.equal(draft.status, "draft");
	assert.ok(draft.content.tasks);
	assert.ok(draft.content.transitions);
	assert.ok(draft.content.terminal_states);
});

test("workflow generator inclui handlers OOTB recomendados", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "workflow",
		release: "2606",
		requirements: "Auto assign e promote ao aprovar",
	});
	const task = draft.content.tasks.find((t) => t.type === "task");
	assert.ok(task);
	assert.ok(task.handlers.length > 0);
	assert.ok(task.handlers.some((h) => h.handler_id.startsWith("OOTB-")));
});

test("workflow generator adiciona decisao quando requisito menciona decisao", async () => {
	const draft = generateWorkflowGraph({
		requirements: "Fluxo com decisao de aprovacao",
		release: "2606",
	});
	const decision = draft.content.tasks.find((t) => t.type === "decision");
	assert.ok(decision);
	assert.ok(decision.branches);
	assert.ok(decision.branches.includes("aprovado"));
});

test("validate bloqueia workflow sem caminho terminal", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "workflow",
		release: "2606",
		requirements: "Processo simples",
	});
	const store = assistant.getStore();
	const record = store.get(draft.draft_id);
	record.content.transitions = record.content.transitions.filter(
		(t) => !record.content.terminal_states.includes(t.to),
	);
	store.save(record);
	const result = await assistant.validate({ draft_id: draft.draft_id });
	assert.equal(result.draft.status, "draft");
	assert.ok(
		result.findings.some((f) => f.code === "workflow.terminal.missing"),
	);
});

test("validate aceita workflow valido", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "workflow",
		release: "2606",
		requirements: "Processo de revisao",
	});
	const result = await assistant.validate({ draft_id: draft.draft_id });
	assert.equal(result.draft.status, "validated");
});

test("validateWorkflowGraph detecta no nao alcancavel", () => {
	const graph = {
		graph_id: "wf-test",
		name: "Test",
		version: "1.0",
		target_release: "2606",
		tasks: [
			{
				task_id: "start",
				name: "Inicio",
				type: "start",
				handlers: [],
				conditions: [],
			},
			{
				task_id: "task-1",
				name: "Tarefa",
				type: "task",
				handlers: [],
				conditions: [],
			},
			{
				task_id: "orphan",
				name: "Orfao",
				type: "task",
				handlers: [],
				conditions: [],
			},
			{
				task_id: "terminal-end",
				name: "Fim",
				type: "terminal",
				handlers: [],
				conditions: [],
			},
		],
		transitions: [
			{ from: "start", to: "task-1", type: "success" },
			{ from: "task-1", to: "terminal-end", type: "success" },
		],
		terminal_states: ["terminal-end"],
	};
	const findings = validateWorkflowGraph(graph);
	assert.ok(findings.some((f) => f.code === "workflow.node.unreachable"));
});

test("validateWorkflowGraph detecta decisao incompleta", () => {
	const graph = {
		graph_id: "wf-decision",
		name: "Decision",
		version: "1.0",
		target_release: "2606",
		tasks: [
			{
				task_id: "start",
				name: "Inicio",
				type: "start",
				handlers: [],
				conditions: [],
			},
			{
				task_id: "decision-1",
				name: "Decisao",
				type: "decision",
				handlers: [],
				conditions: [{ condition_id: "c1", expression: "x", language: "text" }],
				branches: ["a", "b", "c"],
			},
			{
				task_id: "terminal-end",
				name: "Fim",
				type: "terminal",
				handlers: [],
				conditions: [],
			},
		],
		transitions: [
			{ from: "start", to: "decision-1", type: "success" },
			{ from: "decision-1", to: "terminal-end", type: "conditional" },
		],
		terminal_states: ["terminal-end"],
	};
	const findings = validateWorkflowGraph(graph);
	assert.ok(
		findings.some((f) => f.code === "workflow.decision.branches.incomplete"),
	);
});

test("validateWorkflowGraph alerta handler de privilégio", () => {
	const graph = {
		graph_id: "wf-priv",
		name: "Privilege",
		version: "1.0",
		target_release: "2606",
		tasks: [
			{
				task_id: "start",
				name: "Inicio",
				type: "start",
				handlers: [],
				conditions: [],
			},
			{
				task_id: "task-1",
				name: "Tarefa",
				type: "task",
				handlers: [
					{
						handler_id: "OOTB-EPM-promote",
						handler_type: "action",
						name: "EPM-promote",
						is_custom: false,
						arguments: [],
						attachments: [],
						privilege_flag: true,
					},
				],
				conditions: [],
			},
			{
				task_id: "terminal-end",
				name: "Fim",
				type: "terminal",
				handlers: [],
				conditions: [],
			},
		],
		transitions: [
			{ from: "start", to: "task-1", type: "success" },
			{ from: "task-1", to: "terminal-end", type: "success" },
		],
		terminal_states: ["terminal-end"],
	};
	const findings = validateWorkflowGraph(graph);
	assert.ok(findings.some((f) => f.code === "workflow.handler.privilege"));
});

test("validateWorkflowGraph alerta handler custom sem registro", () => {
	const graph = {
		graph_id: "wf-custom",
		name: "Custom",
		version: "1.0",
		target_release: "2606",
		tasks: [
			{
				task_id: "start",
				name: "Inicio",
				type: "start",
				handlers: [],
				conditions: [],
			},
			{
				task_id: "task-1",
				name: "Tarefa",
				type: "task",
				handlers: [
					{
						handler_id: "custom-handler-1",
						handler_type: "action",
						name: "Custom",
						is_custom: true,
						arguments: [],
						attachments: [],
						privilege_flag: false,
					},
				],
				conditions: [],
			},
			{
				task_id: "terminal-end",
				name: "Fim",
				type: "terminal",
				handlers: [],
				conditions: [],
			},
		],
		transitions: [
			{ from: "start", to: "task-1", type: "success" },
			{ from: "task-1", to: "terminal-end", type: "success" },
		],
		terminal_states: ["terminal-end"],
	};
	const findings = validateWorkflowGraph(graph);
	assert.ok(
		findings.some((f) => f.code === "workflow.handler.custom.registration"),
	);
});
