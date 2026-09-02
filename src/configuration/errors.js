// Códigos de erro administrativos estáveis (plano §8.1; decisão D7).
// Formato da resposta: { error: { code, message } } — sem stack trace.
// A camada HTTP (Fase 2+) usa o mesmo conjunto via src/admin/shared/errors.js.

export const ADMIN_ERROR_CODES = Object.freeze({
	UNAUTHORIZED: "ERR_ADMIN_UNAUTHORIZED",
	FORBIDDEN: "ERR_ADMIN_FORBIDDEN",
	BAD_REQUEST: "ERR_ADMIN_BAD_REQUEST",
	NOT_FOUND: "ERR_ADMIN_NOT_FOUND",
	REVISION_CONFLICT: "ERR_ADMIN_REVISION_CONFLICT",
	PLAN_EXPIRED: "ERR_ADMIN_PLAN_EXPIRED",
	INVALID_CONFIG: "ERR_ADMIN_INVALID_CONFIG",
	SECRET_NOT_ALLOWED: "ERR_ADMIN_SECRET_NOT_ALLOWED",
	VALIDATION: "ERR_ADMIN_VALIDATION",
	PLAN_NOT_FOUND: "ERR_ADMIN_PLAN_NOT_FOUND",
	REVISION_NOT_FOUND: "ERR_ADMIN_REVISION_NOT_FOUND",
	SECRET_MISSING: "ERR_ADMIN_SECRET_MISSING",
});

export class AdminError extends Error {
	constructor(code, message, options = {}) {
		super(message);
		this.name = "AdminError";
		this.code = code;
		this.details = options.details;
	}

	toJSON() {
		const body = { code: this.code, message: this.message };
		if (this.details !== undefined) body.details = this.details;
		return { error: body };
	}
}

export function isAdminError(error) {
	return error instanceof AdminError;
}

// Formata erros do Zod no mesmo estilo usado em src/environments/registry.js
// (mensagem + caminho do campo), preservando a lingua sem acentos do repo.
export function formatZodIssues(error) {
	const issues = Array.isArray(error?.issues) ? error.issues : [];
	if (!issues.length) return String(error?.message ?? error);
	return issues
		.map((issue) => {
			const where = issue.path.length ? ` em ${issue.path.join(".")}` : "";
			return `${issue.message}${where}`;
		})
		.join("; ");
}
