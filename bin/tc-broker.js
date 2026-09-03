#!/usr/bin/env node
import fs from "node:fs/promises";
import https from "node:https";
import express from "express";
import { createBrokerLocalTools } from "../src/chat-tools/broker-local-tools.js";
import { createAdminConsoleApp } from "../src/zero-trust/admin-console.js";
import { AgentBroker } from "../src/zero-trust/broker.js";
import { createBrokerMcpApp } from "../src/zero-trust/cloud-mcp.js";

const port = Number(process.env.TC_BROKER_PORT || "8443");
const keyPath = process.env.TC_BROKER_TLS_KEY;
const certificatePath = process.env.TC_BROKER_TLS_CERTIFICATE;
const certificateAuthorityPath = process.env.TC_BROKER_CLIENT_CA;
const apiPort = Number(process.env.TC_BROKER_API_PORT || "8444");
const apiToken = process.env.TC_BROKER_API_TOKEN;
const adminToken = process.env.TC_BROKER_ADMIN_TOKEN;
const apiKeyPath = process.env.TC_BROKER_API_TLS_KEY || keyPath;
const apiCertificatePath =
	process.env.TC_BROKER_API_TLS_CERTIFICATE || certificatePath;
const capabilityPrivateKeyPath = process.env.TC_CAPABILITY_PRIVATE_KEY;
const capabilityIssuer = process.env.TC_CAPABILITY_ISSUER;
const allowedActions = process.env.TC_BROKER_ALLOWED_ACTIONS;
const capabilityTtlSeconds = Number(
	process.env.TC_CAPABILITY_TTL_SECONDS || "60",
);
for (const [name, value] of Object.entries({
	TC_BROKER_TLS_KEY: keyPath,
	TC_BROKER_TLS_CERTIFICATE: certificatePath,
	TC_BROKER_CLIENT_CA: certificateAuthorityPath,
	TC_BROKER_API_TOKEN: apiToken,
	TC_CAPABILITY_PRIVATE_KEY: capabilityPrivateKeyPath,
	TC_CAPABILITY_ISSUER: capabilityIssuer,
	TC_BROKER_ALLOWED_ACTIONS: allowedActions,
})) {
	if (!value) throw new Error(`${name} e obrigatorio para tc-broker`);
}
if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
	throw new Error("TC_BROKER_API_PORT deve ser uma porta entre 1 e 65535");
}
if (
	!Number.isInteger(capabilityTtlSeconds) ||
	capabilityTtlSeconds < 1 ||
	capabilityTtlSeconds > 300
) {
	throw new Error(
		"TC_CAPABILITY_TTL_SECONDS deve ser um inteiro entre 1 e 300",
	);
}
const [key, cert, ca, privateKey, apiKey, apiCertificate] = await Promise.all([
	fs.readFile(keyPath),
	fs.readFile(certificatePath),
	fs.readFile(certificateAuthorityPath),
	fs.readFile(capabilityPrivateKeyPath, "utf8"),
	fs.readFile(apiKeyPath),
	fs.readFile(apiCertificatePath),
]);
const { version } = JSON.parse(
	await fs.readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const broker = new AgentBroker({ tls: { key, cert, ca }, capabilityIssuer });
await broker.listen(port);
console.log(`[tc-broker] escutando com mTLS na porta ${port}`);
const actionSet = new Set(
	allowedActions
		.split(/[;,]/)
		.map((value) => value.trim())
		.filter(Boolean),
);
const mcpApp = createBrokerMcpApp({
	broker,
	token: apiToken,
	issuer: capabilityIssuer,
	privateKey,
	allowedActions: actionSet,
	subject: process.env.TC_BROKER_SUBJECT || "codex-service",
	capabilityTtlSeconds,
});
// Console admin deny-by-default: sem TC_BROKER_ADMIN_TOKEN nao ha rotas /admin.
const allowedLocalTools = new Set(
	(process.env.TC_BROKER_ALLOWED_LOCAL_TOOLS || "")
		.split(/[,;]/)
		.map((s) => s.trim())
		.filter(Boolean),
);
const localToolHandlers = createBrokerLocalTools({
	docsMcpUrl: process.env.TC_DOCS_MCP_URL,
	docsMcpToken: process.env.TC_DOCS_MCP_TOKEN,
	docsTimeoutMs: Number(process.env.TC_DOCS_TIMEOUT_MS || "10000"),
	docsMaxResults: Number(process.env.TC_DOCS_MAX_RESULTS || "8"),
	qmdKnowledgeEnabled: process.env.TC_QMD_KNOWLEDGE_ENABLED === "1",
	engineeringDraftTtlSeconds: Number(
		process.env.TC_ENGINEERING_DRAFT_TTL_SECONDS || "300",
	),
});
const adminApp = adminToken
	? createAdminConsoleApp({
			adminToken,
			broker,
			issuer: capabilityIssuer,
			privateKey,
			allowedActions: actionSet,
			allowedLocalTools,
			localToolHandlers,
			subject: process.env.TC_BROKER_SUBJECT || "admin-console",
			ttlSeconds: capabilityTtlSeconds,
			version,
		})
	: null;
const apiHandler = adminApp
	? express().use("/admin", adminApp).use(mcpApp)
	: mcpApp;
const apiServer = https.createServer(
	{ key: apiKey, cert: apiCertificate },
	apiHandler,
);
await new Promise((resolve, reject) => {
	apiServer.once("error", reject);
	apiServer.listen(apiPort, "0.0.0.0", () => {
		apiServer.off("error", reject);
		resolve();
	});
});
console.log(
	`[tc-broker] MCP cloud escutando em https://0.0.0.0:${apiPort}/mcp`,
);
if (adminApp) {
	console.log(
		`[tc-broker] console admin escutando em https://0.0.0.0:${apiPort}/admin`,
	);
}
function shutdown() {
	// server.close() espera conexões abertas terminarem; sem este prazo o
	// processo nunca sai e o systemd aplica SIGKILL após o TimeoutStopSec.
	const forceExit = setTimeout(() => process.exit(0), 5_000);
	forceExit.unref();
	// Sem o terminate, broker.server.close() espera os websockets upgradeados
	// dos agentes e o shutdown nunca resolve.
	for (const connection of broker.agents.values()) {
		try {
			connection.websocket.terminate();
		} catch {
			// websocket já encerrado
		}
	}
	apiServer.closeAllConnections?.();
	apiServer.close(() => broker.close().finally(() => process.exit(0)));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
