import { z } from "zod";
import { RELEASE_SCHEMA } from "../knowledge/schemas.js";

// Contratos de engenharia assistida (plano, secao 9.3-9.4).
// Schemas estritos: rejeitam campos desconhecidos.

export const ARTIFACT_KINDS = [
	"saved-query",
	"soa-saved-query",
	"rest-query",
	"sql-diagnostic",
	"workflow",
	"bmide",
	"itk",
	"soa",
	"awc",
];

export const ARTIFACT_STATUS_SCHEMA = z.enum([
	"draft",
	"validated",
	"rejected",
	"approved",
	"exported",
]);

export const artifactDraftSchema = z
	.object({
		draft_id: z
			.string()
			.regex(/^draft-[a-z0-9_-]{4,127}$/, "draft_id invalido"),
		schema_version: z.literal(1),
		artifact_kind: z.enum(ARTIFACT_KINDS),
		target_release: RELEASE_SCHEMA,
		environment_id: z
			.string()
			.regex(/^[a-z][a-z0-9_-]{2,63}$/, "environment_id invalido")
			.optional(),
		status: ARTIFACT_STATUS_SCHEMA,
		requirements: z.string().min(1).max(10_000),
		content: z.unknown(),
		assumptions: z.array(z.string().max(2_000)).max(32).default([]),
		source_refs: z
			.array(
				z.object({
					source_ref_id: z.string().min(1).max(128),
					authority: z.string().min(1).max(32),
				}),
			)
			.max(128)
			.default([]),
		environment_evidence_refs: z
			.array(z.string().min(1).max(128))
			.max(128)
			.default([]),
		validation_findings: z
			.array(z.string().min(1).max(128))
			.max(128)
			.default([]),
		content_hash: z.string().min(1).max(128).optional(),
		created_at: z.string().datetime(),
		expires_at: z.string().datetime(),
	})
	.strict();

export const FINDING_SEVERITY_SCHEMA = z.enum([
	"info",
	"warning",
	"error",
	"blocker",
]);

export const validationFindingSchema = z
	.object({
		code: z.string().min(1).max(64),
		severity: FINDING_SEVERITY_SCHEMA,
		message: z.string().min(1).max(4_000),
		location: z.string().min(1).max(512).optional(),
		source_refs: z
			.array(
				z.object({
					source_ref_id: z.string().min(1).max(128),
					authority: z.string().min(1).max(32),
				}),
			)
			.max(128)
			.default([]),
		suggested_change: z.string().min(1).max(4_000).optional(),
	})
	.strict();
