import assert from "node:assert/strict";
import test from "node:test";
import { composeFromSources } from "../../src/configuration/sources/environment-source.js";

// Catalogo reduzido de teste cobrindo todos os kinds do environment-source.
const fields = [
	{
		name: "host",
		envName: "TC_HOST",
		cliFlag: "host",
		kind: "string",
		default: "127.0.0.1",
	},
	{
		name: "port",
		envName: "TC_PORT",
		cliFlag: "port",
		kind: "numberFromString",
		default: 4100,
	},
	{
		name: "allowWrite",
		envName: "TC_ALLOW_WRITE",
		cliFlag: "allowWrite",
		kind: "bool",
	},
	{
		name: "preflight",
		envName: "TC_PREFLIGHT",
		cliFlag: "preflight",
		kind: "soaFlag",
		fallbackField: "allowWrite",
	},
	{
		name: "timeoutMs",
		envName: "TC_TIMEOUT_MS",
		cliFlag: "timeoutMs",
		kind: "uint",
		errorName: "TC_TIMEOUT_MS",
		default: 30_000,
	},
	{
		name: "quirkMs",
		envName: "TC_QUIRK_MS",
		cliFlag: "quirkMs",
		kind: "uintQuirk",
	},
	{ name: "jars", envName: "TC_JARS", cliFlag: "jars", kind: "list" },
	{
		name: "hosts",
		envName: "TC_HOSTS",
		cliFlag: "hosts",
		kind: "listOrDefault",
		default: ["localhost"],
	},
	{
		name: "encrypt",
		envName: "TC_ENCRYPT",
		cliFlag: "encrypt",
		kind: "boolString",
		default: "true",
	},
	{
		name: "trust",
		envName: "TC_TRUST",
		cliFlag: "trust",
		kind: "boolStringTrue",
		default: "false",
	},
	{
		name: "dbPort",
		envName: "TC_DB_PORT",
		cliFlag: "dbPort",
		kind: "optionalPort",
		errorName: "TC_DB_PORT",
	},
	{ name: "sep", kind: "derived", derive: () => ":" },
	{
		name: "secretThing",
		envName: "TC_SECRET_THING",
		cliFlag: "secretThing",
		kind: "string",
		inCompose: false,
	},
];

function compose({ flags = {}, env = {}, fileDocument } = {}) {
	return composeFromSources({ fields, flags, env, fileDocument });
}

test("precedencia defaults < arquivo < env < CLI", () => {
	const fileOverDefault = compose({
		fileDocument: { data: { host: "file-host" } },
	});
	assert.equal(fileOverDefault.values.host, "file-host");
	assert.equal(fileOverDefault.sources.host, "file");

	const fileValues = compose({
		env: { TC_HOST: "env-host" },
		fileDocument: { data: { host: "file-host" } },
	}).values;
	assert.equal(fileValues.host, "env-host");

	const cliValues = compose({
		flags: { host: "cli-host" },
		env: { TC_HOST: "env-host" },
		fileDocument: { data: { host: "file-host" } },
	}).values;
	assert.equal(cliValues.host, "cli-host");
});

test("sources rastreia a fonte vencedora de cada campo", () => {
	const { sources } = compose({
		flags: { port: "4101" },
		env: { TC_HOST: "env-host" },
		fileDocument: { data: { timeoutMs: 5000 } },
	});
	assert.equal(sources.port, "cli");
	assert.equal(sources.host, "env");
	assert.equal(sources.timeoutMs, "file");
	assert.equal(sources.jars, "default");
});

test('bool: env "1" liga, qualquer outro valor desliga', () => {
	assert.equal(
		compose({ env: { TC_ALLOW_WRITE: "1" } }).values.allowWrite,
		true,
	);
	assert.equal(
		compose({ env: { TC_ALLOW_WRITE: "0" } }).values.allowWrite,
		false,
	);
	assert.equal(
		compose({ env: { TC_ALLOW_WRITE: "" } }).values.allowWrite,
		false,
	);
	assert.equal(
		compose({ env: { TC_ALLOW_WRITE: "true" } }).values.allowWrite,
		false,
	);
	assert.equal(
		compose({ flags: { allowWrite: true } }).values.allowWrite,
		true,
	);
	assert.equal(compose({}).values.allowWrite, false);
});

test('soaFlag: flag explicita vence, env definido compara "1", senao herda fallbackField', () => {
	// flag explicita (mesmo false) vence env e fallback
	assert.equal(
		compose({ flags: { preflight: false }, env: { TC_PREFLIGHT: "1" } }).values
			.preflight,
		false,
	);
	assert.equal(
		compose({ flags: { preflight: true }, env: { TC_PREFLIGHT: "0" } }).values
			.preflight,
		true,
	);
	// env "" conta como definido e desliga
	assert.equal(compose({ env: { TC_PREFLIGHT: "" } }).values.preflight, false);
	assert.equal(compose({ env: { TC_PREFLIGHT: "1" } }).values.preflight, true);
	// sem env nem flag, herda o valor resolvido do fallbackField
	assert.equal(compose({ flags: { allowWrite: true } }).values.preflight, true);
	assert.equal(compose({}).values.preflight, false);
});

