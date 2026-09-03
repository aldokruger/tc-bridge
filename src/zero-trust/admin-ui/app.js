const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
	context: null,
	health: null,
	config: null,
	agents: [],
	tasks: [],
	audit: [],
	quickActions: [],
	workflows: [],
	contextMemory: [],
	chat: {
		messages: [],
		busy: false,
		llmConfig: {
			base_url:
				localStorage.getItem("tc_chat_base_url") || "https://api.openai.com/v1",
			model: localStorage.getItem("tc_chat_model") || "gpt-4o-mini",
			api_key: "",
		},
	},
};

const API = "/admin/v1";

// Sugestoes de execucao direta via /agents/:id/checks (sem LLM). Ficam fora
// acoes que dependem de contexto (page_id, service_name, relative_path/pattern).
const CHAT_SUGGESTION_CATALOG = {
	"browser.status": [
		{
			parameters: {},
			label: "browser.status",
			description: "Verifica se o Chrome de depuracao do agente esta ativo",
		},
	],
	"browser.pages": [
		{
			parameters: {},
			label: "browser.pages",
			description: "Lista as paginas Chrome depuraveis abertas no agente",
		},
	],
	"database.diagnostic": [
		{
			parameters: { check: "database_files" },
			label: "database.diagnostic: database_files",
			description: "Mostra o tamanho e uso dos arquivos de dados e log da base",
		},
		{
			parameters: { check: "waits" },
			label: "database.diagnostic: waits",
			description:
				"Mostra as principais esperas acumuladas da instancia SQL Server",
		},
		{
			parameters: { check: "active_requests" },
			label: "database.diagnostic: active_requests",
			description: "Mostra as requisicoes SQL ativas mais demoradas",
		},
		{
			parameters: { check: "expensive_queries" },
			label: "database.diagnostic: expensive_queries",
			description: "Mostra as consultas agregadas mais custosas do SQL Server",
		},
		{
			parameters: { check: "index_health" },
			label: "database.diagnostic: index_health",
			description: "Mostra indices grandes com maior fragmentacao",
		},
	],
	"teamcenter.logs.read": [
		{
			parameters: { operation: "list" },
			label: "teamcenter.logs.read: list",
			description: "Lista os arquivos de log Teamcenter disponiveis no agente",
		},
	],
};

function buildChatSuggestions() {
	const actions = state.config?.allowed_actions || [];
	const suggestions = [];
	for (const action of [...actions].sort()) {
		if (action === "teamcenter.read") continue; // umbrella; agente usa granulares
		for (const entry of CHAT_SUGGESTION_CATALOG[action] || []) {
			suggestions.push({ action, ...entry });
		}
	}
	return suggestions;
}

function renderChatSuggestions() {
	const container = $("#chat-suggestions");
	const suggestions = buildChatSuggestions();
	state.chat.suggestions = suggestions;
	if (!suggestions.length) {
		container.classList.add("hidden");
		container.innerHTML = "";
		return;
	}
	container.classList.remove("hidden");
	container.innerHTML = suggestions
		.map(
			(suggestion, index) =>
				`<button type="button" class="chat-suggestion" data-index="${index}" title="${escapeHtml(
					suggestion.description,
				)}">${escapeHtml(suggestion.label)}</button>`,
		)
		.join("");
}

async function api(path, options = {}) {
	const response = await fetch(`${API}${path}`, {
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		...options,
	});
	if (response.status === 401) {
		showLogin();
		throw new Error("unauthorized");
	}
	if (!response.ok) {
		const body = await response.json().catch(() => ({}));
		throw new Error(body.error || `HTTP ${response.status}`);
	}
	return response.json();
}

