import fs from "node:fs/promises";
import { z } from "zod";

// Perfil local versionado de permissões SOA. Negação por padrão: toda
// preferência, propriedade, saved query e named reference precisa estar
// declarada aqui. O arquivo é lido no host, validado por schema e nunca é
// alterável por uma tarefa remota.
//
// Exemplo (arquivo apontado por TC_TEAMCENTER_SOA_POLICY_FILE):
// {
//   "version": 1,
//   "profiles": {
//     "encoding": {
//       "objects": {
//         "allowed_types": ["Item", "ItemRevision"],
//         "properties": ["object_name", "object_desc", "awp0CellProperties"],
//         "max_objects": 5
//       },
//       "encoding": { "max_text_length": 1000 }
//     },
//     "item_lookup": {
//       "saved_query": {
//         "saved_query_uid": "LOCAL_CONFIGURED_UID",
//         "allowed_entries": ["Item ID"],
//         "max_results": 20
//       }
//     }
//   }
// }

const uidSchema = z.string().regex(/^[A-Za-z0-9_-]{8,128}$/, "UID invalido");

const scopeSchema = z.enum(["site", "user", "group", "role"]);

const objectsCapability = z
	.object({
		allowed_types: z.array(z.string().min(1).max(64)).min(1),
		properties: z.array(z.string().min(1).max(128)).min(1).max(50),
		max_objects: z.number().int().min(1).max(50).default(5),
	})
	.strict();

const encodingCapability = z
	.object({
		max_text_length: z.number().int().min(16).max(10_000).default(1000),
	})
	.strict();

const preferencesCapability = z
	.object({
		allowed_scopes: z.array(scopeSchema).min(1),
		allowed_names: z.array(z.string().min(1).max(128)).min(1).max(100),
	})
	.strict();

const savedQueryCapability = z
	.object({
		saved_query_uid: uidSchema,
		allowed_entries: z.array(z.string().min(1).max(256)).min(1).max(50),
		max_results: z.number().int().min(1).max(200).default(20),
	})
	.strict();

const datasetCapability = z
	.object({
		allowed_named_references: z.array(z.string().min(1).max(64)).min(1).max(50),
		max_objects: z.number().int().min(1).max(50).default(5),
	})
	.strict();

const fmsCapability = z
	.object({
		enabled: z.literal(true),
		max_bytes: z.number().int().min(1).max(100_000_000).default(1_048_576),
		max_duration_ms: z.number().int().min(1_000).max(120_000).default(10_000),
	})
	.strict();

const profileSchema = z
	.object({
		objects: objectsCapability.optional(),
		encoding: encodingCapability.optional(),
		preferences: preferencesCapability.optional(),
		saved_query: savedQueryCapability.optional(),
		dataset: datasetCapability.optional(),
		fms: fmsCapability.optional(),
	})
	.strict()
	.refine(
		(profile) => Object.keys(profile).length > 0,
		"perfil sem nenhuma capacidade declarada",
	);

const policySchema = z
	.object({
		version: z.literal(1),
		profiles: z.record(
			z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/),
			profileSchema,
		),
	})
	.strict();

export function parsePolicy(raw) {
	const parsed = policySchema.safeParse(raw);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		throw new Error(
			`policy SOA invalida: ${issue.path.join(".") || "(raiz)"} ${issue.message}`,
		);
	}
	return parsed.data;
}

export async function loadSoaPolicy(filePath) {
	if (!filePath) return parsePolicy({ version: 1, profiles: {} });
	let raw;
	try {
		raw = JSON.parse(await fs.readFile(filePath, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") {
			throw new Error(`Arquivo de policy SOA nao encontrado: ${filePath}`);
		}
		if (error instanceof SyntaxError) {
			throw new Error(`Arquivo de policy SOA com JSON invalido: ${filePath}`);
		}
		throw error;
	}
	return parsePolicy(raw);
}

export function getProfile(policy, profileId) {
	const profile = policy.profiles[profileId];
	if (!profile) {
		throw new Error(`Perfil SOA nao configurado na policy local: ${profileId}`);
	}
	return profile;
}

export { uidSchema, scopeSchema };
