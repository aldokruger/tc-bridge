import https from "node:https";
import WebSocket, { WebSocketServer } from "ws";

function parseMessage(payload) {
	try {
		return JSON.parse(payload.toString());
	} catch {
		throw new Error("Mensagem JSON invalida");
	}
}

export class AgentBroker {
	constructor({ tls, requireCertificateCnMatch = true }) {
		this.agents = new Map();
		this.requireCertificateCnMatch = requireCertificateCnMatch;
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
				websocket.send(JSON.stringify({ type: "agent.accepted", agent_id: agentId }));
			} catch (error) {
				clearTimeout(helloTimeout);
				websocket.close(1008, error.message);
			}
		});
		websocket.on("close", () => {
			clearTimeout(helloTimeout);
			if (agentId && this.agents.get(agentId)?.websocket === websocket) this.agents.delete(agentId);
		});
	}

	listAgents() {
		return [...this.agents.entries()].map(([agentId, connection]) => ({ agent_id: agentId, connected_at: connection.connectedAt }));
	}

	dispatch(agentId, task) {
		const connection = this.agents.get(agentId);
		if (!connection || connection.websocket.readyState !== WebSocket.OPEN) throw new Error(`Agente indisponivel: ${agentId}`);
		connection.websocket.send(JSON.stringify({ type: "task", task }));
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
		return new Promise((resolve) => this.server.close(resolve));
	}
}