function escapeHtml(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function badge(status) {
	const map = {
		completed: ["ok", "concluida"],
		failed: ["bad", "falhou"],
		timeout: ["warn", "timeout"],
		cancelled: ["neutral", "cancelada"],
		pending: ["warn", "pendente"],
		error: ["bad", "erro"],
	};
	const [kind, label] = map[status] || ["neutral", status];
	return `<span class="badge ${kind}">${label}</span>`;
}

function relativeTime(iso) {
	if (!iso) return "—";
	const delta = Date.now() - Date.parse(iso);
	if (delta < 1_000) return "agora";
	const minutes = Math.floor(delta / 60_000);
	if (minutes < 1) return `${Math.floor(delta / 1_000)}s`;
	if (minutes < 60) return `${minutes}min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	return `${Math.floor(hours / 24)}d`;
}

function formatDate(iso) {
	if (!iso) return "—";
	return new Date(iso).toLocaleString();
}

async function login(token) {
	await api("/login", {
		method: "POST",
		body: JSON.stringify({ token }),
	});
	state.context = await api("/context");
	await enterDashboard();
}

function showLogin() {
	$("#view-dashboard").classList.add("hidden");
	$("#view-login").classList.remove("hidden");
	$("#role-chip").classList.add("hidden");
	$("#btn-logout").classList.add("hidden");
	$("#login-error").classList.add("hidden");
	$("#admin-token").focus();
}

function showError(selector, message) {
	const element = $(selector);
	element.textContent = message;
	element.classList.remove("hidden");
}

async function enterDashboard() {
	$("#view-login").classList.add("hidden");
	$("#view-dashboard").classList.remove("hidden");
	$("#role-chip").classList.remove("hidden");
	$("#role-chip").textContent = state.context.user?.role || "admin";
	$("#btn-logout").classList.remove("hidden");
	await refreshAll();
}

async function refreshAll() {
	await Promise.allSettled([
		loadHealth(),
		loadConfig(),
		loadAgents(),
		loadTasks(),
		loadAudit(),
		loadSuggestions(),
	]);
	renderOverview();
	renderAgents();
	renderTasks();
	renderAudit();
	renderConfig();
	renderChatSuggestions();
	renderQuickActions();
	renderWorkflowSelector();
}

async function loadHealth() {
	state.health = await api("/health");
}

async function loadConfig() {
	state.config = await api("/config");
}

async function loadAgents() {
	const body = await api("/agents");
	state.agents = body.agents || [];
}

async function loadTasks() {
	const body = await api("/tasks?limit=50");
	state.tasks = body.tasks || [];
}

async function loadAudit() {
	const body = await api("/audit?limit=50");
	state.audit = body.events || [];
}

async function loadSuggestions() {
	try {
		const data = await api("/suggestions");
		state.quickActions = data.quickActions || [];
		state.workflows = data.workflows || [];
	} catch {
		state.quickActions = [];
		state.workflows = [];
	}
}

function renderQuickActions() {
	const container = $("#quick-actions");
	if (!container) return;
	const actions = state.quickActions;
	if (!actions.length) {
		container.innerHTML = "";
		return;
	}
	container.innerHTML = actions
		.map(
			(a) =>
				`<button type="button" class="quick-action-btn" data-action-id="${escapeHtml(a.id)}" title="${escapeHtml(a.prompt)}">${escapeHtml(a.label)}</button>`,
		)
		.join("");
}

function renderWorkflowSelector() {
	const select = $("#workflow-selector");
	if (!select) return;
	const workflows = state.workflows;
	const firstOption = '<option value="">-- workflows --</option>';
	select.innerHTML =
		firstOption +
		workflows
			.map(
				(w) =>
					`<option value="${escapeHtml(w.id)}">${escapeHtml(w.label)} (${w.stepCount} etapas)</option>`,
			)
			.join("");
}

async function sendQuickAction(actionId) {
	resetChatError();
	const action = state.quickActions.find((a) => a.id === actionId);
	if (!action) return;
	const agentId = $("#chat-agent").value;
	if (!agentId) return showChatError("Nenhum agente conectado.");
	const llm = { ...state.chat.llmConfig };
	llm.base_url = $("#chat-base-url").value.trim();
	llm.model = $("#chat-model").value.trim();
	llm.api_key = $("#chat-api-key").value.trim();
	if (!llm.base_url || !llm.model) {
		return showChatError("Preencha Base URL e Modelo da LLM.");
	}
	if (!llm.api_key) return showChatError("Informe a API key da LLM.");
	state.chat.llmConfig = llm;
	localStorage.setItem("tc_chat_base_url", llm.base_url);
	localStorage.setItem("tc_chat_model", llm.model);
	state.chat.busy = true;
	$("#btn-chat-send").disabled = true;
	$("#chat-input").disabled = true;
	pushChatMessage({ role: "user", content: action.prompt });
	const assistantIndex = state.chat.messages.length;
	pushChatMessage({
		role: "assistant",
		content: "",
		toolEvents: [],
		streaming: true,
	});
	try {
		const history = [{ role: "user", content: action.prompt }];
		const response = await fetch(`${API}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ agent_id: agentId, llm, messages: history }),
		});
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			throw new Error(body.error || `HTTP ${response.status}`);
		}
		if (!response.body) throw new Error("resposta sem corpo");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const events = buffer.split("\n\n");
			buffer = events.pop() ?? "";
			for (const rawEvent of events) {
				const line = rawEvent.trim();
				if (!line.startsWith("data:")) continue;
				let event;
				try {
					event = JSON.parse(line.slice(5).trim());
				} catch {
					continue;
				}
				if (event.type === "token") {
					updateChatMessage(assistantIndex, {
						content: state.chat.messages[assistantIndex].content + event.text,
					});
				} else if (event.type === "tool_call") {
					const toolEvents =
						state.chat.messages[assistantIndex].toolEvents || [];
					toolEvents.push({ name: event.name, ok: null });
					updateChatMessage(assistantIndex, { toolEvents });
				} else if (event.type === "tool_result") {
					const toolEvents =
						state.chat.messages[assistantIndex].toolEvents || [];
					const last = toolEvents.find(
						(tool) => tool.name === event.name && tool.ok === null,
					);
					if (last) {
						last.ok = event.ok;
						last.error = event.error;
					}
					updateChatMessage(assistantIndex, { toolEvents });
				} else if (event.type === "error") {
					throw new Error(event.error || "erro no chat");
				} else if (event.type === "end") {
					break;
				}
			}
		}
	} catch (error) {
		state.chat.messages[assistantIndex].streaming = false;
		showChatError(`Falha: ${error.message}`);
	} finally {
		state.chat.messages[assistantIndex].streaming = false;
		renderChatHistory();
		state.chat.busy = false;
		$("#btn-chat-send").disabled = false;
		$("#chat-input").disabled = false;
		$("#chat-input").focus();
	}
}

