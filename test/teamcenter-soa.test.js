import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig } from "../src/config.js";
import {
	buildJavaEnv,
	runTeamcenterSoa,
	sanitizeText,
	soaAdapterFingerprint,
	soaPreflightChecks,
} from "../src/teamcenter-soa.js";

test("sanitizeText mascara segredos em mensagens", () => {
	assert.equal(
		sanitizeText("password=abc123 e resto"),
		"password=[REDACTED] e resto",
	);
	assert.equal(
		sanitizeText("TC_TEAMCENTER_PASSWORD: segredo"),
		"TC_TEAMCENTER_PASSWORD:[REDACTED]",
	);
	assert.equal(
		sanitizeText("Authorization: Bearer xyz"),
		"Authorization:[REDACTED] xyz",
	);
	assert.equal(sanitizeText("Bearer abcdef1234567890"), "[REDACTED]");
	assert.equal(sanitizeText("OBF:1a2b3c4d5e6f"), "[REDACTED]");
	assert.equal(
		sanitizeText("url https://user:pass@host:7001/tc"),
		"url https://user:[REDACTED]@host:7001/tc",
	);
	assert.equal(
		sanitizeText("url https://host:7001/tc sem credencial"),
		"url https://host:7001/tc sem credencial",
	);
	assert.equal(sanitizeText("grip=ABCDEFGHIJKLMNOPQRST"), "grip=[REDACTED]");
	assert.equal(sanitizeText("mensagem limpa"), "mensagem limpa");
});

test("buildJavaEnv filtra o ambiente e aplica client encoding", () => {
	const original = { ...process.env };
	try {
		process.env.TC_TEAMCENTER_URL = "https://tc.example.com/tc";
		process.env.TC_TEAMCENTER_PASSWORD = "segredo";
		process.env.MY_SECRET = "vazou";
		process.env.PATH = "/usr/bin";
		process.env.TC_TEAMCENTER_SOA_CLIENT_ENCODING = "Cp1252";
		const env = buildJavaEnv({ teamcenterSoaClientEncoding: "UTF-8" });
		assert.equal(env.TC_TEAMCENTER_URL, "https://tc.example.com/tc");
		assert.equal(env.TC_TEAMCENTER_PASSWORD, "segredo");
		assert.equal(env.PATH, "/usr/bin");
		assert.equal(env.MY_SECRET, undefined);
		assert.equal(env.TC_TEAMCENTER_SOA_CLIENT_ENCODING, "UTF-8");
	} finally {
		for (const key of Object.keys(process.env)) {
			if (!(key in original)) delete process.env[key];
		}
		Object.assign(process.env, original);
	}
});

test("soaPreflightChecks reporta problemas de configuracao", async () => {
	const cfg = {
		teamcenterSoaAdapterJar: "/nonexistent/adapter.jar",
		teamcenterSoaLib: "/nonexistent/lib",
		teamcenterSoaUrl: "http://inseguro.example.com",
		teamcenterSoaUser: "",
		teamcenterSoaPassword: "",
		teamcenterSoaRequireTls: true,
		pathSeparator: ":",
	};
	const problems = await soaPreflightChecks(cfg);
	assert.ok(
		problems.some((p) => /adapter/i.test(p)),
		"jar ausente",
	);
	assert.ok(
		problems.some((p) => /URL/i.test(p)),
		"https exigido",
	);
	assert.ok(
		problems.some((p) => /Credencial/i.test(p)),
		"credencial ausente",
	);
});

test("soaPreflightChecks aceita credenciais canonicas de loadConfig", async () => {
	const cfg = loadConfig({
		token: "test-token",
		readPaths: ["/tmp"],
		allowTeamcenterRead: true,
		teamcenterUrl: "https://tc.example.com/tc",
		teamcenterUser: "reader",
		teamcenterPassword: "secret",
		teamcenterSoaAdapterJar: "/nonexistent/adapter.jar",
		teamcenterSoaLib: "/nonexistent/lib",
	});
	const problems = await soaPreflightChecks(cfg);

	assert.ok(!problems.includes("TC_TEAMCENTER_URL nao configurado"));
	assert.ok(
		!problems.includes("Credencial SOA nao configurada (user/password)"),
	);
});

