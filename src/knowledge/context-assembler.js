// ContextAssembler: monta contexto para a LLM com orcamento de caracteres.
// Prioriza trechos de maior proveniencia e inclui evidencias quando permitido.

export function createContextAssembler({ maxChars = 12_000 } = {}) {
	return {
		assemble({ excerpts = [], evidences = [], findings = [] }) {
			let used = 0;
			let truncated = false;
			const parts = [];
			// Cabecalho fixo
			const header = "# Contexto para assistente\n\n";
			used += header.length;
			parts.push(header);

			// Evidencias (autoridade: environment)
			if (evidences.length > 0) {
				const section = "## Evidencias do ambiente\n\n";
				used += section.length;
				parts.push(section);
				for (const ev of evidences) {
					const text = `- ${JSON.stringify(ev).slice(0, 500)}\n`;
					if (used + text.length > maxChars) break;
					used += text.length;
					parts.push(text);
				}
			}

			// Findings (conclusoes com fontes)
			if (findings.length > 0) {
				const section = "## Conclusoes anteriores\n\n";
				used += section.length;
				parts.push(section);
				for (const f of findings) {
					const text = `- ${JSON.stringify(f).slice(0, 500)}\n`;
					if (used + text.length > maxChars) break;
					used += text.length;
					parts.push(text);
				}
			}

			// Trechos documentais (ordenados por proveniencia)
			if (excerpts.length > 0) {
				const section = "## Documentacao de referencia\n\n";
				used += section.length;
				parts.push(section);
				for (const ex of excerpts) {
					const ref = ex.source_ref;
					const meta = `Fonte: ${ref.authority} / ${ref.domain} / release ${ref.release} / ${ref.source_file ?? "n/a"} / ${ref.section ?? "n/a"} / status: ${ref.verification_status}\n`;
					const body = `${ex.text}\n\n`;
					const entry = meta + body;
					if (used + entry.length > maxChars) {
						truncated = true;
						break;
					}
					used += entry.length;
					parts.push(entry);
				}
			}

			return {
				text: parts.join(""),
				usedChars: used,
				excerptCount: excerpts.length,
				truncated,
			};
		},
	};
}
