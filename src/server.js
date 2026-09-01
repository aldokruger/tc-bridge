import crypto, { randomUUID } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express from "express";
import { z } from "zod";
import {
	buildLiveness,
	buildMetricsEndpoint,
	buildReadiness,
} from "./agent/health.js";
import { createMetrics } from "./agent/metrics.js";
import { makeTools } from "./tools.js";

export const APP_VERSION = "0.2.0";

function isInitializeRequest(body) {
	return body && body.method === "initialize";
}

// Aceita tanto o tipo nativo (numero/boolean via JSON-RPC) quanto a
// representacao em string (caso o cliente MCP serialize tudo como texto).
const zNumberLike = z.preprocess((value) => {
	if (
		typeof value === "string" &&
		value.trim() !== "" &&
		!Number.isNaN(Number(value))
	) {
		return Number(value);
	}
	return value;
}, z.number());

const zBooleanLike = z.preprocess((value) => {
	if (typeof value === "string") {
		if (value.toLowerCase() === "true") return true;
		if (value.toLowerCase() === "false") return false;
	}
	return value;
}, z.boolean());

function zodForType(type) {
	const optional = type.endsWith("?");
	const base = optional ? type.slice(0, -1) : type;
	let schema;
	switch (base) {
		case "number":
			schema = zNumberLike;
			break;
		case "boolean":
			schema = zBooleanLike;
			break;
		default:
			schema = z.string();
	}
	return optional ? schema.optional() : schema;
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
	const server = new McpServer({ name: "tc-bridge", version: APP_VERSION });
	for (const [name, tool] of Object.entries(tools)) {
		const shape = Object.fromEntries(
			Object.entries(tool.input).map(([key, type]) => [key, zodForType(type)]),
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
	const metrics = createMetrics();
	const tools = makeTools(cfg, { metrics });
	const sessions = new Map();
	const app = express();
	app.use(express.json({ limit: "20mb" }));

	// Liveness e readiness sao publicos (probes de orquestrador nao enviam
	// token); nao expoem paths, URLs ou credenciais.
	app.get("/health", async (_req, res) => {
		res.json(await buildLiveness({ version: APP_VERSION, metrics }));
	});

	app.get("/ready", async (_req, res) => {
		const readiness = await buildReadiness({
			version: APP_VERSION,
			metrics,
			checks: [
				() => ({
					name: "gate_soa",
					ok: !cfg.allowTeamcenterRead || !metrics.gateBreakerOpen(),
					detail: cfg.allowTeamcenterRead
						? "gate SOA fechado"
						: "SOA desabilitado",
				}),
			],
		});
		res.status(readiness.ready ? 200 : 503).json(readiness);
	});

	app.use((req, res, next) => {
		const header = req.headers.authorization || "";
		const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
		if (!provided || !safeEqual(provided, cfg.token)) {
			res.status(401).json({ error: "unauthorized" });
			return;
		}
		next();
	});

	// Metrics expoe detalhes do host (cpu/memoria/disco); exige token.
	app.get("/metrics", async (_req, res) => {
		res.json(await buildMetricsEndpoint({ version: APP_VERSION, metrics }));
	});

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
