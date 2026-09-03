// Orquestrador de chat do console admin: conversa com uma LLM OpenAI-compatible
// e, quando ela decide chamar uma ferramenta, despacha uma capability ao agente
// conectado e devolve o resultado para a LLM continuar.
//
// A chave da API da LLM chega por request (HTTPS do console), fica somente na
// memoria durante o request e nunca vai a disco nem a logs. Nenhuma chamada ao
// provedor parte do navegador: o broker faz o papel de proxy/orquestrador.

const DEFAULT_MAX_ROUNDS = 8;
const RESULT_MAX_CHARS = 20_000;
const UPSTREAM_TIMEOUT_MS = 120_000;

// Normaliza a base URL para o endpoint /chat/completions.
// Aceita "https://api.openai.com/v1", ".../v1/" ou a URL completa.
function chatCompletionsUrl(baseUrl) {
	const trimmed = String(baseUrl ?? "")
		.trim()
		.replace(/\/+$/, "");
	if (!trimmed) throw new Error("base_url e obrigatorio");
	if (trimmed.endsWith("/chat/completions")) return trimmed;
	return `${trimmed.replace(/\/v1$/, "")}/v1/chat/completions`;
}

// Schemas das tools que o LLM enxerga. Somente leitura, espelhando as actions
// allowlisted do broker; o agente revalida tudo na execucao (deny-by-default).
const ACTION_TOOL_SCHEMAS = {
	"browser.status": {
		description:
			"Confirma o Chrome local do agente em depuracao remota. Nao acessa cookies, storage ou dados de login.",
		parameters: { type: "object", properties: {} },
	},
	"browser.pages": {
		description:
			"Lista as paginas Chrome depuraveis abertas no agente, sem query string, cookies ou corpos de requisicao.",
		parameters: { type: "object", properties: {} },
	},
	"browser.capture_diagnostics": {
		description:
			"Captura por periodo curto (maximo 15s) eventos novos de Console e Network de uma pagina Chrome do agente.",
		parameters: {
			type: "object",
			properties: {
				page_id: {
					type: "string",
					description: "ID da pagina (da action browser.pages)",
				},
				capture_ms: {
					type: "number",
					minimum: 100,
					maximum: 15000,
					description: "Duracao da captura em ms (padrao 5000).",
				},
			},
		},
	},
	"browser.performance": {
		description:
			"Retorna metricas Performance CDP da pagina Chrome do agente. Somente leitura.",
		parameters: {
			type: "object",
			properties: {
				page_id: {
					type: "string",
					description: "ID da pagina (da action browser.pages)",
				},
			},
		},
	},
	"diagnostic.run": {
		description:
			"Executa um diagnostico de host predefinido no agente: path_exists, service_status ou tcp_connect. Nao aceita comandos arbitrarios.",
		parameters: {
			type: "object",
			properties: {
				check: {
					type: "string",
					enum: ["path_exists", "service_status", "tcp_connect"],
					description: "Tipo de verificacao.",
				},
				remote_path: {
					type: "string",
					description:
						"Obrigatorio para path_exists; caminho dentro da whitelist do agente.",
				},
				service_name: {
					type: "string",
					description:
						"Obrigatorio para service_status; nome do servico Windows.",
				},
				host: {
					type: "string",
					description:
						"Obrigatorio para tcp_connect; host na whitelist de diagnostico do agente.",
				},
				port: {
					type: "number",
					description: "Obrigatorio para tcp_connect; porta 1-65535.",
				},
			},
		},
	},
	"database.diagnostic": {
		description:
			"Executa um diagnostico MSSQL predefinido e somente leitura no agente: database_files, waits, active_requests, expensive_queries ou index_health. Nao aceita SQL arbitrario.",
		parameters: {
			type: "object",
			properties: {
				check: {
					type: "string",
					enum: [
						"database_files",
						"waits",
						"active_requests",
						"expensive_queries",
						"index_health",
					],
				},
				limit: {
					type: "number",
					description: "Limite de linhas (padrao do agente).",
				},
			},
		},
	},
	"teamcenter.logs.read": {
		description:
			"Inspeciona logs Teamcenter no agente: list (arquivos .log), tail (final de um arquivo) ou search (busca por padrao). Somente leitura, com limites e mascaramento de segredos.",
		parameters: {
			type: "object",
			properties: {
				operation: {
					type: "string",
					enum: ["list", "tail", "search"],
					description: "Operacao desejada.",
				},
				relative_path: {
					type: "string",
					description:
						"Obrigatorio para tail; caminho relativo dentro da pasta de logs permitida.",
				},
				pattern: {
					type: "string",
					description:
						"Obrigatorio para search; regex de busca (maximo 120 chars).",
				},
				file_glob: {
					type: "string",
					description: "Glob para list/search (padrao *.log).",
				},
				max_lines: {
					type: "number",
					description: "Limite de linhas (padrao do agente).",
				},
				max_files: {
					type: "number",
					description: "Limite de arquivos (padrao do agente).",
				},
				max_matches: {
					type: "number",
					description: "Limite de correspondencias (padrao do agente).",
				},
			},
		},
	},
};

