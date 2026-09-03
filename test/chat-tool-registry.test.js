import assert from "node:assert/strict";
import test from "node:test";
import { createAgentActionAdapter } from "../src/chat-tools/agent-action-adapter.js";
import { createLocalToolAdapter } from "../src/chat-tools/local-tool-adapter.js";
import { createChatToolRegistry } from "../src/chat-tools/registry.js";

function fakeLocalAdapter() {
	return createLocalToolAdapter({
		tools: [
			{
				name: "tc_documentation_search",
				description: "Busca docs",
				parameters: { type: "object", properties: {} },
				handler: async () => ({ ok: true, source: "local" }),
			},
		],
	});
}

function fakeAgentAdapter() {
	const allowed = new Set(["browser_status"]);
	return {
		kind: "agent",
		async execute({ name }) {
			if (!allowed.has(name)) {
				throw new Error(`acao nao permitida: ${name}`);
			}
			return { ok: true, source: "agent", name };
		},
	};
}

test("list retorna tools locais e remotas quando allowlisted", () => {
	const registry = createChatToolRegistry({
		localAdapter: fakeLocalAdapter(),
		agentAdapter: fakeAgentAdapter(),
	});
	const tools = registry.list({
		allowedAgentActions: new Set(["browser.status"]),
		allowedLocalTools: new Set(["tc_documentation_search"]),
	});
	const names = tools.map((t) => t.function.name);
	assert.ok(names.includes("tc_documentation_search"));
	assert.ok(names.includes("browser_status"));
});

test("list nao expoe tool local fora da allowlist", () => {
	const registry = createChatToolRegistry({
		localAdapter: fakeLocalAdapter(),
		agentAdapter: fakeAgentAdapter(),
	});
	const tools = registry.list({
		allowedAgentActions: new Set(),
		allowedLocalTools: new Set(),
	});
	assert.equal(tools.length, 0);
});

test("execute roteia tool local para localAdapter", async () => {
	const registry = createChatToolRegistry({
		localAdapter: fakeLocalAdapter(),
		agentAdapter: fakeAgentAdapter(),
	});
	const result = await registry.execute({
		name: "tc_documentation_search",
		arguments: "{}",
		executionContext: {},
	});
	assert.equal(result.source, "local");
});

test("execute roteia tool remota para agentAdapter", async () => {
	const registry = createChatToolRegistry({
		localAdapter: fakeLocalAdapter(),
		agentAdapter: fakeAgentAdapter(),
	});
	const result = await registry.execute({
		name: "browser_status",
		arguments: "{}",
		executionContext: {},
	});
	assert.equal(result.source, "agent");
});

test("execute rejeita tool desconhecida", async () => {
	const registry = createChatToolRegistry({
		localAdapter: fakeLocalAdapter(),
		agentAdapter: fakeAgentAdapter(),
	});
	await assert.rejects(
		registry.execute({
			name: "tool_inexistente",
			arguments: "{}",
			executionContext: {},
		}),
		/acao nao permitida|tool nao registrada/,
	);
});
