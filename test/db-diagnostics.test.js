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
	assert.equal(listDbDiagnostics().length, 19);
	assert.deepEqual(validateDbDiagnosticRequest({ check: "encoding_profile" }), {
		check: "encoding_profile",
		limit: 20,
	});
});

test("accepts all 12 new diagnostic checks", () => {
	const newChecks = [
		"transaction_log_health",
		"backup_history",
		"checkdb_history",
		"query_store_status",
		"statistics_health",
		"index_usage",
		"index_redundancy",
		"file_io_latency",
		"server_configuration",
		"tempdb_health",
		"blocking_history",
		"sql_agent_jobs",
	];
	for (const check of newChecks) {
		const result = validateDbDiagnosticRequest({ check });
		assert.equal(result.check, check);
		assert.equal(typeof result.limit, "number");
	}
});

test("new checks with limit parameter respect bounds", () => {
	const limitChecks = [
		"backup_history",
		"statistics_health",
		"index_usage",
		"blocking_history",
		"sql_agent_jobs",
	];
	for (const check of limitChecks) {
		assert.deepEqual(validateDbDiagnosticRequest({ check, limit: 10 }), {
			check,
			limit: 10,
		});
	}
	assert.throws(
		() => validateDbDiagnosticRequest({ check: "backup_history", limit: 0 }),
		/limit/,
	);
	assert.throws(
		() => validateDbDiagnosticRequest({ check: "sql_agent_jobs", limit: 51 }),
		/limit/,
	);
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
