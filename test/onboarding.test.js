import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createSetupContent, writePluginConfig, writeSetupFile } from "../src/onboarding.js";

test("setup content has a generated token but no database credentials", () => {
	const content = createSetupContent({
		token: "generated-token",
		readPaths: "E:\\PLM",
		tunnel: "localtunnel",
		publicUrl: "",
	});
	assert.match(content, /^TC_TOKEN=generated-token$/m);
	assert.match(content, /^TC_ALLOWED_READ_PATHS=E:\\PLM$/m);
	assert.doesNotMatch(content, /TC_DB_PASSWORD/);
});

test("setup and plugin files refuse overwrites by default", async (t) => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "tc-bridge-onboarding-"));
	t.after(() => fs.rm(root, { recursive: true, force: true }));
	const envPath = path.join(root, ".env");
	const pluginPath = path.join(root, "plugin.json");

	await writeSetupFile({ configPath: envPath, readPaths: "E:\\PLM", token: "test-token" });
	await assert.rejects(
		writeSetupFile({ configPath: envPath, readPaths: "E:\\PLM", token: "test-token" }),
		/substituir/,
	);

	await writePluginConfig({
		outputPath: pluginPath,
		publicUrl: "https://bridge.example.test",
		token: "test-token",
	});
	const plugin = JSON.parse(await fs.readFile(pluginPath, "utf8"));
	assert.equal(plugin.mcp["tc-bridge"].url, "https://bridge.example.test/mcp");
	assert.equal(plugin.mcp["tc-bridge"].headers.Authorization, "Bearer test-token");
	await assert.rejects(
		writePluginConfig({ outputPath: pluginPath, publicUrl: "https://bridge.example.test", token: "test-token" }),
		/substituir/,
	);
});
