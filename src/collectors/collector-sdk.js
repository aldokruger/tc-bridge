import { checkResultSchema } from "../environments/schemas.js";

// Collector SDK (plano Fase 1, entregas 6-8; ADR-0008). Contrato comum de
// execucao de checks: identidade (collector_id + collector_version),
// budget de impacto, timeout, truncamento e partial errors. Todo resultado
// trafega no envelope CheckResult (ADR-0007), sem paths, URLs ou credenciais.
//
// - runCollector: contrato de execucao para collectors novos (mede duracao,
//   aplica timeout via AbortSignal e coleta warnings/partial errors).
// - buildCheckResult: monta e valida o envelope a partir de campos ja
//   resolvidos — usado pela migracao compativel dos checks SOA (entrega 9),
//   que preserva a telemetria ja propagada pelo gate (ADR-0004).

export const SOA_COLLECTOR_ID = "teamcenter.soa";
export const SOA_COLLECTOR_VERSION = "1.0.0";

export function buildCheckResult({
	checkId,
	collector,
	collectorVersion,
	environmentId,
	componentId,
	status,
	startedAt,
	finishedAt,
	durationMs,
	impactBudget,
	evidenceRefs = [],
	warnings = [],
	partialErrors = [],
	truncated = false,
	...rest
}) {
	// Chaves nao destruturadas sao repassadas ao schema estrito: typo em
	// nome de campo (ex.: durationms) vira erro em vez de ser ignorado.
	return checkResultSchema.parse({
		...rest,
		checkId,
		collector,
		collectorVersion,
		environmentId,
		componentId,
		status,
		startedAt,
		finishedAt,
		durationMs,
		impactBudget,
		evidenceRefs,
		warnings,
		partialErrors,
		truncated,
	});
}

// Executa um handler de collector com o contrato do SDK: mede duracao,
// aplica timeout via AbortSignal (o handler deve respeitar o signal) e
// mapeia o output { data, truncated, warnings, partialErrors } para o
// envelope. Erro lancado vira status "error" com a mensagem em partialErrors.
export async function runCollector({
	checkId,
	collector,
	collectorVersion,
	environmentId,
	componentId,
	impactBudget,
	timeoutMs,
	run,
}) {
	const startedAt = new Date();
	const controller = new AbortController();
	const timer = timeoutMs
		? setTimeout(() => controller.abort(), timeoutMs)
		: null;
	let status = "passed";
	let truncated = false;
	let warnings = [];
	let partialErrors = [];
	let data;
	try {
		const output = (await run(controller.signal)) ?? {};
		data = output.data;
		truncated = output.truncated === true;
		warnings = Array.isArray(output.warnings) ? output.warnings : [];
		partialErrors = Array.isArray(output.partialErrors)
			? output.partialErrors
			: [];
		if (output.status === "failed") status = "failed";
		if (controller.signal.aborted) {
			status = "error";
			partialErrors = [...partialErrors, "timeout do collector excedido"];
		}
	} catch (error) {
		status = "error";
		partialErrors = [
			...partialErrors,
			error instanceof Error ? error.message : String(error),
		];
	} finally {
		clearTimeout(timer);
	}
	const finishedAt = new Date();
	return {
		envelope: buildCheckResult({
			checkId,
			collector,
			collectorVersion,
			environmentId,
			componentId,
			status,
			startedAt: startedAt.toISOString(),
			finishedAt: finishedAt.toISOString(),
			durationMs: finishedAt.getTime() - startedAt.getTime(),
			impactBudget,
			warnings,
			partialErrors,
			truncated,
		}),
		data,
	};
}

// Migracao compativel (Fase 1, entrega 9): envelope aditivo ao resultado SOA atual.
export function soaCheckResult(
	result,
	{ action, impactBudget, environmentRegistry },
) {
	const finishedAt = new Date();
	const durationMs = result?._meta?.durationMs ?? 0;
	const failed = result?.ok === false;
	const environmentId =
		environmentRegistry?.size === 1
			? [...environmentRegistry.keys()][0]
			: undefined;
	const toMessage = (item) =>
		typeof item === "string" ? item : String(item?.message ?? item);
	return buildCheckResult({
		checkId: action,
		collector: SOA_COLLECTOR_ID,
		collectorVersion: SOA_COLLECTOR_VERSION,
		environmentId,
		status: failed ? "failed" : "passed",
		startedAt: new Date(finishedAt.getTime() - durationMs).toISOString(),
		finishedAt: finishedAt.toISOString(),
		durationMs,
		impactBudget,
		warnings: (result?.warnings ?? []).map(toMessage),
		partialErrors: failed
			? (result?.problems ?? []).map(toMessage)
			: (result?.partial_errors ?? []).map(toMessage),
		truncated: result?.truncated ?? false,
	});
}
