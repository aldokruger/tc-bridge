import WebSocket from "ws";

const DEFAULT_CAPTURE_MS = 1_000;
const MAX_CAPTURE_MS = 15_000;
const MAX_EVENTS = 100;
const MAX_TEXT_LENGTH = 500;

function limitedText(value) {
	return String(value ?? "").slice(0, MAX_TEXT_LENGTH);
}

function sanitizeUrl(value) {
	try {
		const url = new URL(value);
		url.search = "";
		url.hash = "";
		return url.toString();
	} catch {
		return limitedText(value);
	}
}

function isLoopbackHost(hostname) {
	return (
		hostname === "localhost" ||
		hostname === "::1" ||
		hostname === "127.0.0.1" ||
		hostname.startsWith("127.")
	);
}

export function normalizeDevtoolsUrl(value) {
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error("TC_BROWSER_DEVTOOLS_URL deve ser uma URL valida");
	}
	if (url.protocol !== "http:") {
		throw new Error("TC_BROWSER_DEVTOOLS_URL deve usar http em loopback local");
	}
	if (!isLoopbackHost(url.hostname)) {
		throw new Error("TC_BROWSER_DEVTOOLS_URL aceita somente localhost/127.0.0.1/::1");
	}
	return url.toString().replace(/\/$/, "");
}

function captureDuration(value = DEFAULT_CAPTURE_MS) {
	const duration = Number(value);
	if (!Number.isInteger(duration) || duration < 100 || duration > MAX_CAPTURE_MS) {
		throw new Error(`capture_ms deve estar entre 100 e ${MAX_CAPTURE_MS}`);
	}
	return duration;
}

async function fetchJson(fetchImpl, url) {
	const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
	if (!response.ok) {
		throw new Error(`Chrome DevTools retornou HTTP ${response.status}`);
	}
	return response.json();
}

function pageSummary(target) {
	return {
		id: target.id,
		title: limitedText(target.title),
		url: sanitizeUrl(target.url),
		type: target.type,
	};
}

