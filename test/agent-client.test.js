import assert from "node:assert/strict";
import test from "node:test";
import { parseBrokerTask } from "../src/zero-trust/agent-client.js";

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
