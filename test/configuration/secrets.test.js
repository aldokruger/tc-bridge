import assert from "node:assert/strict";
import test from "node:test";
import { ADMIN_ERROR_CODES } from "../../src/configuration/errors.js";
import { EnvironmentSecretStore } from "../../src/configuration/secrets/environment-secret-store.js";
import { InMemorySecretStore } from "../../src/configuration/secrets/in-memory-secret-store.js";

test("EnvironmentSecretStore: resolve por nome da variavel original", () => {
	const store = new EnvironmentSecretStore({
		TC_TEAMCENTER_PASSWORD: "segredo",
	});
	assert.equal(store.resolveSecretRef("TC_TEAMCENTER_PASSWORD"), "segredo");
});

test("EnvironmentSecretStore: aceita secretRef completo TC_SECRET_<NOME>", () => {
	const store = new EnvironmentSecretStore({ TC_DB_PASSWORD: "segredo-db" });
	assert.equal(
		store.resolveSecretRef("TC_SECRET_TC_DB_PASSWORD"),
		"segredo-db",
	);
});

test("EnvironmentSecretStore: ausente ou vazio lanca SECRET_MISSING", () => {
	const store = new EnvironmentSecretStore({ TC_PRESENTE: "x", TC_VAZIO: "" });
	for (const ref of ["TC_AUSENTE", "TC_VAZIO", "TC_SECRET_TC_AUSENTE"]) {
		assert.throws(
			() => store.resolveSecretRef(ref),
			(error) => {
				assert.equal(error.code, ADMIN_ERROR_CODES.SECRET_MISSING);
				return true;
			},
		);
	}
});

test("EnvironmentSecretStore: status expoe presenca e procedencia, nunca valor", () => {
	const store = new EnvironmentSecretStore({
		TC_DB_PASSWORD: "x",
		TC_VAZIO: "",
	});
	assert.deepEqual(store.status("TC_DB_PASSWORD"), {
		ref: "TC_DB_PASSWORD",
		configured: true,
		source: "env",
	});
	assert.equal(store.status("TC_AUSENTE").configured, false);
	assert.equal(store.status("TC_VAZIO").configured, false);
	assert.equal(store.status("TC_SECRET_TC_DB_PASSWORD").configured, true);
});

test("InMemorySecretStore: resolve, ausente lanca SECRET_MISSING, status por ref", () => {
	const store = new InMemorySecretStore({ TC_TEAMCENTER_PASSWORD: "segredo" });
	assert.equal(store.resolveSecretRef("TC_TEAMCENTER_PASSWORD"), "segredo");
	assert.throws(
		() => store.resolveSecretRef("TC_AUSENTE"),
		(error) => {
			assert.equal(error.code, ADMIN_ERROR_CODES.SECRET_MISSING);
			return true;
		},
	);
	assert.deepEqual(store.status("TC_TEAMCENTER_PASSWORD"), {
		ref: "TC_TEAMCENTER_PASSWORD",
		configured: true,
		source: "in-memory",
	});
	assert.equal(store.status("TC_AUSENTE").configured, false);
});