export function createBrowserAgent({ browserUrl, fetchImpl = fetch } = {}) {
	const baseUrl = normalizeDevtoolsUrl(browserUrl);

	async function version() {
		const result = await fetchJson(fetchImpl, `${baseUrl}/json/version`);
		return {
			browser: limitedText(result.Browser),
			protocol_version: limitedText(result["Protocol-Version"]),
			user_agent: limitedText(result["User-Agent"]),
		};
	}

	async function pages() {
		const targets = await fetchJson(fetchImpl, `${baseUrl}/json/list`);
		if (!Array.isArray(targets)) throw new Error("Chrome DevTools retornou uma lista invalida");
		return targets.filter((target) => target.type === "page").map(pageSummary);
	}

	async function findPage(pageId) {
		const targets = await fetchJson(fetchImpl, `${baseUrl}/json/list`);
		const pageTargets = targets.filter((target) => target.type === "page");
		const target = pageId
			? pageTargets.find((entry) => entry.id === pageId)
			: pageTargets.length === 1
				? pageTargets[0]
				: null;
		if (!target) {
			throw new Error(
				pageId
					? "Pagina Chrome nao encontrada"
					: "Informe page_id quando houver mais de uma pagina aberta",
			);
		}
		if (!target.webSocketDebuggerUrl) {
			throw new Error("A pagina selecionada nao permite depuracao remota");
		}
		return target;
	}

	async function withCdp(pageId, callback) {
		const target = await findPage(pageId);
		const socket = new WebSocket(target.webSocketDebuggerUrl);
		const pending = new Map();
		let nextId = 1;

		const opened = new Promise((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("Timeout ao conectar ao Chrome DevTools")), 5_000);
			socket.once("open", () => {
				clearTimeout(timer);
				resolve();
			});
			socket.once("error", (error) => {
				clearTimeout(timer);
				reject(new Error(`Falha ao conectar ao Chrome DevTools: ${error.message}`));
			});
		});

		const send = (method, params = {}) =>
			new Promise((resolve, reject) => {
				const id = nextId++;
				const timer = setTimeout(() => {
					pending.delete(id);
					reject(new Error(`Timeout no comando CDP ${method}`));
				}, 5_000);
				pending.set(id, { resolve, reject, timer });
				socket.send(JSON.stringify({ id, method, params }));
			});

		socket.on("message", (payload) => {
			let message;
			try {
				message = JSON.parse(payload.toString());
			} catch {
				return;
			}
			if (message.id) {
				const call = pending.get(message.id);
				if (!call) return;
				clearTimeout(call.timer);
				pending.delete(message.id);
				if (message.error) call.reject(new Error(message.error.message));
				else call.resolve(message.result);
			}
		});

		try {
			await opened;
			return await callback({ send, socket, target });
		} finally {
			for (const call of pending.values()) {
				clearTimeout(call.timer);
				call.reject(new Error("Conexao CDP encerrada"));
			}
			socket.close();
		}
	}

	async function diagnostics({ page_id, capture_ms } = {}) {
		const duration = captureDuration(capture_ms);
		return withCdp(page_id, async ({ send, socket, target }) => {
			const events = [];
			const addEvent = (event) => {
				if (events.length < MAX_EVENTS) events.push(event);
			};
			socket.on("message", (payload) => {
				let message;
				try {
					message = JSON.parse(payload.toString());
				} catch {
					return;
				}
				if (message.method === "Runtime.consoleAPICalled") {
					addEvent({
						type: "console",
						level: message.params.type,
						text: limitedText(message.params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(" ")),
					});
				}
				if (message.method === "Runtime.exceptionThrown") {
					addEvent({ type: "exception", text: limitedText(message.params.exceptionDetails.text) });
				}
				if (message.method === "Network.responseReceived") {
					addEvent({
						type: "response",
						status: message.params.response.status,
						url: sanitizeUrl(message.params.response.url),
					});
				}
				if (message.method === "Network.loadingFailed") {
					addEvent({ type: "network_error", text: limitedText(message.params.errorText) });
				}
			});

			await Promise.all([
				send("Runtime.enable"),
				send("Network.enable"),
				send("Log.enable"),
			]);
			await new Promise((resolve) => setTimeout(resolve, duration));
			return {
				page: pageSummary(target),
				capture_ms: duration,
				events,
				truncated: events.length === MAX_EVENTS,
			};
		});
	}

	async function performance({ page_id } = {}) {
		return withCdp(page_id, async ({ send, target }) => {
			await send("Performance.enable");
			const result = await send("Performance.getMetrics");
			return {
				page: pageSummary(target),
				metrics: Object.fromEntries(
					result.metrics.map((metric) => [metric.name, metric.value]),
				),
			};
		});
	}

	return { version, pages, diagnostics, performance };
}

export function makeBrowserTools(cfg) {
	const agent = createBrowserAgent({ browserUrl: cfg.browserDevtoolsUrl });
	return {
		browser_status: {
			description: "Confirma o Chrome local em depuracao remota. Nao acessa cookies, storage ou dados de paginas.",
			input: {},
			run: () => agent.version(),
		},
		browser_pages: {
			description: "Lista as paginas Chrome depuraveis abertas, sem query string, cookies ou conteudo.",
			input: {},
			run: () => agent.pages(),
		},
		browser_capture_diagnostics: {
			description: "Captura por periodo curto eventos novos de Console e Network de uma pagina Chrome. Somente leitura; nao executa JavaScript nem interage com a pagina.",
			input: { page_id: "string?", capture_ms: "number?" },
			run: (request) => agent.diagnostics(request),
		},
		browser_performance: {
			description: "Retorna metricas Performance CDP da pagina Chrome. Somente leitura.",
			input: { page_id: "string?" },
			run: (request) => agent.performance(request),
		},
	};
}
