import assert from "node:assert/strict";
import test from "node:test";
import { SoaGate, SoaGateError } from "../src/soa-gate.js";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("serializa operacoes com maxConcurrency=1 e rejeita alem da fila", async () => {
	const gate = new SoaGate({
		maxConcurrency: 1,
		queueLimit: 1,
		rateLimitPerMinute: 1000,
	});
	let active = 0;
	let maxActive = 0;
	const operation = async () => {
		active += 1;
		maxActive = Math.max(maxActive, active);
		await sleep(20);
		active -= 1;
		return "ok";
	};
	const results = await Promise.allSettled([
		gate.run("a", "u", operation),
		gate.run("a", "u", operation),
		gate.run("a", "u", operation),
	]);
	assert.equal(maxActive, 1);
	const fulfilled = results.filter((r) => r.status === "fulfilled");
	const rejected = results.filter((r) => r.status === "rejected");
	assert.equal(fulfilled.length, 2);
	assert.equal(rejected.length, 1);
	assert.equal(rejected[0].reason.code, "queue_full");
});

test("rate limit por (action, usuario) com janela fixa", async () => {
	const gate = new SoaGate({ rateLimitPerMinute: 2 });
	await gate.run("a", "u", async () => 1);
	await gate.run("a", "u", async () => 2);
	await assert.rejects(
		gate.run("a", "u", async () => 3),
		/rate limit/,
	);
	// outro usuario ou outra action nao compartilham a janela
	await gate.run("a", "outro", async () => 4);
	await gate.run("b", "u", async () => 5);
});

test("circuit breaker abre apos falhas consecutivas", async () => {
	const gate = new SoaGate({
		breakerFailureThreshold: 2,
		breakerOpenMs: 60_000,
		rateLimitPerMinute: 1000,
	});
	for (let i = 0; i < 2; i++) {
		await assert.rejects(
			gate.run("a", "u", async () => {
				throw new Error("boom");
			}),
			/boom/,
		);
	}
	assert.ok(gate.isBreakerOpen);
	await assert.rejects(
		gate.run("a", "u", async () => 1),
		/circuit/,
	);
});

test("timeout aborta a operacao com erro proprio", async () => {
	const gate = new SoaGate({ rateLimitPerMinute: 1000 });
	const operation = (signal) =>
		new Promise((_, reject) => {
			signal.addEventListener("abort", () => reject(new Error("aborted")));
		});
	await assert.rejects(
		gate.run("a", "u", operation, { timeoutMs: 50 }),
		/timeout/,
	);
});

test("erro de gate e propagado sem contar como falha do adaptador", async () => {
	const gate = new SoaGate({
		rateLimitPerMinute: 1,
		breakerFailureThreshold: 3,
	});
	await gate.run("a", "u", async () => 1);
	try {
		await gate.run("a", "u", async () => 2);
		assert.fail("deveria lancar rate_limited");
	} catch (error) {
		assert.ok(error instanceof SoaGateError);
		assert.equal(error.code, "rate_limited");
	}
	// falhas reais contam para o breaker; rate limit nao
	assert.equal(gate.consecutiveFailures, 0);
});

test("state() expoe metricas de diagnostico", async () => {
	const gate = new SoaGate({ rateLimitPerMinute: 1000 });
	await gate.run("a", "u", async () => 1);
	const state = gate.state();
	assert.equal(typeof state.active, "number");
	assert.equal(typeof state.queueLength, "number");
	assert.equal(typeof state.breakerOpen, "boolean");
	assert.equal(typeof state.rateWindows, "number");
});
