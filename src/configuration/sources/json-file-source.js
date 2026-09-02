// Fonte de configuracao por arquivo JSON gerenciado (plano §6.3).
// Arquivo ausente => documento ausente (fonte pulada). Arquivo presente mas
// invalido => AdminError estavel: configuracao invalida nunca e usada para
// substituir a revisao ativa (plano §17).

import fs from "node:fs/promises";
import path from "node:path";
import { ADMIN_ERROR_CODES, AdminError, formatZodIssues } from "../errors.js";

export async function readManagedFile(filePath, envelopeSchema) {
	if (!filePath) return { present: false, document: null };
	const resolved = path.resolve(String(filePath));
	let rawText;
	try {
		rawText = await fs.readFile(resolved, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return { present: false, document: null };
		throw new AdminError(
			ADMIN_ERROR_CODES.INVALID_CONFIG,
			`nao foi possivel ler o arquivo gerenciado ${resolved}: ${error.message}`,
		);
	}
	let parsed;
	try {
		parsed = JSON.parse(rawText);
	} catch (error) {
		throw new AdminError(
			ADMIN_ERROR_CODES.INVALID_CONFIG,
			`arquivo gerenciado ${resolved} nao e JSON valido: ${error.message}`,
		);
	}
	const result = envelopeSchema.safeParse(parsed);
	if (!result.success) {
		throw new AdminError(
			ADMIN_ERROR_CODES.INVALID_CONFIG,
			`arquivo gerenciado ${resolved} invalido: ${formatZodIssues(result.error)}`,
		);
	}
	return { present: true, document: result.data };
}
