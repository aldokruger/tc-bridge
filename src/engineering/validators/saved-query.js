// Validador offline de Saved Query e SQL read-only.
// Nunca encaminha SQL ao banco; apenas analisa tokens e estrutura.

import { validationFindingSchema } from "../schemas.js";

const SQL_WRITE_TOKENS = [
	"insert",
	"update",
	"delete",
	"drop",
	"truncate",
	"alter",
	"create",
	"exec",
	"execute",
	"sp_",
	"xp_",
	"merge",
	"grant",
	"revoke",
	"deny",
];

const SQL_DDL_TOKENS = ["create", "alter", "drop", "truncate"];

export function validateSavedQuerySpec(
	spec,
	{ bmideTypes = [], bmideProperties = [] } = {},
) {
	const findings = [];
	// queryKind obrigatorio
	if (!spec.queryKind) {
		findings.push({
			code: "saved-query.kind.missing",
			severity: "blocker",
			message:
				"queryKind e obrigatorio (saved-query, soa-saved-query, rest-query, sql-diagnostic)",
			location: "queryKind",
		});
	}
	// Tipo raiz deve existir no BMIDE (quando o modelo BMIDE esta disponivel)
	if (
		spec.rootType &&
		bmideTypes.length > 0 &&
		!bmideTypes.includes(spec.rootType)
	) {
		findings.push({
			code: "saved-query.root-type.unknown",
			severity: "error",
			message: `tipo raiz nao encontrado no modelo BMIDE: ${spec.rootType}`,
			location: "rootType",
		});
	}
	// Propriedades devem existir (quando o modelo BMIDE esta disponivel)
	if (spec.properties && bmideProperties.length > 0) {
		for (const prop of spec.properties) {
			if (!bmideProperties.includes(prop)) {
				findings.push({
					code: "saved-query.property.unknown",
					severity: "error",
					message: `propriedade nao encontrada no modelo BMIDE: ${prop}`,
					location: `properties.${prop}`,
				});
			}
		}
	}
	// SOA saved query: UID allowlisted
	if (spec.queryKind === "soa-saved-query" && !spec.allowedUid) {
		findings.push({
			code: "saved-query.soa.uid.missing",
			severity: "blocker",
			message: "soa-saved-query exige UID allowlisted pela policy local",
			location: "allowedUid",
		});
	}
	// Validacao de SQL offline
	if (spec.queryKind === "sql-diagnostic" && spec.sql) {
		findings.push(...validateSqlOffline(spec.sql));
	}
	return findings.map((f) => validationFindingSchema.parse(f));
}

export function validateSqlOffline(sql) {
	const findings = [];
	if (typeof sql !== "string" || sql.trim().length === 0) {
		findings.push({
			code: "sql.empty",
			severity: "blocker",
			message: "SQL vazio ou invalido",
			location: "sql",
		});
		return findings.map((f) => validationFindingSchema.parse(f));
	}
	const normalized = sql
		.replace(/--.*/g, " ") // remove comentarios de linha
		.replace(/\/\*[\s\S]*?\*\//g, " ") // remove comentarios de bloco
		.replace(/'[^']*'/g, "'?'"); // neutraliza strings literais
	const tokens = normalized.toLowerCase().split(/\s+/);
	const firstToken = tokens.find((t) => t.length > 0);
	if (firstToken !== "select" && firstToken !== "with") {
		findings.push({
			code: "sql.not-select",
			severity: "blocker",
			message: "SQL diagnostico deve comecar com SELECT ou WITH (CTE)",
			location: "sql",
		});
	}
	for (const token of tokens) {
		for (const writeToken of SQL_WRITE_TOKENS) {
			if (token.startsWith(writeToken)) {
				findings.push({
					code: "sql.write-token",
					severity: "blocker",
					message: `Token proibido encontrado em SQL diagnostico: ${token}`,
					location: "sql",
				});
				break;
			}
		}
	}
	// Multiplas instrucoes
	const semicolons = normalized.replace(/[^;]/g, "").length;
	if (semicolons > 1) {
		findings.push({
			code: "sql.multiple-statements",
			severity: "blocker",
			message: "SQL diagnostico deve conter uma unica instrucao",
			location: "sql",
		});
	}
	return findings.map((f) => validationFindingSchema.parse(f));
}
