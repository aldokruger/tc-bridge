// Armazenamento temporario de rascunhos com expiracao e hash de conteudo.
// Deny-by-default: sem TC_ENGINEERING_DRAFT_DIR, rascunhos ficam em memoria.

import crypto from "node:crypto";

const DEFAULT_TTL_SECONDS = 300;
const MAX_DRAFT_BYTES = 256 * 1024;

export function createDraftStore({
	dir,
	ttlSeconds = DEFAULT_TTL_SECONDS,
} = {}) {
	const memory = new Map();
	function hashContent(content) {
		return crypto
			.createHash("sha256")
			.update(JSON.stringify(content))
			.digest("hex");
	}
	function nowIso() {
		return new Date().toISOString();
	}
	function expiryIso() {
		return new Date(Date.now() + ttlSeconds * 1000).toISOString();
	}
	return {
		save(draft) {
			const payload = JSON.stringify(draft);
			if (payload.length > MAX_DRAFT_BYTES) {
				throw new Error("rascunho excede o tamanho maximo permitido");
			}
			const record = {
				...draft,
				content_hash: hashContent(draft.content),
				created_at: draft.created_at || nowIso(),
				expires_at: expiryIso(),
			};
			memory.set(draft.draft_id, record);
			return record;
		},
		get(draftId) {
			const record = memory.get(draftId);
			if (!record) return null;
			if (new Date(record.expires_at) <= new Date()) {
				memory.delete(draftId);
				return null;
			}
			return record;
		},
		delete(draftId) {
			memory.delete(draftId);
		},
		list() {
			const now = new Date();
			const alive = [];
			for (const [id, record] of memory) {
				if (new Date(record.expires_at) > now) {
					alive.push(record);
				} else {
					memory.delete(id);
				}
			}
			return alive;
		},
	};
}
