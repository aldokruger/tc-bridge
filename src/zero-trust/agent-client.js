import WebSocket from "ws";

export function parseBrokerTask(message) {
	if (!message || message.type !== "task" || !message.task || typeof message.task !== "object") throw new Error("Mensagem de tarefa invalida");
	if (typeof message.task.capability !== "string" || typeof message.task.task_json !== "string") throw new Error("Tarefa sem capability ou task_json");
	return message.task;
}

export function parseBrokerAcceptance(message, agentId) {
	if (!message || message.type !== "agent.accepted" || message.agent_id !== agentId) {
		throw new Error("Aceite do broker invalido");
	}
	if (typeof message.capability_issuer !== "string" || !message.capability_issuer) {
		throw new Error("Aceite do broker sem emissor de capability");
	}
	return message.capability_issuer;
}

export class ReverseAgentClient {
	constructor({ brokerUrl, agentId, tls, executeTask, onAccepted, reconnectMs = 5_000, logger = console }) {
		Object.assign(this, { brokerUrl, agentId, tls, executeTask, onAccepted, reconnectMs, logger, stopped: false, socket: null });
	}

	start() {
		this.stopped = false;
		this.#connect();
	}

	stop() {
		this.stopped = true;
		this.socket?.close();
	}

	#connect() {
		if (this.stopped) return;
		const socket = new WebSocket(this.brokerUrl, { ...this.tls, rejectUnauthorized: true, perMessageDeflate: false });
		this.socket = socket;
		socket.on("open", () => socket.send(JSON.stringify({ type: "agent.hello", agent_id: this.agentId })));
		socket.on("message", async (payload) => {
			let message;
			try {
				message = JSON.parse(payload.toString());
				if (message.type === "agent.accepted") {
					this.onAccepted?.(parseBrokerAcceptance(message, this.agentId));
					return;
				}
				if (message.type !== "task") return;
				const task = parseBrokerTask(message);
				const result = await this.executeTask(task);
				socket.send(JSON.stringify({ type: "task.result", task_id: task.task_id, status: "completed", result }));
			} catch (error) {
				socket.send(JSON.stringify({ type: "task.result", task_id: message?.task?.task_id, status: "failed", error: error.message }));
			}
		});
		socket.on("error", (error) => this.logger.warn(`[tc-agent] broker error: ${error.message}`));
		socket.on("close", () => {
			if (!this.stopped) setTimeout(() => this.#connect(), this.reconnectMs);
		});
	}
}