test("runTeamcenterSoa propaga erro do envelope com mensagem sanitizada", async () => {
	const cfg = {
		teamcenterSoaTimeoutMs: 30_000,
		soaGate: {
			run: async () => ({
				schemaVersion: "1",
				status: "error",
				operation: "teamcenter.soa.object.inspect",
				correlationId: "c1",
				error: {
					code: "object_not_found",
					message: "object_uid nao referencia: password=abc",
				},
			}),
		},
	};
	await assert.rejects(
		runTeamcenterSoa({ action: "teamcenter.soa.object.inspect" }, cfg, {}),
		/password=\[REDACTED\]/,
	);
});

test("runTeamcenterSoa mapeia resultado, truncation, warnings e partialErrors", async () => {
	const cfg = {
		teamcenterSoaTimeoutMs: 30_000,
		soaGate: {
			run: async () => ({
				schemaVersion: "1",
				status: "completed",
				operation: "a",
				correlationId: "c2",
				durationMs: 5,
				result: { uid: "X" },
				truncated: true,
				warnings: ["w1"],
				partialErrors: [{ code: "1", message: "m1" }],
			}),
		},
	};
	const out = await runTeamcenterSoa({ action: "a" }, cfg, {
		correlationId: "aud_1",
	});
	assert.equal(out.uid, "X");
	assert.equal(out.truncated, true);
	assert.deepEqual(out.warnings, ["w1"]);
	assert.deepEqual(out.partial_errors, [{ code: "1", message: "m1" }]);
	assert.equal(out._meta.action, "a");
	assert.equal(out._meta.correlationId, "aud_1");
	assert.equal(out._meta.durationMs, 5);
});

test("runTeamcenterSoa repassa o usuario para o rate limit do gate", async () => {
	let seenUser = null;
	const cfg = {
		teamcenterSoaTimeoutMs: 30_000,
		soaGate: {
			run: async (action, user) => {
				seenUser = user;
				return {
					schemaVersion: "1",
					status: "completed",
					operation: action,
					correlationId: "c3",
					result: {},
				};
			},
		},
	};
	await runTeamcenterSoa({ action: "a" }, cfg, { user: "u_1" });
	assert.equal(seenUser, "u_1");
});

test("contrato encoding_probe: properties e lista de {name,value,state}, nao mapa", async () => {
	// O adaptador Java devolve "properties" como array (DTO name/value/state).
	// Este teste fixa o contrato para que o probe itere a lista — qualquer
	// regressao a um shape de mapa quebra aqui, nao no host Windows.
	const cfg = {
		teamcenterSoaTimeoutMs: 30_000,
		soaGate: {
			run: async () => ({
				schemaVersion: "1",
				status: "completed",
				operation: "teamcenter.soa.encoding_probe",
				correlationId: "c4",
				result: {
					uid: "u_probe_1",
					type: "Item",
					propertyName: "object_desc",
					value:
						"A\u00e7\u00e3o revis\u00e3o : \u00e7\u00e3\u00e9\u00ed\u00f3\u00fa - Teste",
					characters: 34,
					codePoints: 34,
					utf8Bytes: 44,
					sha256: "abc123",
					suspicious: false,
					truncated: false,
					properties: [
						{
							name: "object_desc",
							value: [
								"A\u00e7\u00e3o revis\u00e3o : \u00e7\u00e3\u00e9\u00ed\u00f3\u00fa - Teste",
							],
							state: "found",
						},
					],
				},
			}),
		},
	};
	const out = await runTeamcenterSoa(
		{ action: "teamcenter.soa.encoding_probe", propertyName: "object_desc" },
		cfg,
		{ correlationId: "aud_4" },
	);
	assert.ok(Array.isArray(out.properties), "properties deve ser um array");
	assert.equal(out.properties[0].name, "object_desc");
	assert.equal(out.properties[0].state, "found");
	assert.equal(
		out.value,
		"A\u00e7\u00e3o revis\u00e3o : \u00e7\u00e3\u00e9\u00ed\u00f3\u00fa - Teste",
	);
	assert.equal(out.characters, 34);
	assert.equal(out.codePoints, 34);
	assert.equal(out.utf8Bytes, 44);
	assert.equal(out.suspicious, false);
	assert.equal(out.truncated, false);
});

