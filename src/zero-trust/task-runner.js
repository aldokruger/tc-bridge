import crypto from "node:crypto";
import fs from "node:fs/promises";
import { JsonlAuditLog } from "./audit.js";
import { ReplayProtector, verifyCapability } from "./capability.js";

function parseTask(value) {
	if (typeof value !== "string")
		throw new Error("task_json deve ser texto JSON");
	let task;
	try {
		task = JSON.parse(value);
	} catch {
		throw new Error("task_json invalido");
	}
	if (!task || typeof task !== "object" || Array.isArray(task)) {
		throw new Error("task_json deve ser um objeto");
	}
	if (typeof task.action !== "string" || !task.action) {
		throw new Error("task_json.action e obrigatorio");
	}
	if (
		!task.parameters ||
		typeof task.parameters !== "object" ||
		Array.isArray(task.parameters)
	) {
		throw new Error("task_json.parameters deve ser um objeto");
	}
	return task;
}

export function validateScope(scope, parameters) {
	for (const [field, value] of Object.entries(parameters)) {
		if (scope[field] !== undefined) {
			if (value !== scope[field])
				throw new Error(`Parametro fora do escopo autorizado: ${field}`);
			continue;
		}
		if (scope[`max_${field}`] === undefined) {
			throw new Error(`Parametro sem autorizacao no escopo: ${field}`);
		}
		if (typeof value !== "number" || value > scope[`max_${field}`]) {
			throw new Error(`Parametro excede o maximo autorizado: ${field}`);
		}
	}
}

export class AuthorizedTaskRunner {
	constructor({
		agentId,
		issuer,
		publicKeyPath,
		auditLogPath,
		handlers,
		policy = {},
	}) {
		this.agentId = agentId;
		this.issuer = issuer;
		this.publicKeyPath = publicKeyPath;
		this.handlers = handlers;
		this.policy = policy;
		this.replayProtector = new ReplayProtector();
		this.audit = new JsonlAuditLog(auditLogPath);
	}

	setIssuer(issuer) {
		if (typeof issuer !== "string" || !issuer)
			throw new Error("Emissor de capability invalido");
		this.issuer = issuer;
	}

	async run({ capability, task_json }) {
		const task = parseTask(task_json);
		const auditId = crypto.randomUUID();
		let claims;
		try {
			const publicKey = await fs.readFile(this.publicKeyPath, "utf8");
			claims = verifyCapability(capability, {
				publicKey,
				agentId: this.agentId,
				issuer: this.issuer,
			});
			if (claims.action !== task.action)
				throw new Error("Acao da tarefa diverge da capability");
			if (!this.policy[claims.action])
				throw new Error("Acao bloqueada pela politica local");
			const handler = this.handlers[claims.action];
			if (!handler) throw new Error("Acao nao esta habilitada neste agente");
			validateScope(claims.scope, task.parameters);
			this.replayProtector.consume(claims.jti, claims.exp);
			await this.audit.write({
				audit_id: auditId,
				status: "started",
				agent_id: this.agentId,
				user_id: claims.sub,
				action: claims.action,
				jti: claims.jti,
			});
			const result = await handler(task.parameters, {
				auditId,
				userId: claims.sub,
			});
			await this.audit.write({
				audit_id: auditId,
				status: "completed",
				agent_id: this.agentId,
				user_id: claims.sub,
				action: claims.action,
				jti: claims.jti,
			});
			return { audit_id: auditId, result };
		} catch (error) {
			await this.audit.write({
				audit_id: auditId,
				status: "failed",
				agent_id: this.agentId,
				user_id: claims?.sub ?? "unknown",
				action: claims?.action ?? task.action,
				error: error.message,
			});
			throw error;
		}
	}
}
