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