async function startWorkflow(workflowId) {
	resetChatError();
	const workflow = state.workflows.find((w) => w.id === workflowId);
	if (!workflow) return;
	const agentId = $("#chat-agent").value;
	if (!agentId) return showChatError("Nenhum agente conectado.");
	state.chat.busy = true;
	$("#btn-chat-send").disabled = true;
	$("#chat-input").disabled = true;
	pushChatMessage({
		role: "user",
		content: `Workflow: ${workflow.label}`,
		direct: true,
	});
	const assistantIndex = state.chat.messages.length;
	pushChatMessage({
		role: "assistant",
		content: "",
		toolEvents: [],
		streaming: true,
		direct: true,
	});
	try {
		const response = await fetch(`${API}/workflow`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ workflowId, agentId }),
		});
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			throw new Error(body.error || `HTTP ${response.status}`);
		}
		if (!response.body) throw new Error("resposta sem corpo");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		let results = [];
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const events = buffer.split("\n\n");
			buffer = events.pop() ?? "";
			for (const rawEvent of events) {
				const line = rawEvent.trim();
				if (!line.startsWith("data:")) continue;
				let event;
				try {
					event = JSON.parse(line.slice(5).trim());
				} catch {
					continue;
				}
				if (event.type === "workflow_step") {
					const toolEvents =
						state.chat.messages[assistantIndex].toolEvents || [];
					toolEvents.push({ name: event.tool, ok: null });
					updateChatMessage(assistantIndex, { toolEvents });
				} else if (event.type === "workflow_done") {
					results = event.results || [];
					const toolEvents =
						state.chat.messages[assistantIndex].toolEvents || [];
					for (const result of results) {
						const entry = toolEvents.find(
							(t) => t.name === result.tool && t.ok === null,
						);
						if (entry) {
							entry.ok = result.ok;
							entry.error = result.error;
						}
					}
					updateChatMessage(assistantIndex, {
						toolEvents,
						content: `Workflow "${workflow.label}" concluido: ${results.filter((r) => r.ok).length}/${results.length} etapas OK`,
					});
				} else if (event.type === "error") {
					throw new Error(event.error || "erro no workflow");
				}
			}
		}
		state.contextMemory = results;
		renderContextMemory();
		await refreshAll();
	} catch (error) {
		state.chat.messages[assistantIndex].streaming = false;
		showChatError(`Falha no workflow: ${error.message}`);
	} finally {
		state.chat.messages[assistantIndex].streaming = false;
		renderChatHistory();
		state.chat.busy = false;
		$("#btn-chat-send").disabled = false;
		$("#chat-input").disabled = false;
		$("#chat-input").focus();
	}
}

function renderContextMemory() {
	const panel = $("#context-memory-panel");
	const toggle = $("#context-toggle");
	if (!panel || !toggle) return;
	if (!state.contextMemory.length) {
		toggle.classList.add("hidden");
		panel.classList.add("hidden");
		return;
	}
	toggle.classList.remove("hidden");
	const lines = state.contextMemory.map((entry) => {
		const status = entry.ok ? "ok" : "erro";
		const preview = entry.ok
			? JSON.stringify(entry.result ?? {}).slice(0, 120)
			: entry.error || "erro";
		return `<div class="context-memory-entry"><span class="mono">${escapeHtml(entry.tool)}</span> <span class="badge ${entry.ok ? "ok" : "bad"}">${status}</span> <span class="muted">${escapeHtml(preview)}</span></div>`;
	});
	panel.innerHTML = lines.join("");
}

function renderOverview() {
	const health = state.health || {};
	const cards = [
		{ label: "Agentes conectados", value: health.agents_connected ?? "—" },
		{ label: "Tarefas pendentes", value: health.tasks_pending ?? "—" },
		{ label: "Uptime (s)", value: health.uptime_s ?? "—" },
		{
			label: "Versao",
			value: state.context?.version ?? state.config?.version ?? "—",
		},
	];
	$("#overview-cards").innerHTML = cards
		.map(
			(card) => `
			<div class="card">
				<div class="value">${escapeHtml(card.value)}</div>
				<div class="label">${escapeHtml(card.label)}</div>
			</div>`,
		)
		.join("");
}

