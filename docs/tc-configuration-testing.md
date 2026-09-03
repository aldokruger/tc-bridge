# Testes do módulo de configuração (Slice A do admin UI)

Guia descritivo de como proceder para validar as implementações do Slice A do
plano `docs/tc-broker-agent-admin-ui-implementation-plan.md`: catálogo único de
campos, composição de configuração, `ConfigurationManager`, stores, segredos e
a delegação de `loadConfig()`.

Este documento lista, um a um, os casos de teste existentes, o que cada um
valida, como executá-los e como estender a suíte. Serve tanto para rodar a
verificação (regressão) quanto para conferir a cobertura contra os requisitos
do plano (§13.1 e §17).

---

## 1. Pré-requisitos

- Node.js `>= 20` (o pacote declara `engines.node`); a suíte usa apenas o
  runner nativo `node --test` — sem dependências de teste adicionais.
- `npm install` já executado na raiz do repositório (única dependência usada
  pelos testes em runtime é `zod`).
- Nenhuma variável `TC_*` real é necessária: `loadConfig` só é exercitado com
  valores injetados (flags/`process.env` setados e restaurados dentro dos
  próprios testes). Evite rodar a suíte com `TC_TOKEN` etc. exportados no
  shell — não quebra, mas polui o teste de equivalência se o teste for
  modificado.

## 2. Como executar

### 2.1 Suíte completa (regressão)

```bash
npm test
# equivalente a:
node --test
```

Resultado esperado (nesta data): **156 testes, 0 falhas** — 101 pré-existentes
(bridge/agente/SOA) + 55 novos do módulo de configuração.

### 2.2 Somente o módulo de configuração

```bash
node --test test/configuration/*.test.js
```

Resultado esperado: **55 testes, 0 falhas** (expansão do glob pelo shell).

### 2.3 Arquivo individual

```bash
node --test test/configuration/manager.test.js   # 15 testes
node --test test/configuration/diff.test.js      # 6 testes
node --test test/configuration/environment-source.test.js  # 14 testes
node --test test/configuration/schemas.test.js   # 7 testes
node --test test/configuration/secrets.test.js   # 5 testes
node --test test/configuration/stores.test.js    # 8 testes
```

> Nota: `node --test <diretório>` (ex.: `node --test test/configuration/`) não
> funciona neste Node — o runner tenta executar o diretório como módulo e
> falha com `MODULE_NOT_FOUND`. Use o glob `test/configuration/*.test.js` ou
> liste arquivos explicitamente.

### 2.4 Filtrar por nome

```bash
node --test --test-name-pattern "rollback" test/configuration/manager.test.js
node --test --test-name-pattern "secret"  test/configuration/*.test.js
node --test --test-name-pattern "plan|apply" test/configuration/manager.test.js
```

### 2.5 Contrato de regressão do `loadConfig`

```bash
node --test test/config.test.js   # 7 testes
```

Este arquivo não faz parte de `test/configuration/` e é o guarda-costas do
contrato externo de `src/config.js`: mensagens de validação, ordem dos checks e
shape de saída.

### 2.6 Checagem de sintaxe dos módulos

```bash
for f in src/config.js src/configuration/*.js \
         src/configuration/sources/*.js \
         src/configuration/stores/*.js \
         src/configuration/secrets/*.js \
         test/configuration/*.test.js; do
  node --check "$f" || echo "FALHOU: $f"
done
```

Nenhuma saída além de `node --check` = sintaxe OK.

---

## 3. Inventário dos testes por arquivo

| Arquivo                                         | Testes | Alvo principal                              |
| ----------------------------------------------- | ------ | ------------------------------------------- |
| `test/config.test.js`                           | 7      | Contrato do `loadConfig()` (regressão)      |
| `test/configuration/diff.test.js`               | 6      | diff, resumo sanitizado, fingerprint        |
| `test/configuration/environment-source.test.js` | 14     | Precedência e kinds do `composeFromSources` |
| `test/configuration/manager.test.js`            | 15     | `ConfigurationManager` (interface)          |
| `test/configuration/schemas.test.js`            | 7      | Schemas Zod estritos e envelopes            |
| `test/configuration/secrets.test.js`            | 5      | Secret stores (resolução e status)          |
| `test/configuration/stores.test.js`             | 8      | Stores (atômico/backup e in-memory)         |

