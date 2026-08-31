import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserAgent, normalizeDevtoolsUrl } from "../src/browser-agent.js";
import { makeTools } from "../src/tools.js";

test("accepts only loopback Chrome DevTools endpoints", () => {
	assert.equal(normalizeDevtoolsUrl("http://127.0.0.1:9222/"), "http://127.0.0.1:9222");
	assert.equal(normalizeDevtoolsUrl("http://localhost:9222"), "http://localhost:9222");
	assert.throws(() => normalizeDevtoolsUrl("http://172.18.2.221:9222"), /somente localhost/);
	assert.throws(() => normalizeDevtoolsUrl("https://localhost:9222"), /deve usar http/);
});

test("lists pages without query strings", async () => {
	const agent = createBrowserAgent({
		browserUrl: "http://127.0.0.1:9222",
		fetchImpl: async () => ({
			ok: true,
			json: async () => [
				{ id: "page-1", type: "page", title: "AWC", url: "https://example.test/tc?token=secret#top" },
				{ id: "worker-1", type: "service_worker", title: "ignored", url: "https://example.test" },
			],
		}),
	});

	assert.deepEqual(await agent.pages(), [
		{ id: "page-1", title: "AWC", url: "https://example.test/tc", type: "page" },
	]);
});

test("exposes browser tools only when explicitly enabled", () => {
	const baseConfig = {
		allowWrite: false,
		allowDiagnostics: false,
		allowBrowserDiagnostics: false,
		readPaths: ["/approved"],
		writePaths: [],
		staging: "/staging",
		diagnosticHosts: ["localhost"],
		browserDevtoolsUrl: "http://127.0.0.1:9222",
	};
	assert.equal(makeTools(baseConfig).browser_status, undefined);
	assert.ok(makeTools({ ...baseConfig, allowBrowserDiagnostics: true }).browser_status);
	const protectedTools = makeTools({
		...baseConfig,
		allowBrowserDiagnostics: true,
		allowCapabilityTasks: true,
		enforceCapabilities: true,
		agentId: "agent-test",
		capabilityIssuer: "https://broker.example.test",
		capabilityPublicKey: "/keys/capability-public.pem",
	});
	assert.equal(protectedTools.browser_status, undefined);
	assert.ok(protectedTools.tc_authorized_task);
});
