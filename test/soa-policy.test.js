import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { getProfile, loadSoaPolicy, parsePolicy } from "../src/soa-policy.js";

const validPolicy = {
	version: 1,
	profiles: {
		encoding: {
			objects: {
				allowed_types: ["Item"],
				properties: ["object_name", "object_desc"],
				max_objects: 5,
			},
			encoding: { max_text_length: 1000 },
		},
		item_lookup: {
			saved_query: {
				saved_query_uid: "A1B2C3D4E5F6G7H8",
				allowed_entries: ["Item ID"],
				max_results: 20,
			},
		},
	},
};

test("parsePolicy aceita policy valida com defaults", () => {
	const policy = parsePolicy(validPolicy);
	assert.deepEqual(policy.profiles.encoding.objects.allowed_types, ["Item"]);
	assert.equal(policy.profiles.encoding.encoding.max_text_length, 1000);
	assert.equal(policy.profiles.item_lookup.saved_query.max_results, 20);
});

test("parsePolicy rejeita schema desconhecido e chaves extras", () => {
	assert.throws(() => parsePolicy({ version: 2, profiles: {} }), /invalida/);
	assert.throws(
		() => parsePolicy({ version: 1, profiles: {}, extra: true }),
		/invalida/,
	);
	assert.throws(
		() =>
			parsePolicy({
				version: 1,
				profiles: {
					x: {
						objects: { allowed_types: ["Item"] },
					},
				},
			}),
		/invalida/,
	);
});

test("parsePolicy rejeita perfil sem nenhuma capacidade", () => {
	assert.throws(
		() => parsePolicy({ version: 1, profiles: { vazio: {} } }),
		/invalida/,
	);
});

test("getProfile nega perfil ausente (deny by default)", () => {
	const policy = parsePolicy(validPolicy);
	assert.throws(() => getProfile(policy, "missing"), /nao configurado/);
});

test("loadSoaPolicy le arquivo JSON e falha em arquivo ausente ou invalido", async () => {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tc-policy-"));
	const file = path.join(dir, "policy.json");
	await fs.writeFile(file, JSON.stringify(validPolicy), "utf8");
	try {
		const policy = await loadSoaPolicy(file);
		assert.equal(policy.version, 1);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
	await assert.rejects(
		loadSoaPolicy(path.join(dir, "missing.json")),
		/nao encontrado/,
	);
});