---

## 4. Descrição detalhada dos casos

### 4.1 `test/config.test.js` — contrato do `loadConfig` (7)

Garante que a delegação interna para `composeEffectiveSync()` não alterou o
comportamento observável de `src/config.js`.

1. **`requires complete database configuration only when database diagnostics
are enabled`** — sem `allowDbDiagnostics`, carrega sem exigir nada de MSSQL.
   Com a flag ligada e sem `dbServer`, lança erro contendo `TC_DB_SERVER`. Com o
   conjunto completo (`dbServer`, `dbName`, `dbUser`, `dbPassword`, `dbPort`),
   carrega.
2. **`requires agent identity, issuer and public key for capability tasks`** —
   `allowCapabilityTasks` sem `agentId` lança erro contendo `TC_AGENT_ID`; o
   conjunto completo (`agentId`, `capabilityIssuer`, `capabilityPublicKey`)
   carrega. `enforceCapabilities` sem capability tasks lança erro contendo
   `TC_ENFORCE_CAPABILITIES=1 exige`.
3. **`master switch SOA habilita somente preflight/health; demais exigem flag
granular`** — com `allowTeamcenterRead` + credenciais SOA completas,
   `allowTeamcenterSoaPreflight` e `_Health` ficam `true`; `_Preferences`,
   `_Objects`, `_Queries`, `_Datasets`, `_Fms` ficam `false`.
4. **`flags granulares explicitas ligam preferences/objects/queries`** — com o
   master switch e as flags granulares ligadas, as três viram `true`.
5. **`registry de ambientes carrega na inicializacao e isola perfis invalidos`**
   — escreve um registry temporário com um perfil QA válido e um inválido
   (classificação `X`); espera `environmentRegistry.size === 1` e
   `environmentRegistryErrors` com 1 item mencionando `tc2606-bad`.
6. **`registry de ambientes inexistente derruba a inicializacao`** — arquivo
   inexistente → erro contendo `nao foi possivel ler o registro`.
7. **`sem registry configurado, carrega vazio sem erro`** — registry vazio e
   `environmentRegistryErrors === []`.

### 4.2 `test/configuration/diff.test.js` (6)

Usa um catálogo reduzido com `host` (normal), `jars` (list, sensitive) e
`dbPassword` (secret).

1. **`diffDocuments: adicionado, removido e alterado`** — documento corrente
   `{revision: 3, data: {host: "a", jars: ["x"]}}` contra `{jars: ["x", "y"],
dbPassword: "p"}` produz exatamente 3 changes: `dbPassword` adicionado
   (`before: undefined`, `after: "p"`), `host` removido (`before: "a"`, `after:
undefined`) e `jars` alterado (`["x"]` → `["x","y"]`).
2. **`diffDocuments: sem documento corrente, tudo vira adicao`** — documento
   `null` → cada campo do alvo vira adição.
3. **`diffDocuments: documento igual nao gera changes`** — `[]`.
4. **`summarizeChanges: redige segredos e descreve listas`** — segredo com
   `before`/`after` reais (`"segredo-antigo"` → `"segredo-novo"`) sai como
   `"***"`/`"***"`; valor `undefined` permanece `undefined` (não há segredo a
   redigir); campo list preserva o array; `applyImpact: "restart"` é exposto.
5. **`summarizeChanges: campo fora do catalogo usa default`** — campo
   desconhecido não lança: `sensitivity: "normal"`, `applyImpact: "restart"`,
   `kind: "string"`.
6. **`documentFingerprint: determinista por revisao + dados`** — mesmo
   documento → mesmo hash; mudar `revision` ou `data` muda o hash;
   `null`/`undefined` → `null`.

### 4.3 `test/configuration/environment-source.test.js` (14)

