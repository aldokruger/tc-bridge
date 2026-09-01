import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { signCapability } from "../src/zero-trust/capability.js";
import {
	AuthorizedTaskRunner,
	auditTelemetry,
} from "../src/zero-trust/task-runner.js";

async function makeRunner(t) {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "tc-zero-trust-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const keys = crypto.generateKeyPairSync("ed25519");
	const publicKeyPath = path.join(root, "capability-public.pem");
	await fs.writeFile(
		publicKeyPath,
		keys.publicKey.export({ type: "spki", format: "pem" }),
	);
	return {
		privateKey: keys.privateKey,
		auditLogPath: path.join(root, "audit.jsonl"),
		runner: new AuthorizedTaskRunner({
			agentId: "agent-test",
			issuer: "broker-test",
			publicKeyPath,
			auditLogPath: path.join(root, "audit.jsonl"),
			policy: { "browser.capture_diagnostics": true },
			handlers: {
				"browser.capture_diagnostics": async (parameters) => ({
					captured: parameters.capture_ms,
				}),
			},
		}),
	};
}

async function readAuditRecords(auditLogPath) {
	const content = await fs.readFile(auditLogPath, "utf8");
	return content
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line));
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

test("auditTelemetry extrai duracao, volume, truncation, warnings e partial errors", () => {
	const out = auditTelemetry({
		uid: "X",
		truncated: true,
		warnings: ["w1"],
		partial_errors: [{ code: "1", message: "m1" }],
		_meta: {
			action: "teamcenter.soa.object.inspect",
			correlationId: "aud_1",
			durationMs: 42,
		},
	});
	assert.equal(out.duration_ms, 42);
	assert.equal(out.correlation_id, "aud_1");
	assert.equal(out.truncated, true);
	assert.equal(out.partial_error_count, 1);
	assert.equal(out.warning_count, 1);
	assert.ok(out.volume_bytes > 0);
	assert.deepEqual(auditTelemetry(null), {});
	assert.deepEqual(auditTelemetry({ uid: "Y" }), { volume_bytes: 11 });
});

test("audit completed inclui telemetria do resultado e failed propaga error_code", async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "tc-zero-trust-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const keys = crypto.generateKeyPairSync("ed25519");
	const publicKeyPath = path.join(root, "capability-public.pem");
	await fs.writeFile(
		publicKeyPath,
		keys.publicKey.export({ type: "spki", format: "pem" }),
	);
	const auditLogPath = path.join(root, "audit.jsonl");
	const handlerRunner = new AuthorizedTaskRunner({
		agentId: "agent-test",
		issuer: "broker-test",
		publicKeyPath,
		auditLogPath,
		policy: {
			"teamcenter.soa.object.inspect": true,
			"teamcenter.soa.nao_existe": true,
		},
		handlers: {
			"teamcenter.soa.object.inspect": async () => ({
				uid: "X",
				truncated: true,
				partial_errors: [{ code: "1", message: "m1" }],
				_meta: {
					action: "teamcenter.soa.object.inspect",
					correlationId: "aud_1",
					durationMs: 42,
				},
			}),
			"teamcenter.soa.nao_existe": async () => {
				const error = new Error("objeto ausente");
				error.code = "object_not_found";
				throw error;
			},
		},
	});
	const capability = signCapability(
		claims({ action: "teamcenter.soa.object.inspect" }),
		keys.privateKey,
	);
	await handlerRunner.run({
		capability,
		task_json: JSON.stringify({
			action: "teamcenter.soa.object.inspect",
			parameters: { page_id: "page-1", capture_ms: 1_000 },
		}),
	});
	const records = await readAuditRecords(auditLogPath);
	const completed = records.find((r) => r.status === "completed");
	assert.equal(completed.duration_ms, 42);
	assert.equal(completed.correlation_id, "aud_1");
	assert.equal(completed.truncated, true);
	assert.equal(completed.partial_error_count, 1);
	assert.ok(completed.volume_bytes > 0);

	const failCap = signCapability(
		claims({ action: "teamcenter.soa.nao_existe" }),
		keys.privateKey,
	);
	await assert.rejects(
		handlerRunner.run({
			capability: failCap,
			task_json: JSON.stringify({
				action: "teamcenter.soa.nao_existe",
				parameters: { page_id: "page-1", capture_ms: 1_000 },
			}),
		}),
		/objeto ausente/,
	);
	const failedRecords = await readAuditRecords(auditLogPath);
	const failed = failedRecords.find((r) => r.status === "failed");
	assert.equal(failed.error_code, "object_not_found");
});

test("rejects replay, expired capabilities and out-of-scope parameters", async (t) => {
	const { privateKey, runner } = await makeRunner(t);
	const capability = signCapability(claims(), privateKey);
	const task = JSON.stringify({
		action: "browser.capture_diagnostics",
		parameters: { page_id: "page-1", capture_ms: 1_000 },
	});
	await runner.run({ capability, task_json: task });
	await assert.rejects(
		runner.run({ capability, task_json: task }),
		/ja foi utilizada/,
	);

	const expired = signCapability(
		claims({ exp: Math.floor(Date.now() / 1_000) - 1 }),
		privateKey,
	);
	await assert.rejects(
		runner.run({ capability: expired, task_json: task }),
		/expirada/,
	);

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

	const untrustedIssuer = signCapability(
		claims({ iss: "other-broker" }),
		privateKey,
	);
	await assert.rejects(
		runner.run({ capability: untrustedIssuer, task_json: task }),
		/origem nao confiavel/,
	);
});
