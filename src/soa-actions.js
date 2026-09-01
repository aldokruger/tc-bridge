import { z } from "zod";
import { getProfile, scopeSchema, uidSchema } from "./soa-policy.js";

// Registry de ações SOA granulares. Cada action tem schema de entrada estrito
// (rejeita parâmetros desconhecidos), flag de habilitação no config e a
// capability da policy local exigida. Nenhuma action ampla "teamcenter.read"
// sobrevive: health não executa query, object.inspect não lê preferências.

const jsonArrayOf = (name, { maxItems, maxLength }) =>
	z
		.string()
		.transform((value, ctx) => {
			let parsed;
			try {
				parsed = JSON.parse(value);
			} catch {
				ctx.addIssue({
					code: "custom",
					message: `${name} deve ser um array JSON`,
				});
				return z.NEVER;
			}
			if (
				!Array.isArray(parsed) ||
				parsed.length > maxItems ||
				parsed.some(
					(item) =>
						typeof item !== "string" ||
						item.length === 0 ||
						item.length > maxLength,
				)
			) {
				ctx.addIssue({
					code: "custom",
					message: `${name} deve conter ate ${maxItems} strings de 1 a ${maxLength} caracteres`,
				});
				return z.NEVER;
			}
			return parsed;
		})
		.describe(name);

const profileId = z
	.string()
	.regex(/^[a-z][a-z0-9_-]{0,63}$/, "profile invalido");

// Schemas estritos: qualquer campo extra é rejeitado.
const ACTION_SCHEMAS = {
	"teamcenter.soa.preflight": z.object({}).strict(),
	"teamcenter.soa.connection_health": z.object({}).strict(),
	"teamcenter.soa.session_context": z.object({}).strict(),
	"teamcenter.soa.health_bundle": z.object({}).strict(),
	"teamcenter.soa.preferences.read": z
		.object({
			profile: profileId,
			scope: scopeSchema.optional(),
			preference_names_json: jsonArrayOf("preference_names_json", {
				maxItems: 100,
				maxLength: 128,
			}),
		})
		.strict(),
	"teamcenter.soa.encoding_probe": z
		.object({
			profile: profileId,
			object_uid: uidSchema,
			property_name: z.string().min(1).max(128),
		})
		.strict(),
	"teamcenter.soa.object.inspect": z
		.object({
			profile: profileId,
			object_uid: uidSchema,
		})
		.strict(),
	"teamcenter.soa.saved_query.execute": z
		.object({
			profile: profileId,
			entries_json: jsonArrayOf("entries_json", {
				maxItems: 50,
				maxLength: 256,
			}),
			values_json: jsonArrayOf("values_json", {
				maxItems: 50,
				maxLength: 2_000,
			}),
		})
		.strict(),
	"teamcenter.soa.dataset.inspect": z
		.object({
			profile: profileId,
			dataset_uid: uidSchema,
		})
		.strict(),
	"teamcenter.soa.fms.probe": z
		.object({
			profile: profileId,
			dataset_uid: uidSchema,
		})
		.strict(),
};

// Flag do config que habilita cada action.
const ACTION_FLAGS = {
	"teamcenter.soa.preflight": "allowTeamcenterSoaPreflight",
	"teamcenter.soa.connection_health": "allowTeamcenterSoaHealth",
	"teamcenter.soa.session_context": "allowTeamcenterSoaHealth",
	"teamcenter.soa.health_bundle": "allowTeamcenterSoaHealth",
	"teamcenter.soa.preferences.read": "allowTeamcenterSoaPreferences",
	"teamcenter.soa.encoding_probe": "allowTeamcenterSoaObjects",
	"teamcenter.soa.object.inspect": "allowTeamcenterSoaObjects",
	"teamcenter.soa.saved_query.execute": "allowTeamcenterSoaQueries",
	"teamcenter.soa.dataset.inspect": "allowTeamcenterSoaDatasets",
	"teamcenter.soa.fms.probe": "allowTeamcenterSoaFms",
};

// Capability da policy local exigida por action (undefined = sem perfil).
const ACTION_CAPABILITY = {
	"teamcenter.soa.preflight": undefined,
	"teamcenter.soa.connection_health": undefined,
	"teamcenter.soa.session_context": undefined,
	"teamcenter.soa.health_bundle": undefined,
	"teamcenter.soa.preferences.read": "preferences",
	"teamcenter.soa.encoding_probe": "objects",
	"teamcenter.soa.object.inspect": "objects",
	"teamcenter.soa.saved_query.execute": "saved_query",
	"teamcenter.soa.dataset.inspect": "dataset",
	"teamcenter.soa.fms.probe": "fms",
};

// Timeout mais restritivo por action (ms), aplicado sobre o global.
const ACTION_TIMEOUT_CAP = {
	"teamcenter.soa.saved_query.execute": 15_000,
	"teamcenter.soa.fms.probe": 20_000,
};

