import assert from "node:assert/strict";
import test from "node:test";
import { createEngineeringAssistant } from "../src/engineering/assistant.js";
import { generateAwcCustom } from "../src/engineering/generators/awc.js";
import { generateBmideExtension } from "../src/engineering/generators/bmide.js";
import { generateItkHandlerSkeleton } from "../src/engineering/generators/itk-handler.js";
import { generateSoaCustom } from "../src/engineering/generators/soa.js";
import { validateCustomizationDraft } from "../src/engineering/validators/customization.js";

test("draft cria rascunho ITK com skeleton", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "itk",
		release: "2606",
		requirements: "Handler para validar anexos antes de aprovar",
		environment_id: "tc2606-dev",
		constraints: {
			namespace_prefix: "acme",
			handler_name: "acme_validate_attachments",
		},
	});
	assert.ok(draft.draft_id.startsWith("draft-"));
	assert.equal(draft.artifact_kind, "itk");
	assert.equal(draft.status, "draft");
	assert.ok(draft.content.code);
	assert.ok(draft.content.code.includes("acme_validate_attachments"));
	assert.ok(draft.content.code.includes("EPM_register_action_handler"));
});

test("draft cria rascunho BMIDE com tipo e propriedades", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "bmide",
		release: "2606",
		requirements: "Criar tipo com descricao e status",
		environment_id: "tc2606-dev",
		constraints: { namespace_prefix: "acme", type_name: "acme_Document" },
	});
	assert.equal(draft.artifact_kind, "bmide");
	assert.ok(draft.content.typeName);
	assert.ok(draft.content.properties.length > 0);
	assert.ok(draft.content.properties.some((p) => p.name.includes("acme_")));
	assert.ok(draft.content.deployImpact);
});

test("validate aceita ITK valido", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "itk",
		release: "2606",
		requirements: "Handler para anexos",
	});
	const result = await assistant.validate({ draft_id: draft.draft_id });
	assert.equal(result.draft.status, "validated");
});

test("validateCustomizationDraft bloqueia namespace ausente", () => {
	const findings = validateCustomizationDraft({
		artifact_kind: "itk",
		content: {},
	});
	assert.ok(findings.some((f) => f.code === "customization.namespace.missing"));
	assert.ok(findings.some((f) => f.severity === "blocker"));
});

test("validateCustomizationDraft bloqueia API interna em ITK", () => {
	const findings = validateCustomizationDraft({
		artifact_kind: "itk",
		content: {
			namespacePrefix: "acme",
			code: "int x = ITK_internal_foo();",
			buildSteps: ["make"],
		},
	});
	assert.ok(findings.some((f) => f.code === "customization.itk.internal-api"));
	assert.ok(findings.some((f) => f.severity === "blocker"));
});

test("validateCustomizationDraft alerta falta de MEM_free", () => {
	const findings = validateCustomizationDraft({
		artifact_kind: "itk",
		content: {
			namespacePrefix: "acme",
			code: 'int handler() { int ifail = ITK_ok; return ifail; }\nEPM_register_action_handler("x","y",handler);',
			buildSteps: ["make"],
		},
	});
	assert.ok(
		findings.some((f) => f.code === "customization.itk.resource-cleanup"),
	);
});

test("validateCustomizationDraft exige deployImpact em BMIDE", () => {
	const findings = validateCustomizationDraft({
		artifact_kind: "bmide",
		content: {
			namespacePrefix: "acme",
			properties: [{ name: "acme_prop" }],
		},
	});
	assert.ok(
		findings.some((f) => f.code === "customization.bmide.deploy-impact"),
	);
});

test("validateCustomizationDraft exige namespace em propriedade BMIDE", () => {
	const findings = validateCustomizationDraft({
		artifact_kind: "bmide",
		content: {
			namespacePrefix: "acme",
			properties: [{ name: "prop_sem_namespace" }],
			deployImpact: { requiresTemplateUpdate: true },
		},
	});
	assert.ok(
		findings.some((f) => f.code === "customization.bmide.property.namespace"),
	);
});

test("validateCustomizationDraft exige contrato SOA", () => {
	const findings = validateCustomizationDraft({
		artifact_kind: "soa",
		content: {
			namespacePrefix: "acme",
		},
	});
	assert.ok(findings.some((f) => f.code === "customization.soa.contract"));
});

test("validateCustomizationDraft exige modulo AWC", () => {
	const findings = validateCustomizationDraft({
		artifact_kind: "awc",
		content: {
			namespacePrefix: "acme",
		},
	});
	assert.ok(findings.some((f) => f.code === "customization.awc.module"));
});

test("draft cria rascunho SOA com contrato e esqueleto", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "soa",
		release: "2606",
		requirements: "Operacao para listar itens aprovados",
		environment_id: "tc2606-dev",
		constraints: {
			namespace_prefix: "acme",
			service_name: "AcmeItemService",
			operation_name: "listApprovedItems",
		},
	});
	assert.equal(draft.artifact_kind, "soa");
	assert.equal(draft.status, "draft");
	assert.ok(draft.content.code.includes("AcmeItemService"));
	assert.ok(draft.content.code.includes("listApprovedItems"));
	assert.ok(draft.content.contract);
	assert.equal(draft.content.contract.service, "AcmeItemService");
	assert.equal(draft.content.contract.operation, "listApprovedItems");
});

test("draft cria rascunho AWC com modulo e XRT", async () => {
	const assistant = createEngineeringAssistant();
	const draft = await assistant.draft({
		artifact_kind: "awc",
		release: "2606",
		requirements: "Painel customizado para aprovacao de itens",
		environment_id: "tc2606-dev",
		constraints: {
			namespace_prefix: "acme",
			module_name: "acme-approval-panel",
			locale: "pt_BR",
			panel_caption: "Aprovacao de Itens",
		},
	});
	assert.equal(draft.artifact_kind, "awc");
	assert.equal(draft.status, "draft");
	assert.ok(draft.content.moduleCode.includes("acme-approval-panel"));
	assert.ok(draft.content.xrtSnippet.includes("Aprovacao de Itens"));
	assert.equal(draft.content.locale, "pt_BR");
	assert.ok(draft.content.compatibility);
});

test("generateSoaCustom gera esqueleto com namespace", () => {
	const draft = generateSoaCustom({
		requirements: "Servico de exportacao",
		release: "2606",
		constraints: { namespace_prefix: "testco" },
	});
	assert.ok(draft.content.code.includes("testco.soa"));
	assert.ok(draft.content.code.includes("testcoService"));
	assert.equal(draft.artifact_kind, "soa");
});

test("generateAwcCustom gera modulo com locale", () => {
	const draft = generateAwcCustom({
		requirements: "Modulo de dashboard",
		release: "2606",
		constraints: { namespace_prefix: "testco", locale: "de_DE" },
	});
	assert.ok(draft.content.moduleCode.includes("testco"));
	assert.equal(draft.content.locale, "de_DE");
	assert.equal(draft.artifact_kind, "awc");
});