const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

async function writeFakeJar(filePath) {
	await fs.writeFile(filePath, Buffer.concat([ZIP_MAGIC, Buffer.from("fake")]));
}

async function makeTempDir() {
	return fs.mkdtemp(path.join(os.tmpdir(), "tc-soa-test-"));
}

test("buildJavaEnv propaga somente a allowlist nominal TC_TEAMCENTER_*", () => {
	const original = { ...process.env };
	try {
		process.env.TC_TEAMCENTER_URL = "https://tc.example.com/tc";
		process.env.TC_TEAMCENTER_USER = "infodba";
		process.env.TC_TEAMCENTER_PASSWORD = "segredo";
		process.env.TC_TEAMCENTER_GROUP = "dba";
		process.env.TC_TEAMCENTER_ROLE = "admin";
		process.env.TC_TEAMCENTER_LOCALE = "pt_BR";
		process.env.TC_TEAMCENTER_SOA_LIB = "E:\\tc\\lib";
		process.env.TC_TEAMCENTER_SOA_ADAPTER_JAR = "E:\\tc\\adapter.jar";
		process.env.TC_TEAMCENTER_SOA_URL = "https://nao-repassar";
		process.env.TC_TEAMCENTER_QUALQUER_COISA = "vazou";
		process.env.PATH = "/usr/bin";
		const env = buildJavaEnv({ teamcenterSoaClientEncoding: "" });
		assert.equal(env.TC_TEAMCENTER_URL, "https://tc.example.com/tc");
		assert.equal(env.TC_TEAMCENTER_USER, "infodba");
		assert.equal(env.TC_TEAMCENTER_PASSWORD, "segredo");
		assert.equal(env.TC_TEAMCENTER_GROUP, "dba");
		assert.equal(env.TC_TEAMCENTER_ROLE, "admin");
		assert.equal(env.TC_TEAMCENTER_LOCALE, "pt_BR");
		assert.equal(env.TC_TEAMCENTER_SOA_LIB, undefined);
		assert.equal(env.TC_TEAMCENTER_SOA_ADAPTER_JAR, undefined);
		assert.equal(env.TC_TEAMCENTER_SOA_URL, undefined);
		assert.equal(env.TC_TEAMCENTER_QUALQUER_COISA, undefined);
		assert.equal(env.PATH, "/usr/bin");
	} finally {
		for (const key of Object.keys(process.env)) {
			if (!(key in original)) delete process.env[key];
		}
		Object.assign(process.env, original);
	}
});

test("soaPreflightChecks detecta executavel Java ausente", async () => {
	const cfg = {
		teamcenterJava: "/nonexistent/java",
		teamcenterSoaAdapterJar: "/nonexistent/adapter.jar",
		teamcenterSoaUrl: "https://tc.example.com/tc",
		teamcenterSoaUser: "infodba",
		teamcenterSoaPassword: "segredo",
	};
	const problems = await soaPreflightChecks(cfg);
	assert.ok(
		problems.some((p) => /Executavel Java/i.test(p)),
		"java ausente",
	);
});

