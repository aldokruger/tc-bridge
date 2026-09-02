import assert from "node:assert/strict";
import test from "node:test";
import {
	diffDocuments,
	documentFingerprint,
	summarizeChanges,
} from "../../src/configuration/diff.js";

const catalogByName = new Map([
	[
		"host",
		{
			name: "host",
			kind: "string",
			sensitivity: "normal",
			applyImpact: "restart",
		},
	],
	[
		"jars",
		{
			name: "jars",
			kind: "list",
			sensitivity: "sensitive",
			applyImpact: "restart",
		},
	],
	[
		"dbPassword",
		{
			name: "dbPassword",
			kind: "string",
			sensitivity: "secret",
			applyImpact: "restart",
		},
	],
]);

test("diffDocuments: adicionado, removido e alterado", () => {
	const current = { revision: 3, data: { host: "a", jars: ["x"] } };
	const changes = diffDocuments(current, { jars: ["x", "y"], dbPassword: "p" });
	assert.deepEqual(
		changes.sort((a, b) => a.name.localeCompare(b.name)),
		[
			{ name: "dbPassword", before: undefined, after: "p" },
			{ name: "host", before: "a", after: undefined },
			{ name: "jars", before: ["x"], after: ["x", "y"] },
		],
	);
});

test("diffDocuments: sem documento corrente, tudo vira adicao", () => {
	const changes = diffDocuments(null, { host: "a" });
	assert.deepEqual(changes, [{ name: "host", before: undefined, after: "a" }]);
});

test("diffDocuments: documento igual nao gera changes", () => {
	const current = { revision: 1, data: { host: "a" } };
	assert.deepEqual(diffDocuments(current, { host: "a" }), []);
});

test("summarizeChanges: redige segredos e descreve listas", () => {
	const summary = summarizeChanges(
		[
			{ name: "host", before: undefined, after: "0.0.0.0" },
			{ name: "dbPassword", before: "segredo-antigo", after: "segredo-novo" },
			{ name: "jars", before: [], after: ["a.jar", "b.jar"] },
		],
		catalogByName,
	);
	const byName = Object.fromEntries(
		summary.map((entry) => [entry.name, entry]),
	);
	assert.equal(byName.host.before, undefined);
	assert.equal(byName.host.after, "0.0.0.0");
	assert.equal(byName.host.applyImpact, "restart");
	// Segredo nunca sai em texto claro no resumo.
	assert.equal(byName.dbPassword.before, "***");
	assert.equal(byName.dbPassword.after, "***");
	assert.deepEqual(byName.jars.after, ["a.jar", "b.jar"]);
});

test("summarizeChanges: campo fora do catalogo usa default", () => {
	const summary = summarizeChanges(
		[{ name: "desconhecido", before: 1, after: 2 }],
		catalogByName,
	);
	assert.equal(summary[0].sensitivity, "normal");
	assert.equal(summary[0].applyImpact, "restart");
	assert.equal(summary[0].kind, "string");
});

test("documentFingerprint: determinista por revisao + dados", () => {
	const doc = { revision: 1, data: { host: "a" } };
	assert.equal(documentFingerprint(doc), documentFingerprint(doc));
	assert.notEqual(
		documentFingerprint(doc),
		documentFingerprint({ ...doc, revision: 2 }),
	);
	assert.notEqual(
		documentFingerprint(doc),
		documentFingerprint({ ...doc, data: { host: "b" } }),
	);
	assert.equal(documentFingerprint(null), null);
	assert.equal(documentFingerprint(undefined), null);
});