function renderAgents() {
	const agents = state.agents;
	if (!agents.length) {
		$("#agents-body").innerHTML =
			'<p class="muted">Nenhum agente conectado.</p>';
		return;
	}
	$("#agents-body").innerHTML = `
		<table>
			<thead><tr><th>Agente</th><th>Conectado ha</th><th>Conectado em</th><th>Tarefas pendentes</th><th></th></tr></thead>
			<tbody>
				${agents
					.map(
						(agent) => `
					<tr>
						<td class="mono">${escapeHtml(agent.agent_id)}</td>
						<td>${relativeTime(agent.connected_at)}</td>
						<td>${formatDate(agent.connected_at)}</td>
						<td>${agent.pending_tasks ?? 0}</td>
						<td><button data-agent-detail="${escapeHtml(agent.agent_id)}">Detalhe</button></td>
					</tr>`,
					)
					.join("")}
			</tbody>
		</table>`;
}

async function openAgentDetail(agentId) {
	let agent;
	try {
		agent = await api(`/agents/${encodeURIComponent(agentId)}`);
	} catch (error) {
		alert(error.message);
		return;
	}
	const actions = (state.config?.allowed_actions || [])
		.map(
			(action) =>
				`<option value="${escapeHtml(action)}">${escapeHtml(action)}</option>`,
		)
		.join("");
	const pendingRows = (agent.pending_tasks || [])
		.map(
			(task) =>
				`<tr><td class="mono">${escapeHtml(task.task_id)}</td><td>${badge("pending")}</td></tr>`,
		)
		.join("");
	$("#modal-body").innerHTML = `
		<h2>Agente <span class="mono">${escapeHtml(agent.agent_id)}</span></h2>
		<dl class="detail">
			<dt>Conectado ha</dt><dd>${relativeTime(agent.connected_at)}</dd>
			<dt>Conectado em</dt><dd>${formatDate(agent.connected_at)}</dd>
		</dl>
		<h3>Tarefas pendentes</h3>
		<table>
			<thead><tr><th>Task ID</th><th>Estado</th></tr></thead>
			<tbody>${pendingRows || '<tr><td colspan="2" class="muted">Nenhuma</td></tr>'}</tbody>
		</table>
		<div class="check-run">
			<label for="check-action">Executar health/preflight (allowlisted)</label>
			<select id="check-action">${actions}</select>
			<label for="check-params">Parametros (JSON, opcional)</label>
			<textarea id="check-params" rows="2" placeholder='{"operation":"list"}'></textarea>
			<button id="btn-run-check" class="primary">Executar check</button>
			<pre id="check-result" class="result hidden"></pre>
		</div>`;
	$("#agent-detail").classList.remove("hidden");
	$("#btn-run-check").addEventListener("click", async () => {
		const action = $("#check-action").value;
		const pre = $("#check-result");
		pre.classList.remove("hidden");
		const paramsText = $("#check-params").value.trim();
		let parameters = {};
		if (paramsText) {
			try {
				parameters = JSON.parse(paramsText);
			} catch (error) {
				pre.textContent = `ERRO: parametros invalidos (JSON): ${error.message}`;
				return;
			}
		}
		pre.textContent = "Executando...";
		try {
			const result = await api(
				`/agents/${encodeURIComponent(agentId)}/checks`,
				{
					method: "POST",
					body: JSON.stringify({ action, parameters }),
				},
			);
			pre.textContent = JSON.stringify(result.result ?? result, null, 2);
			await refreshAll();
		} catch (error) {
			pre.textContent = `ERRO: ${error.message}`;
		}
	});
}

function renderTasks() {
	const tasks = state.tasks;
	if (!tasks.length) {
		$("#tasks-body").innerHTML =
			'<p class="muted">Nenhuma tarefa registrada.</p>';
		return;
	}
	$("#tasks-body").innerHTML = `
		<table>
			<thead><tr><th>Inicio</th><th>Duracao</th><th>Action</th><th>Subject</th><th>Agente</th><th>Estado</th><th>Erro</th></tr></thead>
			<tbody>
				${tasks
					.map(
						(task) => `
					<tr>
						<td title="${formatDate(task.started_at)}">${relativeTime(task.started_at)}</td>
						<td>${task.duration_ms != null ? `${task.duration_ms}ms` : "—"}</td>
						<td class="mono">${escapeHtml(task.action ?? "—")}</td>
						<td class="mono">${escapeHtml(task.subject ?? "—")}</td>
						<td class="mono">${escapeHtml(task.agent_id)}</td>
						<td>${badge(task.status)}</td>
						<td class="muted">${escapeHtml(task.error ?? "")}</td>
					</tr>`,
					)
					.join("")}
			</tbody>
		</table>`;
}

