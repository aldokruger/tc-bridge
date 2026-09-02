// Comparacao e plano de mudanca (plano §6.4, decisao D2).
// O diff compara SOMENTE o arquivo gerenciado corrente com o documento de
// destino — campos efetivos vindos de env/CLI ficam imutaveis (o arquivo nao
// tem precedencia). Um plano igual ao arquivo corrente nao gera changes.

import { createHash } from "node:crypto";

export function diffDocuments(currentDocument, nextData) {
	const currentData = currentDocument?.data ?? {};
	const changes = [];
	const names = new Set([
		...Object.keys(currentData),
		...Object.keys(nextData),
	]);
	for (const name of names) {
		if (!(name in currentData) || !(name in nextData)) {
			changes.push({ name, before: currentData[name], after: nextData[name] });
		} else if (!deepEqual(currentData[name], nextData[name])) {
			changes.push({ name, before: currentData[name], after: nextData[name] });
		}
	}
	return changes;
}

function deepEqual(a, b) {
	if (a === b) return true;
	if (typeof a !== typeof b) return false;
	if (Array.isArray(a)) {
		if (!Array.isArray(b) || a.length !== b.length) return false;
		return a.every((item, index) => deepEqual(item, b[index]));
	}
	if (a && b && typeof a === "object") {
		const aKeys = Object.keys(a);
		const bKeys = Object.keys(b);
		if (aKeys.length !== bKeys.length) return false;
		return aKeys.every((key) => deepEqual(a[key], b[key]));
	}
	return false;
}

export function summarizeChanges(changes, catalogByName) {
	return changes.map(({ name, before, after }) => {
		const entry = catalogByName.get(name);
		const sensitivity = entry?.sensitivity ?? "normal";
		const isSecret = sensitivity === "secret";
		const describe = (value) => {
			if (value === undefined) return undefined;
			if (isSecret) return "***";
			if (entry?.kind === "list" || entry?.kind === "listOrDefault") {
				return Array.isArray(value) ? value : [value];
			}
			if (typeof value === "boolean") return value;
			if (typeof value === "number") return value;
			return String(value);
		};
		return {
			name,
			kind: entry?.kind ?? "string",
			sensitivity,
			before: describe(before),
			after: describe(after),
			applyImpact: entry?.applyImpact ?? "restart",
		};
	});
}

export function documentFingerprint(document) {
	if (!document) return null;
	return createHash("sha256")
		.update(
			JSON.stringify({ revision: document.revision, data: document.data }),
		)
		.digest("hex");
}
