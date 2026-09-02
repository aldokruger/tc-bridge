// Store em memoria para testes e para execucoes sem arquivo gerenciado
// (plano §6.3, Fase 1: o arquivo e opcional). Mesma interface do
// AtomicJsonStore: read/write/listHistory/readRevision.

import { CONFIG_SCHEMA_VERSION } from "../schemas.js";

export class InMemoryConfigStore {
	constructor() {
		this.document = null;
		this.history = new Map();
	}

	async read() {
		return this.document;
	}

	async write(data) {
		const current = this.document;
		const newRevision = (current?.revision ?? 0) + 1;
		if (current) {
			this.history.set(current.revision, {
				...current,
				writtenAt: current.writtenAt ?? new Date().toISOString(),
			});
		}
		this.document = {
			schemaVersion: CONFIG_SCHEMA_VERSION,
			revision: newRevision,
			data,
			writtenAt: new Date().toISOString(),
		};
		return { revision: newRevision };
	}

	async listHistory() {
		const items = [];
		for (const entry of this.history.values()) {
			items.push({ revision: entry.revision, writtenAt: entry.writtenAt });
		}
		if (this.document) {
			items.push({
				revision: this.document.revision,
				writtenAt: this.document.writtenAt,
			});
		}
		return items.sort((a, b) => b.revision - a.revision);
	}

	async readRevision(revision) {
		const entry = this.history.get(revision);
		return entry ? { revision: entry.revision, data: entry.data } : null;
	}
}