Exercita `composeFromSources` com um catálogo **reduzido** que cobre todos os
kinds: `string`, `numberFromString`, `bool`, `soaFlag` (com `fallbackField`),
`uint`, `uintQuirk`, `list`, `listOrDefault`, `boolString`, `boolStringTrue`,
`optionalPort`, `derived` e um campo `inCompose: false`.

1. **`precedencia defaults < arquivo < env < CLI`** — com somente
   `fileDocument`, `host` vale o valor do arquivo e `sources.host === "file"`;
   com env por cima, o env vence; com CLI por cima, a CLI vence. É a prova da
   regra central do Slice A.
2. **`sources rastreia a fonte vencedora de cada campo`** — um cenário com as
   três fontes simultâneas: `port` → `cli`, `host` → `env`, `timeoutMs` →
   `file`, `jars` → `default`.
3. **`bool: env "1" liga, qualquer outro valor desliga`** — semântica do kind
   `bool` com `TC_ALLOW_WRITE`.
4. **`soaFlag: flag explicita vence, env definido compara "1", senao herda
fallbackField`** — precedência interna do `soaFlag`: flag > env definido >
   herança do master switch.
5. **`uint: default, valor valido e erro com mensagem nominal`** — default
   30000; env `5000` → 5000; `"0"` e `"abc"` lançam
   `TC_TIMEOUT_MS deve ser um inteiro entre 1 e 120000`.
6. **`uintQuirk preserva a chamada historica de 2 argumentos (mensagem 30000)`**
   — sem valor → `undefined` (reproduz `dbRequestTimeoutMs` ausente no
   `loadConfig` atual); valor fora do intervalo (130000) lança mensagem com
   **30000** no lugar do nome (`30000 deve ser um inteiro entre 1 e 120000`),
   porque a chamada histórica era `positiveNumber(value, 30_000)` com 2
   argumentos; valor válido passa.
7. **`numberFromString: coerção Number e default`** — default 4100; env 4101;
   flag 4102.
8. **`list: separa por ponto-e-virgula ou virgula, trim e descarta vazios`** —
   `;` e `,` equivalentes; string só com separadores → `[]`; ausente → `[]`; o
   arquivo gerenciado pode fornecer array direto.
9. **`listOrDefault: lista vazia cai no default`** — default `["localhost"]`;
   env populado vence; env em branco → default.
10. **`boolString: somente a string "false" desliga`** — default `true`;
    env `"false"` → `false`; env `"0"` → `true` (só `"false"` desliga); flag
    `"false"` → `false`; arquivo com `false` literal passa direto.
11. **`boolStringTrue: somente a string "true" liga`** — default `false`;
    env `"true"` → `true`; env `"1"` → `false`; arquivo com `true` literal
    passa.
12. **`optionalPort: ausente retorna undefined, invalido lanca mensagem
nominal`** — ausente → `undefined`; `1433` → 1433; `70000` lança
    `TC_DB_PORT deve ser uma porta entre 1 e 65535`.
13. **`derived: chama derive() e ignora outras fontes`** — campo derivado
    (`sep`) ignora flag e retorna o valor de `derive()`.
14. **`inCompose:false fica fora da composicao`** — campo com
    `inCompose: false` não aparece em `values`.

### 4.4 `test/configuration/manager.test.js` (15)

Atravessa a **interface** do `ConfigurationManager` (plano §13.1: testar o
manager, não helpers internos) usando `InMemoryConfigStore` +
`InMemorySecretStore`. O helper `makeManager()` constrói um manager de agente
com env/flags/secrets injetados.

