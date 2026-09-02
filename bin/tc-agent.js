#!/usr/bin/env node
import fs from "node:fs/promises";
import dotenv from "dotenv";
import { loadConfig } from "../src/config.js";
import { makeTools } from "../src/tools.js";
import { ReverseAgentClient } from "../src/zero-trust/agent-client.js";

dotenv.config({ override: true, quiet: true });

const cfg = loadConfig({});
const brokerUrl = process.env.TC_BROKER_URL;
const certificatePath = process.env.TC_AGENT_CERTIFICATE;
const privateKeyPath = process.env.TC_AGENT_PRIVATE_KEY;
const certificateAuthorityPath = process.env.TC_BROKER_CA;

if (!cfg.allowCapabilityTasks)
	throw new Error("TC_ALLOW_CAPABILITY_TASKS=1 e obrigatorio para tc-agent");
for (const [name, value] of Object.entries({
	TC_BROKER_URL: brokerUrl,
	TC_AGENT_CERTIFICATE: certificatePath,
	TC_AGENT_PRIVATE_KEY: privateKeyPath,
	TC_BROKER_CA: certificateAuthorityPath,
})) {
	if (!value) throw new Error(`${name} e obrigatorio para tc-agent`);
}
if (!brokerUrl.startsWith("wss://"))
	throw new Error("TC_BROKER_URL deve usar wss://");

const tools = makeTools(cfg);
if (!tools.tc_authorized_task)
	throw new Error("tc_authorized_task nao foi habilitada");
const [cert, key, ca] = await Promise.all([
	fs.readFile(certificatePath),
	fs.readFile(privateKeyPath),
	fs.readFile(certificateAuthorityPath),
]);
const client = new ReverseAgentClient({
	brokerUrl,
	agentId: cfg.agentId,
	tls: { cert, key, ca },
	resultBufferCapacity: cfg.agentResultBufferCapacity,
	onAccepted: (issuer) => tools.tc_authorized_task.setIssuer(issuer),
	executeTask: (task) => tools.tc_authorized_task.run(task),
});
client.start();
process.on("SIGINT", () => client.stop());
process.on("SIGTERM", () => client.stop());
