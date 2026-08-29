import assert from "node:assert/strict";
import test from "node:test";
import { isWithinAllowed } from "../src/config.js";
import { validateDiagnosticRequest } from "../src/diagnostics.js";
import { makeTools } from "../src/tools.js";

const cfg = {
	diagnosticHosts: ["localhost", "10.0.0.10"],
	readPaths: ["E:/PLM"],
};

test("accepts the three allowlisted diagnostic requests", () => {
	assert.deepEqual(
		validateDiagnosticRequest(
			{ check: "path_exists", remote_path: "E:\\PLM\\Teamcenter" },
			cfg,
		),
		{ check: "path_exists", remote_path: "E:\\PLM\\Teamcenter" },
	);
	assert.deepEqual(
		validateDiagnosticRequest(
			{ check: "service_status", service_name: "Teamcenter WebTier" },
			cfg,
		),
		{ check: "service_status", service_name: "Teamcenter WebTier" },
	);
	assert.deepEqual(
		validateDiagnosticRequest(
			{ check: "tcp_connect", host: "localhost", port: 8983 },
			cfg,
		),
		{ check: "tcp_connect", host: "localhost", port: 8983 },
	);
});

test("rejects unapproved checks and unsafe TCP targets", () => {
	assert.throws(
		() =>
			validateDiagnosticRequest({ check: "command", command: "whoami" }, cfg),
		/Diagnostico nao permitido/,
	);
	assert.throws(
		() =>
			validateDiagnosticRequest(
				{ check: "tcp_connect", host: "example.com", port: 443 },
				cfg,
			),
		/whitelist/,
	);
	assert.throws(
		() =>
			validateDiagnosticRequest(
				{ check: "tcp_connect", host: "localhost", port: 0 },
				cfg,
			),
		/port/,
	);
});

test("exposes diagnostics only when explicitly enabled", () => {
	const baseConfig = {
		allowWrite: false,
		readPaths: ["/approved"],
		writePaths: [],
		staging: "./staging",
		diagnosticHosts: ["localhost"],
	};
	assert.equal(
		makeTools({ ...baseConfig, allowDiagnostics: false }).run_diagnostic,
		undefined,
	);
	assert.ok(
		makeTools({ ...baseConfig, allowDiagnostics: true }).run_diagnostic,
	);
});

test("rejects reads and staging copies outside the read whitelist", async () => {
	const tools = makeTools({
		allowWrite: false,
		allowDiagnostics: false,
		readPaths: ["/approved"],
		writePaths: [],
		staging: "/staging",
		diagnosticHosts: ["localhost"],
	});

	await assert.rejects(
		tools.read_file.run({ remote_path: "/outside/secret.txt" }),
		/whitelist de leitura/,
	);
	await assert.rejects(
		tools.copy_to_staging.run({
			remote_path: "/approved/report.txt",
			name: "../outside.txt",
		}),
		/Nome de staging/,
	);
});

test("does not allow a path to escape its whitelist through dot segments", () => {
	assert.equal(
		isWithinAllowed("/approved/../secret.txt", ["/approved"]),
		false,
	);
	assert.equal(isWithinAllowed("/approved/report.txt", ["/approved"]), true);
});
