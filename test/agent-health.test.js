import assert from "node:assert/strict";
import test from "node:test";
import {
	buildLiveness,
	buildMetricsEndpoint,
	buildReadiness,
} from "../src/agent/health.js";
import { createMetrics } from "../src/agent/metrics.js";

test("metrics: contadores agregados e snapshot com sistema", async () => {
	const metrics = createMetrics();
	metrics.recordCheck({ failed: true, durationMs: 10 });
	metrics.recordCheck({
		failed: false,
		truncated: true,
		partialErrors: 2,
		durationMs: 20,
		bytesCollected: 100,
		bytesReturned: 50,
	});
	metrics.recordReconnect();
	metrics.recordUpdate(true);
	metrics.recordUpdate(false);
	metrics.recordRedactionFailure();

	const snapshot = await metrics.snapshot({ version: "test-1.0" });
	assert.equal(snapshot.version, "test-1.0");
	assert.equal(snapshot.counters.checksStarted, 2);
	assert.equal(snapshot.counters.checksFailed, 1);
	assert.equal(snapshot.counters.checksCompleted, 1);
	assert.equal(snapshot.counters.durationMs, 30);
	assert.equal(snapshot.counters.truncations, 1);
	assert.equal(snapshot.counters.partialErrorEvents, 1);
	assert.equal(snapshot.counters.bytesCollected, 100);
	assert.equal(snapshot.counters.bytesReturned, 50);
	assert.equal(snapshot.counters.reconnects, 1);
	assert.equal(snapshot.counters.updatesApplied, 1);
	assert.equal(snapshot.counters.rollbacks, 1);
	assert.equal(snapshot.counters.redactionFailures, 1);
	assert.ok(snapshot.uptimeMs >= 0);
	assert.ok(snapshot.system.memory.rss > 0);
	assert.ok(snapshot.system.cpu.userMicros >= 0);
});

test("metrics: gate SOA anexado aparece no snapshot e no breaker", async () => {
	const metrics = createMetrics();
	assert.equal(metrics.gateBreakerOpen(), false);
	metrics.attachGate({ state: () => ({ breakerOpen: true }) });
	assert.equal(metrics.gateBreakerOpen(), true);
	const snapshot = await metrics.snapshot({ version: "v" });
	assert.equal(snapshot.gate.breakerOpen, true);
});

test("health: liveness nunca falha e expoe versao/uptime", async () => {
	const metrics = createMetrics();
	const result = await buildLiveness({ version: "v1", metrics });
	assert.equal(result.ok, true);
	assert.equal(result.version, "v1");
	assert.ok(result.uptimeMs >= 0);
});

test("health: readiness falha quando uma checagem falha", async () => {
	const metrics = createMetrics();
	const ready = await buildReadiness({
		version: "v1",
		metrics,
		checks: [
			() => ({ name: "gate_soa", ok: true, detail: "ok" }),
			() => ({ name: "tunnel", ok: false, detail: "inativo" }),
		],
	});
	assert.equal(ready.ok, false);
	assert.equal(ready.ready, false);
	assert.deepEqual(ready.checks.tunnel, { ok: false, detail: "inativo" });

	const readyOk = await buildReadiness({
		version: "v1",
		metrics,
		checks: [() => ({ name: "gate_soa", ok: true, detail: "ok" })],
	});
	assert.equal(readyOk.ok, true);
});

test("health: metrics endpoint retorna o snapshot completo", async () => {
	const metrics = createMetrics();
	metrics.recordCheck({ durationMs: 5 });
	const result = await buildMetricsEndpoint({ version: "v1", metrics });
	assert.equal(result.version, "v1");
	assert.equal(result.counters.checksStarted, 1);
});