function renderAudit() {
	const events = state.audit;
	if (!events.length) {
		$("#audit-body").innerHTML =
			'<p class="muted">Nenhum evento de auditoria.</p>';
		return;
	}
	$("#audit-body").innerHTML = `
		<table>
			<thead><tr><th>Quando</th><th>Evento</th><th>Detalhes</th></tr></thead>
			<tbody>
				${events
					.map(
						(event) => `
					<tr>
						<td title="${formatDate(event.timestamp)}">${relativeTime(event.timestamp)}</td>
						<td class="mono">${escapeHtml(event.event)}</td>
						<td class="mono">${escapeHtml(
							JSON.stringify(
								Object.fromEntries(
									Object.entries(event).filter(([key]) =>
										["agent_id", "action", "role", "ip", "error"].includes(key),
									),
								),
							),
						)}</td>
					</tr>`,
					)
					.join("")}
			</tbody>
		</table>`;
}

function renderConfig() {
	const config = state.config;
	if (!config) return;
	const rows = [
		["Fonte", config.source],
		["Somente leitura", String(config.read_only)],
		["Capability issuer", config.capability_issuer],
		["Subject", config.subject],
		["TTL (s)", String(config.capability_ttl_seconds)],
	];
	$("#config-body").innerHTML = `
		<dl class="detail">
			${rows
				.map(
					([key, value]) =>
						`<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`,
				)
				.join("")}
		</dl>
		<h3>Allowlist de acoes (${config.allowed_actions?.length ?? 0})</h3>
		<ul>
			${(config.allowed_actions || [])
				.map((action) => `<li class="mono">${escapeHtml(action)}</li>`)
				.join("")}
		</ul>`;
}

function chatAgentOptions() {
	const agents = state.agents;
	const select = $("#chat-agent");
	select.innerHTML = agents.length
		? agents
				.map(
					(agent) =>
						`<option value="${escapeHtml(agent.agent_id)}">${escapeHtml(agent.agent_id)}</option>`,
				)
				.join("")
		: '<option value="">(nenhum agente conectado)</option>';
	const previous = localStorage.getItem("tc_chat_agent");
	if (previous && agents.some((agent) => agent.agent_id === previous)) {
		select.value = previous;
	}
}

function syncChatSettings() {
	$("#chat-base-url").value = state.chat.llmConfig.base_url;
	$("#chat-model").value = state.chat.llmConfig.model;
	$("#chat-api-key").value = state.chat.llmConfig.api_key;
	renderChatSuggestions();
}

function renderChatMessage(message) {
	if (message.role === "user") {
		return `<div class="chat-msg user"><div class="bubble">${escapeHtml(message.content)}</div></div>`;
	}
	const toolBlocks = (message.toolEvents || [])
		.map((event) => {
			const status = event.ok === null ? "..." : event.ok ? "ok" : "erro";
			return `<details class="chat-tool ${event.ok === null ? "pending" : event.ok ? "ok" : "error"}">
				<summary>${escapeHtml(event.name)} ${status}</summary>
				${
					event.ok === false
						? `<p class="muted">${escapeHtml(event.error ?? "")}</p>`
						: ""
				}
			</details>`;
		})
		.join("");
	const reportHtml = buildDirectReport(message);
	return `<div class="chat-msg assistant"><div class="bubble">
		${toolBlocks}
		${
			reportHtml
				? reportHtml
				: message.content
					? `<div class="chat-content">${escapeHtml(message.content)}</div>`
					: message.toolEvents?.length
						? ""
						: '<span class="muted">...</span>'
		}
		${message.streaming ? '<span class="cursor"></span>' : ""}
	</div></div>`;
}

function renderChatHistory() {
	const history = $("#chat-history");
	history.innerHTML = state.chat.messages.map(renderChatMessage).join("");
	history.scrollTop = history.scrollHeight;
}

function pushChatMessage(message) {
	state.chat.messages.push(message);
	renderChatHistory();
}

function updateChatMessage(index, patch) {
	Object.assign(state.chat.messages[index], patch);
	renderChatHistory();
}

function resetChatError() {
	$("#chat-error").classList.add("hidden");
	$("#chat-error").textContent = "";
}

function showChatError(message) {
	const error = $("#chat-error");
	error.textContent = message;
	error.classList.remove("hidden");
}

