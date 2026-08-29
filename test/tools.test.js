import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { makeTools } from "../src/tools.js";

test("writes atomically and requires explicit overwrite with matching hash", async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "tc-bridge-test-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));

	const tools = makeTools({
		allowWrite: true,
		allowDiagnostics: false,
		readPaths: [root],
		writePaths: [root],
		staging: path.join(root, "staging"),
		diagnosticHosts: ["localhost"],
	});
	const remotePath = path.join(root, "settings.json");

	const created = await tools.write_file.run({
		remote_path: remotePath,
		content: "first",
	});
	assert.equal(created.replaced, false);
	assert.equal(await fs.readFile(remotePath, "utf8"), "first");

	await assert.rejects(
		tools.write_file.run({ remote_path: remotePath, content: "second" }),
		/overwrite=true/,
	);

	const firstHash = crypto.createHash("sha256").update("first").digest("hex");
	const replaced = await tools.write_file.run({
		remote_path: remotePath,
		content: "second",
		overwrite: true,
		expected_sha256: firstHash,
	});
	assert.equal(replaced.replaced, true);
	assert.equal(await fs.readFile(remotePath, "utf8"), "second");
});
