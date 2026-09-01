import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
	readEnvironmentRegistrySync,
	validateRegistryInput,
} from "../src/environments/registry.js";
import {
	checkResultSchema,
	componentSchema,
	ENVIRONMENT_SCHEMA_VERSION,
	environmentProfileSchema,
	evidenceSchema,
	findingSchema,
} from "../src/environments/schemas.js";

const validProfile = {
	schemaVersion: ENVIRONMENT_SCHEMA_VERSION,
	environmentId: "tc2606-dev",
	classification: "QA",
	displayName: "Teamcenter 2606 DEV",
	teamcenterRelease: "2606",
	hosts: ["SRV26-TC1-DEV"],
	expectedComponents: ["server-manager", "webtier", "gateway", "fsc"],
	policyProfile: "qa-standard",
};

const validComponent = {
	componentId: "server-manager",
	environmentId: "tc2606-dev",
	kind: "service",
	host: "SRV26-TC1-DEV",
	version: "2606.1",
	instance: "default",
	dependencies: [],
	discoverySource: "registry",
	lastObservedAt: "2026-09-01T12:00:00Z",
};

const validCheckResult = {
	checkId: "chk-001",
	collector: "soa-health",
	collectorVersion: "1.0.0",
	environmentId: "tc2606-dev",
	componentId: "server-manager",
	status: "passed",
	startedAt: "2026-09-01T12:00:00Z",
	finishedAt: "2026-09-01T12:00:01Z",
	durationMs: 1000,
	impactBudget: "low",
	evidenceRefs: [],
	warnings: [],
	partialErrors: [],
	truncated: false,
};

const validEvidence = {
	evidenceId: "ev-001",
	source: "soa.health",
	observationType: "metric",
	observedAt: "2026-09-01T12:00:00Z",
	host: "SRV26-TC1-DEV",
	component: "server-manager",
	sanitizedPayload: { status: "up" },
	sha256: "a".repeat(64),
	retentionClass: "support",
};

const validFinding = {
	findingId: "fnd-001",
	ruleId: "rule-port-listening",
	severity: "high",
	confidence: "high",
	classification: "observed",
	title: "Porta SOA nao responde",
	impact: "Cliente SOA nao conecta",
	evidenceRefs: ["ev-001"],
	excludedHypotheses: [],
	missingChecks: [],
	recommendedNextStep: "Verificar servico server-manager",
};

test("environmentProfileSchema aceita perfil valido e rejeita campos extra", () => {
	assert.equal(
		environmentProfileSchema.parse(validProfile).environmentId,
		"tc2606-dev",
	);
	assert.throws(() =>
		environmentProfileSchema.parse({ ...validProfile, extraField: "x" }),
	);
});

test("environmentProfileSchema rejeita classification, release e policy invalidos", () => {
	assert.throws(() =>
		environmentProfileSchema.parse({ ...validProfile, classification: "DEV" }),
	);
	assert.throws(() =>
		environmentProfileSchema.parse({
			...validProfile,
			teamcenterRelease: "26",
		}),
	);
	assert.throws(() =>
		environmentProfileSchema.parse({
			...validProfile,
			policyProfile: "QA STD",
		}),
	);
});

test("componentSchema valida dependencias e fonte de descoberta", () => {
	assert.equal(componentSchema.parse(validComponent).kind, "service");
	assert.throws(() =>
		componentSchema.parse({ ...validComponent, dependencies: "server" }),
	);
	assert.throws(() =>
		componentSchema.parse({ ...validComponent, discoverySource: "" }),
	);
});

test("checkResultSchema valida status, impacto e truncamento", () => {
	const parsed = checkResultSchema.parse(validCheckResult);
	assert.equal(parsed.status, "passed");
	assert.equal(parsed.truncated, false);
	assert.throws(() =>
		checkResultSchema.parse({ ...validCheckResult, status: "unknown" }),
	);
	assert.throws(() =>
		checkResultSchema.parse({ ...validCheckResult, impactBudget: "huge" }),
	);
});

test("evidenceSchema exige sha256 hex e aceita payload sanitizado", () => {
	assert.equal(evidenceSchema.parse(validEvidence).retentionClass, "support");
	assert.throws(() =>
		evidenceSchema.parse({ ...validEvidence, sha256: "abc" }),
	);
	assert.throws(() =>
		evidenceSchema.parse({ ...validEvidence, retentionClass: "forever" }),
	);
});

test("findingSchema valida classification e referencia evidencias", () => {
	assert.equal(findingSchema.parse(validFinding).classification, "observed");
	assert.throws(() =>
		findingSchema.parse({ ...validFinding, classification: "guessed" }),
	);
	assert.throws(() =>
		findingSchema.parse({ ...validFinding, evidenceRefs: "ev-001" }),
	);
});

test("validateRegistryInput isola perfil invalido e mantem os validos", () => {
	const input = {
		environments: [
			validProfile,
			{ ...validProfile, environmentId: "tc2606-bad", classification: "X" },
			{ ...validProfile, environmentId: "tc2606-prd", classification: "PRD" },
		],
	};
	const { environments, errors } = validateRegistryInput(input);
	assert.equal(environments.size, 2);
	assert.equal(errors.length, 1);
	assert.match(errors[0], /tc2606-bad/);
});

test("validateRegistryInput rejeita duplicados e entradas sem environmentId", () => {
	const { environments, errors } = validateRegistryInput({
		environments: [
			validProfile,
			validProfile,
			{ ...validProfile, environmentId: "" },
		],
	});
	assert.equal(environments.size, 1);
	assert.equal(errors.length, 2);
});

test("validateRegistryInput exige array nao vazio", () => {
	assert.throws(() => validateRegistryInput({}), /array "environments"/);
	assert.throws(
		() => validateRegistryInput({ environments: [] }),
		/nao pode estar vazio/,
	);
});

test("readEnvironmentRegistrySync le arquivo e reporta erros por perfil", () => {
	const dir = mkdtempSync(path.join(tmpdir(), "tc-env-"));
	const file = path.join(dir, "environments.json");
	try {
		writeFileSync(
			file,
			JSON.stringify({
				environments: [
					validProfile,
					{ ...validProfile, environmentId: "tc2606-qa", classification: "QA" },
				],
			}),
		);
		const { environments, errors } = readEnvironmentRegistrySync(file);
		assert.equal(environments.size, 2);
		assert.equal(errors.length, 0);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("readEnvironmentRegistrySync lanca para arquivo inexistente ou JSON invalido", () => {
	assert.throws(
		() => readEnvironmentRegistrySync("C:/nao-existe.json"),
		/nao foi possivel ler/,
	);
	const dir = mkdtempSync(path.join(tmpdir(), "tc-env-"));
	const file = path.join(dir, "bad.json");
	try {
		writeFileSync(file, "{nao-e-json");
		assert.throws(() => readEnvironmentRegistrySync(file), /nao e JSON valido/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
