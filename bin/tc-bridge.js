#!/usr/bin/env node
import "dotenv/config";
import { Command } from "commander";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";
import { startTunnel } from "../src/tunnel.js";

const program = new Command()
	.name("tc-bridge")
	.description(
		"Bridge MCP para os arquivos de upgrade do Teamcenter (roda na maquina de upgrade)",
	)
	.version("0.1.0")
	.option("--token <token>", "Token de acesso (ou env TC_TOKEN)")
	.option("--host <host>", "Host de escuta (default 127.0.0.1)", "127.0.0.1")
	.option("--port <port>", "Porta de escuta (default 4100)", "4100")
	.option(
		"--tunnel <mode>",
		"Modo de tunel: localtunnel | cloudflared | static (env TC_TUNNEL)",
	)
	.option(
		"--public-url <url>",
		"URL publica fixa (usada com --tunnel static)",
		"",
	)
	.option(
		"--tunnel-host <host>",
		"Servidor localtunnel alternativo (env TC_TUNNEL_HOST)",
		"",
	)
	.option(
		"--cloudflared-path <path>",
		"Caminho do executavel cloudflared (env TC_CLOUDFLARED_PATH)",
		"",
	)
	.option("--allow-write", "Habilita escrita (env TC_ALLOW_WRITE=1)")
	.option(
		"--write-paths <paths>",
		"Whitelist de escrita separada por ; (env TC_ALLOWED_WRITE_PATHS)",
		"",
	)
	.option(
		"--staging <dir>",
		"Diretorio de staging para copias (env TC_STAGING_DIR)",
	)
	.option("--no-tunnel", "Nao cria tunel (so HTTP local)");

program.parse(process.argv);

const opts = program.opts();
const cfg = loadConfig({
	token: opts.token,
	host: opts.host,
	port: opts.port,
	tunnel: opts.tunnel,
	publicUrl: opts.publicUrl,
	tunnelHost: opts.tunnelHost,
	cloudflaredPath: opts.cloudflaredPath,
	allowWrite: opts.allowWrite,
	writePaths: opts.writePaths,
	staging: opts.staging,
});

const app = createApp(cfg);
const server = app.listen(cfg.port, cfg.host, async () => {
	console.log(`[tc-bridge] MCP escutando em http://${cfg.host}:${cfg.port}`);
	if (opts.tunnel !== false) {
		try {
			const { url } = await startTunnel(cfg, cfg.port);
			console.log(`[tc-bridge] Tunel ativo: ${url}`);
			console.log(
				`[tc-bridge] Registrar no opencode: tipo remote, url "${url}/mcp", header Authorization: Bearer ${cfg.token}`,
			);
		} catch (err) {
			console.error(`[tc-bridge] Falha ao subir tunel: ${err.message}`);
			process.exit(1);
		}
	}
});

function shutdown() {
	server.close(() => process.exit(0));
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