const GENERIC_TOOL_SCHEMA = {
	description:
		"Executa uma acao permitida no agente Teamcenter. Confirme os parametros exatos com o agente antes de chamar.",
	parameters: {
		type: "object",
		additionalProperties: true,
		description: "Parametros validados pelo agente no momento da execucao.",
	},
};

export function buildChatTools(allowedActions) {
	return [...allowedActions]
		.sort()
		.filter((action) => action !== "teamcenter.read") // umbrella; agente usa granulares
		.map((action) => {
			const spec = ACTION_TOOL_SCHEMAS[action] || GENERIC_TOOL_SCHEMA;
			return {
				type: "function",
				function: {
					name: action.replaceAll(".", "_"),
					description: spec.description,
					parameters: spec.parameters,
				},
			};
		});
}

const SYSTEM_PROMPT = `Voce e o assistente do console administrativo de um broker de agentes Teamcenter.
O usuario conversa com voce e pode pedir acoes no agente Windows conectado (leitura de logs,
diagnosticos de host/banco, status de navegador AWC, consultas SOA). Use as ferramentas
disponiveis somente quando a acao for claramente solicitada ou necessaria para responder.
Nunca invente resultados: se a ferramenta falhar ou retornar erro, reporte o erro fielmente.
Toda ferramenta e somente leitura e limitada pela allowlist do broker. Responda em portugues
do Brasil, de forma objetiva. Prefira informacoes retornadas pelas ferramentas a suposicoes.`;

function toProviderMessage(message) {
	if (message.role === "user")
		return { role: "user", content: String(message.content) };
	if (message.role === "assistant")
		return { role: "assistant", content: String(message.content ?? "") };
	return null;
}

function truncateResult(value) {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	if (text.length <= RESULT_MAX_CHARS) return text;
	return `${text.slice(0, RESULT_MAX_CHARS)}\n... (resultado truncado)`;
}

// Executa UMA chamada (com streaming) e devolve a mensagem acumulada.
// Emite eventos "token" conforme o texto chega.
async function streamCompletion({ url, apiKey, model, body, signal, onToken }) {
	const controller = new AbortController();
	const abort = () => controller.abort();
	signal?.addEventListener("abort", abort, { once: true });
	const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
			},
			body: JSON.stringify({ ...body, stream: true }),
			signal: controller.signal,
		});
		if (!response.ok || !response.body) {
			const errorText = await response.text().catch(() => "");
			throw new Error(
				`LLM upstream HTTP ${response.status}: ${errorText.slice(0, 300) || response.statusText}`,
			);
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		// tool_calls acumuladas por indice durante o stream.
		const toolCalls = [];
		let content = "";
		let finishReason = null;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const rawLine of lines) {
				const line = rawLine.trim();
				if (!line.startsWith("data:")) continue;
				const data = line.slice(5).trim();
				if (data === "[DONE]") continue;
				let chunk;
				try {
					chunk = JSON.parse(data);
				} catch {
					continue;
				}
				const choice = chunk.choices?.[0];
				if (!choice) continue;
				const delta = choice.delta ?? {};
				if (delta.content) {
					content += delta.content;
					onToken?.(delta.content);
				}
				for (const call of delta.tool_calls ?? []) {
					const index = call.index ?? 0;
					toolCalls[index] ??= {
						id: null,
						type: "function",
						function: { name: "", arguments: "" },
					};
					if (call.id) toolCalls[index].id = call.id;
					if (call.function?.name)
						toolCalls[index].function.name += call.function.name;
					if (call.function?.arguments) {
						toolCalls[index].function.arguments += call.function.arguments;
					}
				}
				if (choice.finish_reason) finishReason = choice.finish_reason;
			}
		}
		const message = { role: "assistant", content: content || null };
		const validToolCalls = toolCalls.filter(
			(call) => call?.function?.name && call.id,
		);
		if (validToolCalls.length > 0) {
			message.tool_calls = validToolCalls.map((call) => ({
				...call,
				function: {
					name: call.function.name,
					arguments: call.function.arguments || "{}",
				},
			}));
		}
		return { message, finishReason };
	} finally {
		clearTimeout(timeout);
		signal?.removeEventListener("abort", abort);
	}
}

