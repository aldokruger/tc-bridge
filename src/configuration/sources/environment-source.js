// Fonte de configuracao por variaveis de ambiente + argumentos CLI (plano
// §6.2). Implementa a semantica EXATA de leitura de src/config.js (loadConfig),
// agora dirigida pelo catalogo, e rastreia a proveniencia de cada campo
// (cli > env > file > default) para a UI marcar campos locked.
//
// Precedencia efetiva: defaults < arquivo gerenciado < env < CLI.
// Peculiaridades historicas preservadas (comparaveis com src/config.js):
//   - bool e soaFlag: env `"1"` liga; qualquer outro valor (inclusive "") desliga.
//   - boolString: (flag || env || "true") !== "false"; boolStringTrue: === "true".
//   - uintQuirk (dbRequestTimeoutMs): positiveNumber(value, 30_000) com 2 args —
//     fallback undefined e mensagem de erro "30000 deve ser um inteiro...".

function commaList(value) {
	return String(value ?? "")
		.split(/[;,]/)
		.map((p) => p.trim())
		.filter(Boolean);
}

function positiveNumber(value, name, fallback) {
	if (value === undefined || value === null || value === "") return fallback;
	const number = Number(value);
	if (!Number.isInteger(number) || number < 1 || number > 120_000) {
		throw new Error(`${name} deve ser um inteiro entre 1 e 120000`);
	}
	return number;
}

function optionalPort(value, name) {
	if (value === undefined || value === null || value === "") return undefined;
	const port = Number(value);
	if (!Number.isInteger(port) || port < 1 || port > 65535) {
		throw new Error(`${name} deve ser uma porta entre 1 e 65535`);
	}
	return port;
}

function resolveDefault(entry) {
	return entry.default instanceof Function ? entry.default() : entry.default;
}

// resolveField(entry, ctx, resolved) resolve um campo na cadeia
// flags -> env -> arquivo -> default. `resolved` carrega campos ja resolvidos
// (na ordem do catalogo) para fallbackField e soaFlag herdarem valor/fonte.
function resolveField(entry, ctx, resolved) {
	const { flags, env, fileDocument } = ctx;
	const flagValue = entry.cliFlag ? flags[entry.cliFlag] : undefined;
	const envValue = entry.envName ? env[entry.envName] : undefined;
	const envDefined = envValue !== undefined;
	const envSet = envDefined && envValue !== "";
	const fileValue = fileDocument?.data?.[entry.name];
	const fileSet = fileValue !== undefined;

	// Source resultante, respeitando a mesma precedencia dos valores.
	const pickSource = (cli, env, file, fallback) =>
		cli ? "cli" : env ? "env" : file ? "file" : fallback;

	switch (entry.kind) {
		case "string": {
			if (flagValue) return { value: flagValue, source: "cli" };
			if (envSet) return { value: envValue, source: "env" };
			if (fileSet) return { value: fileValue, source: "file" };
			const inherited = entry.fallbackField
				? resolved.get(entry.fallbackField)?.value
				: undefined;
			if (inherited) {
				return {
					value: inherited,
					source: entry.fallbackField
						? (resolved.get(entry.fallbackField)?.source ?? "default")
						: "default",
				};
			}
			const fallbackDefault = resolveDefault(entry);
			return {
				value: fallbackDefault === undefined ? "" : fallbackDefault,
				source: "default",
			};
		}
		case "bool": {
			if (flagValue) return { value: true, source: "cli" };
			if (envDefined) return { value: envValue === "1", source: "env" };
			if (fileSet) return { value: Boolean(fileValue), source: "file" };
			return { value: Boolean(resolveDefault(entry)), source: "default" };
		}
		case "soaFlag": {
			if (flags[entry.cliFlag] !== undefined) {
				return { value: Boolean(flagValue), source: "cli" };
			}
			// env "" liga como false (envDefined, nao envSet): casamento exato
			// com o soaFlag de src/config.js.
			if (envDefined) return { value: envValue === "1", source: "env" };
			if (fileSet) return { value: Boolean(fileValue), source: "file" };
			if (entry.fallbackField) {
				const inherited = resolved.get(entry.fallbackField);
				return {
					value: Boolean(inherited?.value),
					source: inherited?.source ?? "default",
				};
			}
			return { value: Boolean(resolveDefault(entry)), source: "default" };
		}
		case "uint": {
			const raw = flagValue || envValue || fileValue;
			const value = positiveNumber(raw, entry.errorName, resolveDefault(entry));
			return {
				value,
				source: pickSource(flagValue, envSet, fileSet, "default"),
			};
		}
		case "uintQuirk": {
			// Reproduz a chamada historica positiveNumber(value, 30_000) (2 args).
			const raw = flagValue || envValue || fileValue;
			const value = positiveNumber(raw, 30_000);
			return {
				value,
				source: pickSource(flagValue, envSet, fileSet, "default"),
			};
		}
		case "numberFromString": {
			const raw = flagValue || envValue || fileValue;
			const value = Number(raw ?? String(resolveDefault(entry) ?? 0));
			return {
				value,
				source: pickSource(flagValue, envSet, fileSet, "default"),
			};
		}
		case "optionalPort": {
			const raw = flagValue || envValue || fileValue;
			const value = optionalPort(raw, entry.errorName);
			return {
				value,
				source: pickSource(flagValue, envSet, fileSet, "default"),
			};
		}
		case "list": {
			if (fileSet && Array.isArray(fileValue)) {
				return { value: fileValue, source: "file" };
			}
			const raw = flagValue || envValue || fileValue;
			return {
				value: commaList(raw),
				source: pickSource(flagValue, envSet, fileSet, "default"),
			};
		}
		case "listOrDefault": {
			if (fileSet && Array.isArray(fileValue) && fileValue.length) {
				return { value: fileValue, source: "file" };
			}
			const raw = flagValue || envValue || fileValue;
			const parsed = commaList(raw);
			return {
				value: parsed.length ? parsed : resolveDefault(entry),
				source: pickSource(flagValue, envSet, fileSet, "default"),
			};
		}
		case "boolString": {
			if (fileSet && typeof fileValue === "boolean") {
				return { value: fileValue, source: "file" };
			}
			const raw =
				(flagValue || envValue || fileValue) ?? resolveDefault(entry) ?? "true";
			return {
				value: raw !== "false",
				source: pickSource(flagValue, envSet, fileSet, "default"),
			};
		}
		case "boolStringTrue": {
			if (fileSet && typeof fileValue === "boolean") {
				return { value: fileValue, source: "file" };
			}
			const raw =
				(flagValue || envValue || fileValue) ??
				resolveDefault(entry) ??
				"false";
			return {
				value: raw === "true",
				source: pickSource(flagValue, envSet, fileSet, "default"),
			};
		}
		case "derived": {
			return { value: entry.derive(), source: "derived" };
		}
		default:
			throw new Error(
				`kind desconhecido no catalogo: ${entry.kind} (${entry.name})`,
			);
	}
}

// Compoe todos os campos do catalogo (inCompose != false) na ordem declarada.
// Devolve { values, sources } para que o chamador monte o objeto efetivo e a
// UI saiba a fonte de cada campo.
export function composeFromSources({
	fields,
	flags = {},
	env = process.env,
	fileDocument,
}) {
	const values = {};
	const sources = {};
	const resolved = new Map();
	for (const entry of fields) {
		if (entry.inCompose === false) continue;
		const { value, source } = resolveField(
			entry,
			{ flags, env, fileDocument },
			resolved,
		);
		values[entry.name] = value;
		sources[entry.name] = source;
		resolved.set(entry.name, { value, source });
	}
	return { values, sources };
}
