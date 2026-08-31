import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
	createBrowserAgent,
	normalizeDevtoolsUrl,
} from "../src/browser-agent.js";
import { makeTools } from "../src/tools.js";
import { signCapability } from "../src/zero-trust/capability.js";

test("accepts only loopback Chrome DevTools endpoints", () => {
	assert.equal(
		normalizeDevtoolsUrl("http://127.0.0.1:9222/"),
		"http://127.0.0.1:9222",
	);
	assert.equal(
		normalizeDevtoolsUrl("http://localhost:9222"),
		"http://localhost:9222",
	);
	assert.throws(
		() => normalizeDevtoolsUrl("http://172.18.2.221:9222"),
		/somente localhost/,
	);
	assert.throws(
		() => normalizeDevtoolsUrl("https://localhost:9222"),
		/deve usar http/,
	);
});

test("lists pages without query strings", async () => {
	const agent = createBrowserAgent({
		browserUrl: "http://127.0.0.1:9222",
		fetchImpl: async () => ({
			ok: true,
			json: async () => [
				{
					id: "page-1",
					type: "page",
					title: "AWC",
					url: "https://example.test/tc?token=secret#top",
				},
				{
					id: "worker-1",
					type: "service_worker",
					title: "ignored",
					url: "https://example.test",
				},
			],
		}),
	});

	assert.deepEqual(await agent.pages(), [
		{
			id: "page-1",
			title: "AWC",
			url: "https://example.test/tc",
			type: "page",
		},
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
	assert.ok(
		makeTools({ ...baseConfig, allowBrowserDiagnostics: true }).browser_status,
	);
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

test("executes protected browser tasks after direct tools are removed", async (t) => {
	const root = await fs.mkdtemp(
		path.join(os.tmpdir(), "tc-browser-capability-"),
	);
	t.after(() => fs.rm(root, { recursive: true, force: true }));

	const server = http.createServer((request, response) => {
		assert.equal(request.url, "/json/list");
		response.setHeader("content-type", "application/json");
		response.end(
			JSON.stringify([
				{
					id: "page-1",
					type: "page",
					title: "AWC",
					url: "https://example.test/tc",
				},
			]),
		);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	t.after(() => new Promise((resolve) => server.close(resolve)));
	const { port } = server.address();

	const keys = crypto.generateKeyPairSync("ed25519");
	const publicKeyPath = path.join(root, "capability-public.pem");
	await fs.writeFile(
		publicKeyPath,
		keys.publicKey.export({ type: "spki", format: "pem" }),
	);
	const tools = makeTools({
		allowWrite: false,
		allowDiagnostics: false,
		allowBrowserDiagnostics: true,
		allowCapabilityTasks: true,
		enforceCapabilities: true,
		readPaths: ["/approved"],
		writePaths: [],
		staging: "/staging",
		diagnosticHosts: ["localhost"],
		browserDevtoolsUrl: `http://127.0.0.1:${port}`,
		agentId: "agent-test",
		capabilityIssuer: "broker-test",
		capabilityPublicKey: publicKeyPath,
		auditLogPath: path.join(root, "audit.jsonl"),
	});
	const now = Math.floor(Date.now() / 1_000);
	const capability = signCapability(
		{
			iss: "broker-test",
			aud: "agent-test",
			sub: "user-test",
			action: "browser.pages",
			scope: {},
			iat: now - 1,
			exp: now + 60,
			jti: crypto.randomUUID(),
		},
		keys.privateKey,
	);

	const result = await tools.tc_authorized_task.run({
		capability,
		task_json: JSON.stringify({ action: "browser.pages", parameters: {} }),
	});
	assert.deepEqual(result.result, [
		{
			id: "page-1",
			title: "AWC",
			url: "https://example.test/tc",
			type: "page",
		},
	]);
});
