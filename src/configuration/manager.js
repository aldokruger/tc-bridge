// ConfigurationManager (plano §6.4, decisao D2).
// Fluxo da UI: snapshot() -> plan(change, expectedRevision) -> apply(planId).
// Planos expiram em 5 minutos, sao vinculados ao fingerprint da revisao de
// origem (o apply falha se a revisao avancou) e o apply devolve o diff
// efetivo para a auditoria. Segredos: nenhum valor sai do manager — planos e
// snapshots expoem apenas status ("configurado") e o arquivo gerenciado so
// aceita secretRef.
//
// composeEffectiveSync() reproduz o shape completo do loadConfig de src/config.js
// (incluindo pathSeparator e campos derivados), resolvendo segredos do secret
// store na ordem do catalogo. Apos o slice A ele NAO tem o comportamento
// extra de validar env com o schema completo; isso so entra na Fase 2 junto
// com os testes de equivalencia de mensagens de erro.

import { createHash } from "node:crypto";
import {
	diffDocuments,
	documentFingerprint,
	summarizeChanges,
} from "./diff.js";
import { ADMIN_ERROR_CODES, AdminError, formatZodIssues } from "./errors.js";
import { envelopeFor, fileDataSchemaFor } from "./schemas.js";
import { InMemorySecretStore } from "./secrets/in-memory-secret-store.js";
import { composeFromSources } from "./sources/environment-source.js";
import { InMemoryConfigStore } from "./stores/in-memory-config-store.js";

const PLAN_TTL_MS = 5 * 60 * 1000;

export class ConfigurationManager {
	constructor({
		target,
		fields,
		store,
		secretStore,
		env = process.env,
		flags = {},
	}) {
		this.target = target;
		this.fields = fields;
		this.store = store ?? new InMemoryConfigStore();
		this.secretStore = secretStore ?? new InMemorySecretStore();
		this.env = env;
		this.flags = flags;
		this.fileDataSchema = fileDataSchemaFor(target);
		this.envelopeSchema = envelopeFor(target);
		this.catalogByName = new Map(fields.map((entry) => [entry.name, entry]));
		this.plans = new Map();
	}

	async currentDocument() {
		const document = await this.store.read();
		if (!document) return { revision: 0, data: {} };
		return document;
	}

	// ------------------------------------------------------------------
	// Leitura
	// ------------------------------------------------------------------

	async snapshot() {
		const fileDocument = await this.store.read();
		const composed = composeFromSources({
			fields: this.fields,
			flags: this.flags,
			env: this.env,
			fileDocument,
		});
		const effective = {};
		const status = {};
		for (const entry of this.fields) {
			if (entry.inCompose === false) continue;
			const value = composed.values[entry.name];
			const source = composed.sources[entry.name];
			status[entry.name] = {
				source,
				locked: source !== "file" && source !== "default",
				sensitivity: entry.sensitivity,
				applyImpact: entry.applyImpact,
				mutableInUi: entry.mutableInUi,
			};
			if (entry.sensitivity === "secret") {
				// Nunca expoe valor: apenas status de configuracao.
				effective[entry.name] =
					value !== undefined && value !== null && value !== ""
						? { configured: true, valueSource: source }
						: { configured: false, valueSource: source };
			} else {
				effective[entry.name] = value;
			}
		}
		const current = fileDocument ?? { revision: 0, data: {} };
		return {
			target: this.target,
			revision: current.revision,
			fingerprint: documentFingerprint(fileDocument),
			effective,
			status,
			file: fileDocument
				? {
						revision: fileDocument.revision,
						present: true,
						secretRefs: this.#collectSecretRefs(fileDocument.data),
					}
				: { revision: 0, present: false, secretRefs: [] },
		};
	}

	// Reproduz o shape do loadConfig atual (sync). Recebe flags opcionais do
	// entry point e ignora o documento gerenciado (precedencia: o loadConfig
	// continua lendo env/CLI; o arquivo passa a valer so na Fase 2, sob teste
	// de equivalencia).
	composeEffectiveSync(flags = {}) {
		const composed = composeFromSources({
			fields: this.fields,
			flags: flags ?? this.flags,
			env: this.env,
			fileDocument: null,
		});
		const effective = {};
		for (const entry of this.fields) {
			if (entry.inCompose === false) continue;
			// loadConfig atual ja carrega o valor dos segredos da env; manter
			// o valor real aqui (o mascaramento e responsabilidade da UI,
			// via snapshot()).
			effective[entry.name] = composed.values[entry.name];
		}
		return effective;
	}

