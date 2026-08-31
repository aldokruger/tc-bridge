import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { signCapability } from "../src/zero-trust/capability.js";
import { AuthorizedTaskRunner } from "../src/zero-trust/task-runner.js";

async function makeRunner(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "tc-zero-trust-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const keys = crypto.generateKeyPairSync("ed25519");
	const publicKeyPath = path.join(root, "capability-public.pem");
	await fs.writeFile(publicKeyPath, keys.publicKey.export({ type: "spki", format: "pem" }));
	return {
		privateKey: keys.privateKey,
		runner: new AuthorizedTaskRunner({
			agentId: "agent-test",
			issuer: "broker-test",
			publicKeyPath,
			auditLogPath: path.join(root, "audit.jsonl"),
			policy: { "browser.capture_diagnostics": true },
			handlers: {
				"browser.capture_diagnostics": async (parameters) => ({ captured: parameters.capture_ms }),
			},
		}),
	};
}

function claims(overrides = {}) {
	const now = Math.floor(Date.now() / 1_000);
	return {
		iss: "broker-test",
		aud: "agent-test",
		sub: "user-test",
		action: "browser.capture_diagnostics",
		scope: { page_id: "page-1", max_capture_ms: 5_000 },
		iat: now - 1,
		exp: now + 60,
		jti: crypto.randomUUID(),
		...overrides,
	};
}

test("executes an in-scope signed capability and creates audit events", async (t) => {
	const { privateKey, runner } = await makeRunner(t);
	const capability = signCapability(claims(), privateKey);
	const result = await runner.run({
		capability,
		task_json: JSON.stringify({
			action: "browser.capture_diagnostics",
			parameters: { page_id: "page-1", capture_ms: 1_000 },
		}),
	});
	assert.equal(result.result.captured, 1_000);
	assert.match(result.audit_id, /^[0-9a-f-]{36}$/);
});

test("rejects replay, expired capabilities and out-of-scope parameters", async (t) => {
	const { privateKey, runner } = await makeRunner(t);
	const capability = signCapability(claims(), privateKey);
	const task = JSON.stringify({
		action: "browser.capture_diagnostics",
		parameters: { page_id: "page-1", capture_ms: 1_000 },
	});
	await runner.run({ capability, task_json: task });
	await assert.rejects(runner.run({ capability, task_json: task }), /ja foi utilizada/);

	const expired = signCapability(claims({ exp: Math.floor(Date.now() / 1_000) - 1 }), privateKey);
	await assert.rejects(runner.run({ capability: expired, task_json: task }), /expirada/);

	const scoped = signCapability(claims(), privateKey);
	await assert.rejects(
		runner.run({
			capability: scoped,
			task_json: JSON.stringify({
				action: "browser.capture_diagnostics",
				parameters: { page_id: "other-page", capture_ms: 1_000 },
			}),
		}),
		/fora do escopo/,
	);

	const untrustedIssuer = signCapability(claims({ iss: "other-broker" }), privateKey);
	await assert.rejects(runner.run({ capability: untrustedIssuer, task_json: task }), /origem nao confiavel/);
});