async function sendChatMessage() {
	resetChatError();
	const agentId = $("#chat-agent").value;
	if (!agentId) return showChatError("Nenhum agente conectado para conversar.");
	const content = $("#chat-input").value.trim();
	if (!content) return;
	const llm = { ...state.chat.llmConfig };
	llm.base_url = $("#chat-base-url").value.trim();
	llm.model = $("#chat-model").value.trim();
	llm.api_key = $("#chat-api-key").value.trim();
	if (!llm.base_url || !llm.model) {
		return showChatError("Preencha Base URL e Modelo da LLM.");
	}
	if (!llm.api_key) return showChatError("Informe a API key da LLM.");
	state.chat.llmConfig = llm;
	localStorage.setItem("tc_chat_base_url", llm.base_url);
	localStorage.setItem("tc_chat_model", llm.model);
	localStorage.setItem("tc_chat_agent", agentId);
	state.chat.busy = true;
	$("#btn-chat-send").disabled = true;
	$("#chat-input").disabled = true;
	pushChatMessage({ role: "user", content });
	const assistantIndex = state.chat.messages.length;
	pushChatMessage({
		role: "assistant",
		content: "",
		toolEvents: [],
		streaming: true,
	});
	$("#chat-input").value = "";
	const history = state.chat.messages
		.filter(
			(message) =>
				!message.direct && (message.role === "user" || message.content),
		)
		.map((message) => ({ role: message.role, content: message.content || "" }));
	try {
		const response = await fetch(`${API}/chat`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			credentials: "same-origin",
			body: JSON.stringify({ agent_id: agentId, llm, messages: history }),
		});
		if (!response.ok) {
			const body = await response.json().catch(() => ({}));
			throw new Error(body.error || `HTTP ${response.status}`);
		}
		if (!response.body) throw new Error("resposta sem corpo");
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const events = buffer.split("\n\n");
			buffer = events.pop() ?? "";
			for (const rawEvent of events) {
				const line = rawEvent.trim();
				if (!line.startsWith("data:")) continue;
				let event;
				try {
					event = JSON.parse(line.slice(5).trim());
				} catch {
					continue;
				}
				if (event.type === "token") {
					updateChatMessage(assistantIndex, {
						content: state.chat.messages[assistantIndex].content + event.text,
					});
				} else if (event.type === "tool_call") {
					const toolEvents =
						state.chat.messages[assistantIndex].toolEvents || [];
					toolEvents.push({ name: event.name, ok: null });
					updateChatMessage(assistantIndex, { toolEvents });
				} else if (event.type === "tool_result") {
					const toolEvents =
						state.chat.messages[assistantIndex].toolEvents || [];
					const last = toolEvents.find(
						(tool) => tool.name === event.name && tool.ok === null,
					);
					if (last) {
						last.ok = event.ok;
						last.error = event.error;
					}
					updateChatMessage(assistantIndex, { toolEvents });
				} else if (event.type === "error") {
					throw new Error(event.error || "erro no chat");
				} else if (event.type === "end") {
					break;
				}
			}
		}
	} catch (error) {
		state.chat.messages[assistantIndex].streaming = false;
		const failedFetch = /Failed to fetch|NetworkError|network error/i.test(
			error.message || "",
		);
		showChatError(
			failedFetch
				? "Falha no chat: a conexao com o broker caiu durante a resposta. Se a resposta demorou, o servidor pode ter derrubado o stream ocioso; tente novamente."
				: `Falha no chat: ${error.message}`,
		);
	} finally {
		state.chat.messages[assistantIndex].streaming = false;
		renderChatHistory();
		state.chat.busy = false;
		$("#btn-chat-send").disabled = false;
		$("#chat-input").disabled = false;
		$("#chat-input").focus();
	}
}

const DIRECT_RESULT_MAX_CHARS = 20_000;

// Dados do agente sao nao confiaveis: qualquer valor e escapado na tabela.
const DIRECT_COLUMN_LABELS = {
	schema_name: "Schema",
	table_name: "Tabela",
	index_name: "Índice",
	index_type_desc: "Tipo de índice",
	page_count: "Páginas",
	avg_fragmentation_percent: "Fragmentação (%)",
	name: "Nome",
	type_desc: "Tipo",
	size_mb: "Tamanho (MB)",
	used_mb: "Usado (MB)",
	growth_value: "Crescimento",
	growth_unit: "Unidade",
	max_size_mb: "Máximo (MB)",
	wait_type: "Tipo de espera",
	waiting_tasks_count: "Tarefas em espera",
	wait_time_ms: "Espera (ms)",
	signal_wait_time_ms: "Espera de sinal (ms)",
	resource_wait_time_ms: "Espera de recurso (ms)",
	session_id: "Sessão",
	login_name: "Login",
	host_name: "Host",
	status: "Status",
	command: "Comando",
	wait_time: "Espera (ms)",
	blocking_session_id: "Bloqueando sessão",
	cpu_time: "CPU (ms)",
	total_elapsed_time: "Tempo total (ms)",
	reads: "Leituras",
	writes: "Escritas",
	logical_reads: "Leituras lógicas",
	query_hash: "Hash da consulta",
	execution_count: "Execuções",
	avg_elapsed_time_us: "Tempo médio (µs)",
	avg_cpu_time_us: "CPU média (µs)",
	avg_logical_reads: "Leituras lógicas médias",
	total_physical_reads: "Leituras físicas",
	last_execution_time: "Última execução",
	path: "Arquivo",
	size: "Tamanho (bytes)",
	mtime_millis: "Modificado",
};

