import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config.js";
import { ADMIN_ERROR_CODES } from "../../src/configuration/errors.js";
import { AGENT_FIELDS } from "../../src/configuration/field-catalog.js";
import { ConfigurationManager } from "../../src/configuration/manager.js";
import { InMemorySecretStore } from "../../src/configuration/secrets/in-memory-secret-store.js";
import { InMemoryConfigStore } from "../../src/configuration/stores/in-memory-config-store.js";

function makeManager({ flags = {}, env = {}, secrets = {} } = {}) {
	return new ConfigurationManager({
		target: "agent",
		fields: AGENT_FIELDS,
		store: new InMemoryConfigStore(),
		secretStore: new InMemorySecretStore(secrets),
		env,
		flags,
	});
}

test("composeEffectiveSync reproduz exatamente o shape do loadConfig", () => {
	const saved = new Map();
	const setEnv = (key, value) => {
		saved.set(key, process.env[key]);
		process.env[key] = value;
	};
	try {
		setEnv("TC_ALLOW_WRITE", "1");
		setEnv("TC_ALLOWED_WRITE_PATHS", "E:/outros");
		setEnv("TC_ALLOW_DIAGNOSTICS", "1");
		setEnv("TC_TEAMCENTER_SOA_PREFLIGHT", "1");
		setEnv("TC_TEAMCENTER_LOCALE", "pt_BR");
		setEnv("TC_DB_REQUEST_TIMEOUT_MS", "15000");
		const flags = {
			token: "test-token",
			readPaths: ["E:/PLM"],
			host: "0.0.0.0",
		};
		const manager = makeManager({ flags, env: process.env });
		const composed = manager.composeEffectiveSync(flags);
		const cfg = loadConfig(flags);
		for (const [key, value] of Object.entries(composed)) {
			assert.deepEqual(cfg[key], value, `campo ${key} divergiu do loadConfig`);
		}
		// Cobertura nominal dos campos mais criticos do shape.
		assert.equal(composed.allowWrite, true);
		assert.equal(composed.allowDiagnostics, true);
		// Sem TC_ALLOW_TEAMCENTER_READ, preflight/health herdam o master switch desligado.
		assert.equal(composed.allowTeamcenterSoaPreflight, false);
		assert.equal(composed.allowTeamcenterSoaHealth, false);
		assert.equal(composed.allowTeamcenterSoaPreferences, false);
		assert.equal(composed.teamcenterLocale, "pt_BR");
		assert.equal(composed.dbRequestTimeoutMs, 15000);
		assert.equal(composed.host, "0.0.0.0");
		assert.equal(composed.token, "test-token");
		assert.equal(typeof composed.pathSeparator, "string");
	} finally {
		for (const [key, value] of saved) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test("composeEffectiveSync respeita defaults quando nada e informado", () => {
	const manager = makeManager({});
	const composed = manager.composeEffectiveSync({
		token: "x",
		readPaths: ["E:/PLM"],
	});
	assert.equal(composed.host, "127.0.0.1");
	assert.equal(composed.port, 4100);
	assert.equal(composed.allowWrite, false);
	assert.equal(composed.tunnel, "localtunnel");
	assert.deepEqual(composed.diagnosticHosts, ["localhost", "127.0.0.1", "::1"]);
	assert.equal(composed.dbRequestTimeoutMs, undefined);
});

test("snapshot: revisao 0 sem arquivo, valores efetivos e status de origem", async () => {
	const manager = makeManager({
		flags: { token: "test-token", readPaths: ["E:/PLM"], allowWrite: true },
		env: { TC_HOST: "env-host" },
	});
	const snapshot = await manager.snapshot();
	assert.equal(snapshot.target, "agent");
	assert.equal(snapshot.revision, 0);
	assert.equal(snapshot.fingerprint, null);
	assert.equal(snapshot.file.present, false);
	assert.equal(snapshot.effective.host, "env-host");
	assert.equal(snapshot.status.host.source, "env");
	assert.equal(snapshot.status.host.locked, true);
	assert.equal(snapshot.status.allowWrite.source, "cli");
	assert.equal(snapshot.effective.readPaths.length, 1);
});

test("snapshot: segredos nunca saem, apenas status de configuracao", async () => {
	const manager = makeManager({
		flags: { token: "test-token", readPaths: ["E:/PLM"] },
		env: { TC_TEAMCENTER_PASSWORD: "segredo" },
	});
	const snapshot = await manager.snapshot();
	assert.deepEqual(snapshot.effective.teamcenterPassword, {
		configured: true,
		valueSource: "env",
	});
	assert.deepEqual(snapshot.effective.token, {
		configured: true,
		valueSource: "cli",
	});
	assert.deepEqual(snapshot.effective.dbPassword, {
		configured: false,
		valueSource: "default",
	});
});

test("plan/apply: fluxo feliz com revisao monotona e resumo", async () => {
	const manager = makeManager({
		secrets: { TC_TEAMCENTER_PASSWORD: "segredo" },
	});
	const plan = await manager.plan(
		{ teamcenterUrl: "https://tc.example.com/tc", allowWrite: true },
		0,
	);
	assert.ok(plan.planId);
	assert.equal(plan.revision, 0);
	assert.equal(plan.changeCount, 2);
	assert.equal(plan.expiresInMs > 0, true);

	const applied = await manager.apply(plan.planId);
	assert.equal(applied.revision, 1);
	assert.equal(applied.changeCount, 2);

	const snapshot = await manager.snapshot();
	assert.equal(snapshot.revision, 1);
	assert.equal(snapshot.effective.teamcenterUrl, "https://tc.example.com/tc");
	assert.equal(snapshot.file.present, true);
	assert.deepEqual(snapshot.file.secretRefs, []);
});

test("plan: mudanca com secretRef conhecido registra o campo em secretRefs", async () => {
	const manager = makeManager({
		secrets: { TC_TEAMCENTER_PASSWORD: "segredo" },
	});
	const plan = await manager.plan(
		{ teamcenterPassword: { secretRef: "TC_TEAMCENTER_PASSWORD" } },
		0,
	);
	assert.deepEqual(plan.secretRefs, ["teamcenterPassword"]);
	const applied = await manager.apply(plan.planId);
	assert.equal(applied.revision, 1);
	// O arquivo guarda o secretRef, nunca o valor.
	const snapshot = await manager.snapshot();
	assert.deepEqual(snapshot.file.secretRefs, ["TC_TEAMCENTER_PASSWORD"]);
	assert.deepEqual(snapshot.effective.teamcenterPassword, {
		configured: true,
		valueSource: "file",
	});
});

test("plan: secretRef desconhecido e rejeitado com SECRET_MISSING", async () => {
	const manager = makeManager({
		secrets: { TC_TEAMCENTER_PASSWORD: "segredo" },
	});
	await assert.rejects(
		() => manager.plan({ teamcenterPassword: { secretRef: "TC_AUSENTE" } }, 0),
		(error) => {
			assert.equal(error.code, ADMIN_ERROR_CODES.SECRET_MISSING);
			return true;
		},
	);
});

test("plan: expectedRevision divergente lanca REVISION_CONFLICT", async () => {
	const manager = makeManager({});
	const first = await manager.plan({ teamcenterUrl: "https://a" }, 0);
	await manager.apply(first.planId); // avanca para revisao 1
	await assert.rejects(
		() => manager.plan({ teamcenterUrl: "https://b" }, 0),
		(error) => {
			assert.equal(error.code, ADMIN_ERROR_CODES.REVISION_CONFLICT);
			return true;
		},
	);
});

test("plan: mudanca fora do schema gerenciado e rejeitada (VALIDATION)", async () => {
	const manager = makeManager({});
	// host e mutableInUi: false no catalogo do agente: nao pertence ao arquivo.
	await assert.rejects(
		() => manager.plan({ host: "0.0.0.0" }, 0),
		(error) => {
			assert.equal(error.code, ADMIN_ERROR_CODES.VALIDATION);
			return true;
		},
	);
});

test("apply: plano inexistente lanca PLAN_NOT_FOUND", async () => {
	const manager = makeManager({});
	await assert.rejects(
		() => manager.apply("nao-existe"),
		(error) => {
			assert.equal(error.code, ADMIN_ERROR_CODES.PLAN_NOT_FOUND);
			return true;
		},
	);
});

test("apply: plano expirado lanca PLAN_EXPIRED", async () => {
	const manager = makeManager({});
	const plan = await manager.plan({ teamcenterUrl: "https://a" }, 0);
	manager.plans.get(plan.planId).expiresAt = Date.now() - 1000;
	await assert.rejects(
		() => manager.apply(plan.planId),
		(error) => {
			assert.equal(error.code, ADMIN_ERROR_CODES.PLAN_EXPIRED);
			return true;
		},
	);
});

test("apply: arquivo mudou desde o plano lanca REVISION_CONFLICT", async () => {
	const manager = makeManager({});
	const first = await manager.plan({ teamcenterUrl: "https://a" }, 0);
	// Concorrente grava antes do apply do primeiro plano.
	const bump = await manager.plan({ teamcenterUrl: "https://b" }, 0);
	await manager.apply(bump.planId);
	await assert.rejects(
		() => manager.apply(first.planId),
		(error) => {
			assert.equal(error.code, ADMIN_ERROR_CODES.REVISION_CONFLICT);
			return true;
		},
	);
});

test("rollback: restaura revisao anterior como nova revisao", async () => {
	const manager = makeManager({});
	await manager.apply(
		(await manager.plan({ teamcenterUrl: "https://a" }, 0)).planId,
	);
	await manager.apply(
		(await manager.plan({ teamcenterUrl: "https://b" }, 1)).planId,
	);
	const result = await manager.rollback(1);
	assert.equal(result.restoredFrom, 1);
	assert.equal(result.revision, 3);
	const snapshot = await manager.snapshot();
	assert.equal(snapshot.revision, 3);
	assert.equal(snapshot.effective.teamcenterUrl, "https://a");
});

test("rollback: revisao invalida ou inexistente", async () => {
	const manager = makeManager({});
	await manager.apply(
		(await manager.plan({ teamcenterUrl: "https://a" }, 0)).planId,
	);
	await assert.rejects(
		() => manager.rollback(0),
		(error) => {
			assert.equal(error.code, ADMIN_ERROR_CODES.VALIDATION);
			return true;
		},
	);
	await assert.rejects(
		() => manager.rollback(99),
		(error) => {
			assert.equal(error.code, ADMIN_ERROR_CODES.REVISION_NOT_FOUND);
			return true;
		},
	);
});

test("snapshot com arquivo: fingerprint e secretRefs do documento gerenciado", async () => {
	const manager = makeManager({
		secrets: { TC_TEAMCENTER_PASSWORD: "segredo" },
	});
	await manager.apply(
		(
			await manager.plan(
				{
					teamcenterUrl: "https://tc",
					teamcenterPassword: { secretRef: "TC_TEAMCENTER_PASSWORD" },
				},
				0,
			)
		).planId,
	);
	const snapshot = await manager.snapshot();
	assert.equal(snapshot.revision, 1);
	assert.ok(snapshot.fingerprint);
	assert.equal(snapshot.file.present, true);
	assert.equal(snapshot.file.revision, 1);
	assert.deepEqual(snapshot.file.secretRefs, ["TC_TEAMCENTER_PASSWORD"]);
});
