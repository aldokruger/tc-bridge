import assert from "node:assert/strict";
import test from "node:test";
import { createMetrics } from "../src/agent/metrics.js";
import { createResultBuffer } from "../src/agent/result-buffer.js";

const silentLogger = { warn() {} };

test("buffer FIFO: push/drain preserva ordem e zera size", () => {
	const buffer = createResultBuffer({ capacity: 3, logger: silentLogger });
	buffer.push("a");
	buffer.push("b");
	assert.equal(buffer.size, 2);
	assert.deepEqual(buffer.drain(), ["a", "b"]);
	assert.equal(buffer.size, 0);
	assert.deepEqual(buffer.drain(), []);
});

test("buffer drop-oldest descarta o envelope mais antigo quando cheio", async () => {
	const metrics = createMetrics();
	const buffer = createResultBuffer({
		capacity: 2,
		metrics,
		logger: silentLogger,
	});
	buffer.push("a");
	buffer.push("b");
	buffer.push("c");
	assert.equal(buffer.size, 2);
	assert.deepEqual(buffer.drain(), ["b", "c"]);
	const snapshot = await metrics.snapshot({ version: "v" });
	assert.equal(snapshot.counters.bufferPushes, 3);
	assert.equal(snapshot.counters.bufferDrops, 1);
});

test("buffer rejeita capacidade invalida", () => {
	assert.throws(() => createResultBuffer({ capacity: 0 }), />= 1/);
	assert.throws(() => createResultBuffer({ capacity: -1 }), />= 1/);
	assert.throws(() => createResultBuffer({ capacity: 1.5 }), />= 1/);
});
