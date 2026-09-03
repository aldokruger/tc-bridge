import { z } from "zod";

// Contratos de conhecimento (plano, secao 9.1-9.2).
// Schemas estritos: rejeitam campos desconhecidos, texto excessivo,
// release invalida e referencias incompletas quando o perfil exige proveniencia.

export const SOURCE_REF_ID_SCHEMA = z
	.string()
	.regex(/^[a-z][a-z0-9_-]{2,127}$/, "source_ref_id invalido");

export const AUTHORITY_SCHEMA = z.enum([
	"siemens",
	"environment",
	"project",
	"qmd",
]);

export const RELEASE_SCHEMA = z
	.string()
	.regex(/^\d{4}$/, "release deve ter 4 digitos");

export const VERIFICATION_STATUS_SCHEMA = z.enum([
	"verified",
	"version_mismatch",
	"incomplete",
	"unavailable",
]);

export const sourceReferenceSchema = z
	.object({
		source_ref_id: SOURCE_REF_ID_SCHEMA,
		authority: AUTHORITY_SCHEMA,
		domain: z.string().min(1).max(64),
		release: RELEASE_SCHEMA,
		source_file: z.string().min(1).max(512).optional(),
		section: z.string().min(1).max(256).optional(),
		page_or_line: z.string().min(1).max(64).optional(),
		chunk_id: z.string().min(1).max(256).optional(),
		content_hash: z.string().min(1).max(128).optional(),
		retrieved_at: z.string().datetime().optional(),
		verification_status: VERIFICATION_STATUS_SCHEMA,
	})
	.strict()
	.refine(
		(ref) => {
			// Resultados sem source_file e localizacao sao classificados como
			// unverified_source; o schema permite, mas a logica de negocio
			// bloqueia uso para sustentar rascunho validado (plano, secao 6.2).
			if (ref.verification_status === "verified") {
				return Boolean(ref.source_file) && Boolean(ref.chunk_id);
			}
			return true;
		},
		{
			message: "referencia verified exige source_file e chunk_id",
		},
	);

export const knowledgeExcerptSchema = z
	.object({
		excerpt_id: z
			.string()
			.regex(/^[a-z][a-z0-9_-]{2,127}$/, "excerpt_id invalido"),
		text: z.string().min(1).max(50_000),
		language: z.string().min(1).max(16).default("pt-BR"),
		topics: z.array(z.string().min(1).max(128)).max(32).default([]),
		source_ref: sourceReferenceSchema,
		relevance_score: z.number().min(0).max(1).default(0),
		provenance_score: z.number().min(0).max(1).default(0),
	})
	.strict();

export const SEARCH_QUERY_SCHEMA = z
	.object({
		query: z.string().min(1).max(2_000),
		release: RELEASE_SCHEMA.optional(),
		domains: z.array(z.string().min(1).max(64)).max(16).optional(),
		artifact_kind: z.string().min(1).max(64).optional(),
		languages: z.array(z.string().min(1).max(16)).max(8).optional(),
		limit: z.number().int().min(1).max(50).default(8),
	})
	.strict();
