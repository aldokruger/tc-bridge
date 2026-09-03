import assert from "node:assert/strict";
import test from "node:test";
import { createLocalCatalogAdapter } from "../src/knowledge/adapters/local-catalog.js";
import { createQmdAdapter } from "../src/knowledge/adapters/qmd.js";
import { createFakeSiemensDocsGatewayAdapter } from "../src/knowledge/adapters/siemens-docs-gateway.js";
import { createKnowledgeRetriever } from "../src/knowledge/retriever.js";

function makeExcerpt(id, text, opts = {}) {
	return {
		excerpt_id: id,
		text,
		language: "pt-BR",
		topics: opts.topics || [],
		source_ref: {
			source_ref_id: `ref-${id}`,
			authority: opts.authority || "siemens",
			domain: opts.domain || "teamcenter",
			release: opts.release || "2606",
			source_file: opts.source_file || `${id}.md`,
			section: opts.section || "Secao 1",
			page_or_line: opts.page_or_line || "10",
			chunk_id: `chunk-${id}`,
			content_hash: `hash-${id}`,
			retrieved_at: new Date().toISOString(),
			verification_status: opts.verification_status || "verified",
		},
		relevance_score: 0.9,
		provenance_score: 0.95,
	};
}

// Conjunto ouro com 5 casos (plano, Fase 0).
const GOLD_CASES = [
	{
		name: "diagnostico SOA: connection_health falha",
		query: "connection health falha",
		release: "2606",
		topics: ["soa"],
		expectSourceFile: "soa-diagnostic.md",
	},
	{
		name: "FMS: probe dataset retorna 404",
		query: "FMS probe dataset 404",
		release: "2606",
		topics: ["fms"],
		expectSourceFile: "fms-troubleshoot.md",
	},
	{
		name: "Saved Query: criar query por nome",
		query: "criar saved query por nome",
		release: "2606",
		topics: ["query"],
		expectSourceFile: "query-builder.md",
	},
	{
		name: "Workflow: validar argumentos de action handler",
		query: "validar argumentos action handler",
		release: "2606",
		topics: ["workflow"],
		expectSourceFile: "workflow-handlers.md",
	},
	{
		name: "ITK: funcao para registrar handler",
		query: "registrar workflow handler ITK",
		release: "2606",
		topics: ["itk"],
		expectSourceFile: "itk-api.md",
	},
];

const GOLD_EXCERPTS = GOLD_CASES.map((c, i) =>
	makeExcerpt(
		`gold-${i}-${c.name
			.replace(/[^a-z0-9_-]+/gi, "-")
			.replace(/^-+|-+$/g, "")
			.toLowerCase()}`.slice(0, 128),
		c.query,
		{
			topics: c.topics,
			source_file: c.expectSourceFile,
			release: c.release,
		},
	),
);

test("conjunto ouro: todo resultado possui referencia recuperavel", async () => {
	const gateway = createFakeSiemensDocsGatewayAdapter({
		results: GOLD_EXCERPTS,
	});
	const retriever = createKnowledgeRetriever({
		gatewayAdapter: gateway,
		localCatalogAdapter: createLocalCatalogAdapter(),
		qmdAdapter: createQmdAdapter(),
	});
	for (const c of GOLD_CASES) {
		const results = await retriever.search({
			query: c.query,
			release: c.release,
			limit: 3,
		});
		assert.ok(
			results.length > 0,
			`caso ouro "${c.name}" nao retornou resultados`,
		);
		const top = results[0];
		assert.ok(
			top.source_ref.source_file,
			`caso ouro "${c.name}" sem source_file`,
		);
		assert.ok(top.source_ref.chunk_id, `caso ouro "${c.name}" sem chunk_id`);
		assert.equal(
			top.source_ref.verification_status,
			"verified",
			`caso ouro "${c.name}" nao esta verified`,
		);
	}
});

test("conjunto ouro: resultados mostram release e dominio", async () => {
	const gateway = createFakeSiemensDocsGatewayAdapter({
		results: GOLD_EXCERPTS,
	});
	const retriever = createKnowledgeRetriever({
		gatewayAdapter: gateway,
		localCatalogAdapter: createLocalCatalogAdapter(),
		qmdAdapter: createQmdAdapter(),
	});
	const results = await retriever.search({
		query: "workflow handler",
		release: "2606",
		limit: 3,
	});
	assert.ok(results.length > 0);
	assert.equal(results[0].source_ref.release, "2606");
	assert.equal(results[0].source_ref.domain, "teamcenter");
});

test("conjunto ouro: falha do gateway nao inventa conteudo", async () => {
	const gateway = {
		async search() {
			throw new Error("indisponivel");
		},
	};
	const retriever = createKnowledgeRetriever({
		gatewayAdapter: gateway,
		localCatalogAdapter: createLocalCatalogAdapter(),
		qmdAdapter: createQmdAdapter(),
	});
	const results = await retriever.search({
		query: "qualquer coisa",
		release: "2606",
		limit: 3,
	});
	assert.ok(
		results.some((r) => r.source_ref.verification_status === "unavailable"),
	);
	assert.ok(
		!results.some((r) => r.source_ref.verification_status === "verified"),
	);
});
