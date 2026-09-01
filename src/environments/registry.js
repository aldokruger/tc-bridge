import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { environmentProfileSchema } from "./schemas.js";

// Registro local de ambientes Teamcenter conhecidos. O arquivo apontado por
// TC_ENVIRONMENT_REGISTRY_FILE e lido no host, cada perfil e validado pelo
// schema e perfis invalidos impedem somente o ambiente afetado — nunca o
// agente inteiro (plano, secao 7; ADR-0006).

export function formatProfileError(environmentId, error) {
	const issues = Array.isArray(error?.issues)
		? error.issues
				.map((issue) => {
					const where = issue.path.length ? ` em ${issue.path.join(".")}` : "";
					return `${issue.message}${where}`;
				})
				.join("; ")
		: String(error?.message ?? error);
	return `perfil ${environmentId} invalido: ${issues}`;
}

export function validateRegistryInput(input) {
	if (!Array.isArray(input?.environments)) {
		throw new Error(
			'registro de ambientes deve ser um objeto com o array "environments"',
		);
	}
	if (input.environments.length === 0) {
		throw new Error("registro de ambientes nao pode estar vazio");
	}
	const environments = new Map();
	const errors = [];
	const seenIds = new Set();
	for (const raw of input.environments) {
		const environmentId = raw?.environmentId;
		if (typeof environmentId !== "string" || !environmentId) {
			errors.push(
				formatProfileError(
					`<indice ${errors.length + 1}>`,
					new Error("environmentId ausente"),
				),
			);
			continue;
		}
		const parsed = environmentProfileSchema.safeParse(raw);
		if (!parsed.success) {
			errors.push(formatProfileError(environmentId, parsed.error));
			continue;
		}
		if (seenIds.has(environmentId)) {
			errors.push(
				formatProfileError(environmentId, new Error("environmentId duplicado")),
			);
			continue;
		}
		seenIds.add(environmentId);
		environments.set(environmentId, parsed.data);
	}
	return { environments, errors };
}

function readJsonOrThrow(read, filePath) {
	const resolved = path.resolve(String(filePath ?? ""));
	let rawText;
	try {
		rawText = read(resolved);
	} catch (error) {
		throw new Error(
			`nao foi possivel ler o registro de ambientes ${resolved}: ${error.message}`,
		);
	}
	let input;
	try {
		input = JSON.parse(rawText);
	} catch (error) {
		throw new Error(
			`registro de ambientes ${resolved} nao e JSON valido: ${error.message}`,
		);
	}
	return input;
}

// Variante sincrona: usada na inicializacao (loadConfig) para validar o
// registro antes de o servidor atender. Perfis invalidos viram errors[] —
// nunca derrubam o processo inteiro.
export function readEnvironmentRegistrySync(filePath) {
	return validateRegistryInput(readJsonOrThrow(fs.readFileSync, filePath));
}

// Variante assincrona: usada pelas actions do Collector SDK (Fase 1, entrega 6).
export async function loadEnvironmentRegistry(filePath) {
	return validateRegistryInput(
		await readJsonOrThrow(fsPromises.readFile, filePath),
	);
}