test("soaPreflightChecks detecta jar do adaptador corrompido", async () => {
	const dir = await makeTempDir();
	try {
		const adapterJar = path.join(dir, "adapter.jar");
		await fs.writeFile(adapterJar, "isto nao e um zip");
		const cfg = {
			teamcenterJava: "java",
			teamcenterSoaAdapterJar: adapterJar,
			teamcenterSoaUrl: "https://tc.example.com/tc",
			teamcenterSoaUser: "infodba",
			teamcenterSoaPassword: "segredo",
		};
		const problems = await soaPreflightChecks(cfg);
		assert.ok(
			problems.some((p) => /adaptador SOA corrompido/i.test(p)),
			"magic ZIP invalido no adapter",
		);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

test("soaPreflightChecks detecta jar SOA corrompido na lib", async () => {
	const dir = await makeTempDir();
	try {
		const adapterJar = path.join(dir, "adapter.jar");
		await writeFakeJar(adapterJar);
		const libDir = path.join(dir, "lib");
		await fs.mkdir(libDir);
		await fs.writeFile(path.join(libDir, "quebrado.jar"), "nao-zip");
		const cfg = {
			teamcenterJava: "java",
			teamcenterSoaAdapterJar: adapterJar,
			teamcenterSoaLib: libDir,
			teamcenterSoaUrl: "https://tc.example.com/tc",
			teamcenterSoaUser: "infodba",
			teamcenterSoaPassword: "segredo",
		};
		const problems = await soaPreflightChecks(cfg);
		assert.ok(
			problems.some((p) => /Jar SOA vazio ou corrompido/i.test(p)),
			"magic ZIP invalido na lib",
		);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

test("soaPreflightChecks detecta multiplas versoes e basename duplicado", async () => {
	const dir = await makeTempDir();
	try {
		const adapterJar = path.join(dir, "adapter.jar");
		await writeFakeJar(adapterJar);
		const libDir = path.join(dir, "lib");
		await fs.mkdir(libDir);
		await writeFakeJar(path.join(libDir, "log4j-core-2.17.1.jar"));
		const cfg = {
			teamcenterJava: "java",
			teamcenterSoaAdapterJar: adapterJar,
			teamcenterSoaLib: libDir,
			teamcenterSoaExtraJars: [
				path.join(libDir, "log4j-core-2.17.2.jar"),
				path.join(libDir, "log4j-core-2.17.1.jar"),
			],
			teamcenterSoaUrl: "https://tc.example.com/tc",
			teamcenterSoaUser: "infodba",
			teamcenterSoaPassword: "segredo",
		};
		const problems = await soaPreflightChecks(cfg);
		assert.ok(
			problems.some((p) => /Multiplas versoes/i.test(p)),
			"2.17.1 + 2.17.2",
		);
		assert.ok(
			problems.some((p) => /Jar duplicado no classpath/i.test(p)),
			"mesmo basename em lib e extraJars",
		);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

test("soaPreflightChecks valida truststore existente e falha em ausente", async () => {
	const dir = await makeTempDir();
	try {
		const adapterJar = path.join(dir, "adapter.jar");
		await writeFakeJar(adapterJar);
		const truststore = path.join(dir, "truststore.jks");
		await fs.writeFile(truststore, "jks-fake");
		const base = {
			teamcenterJava: "java",
			teamcenterSoaAdapterJar: adapterJar,
			teamcenterSoaUrl: "https://tc.example.com/tc",
			teamcenterSoaUser: "infodba",
			teamcenterSoaPassword: "segredo",
		};
		const ok = await soaPreflightChecks({
			...base,
			teamcenterSoaTrustStore: truststore,
		});
		assert.ok(
			!ok.some((p) => /Truststore/i.test(p)),
			"truststore valido nao gera problema",
		);
		const missing = await soaPreflightChecks({
			...base,
			teamcenterSoaTrustStore: path.join(dir, "ausente.jks"),
		});
		assert.ok(
			missing.some((p) => /Truststore nao encontrado/i.test(p)),
			"truststore ausente",
		);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});

test("soaAdapterFingerprint calcula sha256 e sinaliza corrupcao", async () => {
	const dir = await makeTempDir();
	try {
		const adapterJar = path.join(dir, "adapter.jar");
		await writeFakeJar(adapterJar);
		const ok = await soaAdapterFingerprint({
			teamcenterSoaAdapterJar: adapterJar,
		});
		assert.match(ok.sha256, /^[0-9a-f]{64}$/);
		assert.equal(ok.corrupt, false);

		await fs.writeFile(adapterJar, "lixo");
		const bad = await soaAdapterFingerprint({
			teamcenterSoaAdapterJar: adapterJar,
		});
		assert.equal(bad.corrupt, true);
		assert.match(bad.sha256, /^[0-9a-f]{64}$/);
	} finally {
		await fs.rm(dir, { recursive: true, force: true });
	}
});
