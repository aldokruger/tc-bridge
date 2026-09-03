import { z } from "zod";

// Contratos versionados para o diagnostico BMIDE (plano, secoes 6.1-6.4).
// Reutiliza severidades/finding do envelope existente (environments/schemas.js)
// quando aplicavel. Estes schemas definem o modelo normalizado interno do
// analyzer — nada aqui carrega paths absolutos, XML bruto ou credenciais.

export const BMIDE_SCHEMA_VERSION = "1.0.0";

// --- Enums e constantes ---

export const BMIDE_ENTITY_KINDS = [
	"class",
	"standard-type",
	"form",
	"runtime-type",
	"operation-input",
	"attribute",
	"property",
	"property-attach",
	"lov-static",
	"lov-dynamic",
	"naming-rule",
	"revision-naming-rule",
	"relation",
	"grm-rule",
	"deep-copy-rule",
	"compound-property",
	"condition",
	"extension",
	"status",
	"unit-of-measure",
	"irdc",
	"dispatcher-config",
	"verification-rule",
	"propagation-rule",
	"global-constant",
	"type-constant-attach",
	"property-constant-attach",
];

export const BMIDE_OPERATIONS = ["add", "change", "delete"];
export const BMIDE_RESOLUTIONS = [
	"local",
	"dependency",
	"installation",
	"unresolved",
	"unverified",
];
export const BMIDE_PROFILES = [
	"inventory",
	"standard",
	"deep",
	"release-readiness",
];
export const BMIDE_SOURCE_KINDS = [
	"workspace",
	"package",
	"installation",
	"compare",
];
export const BMIDE_FINDING_SEVERITIES = [
	"blocker",
	"critical",
	"high",
	"medium",
	"low",
	"info",
	"unverified",
];

// Códigos de finding padronizados (plano secao 7).
export const FINDING_CODES = {
	// Estrutura (7.1)
	STRUCT_001: "BMIDE-STRUCT-001",
	STRUCT_002: "BMIDE-STRUCT-002",
	STRUCT_003: "BMIDE-STRUCT-003",
	STRUCT_004: "BMIDE-STRUCT-004",
	STRUCT_005: "BMIDE-STRUCT-005",
	STRUCT_006: "BMIDE-STRUCT-006",
	STRUCT_007: "BMIDE-STRUCT-007",
	STRUCT_008: "BMIDE-STRUCT-008",
	// Versao/build (7.2)
	VER_001: "BMIDE-VER-001",
	VER_002: "BMIDE-VER-002",
	VER_003: "BMIDE-VER-003",
	VER_004: "BMIDE-VER-004",
	VER_005: "BMIDE-VER-005",
	VER_006: "BMIDE-VER-006",
	// Tipos/classes (7.3)
	TYPE_001: "BMIDE-TYPE-001",
	TYPE_002: "BMIDE-TYPE-002",
	TYPE_003: "BMIDE-TYPE-003",
	TYPE_004: "BMIDE-TYPE-004",
	TYPE_005: "BMIDE-TYPE-005",
	TYPE_006: "BMIDE-TYPE-006",
	// LOVs (7.4)
	LOV_001: "BMIDE-LOV-001",
	LOV_002: "BMIDE-LOV-002",
	LOV_003: "BMIDE-LOV-003",
	LOV_004: "BMIDE-LOV-004",
	LOV_005: "BMIDE-LOV-005",
	LOV_006: "BMIDE-LOV-006",
	// Naming rules (7.5)
	NAMING_001: "BMIDE-NAMING-001",
	NAMING_002: "BMIDE-NAMING-002",
	NAMING_003: "BMIDE-NAMING-003",
	NAMING_004: "BMIDE-NAMING-004",
	// Relations/GRM (7.6)
	REL_001: "BMIDE-REL-001",
	REL_002: "BMIDE-REL-002",
	REL_003: "BMIDE-REL-003",
	// Extensions (7.7)
	EXT_001: "BMIDE-EXT-001",
	EXT_002: "BMIDE-EXT-002",
	// Localizacao (7.10)
	LOC_001: "BMIDE-LOC-001",
	LOC_002: "BMIDE-LOC-002",
	// Deploy (7.11)
	DEPLOY_001: "BMIDE-DEPLOY-001",
	DEPLOY_002: "BMIDE-DEPLOY-002",
};

// --- Schemas Zod ---

const sourceRefSchema = z
	.object({
		file: z.string().min(1),
		line: z.number().int().min(0),
		element: z.string().min(1),
	})
	.strict();

export const bmideEntitySchema = z
	.object({
		entityId: z.string().min(1),
		kind: z.enum(BMIDE_ENTITY_KINDS),
		name: z.string().min(1),
		parentName: z.string().optional(),
		className: z.string().optional(),
		artifactName: z.string().optional(),
		functionality: z.string().optional(),
		abstract: z.boolean().default(false),
		attributes: z.record(z.unknown()).default({}),
		sourceRef: sourceRefSchema,
		operation: z.enum(BMIDE_OPERATIONS).default("add"),
	})
	.strict();

