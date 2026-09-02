import assert from "node:assert/strict";
import test from "node:test";
import {
	agentEnvelopeSchema,
	agentFileDataSchema,
	brokerEnvelopeSchema,
	brokerFileDataSchema,
	CONFIG_SCHEMA_VERSION,
	envelopeFor,
	fileDataSchemaFor,
} from "../../src/configuration/schemas.js";

test("schemas de dados sao estritos: campos desconhecidos rejeitados", () => {
	assert.throws(
		() => agentFileDataSchema.parse({ naoExiste: 1 }),
		/Unrecognized key/,
	);
	assert.throws(
		() => brokerFileDataSchema.parse({ naoExiste: 1 }),
		/Unrecognized key/,
	);
});

test("agente: campos imutaveis/derivados ficam fora do schema de arquivo", () => {
	// host (mutableInUi: false), pathSeparator (derived) e token (secret immutavel)
	// nao podem ser gravados no arquivo gerenciado.
	assert.throws(
		() => agentFileDataSchema.parse({ host: "0.0.0.0" }),
		/Unrecognized key/,
	);
	assert.throws(
		() => agentFileDataSchema.parse({ pathSeparator: ":" }),
		/Unrecognized key/,
	);
	assert.throws(
		() => agentFileDataSchema.parse({ token: "x" }),
		/Unrecognized key/,
	);
});

test("agente: campos editaveis aceitam tipos do catalogo", () => {
	const data = agentFileDataSchema.parse({
		allowWrite: true,
		teamcenterUrl: "https://tc.example.com/tc",
		teamcenterSoaExtraJars: ["a.jar"],
		teamcenterSoaMaxConcurrency: 2,
		dbPort: 1433,
		readPaths: ["E:/PLM"],
	});
	assert.equal(data.allowWrite, true);
	assert.equal(data.teamcenterSoaMaxConcurrency, 2);
});

test("agente: campos secret aceitam somente secretRef", () => {
	// Valor direto de segredo nunca entra no arquivo gerenciado.
	assert.throws(
		() => agentFileDataSchema.parse({ teamcenterPassword: "segredo" }),
		/Expected object/,
	);
	assert.throws(
		() => agentFileDataSchema.parse({ dbPassword: "segredo" }),
		/Expected object/,
	);
	const data = agentFileDataSchema.parse({
		teamcenterPassword: { secretRef: "TC_TEAMCENTER_PASSWORD" },
		dbPassword: { secretRef: "TC_DB_PASSWORD" },
	});
	assert.equal(data.teamcenterPassword.secretRef, "TC_TEAMCENTER_PASSWORD");
});

test("broker: campos do catalogo broker", () => {
	const data = brokerFileDataSchema.parse({
		allowedActions: ["teamcenter.soa.health"],
		capabilityTtlSeconds: 120,
		subject: "codex-service",
	});
	assert.equal(data.allowedActions.length, 1);
	assert.throws(
		() => brokerFileDataSchema.parse({ port: 8443 }),
		/Unrecognized key/,
	);
	// apiToken e mutableInUi: false (segredo de servidor): tambem fora do schema.
	assert.throws(
		() => brokerFileDataSchema.parse({ apiToken: "segredo" }),
		/Unrecognized key/,
	);
});

test("envelope versionado: schemaVersion fixo e revisao monotona >= 1", () => {
	const base = {
		schemaVersion: CONFIG_SCHEMA_VERSION,
		revision: 1,
		data: { allowWrite: true },
	};
	assert.ok(agentEnvelopeSchema.safeParse(base).success);
	assert.throws(
		() => agentEnvelopeSchema.parse({ ...base, schemaVersion: 2 }),
		/Invalid literal value/,
	);
	assert.throws(
		() => agentEnvelopeSchema.parse({ ...base, revision: 0 }),
		/greater than or equal to 1/,
	);
	// Envelope do broker usa o schema de dados do broker.
	const brokerBase = {
		schemaVersion: CONFIG_SCHEMA_VERSION,
		revision: 1,
		data: { allowedActions: ["x"] },
	};
	assert.ok(brokerEnvelopeSchema.safeParse(brokerBase).success);
	assert.throws(
		() =>
			brokerEnvelopeSchema.parse({ ...brokerBase, data: { allowWrite: true } }),
		/Unrecognized key/,
	);
});

test("envelopeFor e fileDataSchemaFor roteiam por target", () => {
	assert.equal(envelopeFor("agent"), agentEnvelopeSchema);
	assert.equal(envelopeFor("broker"), brokerEnvelopeSchema);
	assert.equal(fileDataSchemaFor("agent"), agentFileDataSchema);
	assert.equal(fileDataSchemaFor("broker"), brokerFileDataSchema);
	assert.throws(() => envelopeFor("outro"), /target invalido/);
	assert.throws(() => fileDataSchemaFor("outro"), /target invalido/);
});
