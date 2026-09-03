// Provenance guard: calcula score de qualidade da fonte e normaliza referencias.
// Resultados sem source_file + location recebem verification_status 'unavailable'.

import { z } from "zod";
import { sourceReferenceSchema } from "./schemas.js";

export function computeProvenanceScore(excerpt) {
	let score = 0;
	const ref = excerpt.source_ref;
	if (ref.authority === "siemens") score += 0.4;
	else if (ref.authority === "environment") score += 0.3;
	else if (ref.authority === "project") score += 0.2;
	else if (ref.authority === "qmd") score += 0.1;

	if (ref.source_file) score += 0.25;
	if (ref.section || ref.page_or_line) score += 0.15;
	if (ref.chunk_id) score += 0.1;
	if (ref.content_hash) score += 0.05;
	if (ref.retrieved_at) score += 0.05;

	return Math.min(1, score);
}

export function normalizeSourceReference(raw) {
	const parsed = sourceReferenceSchema.safeParse(raw);
	if (!parsed.success) {
		return {
			...raw,
			verification_status: "unavailable",
		};
	}
	return parsed.data;
}

export function deduplicateExcerpts(excerpts) {
	const seen = new Map();
	for (const ex of excerpts) {
		const key = ex.source_ref?.content_hash ?? ex.excerpt_id;
		const existing = seen.get(key);
		if (!existing || ex.provenance_score > existing.provenance_score) {
			seen.set(key, ex);
		}
	}
	return [...seen.values()];
}

export function filterByRelease(excerpts, targetRelease) {
	if (!targetRelease) return excerpts;
	return excerpts.map((ex) => {
		const ref = ex.source_ref;
		if (ref.release !== targetRelease) {
			return {
				...ex,
				source_ref: {
					...ref,
					verification_status: "version_mismatch",
				},
			};
		}
		return ex;
	});
}
