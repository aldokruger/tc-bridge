import { BMIDE_RESOLUTIONS, makeEntityId } from "./schemas.js";

/**
 * Resolve referências entre entidades BMIDE.
 * Passagem 2 do pipeline — cruza entidades e vínculos para classificar:
 *   local, dependency, installation, unresolved, unverified
 *
 * @param {Array} entities - Entidades extraídas pelo model-builder
 * @param {Array} references - Referências extraídas pelo model-builder
 * @param {Object} dependencyInfo - Dados de dependency.xml (template names, prefixes)
 * @returns {{ resolved: number, unresolved: number, unverified: number }}
 */
export function resolveReferences(entities, references, dependencyInfo) {
	// Index por entityId para lookup rápido.
	const entityIndex = new Map();
	for (const e of entities) {
		entityIndex.set(e.entityId, e);
	}

	// Index por nome (kind agnostic) — resolve entidades OOTB vs custom.
	const nameIndex = new Map();
	for (const e of entities) {
		if (!nameIndex.has(e.name)) {
			nameIndex.set(e.name, []);
		}
		nameIndex.get(e.name).push(e);
	}

	// Dependências conhecidas (template names do dependency.xml).
	const knownDeps = new Set(
		(dependencyInfo?.dependencies || []).map((d) => d.toLowerCase()),
	);
	const depPrefixes = new Set(
		(dependencyInfo?.prefixes || []).map((p) => p.toLowerCase()),
	);

	let resolved = 0;
	let unresolved = 0;
	let unverified = 0;

	for (const ref of references) {
		const fromEntity = entityIndex.get(ref.fromEntityId);
		if (!fromEntity) {
			ref.resolution = "unresolved";
			unresolved++;
			continue;
		}

		// Tenta resolver localmente.
		const targets = nameIndex.get(ref.targetName);
		if (targets && targets.length > 0) {
			ref.targetEntityId = targets[0].entityId;
			ref.resolution = "local";
			resolved++;
			continue;
		}

		// Verifica se é nome OOTB (começa com Fnd, TC0, Item, ItemRevision, etc.).
		if (isOOTBName(ref.targetName)) {
			// OOTB não está no projeto — mas pode vir de dependência.
			if (knownDeps.size > 0) {
				ref.resolution = "dependency";
				ref.dependencyTemplate = findMatchingDep(
					ref.targetName,
					knownDeps,
					depPrefixes,
				);
				resolved++;
			} else {
				ref.resolution = "unverified";
				unverified++;
			}
			continue;
		}

		// Nome custom não encontrado localmente.
		ref.resolution = "unresolved";
		unresolved++;
	}

	return { resolved, unresolved, unverified };
}

/**
 * Nomes OOTB típicos do Teamcenter.
 */
const OOTB_PREFIXES = [
	"item",
	"itemrevision",
	"workspaceobject",
	"dataset",
	"folder",
	"imagerepresentation",
	"tcrepresentation",
	"fnd0",
	"tc0",
	"content",
	"document",
	"specification",
	"em molds",
	"eprs",
	"epm",
	"mechschematic",
	"aep",
	"organization",
	"group",
	"user",
	"spellchecker",
	"accessrule",
	"privilege",
	"role",
	"imantype",
	"form",
	"relationtype",
];

function isOOTBName(name) {
	const lower = name.toLowerCase();
	for (const prefix of OOTB_PREFIXES) {
		if (lower.startsWith(prefix)) return true;
	}
	return false;
}

function findMatchingDep(targetName, knownDeps, depPrefixes) {
	const lower = targetName.toLowerCase();
	// Match por prefixo do template.
	for (const prefix of depPrefixes) {
		if (lower.startsWith(prefix)) {
			for (const dep of knownDeps) {
				if (dep.startsWith(prefix)) return dep;
			}
		}
	}
	// Fallback: retorna primeira dependência registrada.
	for (const dep of knownDeps) return dep;
	return null;
}
