// Adapter para catalogo local versionado (knowledge/catalog/).
// JSON para registros processados pelo runtime; Markdown para conteudo humano.
// Suporta promocao de casos revisados e deteccao de obsolescencia por release.

import crypto from "node:crypto";
import { knowledgeExcerptSchema } from "../schemas.js";

function hashRecord(record) {
	return crypto
		.createHash("sha256")
		.update(JSON.stringify(record))
		.digest("hex");
}

export function createLocalCatalogAdapter({ records = [] } = {}) {
	const index = new Map();
	const patterns = []; // promoted cases
	for (const r of records) {
		const parsed = knowledgeExcerptSchema.safeParse(r);
		if (parsed.success) {
			index.set(parsed.data.excerpt_id, parsed.data);
		}
	}
	return {
		async search({ query, release, domains, artifactKind, languages, limit }) {
			const hits = [];
			for (const excerpt of index.values()) {
				if (release && excerpt.source_ref.release !== release) continue;
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

		// Promove um caso para o catalogo local. Exige metadados de revisao.
		promote({ excerpt, author, releases = [], sources = [] }) {
			if (!author || author.trim().length === 0) {
				throw new Error("promocao exige autor da revisao");
			}
			if (!releases.length) {
				throw new Error("promocao exige pelo menos uma release compativel");
			}
			if (!sources.length) {
				throw new Error("promocao exige fontes da revisao");
			}
			const pattern = {
				pattern_id: excerpt.excerpt_id,
				text: excerpt.text,
				language: excerpt.language,
				topics: excerpt.topics,
				source_ref: excerpt.source_ref,
				hash: hashRecord(excerpt),
				author,
				promoted_at: new Date().toISOString(),
				releases,
				sources,
				status: "active",
			};
			patterns.push(pattern);
			return pattern;
		},

		// Retorna padroes promovidos (para inspecao/teste)
		listPatterns() {
			return [...patterns];
		},

		// Marca entradas incompatíveis com a nova release como obsoletas.
		detectObsolete(release) {
			const obsolete = [];
			for (const p of patterns) {
				if (!p.releases.includes(release)) {
					p.status = "obsolete";
					obsolete.push(p);
				}
			}
			return obsolete;
		},
	};
}
