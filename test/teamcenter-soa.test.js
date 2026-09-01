import assert from "node:assert/strict";
import test from "node:test";
import {
	buildJavaEnv,
	runTeamcenterSoa,
	sanitizeText,
	soaPreflightChecks,
} from "../src/teamcenter-soa.js";

test("sanitizeText mascara segredos em mensagens", () => {
	assert.equal(
		sanitizeText("password=abc123 e resto"),
		"password=[REDACTED] e resto",
	);
	assert.equal(
		sanitizeText("TC_TEAMCENTER_PASSWORD: segredo"),
		"TC_TEAMCENTER_PASSWORD:[REDACTED]",
	);
	assert.equal(
		sanitizeText("Authorization: Bearer xyz"),
		"Authorization:[REDACTED] xyz",
	);
	assert.equal(sanitizeText("Bearer abcdef1234567890"), "[REDACTED]");
	assert.equal(sanitizeText("OBF:1a2b3c4d5e6f"), "[REDACTED]");
	assert.equal(
		sanitizeText("url https://user:pass@host:7001/tc"),
		"url https://user:[REDACTED]@host:7001/tc",
	);
	assert.equal(
		sanitizeText("url https://host:7001/tc sem credencial"),
		"url https://host:7001/tc sem credencial",
	);
	assert.equal(sanitizeText("grip=ABCDEFGHIJKLMNOPQRST"), "grip=[REDACTED]");
	assert.equal(sanitizeText("mensagem limpa"), "mensagem limpa");
});

test("buildJavaEnv filtra o ambiente e aplica client encoding", () => {
	const original = { ...process.env };
	try {
		process.env.TC_TEAMCENTER_URL = "https://tc.example.com/tc";
		process.env.TC_TEAMCENTER_PASSWORD = "segredo";
		process.env.MY_SECRET = "vazou";
		process.env.PATH = "/usr/bin";
		process.env.TC_TEAMCENTER_SOA_CLIENT_ENCODING = "Cp1252";
		const env = buildJavaEnv({ teamcenterSoaClientEncoding: "UTF-8" });
		assert.equal(env.TC_TEAMCENTER_URL, "https://tc.example.com/tc");
		assert.equal(env.TC_TEAMCENTER_PASSWORD, "segredo");
		assert.equal(env.PATH, "/usr/bin");
		assert.equal(env.MY_SECRET, undefined);
		assert.equal(env.TC_TEAMCENTER_SOA_CLIENT_ENCODING, "UTF-8");
	} finally {
		for (const key of Object.keys(process.env)) {
			if (!(key in original)) delete process.env[key];
		}
		Object.assign(process.env, original);
	}
});

test("soaPreflightChecks reporta problemas de configuracao", async () => {
	const cfg = {
		teamcenterSoaAdapterJar: "/nonexistent/adapter.jar",
		teamcenterSoaLib: "/nonexistent/lib",
		teamcenterSoaUrl: "http://inseguro.example.com",
		teamcenterSoaUser: "",
		teamcenterSoaPassword: "",
		teamcenterSoaRequireTls: true,
		pathSeparator: ":",
	};
	const problems = await soaPreflightChecks(cfg);
	assert.ok(
		problems.some((p) => /adapter/i.test(p)),
		"jar ausente",
	);
	assert.ok(
		problems.some((p) => /URL/i.test(p)),
		"https exigido",
	);
	assert.ok(
		problems.some((p) => /Credencial/i.test(p)),
		"credencial ausente",
	);
});

test("runTeamcenterSoa propaga erro do envelope com mensagem sanitizada", async () => {
	const cfg = {
		teamcenterSoaTimeoutMs: 30_000,
		soaGate: {
			run: async () => ({
				schemaVersion: "1",
				status: "error",
				operation: "teamcenter.soa.object.inspect",
				correlationId: "c1",
				error: {
					code: "object_not_found",
					message: "object_uid nao referencia: password=abc",
				},
			}),
		},
	};
	await assert.rejects(
		runTeamcenterSoa({ action: "teamcenter.soa.object.inspect" }, cfg, {}),
		/password=\[REDACTED\]/,
	);
});

test("runTeamcenterSoa mapeia resultado, truncation, warnings e partialErrors", async () => {
	const cfg = {
		teamcenterSoaTimeoutMs: 30_000,
		soaGate: {
			run: async () => ({
				schemaVersion: "1",
				status: "completed",
				operation: "a",
				correlationId: "c2",
				durationMs: 5,
				result: { uid: "X" },
				truncated: true,
				warnings: ["w1"],
				partialErrors: [{ code: "1", message: "m1" }],
			}),
		},
	};
	const out = await runTeamcenterSoa({ action: "a" }, cfg, {
		correlationId: "aud_1",
	});
	assert.equal(out.uid, "X");
	assert.equal(out.truncated, true);
	assert.deepEqual(out.warnings, ["w1"]);
	assert.deepEqual(out.partial_errors, [{ code: "1", message: "m1" }]);
	assert.equal(out._meta.action, "a");
	assert.equal(out._meta.correlationId, "aud_1");
	assert.equal(out._meta.durationMs, 5);
});

test("runTeamcenterSoa repassa o usuario para o rate limit do gate", async () => {
	let seenUser = null;
	const cfg = {
		teamcenterSoaTimeoutMs: 30_000,
		soaGate: {
			run: async (action, user) => {
				seenUser = user;
				return {
					schemaVersion: "1",
					status: "completed",
					operation: action,
					correlationId: "c3",
					result: {},
				};
			},
		},
	};
	await runTeamcenterSoa({ action: "a" }, cfg, { user: "u_1" });
	assert.equal(seenUser, "u_1");
});