test("uint: default, valor valido e erro com mensagem nominal", () => {
	assert.equal(compose({}).values.timeoutMs, 30_000);
	assert.equal(
		compose({ env: { TC_TIMEOUT_MS: "5000" } }).values.timeoutMs,
		5000,
	);
	assert.throws(
		() => compose({ env: { TC_TIMEOUT_MS: "0" } }),
		/TC_TIMEOUT_MS deve ser um inteiro entre 1 e 120000/,
	);
	assert.throws(
		() => compose({ env: { TC_TIMEOUT_MS: "abc" } }),
		/TC_TIMEOUT_MS deve ser um inteiro entre 1 e 120000/,
	);
});

test("uintQuirk preserva a chamada historica de 2 argumentos (mensagem 30000)", () => {
	// Sem valor: fallback undefined (loadConfig deixa dbRequestTimeoutMs undefined).
	assert.equal(compose({}).values.quirkMs, undefined);
	// Valor invalido: a mensagem usa o fallback numerico 30000, como loadConfig.
	assert.throws(
		() => compose({ env: { TC_QUIRK_MS: "130000" } }),
		/30000 deve ser um inteiro entre 1 e 120000/,
	);
	assert.equal(compose({ env: { TC_QUIRK_MS: "7000" } }).values.quirkMs, 7000);
});

test("numberFromString: coerção Number e default", () => {
	assert.equal(compose({}).values.port, 4100);
	assert.equal(compose({ env: { TC_PORT: "4101" } }).values.port, 4101);
	assert.equal(compose({ flags: { port: "4102" } }).values.port, 4102);
});

test("list: separa por ponto-e-virgula ou virgula, trim e descarta vazios", () => {
	assert.deepEqual(compose({ env: { TC_JARS: "a.jar; b.jar" } }).values.jars, [
		"a.jar",
		"b.jar",
	]);
	assert.deepEqual(compose({ env: { TC_JARS: "a.jar,b.jar" } }).values.jars, [
		"a.jar",
		"b.jar",
	]);
	assert.deepEqual(compose({ env: { TC_JARS: "  ;" } }).values.jars, []);
	assert.deepEqual(compose({}).values.jars, []);
	// arquivo gerenciado aceita array direto
	assert.deepEqual(
		compose({ fileDocument: { data: { jars: ["x.jar"] } } }).values.jars,
		["x.jar"],
	);
});

test("listOrDefault: lista vazia cai no default", () => {
	assert.deepEqual(compose({}).values.hosts, ["localhost"]);
	assert.deepEqual(compose({ env: { TC_HOSTS: "a;b" } }).values.hosts, [
		"a",
		"b",
	]);
	assert.deepEqual(compose({ env: { TC_HOSTS: "  " } }).values.hosts, [
		"localhost",
	]);
});

test('boolString: somente a string "false" desliga', () => {
	assert.equal(compose({}).values.encrypt, true);
	assert.equal(compose({ env: { TC_ENCRYPT: "false" } }).values.encrypt, false);
	assert.equal(compose({ env: { TC_ENCRYPT: "0" } }).values.encrypt, true);
	assert.equal(compose({ flags: { encrypt: "false" } }).values.encrypt, false);
	// arquivo com boolean ja resolvido passa direto
	assert.equal(
		compose({ fileDocument: { data: { encrypt: false } } }).values.encrypt,
		false,
	);
});

test('boolStringTrue: somente a string "true" liga', () => {
	assert.equal(compose({}).values.trust, false);
	assert.equal(compose({ env: { TC_TRUST: "true" } }).values.trust, true);
	assert.equal(compose({ env: { TC_TRUST: "1" } }).values.trust, false);
	assert.equal(
		compose({ fileDocument: { data: { trust: true } } }).values.trust,
		true,
	);
});

test("optionalPort: ausente retorna undefined, invalido lanca mensagem nominal", () => {
	assert.equal(compose({}).values.dbPort, undefined);
	assert.equal(compose({ env: { TC_DB_PORT: "1433" } }).values.dbPort, 1433);
	assert.throws(
		() => compose({ env: { TC_DB_PORT: "70000" } }),
		/TC_DB_PORT deve ser uma porta entre 1 e 65535/,
	);
});

test("derived: chama derive() e ignora outras fontes", () => {
	assert.equal(compose({ flags: { sep: "x" } }).values.sep, ":");
});

test("inCompose:false fica fora da composicao", () => {
	const { values } = compose({ env: { TC_SECRET_THING: "x" } });
	assert.ok(!("secretThing" in values));
});
