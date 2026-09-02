const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const state = {
	context: null,
	health: null,
	config: null,
	agents: [],
	tasks: [],
	audit: [],
};

const API = "/admin/v1";

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
	]);
	renderOverview();
	renderAgents();
	renderTasks();
	renderAudit();
	renderConfig();
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
			<button id="btn-run-check" class="primary">Executar check</button>
			<pre id="check-result" class="result hidden"></pre>
		</div>`;
	$("#agent-detail").classList.remove("hidden");
	$("#btn-run-check").addEventListener("click", async () => {
		const action = $("#check-action").value;
		const pre = $("#check-result");
		pre.classList.remove("hidden");
		pre.textContent = "Executando...";
		try {
			const result = await api(
				`/agents/${encodeURIComponent(agentId)}/checks`,
				{
					method: "POST",
					body: JSON.stringify({ action, parameters: {} }),
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
		});
	});
}

async function init() {
	wireTabs();
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
