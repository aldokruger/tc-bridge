#!/usr/bin/env node
import fs from "node:fs/promises";
import { AgentBroker } from "../src/zero-trust/broker.js";

const port = Number(process.env.TC_BROKER_PORT || "8443");
const keyPath = process.env.TC_BROKER_TLS_KEY;
const certificatePath = process.env.TC_BROKER_TLS_CERTIFICATE;
const certificateAuthorityPath = process.env.TC_BROKER_CLIENT_CA;
for (const [name, value] of Object.entries({
	TC_BROKER_TLS_KEY: keyPath,
	TC_BROKER_TLS_CERTIFICATE: certificatePath,
	TC_BROKER_CLIENT_CA: certificateAuthorityPath,
})) {
	if (!value) throw new Error(`${name} e obrigatorio para tc-broker`);
}
const [key, cert, ca] = await Promise.all([
	fs.readFile(keyPath),
	fs.readFile(certificatePath),
	fs.readFile(certificateAuthorityPath),
]);
const broker = new AgentBroker({ tls: { key, cert, ca } });
await broker.listen(port);
console.log(`[tc-broker] escutando com mTLS na porta ${port}`);
process.on("SIGINT", () => broker.close());
process.on("SIGTERM", () => broker.close());
