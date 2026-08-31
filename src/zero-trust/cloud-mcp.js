import crypto from "node:crypto";
import { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { signCapability } from "./capability.js";

function safeEqual(a, b) {
	const left = crypto.createHash("sha256").update(a).digest();
	const right = crypto.createHash("sha256").update(b).digest();
	return crypto.timingSafeEqual(left, right);
}

export function isAuthorizedRequest(header, expectedToken) {
	if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
	const token = header.slice(7);
	return Boolean(token) && safeEqual(token, expectedToken);
}

function capabilityScope(parameters) {
	return Object.fromEntries(
		Object.entries(parameters).map(([name, value]) => [
			name === "capture_ms" || name === "limit" ? `max_${name}` : name,
			value,
		]),
	);
}

export function createCapabilityTask({
	agentId,
	action,
	parameters,
	issuer,
	privateKey,
	subject,
	ttlSeconds,
}) {
	const now = Math.floor(Date.now() / 1_000);
	return {
		capability: signCapability(
			{
				iss: issuer,
				aud: agentId,
				sub: subject,
				action,
				scope: capabilityScope(parameters),
				iat: now,
				exp: now + ttlSeconds,
				jti: crypto.randomUUID(),
			},
			privateKey,
		),
		task_json: JSON.stringify({ action, parameters }),
	};
}

function buildServer(config) {
	const server = new McpServer({ name: "tc-broker", version: "0.2.0" });
	server.tool(
		"tc_list_agents",
		"Lista agentes Teamcenter conectados ao broker.",
		{},
		async () => ({
			content: [{ type: "text", text: JSON.stringify(config.broker.listAgents()) }],
		}),
	);
	server.tool(
		"tc_dispatch_authorized_task",
		"Assina uma capability de uso unico e executa uma acao permitida em um agente conectado.",
		{
			agent_id: z.string().min(1),
			action: z.string().min(1),
			parameters: z.record(z.string(), z.unknown()),
		},
		async ({ agent_id: agentId, action, parameters }) => {
			if (!config.allowedActions.has(action)) {
				return {
					isError: true,
					content: [{ type: "text", text: "ERRO: Acao bloqueada pela politica do broker" }],
				};
			}
			try {
				const task = createCapabilityTask({
					agentId,
					action,
					parameters,
					issuer: config.issuer,
					privateKey: config.privateKey,
					subject: config.subject,
					ttlSeconds: config.capabilityTtlSeconds,
				});
				const result = await config.broker.dispatch(agentId, task);
				return { content: [{ type: "text", text: JSON.stringify(result) }] };
			} catch (error) {
				return {
					isError: true,
					content: [{ type: "text", text: `ERRO: ${error.message}` }],
				};
			}
		},
	);
	return server;
}

export function createBrokerMcpApp(config) {
	const app = express();
	const sessions = new Map();
	app.use(express.json({ limit: "1mb" }));
	app.use((req, res, next) => {
		if (!isAuthorizedRequest(req.headers.authorization, config.token)) {
			return res.status(401).json({ error: "unauthorized" });
		}
		next();
	});
	app.get("/health", (_req, res) => res.json({ ok: true }));
	const route = async (req, res) => {
		const sessionId = req.headers["mcp-session-id"];
		if (typeof sessionId === "string" && sessions.has(sessionId)) {
			return sessions.get(sessionId).transport.handleRequest(req, res, req.body);
		}
		if (!sessionId && req.body?.method === "initialize") {
			const server = buildServer(config);
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
				onsessioninitialized: (id) => sessions.set(id, { server, transport }),
			});
			transport.onclose = () => sessions.delete(transport.sessionId);
			await server.connect(transport);
			return transport.handleRequest(req, res, req.body);
		}
		return res.status(sessionId ? 404 : 400).json({
			error: sessionId ? "Session not found" : "Session ID required",
		});
	};
	app.post("/mcp", route);
	app.get("/mcp", route);
	app.delete("/mcp", route);
	return app;
}
