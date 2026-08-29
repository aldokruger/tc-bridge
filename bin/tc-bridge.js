#!/usr/bin/env node
import dotenv from "dotenv";
import { Command } from "commander";
import { loadConfig } from "../src/config.js";
import { createApp } from "../src/server.js";
import { startTunnel } from "../src/tunnel.js";
import { inspectHost, writePluginConfig, writeSetupFile } from "../src/onboarding.js";

dotenv.config({ quiet: true });

const program = new Command()
	.name("tc-bridge")
	.description(
		"Bridge MCP para os arquivos de upgrade do Teamcenter (roda na maquina de upgrade)",
	)
	.version("0.2.0")
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
		"--allow-diagnostics",
		"Habilita diagnosticos PowerShell allowlisted (env TC_ALLOW_DIAGNOSTICS=1)",
	)
	.option(
		"--allow-db-diagnostics",
		"Habilita diagnosticos MSSQL somente leitura (env TC_ALLOW_DB_DIAGNOSTICS=1)",
	)
	.option("--db-server <host>", "Host MSSQL (env TC_DB_SERVER)", "")
	.option("--db-port <port>", "Porta MSSQL (env TC_DB_PORT)", "")
	.option("--db-name <name>", "Base MSSQL (env TC_DB_NAME)", "")
	.option("--db-user <user>", "Usuario MSSQL dedicado (env TC_DB_USER)", "")
	.option(
		"--diagnostic-hosts <hosts>",
		"Hosts permitidos para tcp_connect, separados por ; (env TC_DIAGNOSTIC_HOSTS)",
		"",
	)
	.option(
		"--read-paths <paths>",
		"Whitelist de leitura separada por ; (env TC_ALLOWED_READ_PATHS)",
		"",
	)
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

function loadEnvFile(file) {
	if (file) dotenv.config({ path: file, override: true, quiet: true });
}

program
	.command("setup")
	.description("Cria uma configuracao .env segura e minima")
	.requiredOption("--paths <paths>", "Diretorios de leitura separados por ;")
	.option("--config <path>", "Arquivo de configuracao", ".env")
	.option("--tunnel <mode>", "localtunnel | cloudflared | static", "localtunnel")
	.option("--public-url <url>", "URL publica para tunnel static", "")
	.option("--force", "Substitui configuracao existente")
	.action(async (opts) => {
		const result = await writeSetupFile({
			configPath: opts.config,
			readPaths: opts.paths,
			tunnel: opts.tunnel,
			publicUrl: opts.publicUrl,
			force: opts.force,
		});
		console.log(`[tc-bridge] Configuracao criada: ${result.configPath}`);
		console.log("[tc-bridge] O token foi salvo somente no arquivo de configuracao e nao sera exibido.");
	});

program
	.command("doctor")
	.description("Valida configuracao, caminhos, Node, driver MSSQL e porta local")
	.option("--config <path>", "Arquivo .env a validar", ".env")
	.action(async (opts) => {
		loadEnvFile(opts.config);
		const result = await inspectHost(loadConfig({}));
		console.log(JSON.stringify(result, null, 2));
		if (!result.ok) process.exitCode = 1;
	});

program
	.command("plugin-config")
	.description("Gera um arquivo de configuracao MCP remoto sem imprimir o token")
	.requiredOption("--url <url>", "URL HTTPS do tunnel")
	.option("--output <path>", "Arquivo de saida", "tc-bridge.remote.mcp.json")
	.option("--config <path>", "Arquivo .env que contem TC_TOKEN", ".env")
	.option("--force", "Substitui arquivo de saida existente")
	.action(async (opts) => {
		loadEnvFile(opts.config);
		const result = await writePluginConfig({
			outputPath: opts.output,
			publicUrl: opts.url,
			token: process.env.TC_TOKEN,
			force: opts.force,
		});
		console.log(`[tc-bridge] Configuracao MCP criada: ${result.outputPath}`);
		console.log(`[tc-bridge] URL MCP: ${result.url}`);
	});

program.action(async () => {
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
		allowDiagnostics: opts.allowDiagnostics,
		allowDbDiagnostics: opts.allowDbDiagnostics,
		dbServer: opts.dbServer,
		dbPort: opts.dbPort,
		dbName: opts.dbName,
		dbUser: opts.dbUser,
		diagnosticHosts: opts.diagnosticHosts,
		readPaths: opts.readPaths,
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
					`[tc-bridge] Registrar o cliente MCP: tipo remote, url "${url}/mcp". Configure o header Authorization com o valor de TC_TOKEN sem registrá-lo em logs.`,
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
});

program.parseAsync(process.argv).catch((error) => {
	console.error(`[tc-bridge] ${error.message}`);
	process.exitCode = 1;
});
