import assert from "node:assert/strict";
import test from "node:test";
import {
	listDbDiagnostics,
	resolveMssqlModule,
	validateDbDiagnosticRequest,
} from "../src/db-diagnostics.js";
import { makeTools } from "../src/tools.js";

test("accepts only allowlisted database diagnostics", () => {
	assert.deepEqual(validateDbDiagnosticRequest({ check: "waits" }), {
		check: "waits",
		limit: 20,
	});
	assert.deepEqual(
		validateDbDiagnosticRequest({ check: "index_health", limit: 5 }),
		{
			check: "index_health",
			limit: 5,
		},
	);
	assert.throws(
		() => validateDbDiagnosticRequest({ check: "query", sql: "SELECT 1" }),
		/nao permitido/,
	);
	assert.throws(
		() => validateDbDiagnosticRequest({ check: "waits", limit: 51 }),
		/limit/,
	);
	assert.equal(listDbDiagnostics().length, 7);
	assert.deepEqual(validateDbDiagnosticRequest({ check: "encoding_profile" }), {
		check: "encoding_profile",
		limit: 20,
	});
});

test("exposes database diagnostics only when explicitly enabled", () => {
	const baseConfig = {
		allowWrite: false,
		allowDiagnostics: false,
		readPaths: ["/approved"],
		writePaths: [],
		staging: "./staging",
		diagnosticHosts: ["localhost"],
	};
	assert.equal(
		makeTools({ ...baseConfig, allowDbDiagnostics: false }).run_db_diagnostic,
		undefined,
	);
	assert.ok(
		makeTools({ ...baseConfig, allowDbDiagnostics: true }).run_db_diagnostic,
	);
});

test("uses the default export from the mssql ESM import", () => {
	const client = { ConnectionPool: class {}, Int: Symbol("Int") };

	assert.equal(resolveMssqlModule({ default: client }), client);
	assert.equal(resolveMssqlModule(client), client);
});
