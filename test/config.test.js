import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";

const baseConfig = {
	token: "test-token",
	readPaths: ["E:/PLM"],
};

test("requires complete database configuration only when database diagnostics are enabled", () => {
	assert.doesNotThrow(() => loadConfig(baseConfig));
	assert.throws(
		() => loadConfig({ ...baseConfig, allowDbDiagnostics: true }),
		/TC_DB_SERVER/,
	);
	assert.doesNotThrow(() =>
		loadConfig({
			...baseConfig,
			allowDbDiagnostics: true,
			dbServer: "sql.example.internal",
			dbName: "tc_dev",
			dbUser: "tc_bridge_diagnostic",
			dbPassword: "secret",
			dbPort: "1433",
		}),
	);
});

test("requires agent identity, issuer and public key for capability tasks", () => {
	assert.throws(
		() => loadConfig({ ...baseConfig, allowCapabilityTasks: true }),
		/TC_AGENT_ID/,
	);
	assert.doesNotThrow(() =>
		loadConfig({
			...baseConfig,
			allowCapabilityTasks: true,
			agentId: "agent-test",
			capabilityIssuer: "https://broker.example.test",
			capabilityPublicKey: "C:/keys/capability-public.pem",
		}),
	);
	assert.throws(
		() => loadConfig({ ...baseConfig, enforceCapabilities: true }),
		/TC_ENFORCE_CAPABILITIES=1 exige/,
	);
});

test("master switch SOA habilita somente preflight/health; demais exigem flag granular", () => {
	const cfg = loadConfig({
		...baseConfig,
		allowTeamcenterRead: true,
		teamcenterUrl: "https://tc.example.com/tc",
		teamcenterUser: "infodba",
		teamcenterPassword: "segredo",
		teamcenterSoaAdapterJar: "C:/adapters/tc-bridge-soa-adapter.jar",
		teamcenterSoaLib: "C:/tc/lib",
	});
	assert.equal(cfg.allowTeamcenterSoaPreflight, true);
	assert.equal(cfg.allowTeamcenterSoaHealth, true);
	assert.equal(cfg.allowTeamcenterSoaPreferences, false);
	assert.equal(cfg.allowTeamcenterSoaObjects, false);
	assert.equal(cfg.allowTeamcenterSoaQueries, false);
	assert.equal(cfg.allowTeamcenterSoaDatasets, false);
	assert.equal(cfg.allowTeamcenterSoaFms, false);
});

test("flags granulares explicitas ligam preferences/objects/queries", () => {
	const cfg = loadConfig({
		...baseConfig,
		allowTeamcenterRead: true,
		allowTeamcenterSoaPreferences: true,
		allowTeamcenterSoaObjects: true,
		allowTeamcenterSoaQueries: true,
		teamcenterUrl: "https://tc.example.com/tc",
		teamcenterUser: "infodba",
		teamcenterPassword: "segredo",
		teamcenterSoaAdapterJar: "C:/adapters/tc-bridge-soa-adapter.jar",
		teamcenterSoaLib: "C:/tc/lib",
	});
	assert.equal(cfg.allowTeamcenterSoaPreferences, true);
	assert.equal(cfg.allowTeamcenterSoaObjects, true);
	assert.equal(cfg.allowTeamcenterSoaQueries, true);
});

test("registry de ambientes carrega na inicializacao e isola perfis invalidos", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "tc-cfg-"));
	const file = path.join(dir, "environments.json");
	try {
		writeFileSync(
			file,
			JSON.stringify({
				environments: [
					{
						schemaVersion: 1,
						environmentId: "tc2606-dev",
						classification: "QA",
						displayName: "Teamcenter 2606 DEV",
						teamcenterRelease: "2606",
						hosts: ["SRV26-TC1-DEV"],
						expectedComponents: ["server-manager", "webtier"],
						policyProfile: "qa-standard",
					},
					{
						schemaVersion: 1,
						environmentId: "tc2606-bad",
						classification: "X",
						displayName: "Invalido",
						teamcenterRelease: "2606",
						hosts: ["SRV26-TC1-DEV"],
						expectedComponents: ["server-manager"],
						policyProfile: "qa-standard",
					},
				],
			}),
		);
		const cfg = loadConfig({ ...baseConfig, environmentRegistryFile: file });
		assert.equal(cfg.environmentRegistry.size, 1);
		assert.equal(
			cfg.environmentRegistry.get("tc2606-dev").classification,
			"QA",
		);
		assert.equal(cfg.environmentRegistryErrors.length, 1);
		assert.match(cfg.environmentRegistryErrors[0], /tc2606-bad/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("registry de ambientes inexistente derruba a inicializacao", () => {
	assert.throws(
		() =>
			loadConfig({
				...baseConfig,
				environmentRegistryFile: "C:/nao-existe-environments.json",
			}),
		/nao foi possivel ler o registro/,
	);
});

test("sem registry configurado, carrega vazio sem erro", () => {
	const cfg = loadConfig(baseConfig);
	assert.equal(cfg.environmentRegistry.size, 0);
	assert.deepEqual(cfg.environmentRegistryErrors, []);
});