export const bmideReferenceSchema = z
	.object({
		referenceId: z.string().min(1),
		referenceKind: z.string().min(1),
		fromEntityId: z.string().min(1),
		targetName: z.string().min(1),
		targetEntityId: z.string().optional(),
		resolution: z.enum(BMIDE_RESOLUTIONS),
		dependencyTemplate: z.string().optional(),
		sourceRef: sourceRefSchema,
	})
	.strict();

const fileEntrySchema = z
	.object({
		relativePath: z.string(),
		classification: z.string(),
		size: z.number().int().min(0),
		sha256: z.string().optional(),
	})
	.strict();

const includeEntrySchema = z
	.object({
		file: z.string(),
		resolvedPath: z.string(),
		exists: z.boolean(),
		depth: z.number().int().min(0),
	})
	.strict();

const packageArtifactSchema = z
	.object({
		artifactId: z.string(),
		kind: z.string(),
		version: z.string().optional(),
		sourceRef: sourceRefSchema.optional(),
	})
	.strict();

export const bmideProjectSnapshotSchema = z
	.object({
		schemaVersion: z.literal(BMIDE_SCHEMA_VERSION),
		snapshotId: z.string().min(1),
		sourceKind: z.enum(BMIDE_SOURCE_KINDS),
		projectName: z.string().min(1),
		displayName: z.string().optional(),
		guid: z.string().optional(),
		namespace: z.string().optional(),
		prefixes: z.array(z.string()).optional(),
		templateVersion: z.string().optional(),
		mediaVersion: z.string().optional(),
		foundationRelease: z.string().optional(),
		targetEnvironmentId: z.string().optional(),
		files: z.array(fileEntrySchema).default([]),
		includeGraph: z
			.object({
				includes: z.array(includeEntrySchema).default([]),
				missing: z.array(z.string()).default([]),
				cycles: z.array(z.string()).default([]),
				totalDepth: z.number().int().min(0).default(0),
				totalFiles: z.number().int().min(0).default(0),
			})
			.default({}),
		dependencies: z.array(z.string()).default([]),
		entities: z.array(bmideEntitySchema).default([]),
		references: z.array(bmideReferenceSchema).default([]),
		packageArtifacts: z.array(packageArtifactSchema).default([]),
		sourceHash: z.string().min(1),
		createdAt: z.string().min(1),
	})
	.strict();

export const bmideAnalyzeRequestSchema = z
	.object({
		operation: z.enum([
			"inventory",
			"analyze",
			"compare",
			"get_findings",
			"get_entity",
			"get_dependencies",
			"get_impact",
		]),
		sourceKind: z.enum(BMIDE_SOURCE_KINDS).default("workspace"),
		projectRoot: z.string().min(1),
		profile: z.enum(BMIDE_PROFILES).default("standard"),
		environmentId: z.string().optional(),
		baselineSnapshotId: z.string().optional(),
		candidateSnapshotId: z.string().optional(),
		scopes: z.array(z.string()).default(["all"]),
		severityFilter: z.array(z.enum(BMIDE_FINDING_SEVERITIES)).optional(),
		entityId: z.string().optional(),
		limit: z.number().int().min(1).max(500).default(50),
		cursor: z.string().optional(),
	})
	.strict();

// Finding tipado para BMIDE (extensao minima sobre o findingSchema existente).
export const bmideFindingSchema = z
	.object({
		findingId: z.string().regex(/^fnd-[a-z0-9_-]{2,63}$/),
		ruleId: z.string().min(1),
		severity: z.enum(BMIDE_FINDING_SEVERITIES),
		classification: z
			.enum(["observed", "inferred", "unverified"])
			.default("observed"),
		title: z.string().min(1).max(200),
		impact: z.string().min(1).max(2000),
		evidenceRefs: z.array(z.string()).default([]),
		missingChecks: z.array(z.string()).default([]),
		recommendedNextStep: z.string().min(1).max(500),
	})
	.strict();

// Helper para criar entityId padronizado.
export function makeEntityId(kind, name) {
	return `${kind}:${name}`;
}

// Helper para criar sourceRef sanitizado (sem paths absolutos).
export function sanitizeSourceRef(ref, projectRoot) {
	if (!ref) return { file: "unknown", line: 0, element: "unknown" };
	const file = ref.file?.startsWith(projectRoot)
		? ref.file.slice(projectRoot.length).replace(/^[/\\]/, "")
		: ref.file;
	return {
		file,
		line: ref.line ?? 0,
		element: ref.element ?? "unknown",
	};
}
