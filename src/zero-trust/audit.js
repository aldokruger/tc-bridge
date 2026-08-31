import fs from "node:fs/promises";
import path from "node:path";

function auditRecord(event) {
	return {
		timestamp: new Date().toISOString(),
		...event,
	};
}

export class JsonlAuditLog {
	constructor(filePath) {
		this.filePath = filePath;
	}

	async write(event) {
		await fs.mkdir(path.dirname(this.filePath), { recursive: true });
		await fs.appendFile(this.filePath, `${JSON.stringify(auditRecord(event))}\n`, "utf8");
	}
}
