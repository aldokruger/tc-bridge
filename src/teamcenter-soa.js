import { spawn } from "node:child_process";
import path from "node:path";

const MAX_RESULT_LIMIT = 200;
const SOA_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 2_000_000;

function stringArray(value, name, { maxItems = 50, maxLength = 256 } = {}) {
	if (typeof value !== "string")
		throw new Error(`Parametro obrigatorio: ${name}`);
	let values;
	try {
		values = JSON.parse(value);
	} catch {
		throw new Error(`${name} deve ser um array JSON`);
	}
	if (!Array.isArray(values) || values.length > maxItems) {
		throw new Error(`${name} deve conter no maximo ${maxItems} valores`);
	}
	if (
		!values.every(
			(item) => typeof item === "string" && item.length <= maxLength,
		)
	) {
		throw new Error(`${name} contem valor invalido`);
	}
	return values;
}

function limit(value) {
	if (value === undefined) return 50;
	if (!Number.isInteger(value) || value < 1 || value > MAX_RESULT_LIMIT) {
		throw new Error(`limit deve ser um inteiro entre 1 e ${MAX_RESULT_LIMIT}`);
	}
	return value;
}

export function validateTeamcenterReadRequest(request) {
	if (!request || typeof request !== "object") {
		throw new Error("Consulta Teamcenter invalida");
	}
	switch (request.check) {
		case "session_info":
			return { check: request.check };
		case "get_preferences":
			return {
				check: request.check,
				scope:
					typeof request.scope === "string" && request.scope.length <= 80
						? request.scope
						: "",
				preferenceNames: stringArray(
					request.preference_names_json,
					"preference_names_json",
				),
			};
		case "get_object_properties":
			if (
				typeof request.object_uid !== "string" ||
				!/^[A-Za-z0-9_-]{8,128}$/.test(request.object_uid)
			) {
				throw new Error("object_uid invalido");
			}
			return {
				check: request.check,
				objectUid: request.object_uid,
				propertyNames: stringArray(
					request.property_names_json,
					"property_names_json",
					{
						maxItems: 20,
						maxLength: 128,
					},
				),
			};
		case "execute_saved_query": {
			if (
				typeof request.query_uid !== "string" ||
				!/^[A-Za-z0-9_-]{8,128}$/.test(request.query_uid)
			) {
				throw new Error("query_uid invalido");
			}
			const entries = stringArray(request.entries_json, "entries_json");
			const values = stringArray(request.values_json, "values_json", {
				maxItems: 50,
				maxLength: 2_000,
			});
			if (entries.length !== values.length) {
				throw new Error("entries_json e values_json devem ter o mesmo tamanho");
			}
			return {
				check: request.check,
				queryUid: request.query_uid,
				entries,
				values,
				limit: limit(request.limit),
			};
		}
		default:
			throw new Error(
				`Consulta Teamcenter nao permitida: ${String(request.check)}`,
			);
	}
}

function adapterArgs(request) {
	switch (request.check) {
		case "session_info":
			return ["--action", "session_info"];
		case "get_preferences":
			return [
				"--action",
				"get_preferences",
				"--scope",
				request.scope,
				"--preference-names",
				JSON.stringify(request.preferenceNames),
			];
		case "get_object_properties":
			return [
				"--action",
				"get_object_properties",
				"--object-uid",
				request.objectUid,
				"--property-names",
				JSON.stringify(request.propertyNames),
			];
		case "execute_saved_query":
			return [
				"--action",
				"execute_saved_query",
				"--query-uid",
				request.queryUid,
				"--entries",
				JSON.stringify(request.entries),
				"--values",
				JSON.stringify(request.values),
				"--limit",
				String(request.limit),
			];
	}
}

function runAdapter(request, cfg) {
	return new Promise((resolve, reject) => {
		const classpath = [
			cfg.teamcenterSoaAdapterJar,
			path.join(cfg.teamcenterSoaLib, "*"),
			...cfg.teamcenterSoaExtraJars,
		].join(cfg.pathSeparator);
		const child = spawn(
			cfg.teamcenterJava,
			[
				"-cp",
				classpath,
				"com.aldokruger.tcbridge.TeamcenterSoaAdapter",
				...adapterArgs(request),
			],
			{ windowsHide: true, env: process.env },
		);
		let stdout = "";
		let stderr = "";
		let settled = false;
		const finish = (fn, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			fn(value);
		};
		const append = (text, chunk) => `${text}${chunk}`.slice(-MAX_OUTPUT_BYTES);
		const timer = setTimeout(() => {
			child.kill();
			finish(reject, new Error("Consulta SOA excedeu o limite de 30 segundos"));
		}, SOA_TIMEOUT_MS);

		child.stdout.on("data", (chunk) => {
			stdout = append(stdout, String(chunk));
		});
		child.stderr.on("data", (chunk) => {
			stderr = append(stderr, String(chunk));
		});
		child.once("error", (error) => finish(reject, error));
		child.once("exit", (code) => {
			if (code !== 0) {
				finish(
					reject,
					new Error(
						stderr.trim() || `Adaptador SOA encerrou com codigo ${code}`,
					),
				);
				return;
			}
			try {
				const result = JSON.parse(stdout.trim());
				if (result.error) throw new Error(result.error);
				finish(resolve, result);
			} catch (error) {
				finish(
					reject,
					error instanceof Error
						? error
						: new Error("Resposta invalida do adaptador SOA"),
				);
			}
		});
	});
}

export async function runTeamcenterRead(request, cfg) {
	return runAdapter(validateTeamcenterReadRequest(request), cfg);
}
