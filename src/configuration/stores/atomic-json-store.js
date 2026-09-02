// Persistencia atomica do arquivo gerenciado (plano §6.3, decisao D6).
// Escrita: arquivo temporario no mesmo diretorio + fs.rename (substitui no
// Windows via MoveFileEx/REPLACE_EXISTING), revisao monotona e ate cinco
// backups locais sem segredos em texto claro (o conteudo ja e sanitizado pelo
// manager). Leitura delega ao json-file-source: arquivo ausente => null,
// arquivo invalido => AdminError estavel.

import fs from "node:fs/promises";
import path from "node:path";
import { CONFIG_SCHEMA_VERSION } from "../schemas.js";
import { readManagedFile } from "../sources/json-file-source.js";

export class AtomicJsonStore {
	constructor({ filePath, envelopeSchema, maxBackups = 5 }) {
		this.filePath = filePath;
		this.envelopeSchema = envelopeSchema;
		this.maxBackups = maxBackups;
	}

	async read() {
		const state = await readManagedFile(this.filePath, this.envelopeSchema);
		return state.document;
	}

	backupPathFor(revision) {
		return `${this.filePath}.bak-${revision}`;
	}

	async write(data) {
		const current = await this.read();
		const newRevision = (current?.revision ?? 0) + 1;
		const envelope = {
			schemaVersion: CONFIG_SCHEMA_VERSION,
			revision: newRevision,
			data,
		};
		if (current) {
			await this.#writeBackup(current);
			await this.#rotateBackups();
		}
		await this.#atomicWrite(this.filePath, envelope);
		return { revision: newRevision };
	}

	async #writeBackup(envelope) {
		await this.#atomicWrite(this.backupPathFor(envelope.revision), envelope);
	}

	async #rotateBackups() {
		const dir = path.dirname(this.filePath);
		const prefix = `${path.basename(this.filePath)}.bak-`;
		let entries;
		try {
			entries = await fs.readdir(dir);
		} catch {
			return;
		}
		const backups = entries
			.filter((name) => name.startsWith(prefix))
			.map((name) => Number(name.slice(prefix.length)))
			.filter((revision) => Number.isInteger(revision))
			.sort((a, b) => a - b);
		const excess = backups.length - this.maxBackups;
		for (let index = 0; index < excess; index += 1) {
			await fs.rm(this.backupPathFor(backups[index]), { force: true });
		}
	}

	async #atomicWrite(targetPath, envelope) {
		const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
		try {
			await fs.writeFile(
				tmpPath,
				`${JSON.stringify(envelope, null, 2)}\n`,
				"utf8",
			);
			await fs.rename(tmpPath, targetPath);
		} catch (error) {
			await fs.rm(tmpPath, { force: true });
			throw error;
		}
	}

	async listHistory() {
		const dir = path.dirname(this.filePath);
		const prefix = `${path.basename(this.filePath)}.bak-`;
		let entries;
		try {
			entries = await fs.readdir(dir);
		} catch {
			entries = [];
		}
		const revisions = [];
		for (const name of entries) {
			if (!name.startsWith(prefix)) continue;
			const revision = Number(name.slice(prefix.length));
			if (Number.isInteger(revision)) revisions.push(revision);
		}
		const current = await this.read();
		if (current) revisions.push(current.revision);
		const sorted = [...new Set(revisions)].sort((a, b) => b - a);
		return sorted.map((revision) => ({ revision }));
	}

	async readRevision(revision) {
		const backupPath = this.backupPathFor(revision);
		let rawText;
		try {
			rawText = await fs.readFile(backupPath, "utf8");
		} catch (error) {
			if (error.code === "ENOENT") return null;
			throw error;
		}
		let parsed;
		try {
			parsed = JSON.parse(rawText);
		} catch (error) {
			throw new Error(
				`backup ${backupPath} nao e JSON valido: ${error.message}`,
			);
		}
		const result = this.envelopeSchema.safeParse(parsed);
		if (!result.success) return null;
		return { revision: result.data.revision, data: result.data.data };
	}
}
