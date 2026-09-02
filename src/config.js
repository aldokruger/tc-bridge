import path from "node:path";
import { AGENT_FIELDS } from "./configuration/field-catalog.js";
import { ConfigurationManager } from "./configuration/manager.js";
import { readEnvironmentRegistrySync } from "./environments/registry.js";

function canonicalPath(value) {
	const normalized = path.posix
		.normalize(String(value ?? "").replace(/\\/g, "/"))
		.replace(/\/+$/, "");
	if (!normalized || normalized === ".") return "";
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

// loadConfig permanece sincrono e mantem o shape, as mensagens de erro e a
// ordem das validacoes. A resolucao de valores (flags -> env -> default) foi
// delegada ao catalogo unico (AGENT_FIELDS) via ConfigurationManager
// (composeEffectiveSync ignora o documento gerenciado nesta fase; o arquivo
// passa a valer na Fase 2 sob teste de equivalencia — plano §6.4).
export function loadConfig(flags = {}) {
	const env = process.env;
	const token = flags.token || env.TC_TOKEN;
	if (!token) {
		throw new Error(
			"TC_TOKEN (ou --token) é obrigatório — o MCP só atende com token de acesso",
		);
	}
	const manager = new ConfigurationManager({
		target: "agent",
		fields: AGENT_FIELDS,
		env,
		flags,
	});
	const config = manager.composeEffectiveSync(flags);
	if (config.readPaths.length === 0) {
		throw new Error(
			"TC_ALLOWED_READ_PATHS (ou --read-paths) exige pelo menos um path",
		);
	}
	if (config.allowWrite && config.writePaths.length === 0) {
		throw new Error(
			"TC_ALLOW_WRITE=1 exige TC_ALLOWED_WRITE_PATHS com pelo menos um path",
		);
	}
	if (config.allowDbDiagnostics) {
		for (const [name, value] of Object.entries({
			TC_DB_SERVER: config.dbServer,
			TC_DB_NAME: config.dbName,
			TC_DB_USER: config.dbUser,
			TC_DB_PASSWORD: config.dbPassword,
		})) {
			if (!value)
				throw new Error(
					`${name} e obrigatorio quando TC_ALLOW_DB_DIAGNOSTICS=1`,
				);
		}
	}
	if (config.allowDbCompare) {
		for (const [name, value] of Object.entries({
			TC_DB_TARGET_SERVER: config.dbTargetServer,
			TC_DB_TARGET_NAME: config.dbTargetName,
		})) {
			if (!value)
				throw new Error(`${name} e obrigatorio quando TC_ALLOW_DB_COMPARE=1`);
		}
		for (const [name, value] of Object.entries({
			TC_DB_SERVER: config.dbServer,
			TC_DB_NAME: config.dbName,
			TC_DB_USER: config.dbUser,
			TC_DB_PASSWORD: config.dbPassword,
		})) {
			if (!value)
				throw new Error(
					`${name} e obrigatorio quando TC_ALLOW_DB_COMPARE=1 (a conta de diagnostico e reutilizada no ambiente alvo)`,
				);
		}
	}
	if (config.allowTeamcenterRead) {
		for (const [name, value] of Object.entries({
			TC_TEAMCENTER_URL: config.teamcenterUrl,
			TC_TEAMCENTER_USER: config.teamcenterUser,
			TC_TEAMCENTER_PASSWORD: config.teamcenterPassword,
			TC_TEAMCENTER_SOA_ADAPTER_JAR: config.teamcenterSoaAdapterJar,
			TC_TEAMCENTER_SOA_LIB: config.teamcenterSoaLib,
		})) {
			if (!value)
				throw new Error(
					`${name} e obrigatorio quando TC_ALLOW_TEAMCENTER_READ=1`,
				);
		}
	}
	if (config.allowLogRead && !config.teamcenterLogDir) {
		throw new Error(
			"TC_TEAMCENTER_LOG_DIR e obrigatorio quando TC_ALLOW_LOG_READ=1",
		);
	}
	if (config.allowCapabilityTasks) {
		for (const [name, value] of Object.entries({
			TC_AGENT_ID: config.agentId,
			TC_CAPABILITY_PUBLIC_KEY: config.capabilityPublicKey,
			TC_CAPABILITY_ISSUER: config.capabilityIssuer,
		})) {
			if (!value)
				throw new Error(
					`${name} e obrigatorio quando TC_ALLOW_CAPABILITY_TASKS=1`,
				);
		}
	}
	if (config.enforceCapabilities && !config.allowCapabilityTasks) {
		throw new Error(
			"TC_ENFORCE_CAPABILITIES=1 exige TC_ALLOW_CAPABILITY_TASKS=1",
		);
	}
	if (config.environmentRegistryFile) {
		const registry = readEnvironmentRegistrySync(
			config.environmentRegistryFile,
		);
		config.environmentRegistry = registry.environments;
		config.environmentRegistryErrors = registry.errors;
	} else {
		config.environmentRegistry = new Map();
		config.environmentRegistryErrors = [];
	}
	return config;
}

export function normalizePath(p) {
	return canonicalPath(p);
}

export function isWithinAllowed(target, allowed) {
	const t = canonicalPath(target);
	if (t === "") return false;
	return allowed.some((base) => {
		const b = canonicalPath(base);
		if (b === "") return false;
		return t === b || t.startsWith(`${b}/`);
	});
}
