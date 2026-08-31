import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import { makeTeamcenterLogTool } from "../src/teamcenter-logs.js";
import { makeTools } from "../src/tools.js";
import { signCapability } from "../src/zero-trust/capability.js";

test("inspects only bounded Teamcenter log files and redacts secrets", async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "tc-logs-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.writeFile(
		path.join(root, "server.log"),
		"first line\nAuthorization: Bearer sensitive-token\nError creating session password=hunter2\nlast line\n",
	);
	const logs = makeTeamcenterLogTool({ logDirectory: root });

	const listed = await logs.run({ operation: "list" });
	assert.equal(listed.files[0].path, "server.log");

	const tailed = await logs.run({
		operation: "tail",
		relative_path: "server.log",
		max_lines: 2,
	});
	assert.deepEqual(tailed.lines, [
		"Error creating session password=[REDACTED]",
		"last line",
	]);

	const found = await logs.run({ operation: "search", pattern: "session" });
	assert.equal(found.matches.length, 1);
	assert.match(found.matches[0].text, /password=\[REDACTED\]/);

	await assert.rejects(
		logs.run({ operation: "tail", relative_path: "../secret.log" }),
		/fora do diretorio/,
	);
});

test("requires a log directory when log inspection is enabled", () => {
	assert.throws(
		() =>
			loadConfig({
				token: "test-token",
				readPaths: ["C:/approved"],
				allowLogRead: true,
			}),
		/TC_TEAMCENTER_LOG_DIR/,
	);
});

test("executes log inspection only through an in-scope capability", async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "tc-logs-capability-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	await fs.writeFile(path.join(root, "server.log"), "last line\n");
	const keys = crypto.generateKeyPairSync("ed25519");
	const publicKeyPath = path.join(root, "capability-public.pem");
	await fs.writeFile(
		publicKeyPath,
		keys.publicKey.export({ type: "spki", format: "pem" }),
	);
	const tools = makeTools({
		allowWrite: false,
		allowDiagnostics: false,
		allowBrowserDiagnostics: false,
		allowLogRead: true,
		allowCapabilityTasks: true,
		enforceCapabilities: true,
		readPaths: [root],
		writePaths: [],
		staging: path.join(root, "staging"),
		diagnosticHosts: ["localhost"],
		teamcenterLogDir: root,
		agentId: "agent-test",
		capabilityIssuer: "broker-test",
		capabilityPublicKey: publicKeyPath,
		auditLogPath: path.join(root, "audit.jsonl"),
	});
	const now = Math.floor(Date.now() / 1_000);
	const capability = signCapability(
		{
			iss: "broker-test",
			aud: "agent-test",
			sub: "user-test",
			action: "teamcenter.logs.read",
			scope: {
				operation: "tail",
				relative_path: "server.log",
				max_max_lines: 10,
			},
			iat: now - 1,
			exp: now + 60,
			jti: crypto.randomUUID(),
		},
		keys.privateKey,
	);
	const result = await tools.tc_authorized_task.run({
		capability,
		task_json: JSON.stringify({
			action: "teamcenter.logs.read",
			parameters: {
				operation: "tail",
				relative_path: "server.log",
				max_lines: 10,
			},
		}),
	});
	assert.deepEqual(result.result.lines, ["last line"]);
	assert.equal(tools.teamcenter_log_inspect, undefined);
});
