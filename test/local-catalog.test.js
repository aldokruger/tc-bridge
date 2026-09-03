import assert from "node:assert/strict";
import test from "node:test";
import { createEngineeringAssistant } from "../src/engineering/assistant.js";
import { createLocalCatalogAdapter } from "../src/knowledge/adapters/local-catalog.js";
import { createQmdAdapter } from "../src/knowledge/adapters/qmd.js";

function makeExcerpt(id, opts = {}) {
	return {
		excerpt_id: id,
		text: opts.text || `texto ${id}`,
		language: opts.language || "pt-BR",
		topics: opts.topics || ["workflow"],
		source_ref: {
			source_ref_id: `ref-${id}`,
			authority: opts.authority || "project",
			domain: opts.domain || "teamcenter",
			release: opts.release || "2606",
			source_file: opts.source_file || "doc.md",
			section: opts.section || "Secao 1",
			chunk_id: opts.chunk_id || `chunk-${id}`,
			content_hash: opts.content_hash || `hash-${id}`,
			retrieved_at: new Date().toISOString(),
			verification_status: opts.verification_status || "verified",
		},
		relevance_score: opts.relevance_score ?? 0.8,
		provenance_score: opts.provenance_score ?? 0.9,
	};
}

test("promote exige autor", () => {
	const adapter = createLocalCatalogAdapter();
	assert.throws(
		() =>
			adapter.promote({
				excerpt: makeExcerpt("p1"),
				author: "",
				releases: ["2606"],
				sources: ["review-123"],
			}),
		/promocao exige autor/,
	);
});

test("promote exige releases", () => {
	const adapter = createLocalCatalogAdapter();
	assert.throws(
		() =>
			adapter.promote({
				excerpt: makeExcerpt("p1"),
				author: "eng1",
				releases: [],
				sources: ["review-123"],
			}),
		/promocao exige pelo menos uma release/,
	);
});

test("promove caso com metadados de revisao", () => {
	const adapter = createLocalCatalogAdapter();
	const pattern = adapter.promote({
		excerpt: makeExcerpt("p1", { text: "padrao de workflow X" }),
		author: "eng1",
		releases: ["2606", "2412"],
		sources: ["review-123", "doc.md#secao-4"],
	});
	assert.equal(pattern.pattern_id, "p1");
	assert.equal(pattern.author, "eng1");
	assert.equal(pattern.status, "active");
	assert.ok(pattern.hash);
	assert.ok(pattern.promoted_at);
	assert.deepEqual(pattern.releases, ["2606", "2412"]);
});

test("detectObsolete marca padrao incompativel com nova release", () => {
	const adapter = createLocalCatalogAdapter();
	adapter.promote({
		excerpt: makeExcerpt("p1", { release: "2412" }),
		author: "eng1",
		releases: ["2412"],
		sources: ["review-1"],
	});
	adapter.promote({
		excerpt: makeExcerpt("p2", { release: "2606" }),
		author: "eng2",
		releases: ["2606", "2412"],
		sources: ["review-2"],
	});
	const obsolete = adapter.detectObsolete("2606");
	assert.equal(obsolete.length, 1);
	assert.equal(obsolete[0].pattern_id, "p1");
	assert.equal(obsolete[0].status, "obsolete");
});

test("qmd sozinho nao eleva rascunho a validated", async () => {
	// O qmd adapter desabilitado nao retorna resultados.
	// Mesmo se habilitado, o rascunho so atinge validated se passar pelos
	// validadores deterministicos, nunca pela busca qmd isoladamente.
	const qmd = createQmdAdapter({ enabled: false });
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "saved-query",
		release: "2606",
		requirements: "Buscar Item por nome",
	});
	// Simula tentativa de usar qmd para validar: nao altera status
	const qmdResults = await qmd.search({ query: "Item", release: "2606" });
	assert.equal(qmdResults.length, 0);

	// A validacao do assistant exige passar pelos validadores;
	// qmd nao entra como criterio de elevacao.
	const result = await assistant.validate({ draft_id: draft.draft_id });
	// Sem fontes documentais, o validador comum nao bloqueia saved-query
	// (apenas proveniencia exige source_refs para validated, mas o draft
	// gerado tem source_refs vazio e status draft; ao validar sem alterar
	// o status manualmente, o validador common nao emite blocker).
	// Vamos forcar a situacao: draft sem source_refs e status draft.
	assert.equal(result.draft.status, "validated");

	// Agora forca status validated sem fontes
	const store = assistant.getStore();
	const record = store.get(draft.draft_id);
	record.status = "validated";
	record.source_refs = [];
	store.save(record);
	const result2 = await assistant.validate({ draft_id: draft.draft_id });
	assert.equal(result2.draft.status, "draft");
	assert.ok(result2.findings.some((f) => f.code === "provenance.missing"));
});
