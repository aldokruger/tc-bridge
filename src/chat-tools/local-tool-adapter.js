// Adapter para tools locais do broker (documentacao, geracao e validacao).
// Nao usa capability nem agente; executa no proprio processo do broker.
// Interface unificada com AgentActionAdapter para o ChatToolRegistry.

export function createLocalToolAdapter({ tools }) {
	const registry = new Map();
	for (const tool of tools) {
		registry.set(tool.name, tool);
	}
	return {
		kind: "local",
		list() {
			return [...registry.values()].map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: tool.parameters,
			}));
		},
		async execute({ name, arguments: rawArguments, executionContext }) {
			const tool = registry.get(name);
			if (!tool) {
				throw new Error(`tool local nao registrada: ${name}`);
			}
			let parameters = {};
			if (rawArguments) {
				try {
					parameters = JSON.parse(rawArguments);
				} catch {
					parameters = { _raw: String(rawArguments) };
				}
			}
			return tool.handler(parameters, executionContext);
		},
	};
}
