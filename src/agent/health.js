// Health/readiness do agente (plano Fase 2, entrega 2): liveness sempre
// reporta o processo vivo; readiness verifica dependencias reais (tunel,
// agente conectado, gate SOA fechado) e responde 503 quando algo falha.

export async function buildLiveness({ version = "unknown", metrics } = {}) {
	const snapshot = await metrics.snapshot({ version });
	return {
		ok: true,
		version: snapshot.version,
		uptimeMs: snapshot.uptimeMs,
	};
}

export async function buildReadiness({
	version = "unknown",
	metrics,
	checks = [],
} = {}) {
	const results = {};
	let ok = true;
	for (const check of checks) {
		const result = await check();
		results[result.name] = {
			ok: result.ok,
			detail: result.detail,
		};
		if (!result.ok) ok = false;
	}
	const snapshot = await metrics.snapshot({ version });
	return {
		ok,
		ready: ok,
		version: snapshot.version,
		uptimeMs: snapshot.uptimeMs,
		checks: results,
	};
}

export async function buildMetricsEndpoint({
	version = "unknown",
	metrics,
} = {}) {
	return metrics.snapshot({ version });
}
