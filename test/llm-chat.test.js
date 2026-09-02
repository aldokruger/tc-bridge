import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
	buildChatTools,
	DEFAULT_MAX_ROUNDS,
	runChatTurn,
} from "../src/zero-trust/llm-chat.js";

const ALLOWED = new Set([
	"browser.status",
	"browser.pages",
	"database.diagnostic",
	"diagnostic.run",
	"teamcenter.logs.read",
	"teamcenter.read", // umbrella: nao deve virar tool
]);

function testKeys() {
	return crypto.generateKeyPairSync("ed25519");
}

// Fake broker: agents.get sinaliza presenca; dispatch captura a capability e
// devolve um resultado arbitrario (como o agente faria).
function fakeBroker(dispatched, result = { ok: true, note: "servico ativo" }) {
	return {
		agents: {
			get: (id) =>
				id === "agent-a"
					? { connected_at: new Date().toISOString() }
					: undefined,
		},
		async dispatch(agentId, task) {
			dispatched.push({ agentId, task });
			return result;
		},
	};
}

// Converte o payload SSE (nao streaming de verdade) em uma Response com body.
// O orquestrador le o corpo via getReader() e interpreta linhas "data:".
function completionResponse(events) {
	const payload =
		events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
		"data: [DONE]\n\n";
	return new Response(payload, {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

function deltaContent(text) {
	return { choices: [{ delta: { content: text }, finish_reason: null }] };
}

function deltaStop() {
	return { choices: [{ delta: {}, finish_reason: "stop" }] };
}

// Uma tool call fragmentada em varios chunks SSE (como provedores reais enviam).
function deltaToolCall(id, name, argumentsText, { finish = false } = {}) {
	const toolCalls = [];
	const push = (piece, i) => toolCalls.push({ index: 0, ...piece });
	if (id) push({ id, function: { name: name.slice(0, 1) } }, 0);
	if (name.length > 1) push({ function: { name: name.slice(1) } }, 0);
	if (argumentsText) push({ function: { arguments: argumentsText } }, 0);
	return {
		choices: [
			{
				delta: { tool_calls: toolCalls },
				finish_reason: finish ? "tool_calls" : null,
			},
		],
	};
}

// Stub do fetch global: responde por chamada em sequencia. Registra cada
// chamada (url, headers, body parseado) para assercoes.
function stubFetch(responders) {
	const calls = [];
	const original = globalThis.fetch;
	let index = 0;
	globalThis.fetch = async (url, init) => {
		const callIndex = index;
		index += 1;
		calls.push({ url, init });
		const responder = responders[Math.min(callIndex, responders.length - 1)];
		if (!responder) {
			throw new Error(`fetch inesperado #${callIndex} para ${url}`);
		}
		if (typeof responder === "function") return responder(callIndex, url, init);
		return completionResponse(responder);
	};
	return {
		calls,
		restore() {
			globalThis.fetch = original;
		},
	};
}

function baseChatConfig(overrides = {}) {
	return {
		broker: fakeBroker([]),
		agentId: "agent-a",
		allowedActions: ALLOWED,
		issuer: "https://broker.example.test",
		privateKey: testKeys().privateKey,
		subject: "admin-console-test",
		ttlSeconds: 60,
		llm: {
			base_url: "https://api.openai.com/v1",
			model: "gpt-4o-mini",
			api_key: "sk-test-123",
		},
		messages: [{ role: "user", content: "O agente esta ativo?" }],
		...overrides,
	};
}

test("buildChatTools converte a allowlist em tools OpenAI, sem umbrella", () => {
	const tools = buildChatTools(ALLOWED);
	const names = tools.map((tool) => tool.function.name);
	assert.deepEqual(names, [
		"browser_pages",
		"browser_status",
		"database_diagnostic",
		"diagnostic_run",
		"teamcenter_logs_read",
	]);
	const browserStatus = tools.find((t) => t.function.name === "browser_status");
	assert.equal(
		browserStatus.function.parameters.properties.page_id,
		undefined,
		"browser.status nao tem parametros",
	);
	const logs = tools.find((t) => t.function.name === "teamcenter_logs_read");
	assert.ok(
		logs.function.parameters.properties.operation,
		"schema especifico preservado",
	);
});

test("buildChatTools usa schema generico para action desconhecida", () => {
	const tools = buildChatTools(new Set(["custom.thing"]));
	assert.equal(tools[0].function.name, "custom_thing");
	assert.equal(tools[0].function.parameters.additionalProperties, true);
});

test("runChatTurn responde sem tools e emite token/done em SSE", async () => {
	const events = [];
	const stub = stubFetch([
		[deltaContent("Sim, o agente esta "), deltaContent("ativo."), deltaStop()],
	]);
	try {
		const result = await runChatTurn({
			...baseChatConfig(),
			onEvent: (event) => events.push(event),
		});
		assert.equal(result.content, "Sim, o agente esta ativo.");
		assert.equal(result.rounds, 1);
		assert.deepEqual(
			events
				.filter((e) => e.type === "token")
				.map((e) => e.text)
				.join(""),
			"Sim, o agente esta ativo.",
		);
		assert.equal(events.at(-1).type, "done");
		assert.equal(events.at(-1).content, "Sim, o agente esta ativo.");
	} finally {
		stub.restore();
	}

	const [first] = stub.calls;
	assert.equal(first.url, "https://api.openai.com/v1/chat/completions");
	assert.equal(first.init.headers.Authorization, "Bearer sk-test-123");
	const body = JSON.parse(first.init.body);
	assert.equal(body.stream, true);
	assert.equal(body.model, "gpt-4o-mini");
	assert.equal(body.messages[0].role, "system");
	assert.equal(body.messages.at(-1).role, "user");
	assert.ok(
		body.tools.some((t) => t.function.name === "browser_status"),
		"tools da allowlist presentes no body",
	);
});

test("runChatTurn despacha capability ao agente quando a LLM chama tool", async () => {
	const dispatched = [];
	const events = [];
	const broker = fakeBroker(dispatched, { status: "ok", pages: [] });
	const stub = stubFetch([
		[deltaToolCall("call_ab12", "browser_status", "{}", { finish: true })],
		[deltaContent("O Chrome de depuracao esta ativo."), deltaStop()],
	]);
	try {
		const result = await runChatTurn({
			...baseChatConfig({ broker }),
			onEvent: (event) => events.push(event),
		});
		assert.equal(result.content, "O Chrome de depuracao esta ativo.");
		assert.equal(result.rounds, 2);
	} finally {
		stub.restore();
	}

	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0].agentId, "agent-a");
	const task = dispatched[0].task;
	assert.ok(
		typeof task.capability === "string" &&
			task.capability.split(".").length === 3,
	);
	assert.deepEqual(JSON.parse(task.task_json), {
		action: "browser.status",
		parameters: {},
	});
	const toolEvents = events.filter((e) => e.type === "tool_call");
	assert.equal(toolEvents[0].name, "browser_status");
	const toolResults = events.filter((e) => e.type === "tool_result");
	assert.equal(toolResults[0].ok, true);

	const secondBody = JSON.parse(stub.calls[1].init.body);
	const toolMessage = secondBody.messages.find((m) => m.role === "tool");
	assert.equal(toolMessage.tool_call_id, "call_ab12");
	assert.ok(
		toolMessage.content.includes('"status":"ok"'),
		"resultado do agente na conversa",
	);
});

test("runChatTurn rejeita tool fora da allowlist sem despachar ao agente", async () => {
	const dispatched = [];
	const broker = fakeBroker(dispatched);
	const stub = stubFetch([
		[
			deltaToolCall("call_x", "database_write", '{"sql":"DROP"}', {
				finish: true,
			}),
		],
		[deltaContent("Nao posso executar essa acao."), deltaStop()],
	]);
	try {
		const result = await runChatTurn({ ...baseChatConfig({ broker }) });
		assert.equal(result.content, "Nao posso executar essa acao.");
	} finally {
		stub.restore();
	}
	assert.equal(
		dispatched.length,
		0,
		"nada despachado para acao fora da allowlist",
	);
	const body = stub.calls[1].init.body;
	const toolMessages = JSON.parse(body).messages.filter(
		(m) => m.role === "tool",
	);
	assert.match(
		toolMessages[0].content,
		/ERRO: acao nao permitida pela allowlist/,
	);
});

test("runChatTurn exige api_key da LLM", async () => {
	const stub = stubFetch([[]]);
	try {
		await assert.rejects(
			runChatTurn({
				...baseChatConfig(),
				llm: {
					base_url: "https://api.openai.com/v1",
					model: "gpt-4o-mini",
					api_key: "",
				},
			}),
			/api_key da LLM e obrigatoria/,
		);
	} finally {
		stub.restore();
	}
	assert.equal(stub.calls.length, 0, "nenhuma chamada ao provedor");
});

test("runChatTurn recusa agente indisponivel", async () => {
	const broker = fakeBroker([]);
	const stub = stubFetch([[]]);
	try {
		await assert.rejects(
			runChatTurn({ ...baseChatConfig({ broker, agentId: "agent-offline" }) }),
			/Agente indisponivel: agent-offline/,
		);
	} finally {
		stub.restore();
	}
	assert.equal(stub.calls.length, 0);
});

test("runChatTurn propaga erro HTTP do provedor LLM", async () => {
	const stub = stubFetch([
		() => new Response("invalid api key", { status: 401 }),
	]);
	try {
		await assert.rejects(
			runChatTurn(baseChatConfig()),
			/LLM upstream HTTP 401: invalid api key/,
		);
	} finally {
		stub.restore();
	}
});

test("runChatTurn interrompe ao atingir o limite de rodadas de tools", async () => {
	const dispatched = [];
	const broker = fakeBroker(dispatched, { ok: true });
	const toolChunks = [
		deltaToolCall("call_loop", "browser_status", "{}", { finish: true }),
	];
	const responders = Array.from(
		{ length: DEFAULT_MAX_ROUNDS + 1 },
		() => toolChunks,
	);
	const stub = stubFetch(responders);
	try {
		await assert.rejects(
			runChatTurn({ ...baseChatConfig({ broker }) }),
			new RegExp(
				`Limite de ${DEFAULT_MAX_ROUNDS} rodadas de ferramentas atingido`,
			),
		);
	} finally {
		stub.restore();
	}
	assert.equal(dispatched.length, DEFAULT_MAX_ROUNDS);
});