	#collectSecretRefs(data) {
		const refs = [];
		for (const entry of this.fields) {
			if (entry.sensitivity !== "secret") continue;
			const value = data?.[entry.name];
			if (value && typeof value === "object" && value.secretRef) {
				refs.push(value.secretRef);
			}
		}
		return refs;
	}

	// ------------------------------------------------------------------
	// Plano de mudanca
	// ------------------------------------------------------------------

	async plan(change, expectedRevision) {
		const current = await this.store.read();
		const currentRevision = current?.revision ?? 0;
		if (
			expectedRevision !== undefined &&
			expectedRevision !== currentRevision
		) {
			throw new AdminError(
				ADMIN_ERROR_CODES.REVISION_CONFLICT,
				`revisao esperada ${expectedRevision} difere da revisao corrente ${currentRevision}; recarregue o snapshot`,
			);
		}
		const parsed = this.fileDataSchema.safeParse(change ?? {});
		if (!parsed.success) {
			throw new AdminError(
				ADMIN_ERROR_CODES.VALIDATION,
				`mudanca invalida: ${formatZodIssues(parsed.error)}`,
			);
		}
		const nextData = { ...(current?.data ?? {}), ...parsed.data };
		// Campos secret com secretRef desconhecido sao rejeitados no plan.
		this.#assertSecretRefsKnown(nextData);
		const changes = diffDocuments(current, nextData);
		const planId = createHash("sha256")
			.update(
				`${this.target}:${currentRevision}:${JSON.stringify(nextData)}:${Date.now()}`,
			)
			.digest("hex")
			.slice(0, 24);
		const plan = {
			planId,
			revision: currentRevision,
			fingerprint: documentFingerprint(current),
			changes,
			summary: summarizeChanges(changes, this.catalogByName),
			expiresAt: Date.now() + PLAN_TTL_MS,
			nextData,
		};
		this.plans.set(planId, plan);
		return this.#publicPlan(plan);
	}

	#assertSecretRefsKnown(nextData) {
		for (const entry of this.fields) {
			if (entry.sensitivity !== "secret") continue;
			const value = nextData[entry.name];
			if (value && typeof value === "object" && value.secretRef) {
				const status = this.secretStore.status(value.secretRef);
				if (!status.configured) {
					throw new AdminError(
						ADMIN_ERROR_CODES.SECRET_MISSING,
						`secret ${value.secretRef} nao configurado no ambiente; o plano e rejeitado`,
					);
				}
			}
		}
	}

	#publicPlan(plan) {
		const count = plan.changes.length;
		return {
			planId: plan.planId,
			revision: plan.revision,
			fingerprint: plan.fingerprint,
			changeCount: count,
			summary: plan.summary,
			expiresAt: plan.expiresAt,
			expiresInMs: Math.max(0, plan.expiresAt - Date.now()),
			secretRefs: plan.changes
				.filter(
					(change) =>
						this.catalogByName.get(change.name)?.sensitivity === "secret",
				)
				.map((change) => change.name),
		};
	}

	async apply(planId) {
		const plan = this.plans.get(planId);
		if (!plan) {
			throw new AdminError(
				ADMIN_ERROR_CODES.PLAN_NOT_FOUND,
				`plano ${planId} inexistente ou expirado`,
			);
		}
		if (Date.now() > plan.expiresAt) {
			this.plans.delete(planId);
			throw new AdminError(
				ADMIN_ERROR_CODES.PLAN_EXPIRED,
				`plano ${planId} expirou; recrie o plano`,
			);
		}
		const current = await this.store.read();
		if (documentFingerprint(current) !== plan.fingerprint) {
			this.plans.delete(planId);
			throw new AdminError(
				ADMIN_ERROR_CODES.REVISION_CONFLICT,
				`o arquivo gerenciado mudou desde a criacao do plano ${planId}; recarregue e recrie o plano`,
			);
		}
		const { revision } = await this.store.write(plan.nextData);
		this.plans.delete(planId);
		return {
			planId,
			revision,
			appliedAt: new Date().toISOString(),
			changeCount: plan.changes.length,
			summary: plan.summary,
			secretRefs: plan.secretRefs,
		};
	}

	// Rollback: restaura o documento da revisao informada e o persiste como
	// nova revisao (nunca reescreve historia). Restaura tambem o documento do
	// arquivo gerenciado, nao apenas o numero.
	async rollback(revision) {
		if (!Number.isInteger(revision) || revision < 1) {
			throw new AdminError(
				ADMIN_ERROR_CODES.VALIDATION,
				`revisao de rollback invalida: ${revision}`,
			);
		}
		const restored = await this.store.readRevision(revision);
		if (!restored) {
			throw new AdminError(
				ADMIN_ERROR_CODES.REVISION_NOT_FOUND,
				`revisao ${revision} nao encontrada no historico`,
			);
		}
		const { revision: newRevision } = await this.store.write(restored.data);
		return { revision: newRevision, restoredFrom: revision };
	}
}
