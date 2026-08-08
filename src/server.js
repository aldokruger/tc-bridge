import crypto, { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import { makeTools } from "./tools.js";

function isInitializeRequest(body) {
	return body && body.method === "initialize";
}

function safeEqual(a, b) {
	const ha = crypto.createHash("sha256").update(a).digest();
	const hb = crypto.createHash("sha256").update(b).digest();
	return crypto.timingSafeEqual(ha, hb);
}

/**
 * Na v1.29 um Protocol/McpServer aceita UMA conexao por instancia
 * ("Already connected to a transport"). Criamos um McpServer novo para
 * cada sessao (initialize), como o proprio erro recomenda.
 */
function buildMcpServer(tools) {
	const server = new McpServer({ name: "tc-bridge", version: "0.1.0" });
	for (const [name, tool] of Object.entries(tools)) {
		const shape = Object.fromEntries(
			Object.entries(tool.input).map(([key, type]) => {
				const optional = type.endsWith("?");
				const base = z.string();
				return [key, optional ? base.optional() : base];
			}),
		);
		server.tool(name, tool.description, shape, async (args) => {
			try {
				const result = await tool.run(args);
				return { content: [{ type: "text", text: JSON.stringify(result) }] };
			} catch (err) {
				return {
					isError: true,
					content: [{ type: "text", text: `ERRO: ${err.message}` }],
				};
			}
		});
	}
	return server;
}

export function createApp(cfg) {
	const tools = makeTools(cfg);
	const sessions = new Map();
	const app = express();
	app.use(express.json({ limit: "20mb" }));

	app.use((req, res, next) => {
		const header = req.headers.authorization || "";
		const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
		if (!provided || !safeEqual(provided, cfg.token)) {
			res.status(401).json({ error: "unauthorized" });
			return;
		}
		next();
	});

	app.get("/health", (_req, res) => res.json({ ok: true }));

	const route = async (req, res) => {
		const sessionId = req.headers["mcp-session-id"];
		if (typeof sessionId === "string" && sessions.has(sessionId)) {
			const entry = sessions.get(sessionId);
			try {
				await entry.transport.handleRequest(req, res, req.body);
			} catch (err) {
				await entry.server.close().catch(() => {});
				sessions.delete(sessionId);
				res.status(500).json({
					jsonrpc: "2.0",
					error: { code: -32603, message: `Internal error: ${err.message}` },
					id: null,
				});
			}
			return;
		}

		if (!sessionId && isInitializeRequest(req.body)) {
			const server = buildMcpServer(tools);
			const transport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => randomUUID(),
				onsessioninitialized: (id) => sessions.set(id, { server, transport }),
			});
			transport.onclose = () => {
				if (transport.sessionId) sessions.delete(transport.sessionId);
			};
			try {
				await server.connect(transport);
				await transport.handleRequest(req, res, req.body);
			} catch (err) {
				await server.close().catch(() => {});
				res.status(500).json({
					jsonrpc: "2.0",
					error: { code: -32603, message: `Internal error: ${err.message}` },
					id: null,
				});
			}
			return;
		}
		if (sessionId) {
			res.status(404).json({
				jsonrpc: "2.0",
				error: { code: -32001, message: "Session not found" },
				id: null,
			});
			return;
		}
		res.status(400).json({
			jsonrpc: "2.0",
			error: { code: -32000, message: "Session ID required" },
			id: null,
		});
	};

	app.post("/mcp", route);
	app.get("/mcp", route);
	app.delete("/mcp", route);

	return app;
}
