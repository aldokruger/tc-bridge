// KnowledgeRetriever: busca em multiplas fontes, deduplica, filtra release
// e calcula proveniencia. Interface unificada independente da fonte.

import {
	computeProvenanceScore,
	deduplicateExcerpts,
	filterByRelease,
} from "./provenance.js";

export function createKnowledgeRetriever({
	gatewayAdapter,
	localCatalogAdapter,
	qmdAdapter,
	maxResults = 8,
	auditLog = null,
} = {}) {
	return {
		async search({
			query,
			release,
			domains,
			artifactKind,
			languages,
			limit,
			user,
		}) {
			const effectiveLimit = Math.min(limit ?? maxResults, 50);
			const results = [];
			let gatewayError = null;
			try {
				const gatewayResults = await gatewayAdapter.search({
					query,
					release,
					domains,
					artifactKind,
					languages,
					limit: effectiveLimit,
				});
				results.push(...gatewayResults);
			} catch (error) {
				gatewayError = error;
				results.push({
					excerpt_id: "err-gateway-unavailable",
					text: `Gateway documental indisponivel: ${error.message}`,
					language: "pt-BR",
					topics: ["error"],
					source_ref: {
						source_ref_id: "err-gateway-unavailable",
						authority: "project",
						domain: "internal",
						release: release ?? "0000",
						verification_status: "unavailable",
					},
					relevance_score: 0,
					provenance_score: 0,
				});
			}
			try {
				const localResults = await localCatalogAdapter.search({
					query,
					release,
					domains,
					artifactKind,
					languages,
					limit: effectiveLimit,
				});
				results.push(...localResults);
			} catch {
				// Local catalog falha silenciosamente.
			}
			try {
				const qmdResults = await qmdAdapter.search({
					query,
					release,
					domains,
					artifactKind,
					languages,
					limit: effectiveLimit,
				});
				results.push(...qmdResults);
			} catch {
				// qmd falha silenciosamente.
			}
			for (const r of results) {
				if (!r.provenance_score || r.provenance_score === 0) {
					r.provenance_score = computeProvenanceScore(r);
				}
			}
			let deduped = deduplicateExcerpts(results);
			deduped = filterByRelease(deduped, release);
			deduped.sort((a, b) => b.provenance_score - a.provenance_score);
			const output = deduped.slice(0, effectiveLimit);
			if (auditLog) {
				await auditLog.write({
					event: "knowledge.search",
					query,
					release,
					artifactKind,
					resultCount: output.length,
					gatewayError: gatewayError ? gatewayError.message : null,
					user: user ?? null,
				});
			}
			return output;
		},
	};
}
