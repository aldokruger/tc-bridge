// Buffer local limitado de resultados pendentes (plano, entrega 8): guarda
// envelopes de task.result quando o socket do broker esta fechado e os
// reenvia na reconexao. Capacidade finita com politica drop-oldest para nao
// crescer sem limite quando o broker fica indisponivel por muito tempo.

export function createResultBuffer({
	capacity = 100,
	metrics,
	logger = console,
} = {}) {
	if (!Number.isInteger(capacity) || capacity < 1) {
		throw new Error("Capacidade do buffer de resultados deve ser >= 1");
	}
	const items = [];
	return {
		get size() {
			return items.length;
		},
		push(envelope) {
			if (items.length >= capacity) {
				items.shift();
				metrics?.recordBufferDrop();
				logger.warn(
					"[tc-agent] buffer de resultados cheio; descartando o mais antigo",
				);
			}
			items.push(envelope);
			metrics?.recordBufferPush();
		},
		drain() {
			return items.splice(0, items.length);
		},
	};
}
