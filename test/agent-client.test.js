import assert from "node:assert/strict";
import test from "node:test";
import { parseBrokerAcceptance, parseBrokerTask } from "../src/zero-trust/agent-client.js";

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
		() => parseBrokerAcceptance({ type: "agent.accepted", agent_id: "other-agent" }, "agent-test"),
		/Aceite do broker invalido/,
	);
	assert.throws(
		() => parseBrokerAcceptance({ type: "agent.accepted", agent_id: "agent-test" }, "agent-test"),
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
	assert.throws(() => parseBrokerTask({ type: "task", task: {} }), /capability/);
	assert.throws(() => parseBrokerTask({ type: "other" }), /invalida/);
});
