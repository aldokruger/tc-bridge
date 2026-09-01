import assert from "node:assert/strict";
import test from "node:test";
import { validateTeamcenterReadRequest } from "../src/teamcenter-soa.js";

test("accepts only read-only SOA requests with bounded JSON arrays", () => {
	assert.deepEqual(validateTeamcenterReadRequest({ check: "session_info" }), {
		check: "session_info",
	});
	assert.deepEqual(
		validateTeamcenterReadRequest({
			check: "get_object_properties",
			object_uid: "QUGAFoZZZ14QYA",
			property_names_json: '["awp0CellProperties"]',
		}),
		{
			check: "get_object_properties",
			objectUid: "QUGAFoZZZ14QYA",
			propertyNames: ["awp0CellProperties"],
		},
	);
	assert.deepEqual(
		validateTeamcenterReadRequest({
			check: "execute_saved_query",
			query_uid: "A1B2C3D4E5F6G7H8",
			entries_json: '["Item ID"]',
			values_json: '["12345"]',
			limit: 10,
		}),
		{
			check: "execute_saved_query",
			queryUid: "A1B2C3D4E5F6G7H8",
			entries: ["Item ID"],
			values: ["12345"],
			limit: 10,
		},
	);
	assert.throws(
		() =>
			validateTeamcenterReadRequest({
				check: "invoke_service",
				service: "Core",
			}),
		/nao permitida/,
	);
	assert.throws(
		() =>
			validateTeamcenterReadRequest({
				check: "execute_saved_query",
				query_uid: "bad",
				entries_json: "[]",
				values_json: "[]",
			}),
		/query_uid/,
	);
});
