import assert from "node:assert/strict";
import test from "node:test";
import { createEngineeringAssistant } from "../src/engineering/assistant.js";
import { createDraftStore } from "../src/engineering/draft-store.js";

test("draft cria rascunho de saved query com queryKind", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "saved-query",
		release: "2606",
		requirements: "Localizar revisoes liberadas por projeto e data",
		environment_id: "tc2606-dev",
	});
	assert.ok(draft.draft_id.startsWith("draft-"));
	assert.equal(draft.artifact_kind, "saved-query");
	assert.equal(draft.status, "draft");
	assert.equal(draft.content.queryKind, "saved-query");
	assert.ok(draft.expires_at);
});

test("draft rejeita release invalida", async () => {
	const assistant = createEngineeringAssistant();
	await assert.rejects(
		assistant.draft({
			artifact_kind: "saved-query",
			release: "26",
			requirements: "teste",
		}),
		/release invalida/,
	);
});

test("draft rejeita requirements vazio", async () => {
	const assistant = createEngineeringAssistant();
	await assert.rejects(
		assistant.draft({
			artifact_kind: "saved-query",
			release: "2606",
			requirements: "",
		}),
		/requirements e obrigatorio/,
	);
});

test("validate atualiza status para validated quando sem blockers", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "saved-query",
		release: "2606",
		requirements: "Buscar Item por nome",
	});
	const result = await assistant.validate({
		draft_id: draft.draft_id,
	});
	assert.equal(result.draft.status, "validated");
	assert.equal(result.findings.length, 0);
});

test("validate mantem draft quando ha blockers", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "saved-query",
		release: "2606",
		requirements: "Buscar Item por nome",
	});
	// Forca status validated sem fontes para gerar blocker de proveniencia
	const store = assistant.getStore();
	const record = store.get(draft.draft_id);
	record.status = "validated";
	record.source_refs = [];
	store.save(record);
	const result = await assistant.validate({ draft_id: draft.draft_id });
	assert.equal(result.draft.status, "draft");
	assert.ok(result.findings.some((f) => f.severity === "blocker"));
});

test("validate rejeita draft_id inexistente", async () => {
	const assistant = createEngineeringAssistant();
	await assert.rejects(
		assistant.validate({ draft_id: "draft-nao-existe" }),
		/rascunho nao encontrado/,
	);
});

test("rascunho expira e nao e mais recuperavel", async () => {
	const store = createDraftStore({ ttlSeconds: 0 });
	const assistant = createEngineeringAssistant({ draftStore: store });
	const draft = await assistant.draft({
		artifact_kind: "saved-query",
		release: "2606",
		requirements: "teste",
	});
	// Espera um pouco para expirar
	await new Promise((r) => setTimeout(r, 10));
	const recovered = store.get(draft.draft_id);
	assert.equal(recovered, null);
});

test("rascunho possui hash de conteudo", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "saved-query",
		release: "2606",
		requirements: "teste",
	});
	assert.ok(draft.content_hash);
	assert.equal(typeof draft.content_hash, "string");
	assert.equal(draft.content_hash.length, 64);
});
