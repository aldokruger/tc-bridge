import { z } from "zod";

// Schema intermediario de WorkflowGraph (plano, secao 10.3).
// Grafo independente do formato de importacao; valida logica antes de gerar XML.

export const WORKFLOW_NODE_TYPES = [
	"start",
	"task",
	"decision",
	"terminal",
	"subprocess",
];

export const WORKFLOW_TRANSITION_TYPES = [
	"success",
	"failure",
	"conditional",
	"timeout",
];

export const HANDLER_CARDINALITY_SCHEMA = z.enum([
	"single",
	"multiple",
	"optional",
]);

export const workflowHandlerSchema = z
	.object({
		handler_id: z.string().min(1).max(128),
		handler_type: z.enum(["action", "rule", "pre", "post", "validate"]),
		name: z.string().min(1).max(256),
		is_custom: z.boolean().default(false),
		arguments: z
			.array(
				z.object({
					name: z.string().min(1).max(128),
					type: z.string().min(1).max(64),
					required: z.boolean().default(true),
					cardinality: HANDLER_CARDINALITY_SCHEMA.default("single"),
					description: z.string().max(1_000).optional(),
				}),
			)
			.max(32)
			.default([]),
		attachments: z
			.array(
				z.object({
					name: z.string().min(1).max(128),
					required: z.boolean().default(false),
				}),
			)
			.max(16)
			.default([]),
		// Flag para operacoes de privilégio ou protecao
		privilege_flag: z.boolean().default(false),
		// Referencia de registro para customizados
		registration: z
			.object({
				library: z.string().min(1).max(256).optional(),
				function: z.string().min(1).max(256).optional(),
				namespace: z.string().min(1).max(128).optional(),
			})
			.optional(),
	})
	.strict();

export const workflowConditionSchema = z
	.object({
		condition_id: z.string().min(1).max(128),
		expression: z.string().min(1).max(2_000),
		language: z.string().min(1).max(32).default("text"),
	})
	.strict();

export const workflowTaskSchema = z
	.object({
		task_id: z.string().min(1).max(128),
		name: z.string().min(1).max(256),
		type: z.enum(["start", "task", "decision", "terminal", "subprocess"]),
		responsible: z.string().max(256).optional(),
		handlers: z.array(workflowHandlerSchema).max(16).default([]),
		conditions: z.array(workflowConditionSchema).max(8).default([]),
		// Para decisoes: nomes das saidas esperadas
		branches: z.array(z.string().min(1).max(128)).max(8).optional(),
		// Indica se a tarefa requer anexo obrigatorio
		require_attachment: z.boolean().default(false),
	})
	.strict();

export const workflowTransitionSchema = z
	.object({
		from: z.string().min(1).max(128),
		to: z.string().min(1).max(128),
		type: z.enum(["success", "failure", "conditional", "timeout"]),
		condition_id: z.string().min(1).max(128).optional(),
		// Tempo limite em minutos; null = sem timeout
		timeout_minutes: z.number().int().min(1).max(10_080).optional(),
	})
	.strict();

export const workflowGraphSchema = z
	.object({
		graph_id: z.string().min(1).max(128),
		name: z.string().min(1).max(256),
		version: z.string().min(1).max(32).default("1.0"),
		target_release: z.string().regex(/^\d{4}$/),
		tasks: z.array(workflowTaskSchema).min(1).max(256),
		transitions: z.array(workflowTransitionSchema).max(512),
		terminal_states: z.array(z.string().min(1).max(128)).min(1).max(32),
	})
	.strict()
	.refine(
		(graph) => {
			// Deve haver exatamente um no start
			const starts = graph.tasks.filter((t) => t.type === "start");
			return starts.length === 1;
		},
		{ message: "grafo deve conter exatamente um no start" },
	)
	.refine(
		(graph) => {
			// Todos os terminal_states devem corresponder a nos do tipo terminal
			for (const ts of graph.terminal_states) {
				const task = graph.tasks.find((t) => t.task_id === ts);
				if (!task || task.type !== "terminal") return false;
			}
			return true;
		},
		{ message: "terminal_states devem referenciar nos do tipo terminal" },
	);
