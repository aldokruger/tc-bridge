import path from "node:path";

function commaList(value) {
	return String(value ?? "")
		.split(/[;,]/)
		.map((p) => p.trim())
		.filter(Boolean);
}

function canonicalPath(value) {
	const normalized = path.posix
		.normalize(String(value ?? "").replace(/\\/g, "/"))
		.replace(/\/+$/, "");
	if (!normalized || normalized === ".") return "";
	return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function optionalPort(value, name) {
	if (value === undefined || value === null || value === "") return undefined;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`${name} deve ser uma porta entre 1 e 65535`);
	}
	return port;
}

function positiveNumber(value, name, fallback) {
	if (value === undefined || value === null || value === "") return fallback;
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1 || number > 120_000) {
		throw new Error(`${name} deve ser um inteiro entre 1 e 120000`);
	}
	return number;
}

export function loadConfig(flags = {}) {
	const env = process.env;
	const token = flags.token || env.TC_TOKEN;
	if (!token) {
		throw new Error(
			"TC_TOKEN (ou --token) é obrigatório — o MCP só atende com token de acesso",
		);
	}
	const allowWrite = flags.allowWrite || env.TC_ALLOW_WRITE === "1";
	const allowDiagnostics =
		flags.allowDiagnostics || env.TC_ALLOW_DIAGNOSTICS === "1";
	const allowDbDiagnostics =
		flags.allowDbDiagnostics || env.TC_ALLOW_DB_DIAGNOSTICS === "1";
	const allowTeamcenterRead =
		flags.allowTeamcenterRead || env.TC_ALLOW_TEAMCENTER_READ === "1";
	const config = {
		token,
		host: flags.host || env.TC_HOST || "127.0.0.1",
		port: Number(flags.port || env.TC_PORT || "4100"),
		allowWrite,
		allowDiagnostics,
		allowDbDiagnostics,
		allowTeamcenterRead,
		teamcenterUrl: flags.teamcenterUrl || env.TC_TEAMCENTER_URL || "",
		teamcenterUser: flags.teamcenterUser || env.TC_TEAMCENTER_USER || "",
		teamcenterPassword: flags.teamcenterPassword || env.TC_TEAMCENTER_PASSWORD || "",
		teamcenterGroup: flags.teamcenterGroup || env.TC_TEAMCENTER_GROUP || "",
		teamcenterRole: flags.teamcenterRole || env.TC_TEAMCENTER_ROLE || "",
		teamcenterLocale: flags.teamcenterLocale || env.TC_TEAMCENTER_LOCALE || "en_US",
		teamcenterJava: flags.teamcenterJava || env.TC_TEAMCENTER_JAVA || "java",
		teamcenterSoaAdapterJar:
			flags.teamcenterSoaAdapterJar || env.TC_TEAMCENTER_SOA_ADAPTER_JAR || "",
		teamcenterSoaLib: flags.teamcenterSoaLib || env.TC_TEAMCENTER_SOA_LIB || "",
		pathSeparator: process.platform === "win32" ? ";" : ":",
		dbServer: flags.dbServer || env.TC_DB_SERVER || "",
		dbPort: optionalPort(flags.dbPort || env.TC_DB_PORT, "TC_DB_PORT"),
		dbName: flags.dbName || env.TC_DB_NAME || "",
		dbUser: flags.dbUser || env.TC_DB_USER || "",
		dbPassword: flags.dbPassword || env.TC_DB_PASSWORD || "",
		dbEncrypt: (flags.dbEncrypt || env.TC_DB_ENCRYPT || "true") !== "false",
		dbTrustServerCertificate:
			(flags.dbTrustServerCertificate || env.TC_DB_TRUST_SERVER_CERTIFICATE || "false") ===
			"true",
		dbConnectTimeoutMs: positiveNumber(
			flags.dbConnectTimeoutMs || env.TC_DB_CONNECT_TIMEOUT_MS,
			"TC_DB_CONNECT_TIMEOUT_MS",
			10_000,
		),
		dbRequestTimeoutMs: positiveNumber(
			flags.dbRequestTimeoutMs || env.TC_DB_REQUEST_TIMEOUT_MS,
			30_000,
		),
		diagnosticHosts: commaList(flags.diagnosticHosts || env.TC_DIAGNOSTIC_HOSTS)
			.length
			? commaList(flags.diagnosticHosts || env.TC_DIAGNOSTIC_HOSTS)
			: ["localhost", "127.0.0.1", "::1"],
		readPaths: commaList(flags.readPaths || env.TC_ALLOWED_READ_PATHS),
		writePaths: commaList(flags.writePaths || env.TC_ALLOWED_WRITE_PATHS),
		staging: flags.staging || env.TC_STAGING_DIR || path.join(".", "staging"),
		tunnel: flags.tunnel || env.TC_TUNNEL || "localtunnel",
		publicUrl: flags.publicUrl || env.TC_PUBLIC_URL || "",
		tunnelHost: flags.tunnelHost || env.TC_TUNNEL_HOST || "",
		cloudflaredPath: flags.cloudflaredPath || env.TC_CLOUDFLARED_PATH || "",
	};
	if (config.readPaths.length === 0) {
		throw new Error(
			"TC_ALLOWED_READ_PATHS (ou --read-paths) exige pelo menos um path",
		);
	}
	if (allowWrite && config.writePaths.length === 0) {
		throw new Error(
			"TC_ALLOW_WRITE=1 exige TC_ALLOWED_WRITE_PATHS com pelo menos um path",
		);
	}
	if (allowDbDiagnostics) {
		for (const [name, value] of Object.entries({
			TC_DB_SERVER: config.dbServer,
			TC_DB_NAME: config.dbName,
			TC_DB_USER: config.dbUser,
			TC_DB_PASSWORD: config.dbPassword,
		})) {
			if (!value) throw new Error(`${name} e obrigatorio quando TC_ALLOW_DB_DIAGNOSTICS=1`);
		}
	}
	if (allowTeamcenterRead) {
		for (const [name, value] of Object.entries({
			TC_TEAMCENTER_URL: config.teamcenterUrl,
			TC_TEAMCENTER_USER: config.teamcenterUser,
			TC_TEAMCENTER_PASSWORD: config.teamcenterPassword,
			TC_TEAMCENTER_SOA_ADAPTER_JAR: config.teamcenterSoaAdapterJar,
			TC_TEAMCENTER_SOA_LIB: config.teamcenterSoaLib,
		})) {
			if (!value) throw new Error(`${name} e obrigatorio quando TC_ALLOW_TEAMCENTER_READ=1`);
		}
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
