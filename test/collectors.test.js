import assert from "node:assert/strict";
import test from "node:test";
import {
	buildCheckResult,
	runCollector,
	SOA_COLLECTOR_ID,
	SOA_COLLECTOR_VERSION,
	soaCheckResult,
} from "../src/collectors/collector-sdk.js";
import { SOA_ACTION_BUDGETS } from "../src/soa-actions.js";
import { makeTools } from "../src/tools.js";

const base = {
	checkId: "teamcenter.soa.preflight",
	collector: SOA_COLLECTOR_ID,
	collectorVersion: SOA_COLLECTOR_VERSION,
	environmentId: "tc2606-qa",
	status: "passed",
	startedAt: "2026-09-01T10:00:00.000Z",
	finishedAt: "2026-09-01T10:00:00.050Z",
	durationMs: 50,
	impactBudget: "zero",
};

test("buildCheckResult monta envelope valido com defaults", () => {
	const envelope = buildCheckResult(base);
	assert.equal(envelope.checkId, base.checkId);
	assert.equal(envelope.collector, SOA_COLLECTOR_ID);
	assert.equal(envelope.collectorVersion, SOA_COLLECTOR_VERSION);
	assert.deepEqual(envelope.evidenceRefs, []);
	assert.deepEqual(envelope.warnings, []);
	assert.deepEqual(envelope.partialErrors, []);
	assert.equal(envelope.truncated, false);
});

test("buildCheckResult aceita environmentId ausente (migracao sem registry)", () => {
	const { environmentId: _ignorado, ...semAmbiente } = base;
	const envelope = buildCheckResult(semAmbiente);
	assert.equal(envelope.environmentId, undefined);
});

test("buildCheckResult rejeita campo extra e check_id invalido", () => {
	assert.throws(
		() => buildCheckResult({ ...base, extra: true }),
		/Unrecognized key/,
	);
	assert.throws(
		() => buildCheckResult({ ...base, checkId: "INVALIDO" }),
		/check_id invalido/,
	);
	assert.throws(
		() => buildCheckResult({ ...base, impactBudget: "extremo" }),
		/Invalid enum/,
	);
});

test("runCollector executa com sucesso e mede duracao", async () => {
	const started = Date.now();
	const { envelope, data } = await runCollector({
		...base,
		impactBudget: "low",
		run: async () => ({
			data: { uid: "X" },
			warnings: ["w1"],
			truncated: true,
			partialErrors: ["p1"],
		}),
	});
	assert.equal(envelope.status, "passed");
	assert.equal(data.uid, "X");
	assert.deepEqual(envelope.warnings, ["w1"]);
	assert.deepEqual(envelope.partialErrors, ["p1"]);
	assert.equal(envelope.truncated, true);
	assert.ok(envelope.durationMs >= 0);
	assert.ok(new Date(envelope.startedAt).getTime() >= started);
});

test("runCollector propaga status failed do output", async () => {
	const { envelope } = await runCollector({
		...base,
		run: async () => ({ status: "failed", partialErrors: ["regra violada"] }),
	});
	assert.equal(envelope.status, "failed");
	assert.deepEqual(envelope.partialErrors, ["regra violada"]);
});

test("runCollector captura erro lancado como status error", async () => {
	const { envelope } = await runCollector({
		...base,
		run: async () => {
			throw new Error("adaptador caiu");
		},
	});
	assert.equal(envelope.status, "error");
	assert.deepEqual(envelope.partialErrors, ["adaptador caiu"]);
});

test("runCollector aplica timeout via AbortSignal", async () => {
	const { envelope } = await runCollector({
		...base,
		timeoutMs: 10,
		run: async () => {
			await new Promise((resolve) => setTimeout(resolve, 40));
			return { data: "tarde" };
		},
	});
	assert.equal(envelope.status, "error");
	assert.ok(envelope.partialErrors.some((e) => /timeout/.test(e)));
});

