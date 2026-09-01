import assert from "node:assert/strict";
import test from "node:test";
import {
	actionTimeoutMs,
	enabledSoaActions,
	validateSoaAction,
} from "../src/soa-actions.js";
import { parsePolicy } from "../src/soa-policy.js";

const policy = parsePolicy({
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
		prefs: {
			preferences: {
				allowed_scopes: ["site"],
				allowed_names: ["TC_XXX_PREF"],
			},
		},
	},
});

test("health/preflight nao exigem perfil e rejeitam parametros desconhecidos", () => {
	assert.deepEqual(validateSoaAction("teamcenter.soa.preflight", {}, policy), {
		action: "teamcenter.soa.preflight",
		params: {},
	});
	assert.throws(
		() => validateSoaAction("teamcenter.soa.preflight", { evil: 1 }, policy),
		/preflight: parametros/,
	);
	assert.throws(
		() => validateSoaAction("teamcenter.soa.nao_existe", {}, policy),
		/nao permitida/,
	);
});

test("chave action no objeto de entrada e ignorada pelos schemas estritos", () => {
	// A tool envia o request inteiro (com "action"); os schemas sao strict() e
	// a chave de transporte nao pode entrar na validacao.
	const body = validateSoaAction(
		"teamcenter.soa.preferences.read",
		{
			action: "teamcenter.soa.preferences.read",
			profile: "prefs",
			scope: "site",
			preference_names_json: JSON.stringify(["TC_XXX_PREF"]),
		},
		policy,
	);
	assert.equal(body.action, "teamcenter.soa.preferences.read");
	assert.deepEqual(body.params, {
		scope: "site",
		preferenceNames: ["TC_XXX_PREF"],
	});
});

test("object.inspect exige perfil e envia propriedades/tipos/limite da policy", () => {
	const body = validateSoaAction(
		"teamcenter.soa.object.inspect",
		{
			profile: "encoding",
			object_uid: "QUGAFoZZZ14QYA",
		},
		policy,
	);
	assert.deepEqual(body.params.propertyNames, ["object_name", "object_desc"]);
	assert.deepEqual(body.params.allowedTypes, ["Item"]);
	assert.equal(body.params.maxObjects, 5);
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.object.inspect",
				{
					profile: "inexistente",
					object_uid: "QUGAFoZZZ14QYA",
				},
				policy,
			),
		/nao configurado/,
	);
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.object.inspect",
				{
					profile: "encoding",
					object_uid: "curto",
				},
				policy,
			),
		/object_uid/,
	);
});

test("encoding_probe valida a propriedade contra a policy e usa max_text_length", () => {
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.encoding_probe",
				{
					profile: "encoding",
					object_uid: "QUGAFoZZZ14QYA",
					property_name: "fora_da_policy",
				},
				policy,
			),
		/fora da policy/,
	);
	const body = validateSoaAction(
		"teamcenter.soa.encoding_probe",
		{
			profile: "encoding",
			object_uid: "QUGAFoZZZ14QYA",
			property_name: "object_name",
		},
		policy,
	);
	assert.equal(body.params.propertyName, "object_name");
	assert.equal(body.params.maxTextLength, 1000);
});

test("preferences.read valida scope e nomes contra a policy", () => {
	const body = validateSoaAction(
		"teamcenter.soa.preferences.read",
		{
			profile: "prefs",
			scope: "site",
			preference_names_json: '["TC_XXX_PREF"]',
		},
		policy,
	);
	assert.equal(body.params.scope, "site");
	assert.deepEqual(body.params.preferenceNames, ["TC_XXX_PREF"]);
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.preferences.read",
				{
					profile: "prefs",
					scope: "user",
					preference_names_json: '["TC_XXX_PREF"]',
				},
				policy,
			),
		/scope fora da policy/,
	);
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.preferences.read",
				{
					profile: "prefs",
					preference_names_json: '["TC_OUTRA_PREF"]',
				},
				policy,
			),
		/fora da policy/,
	);
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.preferences.read",
				{
					profile: "prefs",
					preference_names_json: "nao-json",
				},
				policy,
			),
		/array JSON/,
	);
});

test("saved_query.execute usa UID e limite da policy, nunca do pedido", () => {
	const body = validateSoaAction(
		"teamcenter.soa.saved_query.execute",
		{
			profile: "item_lookup",
			entries_json: '["Item ID"]',
			values_json: '["12345"]',
		},
		policy,
	);
	assert.equal(body.params.queryUid, "A1B2C3D4E5F6G7H8");
	assert.equal(body.params.limit, 20);
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.saved_query.execute",
				{
					profile: "item_lookup",
					entries_json: '["Item Name"]',
					values_json: '["x"]',
				},
				policy,
			),
		/fora da policy/,
	);
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.saved_query.execute",
				{
					profile: "item_lookup",
					entries_json: '["Item ID"]',
					values_json: "[]",
				},
				policy,
			),
		/mesmo tamanho/,
	);
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.saved_query.execute",
				{
					profile: "item_lookup",
					query_uid: "H4CK3RQUERY000",
					entries_json: '["Item ID"]',
					values_json: '["x"]',
				},
				policy,
			),
		/parametros/,
	);
});

test("dataset/fms exigem a capability declarada na policy", () => {
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.dataset.inspect",
				{
					profile: "encoding",
					dataset_uid: "QUGAFoZZZ14QYA",
				},
				policy,
			),
		/nao declara a capacidade/,
	);
	assert.throws(
		() =>
			validateSoaAction(
				"teamcenter.soa.fms.probe",
				{
					profile: "encoding",
					dataset_uid: "QUGAFoZZZ14QYA",
				},
				policy,
			),
		/nao declara a capacidade/,
	);
});

test("enabledSoaActions respeita as flags granulares do config", () => {
	const cfg = {
		allowTeamcenterSoaPreflight: true,
		allowTeamcenterSoaHealth: true,
		allowTeamcenterSoaPreferences: false,
		allowTeamcenterSoaObjects: false,
		allowTeamcenterSoaQueries: false,
		allowTeamcenterSoaDatasets: false,
		allowTeamcenterSoaFms: false,
	};
	const enabled = enabledSoaActions(cfg);
	assert.ok(enabled.includes("teamcenter.soa.preflight"));
	assert.ok(enabled.includes("teamcenter.soa.connection_health"));
	assert.ok(enabled.includes("teamcenter.soa.session_context"));
	assert.ok(!enabled.includes("teamcenter.soa.saved_query.execute"));
	assert.ok(!enabled.includes("teamcenter.soa.preferences.read"));
});

test("actionTimeoutMs aplica teto mais restritivo em saved_query", () => {
	const cfg = { teamcenterSoaTimeoutMs: 30_000 };
	assert.equal(
		actionTimeoutMs("teamcenter.soa.saved_query.execute", cfg),
		15_000,
	);
	assert.equal(actionTimeoutMs("teamcenter.soa.object.inspect", cfg), 30_000);
});
