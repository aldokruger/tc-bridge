import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import express from "express";
import { z } from "zod";
import { createAgentActionAdapter } from "../chat-tools/agent-action-adapter.js";
import { createLocalToolAdapter } from "../chat-tools/local-tool-adapter.js";
import { createChatToolRegistry } from "../chat-tools/registry.js";
import { createCapabilityTask } from "./cloud-mcp.js";
import {
	executeWorkflow,
	QUICK_ACTIONS,
	runChatTurn,
	WORKFLOWS,
} from "./llm-chat.js";

const ADMIN_UI_DIR = fileURLToPath(new URL("./admin-ui", import.meta.url));

const COOKIE_NAME = "tc_admin_session";
const SESSION_TTL_MS = 30 * 60 * 1000;
const AUDIT_LIMIT = 200;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_WINDOW_MS = 60_000;

function safeEqual(a, b) {
	const left = crypto.createHash("sha256").update(a).digest();
	const right = crypto.createHash("sha256").update(b).digest();
	return crypto.timingSafeEqual(left, right);
}

function parseCookies(header) {
	const cookies = {};
	if (typeof header !== "string") return cookies;
	for (const part of header.split(";")) {
		const eq = part.indexOf("=");
		if (eq === -1) continue;
		cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
	}
	return cookies;
}

const loginSchema = z.object({
	token: z.string().min(1),
});

const checkSchema = z.object({
	action: z.string().min(1),
	parameters: z.record(z.string(), z.unknown()).optional(),
});

const chatMessageSchema = z.object({
	role: z.enum(["user", "assistant"]),
	content: z.string().max(100_000),
});

const chatSchema = z.object({
	agent_id: z.string().min(1),
	llm: z.object({
		base_url: z.string().url(),
		model: z.string().min(1),
		api_key: z.string().min(1),
	}),
	messages: z.array(chatMessageSchema).max(100),
	context_id: z.string().optional(),
});

