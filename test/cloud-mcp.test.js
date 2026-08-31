import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { createCapabilityTask, isAuthorizedRequest } from "../src/zero-trust/cloud-mcp.js";
import { verifyCapability } from "../src/zero-trust/capability.js";

test("creates a bounded capability task for a connected agent", () => {
	const keys = crypto.generateKeyPairSync("ed25519");
	const task = createCapabilityTask({
		agentId: "agent-test",
		action: "browser.capture_diagnostics",
		parameters: { page_id: "page-1", capture_ms: 1_000 },
		issuer: "https://broker.example.test",
		privateKey: keys.privateKey,
		subject: "codex-test",
		ttlSeconds: 60,
	});
	const claims = verifyCapability(task.capability, {
		publicKey: keys.publicKey,
		agentId: "agent-test",
		issuer: "https://broker.example.test",
	});
	assert.equal(claims.scope.page_id, "page-1");
	assert.equal(claims.scope.max_capture_ms, 1_000);
	assert.deepEqual(JSON.parse(task.task_json), {
		action: "browser.capture_diagnostics",
		parameters: { page_id: "page-1", capture_ms: 1_000 },
	});
});

test("requires the exact bearer token for the broker MCP API", () => {
	assert.equal(isAuthorizedRequest("", "api-token"), false);
	assert.equal(isAuthorizedRequest("Bearer wrong-token", "api-token"), false);
	assert.equal(isAuthorizedRequest("Bearer api-token", "api-token"), true);
});