1. **`composeEffectiveSync reproduz exatamente o shape do loadConfig`** — o
   teste mais importante do Slice A. Seta um conjunto de env vars reais
   (`TC_ALLOW_WRITE`, `TC_ALLOWED_WRITE_PATHS`, `TC_ALLOW_DIAGNOSTICS`,
   `TC_TEAMCENTER_SOA_PREFLIGHT`, `TC_TEAMCENTER_LOCALE`,
   `TC_DB_REQUEST_TIMEOUT_MS`) e chama `manager.composeEffectiveSync(flags)` e
   `loadConfig(flags)` com as mesmas flags; compara **campo a campo** por
   `deepEqual`. Cobertura nominal: `allowWrite`/`allowDiagnostics` `true`;
   preflight/health/preferences `false` (sem o master switch); `locale`
   `"pt_BR"`; `dbRequestTimeoutMs` 15000; `host` da CLI; `token`; `pathSeparator`
   é string. As env vars são **restauradas** no `finally` (nunca reatribui
   `process.env`, que é inválido em ESM estrito).
2. **`composeEffectiveSync respeita defaults quando nada e informado`** —
   somente token/readPaths obrigatórios: `host` `127.0.0.1`, `port` 4100,
   `allowWrite` `false`, `tunnel` `"localtunnel"`, `diagnosticHosts` no default
   de loopback e `dbRequestTimeoutMs` `undefined` (quirk histórico).
3. **`snapshot: revisao 0 sem arquivo, valores efetivos e status de origem`** —
   sem escrita, `revision === 0`, `fingerprint === null`, `file.present ===
false`; `host` vindo da env → `status.source === "env"`, `locked === true`;
   `allowWrite` da flag → `source === "cli"`.
4. **`snapshot: segredos nunca saem, apenas status de configuracao`** —
   `effective.teamcenterPassword` para env é `{configured: true, valueSource:
"env"}`; `token` da CLI idem com `"cli"`; `dbPassword` sem fonte →
   `{configured: false, valueSource: "default"}`. **Nenhum valor de segredo
   aparece no snapshot.**
5. **`plan/apply: fluxo feliz com revisao monotona e resumo`** — `plan({url,
allowWrite}, 0)` retorna `planId`, `revision 0`, `changeCount 2`,
   `expiresInMs > 0`; `apply` persiste e retorna `revision 1`; o snapshot
   subsequente mostra `revision 1`, valor efetivo aplicado, `file.present` e
   `file.secretRefs === []`.
6. **`plan: mudanca com secretRef conhecido registra o campo em secretRefs`** —
   `plan({teamcenterPassword: {secretRef}})` lista `teamcenterPassword` em
   `secretRefs` do plano; após `apply`, o arquivo guarda somente o ref
   (`file.secretRefs === ["TC_TEAMCENTER_PASSWORD"]`) e o efetivo reporta
   `{configured: true, valueSource: "file"}` — o **valor nunca é persistido nem
   exposto**.
7. **`plan: secretRef desconhecido e rejeitado com SECRET_MISSING`** — ref
   ausente do secret store lança `ERR_ADMIN_SECRET_MISSING` ainda no `plan`.
8. **`plan: expectedRevision divergente lanca REVISION_CONFLICT`** — após
   aplicar um plano (revisão vira 1), planejar com `expectedRevision: 0` lança
   `ERR_ADMIN_REVISION_CONFLICT`.
9. **`plan: mudanca fora do schema gerenciado e rejeitada (VALIDATION)`** —
   campo `mutableInUi: false` (ex.: `host`) → `ERR_ADMIN_VALIDATION`.
10. **`apply: plano inexistente lanca PLAN_NOT_FOUND`** —
    `ERR_ADMIN_PLAN_NOT_FOUND`.
11. **`apply: plano expirado lanca PLAN_EXPIRED`** — envelhece o `expiresAt`
    do plano (leva ao passado) → `ERR_ADMIN_PLAN_EXPIRED`.