// Converte a action "browser.status" no nome da tool OpenAI "browser_status".
function actionToToolName(action) {
	return action.replaceAll(".", "_");
}

// Roda o turno de chat: loop LLM <-> dispatch. Emite eventos de progresso via onEvent.
// Quando toolRegistry e fornecido, usa-o para listar e executar tools (locais ou remotas).
// Caso contrario, mantem o comportamento legado por compatibilidade (plano, secao 7.1).
export async function runChatTurn({
	broker,
	agentId,
	allowedActions,
	issuer,
	privateKey,
	subject,
	ttlSeconds,
	llm,
	messages,
	signal,
	onEvent,
	toolRegistry,
}) {
	const { base_url: baseUrl, model, api_key: apiKey } = llm ?? {};
	if (!baseUrl || !model) {
		throw new Error(
			"configuracao da LLM incompleta: base_url e model sao obrigatorios",
		);
	}
	if (!apiKey) {
		throw new Error("api_key da LLM e obrigatoria para o chat");
	}
	if (!broker.agents.get(agentId)) {
		throw new Error(`Agente indisponivel: ${agentId}`);
	}
	const tools = toolRegistry
		? toolRegistry.list()
		: buildChatTools(allowedActions);
	const providerMessages = [];
	for (const message of messages) {
		const mapped = toProviderMessage(message);
		if (mapped) providerMessages.push(mapped);
	}
	const url = chatCompletionsUrl(baseUrl);
	const { createCapabilityTask } = await import("./cloud-mcp.js");
	const dispatchTool = async (toolName, rawArguments) => {
		if (toolRegistry) {
			return toolRegistry.execute({
				name: toolName,
				arguments: rawArguments,
				executionContext: { agentId, broker },
			});
		}
		const action = [...allowedActions].find(
			(candidate) => actionToToolName(candidate) === toolName,
		);
		if (!action)
			throw new Error(
				`acao nao permitida pela allowlist do broker: ${toolName}`,
			);
		let parameters = {};
		if (rawArguments) {
			try {
				parameters = JSON.parse(rawArguments);
			} catch {
				parameters = { _raw: String(rawArguments) };
			}
		}
		const task = createCapabilityTask({
			agentId,
			action,
			parameters,
			issuer,
			privateKey,
			subject,
			ttlSeconds,
		});
		return broker.dispatch(agentId, task);
	};

	let round = 0;
	const fullMessages = [
		{ role: "system", content: SYSTEM_PROMPT },
		...providerMessages,
	];
	while (round < DEFAULT_MAX_ROUNDS) {
		round += 1;
		const body = { model, messages: fullMessages, tools };
		if (tools.length === 0) delete body.tools;
		const { message } = await streamCompletion({
			url,
			apiKey,
			model,
			body,
			signal,
			onToken: (text) => onEvent?.({ type: "token", text }),
		});
		if (!message) throw new Error("LLM nao retornou resposta");
		fullMessages.push(message);
		if (!message.tool_calls || message.tool_calls.length === 0) {
			onEvent?.({ type: "done", content: message.content ?? "" });
			return { content: message.content ?? "", rounds: round };
		}
		for (const call of message.tool_calls) {
			const toolName = call.function.name;
			onEvent?.({
				type: "tool_call",
				name: toolName,
				arguments: call.function.arguments,
			});
			try {
				const result = await dispatchTool(toolName, call.function.arguments);
				const text = truncateResult(result);
				fullMessages.push({
					role: "tool",
					tool_call_id: call.id,
					content: text,
				});
				onEvent?.({ type: "tool_result", name: toolName, ok: true });
			} catch (error) {
				const errorText = error.message;
				fullMessages.push({
					role: "tool",
					tool_call_id: call.id,
					content: `ERRO: ${errorText}`,
				});
				onEvent?.({
					type: "tool_result",
					name: toolName,
					ok: false,
					error: errorText,
				});
			}
		}
		// Se a LLM chamou tools mas nao produziu texto, forcamos continuacao.
		if (message.tool_calls.length > 0 && !message.content) {
			fullMessages.push({
				role: "user",
				content:
					"Continue com base nos resultados das ferramentas. Se algum erro ocorreu, explique-o. Responda em portugues.",
			});
		}
	}
	throw new Error(
		`Limite de ${DEFAULT_MAX_ROUNDS} rodadas de ferramentas atingido`,
	);
}

