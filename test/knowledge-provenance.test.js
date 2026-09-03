import assert from "node:assert/strict";
import test from "node:test";
import {
	computeProvenanceScore,
	deduplicateExcerpts,
	filterByRelease,
	normalizeSourceReference,
} from "../src/knowledge/provenance.js";
import {
	knowledgeExcerptSchema,
	sourceReferenceSchema,
} from "../src/knowledge/schemas.js";

test("computeProvenanceScore: siemens com source_file e chunk_id score alto", () => {
	const score = computeProvenanceScore({
		source_ref: {
			authority: "siemens",
			source_file: "doc.md",
			section: "Secao 1",
			chunk_id: "c1",
			content_hash: "abc",
			retrieved_at: new Date().toISOString(),
		},
	});
	assert.ok(score > 0.8);
	assert.ok(score <= 1);
});

test("computeProvenanceScore: qmd sem referencias score baixo", () => {
	const score = computeProvenanceScore({
		source_ref: { authority: "qmd" },
	});
	assert.ok(score < 0.3);
});

test("normalizeSourceReference aceita referencia valida", () => {
	const ref = normalizeSourceReference({
		source_ref_id: "ref-001",
		authority: "siemens",
		domain: "teamcenter",
		release: "2606",
		source_file: "doc.md",
		chunk_id: "c1",
		verification_status: "verified",
	});
	assert.equal(ref.verification_status, "verified");
});

test("normalizeSourceReference rejeita campos desconhecidos", () => {
	const ref = normalizeSourceReference({
		source_ref_id: "ref-001",
		authority: "siemens",
		domain: "teamcenter",
		release: "2606",
		campo_desconhecido: "x",
		verification_status: "verified",
	});
	assert.equal(ref.verification_status, "unavailable");
});

test("deduplicateExcerpts remove duplicatas pelo content_hash", () => {
	const excerpts = [
		{
			excerpt_id: "a",
			source_ref: { content_hash: "h1" },
			provenance_score: 0.5,
		},
		{
			excerpt_id: "b",
			source_ref: { content_hash: "h1" },
			provenance_score: 0.9,
		},
	];
	const deduped = deduplicateExcerpts(excerpts);
	assert.equal(deduped.length, 1);
	assert.equal(deduped[0].excerpt_id, "b");
});

test("filterByRelease marca mismatch como version_mismatch", () => {
	const excerpts = [
		{
			excerpt_id: "a",
			source_ref: { release: "2606", verification_status: "verified" },
		},
	];
	const filtered = filterByRelease(excerpts, "2412");
	assert.equal(filtered[0].source_ref.verification_status, "version_mismatch");
});

test("knowledgeExcerptSchema rejeita campos desconhecidos", () => {
	const parsed = knowledgeExcerptSchema.safeParse({
		excerpt_id: "ex-001",
		text: "texto",
		language: "pt-BR",
		topics: [],
		source_ref: {
			source_ref_id: "ref-001",
			authority: "siemens",
			domain: "teamcenter",
			release: "2606",
			verification_status: "verified",
		},
		campo_extra: 1,
	});
	assert.ok(!parsed.success);
});

test("sourceReferenceSchema rejeita verified sem source_file e chunk_id", () => {
	const parsed = sourceReferenceSchema.safeParse({
		source_ref_id: "ref-001",
		authority: "siemens",
		domain: "teamcenter",
		release: "2606",
		verification_status: "verified",
	});
	assert.ok(!parsed.success);
});
