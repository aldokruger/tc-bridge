import path from "node:path";

function commaList(value) {
	return String(value ?? "")
		.split(/[;,]/)
		.map((p) => p.trim())
		.filter(Boolean);
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
	const config = {
		token,
		host: flags.host || env.TC_HOST || "127.0.0.1",
		port: Number(flags.port || env.TC_PORT || "4100"),
		allowWrite,
		writePaths: commaList(flags.writePaths || env.TC_ALLOWED_WRITE_PATHS),
		staging: flags.staging || env.TC_STAGING_DIR || path.join(".", "staging"),
		tunnel: flags.tunnel || env.TC_TUNNEL || "localtunnel",
		publicUrl: flags.publicUrl || env.TC_PUBLIC_URL || "",
	};
	if (allowWrite && config.writePaths.length === 0) {
		throw new Error(
			"TC_ALLOW_WRITE=1 exige TC_ALLOWED_WRITE_PATHS com pelo menos um path",
		);
	}
	return config;
}

export function normalizePath(p) {
	return String(p).replace(/\\/g, "/").replace(/\/+$/, "");
}

export function isWithinAllowed(target, allowed) {
	const t = normalizePath(target);
	if (t === "") return false;
	return allowed.some((base) => {
		const b = normalizePath(base);
		return t === b || t.startsWith(`${b}/`);
	});
}
