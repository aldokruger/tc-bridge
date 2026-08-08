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

	throw new Error(`Tipo de tunel desconhecido: ${cfg.tunnel}`);
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
