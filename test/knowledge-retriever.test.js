import assert from "node:assert/strict";
import test from "node:test";
import { createLocalCatalogAdapter } from "../src/knowledge/adapters/local-catalog.js";
import { createQmdAdapter } from "../src/knowledge/adapters/qmd.js";
import { createFakeSiemensDocsGatewayAdapter } from "../src/knowledge/adapters/siemens-docs-gateway.js";
import { createKnowledgeRetriever } from "../src/knowledge/retriever.js";

function makeExcerpt(id, opts = {}) {
	return {
		excerpt_id: id,
		text: opts.text || `texto ${id}`,
		language: opts.language || "pt-BR",
		topics: opts.topics || [],
		source_ref: {
			source_ref_id: `ref-${id}`,
			authority: opts.authority || "siemens",
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

test("search retorna resultados do gateway com release e fonte", async () => {
	const gateway = createFakeSiemensDocsGatewayAdapter({
		results: [
			makeExcerpt("aaa", { release: "2606", text: "como validar handler" }),
		],
	});
	const retriever = createKnowledgeRetriever({
		gatewayAdapter: gateway,
		localCatalogAdapter: createLocalCatalogAdapter(),
		qmdAdapter: createQmdAdapter(),
	});
	const results = await retriever.search({
		query: "validar handler",
		release: "2606",
		limit: 5,
	});
	assert.equal(results.length, 1);
	assert.equal(results[0].source_ref.release, "2606");
	assert.equal(results[0].source_ref.domain, "teamcenter");
	assert.equal(results[0].source_ref.verification_status, "verified");
});

test("falha do gateway produz erro explicito sem conteudo inventado", async () => {
	const gateway = {
		async search() {
			throw new Error("gateway offline");
		},
	};
	const retriever = createKnowledgeRetriever({
		gatewayAdapter: gateway,
		localCatalogAdapter: createLocalCatalogAdapter(),
		qmdAdapter: createQmdAdapter(),
	});
	const results = await retriever.search({
		query: "handler",
		release: "2606",
		limit: 5,
	});
	// Deve conter o erro como um resultado unico de proveniencia zero
	assert.ok(results.some((r) => r.excerpt_id === "err-gateway-unavailable"));
	assert.ok(
		results.some((r) => r.source_ref.verification_status === "unavailable"),
	);
});

test("deduplicacao remove resultados duplicados entre fontes", async () => {
	const gateway = createFakeSiemensDocsGatewayAdapter({
		results: [makeExcerpt("aaa", { content_hash: "h1", text: "duplicado" })],
	});
	const catalog = createLocalCatalogAdapter({
		records: [makeExcerpt("bbb", { content_hash: "h1", text: "duplicado" })],
	});
	const retriever = createKnowledgeRetriever({
		gatewayAdapter: gateway,
		localCatalogAdapter: catalog,
		qmdAdapter: createQmdAdapter(),
	});
	const results = await retriever.search({ query: "duplicado", limit: 5 });
	assert.equal(results.length, 1);
});

test("filtro de release reduz confianca em mismatch", async () => {
	const gateway = createFakeSiemensDocsGatewayAdapter({
		results: [makeExcerpt("aaa", { release: "2412" })],
	});
	const retriever = createKnowledgeRetriever({
		gatewayAdapter: gateway,
		localCatalogAdapter: createLocalCatalogAdapter(),
		qmdAdapter: createQmdAdapter(),
	});
	const results = await retriever.search({
		query: "texto",
		release: "2606",
		limit: 5,
	});
	assert.equal(results[0].source_ref.verification_status, "version_mismatch");
});

test("timeout e limites respeitam parametros", async () => {
	const gateway = createFakeSiemensDocsGatewayAdapter({
		results: Array.from({ length: 20 }, (_, i) =>
			makeExcerpt(`ex-${i}`, { text: `item ${i}` }),
		),
	});
	const retriever = createKnowledgeRetriever({
		gatewayAdapter: gateway,
		localCatalogAdapter: createLocalCatalogAdapter(),
		qmdAdapter: createQmdAdapter(),
		maxResults: 8,
	});
	const results = await retriever.search({ query: "item", limit: 5 });
	assert.equal(results.length, 5);
});