12. **`apply: arquivo mudou desde o plano lanca REVISION_CONFLICT`** — um
    segundo plano é criado e aplicado antes do primeiro; aplicar o primeiro
    (fingerprint desatualizado) lança `ERR_ADMIN_REVISION_CONFLICT`. É a prova
    de detecção de escrita concorrente (plano §17: "Mudanças concorrentes são
    rejeitadas sem perda de dados").
13. **`rollback: restaura revisao anterior como nova revisao`** — aplica
    `a` (rev 1) e `b` (rev 2); `rollback(1)` retorna `{restoredFrom: 1,
revision: 3}` e o snapshot volta a valer `a`. Rollback nunca reescreve
    história — cria revisão nova.
14. **`rollback: revisao invalida ou inexistente`** — `rollback(0)` →
    `ERR_ADMIN_VALIDATION`; `rollback(99)` → `ERR_ADMIN_REVISION_NOT_FOUND`.
15. **`snapshot com arquivo: fingerprint e secretRefs do documento gerenciado`**
    — após aplicar mudança com url + secretRef: `revision 1`, `fingerprint`
    presente, `file.revision 1`, `file.present`, `file.secretRefs` com o ref.

### 4.5 `test/configuration/schemas.test.js` (7)

1. **`schemas de dados sao estritos: campos desconhecidos rejeitados`** — campo
   `naoExiste` em schemas de agente e broker → `Unrecognized key`.
2. **`agente: campos imutaveis/derivados ficam fora do schema de arquivo`** —
   `host` (`mutableInUi: false`), `pathSeparator` (derived) e `token` (secret
   imutável) → `Unrecognized key`. A UI não consegue gravá-los no arquivo
   gerenciado.
3. **`agente: campos editaveis aceitam tipos do catalogo`** — parse de
   `allowWrite` (bool), `teamcenterUrl` (string), `teamcenterSoaExtraJars`
   (list), `teamcenterSoaMaxConcurrency` (uint), `dbPort` (int),
   `readPaths` (list) passa e preserva tipos.
4. **`agente: campos secret aceitam somente secretRef`** — valor direto
   (`"segredo"`) → `Expected object`; com `{secretRef}` parseia e preserva o
   ref. Prova de que segredo em texto claro nunca entra no arquivo.
5. **`broker: campos do catalogo broker`** — parse de `allowedActions`,
   `capabilityTtlSeconds`, `subject`; `port` e `apiToken` (ambos imutáveis) →
   `Unrecognized key`.
6. **`envelope versionado: schemaVersion fixo e revisao monotona >= 1`** —
   `schemaVersion: 2` → `Invalid literal value`; `revision: 0` → erro de
   mínimo; envelope do broker rejeita `allowWrite` (campo do agente) →
   `Unrecognized key`.
7. **`envelopeFor e fileDataSchemaFor roteiam por target`** — `"agent"` e
   `"broker"` retornam os schemas corretos; target desconhecido →
   `target invalido`.

### 4.6 `test/configuration/secrets.test.js` (5)

1. **`EnvironmentSecretStore: resolve por nome da variavel original`** — o
   secretRef `TC_TEAMCENTER_PASSWORD` resolve direto.
2. **`EnvironmentSecretStore: aceita secretRef completo TC_SECRET_<NOME>`** — o
   prefixo `TC_SECRET_` é aceito e resolve o mesmo valor.
3. **`EnvironmentSecretStore: ausente ou vazio lanca SECRET_MISSING`** —
   variável ausente, vazia ou com prefixo `TC_SECRET_` ausente →
   `ERR_ADMIN_SECRET_MISSING`.
4. **`EnvironmentSecretStore: status expoe presenca e procedencia, nunca
valor`** — `status()` retorna `{ref, configured, source: "env"}`; valor
   nunca aparece.
5. **`InMemorySecretStore: resolve, ausente lanca SECRET_MISSING, status por
ref`** — mesmo contrato com `source: "in-memory"` (adapter de teste).

### 4.7 `test/configuration/stores.test.js` (8)

Usa diretórios temporários (`mkdtempSync`), sempre com limpeza no `finally`.

1. **`AtomicJsonStore: escrita atomica com revisao monotona e backup`** — leitura
   sem arquivo → `null`; primeira escrita → `revision 1` com envelope
   (`schemaVersion: 1`); segunda → `revision 2`; `readRevision(1)` restaura o
   estado anterior; **nenhum arquivo `.tmp-*` sobra** (rename atômico).
2. **`AtomicJsonStore: listHistory inclui backups e revisao corrente em ordem
desc`** — após duas escritas, histórico `[2, 1]`.
3. **`AtomicJsonStore: rotacao limita backups ao maxBackups`** — com
   `maxBackups: 2` e 4 escritas, restam apenas `tc-agent.json.bak-2` e
   `.bak-3`.
4. **`AtomicJsonStore: arquivo ausente retorna null; JSON invalido vira
AdminError`** — ausente → `null`; JSON malformado → `ERR_ADMIN_INVALID_CONFIG`
   estável; envelope fora do schema (ex.: `revision: 0`) →
   `ERR_ADMIN_INVALID_CONFIG`. Prova de que configuração inválida nunca é
   usada (plano §17).
5. **`AtomicJsonStore: readRevision inexistente retorna null`** — revisão sem
   backup → `null`.
6. **`AtomicJsonStore: backup com JSON invalido em readRevision lanca erro`** —
   backup corrompido → erro explícito `nao e JSON valido` (fail loud, não
   retorna null silenciosamente).
7. **`AtomicJsonStore: backup com envelope fora do schema em readRevision
retorna null`** — JSON válido porém com campo proibido (ex.: `token`) →
   `null` (backup não é candidato a rollback).
8. **`InMemoryConfigStore: revisao monotona, historico e leitura de revisao`** —
   três escritas → revisões 1..3; histórico `[3, 2, 1]`; `readRevision(1)`
   restaura `{host: "a"}`; leitura corrente → revisão 3.

---

## 5. Mapeamento de requisitos do plano → testes

| Requisito (plano §13.1)                    | Onde é provado                                            |
| ------------------------------------------ | --------------------------------------------------------- |
| Precedência defaults < arquivo < env < CLI | `environment-source.test.js` #1, #2; `manager.test.js` #2 |
| Snapshot sanitizado e indicação de fonte   | `manager.test.js` #3, #4, #15                             |
| Schemas estritos / campos desconhecidos    | `schemas.test.js` #1–#7                                   |
| Diff sem valores secretos                  | `diff.test.js` #4; `manager.test.js` #5, #6 (secretRefs)  |
| Concorrência por `expectedRevision`        | `manager.test.js` #8, #12                                 |
| Expiração e reaplicação de plano           | `manager.test.js` #10, #11                                |
| Escrita atômica, backup e rollback         | `stores.test.js` #1–#7; `manager.test.js` #13, #14        |
| Classificação hot reload/restart/external  | `diff.test.js` #4, #5 (`applyImpact` no resumo)           |
| Testes pela interface do manager           | `manager.test.js` (inteiro)                               |

Critérios de aceite gerais (§17) cobertos pelo Slice A:

| Critério (§17)                                | Onde é provado                                       |
| --------------------------------------------- | ---------------------------------------------------- |
| Nenhuma resposta contém segredo               | `manager.test.js` #4, #6; `diff.test.js` #4          |
| Mudanças concorrentes rejeitadas sem perda    | `manager.test.js` #8, #12                            |
| Configuração inválida nunca substitui a ativa | `stores.test.js` #4; `json-file-source` (AdminError) |
| Rollback restaura revisão validada            | `manager.test.js` #13, #14                           |

---

## 6. Verificação manual complementar

Além da suíte, um smoke test rápido prova o fluxo de ponta a ponta
(plan → apply → snapshot → rollback) contra o `AtomicJsonStore` real em
disco, sem tocar no repositório:

```bash
node --input-type=module -e '
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ConfigurationManager } from "./src/configuration/manager.js";
import { AGENT_FIELDS } from "./src/configuration/field-catalog.js";
import { AtomicJsonStore } from "./src/configuration/stores/atomic-json-store.js";
import { EnvironmentSecretStore } from "./src/configuration/secrets/environment-secret-store.js";
import { envelopeFor } from "./src/configuration/schemas.js";

const dir = mkdtempSync(path.join(tmpdir(), "tc-smoke-"));
const store = new AtomicJsonStore({
  filePath: path.join(dir, "tc-agent.json"),
  envelopeSchema: envelopeFor("agent"),
});
const manager = new ConfigurationManager({
  target: "agent",
  fields: AGENT_FIELDS,
  store,
  secretStore: new EnvironmentSecretStore({ TC_TEAMCENTER_PASSWORD: "x" }),
  env: process.env,
});

const plan = await manager.plan({ allowWrite: true, teamcenterUrl: "https://tc/tc" }, 0);
console.log("plan: changeCount =", plan.changeCount, "| expiresInMs > 0:", plan.expiresInMs > 0);
const applied = await manager.apply(plan.planId);
console.log("apply: revision =", applied.revision);
const snap = await manager.snapshot();
console.log("snapshot: revision =", snap.revision, "| allowWrite =", snap.effective.allowWrite,
            "| source =", snap.status.allowWrite.source, "| arquivo:", snap.file.present ? "presente" : "ausente");
// Segunda aplicacao: transforma a revisao 1 em backup (rollback(1) so existe
// apos uma sobrescrita — backups sao da revisao corrente antes do write).
await manager.apply((await manager.plan({ teamcenterUrl: "https://tc/outro" }, 1)).planId);
const rb = await manager.rollback(1);
console.log("rollback: restoredFrom =", rb.restoredFrom, "| nova revision =", rb.revision);
rmSync(dir, { recursive: true, force: true });
'
```

Saída esperada:

```
plan: changeCount = 2 | expiresInMs > 0: true
apply: revision = 1
snapshot: revision = 1 | allowWrite = true | source = file | arquivo: presente
rollback: restoredFrom = 1 | nova revision = 3
```

Para inspecionar o arquivo gerado (sem segredos em claro), troque o `rmSync`
final por `console.log(dir)` e leia o JSON — deve conter somente `allowWrite`
e `teamcenterUrl`, nunca a senha.

---

## 7. Como estender a suíte (convenções)

- **Novo teste**: `node:test` + `node:assert/strict`, ESM, sem frameworks.
  Coloque em `test/configuration/<area>.test.js`. Rodar: ver §2.
- **Mude comportamento do `loadConfig`**: rode `test/config.test.js` primeiro
  e adicione um caso lá para a nova validação/mensagem.
- **Mude um kind de campo**: atualize o catálogo reduzido no topo de
  `environment-source.test.js` (ele existe justamente para cobrir kinds sem
  depender do catálogo real de 825 linhas) e verifique o `manager.test.js` #1
  (equivalência com `loadConfig`), que reprova qualquer divergência de shape.
- **Nunca use `process.env = ...`** em testes (ESM estrito rejeita reatribuição
  do objeto): use o padrão `setEnv`/restauração do `manager.test.js` #1.
- **Fixtures de arquivo**: `mkdtempSync` + `try/finally` com `rmSync` — nunca
  escreva no repositório.
- **Título do teste** em PT-BR sem acento, no padrão
  `"<unidade>: <comportamento esperado>"` (ex.:
  `"AtomicJsonStore: escrita atomica com revisao monotona e backup"`).

## 8. Lacunas conhecidas (fora do escopo do Slice A)

- **Camada HTTP/admin** (Fase 2 do plano): não há testes de endpoints, CSRF,
  sessão ou autorização — o módulo testado é somente o núcleo de configuração.
- **Reaplicação de plano após expiração**: o teste #11 prova a rejeição do
  plano expirado; recriar o plano e aplicar de novo é coberto implicitamente
  pelo fluxo feliz (#5), não por um caso dedicado.
- **Crash durante escrita**: a atomicidade é provada pela ausência de `.tmp-*`
  (`stores.test.js` #1) e pelo `rename`; a simulação de queda no meio da
  escrita é hardening previsto para fases posteriores (§575 do plano).
- **Equivalência `loadConfig` com arquivo gerenciado**: o teste de equivalência
  (#1 do manager) roda sem `fileDocument` por decisão do Slice A — o documento
  gerenciado passa a valer na Fase 2 sob teste de equivalência explícito
  (plano §6.4). O `snapshot()` já compõe com o arquivo e é exercitado pelos
  testes #5, #6 e #15.
