// Schemas Zod versionados (plano §6.3, decisao D1).
// Compostos a partir do catalogo de campos: qualquer divergencia entre schema
// e catalogo e impossivel por construcao. Todos os schemas sao estritos —
// campos desconhecidos sao rejeitados (plano §13.1).

import { z } from "zod";
import { AGENT_FIELDS, BROKER_FIELDS } from "./field-catalog.js";

export const CONFIG_SCHEMA_VERSION = 1;

const secretRefSchema = z
	.object({
		secretRef: z.string().min(1).max(256),
	})
	.strict();

// Mapeia kind do catalogo para o tipo Zod usado no arquivo gerenciado.
// Segredos nunca carregam valor: apenas { secretRef } (plano §6.3).
function zodTypeFor(entry) {
	switch (entry.kind) {
		case "list":
		case "listOrDefault":
			return z.array(z.string());
		case "uint":
		case "uintQuirk":
		case "numberFromString":
		case "optionalPort":
			return z.number().int();
		case "bool":
		case "soaFlag":
		case "boolString":
		case "boolStringTrue":
			return z.boolean();
		default:
			return z.string();
	}
}

// Schema dos DADOS do arquivo gerenciado: somente campos editaveis (plano
// §6.2: a UI escreve apenas no arquivo gerenciado). Campos derivados e
// imutaveis ficam fora — o .strict() rejeita qualquer tentativa de gravarlos.
// Todos os campos sao opcionais: o arquivo e uma camada incremental, e o
// manager faz merge com o documento corrente (plan) antes de persistir;
// exigir todos os campos quebraria plan() com mudanca parcial e o primeiro
// write do documento gerenciado.
export function buildFileDataSchema(fields) {
	const shape = {};
	for (const entry of fields) {
		if (!entry.mutableInUi || entry.kind === "derived") continue;
		shape[entry.name] =
			entry.sensitivity === "secret" ? secretRefSchema : zodTypeFor(entry);
	}
	return z.object(shape).strict().partial();
}

export const brokerFileDataSchema = buildFileDataSchema(BROKER_FIELDS);
export const agentFileDataSchema = buildFileDataSchema(AGENT_FIELDS);

// Envelope versionado persistido pelo store (plano §6.3).
export function managedFileEnvelopeSchema(fileDataSchema) {
	return z
		.object({
			schemaVersion: z.literal(CONFIG_SCHEMA_VERSION),
			revision: z.number().int().min(1),
			data: fileDataSchema,
		})
		.strict();
}

export const brokerEnvelopeSchema =
	managedFileEnvelopeSchema(brokerFileDataSchema);
export const agentEnvelopeSchema =
	managedFileEnvelopeSchema(agentFileDataSchema);

export function envelopeFor(target) {
	if (target === "broker") return brokerEnvelopeSchema;
	if (target === "agent") return agentEnvelopeSchema;
	throw new Error(`target invalido: ${target}`);
}

export function fileDataSchemaFor(target) {
	if (target === "broker") return brokerFileDataSchema;
	if (target === "agent") return agentFileDataSchema;
	throw new Error(`target invalido: ${target}`);
}
