import assert from "node:assert/strict";
import test from "node:test";
import {
	validateSavedQuerySpec,
	validateSqlOffline,
} from "../src/engineering/validators/saved-query.js";

test("validateSavedQuerySpec exige queryKind", () => {
	const findings = validateSavedQuerySpec({});
	assert.ok(findings.some((f) => f.code === "saved-query.kind.missing"));
	assert.ok(findings.some((f) => f.severity === "blocker"));
});

test("validateSavedQuerySpec bloqueia propriedade inexistente", () => {
	const findings = validateSavedQuerySpec(
		{
			queryKind: "saved-query",
			properties: ["prop_inexistente"],
		},
		{ bmideProperties: ["object_name"] },
	);
	assert.ok(findings.some((f) => f.code === "saved-query.property.unknown"));
});

test("validateSavedQuerySpec aceita propriedade existente", () => {
	const findings = validateSavedQuerySpec(
		{
			queryKind: "saved-query",
			properties: ["object_name"],
		},
		{ bmideProperties: ["object_name"] },
	);
	assert.ok(!findings.some((f) => f.code === "saved-query.property.unknown"));
});

test("validateSavedQuerySpec exige UID allowlisted para soa-saved-query", () => {
	const findings = validateSavedQuerySpec({
		queryKind: "soa-saved-query",
	});
	assert.ok(findings.some((f) => f.code === "saved-query.soa.uid.missing"));
});

test("validateSqlOffline aceita SELECT simples", () => {
	const findings = validateSqlOffline("SELECT * FROM Item");
	assert.equal(findings.length, 0);
});

test("validateSqlOffline aceita CTE", () => {
	const findings = validateSqlOffline(
		"WITH cte AS (SELECT id FROM Item) SELECT * FROM cte",
	);
	assert.equal(findings.length, 0);
});

test("validateSqlOffline bloqueia INSERT", () => {
	const findings = validateSqlOffline("INSERT INTO Item VALUES (1)");
	assert.ok(findings.some((f) => f.code === "sql.not-select"));
	assert.ok(findings.some((f) => f.severity === "blocker"));
});

test("validateSqlOffline bloqueia UPDATE", () => {
	const findings = validateSqlOffline("UPDATE Item SET name = 'x'");
	assert.ok(findings.some((f) => f.code === "sql.write-token"));
});

test("validateSqlOffline bloqueia DELETE", () => {
	const findings = validateSqlOffline("DELETE FROM Item");
	assert.ok(findings.some((f) => f.code === "sql.write-token"));
});

test("validateSqlOffline bloqueia DROP", () => {
	const findings = validateSqlOffline("DROP TABLE Item");
	assert.ok(findings.some((f) => f.code === "sql.write-token"));
});

test("validateSqlOffline bloqueia EXEC", () => {
	const findings = validateSqlOffline("EXEC sp_who");
	assert.ok(findings.some((f) => f.code === "sql.write-token"));
});

test("validateSqlOffline bloqueia multiplas instrucoes", () => {
	const findings = validateSqlOffline("SELECT 1; SELECT 2;");
	assert.ok(findings.some((f) => f.code === "sql.multiple-statements"));
});

test("validateSqlOffline bloqueia DDL CREATE", () => {
	const findings = validateSqlOffline("CREATE TABLE x (id INT)");
	assert.ok(findings.some((f) => f.code === "sql.write-token"));
});

test("validateSqlOffline rejeita SQL vazio", () => {
	const findings = validateSqlOffline("");
	assert.ok(findings.some((f) => f.code === "sql.empty"));
});

test("validateSqlOffline ignora strings literais na analise", () => {
	const findings = validateSqlOffline(
		"SELECT * FROM Item WHERE name = 'insert into'",
	);
	assert.equal(findings.length, 0);
});