export const QUICK_ACTIONS = [
	{
		id: "agent-status",
		label: "Status do agente",
		prompt:
			"Verifique o status do agente conectado, liste as paginas Chrome abertas e retorne um resumo do estado atual",
	},
	{
		id: "host-diagnostics",
		label: "Diagnostico host",
		prompt:
			"Execute diagnosticos de host: path_exists em D:\\upgrade, service_status do Teamcenter, e tcp_connect no banco de dados. Resuma os resultados",
	},
	{
		id: "list-logs",
		label: "Listar logs",
		prompt:
			"Liste os logs disponiveis no agente, mostre as ultimas 50 linhas do log mais recente e identifique erros",
	},
	{
		id: "soa-query",
		label: "Consultar SOA",
		prompt:
			"Execute preflight e connection_health no Teamcenter. Se houver erros, explique o que esta acontecendo",
	},
	{
		id: "search-docs",
		label: "Buscar docs",
		prompt:
			"Busque na documentacao sobre configuracao de preferencias Teamcenter e retorne um resumo",
	},
];

export const WORKFLOWS = [
	{
		id: "upgrade-check",
		label: "Verificacao de upgrade",
		description: "Verifica pre-requisitos: diretorios, logs, banco e SOA",
		steps: [
			{
				tool: "diagnostic_run",
				params: { check: "path_exists", remote_path: "D:\\upgrade" },
			},
			{ tool: "teamcenter_logs_read", params: { operation: "list" } },
			{ tool: "database_diagnostic", params: { check: "database_files" } },
			{ tool: "teamcenter_soa_preflight", params: {} },
		],
	},
	{
		id: "full-diagnostics",
		label: "Diagnostico completo",
		description: "Executa todos os diagnosticos disponiveis",
		steps: [
			{
				tool: "diagnostic_run",
				params: { check: "path_exists", remote_path: "D:\\upgrade" },
			},
			{
				tool: "diagnostic_run",
				params: { check: "service_status", service_name: "Teamcenter" },
			},
			{ tool: "database_diagnostic", params: { check: "database_files" } },
			{ tool: "database_diagnostic", params: { check: "waits" } },
			{ tool: "teamcenter_logs_read", params: { operation: "list" } },
		],
	},
	{
		id: "soa-health",
		label: "Health check SOA",
		description: "Verifica saude completa do Teamcenter SOA",
		steps: [
			{ tool: "teamcenter_soa_preflight", params: {} },
			{ tool: "teamcenter_soa_connection_health", params: {} },
			{ tool: "teamcenter_soa_session_context", params: {} },
		],
	},
];

const CONTEXT_MEMORY_MAX = 10;
const contextMemory = new Map();

export function getContextMemory(agentId) {
	return contextMemory.get(agentId) || [];
}

export function setContextMemory(agentId, toolName, result) {
	if (!contextMemory.has(agentId)) contextMemory.set(agentId, []);
	const entries = contextMemory.get(agentId);
	entries.push({ tool: toolName, result, at: Date.now() });
	if (entries.length > CONTEXT_MEMORY_MAX) entries.shift();
}

export async function executeWorkflow({
	workflow,
	agentId,
	dispatchTool,
	onEvent,
}) {
	const results = [];
	for (let i = 0; i < workflow.steps.length; i++) {
		const step = workflow.steps[i];
		onEvent?.({
			type: "workflow_step",
			step: i + 1,
			total: workflow.steps.length,
			tool: step.tool,
		});
		try {
			const result = await dispatchTool(
				step.tool,
				JSON.stringify(step.params ?? {}),
			);
			results.push({ tool: step.tool, ok: true, result });
			setContextMemory(agentId, step.tool, result);
		} catch (error) {
			results.push({ tool: step.tool, ok: false, error: error.message });
		}
	}
	return results;
}

export { DEFAULT_MAX_ROUNDS };
