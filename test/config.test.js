import assert from "node:assert/strict";
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