export function createAdminConsoleApp({
	adminToken,
	broker,
	issuer,
	privateKey,
	allowedActions,
	allowedLocalTools = new Set(),
	localToolHandlers = [],
	subject = "admin-console",
	ttlSeconds = 60,
	version = "0.0.0",
}) {
	if (!adminToken || !broker) {
		throw new Error(
			"adminToken e broker sao obrigatorios para o console admin",
		);
	}

	const app = express();
	const sessions = new Map();
	const audit = [];
	const loginFailures = new Map();

	app.disable("x-powered-by");
	// O historico de /v1/chat pode passar de 64kb (schema: ate 100 msgs de
	// 100k). Parser proprio antes do json global; o body-parser ignora corpos
	// ja parseados (req._body), entao as demais rotas mantem o limite menor.
	app.post("/v1/chat", express.json({ limit: "10mb" }), (_req, _res, next) =>
		next(),
	);
	app.use(express.json({ limit: "64kb" }));
	app.use((req, res, next) => {
		res.setHeader("X-Content-Type-Options", "nosniff");
		res.setHeader("Referrer-Policy", "no-referrer");
		// O console e somente leitura; nunca deixar a UI ser embutida.
		res.setHeader("X-Frame-Options", "DENY");
		if (req.path.startsWith("/v1/")) {
			res.setHeader("Cache-Control", "no-store");
		}
		next();
	});
	// Guarda de Origin: aceita somente requisicoes sem Origin (curl, mesmo
	// processo) ou com Origin igual ao Host. Bloqueia navegador cross-site.
	app.use("/v1", (req, res, next) => {
		const origin = req.headers.origin;
		if (origin && origin !== `https://${req.headers.host}`) {
			return res.status(403).json({ error: "origem nao permitida" });
		}
		next();
	});

	function emitAudit(event) {
		audit.unshift({ timestamp: new Date().toISOString(), ...event });
		if (audit.length > AUDIT_LIMIT) audit.length = AUDIT_LIMIT;
	}

	function requireSession(req, res, next) {
		const sessionId = parseCookies(req.headers.cookie)[COOKIE_NAME];
		const session = sessionId && sessions.get(sessionId);
		if (!session || session.expiresAt <= Date.now()) {
			if (sessionId) sessions.delete(sessionId);
			return res
				.status(401)
				.json({ error: "sessao ausente ou expirada; faca login" });
		}
		req.session = session;
		next();
	}

	function loginThrottled(ip) {
		const now = Date.now();
		const entry = loginFailures.get(ip);
		if (!entry || entry.resetAt <= now) {
			loginFailures.set(ip, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
			return false;
		}
		return entry.count >= LOGIN_MAX_FAILURES;
	}

	function recordLoginFailure(ip) {
		const now = Date.now();
		const entry = loginFailures.get(ip);
		if (!entry || entry.resetAt <= now) {
			loginFailures.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
			return;
		}
		entry.count += 1;
	}

	app.post("/v1/login", (req, res) => {
		if (loginThrottled(req.ip)) {
			emitAudit({ event: "login.throttled", ip: req.ip });
			return res.status(429).json({ error: "muitas tentativas; aguarde" });
		}
		const parsed = loginSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({ error: "body deve ser { token: string }" });
		}
		if (!safeEqual(parsed.data.token, adminToken)) {
			recordLoginFailure(req.ip);
			emitAudit({ event: "login.failed", ip: req.ip });
			return res.status(401).json({ error: "token admin invalido" });
		}
		loginFailures.delete(req.ip);
		const sessionId = crypto.randomBytes(32).toString("hex");
		sessions.set(sessionId, {
			role: "admin",
			createdAt: new Date().toISOString(),
			expiresAt: Date.now() + SESSION_TTL_MS,
		});
		emitAudit({ event: "login.success", role: "admin" });
		res.setHeader(
			"Set-Cookie",
			`${COOKIE_NAME}=${sessionId}; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=${SESSION_TTL_MS / 1000}`,
		);
		return res.json({ ok: true, role: "admin" });
	});

	app.post("/v1/logout", requireSession, (req, res) => {
		const sessionId = parseCookies(req.headers.cookie)[COOKIE_NAME];
		sessions.delete(sessionId);
		emitAudit({ event: "logout", role: req.session.role });
		res.setHeader(
			"Set-Cookie",
			`${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Strict; Path=/admin; Max-Age=0`,
		);
		return res.json({ ok: true });
	});

	app.get("/v1/context", requireSession, (_req, res) =>
		res.json({
			service: "tc-broker",
			version,
			user: { role: "admin" },
			features: {
				config_edit: false,
				checks: true,
				chat: true,
				restart: false,
				oidc: false,
			},
		}),
	);

	app.get("/v1/health", requireSession, (_req, res) =>
		res.json({
			ok: true,
			agents_connected: broker.agents.size,
			tasks_pending: broker.pendingTasks.size,
			uptime_s: Math.round(process.uptime()),
		}),
	);

	app.get("/v1/config", requireSession, (_req, res) =>
		res.json({
			source: "environment",
			read_only: true,
			capability_issuer: issuer,
			subject,
			capability_ttl_seconds: ttlSeconds,
			allowed_actions: [...allowedActions].sort(),
		}),
	);

	app.get("/v1/agents", requireSession, (_req, res) => {
		const agents = broker.listAgents().map((agent) => ({
			...agent,
			pending_tasks: broker.pendingFor(agent.agent_id).length,
		}));
		return res.json({ agents });
	});

	app.get("/v1/agents/:id", requireSession, (req, res) => {
		const agent = broker.listAgents().find((a) => a.agent_id === req.params.id);
		if (!agent) return res.status(404).json({ error: "agente nao encontrado" });
		return res.json({
			...agent,
			pending_tasks: broker.pendingFor(agent.agent_id),
		});
	});

	app.get("/v1/tasks", requireSession, (req, res) => {
		const limit = Math.min(Number(req.query.limit) || 100, 500);
		return res.json({ tasks: broker.listTasks().slice(0, limit) });
	});

	app.get("/v1/audit", requireSession, (req, res) => {
		const limit = Math.min(Number(req.query.limit) || 50, 200);
		return res.json({ events: audit.slice(0, limit) });
	});

	app.post("/v1/agents/:id/checks", requireSession, async (req, res) => {
		const parsed = checkSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({
				error: "body deve ser { action: string, parameters?: object }",
			});
		}
		const { action, parameters } = parsed.data;
		if (!allowedActions.has(action)) {
			return res.status(403).json({
				error: `acao nao permitida pela allowlist do broker: ${action}`,
			});
		}
		try {
			const task = createCapabilityTask({
				agentId: req.params.id,
				action,
				parameters: parameters ?? {},
				issuer,
				privateKey,
				subject,
				ttlSeconds,
			});
			const result = await broker.dispatch(req.params.id, task);
			emitAudit({
				event: "check.completed",
				agent_id: req.params.id,
				action,
			});
			return res.json({ ok: true, result });
		} catch (error) {
			emitAudit({
				event: "check.failed",
				agent_id: req.params.id,
				action,
				error: error.message,
			});
			return res.status(502).json({ error: error.message });
		}
	});

	app.get("/v1/suggestions", requireSession, (_req, res) => {
		res.json({
			quickActions: QUICK_ACTIONS,
			workflows: WORKFLOWS.map((w) => ({
				id: w.id,
				label: w.label,
				description: w.description,
				stepCount: w.steps.length,
			})),
		});
	});

	app.post("/v1/workflow", requireSession, async (req, res) => {
		const body = req.body ?? {};
		const { workflowId, agentId, llm } = body;
		if (!workflowId || !agentId) {
			return res
				.status(400)
				.json({ error: "workflowId e agentId sao obrigatorios" });
		}
		const workflow = WORKFLOWS.find((w) => w.id === workflowId);
		if (!workflow) {
			return res.status(404).json({ error: "workflow nao encontrado" });
		}
		if (!broker.agents.get(agentId)) {
			return res.status(404).json({ error: "agente indisponivel" });
		}
		emitAudit({
			event: "workflow.start",
			agent_id: agentId,
			workflow: workflowId,
		});
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-store",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		const sendEvent = (event) => {
			if (res.destroyed || res.writableEnded) return;
			res.write(`data: ${JSON.stringify(event)}\n\n`);
		};
		const heartbeat = setInterval(() => {
			if (res.destroyed || res.writableEnded) return;
			res.write(": keep-alive\n\n");
		}, 15_000);
		try {
			const agentAdapter = createAgentActionAdapter({
				broker,
				agentId,
				allowedActions,
				issuer,
				privateKey,
				subject,
				ttlSeconds,
			});
			const localAdapter = createLocalToolAdapter({ tools: localToolHandlers });
			const toolRegistry = createChatToolRegistry({
				localAdapter,
				agentAdapter,
			});
			const dispatchTool = (toolName, rawArgs) =>
				toolRegistry.execute({
					name: toolName,
					arguments: rawArgs,
					executionContext: { agentId, broker },
				});
			const results = await executeWorkflow({
				workflow,
				agentId,
				dispatchTool,
				onEvent: sendEvent,
			});
			emitAudit({
				event: "workflow.done",
				agent_id: agentId,
				workflow: workflowId,
			});
			sendEvent({ type: "workflow_done", results });
			res.end();
		} catch (error) {
			emitAudit({
				event: "workflow.failed",
				agent_id: agentId,
				workflow: workflowId,
				error: error.message,
			});
			if (!res.destroyed && !res.writableEnded) {
				sendEvent({ type: "error", error: error.message });
				res.end();
			}
		} finally {
			clearInterval(heartbeat);
		}
	});

	// Chat com LLM: o broker orquestra a conversa e o dispatch de tools no
	// agente. Resposta em SSE. A api_key da LLM chega no body (HTTPS), fica
	// somente na memoria durante o request e nao vai a disco nem a logs.
	app.post("/v1/chat", requireSession, async (req, res) => {
		const parsed = chatSchema.safeParse(req.body);
		if (!parsed.success) {
			return res.status(400).json({
				error:
					"body deve ser { agent_id, llm: { base_url, model, api_key }, messages: [{role, content}] }",
			});
		}
		const { agent_id: agentId, llm, messages } = parsed.data;
		emitAudit({
			event: "chat.start",
			agent_id: agentId,
			llm_model: llm.model,
			messages: messages.length,
		});
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-store",
			Connection: "keep-alive",
			"X-Accel-Buffering": "no",
		});
		const sendEvent = (event) => {
			if (res.destroyed || res.writableEnded) return;
			res.write(`data: ${JSON.stringify(event)}\n\n`);
		};
		const abortController = new AbortController();
		res.on("close", () => abortController.abort());
		// Heartbeat: turnos longos deixam o SSE ocioso e NATs derrubam a
		// conexao ("Failed to fetch"). Comentario SSE e ignorado pelo parser.
		const heartbeat = setInterval(() => {
			if (res.destroyed || res.writableEnded) return;
			res.write(": keep-alive\n\n");
		}, 15_000);
		try {
			const agentAdapter = createAgentActionAdapter({
				broker,
				agentId,
				allowedActions,
				issuer,
				privateKey,
				subject,
				ttlSeconds,
			});
			const localAdapter = createLocalToolAdapter({ tools: localToolHandlers });
			const toolRegistry = createChatToolRegistry({
				localAdapter,
				agentAdapter,
			});
			await runChatTurn({
				broker,
				agentId,
				allowedActions,
				issuer,
				privateKey,
				subject,
				ttlSeconds,
				llm,
				messages,
				signal: abortController.signal,
				onEvent: sendEvent,
				toolRegistry,
			});
			emitAudit({
				event: "chat.done",
				agent_id: agentId,
				llm_model: llm.model,
			});
			sendEvent({ type: "end" });
			res.end();
		} catch (error) {
			if (abortController.signal.aborted) {
				emitAudit({
					event: "chat.aborted",
					agent_id: agentId,
					llm_model: llm.model,
				});
				return;
			}
			emitAudit({
				event: "chat.failed",
				agent_id: agentId,
				llm_model: llm.model,
				error: error.message,
			});
			if (!res.destroyed && !res.writableEnded) {
				sendEvent({ type: "error", error: error.message });
				res.end();
			}
		} finally {
			clearInterval(heartbeat);
		}
	});

	// UI estatica do console sob /admin (montado em /admin pelo entrypoint).
	// Rotas /v1/* ficam acima do static; /v1 desconhecido cai aqui como 404.
	app.use(express.static(ADMIN_UI_DIR));
	app.use((_req, res) =>
		res.status(404).json({ error: "rota nao encontrada" }),
	);

	return app;
}
