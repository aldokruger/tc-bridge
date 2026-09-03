// Stub para qmd (memoria de engenharia do projeto).
// Desabilitado por padrao (TC_QMD_KNOWLEDGE_ENABLED=0).
// Nao eh autoridade isolada; so complementa resultados quando habilitado.

export function createQmdAdapter({ enabled = false } = {}) {
	return {
		async search({ query, release, domains, artifactKind, languages, limit }) {
			if (!enabled) return [];
			// Placeholder: integracao qmd futura.
			return [];
		},
	};
}
