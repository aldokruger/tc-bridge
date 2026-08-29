import crypto from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";

function assertTunnel(value) {
	if (!["localtunnel", "cloudflared", "static"].includes(value)) {
		throw new Error("Tunnel deve ser localtunnel, cloudflared ou static");
	}
	return value;
}

function assertPublicUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error("URL publica invalida");
	}
	const localHttp =
		url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
	if (url.protocol !== "https:" && !localHttp) {
		throw new Error("A URL do plugin remoto deve usar HTTPS");
	}
	return url.toString().replace(/\/+$/, "");
}

function toEnvLine(name, value) {
	return `${name}=${String(value).replace(/\r?\n/g, "")}`;
}

export function createSetupContent({ token, readPaths, tunnel, publicUrl }) {
	const lines = [
		"# Gerado por tc-bridge setup. Nao versione este arquivo.",
		toEnvLine("TC_TOKEN", token),
		"TC_HOST=127.0.0.1",
		"TC_PORT=4100",
		toEnvLine("TC_ALLOWED_READ_PATHS", readPaths),
		"TC_ALLOW_WRITE=0",
		"TC_ALLOW_DIAGNOSTICS=0",
		"TC_ALLOW_DB_DIAGNOSTICS=0",
		toEnvLine("TC_TUNNEL", tunnel),
	];
	if (publicUrl) lines.push(toEnvLine("TC_PUBLIC_URL", publicUrl));
	return `${lines.join("\n")}\n`;
}

export async function writeSetupFile({
	configPath,
	readPaths,
	tunnel = "localtunnel",
	publicUrl = "",
	force = false,
	token = crypto.randomBytes(32).toString("base64url"),
}) {
	if (!readPaths) throw new Error("Informe ao menos um caminho em --read-paths");
	assertTunnel(tunnel);
	if (tunnel === "static" && !publicUrl) {
		throw new Error("Tunnel static exige --public-url");
	}
	if (publicUrl) assertPublicUrl(publicUrl);
	try {
		await fs.access(configPath);
		if (!force) {
			throw new Error(`Configuracao ja existe: ${configPath}. Use --force para substituir.`);
		}
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
	await fs.mkdir(path.dirname(configPath), { recursive: true });
	await fs.writeFile(
		configPath,
		createSetupContent({ token, readPaths, tunnel, publicUrl }),
		{ encoding: "utf8", mode: 0o600 },
	);
	return { configPath, tunnel, hasPublicUrl: Boolean(publicUrl) };
}

async function portStatus(host, port) {
	return new Promise((resolve) => {
		const server = net.createServer();
		server.once("error", (error) => resolve({ available: false, detail: error.code }));
		server.listen(port, host, () => {
			server.close(() => resolve({ available: true }));
		});
	});
}

export async function inspectHost(cfg) {
	const checks = [
		{ name: "node_version", ok: Number(process.versions.node.split(".")[0]) >= 20, detail: process.version },
		{ name: "read_paths_configured", ok: cfg.readPaths.length > 0, detail: cfg.readPaths.length },
	];
	for (const readPath of cfg.readPaths) {
		try {
			const stat = await fs.stat(readPath);
			checks.push({ name: "read_path", target: readPath, ok: stat.isDirectory() });
		} catch (error) {
			checks.push({ name: "read_path", target: readPath, ok: false, detail: error.code });
		}
	}
	const port = await portStatus(cfg.host, cfg.port);
	checks.push({ name: "listen_port_available", target: `${cfg.host}:${cfg.port}`, ok: port.available, detail: port.detail });
	if (cfg.allowDbDiagnostics) {
		try {
			await import("mssql");
			checks.push({ name: "mssql_driver", ok: true });
		} catch {
			checks.push({ name: "mssql_driver", ok: false, detail: "dependency_missing" });
		}
	}
	return { ok: checks.every((check) => check.ok), checks };
}

export async function writePluginConfig({ outputPath, publicUrl, token, force = false }) {
	if (!token) throw new Error("TC_TOKEN e obrigatorio para gerar a configuracao do plugin");
	const url = assertPublicUrl(publicUrl);
	const content = JSON.stringify(
		{
			mcp: {
				"tc-bridge": {
					type: "remote",
					url: `${url}/mcp`,
					enabled: true,
					headers: { Authorization: `Bearer ${token}` },
				},
			},
		},
		null,
		2,
	);
	try {
		await fs.access(outputPath);
		if (!force) {
			throw new Error(`Arquivo ja existe: ${outputPath}. Use --force para substituir.`);
		}
	} catch (err) {
		if (err.code !== "ENOENT") throw err;
	}
	await fs.mkdir(path.dirname(outputPath), { recursive: true });
	await fs.writeFile(outputPath, `${content}\n`, { encoding: "utf8", mode: 0o600 });
	return { outputPath, url: `${url}/mcp` };
}
