export async function startTunnel(cfg, port) {
	if (cfg.tunnel === "static") {
		if (!cfg.publicUrl) {
			throw new Error(
				"TC_TUNNEL=static exige TC_PUBLIC_URL com a URL pública de entrada",
			);
		}
		return { url: cfg.publicUrl.replace(/\/+$/, ""), mode: "static" };
	}

	if (cfg.tunnel === "localtunnel") {
		let localtunnel;
		try {
			localtunnel = (await import("localtunnel")).default;
		} catch {
			throw new Error(
				"Modulo 'localtunnel' nao instalado. Rode 'npm install localtunnel' ou use TC_TUNNEL=static + TC_PUBLIC_URL.",
			);
		}
		const TUNNEL_TIMEOUT_MS = 20_000;
		const tunnel = await withTimeout(
			localtunnel(port, {
				subdomain: generateSubdomain(),
				...(cfg.tunnelHost ? { host: cfg.tunnelHost } : {}),
			}),
			TUNNEL_TIMEOUT_MS,
			`Local tunnel não respondeu em ${TUNNEL_TIMEOUT_MS / 1000}s. ` +
				"Provável bloqueio de proxy/firewall na rede de upgrade. " +
				"Tente TC_TUNNEL=static + TC_PUBLIC_URL, ou TC_TUNNEL_HOST alternativo.",
		);
		return {
			url: tunnel.url,
			mode: "localtunnel",
			close: () => tunnel.close(),
		};
	}

	if (cfg.tunnel === "cloudflared") {
		return startCloudflared(cfg, port);
	}

	throw new Error(`Tipo de tunel desconhecido: ${cfg.tunnel}`);
}

const CLOUDFLARED_TIMEOUT_MS = 45_000;

async function startCloudflared(cfg, port) {
	const { spawn } = await import("node:child_process");
	const bin = cfg.cloudflaredPath || "cloudflared";
	const args = [
		"tunnel",
		"--url",
		`http://127.0.0.1:${port}`,
		"--no-autoupdate",
	];

	const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });

	let stdout = "";
	let stderr = "";
	let settled = false;

	child.stdout.on("data", (d) => {
		stdout += String(d);
	});
	child.stderr.on("data", (d) => {
		stderr += String(d);
	});

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill();
			reject(
				new Error(
					`cloudflared não publicou URL em ${CLOUDFLARED_TIMEOUT_MS / 1000}s. ` +
						`Saída: ${tail(stderr || stdout, 300)}`,
				),
			);
		}, CLOUDFLARED_TIMEOUT_MS);

		let found = "";
		const onData = (chunk) => {
			const text = String(chunk);
			stdout += text;
			stderr += text;
			const m = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
			if (m) {
				found = m[0];
				if (!settled) {
					settled = true;
					clearTimeout(timer);
					child.stdout.off("data", onData);
					child.stderr.off("data", onData);
					child.once("exit", () => {});
					resolve({
						url: found,
						mode: "cloudflared",
						close: () => child.kill(),
					});
				}
			}
		};
		child.stdout.on("data", onData);
		child.stderr.on("data", onData);

		child.once("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(
				new Error(
					`cloudflared falhou ao iniciar: ${err.message}. ` +
						"Instale de https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ " +
						"ou defina TC_CLOUDFLARED_PATH apontando para o executavel.",
				),
			);
		});

		child.once("exit", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(
				new Error(
					`cloudflared encerrou (exit ${code}) antes de publicar URL. ` +
						`Saída: ${stderr || stdout}`.slice(0, 400),
				),
			);
		});
	});
}

function tail(str, n) {
	return str.split("\n").slice(-12).join("\n").slice(-n);
}

function withTimeout(promise, ms, message) {
	let timer;
	const timeout = new Promise((_, reject) => {
		timer = setTimeout(() => reject(new Error(message)), ms);
	});
	return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function generateSubdomain() {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let s = "tc-";
	for (let i = 0; i < 14; i++) {
		s += chars[Math.floor(Math.random() * chars.length)];
	}
	return s;
}
