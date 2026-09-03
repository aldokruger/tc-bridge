import assert from "node:assert/strict";
import test from "node:test";
import { createContextAssembler } from "../src/knowledge/context-assembler.js";

test("assemble inclui excerpts com metadados de fonte", () => {
	const assembler = createContextAssembler({ maxChars: 2000 });
	const result = assembler.assemble({
		excerpts: [
			{
				text: "Como validar argumentos de action handlers.",
				source_ref: {
					authority: "siemens",
					domain: "teamcenter",
					release: "2606",
					source_file: "workflow.md",
					section: "Handlers",
					verification_status: "verified",
				},
			},
		],
	});
	assert.ok(result.text.includes("siemens"));
	assert.ok(result.text.includes("2606"));
	assert.ok(result.text.includes("verified"));
	assert.ok(!result.truncated);
});

test("assemble respeita orcamento de caracteres", () => {
	const assembler = createContextAssembler({ maxChars: 100 });
	const result = assembler.assemble({
		excerpts: [
			{
				text: "Texto longo que certamente excede o limite de caracteres imposto pelo orcamento.",
				source_ref: {
					authority: "siemens",
					domain: "teamcenter",
					release: "2606",
					verification_status: "verified",
				},
			},
		],
	});
	assert.ok(result.truncated);
	assert.ok(result.usedChars <= 100 + 50); // tolerancia para header
});

test("assemble vincula evidencias e findings separadamente", () => {
	const assembler = createContextAssembler({ maxChars: 2000 });
	const result = assembler.assemble({
		excerpts: [
			{
				text: "Procedimento documentado.",
				source_ref: {
					authority: "siemens",
					domain: "teamcenter",
					release: "2606",
					verification_status: "verified",
				},
			},
		],
		evidences: [
			{
				evidenceId: "ev-001",
				observationType: "log",
				sanitizedPayload: "erro 404",
			},
		],
		findings: [
			{
				findingId: "fnd-001",
				title: "Servico indisponivel",
				evidenceRefs: ["ev-001"],
			},
		],
	});
	assert.ok(result.text.includes("Evidencias do ambiente"));
	assert.ok(result.text.includes("Conclusoes anteriores"));
	assert.ok(result.text.includes("Documentacao de referencia"));
});
