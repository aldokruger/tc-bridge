import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createAdminConsoleApp } from "../src/zero-trust/admin-console.js";

function fakeBroker({ dispatched = [] } = {}) {
	const agents = new Map([
		["agent-a", { connected_at: new Date().toISOString() }],
	]);
	return {
		agents,
		pendingTasks: new Map(),
		listAgents: () =>
			[...agents.entries()].map(([agent_id, connection]) => ({
				agent_id,
				connected_at: connection.connected_at,
			})),
		pendingFor: () => [],
		listTasks: () => [],
		async dispatch(agentId, task) {
			if (!agents.has(agentId)) {
				throw new Error(`Agente indisponivel: ${agentId}`);
			}
			dispatched.push({ agentId, task });
			return { ok: true, note: "servico ativo" };
		},
	};
}

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

function deltaToolCall(id, name, argumentsText, { finish = false } = {}) {
	const toolCalls = [];
	if (id)
		toolCalls.push({ index: 0, id, function: { name: name.slice(0, 1) } });
	if (name.length > 1)
		toolCalls.push({ index: 0, function: { name: name.slice(1) } });
	if (argumentsText)
		toolCalls.push({ index: 0, function: { arguments: argumentsText } });
	return {
		choices: [
			{
				delta: { tool_calls: toolCalls },
				finish_reason: finish ? "tool_calls" : null,
			},
		],
	};
}

// Sobrescreve o fetch global (usado pelo orquestrador de chat) com respostas
// em sequencia e devolve os registros de chamada para assercao. Somente URLs
// de /chat/completions (provedor LLM) sao interceptadas; chamadas HTTP ao
// proprio console passam pelo fetch original.
function stubFetch(responders) {
	const calls = [];
	const original = globalThis.fetch;
	let index = 0;
	globalThis.fetch = async (url, init) => {
		if (!String(url).endsWith("/chat/completions")) {
			return original(url, init);
		}
		calls.push({ url, init });
		const responder = responders[Math.min(index, responders.length - 1)];
		index += 1;
		if (typeof responder === "function") return responder();
		return completionResponse(responder);
	};
	return {
		calls,
		restore() {
			globalThis.fetch = original;
		},
	};
}

async function listen(app, t) {
	const server = await new Promise((resolve) => {
		const instance = app.listen(0, "127.0.0.1", () => resolve(instance));
	});
	t.after(() => new Promise((resolve) => server.close(resolve)));
	return `http://127.0.0.1:${server.address().port}`;
}

