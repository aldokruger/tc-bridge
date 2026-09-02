import WebSocket from "ws";
import { createResultBuffer } from "../agent/result-buffer.js";

export function parseBrokerTask(message) {
	if (
		!message ||
		message.type !== "task" ||
		!message.task ||
		typeof message.task !== "object"
	)
		throw new Error("Mensagem de tarefa invalida");
	if (
		typeof message.task.capability !== "string" ||
		typeof message.task.task_json !== "string"
	)
		throw new Error("Tarefa sem capability ou task_json");
	return message.task;
}

export function parseBrokerAcceptance(message, agentId) {
	if (
		!message ||
		message.type !== "agent.accepted" ||
		message.agent_id !== agentId
	) {
		throw new Error("Aceite do broker invalido");
	}
	if (
		typeof message.capability_issuer !== "string" ||
		!message.capability_issuer
	) {
		throw new Error("Aceite do broker sem emissor de capability");
	}
	return message.capability_issuer;
}

export function computeReconnectDelay(
	attempt,
	baseMs,
	maxMs,
	random = Math.random,
) {
	const backoff = Math.min(baseMs * 2 ** Math.max(0, attempt - 1), maxMs);
	const jitter = backoff * (0.5 + random() * 0.5);
	return Math.round(jitter);
}

export class ReverseAgentClient {
	constructor({
		brokerUrl,
		agentId,
		tls,
		executeTask,
		onAccepted,
		reconnectMs = 5_000,
		maxReconnectMs = 60_000,
		resultBufferCapacity = 100,
		metrics,
		logger = console,
	}) {
		Object.assign(this, {
			brokerUrl,
			agentId,
			tls,
			executeTask,
			onAccepted,
			reconnectMs,
			maxReconnectMs,
			metrics,
			logger,
			stopped: false,
			socket: null,
			reconnectAttempt: 0,
		});
		this.resultBuffer = createResultBuffer({
			capacity: resultBufferCapacity,
			metrics,
			logger,
		});
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
		const socket = new WebSocket(this.brokerUrl, {
			...this.tls,
			rejectUnauthorized: true,
			perMessageDeflate: false,
		});
		this.socket = socket;
		socket.on("open", () => {
			this.reconnectAttempt = 0;
			socket.send(
				JSON.stringify({ type: "agent.hello", agent_id: this.agentId }),
			);
			this.#flushResults(socket);
		});
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
				this.#sendResult({
					type: "task.result",
					task_id: task.task_id,
					status: "completed",
					result,
				});
			} catch (error) {
				this.#sendResult({
					type: "task.result",
					task_id: message?.task?.task_id,
					status: "failed",
					error: error.message,
				});
			}
		});
		socket.on("error", (error) =>
			this.logger.warn(`[tc-agent] broker error: ${error.message}`),
		);
		socket.on("close", () => {
			if (this.stopped) return;
			this.reconnectAttempt += 1;
			this.metrics?.recordReconnect();
			const delay = computeReconnectDelay(
				this.reconnectAttempt,
				this.reconnectMs,
				this.maxReconnectMs,
			);
			this.logger.warn(
				`[tc-agent] broker desconectado; reconectando em ${delay}ms (tentativa ${this.reconnectAttempt})`,
			);
			setTimeout(() => this.#connect(), delay);
		});
	}

	#sendResult(envelope) {
		const payload = JSON.stringify(envelope);
		if (this.socket?.readyState === WebSocket.OPEN) {
			this.socket.send(payload);
			return;
		}
		if (this.stopped) return;
		this.resultBuffer.push(payload);
		this.logger.warn(
			`[tc-agent] broker indisponivel; resultado bufferizado (${this.resultBuffer.size} pendente(s))`,
		);
	}

	#flushResults(socket) {
		for (const payload of this.resultBuffer.drain()) {
			if (socket.readyState !== WebSocket.OPEN) {
				this.resultBuffer.push(payload);
				continue;
			}
			socket.send(payload);
		}
	}
}
