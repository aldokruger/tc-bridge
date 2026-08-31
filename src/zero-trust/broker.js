import https from "node:https";
import crypto from "node:crypto";
import WebSocket, { WebSocketServer } from "ws";

function parseMessage(payload) {
	try {
		return JSON.parse(payload.toString());
	} catch {
		throw new Error("Mensagem JSON invalida");
	}
}

export class AgentBroker {
	constructor({ tls, capabilityIssuer, requireCertificateCnMatch = true, taskTimeoutMs = 60_000 }) {
		if (typeof capabilityIssuer !== "string" || !capabilityIssuer) {
			throw new Error("Emissor de capability obrigatorio para o broker");
		}
		this.agents = new Map();
		this.pendingTasks = new Map();
		this.capabilityIssuer = capabilityIssuer;
		this.requireCertificateCnMatch = requireCertificateCnMatch;
		this.taskTimeoutMs = taskTimeoutMs;
		this.server = https.createServer({ ...tls, requestCert: true, rejectUnauthorized: true });
		this.webSocketServer = new WebSocketServer({ noServer: true, perMessageDeflate: false });
		this.server.on("upgrade", (request, socket, head) => {
			if (request.url !== "/agent" || !request.socket.authorized) return socket.destroy();
			this.webSocketServer.handleUpgrade(request, socket, head, (websocket) => {
				this.webSocketServer.emit("connection", websocket, request);
			});
		});
		this.webSocketServer.on("connection", (websocket, request) => this.#accept(websocket, request));
	}

	#accept(websocket, request) {
		const certificate = request.socket.getPeerCertificate();
		let agentId;
		const helloTimeout = setTimeout(() => websocket.close(1008, "agent hello timeout"), 10_000);
		websocket.once("message", (payload) => {
			try {
				const message = parseMessage(payload);
				if (message.type !== "agent.hello" || typeof message.agent_id !== "string") throw new Error("agent.hello obrigatorio");
				agentId = message.agent_id;
				if (this.requireCertificateCnMatch && certificate?.subject?.CN !== agentId) {
					throw new Error("CN do certificado nao corresponde ao agent_id");
				}
				clearTimeout(helloTimeout);
				this.agents.set(agentId, { websocket, connectedAt: new Date().toISOString() });
				websocket.on("message", (nextPayload) => this.#handleMessage(agentId, nextPayload));
				websocket.send(JSON.stringify({
					type: "agent.accepted",
					agent_id: agentId,
					capability_issuer: this.capabilityIssuer,
				}));
			} catch (error) {
				clearTimeout(helloTimeout);
				websocket.close(1008, error.message);
			}
		});
		websocket.on("close", () => {
			clearTimeout(helloTimeout);
			if (agentId && this.agents.get(agentId)?.websocket === websocket) {
				this.agents.delete(agentId);
				this.#rejectAgentTasks(agentId, new Error(`Agente desconectado: ${agentId}`));
			}
		});
	}

	#handleMessage(agentId, payload) {
		let message;
		try {
			message = parseMessage(payload);
		} catch {
			return;
		}
		if (message.type !== "task.result" || typeof message.task_id !== "string") return;
		const pending = this.pendingTasks.get(message.task_id);
		if (!pending || pending.agentId !== agentId) return;
		clearTimeout(pending.timeout);
		this.pendingTasks.delete(message.task_id);
		if (message.status === "completed") {
			pending.resolve(message.result);
			return;
		}
		pending.reject(new Error(message.error || "A tarefa falhou no agente"));
	}

	#rejectAgentTasks(agentId, error) {
		for (const [taskId, pending] of this.pendingTasks) {
			if (pending.agentId !== agentId) continue;
			clearTimeout(pending.timeout);
			this.pendingTasks.delete(taskId);
			pending.reject(error);
		}
	}

	listAgents() {
		return [...this.agents.entries()].map(([agentId, connection]) => ({ agent_id: agentId, connected_at: connection.connectedAt }));
	}

	dispatch(agentId, task) {
		const connection = this.agents.get(agentId);
		if (!connection || connection.websocket.readyState !== WebSocket.OPEN) throw new Error(`Agente indisponivel: ${agentId}`);
		if (!task || typeof task.capability !== "string" || typeof task.task_json !== "string") {
			throw new Error("Tarefa sem capability ou task_json");
		}
		const taskId = crypto.randomUUID();
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pendingTasks.delete(taskId);
				reject(new Error(`Tempo esgotado aguardando agente: ${agentId}`));
			}, this.taskTimeoutMs);
			this.pendingTasks.set(taskId, { agentId, resolve, reject, timeout });
			connection.websocket.send(JSON.stringify({ type: "task", task: { ...task, task_id: taskId } }), (error) => {
				if (!error) return;
				clearTimeout(timeout);
				this.pendingTasks.delete(taskId);
				reject(error);
			});
		});
	}

	listen(port, host = "0.0.0.0") {
		return new Promise((resolve, reject) => {
			this.server.once("error", reject);
			this.server.listen(port, host, () => {
				this.server.off("error", reject);
				resolve();
			});
		});
	}

	close() {
		for (const pending of this.pendingTasks.values()) {
			clearTimeout(pending.timeout);
			pending.reject(new Error("Broker encerrado"));
		}
		this.pendingTasks.clear();
		return new Promise((resolve) => this.server.close(resolve));
	}
}
