import { z } from "zod";

// Contratos versionados do modelo de dominio (plano, secao 7; ADRs 0006-0010).
// Toda conclusao aponta para evidencias observadas (evidence-first), todo
// resultado trafega no envelope CheckResult e nenhum contrato carrega paths,
// URLs ou credenciais: esses permanecem na configuracao local protegida e o
// broker recebe apenas identificadores e metadados.

export const ENVIRONMENT_SCHEMA_VERSION = 1;

const environmentIdSchema = z
	.string()
	.regex(/^[a-z][a-z0-9_-]{2,63}$/, "environment_id invalido");

const componentIdSchema = z
	.string()
	.regex(/^[a-z][a-z0-9_-]{2,63}$/, "component_id invalido");

const evidenceIdSchema = z
	.string()
	.regex(/^[a-z][a-z0-9_-]{2,63}$/, "evidence_id invalido");

const checkIdSchema = z
	.string()
	.regex(/^[a-z][a-z0-9._-]{2,63}$/, "check_id invalido");

const ruleIdSchema = z
	.string()
	.regex(/^[a-z][a-z0-9_-]{2,63}$/, "rule_id invalido");

const policyProfileSchema = z
	.string()
	.regex(/^[a-z][a-z0-9_-]{2,63}$/, "policy_profile invalido");

const sha256Schema = z
	.string()
	.regex(/^[a-f0-9]{64}$/, "sha256 deve ser hex de 64 caracteres");

const datetimeSchema = z
	.string()
	.datetime({ offset: true })
	.or(z.string().datetime())
	.describe("ISO 8601");

// 7.1 EnvironmentProfile — identidade imutavel de um ambiente conhecido.
// Schemas estritos: qualquer campo extra (path, URL, credencial) e rejeitado.
export const environmentProfileSchema = z
	.object({
		schemaVersion: z.literal(ENVIRONMENT_SCHEMA_VERSION),
		environmentId: environmentIdSchema,
		classification: z.enum(["QA", "PRD"]),
		displayName: z.string().min(1).max(128),
		teamcenterRelease: z
			.string()
			.regex(/^\d{4}$/, "release deve ter 4 digitos"),
		hosts: z.array(z.string().min(1).max(128)).min(1).max(16),
		expectedComponents: z.array(componentIdSchema).min(1).max(64),
		policyProfile: policyProfileSchema,
	})
	.strict();

// 7.2 Component — instancia observada de um servico/processo do ambiente.
export const componentSchema = z
	.object({
		componentId: componentIdSchema,
		environmentId: environmentIdSchema,
		kind: z.string().min(1).max(64),
		host: z.string().min(1).max(128),
		version: z.string().min(1).max(64).optional(),
		instance: z.string().min(1).max(128).optional(),
		dependencies: z.array(componentIdSchema).max(64).default([]),
		discoverySource: z.string().min(1).max(64),
		lastObservedAt: datetimeSchema,
	})
	.strict();

// 7.3 CheckResult — envelope unico de resultado de um check, carregando a
// telemetria ja propagada a auditoria (ADR-0004) mais identidade e evidencias.
export const CHECK_STATUSES = [
	"passed",
	"failed",
	"warning",
	"skipped",
	"error",
];
export const IMPACT_BUDGETS = ["zero", "low", "medium", "high", "blocked"];

export const checkResultSchema = z
	.object({
		checkId: checkIdSchema,
		collector: z.string().min(1).max(64),
		collectorVersion: z.string().min(1).max(16),
		environmentId: environmentIdSchema.optional(),
		componentId: componentIdSchema.optional(),
		status: z.enum(CHECK_STATUSES),
		startedAt: datetimeSchema,
		finishedAt: datetimeSchema,
		durationMs: z.number().int().min(0),
		impactBudget: z.enum(IMPACT_BUDGETS),
		evidenceRefs: z.array(evidenceIdSchema).max(128).default([]),
		warnings: z.array(z.string().max(512)).max(32).default([]),
		partialErrors: z.array(z.string().max(512)).max(32).default([]),
		truncated: z.boolean().default(false),
	})
	.strict();

// 7.4 Evidence — observacao sanitizada que da lastro a conclusoes.
export const RETENTION_CLASSES = ["support", "audit"];

export const evidenceSchema = z
	.object({
		evidenceId: evidenceIdSchema,
		source: z.string().min(1).max(128),
		observationType: z.string().min(1).max(64),
		observedAt: datetimeSchema,
		host: z.string().min(1).max(128),
		component: componentIdSchema.optional(),
		sanitizedPayload: z.unknown(),
		sha256: sha256Schema,
		retentionClass: z.enum(RETENTION_CLASSES).default("support"),
	})
	.strict();

// 7.5 Finding — conclusao com severidade, confianca e trilha de evidencias.
export const FINDING_SEVERITIES = ["info", "low", "medium", "high", "critical"];
export const FINDING_CONFIDENCES = ["low", "medium", "high"];
export const FINDING_CLASSIFICATIONS = ["observed", "inferred", "unverified"];

export const findingSchema = z
	.object({
		findingId: z
			.string()
			.regex(/^fnd-[a-z0-9_-]{2,63}$/, "finding_id invalido"),
		ruleId: ruleIdSchema,
		severity: z.enum(FINDING_SEVERITIES),
		confidence: z.enum(FINDING_CONFIDENCES),
		classification: z.enum(FINDING_CLASSIFICATIONS),
		title: z.string().min(1).max(200),
		impact: z.string().min(1).max(2000),
		evidenceRefs: z.array(evidenceIdSchema).max(128).default([]),
		excludedHypotheses: z.array(z.string().max(512)).max(32).default([]),
		missingChecks: z.array(checkIdSchema).max(64).default([]),
		recommendedNextStep: z.string().min(1).max(500),
		runbookRef: z.string().min(1).max(256).optional(),
	})
	.strict();