const DIRECT_NUMERIC_COLUMNS = new Set([
	"page_count",
	"execution_count",
	"waiting_tasks_count",
	"wait_time_ms",
	"signal_wait_time_ms",
	"resource_wait_time_ms",
	"wait_time",
	"cpu_time",
	"total_elapsed_time",
	"reads",
	"writes",
	"logical_reads",
	"avg_logical_reads",
	"total_physical_reads",
	"avg_elapsed_time_us",
	"avg_cpu_time_us",
	"size",
]);

const DIRECT_MAX_TABLE_ROWS = 60;

function humanizeColumnLabel(key) {
	const known = DIRECT_COLUMN_LABELS[key];
	if (known) return known;
	return key.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDirectCell(key, value) {
	if (value === null || value === undefined) return "—";
	if (key === "mtime_millis") {
		const timestamp = Number(value);
		const date = new Date(Number.isFinite(timestamp) ? timestamp : value);
		if (!Number.isNaN(date.getTime()) && Number.isFinite(timestamp)) {
			return date.toLocaleString("pt-BR");
		}
		return String(value);
	}
	if (typeof value === "number" && DIRECT_NUMERIC_COLUMNS.has(key)) {
		return value.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
	}
	if (
		typeof value === "string" &&
		DIRECT_NUMERIC_COLUMNS.has(key) &&
		/^\d+(\.\d+)?$/.test(value)
	) {
		return Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
	}
	return String(value);
}

function truncateCell(text, max = 60) {
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

function buildDirectReport(message) {
	const payload = message.directResult;
	if (!payload || typeof payload !== "object") return null;
	let inner = payload.result ?? payload;
	const nested = inner?.result;
	if (
		!Array.isArray(inner?.rows ?? inner?.files) &&
		nested &&
		typeof nested === "object"
	) {
		inner = nested;
	}
	const rawRows = inner?.rows ?? inner?.files;
	if (!Array.isArray(rawRows) || rawRows.length === 0) return null;

	const objectRows = rawRows.filter(
		(row) => row && typeof row === "object" && !Array.isArray(row),
	);
	if (!objectRows.length) return null;

	const columns = [];
	const seen = new Set();
	for (const row of objectRows) {
		for (const key of Object.keys(row)) {
			if (!seen.has(key)) {
				seen.add(key);
				columns.push(key);
			}
		}
	}

	const header = columns
		.map((key) => `<th>${escapeHtml(humanizeColumnLabel(key))}</th>`)
		.join("");
	const rowsHtml = objectRows
		.slice(0, DIRECT_MAX_TABLE_ROWS)
		.map((row) => {
			const cells = columns
				.map((key) => {
					const raw = formatDirectCell(key, row[key]);
					const display = truncateCell(raw);
					const title =
						display.length < raw.length ? ` title="${escapeHtml(raw)}"` : "";
					return `<td${title}>${escapeHtml(display)}</td>`;
				})
				.join("");
			return `<tr>${cells}</tr>`;
		})
		.join("");

	const description =
		typeof (inner?.description ?? payload.description) === "string" &&
		(inner?.description ?? payload.description).trim()
			? (inner?.description ?? payload.description).trim()
			: "";
	const total = objectRows.length;
	const note =
		total > DIRECT_MAX_TABLE_ROWS
			? `<div class="chat-report-note">Mostrando ${DIRECT_MAX_TABLE_ROWS} de ${total} linhas.</div>`
			: "";

	return `<div class="chat-report">
		${
			description
				? `<div class="chat-report-title">${escapeHtml(description)}</div>`
				: ""
		}
		<div class="chat-table-wrap"><table class="chat-table"><thead><tr>${header}</tr></thead><tbody>${rowsHtml}</tbody></table></div>
		${note}
		<details class="chat-raw-toggle"><summary>Ver JSON bruto</summary><pre>${escapeHtml(
			message.content || "",
		)}</pre></details>
	</div>`;
}

function formatDirectResult(value) {
	let text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
	if (text.length > DIRECT_RESULT_MAX_CHARS) {
		text = `${text.slice(0, DIRECT_RESULT_MAX_CHARS)}\n... (resultado truncado)`;
	}
	return text;
}

async function runChatSuggestion(suggestion) {
	resetChatError();
	const agentId = $("#chat-agent").value;
	if (!agentId) {
		return showChatError("Nenhum agente conectado para executar.");
	}
	state.chat.busy = true;
	$("#btn-chat-send").disabled = true;
	$("#chat-input").disabled = true;
	pushChatMessage({
		role: "user",
		content: suggestion.description || suggestion.label,
		direct: true,
	});
	const assistantIndex = state.chat.messages.length;
	pushChatMessage({
		role: "assistant",
		content: "",
		toolEvents: [{ name: suggestion.action, ok: null }],
		streaming: true,
		direct: true,
	});
	try {
		const body = await api(`/agents/${encodeURIComponent(agentId)}/checks`, {
			method: "POST",
			body: JSON.stringify({
				action: suggestion.action,
				parameters: suggestion.parameters ?? {},
			}),
		});
		const toolEvents = state.chat.messages[assistantIndex].toolEvents || [];
		toolEvents[0].ok = true;
		updateChatMessage(assistantIndex, {
			toolEvents,
			content: formatDirectResult(body.result ?? body),
			directResult: body.result ?? body,
		});
		await refreshAll();
	} catch (error) {
		const failedFetch = /Failed to fetch|NetworkError|network error/i.test(
			error.message || "",
		);
		const toolEvents = state.chat.messages[assistantIndex].toolEvents || [];
		toolEvents[0].ok = false;
		toolEvents[0].error = failedFetch
			? "conexao com o broker caiu durante a execucao; tente novamente"
			: error.message;
		updateChatMessage(assistantIndex, { toolEvents });
		showChatError(
			failedFetch
				? "Falha na execucao: a conexao com o broker caiu durante a resposta; tente novamente."
				: `Falha na execucao: ${error.message}`,
		);
	} finally {
		state.chat.messages[assistantIndex].streaming = false;
		renderChatHistory();
		state.chat.busy = false;
		$("#btn-chat-send").disabled = false;
		$("#chat-input").disabled = false;
		$("#chat-input").focus();
	}
}

function wireChat() {
	chatAgentOptions();
	syncChatSettings();
	$("#chat-settings").addEventListener("input", () => {
		state.chat.llmConfig.base_url = $("#chat-base-url").value.trim();
		state.chat.llmConfig.model = $("#chat-model").value.trim();
		state.chat.llmConfig.api_key = $("#chat-api-key").value.trim();
	});
	$("#chat-form").addEventListener("submit", (event) => {
		event.preventDefault();
		if (!state.chat.busy) sendChatMessage();
	});
	$("#chat-suggestions").addEventListener("click", (event) => {
		const button = event.target.closest(".chat-suggestion");
		if (!button || state.chat.busy) return;
		const suggestion = state.chat.suggestions?.[Number(button.dataset.index)];
		if (!suggestion) return;
		runChatSuggestion(suggestion);
	});
	$("#quick-actions").addEventListener("click", (event) => {
		const button = event.target.closest(".quick-action-btn");
		if (!button || state.chat.busy) return;
		sendQuickAction(button.dataset.actionId);
	});
	$("#workflow-selector").addEventListener("change", (event) => {
		const workflowId = event.target.value;
		if (!workflowId || state.chat.busy) return;
		startWorkflow(workflowId);
		event.target.value = "";
	});
	$("#context-toggle").addEventListener("click", () => {
		$("#context-memory-panel").classList.toggle("hidden");
	});
}

function wireTabs() {
	$$(".tab").forEach((tab) => {
		tab.addEventListener("click", () => {
			$$(".tab").forEach((t) => {
				if (t === tab) t.classList.add("active");
				else t.classList.remove("active");
			});
			$$(".tabpanel").forEach((panel) => {
				const isActive = panel.id === `tab-${tab.dataset.tab}`;
				if (isActive) panel.classList.remove("hidden");
				else panel.classList.add("hidden");
			});
			if (tab.dataset.tab === "chat") {
				chatAgentOptions();
				syncChatSettings();
			}
		});
	});
}

async function init() {
	wireTabs();
	wireChat();
	$("#agent-detail").addEventListener("click", (event) => {
		if (
			event.target === $("#agent-detail") ||
			event.target.id === "modal-close"
		) {
			$("#agent-detail").classList.add("hidden");
		}
	});
	$("#agents-body").addEventListener("click", (event) => {
		const button = event.target.closest("[data-agent-detail]");
		if (button) openAgentDetail(button.dataset.agentDetail);
	});
	$("#form-login").addEventListener("submit", async (event) => {
		event.preventDefault();
		$("#login-error").classList.add("hidden");
		try {
			await login($("#admin-token").value);
		} catch (error) {
			showError("#login-error", `Falha no login: ${error.message}`);
		}
	});
	$("#btn-logout").addEventListener("click", async () => {
		try {
			await api("/logout", { method: "POST" });
		} catch {
			// cookie invalido ja e suficiente para sair
		}
		showLogin();
	});
	try {
		state.context = await api("/context");
		await enterDashboard();
	} catch {
		showLogin();
	}
}

init();
