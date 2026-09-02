import fs from "node:fs/promises";

// Self-metrics do agente (plano, secao 13): contadores agregados em memoria
// e snapshot com uso de CPU/memoria/disco do processo. O gate SOA pode ser
// anexado para expor fila e saturacao no mesmo snapshot.

export function createMetrics() {
	const counters = {
		checksStarted: 0,
		checksCompleted: 0,
		checksFailed: 0,
		durationMs: 0,
		bytesCollected: 0,
		bytesReturned: 0,
		truncations: 0,
		partialErrorEvents: 0,
		reconnects: 0,
		updatesApplied: 0,
		rollbacks: 0,
		redactionFailures: 0,
		bufferPushes: 0,
		bufferDrops: 0,
	};
	const startedAt = Date.now();
	let gate = null;

	return {
		attachGate(soaGate) {
			gate = soaGate;
		},
		gateBreakerOpen() {
			return Boolean(gate?.state().breakerOpen);
		},
		recordCheck({
			failed = false,
			truncated = false,
			partialErrors = 0,
			durationMs = 0,
			bytesCollected = 0,
			bytesReturned = 0,
		} = {}) {
			counters.checksStarted += 1;
			if (failed) {
				counters.checksFailed += 1;
			} else {
				counters.checksCompleted += 1;
			}
			counters.durationMs += durationMs;
			counters.bytesCollected += bytesCollected;
			counters.bytesReturned += bytesReturned;
			if (truncated) counters.truncations += 1;
			if (partialErrors > 0) counters.partialErrorEvents += 1;
		},
		recordReconnect() {
			counters.reconnects += 1;
		},
		recordUpdate(applied) {
			if (applied) {
				counters.updatesApplied += 1;
			} else {
				counters.rollbacks += 1;
			}
		},
		recordRedactionFailure() {
			counters.redactionFailures += 1;
		},
		recordBufferPush() {
			counters.bufferPushes += 1;
		},
		recordBufferDrop() {
			counters.bufferDrops += 1;
		},
		async snapshot({ version = "unknown" } = {}) {
			const memory = process.memoryUsage();
			let disk = null;
			try {
				const stat = await fs.statfs(".");
				disk = {
					blockSize: stat.bsize,
					totalBytes: stat.blocks * stat.bsize,
					freeBytes: stat.bavail * stat.bsize,
				};
			} catch {
				disk = null;
			}
			return {
				version,
				uptimeMs: Date.now() - startedAt,
				counters: { ...counters },
				system: {
					cpu: {
						userMicros: process.cpuUsage().user,
						systemMicros: process.cpuUsage().system,
					},
					memory: { rss: memory.rss, heapUsed: memory.heapUsed },
					disk,
				},
				gate: gate ? gate.state() : null,
			};
		},
	};
}
