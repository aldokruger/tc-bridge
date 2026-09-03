// Registro unificado de tools expostas ao chat LLM.
// Esconde a diferenca entre execucao local (broker) e remota (agente).
//
// Interface:
//   toolRegistry.list({ allowedAgentActions, allowedLocalTools })
//   toolRegistry.execute({ name, arguments, executionContext })

export function createChatToolRegistry({ localAdapter, agentAdapter }) {
	return {
		list({
			allowedAgentActions = new Set(),
			allowedLocalTools = new Set(),
		} = {}) {
			const tools = [];
			// Tools locais
			for (const tool of localAdapter.list()) {
				if (allowedLocalTools.has(tool.name)) {
					tools.push({
						type: "function",
						function: {
							name: tool.name,
							description: tool.description,
							parameters: tool.parameters,
						},
					});
				}
			}
			// Tools remotas (actions do agente)
			const ACTION_TOOL_SCHEMAS = {
				"browser.status": {
					description:
						"Confirma o Chrome local do agente em depuracao remota. Nao acessa cookies, storage ou dados de login.",
					parameters: { type: "object", properties: {} },
				},
				"browser.pages": {
					description:
						"Lista as paginas Chrome depuraveis abertas no agente, sem query string, cookies ou corpos de requisicao.",
					parameters: { type: "object", properties: {} },
				},
				"browser.capture_diagnostics": {
					description:
						"Captura por periodo curto (maximo 15s) eventos novos de Console e Network de uma pagina Chrome do agente.",
					parameters: {
						type: "object",
						properties: {
							page_id: { type: "string", description: "ID da pagina" },
							capture_ms: {
								type: "number",
								minimum: 100,
								maximum: 15000,
							},
						},
					},
				},
				"browser.performance": {
					description:
						"Retorna metricas Performance CDP da pagina Chrome do agente. Somente leitura.",
					parameters: {
						type: "object",
						properties: {
							page_id: { type: "string", description: "ID da pagina" },
						},
					},
				},
				"diagnostic.run": {
					description:
						"Executa um diagnostico de host predefinido no agente: path_exists, service_status ou tcp_connect. Nao aceita comandos arbitrarios.",
					parameters: {
						type: "object",
						properties: {
							check: {
								type: "string",
								enum: ["path_exists", "service_status", "tcp_connect"],
							},
							remote_path: { type: "string" },
							service_name: { type: "string" },
							host: { type: "string" },
							port: { type: "number" },
						},
					},
				},
				"database.diagnostic": {
					description:
						"Executa um diagnostico MSSQL predefinido e somente leitura no agente. Nao aceita SQL arbitrario.",
					parameters: {
						type: "object",
						properties: {
							check: {
								type: "string",
								enum: [
									"database_files",
									"waits",
									"active_requests",
									"expensive_queries",
									"index_health",
								],
							},
							limit: { type: "number" },
						},
					},
				},
				"teamcenter.logs.read": {
					description:
						"Inspeciona logs Teamcenter no agente: list, tail ou search. Somente leitura, com limites e mascaramento de segredos.",
					parameters: {
						type: "object",
						properties: {
							operation: {
								type: "string",
								enum: ["list", "tail", "search"],
							},
							relative_path: { type: "string" },
							pattern: { type: "string" },
							file_glob: { type: "string" },
							max_lines: { type: "number" },
							max_files: { type: "number" },
							max_matches: { type: "number" },
						},
					},
				},
			};
			const GENERIC_TOOL_SCHEMA = {
				description:
					"Executa uma acao permitida no agente Teamcenter. Confirme os parametros exatos com o agente antes de chamar.",
				parameters: {
					type: "object",
					additionalProperties: true,
					description:
						"Parametros validados pelo agente no momento da execucao.",
				},
			};
			for (const action of [...allowedAgentActions].sort()) {
				if (action === "teamcenter.read") continue;
				const spec = ACTION_TOOL_SCHEMAS[action] || GENERIC_TOOL_SCHEMA;
				tools.push({
					type: "function",
					function: {
						name: action.replaceAll(".", "_"),
						description: spec.description,
						parameters: spec.parameters,
					},
				});
			}
			return tools;
		},
		async execute({ name, arguments: rawArguments, executionContext }) {
			const localNames = new Set(localAdapter.list().map((t) => t.name));
			if (localNames.has(name)) {
				return localAdapter.execute({
					name,
					arguments: rawArguments,
					executionContext,
				});
			}
			return agentAdapter.execute({ name, arguments: rawArguments });
		},
	};
}