// Impact budget por action (plano, secao 8.2); carregado no envelope CheckResult.
export const SOA_ACTION_BUDGETS = {
	"teamcenter.soa.preflight": "zero",
	"teamcenter.soa.connection_health": "low",
	"teamcenter.soa.session_context": "low",
	"teamcenter.soa.health_bundle": "low",
	"teamcenter.soa.preferences.read": "medium",
	"teamcenter.soa.encoding_probe": "medium",
	"teamcenter.soa.object.inspect": "medium",
	"teamcenter.soa.saved_query.execute": "medium",
	"teamcenter.soa.dataset.inspect": "high",
	"teamcenter.soa.fms.probe": "high",
};

export function soaActions() {
	return Object.keys(ACTION_SCHEMAS);
}

export function enabledSoaActions(cfg) {
	return soaActions().filter((action) => cfg[ACTION_FLAGS[action]]);
}

export function actionTimeoutMs(action, cfg) {
	const cap = ACTION_TIMEOUT_CAP[action];
	return cap
		? Math.min(cfg.teamcenterSoaTimeoutMs, cap)
		: cfg.teamcenterSoaTimeoutMs;
}

function requireCapability(profile, capability, action) {
	const value = profile[capability];
	if (!value) {
		throw new Error(
			`Perfil SOA nao declara a capacidade exigida por ${action}: ${capability}`,
		);
	}
	return value;
}

// Valida a entrada plana da tool contra o schema da action e contra a policy
// local. Retorna o corpo JSON que vai ao adaptador Java via stdin (UTF-8).
export function validateSoaAction(action, params, policy) {
	const schema = ACTION_SCHEMAS[action];
	if (!schema) throw new Error(`Acao SOA nao permitida: ${String(action)}`);
	// A chave "action" é transporte da tool, não parâmetro da action: os
	// schemas são estritos e a rejeitariam se entrasse na validação.
	const { action: _ignored, ...actionParams } = params ?? {};
	const parsed = schema.safeParse(actionParams);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new Error(
			`${action}: ${issue.path.join(".") || "parametros"} ${issue.message}`,
		);
	}
	const input = parsed.data;
	const capability = ACTION_CAPABILITY[action];

	if (capability === undefined) {
		return { action, params: {} };
	}

	const profile = getProfile(policy, input.profile);
	const body = { action, profile: input.profile, params: {} };

	switch (capability) {
		case "preferences": {
			const prefs = requireCapability(profile, "preferences", action);
			const scope = input.scope ?? prefs.allowed_scopes[0];
			if (!prefs.allowed_scopes.includes(scope)) {
				throw new Error(`${action}: scope fora da policy local: ${scope}`);
			}
			for (const name of input.preference_names_json) {
				if (!prefs.allowed_names.includes(name)) {
					throw new Error(
						`${action}: preferencia fora da policy local: ${name}`,
					);
				}
			}
			body.params = { scope, preferenceNames: input.preference_names_json };
			break;
		}
		case "objects": {
			const objects = requireCapability(profile, "objects", action);
			body.params = {
				objectUid: input.object_uid,
				propertyNames: objects.properties,
				allowedTypes: objects.allowed_types,
				maxObjects: objects.max_objects,
			};
			if (action === "teamcenter.soa.encoding_probe") {
				if (!objects.properties.includes(input.property_name)) {
					throw new Error(
						`${action}: propriedade fora da policy local: ${input.property_name}`,
					);
				}
				body.params = {
					...body.params,
					propertyName: input.property_name,
					maxTextLength: profile.encoding?.max_text_length ?? 1000,
				};
			}
			break;
		}
		case "saved_query": {
			const query = requireCapability(profile, "saved_query", action);
			if (input.entries_json.length !== input.values_json.length) {
				throw new Error(
					`${action}: entries_json e values_json devem ter o mesmo tamanho`,
				);
			}
			for (const entry of input.entries_json) {
				if (!query.allowed_entries.includes(entry)) {
					throw new Error(`${action}: criterio fora da policy local: ${entry}`);
				}
			}
			body.params = {
				queryUid: query.saved_query_uid,
				entries: input.entries_json,
				values: input.values_json,
				limit: query.max_results,
			};
			break;
		}
		case "dataset": {
			const dataset = requireCapability(profile, "dataset", action);
			body.params = {
				datasetUid: input.dataset_uid,
				allowedNamedReferences: dataset.allowed_named_references,
				maxObjects: dataset.max_objects,
			};
			break;
		}
		case "fms": {
			const fms = requireCapability(profile, "fms", action);
			body.params = {
				datasetUid: input.dataset_uid,
				maxBytes: fms.max_bytes,
				maxDurationMs: fms.max_duration_ms,
			};
			break;
		}
	}
	return body;
}

export { ACTION_SCHEMAS };
