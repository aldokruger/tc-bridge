// Secret store de producao: valores por variavel de ambiente (plano §6.3,
// decisao D4). SecretRef segue o formato TC_SECRET_<NOME_MAIUSCULO>, que e o
// mesmo nome da variavel original do catalogo — o arquivo gerenciado apenas
// registra de onde o valor vem; o valor nunca e persistido.

import { ADMIN_ERROR_CODES, AdminError } from "../errors.js";

const REF_PREFIX = "TC_SECRET_";

export class EnvironmentSecretStore {
	constructor(env = process.env) {
		this.env = env;
	}

	// Aceita "TC_PASSWORD" ou o secretRef completo "TC_SECRET_TC_PASSWORD".
	resolveSecretRef(ref) {
		const normalized = ref.startsWith(REF_PREFIX)
			? ref.slice(REF_PREFIX.length)
			: ref;
		const value = this.env[normalized];
		if (value === undefined || value === "") {
			throw new AdminError(
				ADMIN_ERROR_CODES.SECRET_MISSING,
				`secret ${normalized} nao configurado (variavel ${normalized})`,
			);
		}
		return value;
	}

	// Exposicao minima para auditoria: presenca e procedencia, nunca o valor.
	status(ref) {
		const normalized = ref.startsWith(REF_PREFIX)
			? ref.slice(REF_PREFIX.length)
			: ref;
		return {
			ref,
			configured:
				this.env[normalized] !== undefined && this.env[normalized] !== "",
			source: "env",
		};
	}
}
