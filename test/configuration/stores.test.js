import assert from "node:assert/strict";
import {
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { ADMIN_ERROR_CODES } from "../../src/configuration/errors.js";
import { agentEnvelopeSchema } from "../../src/configuration/schemas.js";
import { AtomicJsonStore } from "../../src/configuration/stores/atomic-json-store.js";
import { InMemoryConfigStore } from "../../src/configuration/stores/in-memory-config-store.js";

function tempDir() {
	return mkdtempSync(path.join(tmpdir(), "tc-store-"));
}

test("AtomicJsonStore: escrita atomica com revisao monotona e backup", async () => {
	const dir = tempDir();
	const filePath = path.join(dir, "tc-agent.json");
	try {
		const store = new AtomicJsonStore({
			filePath,
			envelopeSchema: agentEnvelopeSchema,
		});
		assert.equal(await store.read(), null);

		const first = await store.write({ allowWrite: true });
		assert.equal(first.revision, 1);
		const document = await store.read();
		assert.equal(document.revision, 1);
		assert.equal(document.schemaVersion, 1);
		assert.deepEqual(document.data, { allowWrite: true });

		const second = await store.write({ allowWrite: false });
		assert.equal(second.revision, 2);
		// Backup da revisao anterior existe e restaura o estado antigo.
		const restored = await store.readRevision(1);
		assert.ok(restored);
		assert.equal(restored.revision, 1);
		assert.deepEqual(restored.data, { allowWrite: true });

		// Nenhum arquivo temporario sobra apos a escrita atomica.
		const leftovers = readdirSync(dir).filter((name) => name.includes(".tmp-"));
		assert.deepEqual(leftovers, []);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("AtomicJsonStore: listHistory inclui backups e revisao corrente em ordem desc", async () => {
	const dir = tempDir();
	const filePath = path.join(dir, "tc-agent.json");
	try {
		const store = new AtomicJsonStore({
			filePath,
			envelopeSchema: agentEnvelopeSchema,
		});
		await store.write({ allowWrite: true });
		await store.write({ allowWrite: false });
		const history = await store.listHistory();
		assert.deepEqual(
			history.map((entry) => entry.revision),
			[2, 1],
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("AtomicJsonStore: rotacao limita backups ao maxBackups", async () => {
	const dir = tempDir();
	const filePath = path.join(dir, "tc-agent.json");
	try {
		const store = new AtomicJsonStore({
			filePath,
			envelopeSchema: agentEnvelopeSchema,
			maxBackups: 2,
		});
		for (let revision = 1; revision <= 4; revision += 1) {
			await store.write({ allowWrite: revision % 2 === 0 });
		}
		const backups = readdirSync(dir)
			.filter((name) => name.startsWith("tc-agent.json.bak-"))
			.sort();
		assert.deepEqual(backups, ["tc-agent.json.bak-2", "tc-agent.json.bak-3"]);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("AtomicJsonStore: arquivo ausente retorna null; JSON invalido vira AdminError", async () => {
	const dir = tempDir();
	const filePath = path.join(dir, "tc-agent.json");
	try {
		const store = new AtomicJsonStore({
			filePath,
			envelopeSchema: agentEnvelopeSchema,
		});
		// Ausente => null.
		assert.equal(await store.read(), null);
		// JSON invalido => INVALID_CONFIG estavel.
		writeFileSync(filePath, "{ nao e json", "utf8");
		await assert.rejects(
			() => store.read(),
			(error) => {
				assert.equal(error.code, ADMIN_ERROR_CODES.INVALID_CONFIG);
				return true;
			},
		);
		// Envelope fora do schema (revisao 0) => INVALID_CONFIG.
		writeFileSync(
			filePath,
			JSON.stringify({ schemaVersion: 1, revision: 0, data: {} }),
			"utf8",
		);
		await assert.rejects(
			() => store.read(),
			(error) => {
				assert.equal(error.code, ADMIN_ERROR_CODES.INVALID_CONFIG);
				return true;
			},
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("AtomicJsonStore: readRevision inexistente retorna null", async () => {
	const dir = tempDir();
	const filePath = path.join(dir, "tc-agent.json");
	try {
		const store = new AtomicJsonStore({
			filePath,
			envelopeSchema: agentEnvelopeSchema,
		});
		await store.write({ allowWrite: true });
		assert.equal(await store.readRevision(99), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("AtomicJsonStore: backup com JSON invalido em readRevision lanca erro", async () => {
	const dir = tempDir();
	const filePath = path.join(dir, "tc-agent.json");
	try {
		const store = new AtomicJsonStore({
			filePath,
			envelopeSchema: agentEnvelopeSchema,
		});
		await store.write({ allowWrite: true });
		writeFileSync(store.backupPathFor(1), "lixo", "utf8");
		await assert.rejects(() => store.readRevision(1), /nao e JSON valido/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("AtomicJsonStore: backup com envelope fora do schema em readRevision retorna null", async () => {
	const dir = tempDir();
	const filePath = path.join(dir, "tc-agent.json");
	try {
		const store = new AtomicJsonStore({
			filePath,
			envelopeSchema: agentEnvelopeSchema,
		});
		await store.write({ allowWrite: true });
		// JSON valido, mas token nao pertence ao schema de dados do agente.
		writeFileSync(
			store.backupPathFor(1),
			JSON.stringify({ schemaVersion: 1, revision: 1, data: { token: "x" } }),
			"utf8",
		);
		assert.equal(await store.readRevision(1), null);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("InMemoryConfigStore: revisao monotona, historico e leitura de revisao", async () => {
	const store = new InMemoryConfigStore();
	assert.equal(await store.read(), null);

	assert.equal((await store.write({ host: "a" })).revision, 1);
	assert.equal((await store.write({ host: "b" })).revision, 2);
	assert.equal((await store.write({ host: "c" })).revision, 3);

	const history = await store.listHistory();
	assert.deepEqual(
		history.map((entry) => entry.revision),
		[3, 2, 1],
	);

	const restored = await store.readRevision(1);
	assert.deepEqual(restored.data, { host: "a" });
	assert.equal(await store.readRevision(99), null);

	const document = await store.read();
	assert.equal(document.revision, 3);
	assert.deepEqual(document.data, { host: "c" });
});
