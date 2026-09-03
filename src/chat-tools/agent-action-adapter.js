// Adapter para actions remotas do agente Windows.
// Preserva capability, allowedActions e transporte MCP existentes.
// Interface unificada com LocalToolAdapter para o ChatToolRegistry.

export function createAgentActionAdapter({
	broker,
	agentId,
	allowedActions,
	issuer,
	privateKey,
	subject,
	ttlSeconds,
}) {
	return {
		kind: "agent",
		async execute({ name, arguments: rawArguments }) {
			const action = [...allowedActions].find(
				(candidate) => candidate.replaceAll(".", "_") === name,
			);
			if (!action) {
				throw new Error(`acao nao permitida pela allowlist do broker: ${name}`);
			}
			let parameters = {};
			if (rawArguments) {
				try {
					parameters = JSON.parse(rawArguments);
				} catch {
					parameters = { _raw: String(rawArguments) };
				}
			}
			const { createCapabilityTask } = await import(
				"../zero-trust/cloud-mcp.js"
			);
			const task = createCapabilityTask({
				agentId,
				action,
				parameters,
				issuer,
				privateKey,
				subject,
				ttlSeconds,
			});
			return broker.dispatch(agentId, task);
		},
	};
}
