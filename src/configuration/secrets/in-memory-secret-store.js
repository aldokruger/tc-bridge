// Secret store em memoria para testes (plano §6.3, Fase 1). Preencha com
// pares nome/valor que os testes resolvem via resolveSecretRef.

import { ADMIN_ERROR_CODES, AdminError } from "../errors.js";

export class InMemorySecretStore {
	constructor(secrets = {}) {
		this.secrets = new Map(Object.entries(secrets));
	}

	resolveSecretRef(ref) {
		const value = this.secrets.get(ref);
		if (value === undefined || value === "") {
			throw new AdminError(
				ADMIN_ERROR_CODES.SECRET_MISSING,
				`secret ${ref} nao configurado`,
			);
		}
		return value;
	}

	status(ref) {
		return {
			ref,
			configured: this.secrets.has(ref),
			source: "in-memory",
		};
	}
}
