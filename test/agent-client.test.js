import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createMetrics } from "../src/agent/metrics.js";
import {
	computeReconnectDelay,
	parseBrokerAcceptance,
	parseBrokerTask,
	ReverseAgentClient,
} from "../src/zero-trust/agent-client.js";
import { AgentBroker } from "../src/zero-trust/broker.js";

const certDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	"certs",
);

async function readCerts() {
	const [ca, brokerKey, brokerCert, agentKey, agentCert] = await Promise.all([
		fs.readFile(path.join(certDir, "ca.pem")),
		fs.readFile(path.join(certDir, "broker-key.pem")),
		fs.readFile(path.join(certDir, "broker-cert.pem")),
		fs.readFile(path.join(certDir, "agent-key.pem")),
		fs.readFile(path.join(certDir, "agent-cert.pem")),
	]);
	return { ca, brokerKey, brokerCert, agentKey, agentCert };
}

test("accepts the capability issuer announced by the authenticated broker", () => {
	assert.equal(
		parseBrokerAcceptance(
			{
				type: "agent.accepted",
				agent_id: "agent-test",
				capability_issuer: "https://broker.example.test",
			},
			"agent-test",
		),
		"https://broker.example.test",
	);
	assert.throws(
		() =>
			parseBrokerAcceptance(
				{ type: "agent.accepted", agent_id: "other-agent" },
				"agent-test",
			),
		/Aceite do broker invalido/,
	);
	assert.throws(
		() =>
			parseBrokerAcceptance(
				{ type: "agent.accepted", agent_id: "agent-test" },
				"agent-test",
			),
		/emissor/,
	);
});

test("accepts only a complete broker task envelope", () => {
	assert.deepEqual(
		parseBrokerTask({
			type: "task",
			task: { task_id: "task-1", capability: "jws", task_json: "{}" },
		}),
		{ task_id: "task-1", capability: "jws", task_json: "{}" },
	);
	assert.throws(
		() => parseBrokerTask({ type: "task", task: {} }),
		/capability/,
	);
	assert.throws(() => parseBrokerTask({ type: "other" }), /invalida/);
});

test("reconnect delay grows exponentially with jitter and caps at max", () => {
	const randomOne = () => 1;
	const randomZero = () => 0;
	assert.equal(computeReconnectDelay(1, 5_000, 60_000, randomOne), 5_000);
	assert.equal(computeReconnectDelay(2, 5_000, 60_000, randomOne), 10_000);
	assert.equal(computeReconnectDelay(3, 5_000, 60_000, randomOne), 20_000);
	assert.equal(computeReconnectDelay(4, 5_000, 60_000, randomOne), 40_000);
	assert.equal(computeReconnectDelay(5, 5_000, 60_000, randomOne), 60_000);
	assert.equal(computeReconnectDelay(9, 5_000, 60_000, randomOne), 60_000);
	assert.equal(computeReconnectDelay(2, 5_000, 60_000, randomZero), 5_000);
	assert.equal(computeReconnectDelay(3, 5_000, 60_000, randomZero), 10_000);
});

test("buffers the task result while disconnected and flushes it after reconnect", async (t) => {
	const { ca, brokerKey, brokerCert, agentKey, agentCert } = await readCerts();
	const metrics = createMetrics();

	const broker = new AgentBroker({
		tls: { key: brokerKey, cert: brokerCert, ca },
		capabilityIssuer: "https://broker.example.test",
		taskTimeoutMs: 5_000,
		logger: { warn: () => {}, error: () => {} },
	});
	await broker.listen(0, "127.0.0.1");
	const port = broker.server.address().port;
	t.after(() => client.stop());
	t.after(() => broker.close());

	const quietLogger = { warn: () => {}, error: () => {} };
	let releaseTask;
	const taskGate = new Promise((resolve) => {
		releaseTask = resolve;
	});

	const client = new ReverseAgentClient({
		brokerUrl: `wss://localhost:${port}/agent`,
		agentId: "agent-test",
		tls: { cert: agentCert, key: agentKey, ca },
		reconnectMs: 20,
		maxReconnectMs: 100,
		resultBufferCapacity: 10,
		metrics,
		logger: quietLogger,
		executeTask: async () => {
			await taskGate;
			return { ok: true };
		},
	});
	client.start();

	// wait until the broker has accepted the agent
	await new Promise((resolve) => {
		const check = setInterval(() => {
			if (broker.listAgents().some((a) => a.agent_id === "agent-test")) {
				clearInterval(check);
				resolve();
			}
		}, 5);
	});

	const dispatchPromise = broker.dispatch("agent-test", {
		capability: "jws",
		task_json: "{}",
	});

	// give the agent a moment to receive the task and start executing it,
	// then drop the connection while the task is still in flight
	await new Promise((resolve) => setTimeout(resolve, 50));
	client.socket.close();
	releaseTask();

	const result = await dispatchPromise;
	assert.deepEqual(result, { ok: true });

	const snapshot = await metrics.snapshot({ version: "v" });
	assert.ok(snapshot.counters.bufferPushes >= 1, "result was buffered");
	assert.equal(snapshot.counters.bufferDrops, 0);
});
