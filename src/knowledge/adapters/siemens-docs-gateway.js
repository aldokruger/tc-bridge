// Adapter para o gateway documental Siemens via MCP.
// Usa @modelcontextprotocol/sdk quando TC_DOCS_MCP_URL esta configurado.
// Em testes, o fake adapter retorna resultados deterministicos.

import { z } from "zod";
import { knowledgeExcerptSchema } from "../schemas.js";

const GATEWAY_TIMEOUT_MS = 10_000;

export function createSiemensDocsGatewayAdapter({
	url,
	token,
	timeoutMs = GATEWAY_TIMEOUT_MS,
}) {
	return {
		async search({ query, release, domains, artifactKind, languages, limit }) {
			if (!url) {
				throw new Error("gateway documental nao configurado (TC_DOCS_MCP_URL)");
			}
			// Placeholder para integracao MCP real.
			// A implementacao completa usaria @modelcontextprotocol/sdk/client.
			throw new Error("gateway documental MCP nao implementado nesta versao");
		},
		async getChunk(chunkId) {
			throw new Error("gateway documental MCP nao implementado nesta versao");
		},
	};
}

// Fake adapter para testes (plano, secao 20 passo 3).
// Retorna resultados deterministicos sem dependencia de gateway ao vivo.
export function createFakeSiemensDocsGatewayAdapter({ results = [] } = {}) {
	const index = new Map();
	for (const r of results) {
		const parsed = knowledgeExcerptSchema.safeParse(r);
		if (parsed.success) {
			index.set(parsed.data.excerpt_id, parsed.data);
		}
	}
	return {
		async search({ query, release, domains, artifactKind, languages, limit }) {
			const hits = [];
			for (const excerpt of index.values()) {
				if (domains && !domains.includes(excerpt.source_ref.domain)) continue;
				if (artifactKind && !excerpt.topics.includes(artifactKind)) continue;
				if (languages && !languages.includes(excerpt.language)) continue;
				if (query && excerpt.text.toLowerCase().includes(query.toLowerCase())) {
					hits.push(excerpt);
				}
			}
			hits.sort((a, b) => b.provenance_score - a.provenance_score);
			return hits.slice(0, limit ?? 8);
		},
		async getChunk(chunkId) {
			return index.get(chunkId) ?? null;
		},
	};
}
