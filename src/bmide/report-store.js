import crypto from "node:crypto";

// Armazém de snapshots e findings com paginação.
// Mantém snapshots em memória e fornece paginação para findings.

const MAX_SNAPSHOTS = 50;
const MAX_FINDINGS_PER_SNAPSHOT = 5000;

let store = new Map();

/**
 * Salva um snapshot e retorna o ID.
 */
export function saveSnapshot(snapshot) {
	const id = snapshot.snapshotId || generateId("bmide-snap");
	snapshot.snapshotId = id;

	if (store.size >= MAX_SNAPSHOTS) {
		// Remove o mais antigo.
		const oldest = store.keys().next().value;
		store.delete(oldest);
	}

	store.set(id, {
		snapshot,
		findings: [],
		createdAt: new Date().toISOString(),
	});
	return id;
}

/**
 * Recupera um snapshot por ID.
 */
export function getSnapshot(snapshotId) {
	const entry = store.get(snapshotId);
	return entry ? entry.snapshot : null;
}

/**
 * Salva findings associados a um snapshot.
 */
export function saveFindings(snapshotId, findings) {
	const entry = store.get(snapshotId);
	if (!entry) return false;

	entry.findings.push(...findings);
	if (entry.findings.length > MAX_FINDINGS_PER_SNAPSHOT) {
		entry.findings = entry.findings.slice(0, MAX_FINDINGS_PER_SNAPSHOT);
	}
	return true;
}

/**
 * Retorna findings paginados.
 */
export function getFindings(
	snapshotId,
	{ limit = 50, cursor, severityFilter } = {},
) {
	const entry = store.get(snapshotId);
	if (!entry) return { findings: [], nextCursor: null, total: 0 };

	let findings = entry.findings;

	if (severityFilter && severityFilter.length > 0) {
		const filterSet = new Set(severityFilter);
		findings = findings.filter((f) => filterSet.has(f.severity));
	}

	const total = findings.length;

	// Cursor é o índice do item anterior.
	let startIndex = 0;
	if (cursor) {
		const cursorIdx = findings.findIndex((f) => f.findingId === cursor);
		if (cursorIdx >= 0) startIndex = cursorIdx + 1;
	}

	const page = findings.slice(startIndex, startIndex + limit);
	const nextCursor =
		page.length === limit ? page[page.length - 1].findingId : null;

	return { findings: page, nextCursor, total };
}

/**
 * Retorna resumo de severidades de um snapshot.
 */
export function getSeveritySummary(snapshotId) {
	const entry = store.get(snapshotId);
	if (!entry) return null;

	const summary = {};
	for (const f of entry.findings) {
		summary[f.severity] = (summary[f.severity] || 0) + 1;
	}
	return summary;
}

/**
 * Remove um snapshot e seus findings.
 */
export function deleteSnapshot(snapshotId) {
	return store.delete(snapshotId);
}

/**
 * Limpa todo o store (para testes).
 */
export function clearStore() {
	store = new Map();
}

/**
 * Gera ID determinístico baseado em conteúdo.
 */
export function generateId(prefix = "bmide") {
	const hash = crypto
		.createHash("sha256")
		.update(String(Date.now()) + Math.random().toString(36).slice(2))
		.digest("hex")
		.slice(0, 12);
	return `${prefix}-${hash}`;
}