async function setupConsole(t, overrides = {}) {
	const dispatched = [];
	const keys = crypto.generateKeyPairSync("ed25519");
	const app = createAdminConsoleApp({
		adminToken: "admin-token-secreto",
		broker: fakeBroker({ dispatched }),
		issuer: "https://broker.example.test",
		privateKey: keys.privateKey,
		allowedActions: new Set([
			"browser.status",
			"diagnostic.run",
			"teamcenter.read", // umbrella, nao vira tool
		]),
		ttlSeconds: 60,
		...overrides,
	});
	const base = await listen(app, t);
	const login = await fetch(`${base}/v1/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "admin-token-secreto" }),
	});
	assert.equal(login.status, 200);
	const cookie = login.headers.get("set-cookie").split(";")[0];
	return { base, cookie, dispatched, app };
}

function chatBody(overrides = {}) {
	return {
		agent_id: "agent-a",
		llm: {
			base_url: "https://api.openai.com/v1",
			model: "gpt-4o-mini",
			api_key: "sk-test-123",
		},
		messages: [{ role: "user", content: "O agente esta ativo?" }],
		...overrides,
	};
}

// Consome o corpo SSE por completo e devolve os eventos JSON emitidos.
async function readSse(response) {
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffer += decoder.decode(value, { stream: true });
	}
	buffer += decoder.decode();
	const events = [];
	for (const block of buffer.split("\n\n")) {
		const line = block.trim();
		if (!line.startsWith("data:")) continue;
		const data = line.slice(5).trim();
		if (!data || data === "[DONE]") continue;
		events.push(JSON.parse(data));
	}
	return events;
}

test("login cria sessao; context expoe chat; rotas exigem sessao", async (t) => {
	const { base, cookie } = await setupConsole(t);

	const withoutCookie = await fetch(`${base}/v1/context`);
	assert.equal(withoutCookie.status, 401);

	const context = await fetch(`${base}/v1/context`, {
		headers: { cookie },
	});
	assert.equal(context.status, 200);
	const contextBody = await context.json();
	assert.equal(contextBody.features.chat, true);

	const wrongLogin = await fetch(`${base}/v1/login`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ token: "errado" }),
	});
	assert.equal(wrongLogin.status, 401);

	const health = await fetch(`${base}/v1/health`, { headers: { cookie } });
	assert.equal((await health.json()).agents_connected, 1);
});

test("guard de Origin bloqueia requisicao cross-site /v1", async (t) => {
	const { base, cookie } = await setupConsole(t);
	const response = await fetch(`${base}/v1/chat`, {
		method: "POST",
		headers: {
			cookie,
			origin: "https://evil.example",
			"content-type": "application/json",
		},
		body: JSON.stringify(chatBody()),
	});
	assert.equal(response.status, 403);
	assert.equal((await response.json()).error, "origem nao permitida");
});

test("/v1/chat valida o body e responde 400", async (t) => {
	const { base, cookie } = await setupConsole(t);
	const stub = stubFetch([[]]);
	try {
		const response = await fetch(`${base}/v1/chat`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify({ agent_id: "agent-a" }), // sem llm
		});
		assert.equal(response.status, 400);
	} finally {
		stub.restore();
	}
	assert.equal(
		stub.calls.length,
		0,
		"provedor nao deve ser chamado com body invalido",
	);
});

test("/v1/chat orquestra turno com tool e emite SSE ate end", async (t) => {
	const { base, cookie, dispatched } = await setupConsole(t);
	const stub = stubFetch([
		[deltaToolCall("call_http1", "browser_status", "{}", { finish: true })],
		[deltaContent("O Chrome de depuracao esta ativo."), deltaStop()],
	]);
	try {
		const response = await fetch(`${base}/v1/chat`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify(chatBody()),
		});
		assert.equal(response.status, 200);
		assert.equal(response.headers.get("content-type"), "text/event-stream");
		const events = await readSse(response);
		const types = events.map((event) => event.type);
		assert.ok(types.includes("token"), "texto chegou por SSE");
		assert.ok(types.includes("tool_call"), "tool call emitida");
		assert.ok(types.includes("tool_result"), "resultado da tool emitido");
		assert.equal(events.at(-1).type, "end");
	} finally {
		stub.restore();
	}

	assert.equal(dispatched.length, 1);
	assert.deepEqual(JSON.parse(dispatched[0].task.task_json), {
		action: "browser.status",
		parameters: {},
	});

	const audit = await (
		await fetch(`${base}/v1/audit`, { headers: { cookie } })
	).json();
	const auditEvents = audit.events.map((event) => event.event);
	assert.ok(auditEvents.includes("chat.start"));
	assert.ok(auditEvents.includes("chat.done"));
});

test("/v1/chat reporta erro do orquestrador via evento SSE error", async (t) => {
	const { base, cookie } = await setupConsole(t);
	const stub = stubFetch([[]]);
	try {
		const response = await fetch(`${base}/v1/chat`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify(chatBody({ agent_id: "agent-desconhecido" })),
		});
		const events = await readSse(response);
		const errors = events.filter((event) => event.type === "error");
		assert.equal(errors.length, 1);
		assert.match(errors[0].error, /Agente indisponivel/);
	} finally {
		stub.restore();
	}
	assert.equal(
		stub.calls.length,
		0,
		"sem agente, o provedor LLM nao e chamado",
	);
});

test("sirve a UI estatica com chat e responde 404 JSON fora de /v1", async (t) => {
	const { base, cookie } = await setupConsole(t);
	const index = await fetch(base + "/");
	assert.equal(index.status, 200);
	const html = await index.text();
	assert.match(
		html,
		/id="chat-suggestions"/,
		"HTML servido contem o painel de chat",
	);
	assert.match(html, /\/admin\/app\.js/);
	const app = await fetch(base + "/app.js");
	assert.match(app.headers.get("content-type"), /javascript/);
	assert.ok((await app.text()).includes("sendChatMessage"));
	const styles = await fetch(base + "/styles.css");
	assert.match(styles.headers.get("content-type"), /css/);
	const missing = await fetch(`${base}/v1/nao-existe`, { headers: { cookie } });
	assert.equal(missing.status, 404);
	assert.match((await missing.json()).error, /rota nao encontrada/);
});

test("/v1/chat aceita historico maior que 64kb (schema permite ate 100x100k)", async (t) => {
	const { base, cookie } = await setupConsole(t);
	const stub = stubFetch([[]]);
	try {
		const big = "x".repeat(40_000);
		const response = await fetch(`${base}/v1/chat`, {
			method: "POST",
			headers: { cookie, "content-type": "application/json" },
			body: JSON.stringify(
				chatBody({
					agent_id: "agent-desconhecido",
					messages: [
						{ role: "user", content: big },
						{ role: "assistant", content: big },
					],
				}),
			),
		});
		assert.equal(
			response.status,
			200,
			"corpo acima de 64kb nao deve ser rejeitado",
		);
		const events = await readSse(response);
		assert.ok(
			events.some(
				(event) =>
					event.type === "error" && /Agente indisponivel/.test(event.error),
			),
		);
	} finally {
		stub.restore();
	}
	assert.equal(stub.calls.length, 0);
});

test("/v1/agents/:id/checks despacha capability para action allowlisted", async (t) => {
	const { base, cookie, dispatched } = await setupConsole(t);
	const response = await fetch(`${base}/v1/agents/agent-a/checks`, {
		method: "POST",
		headers: { cookie, "content-type": "application/json" },
		body: JSON.stringify({
			action: "browser.status",
			parameters: {},
		}),
	});
	assert.equal(response.status, 200);
	const body = await response.json();
	assert.equal(body.ok, true);
	assert.equal(body.result.ok, true);
	assert.equal(dispatched.length, 1);
	assert.equal(dispatched[0].agentId, "agent-a");
	assert.deepEqual(JSON.parse(dispatched[0].task.task_json), {
		action: "browser.status",
		parameters: {},
	});
});

test("/v1/agents/:id/checks nega action fora da allowlist sem despachar", async (t) => {
	const { base, cookie, dispatched } = await setupConsole(t);
	const response = await fetch(`${base}/v1/agents/agent-a/checks`, {
		method: "POST",
		headers: { cookie, "content-type": "application/json" },
		body: JSON.stringify({
			action: "database.write", // nao esta na allowlist do console
			parameters: {},
		}),
	});
	assert.equal(response.status, 403);
	assert.match(
		(await response.json()).error,
		/acao nao permitida pela allowlist/,
	);
	assert.equal(dispatched.length, 0);
});

test("/v1/agents/:id/checks mapeia falha de dispatch para 502", async (t) => {
	const { base, cookie } = await setupConsole(t);
	const response = await fetch(`${base}/v1/agents/agent-offline/checks`, {
		method: "POST",
		headers: { cookie, "content-type": "application/json" },
		body: JSON.stringify({ action: "browser.status", parameters: {} }),
	});
	assert.equal(response.status, 502);
	assert.match((await response.json()).error, /Agente indisponivel/);
});