test("runCollector aborta o signal no timeout (contrato com o handler)", async () => {
	let aborted = false;
	const { envelope } = await runCollector({
		...base,
		timeoutMs: 10,
		run: (signal) =>
			new Promise((resolve) => {
				signal.addEventListener("abort", () => {
					aborted = true;
					resolve({ data: null });
				});
			}),
	});
	assert.equal(aborted, true);
	assert.equal(envelope.status, "error");
});

test("soaCheckResult monta envelope aditivo a partir do resultado SOA", () => {
	const result = {
		uid: "X",
		truncated: true,
		warnings: ["w1"],
		partial_errors: [{ code: "1", message: "m1" }],
		_meta: {
			action: "teamcenter.soa.object.inspect",
			correlationId: "c1",
			durationMs: 5,
		},
	};
	const envelope = soaCheckResult(result, {
		action: "teamcenter.soa.object.inspect",
		impactBudget: SOA_ACTION_BUDGETS["teamcenter.soa.object.inspect"],
		environmentRegistry: new Map([["tc2606-qa", {}]]),
	});
	assert.equal(envelope.checkId, "teamcenter.soa.object.inspect");
	assert.equal(envelope.collector, SOA_COLLECTOR_ID);
	assert.equal(envelope.collectorVersion, SOA_COLLECTOR_VERSION);
	assert.equal(envelope.environmentId, "tc2606-qa");
	assert.equal(envelope.status, "passed");
	assert.equal(envelope.durationMs, 5);
	assert.deepEqual(envelope.warnings, ["w1"]);
	assert.deepEqual(envelope.partialErrors, ["m1"]);
	assert.equal(envelope.truncated, true);
	assert.equal(envelope.impactBudget, "medium");
});

test("soaCheckResult marca failed quando ok=false e usa problems como partialErrors", () => {
	const envelope = soaCheckResult(
		{ ok: false, problems: ["jar ausente", "URL insegura"] },
		{
			action: "teamcenter.soa.preflight",
			impactBudget: "zero",
			environmentRegistry: new Map(),
		},
	);
	assert.equal(envelope.status, "failed");
	assert.deepEqual(envelope.partialErrors, ["jar ausente", "URL insegura"]);
	assert.equal(envelope.durationMs, 0);
	assert.equal(envelope.environmentId, undefined);
});

test("soaCheckResult omite environmentId quando registry tem multiplos ambientes", () => {
	const result = {
		uid: "X",
		_meta: { action: "abc", correlationId: "c", durationMs: 3 },
	};
	const envelope = soaCheckResult(result, {
		action: "abc",
		impactBudget: "low",
		environmentRegistry: new Map([
			["qa1", {}],
			["prd1", {}],
		]),
	});
	assert.equal(envelope.environmentId, undefined);
});

test("tc_soa_read anexa check_result no preflight falho sem quebrar shape", async () => {
	const tools = makeTools({
		allowTeamcenterRead: true,
		allowTeamcenterSoaPreflight: true,
		teamcenterSoaAdapterJar: "/nonexistent/adapter.jar",
		teamcenterSoaLib: "/nonexistent/lib",
		teamcenterSoaUrl: "http://example.com/tc",
		teamcenterSoaUser: "u",
		teamcenterSoaPassword: "p",
		teamcenterSoaRequireTls: false,
		environmentRegistry: new Map([["tc2606-qa", {}]]),
	});
	const out = await tools.tc_soa_read.run({
		action: "teamcenter.soa.preflight",
	});
	assert.equal(out.ok, false);
	assert.equal(out.source, "node");
	assert.ok(Array.isArray(out.problems));
	assert.ok(out.check_result);
	assert.equal(out.check_result.status, "failed");
	assert.equal(out.check_result.checkId, "teamcenter.soa.preflight");
	assert.equal(out.check_result.collector, SOA_COLLECTOR_ID);
	assert.deepEqual(out.check_result.partialErrors, out.problems);
	assert.equal(out.check_result.environmentId, "tc2606-qa");
});
