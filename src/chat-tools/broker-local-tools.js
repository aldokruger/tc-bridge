// Monta as tools locais do broker para o console chat (plano, secao 8).
// Interface: retorna array de tool descriptors compativel com LocalToolAdapter.

import { z } from "zod";
import { createEngineeringAssistant } from "../engineering/assistant.js";
import { createDraftStore } from "../engineering/draft-store.js";
import { createLocalCatalogAdapter } from "../knowledge/adapters/local-catalog.js";
import { createQmdAdapter } from "../knowledge/adapters/qmd.js";
import { createFakeSiemensDocsGatewayAdapter } from "../knowledge/adapters/siemens-docs-gateway.js";
import { createKnowledgeRetriever } from "../knowledge/retriever.js";

const searchSchema = z
	.object({
		query: z.string().min(1).max(2_000),
		release: z
			.string()
			.regex(/^\d{4}$/)
			.optional(),
		artifact_kind: z.string().min(1).max(64).optional(),
		domains: z.array(z.string()).optional(),
		top_k: z.number().int().min(1).max(50).optional(),
	})
	.strict();

const draftSchema = z
	.object({
		artifact_kind: z.enum(["saved-query", "soa-saved-query"]),
		release: z.string().regex(/^\d{4}$/),
		requirements: z.string().min(1).max(10_000),
		environment_id: z.string().optional(),
		constraints: z.record(z.unknown()).optional(),
	})
	.strict();

const validateSchema = z
	.object({
		draft_id: z.string().min(1),
		validation_profile: z.string().min(1).optional(),
	})
	.strict();

export function createBrokerLocalTools({
	docsMcpUrl,
	docsMcpToken,
	docsTimeoutMs,
	docsMaxResults,
	qmdKnowledgeEnabled,
	engineeringDraftTtlSeconds,
}) {
	const gatewayAdapter = docsMcpUrl
		? {
				search: async () => {
					throw new Error("gateway MCP nao implementado");
				},
				getChunk: async () => null,
			}
		: createFakeSiemensDocsGatewayAdapter();
	const localCatalogAdapter = createLocalCatalogAdapter();
	const qmdAdapter = createQmdAdapter({ enabled: qmdKnowledgeEnabled });
	const knowledgeRetriever = createKnowledgeRetriever({
		gatewayAdapter,
		localCatalogAdapter,
		qmdAdapter,
		maxResults: docsMaxResults ?? 8,
	});
	const draftStore = createDraftStore({
		ttlSeconds: engineeringDraftTtlSeconds ?? 300,
	});
	const engineeringAssistant = createEngineeringAssistant({ draftStore });

	return [
		{
			name: "tc_documentation_search",
			description:
				"Pesquisa documentacao Siemens/Teamcenter da release alvo. Somente leitura. Retorna trechos com proveniencia e referencias.",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string", description: "Termo de busca" },
					release: { type: "string", description: "Release alvo (4 digitos)" },
					artifact_kind: { type: "string", description: "Tipo de artefato" },
					domains: {
						type: "array",
						items: { type: "string" },
						description: "Dominios documentais",
					},
					top_k: { type: "number", description: "Maximo de resultados" },
				},
				required: ["query"],
			},
			handler: async (params) => {
				const parsed = searchSchema.safeParse(params);
				if (!parsed.success) {
					throw new Error(
						`parametros invalidos: ${parsed.error.issues[0].message}`,
					);
				}
				const { query, release, artifact_kind, domains, top_k } = parsed.data;
				const results = await knowledgeRetriever.search({
					query,
					release,
					artifactKind: artifact_kind,
					domains,
					limit: top_k,
				});
				return {
					results: results.map((r) => ({
						excerpt_id: r.excerpt_id,
						text: r.text.slice(0, 2_000),
						release: r.source_ref.release,
						domain: r.source_ref.domain,
						source_file: r.source_ref.source_file,
						section: r.source_ref.section,
						verification_status: r.source_ref.verification_status,
						provenance_score: r.provenance_score,
					})),
					count: results.length,
				};
			},
		},
		{
			name: "tc_artifact_draft",
			description:
				"Gera rascunho de artefato Teamcenter (saved query, workflow, etc.). Nao cria nem executa no ambiente.",
			parameters: {
				type: "object",
				properties: {
					artifact_kind: { type: "string", description: "Tipo de artefato" },
					release: { type: "string", description: "Release alvo (4 digitos)" },
					requirements: { type: "string", description: "Requisito funcional" },
					environment_id: { type: "string", description: "ID do ambiente" },
					constraints: {
						type: "object",
						description: "Restricoes adicionais",
					},
				},
				required: ["artifact_kind", "release", "requirements"],
			},
			handler: async (params) => {
				const parsed = draftSchema.safeParse(params);
				if (!parsed.success) {
					throw new Error(
						`parametros invalidos: ${parsed.error.issues[0].message}`,
					);
				}
				return engineeringAssistant.draft(parsed.data);
			},
		},
		{
			name: "tc_artifact_validate",
			description:
				"Valida um rascunho gerado anteriormente. Retorna findings de schema, release e restricoes.",
			parameters: {
				type: "object",
				properties: {
					draft_id: { type: "string", description: "ID do rascunho" },
					validation_profile: {
						type: "string",
						description: "Perfil de validacao",
					},
				},
				required: ["draft_id"],
			},
			handler: async (params) => {
				const parsed = validateSchema.safeParse(params);
				if (!parsed.success) {
					throw new Error(
						`parametros invalidos: ${parsed.error.issues[0].message}`,
					);
				}
				return engineeringAssistant.validate(parsed.data);
			},
		},
	];
}
