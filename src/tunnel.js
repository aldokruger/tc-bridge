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
		const tunnel = await localtunnel(port, {
			subdomain: generateSubdomain(),
		});
		return {
			url: tunnel.url,
			mode: "localtunnel",
			close: () => tunnel.close(),
		};
	}

	throw new Error(`Tipo de tunel desconhecido: ${cfg.tunnel}`);
}

function generateSubdomain() {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
	let s = "tc-";
	for (let i = 0; i < 14; i++) {
		s += chars[Math.floor(Math.random() * chars.length)];
	}
	return s;
}
