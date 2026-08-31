import crypto from "node:crypto";

function encode(value) {
	return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decode(value, name) {
	try {
		return JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
	} catch {
		throw new Error(`${name} da capability invalido`);
	}
}

function assertClaim(claims, name, type) {
	if (typeof claims[name] !== type || claims[name] === "") {
		throw new Error(`Capability sem claim obrigatoria: ${name}`);
	}
}

export function signCapability(claims, privateKey, kid = "development") {
	const header = { alg: "EdDSA", typ: "TC-CAP", kid };
	const payload = encode(claims);
	const protectedHeader = encode(header);
	const signingInput = `${protectedHeader}.${payload}`;
	const signature = crypto.sign(null, Buffer.from(signingInput), privateKey).toString("base64url");
	return `${signingInput}.${signature}`;
}

export function verifyCapability(token, { publicKey, agentId, issuer, now = Date.now() }) {
	if (typeof token !== "string") throw new Error("Capability deve ser texto");
	const parts = token.split(".");
	if (parts.length !== 3) throw new Error("Formato de capability invalido");
	const [encodedHeader, encodedClaims, encodedSignature] = parts;
	const header = decode(encodedHeader, "header");
	const claims = decode(encodedClaims, "payload");
	if (header.alg !== "EdDSA" || header.typ !== "TC-CAP") {
		throw new Error("Algoritmo ou tipo de capability nao permitido");
	}
	const valid = crypto.verify(
		null,
		Buffer.from(`${encodedHeader}.${encodedClaims}`),
		publicKey,
		Buffer.from(encodedSignature, "base64url"),
	);
	if (!valid) throw new Error("Assinatura de capability invalida");

	for (const [name, type] of [
		["iss", "string"],
		["aud", "string"],
		["sub", "string"],
		["action", "string"],
		["jti", "string"],
		["exp", "number"],
		["iat", "number"],
	]) {
		assertClaim(claims, name, type);
	}
	if (!claims.scope || typeof claims.scope !== "object" || Array.isArray(claims.scope)) {
		throw new Error("Capability sem scope valido");
	}
	if (claims.aud !== agentId) throw new Error("Capability destinada a outro agente");
	if (claims.iss !== issuer) throw new Error("Capability emitida por origem nao confiavel");
	if (claims.iat * 1_000 > now + 30_000) throw new Error("Capability ainda nao e valida");
	if (claims.exp * 1_000 <= now) throw new Error("Capability expirada");
	return claims;
}

export class ReplayProtector {
	#used = new Map();

	consume(jti, exp, now = Date.now()) {
		for (const [id, expiresAt] of this.#used) {
			if (expiresAt <= now) this.#used.delete(id);
		}
		if (this.#used.has(jti)) throw new Error("Capability ja foi utilizada");
		this.#used.set(jti, exp * 1_000);
	}
}
