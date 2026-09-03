# Plano de Implementação — tc-bridge v2

Status: planejado. Gerado em 2026-09-01 como extensão do diagnóstico SQL Server.

Este documento define o backlog estruturado de melhorias para o tc-bridge,
tc-agent e tc-broker. Cada item possui objetivo, arquivos afetados, requisitos
técnicos, critérios de aceite e dependências.

---

## Visão geral

O plano está dividido em 4 fases com prioridade decrescente:

| Fase | Foco                                              | Prazo estimado |
| ---- | ------------------------------------------------- | -------------- |
| 1    | Expandir SOA Adapter e capability discovery       | 2 semanas      |
| 2    | Operacionalidade (health, snapshots, alertas)     | 2 semanas      |
| 3    | Arquitetura PLM (BMIDE, comparadores)             | 3 semanas      |
| 4    | Interface do engenheiro (explorer, BOM, workflow) | 4 semanas      |

Cada fase pode ser implementada de forma independente. Fases maiores (3 e 4)
podem ser decompostas em subtarefas menores.

---

## Fase 1 — Expandir SOA Adapter e Capability Discovery

### 1.1 Expandir o TeamcenterSoaAdapter.java

**Objetivo:** Adicionar 6 novas operações SOA ao adaptador Java, aumentando de
4 para 10 operações.

**Arquivos afetados:**

- `java/src/main/java/com/aldokruger/tcbridge/TeamcenterSoaAdapter.java`
- `src/teamcenter-soa.js` (validação de input)
- `test/teamcenter-soa.test.js` (testes)

**Operações a adicionar:**

| #   | Ação                  | Serviço SOA                | Parâmetros                                                        | Retorno                                        |
| --- | --------------------- | -------------------------- | ----------------------------------------------------------------- | ---------------------------------------------- |
| 1   | `get_related_objects` | `DataManagementService`    | `object_uid`, `relation_type` (opcional)                          | Lista de UIDs e nomes dos objetos relacionados |
| 2   | `get_dataset_content` | `DatasetManagementService` | `dataset_uid`                                                     | Lista de arquivos (nome, tamanho, tipo MIME)   |
| 3   | `get_bom_structure`   | `BOMManagementService`     | `item_revision_uid`, `bom_view_name` (opcional)                   | Árvore BOM com UIDs, nomes, quantidades        |
| 4   | `get_workflow_info`   | `WorkflowService`          | `object_uid`                                                      | Estado do workflow, tasks, signoffs            |
| 5   | `search_objects`      | `QueryService`             | `type_name`, `properties_json` (array de {nome, valor, operador}) | Lista de objetos com UIDs e propriedades       |
| 6   | `get_user_info`       | `SessionService`           | (nenhum)                                                          | Usuário atual, grupo, role, permissões         |

**Requisitos de implementação:**

1. Cada operação é um `case` no switch de `main(String[] args)`
2. Leitura de credenciais via env vars (jamais via args)
3. JSON output via `toJson()` (método existente)
4. Timeout de 30s por operação
5. Tratamento de erros com `safeMessage()` (redação de senhas)
6. Não expor texto SQL ou service context

**Método `getRelatedObjects`:**

```java
case "get_related_objects":
    args.parse(new String[]{"--object-uid", "--relation-type"});
    // 1. DataManagementService.loadObjects(new String[]{objectUid})
    // 2. ICMService.getRelatedObjects(objectUid, relationType, null)
    // 3. Para cada objeto relacionado: getName(), getType().getName()
    // 4. Retornar array de {uid, name, type}
    break;
```

**Método `getDatasetContent`:**

```java
case "get_dataset_content":
    args.parse(new String[]{"--dataset-uid"});
    // 1. DataManagementService.loadObjects(new String[]{datasetUid})
    // 2. DatasetManagementService.getDatasetNames(datasetUid)
    // 3. Para cada named reference: getName(), getFileSize(), getContentType()
    // 4. Retornar array de {name, size_bytes, content_type}
    break;
```

**Método `getBomStructure`:**

```java
case "get_bom_structure":
    args.parse(new String[]{"--item-revision-uid", "--bom-view-name"});
    // 1. BOMManagementService.createBOMWindow(itemRevisionUid)
    // 2. BOMWindow.getTopBOMLine()
    // 3. Recursivo: getChildren() → {uid, name, quantity, level}
    // 4. Fechar BOMWindow
    // 5. Limitar profundidade a 3 níveis por padrão
    break;
```

**Método `getWorkflowInfo`:**

```java
case "get_workflow_info":
    args.parse(new String[]{"--object-uid"});
    // 1. WorkflowService.getWorkflowProcesses(objectUid)
    // 2. Para cada processo: getName(), getProcessState(), getTasks()
    // 3. Para cada task: getName(), getAssignee(), getDueDate(), getCompletionState()
    // 4. Retornar {processes: [{name, state, tasks: [{name, assignee, due, state}]}]}
    break;
```

**Método `searchObjects`:**

```java
case "search_objects":
    args.parse(new String[]{"--type-name", "--properties-json"});
    // 1. QueryService.createQuery(typeName)
    // 2. Para cada propriedade: query.addCriteria(propertyName, value, operator)
    // 3. QueryService.executeQueries(query)
    // 4. Para cada resultado: getUid(), getName(), getType()
    // 5. Retornar array de {uid, name, type}
    break;
```

**Método `getUserInfo`:**

```java
case "get_user_info":
    // 1. SessionService.getSessionInfo()
    // 2. SessionService.getAvailableServices() (já existe)
    // 3. SessionService.getUsers() → getCurrentUser()
    // 4. Retornar {user, group, role, locale}
    break;
```

**Critério de saída:** Todas as 10 operações funcionam, possuem testes unitários
no Java e no JavaScript, e não expõem credenciais ou SQL arbitrário.

---

### 1.2 Adicionar `discover_saved_queries`

**Objetivo:** Listar todas as saved queries disponíveis no Teamcenter, quebrando
o problema circular de precisar de um UID para usar o bridge.

**Arquivos afetados:**

- `java/src/main/java/com/aldokruger/tcbridge/TeamcenterSoaAdapter.java`
- `src/teamcenter-soa.js`
- `test/teamcenter-soa.test.js`

**Implementação:**

```java
case "discover_saved_queries":
    // 1. SavedQueryService.getAllSavedQueries()
    // 2. Para cada query: getUid(), getName(), getQueryType(), getOwner()
    // 3. Retornar array de {uid, name, type, owner}
    break;
```

**Critério de saída:** O engenheiro pode executar `discover_saved_queries` e
receber a lista completa de queries disponíveis, com UIDs para usar em
`execute_saved_query`.

---

### 1.3 Adicionar `execute_query_by_name`

**Objetivo:** Executar uma saved query pelo nome em vez de UID.

**Arquivos afetados:**

- `java/src/main/java/com/aldokruger/tcbridge/TeamcenterSoaAdapter.java`
- `src/teamcenter-soa.js`
- `test/teamcenter-soa.test.js`

**Implementação:**

```java
case "execute_query_by_name":
    args.parse(new String[]{"--query-name", "--entries-json", "--values-json", "--limit"});
    // 1. SavedQueryService.findSavedQueryByName(queryName)
    // 2. Se não encontrada, retornar erro claro
    // 3. SavedQueryService.executeSavedQueries(query, entries, values, limit)
    // 4. Retornar mesma estrutura de execute_saved_query
    break;
```

**Critério de saída:** O engenheiro pode executar `execute_query_by_name` com
o nome da query (ex: "Items by ID") sem precisar do UID.

---

### 1.4 Tipagem de properties

**Objetivo:** Retornar o tipo real das propriedades em vez de apenas string.

**Arquivos afetados:**

- `java/src/main/java/com/aldokruger/tcbridge/TeamcenterSoaAdapter.java`

**Implementação:**

Modificar o método `getProperties` para retornar:

```json
{
  "property_name": "creation_date",
  "property_type": "date",
  "value": "2026-09-01T10:30:00Z"
}
```

Em vez de:

```json
{
  "creation_date": "2026-09-01T10:30:00Z"
}
```

**Tipos a suportar:**

- `string` — getStringValue()
- `stringArray` — getStringArrayValue()
- `date` — getDateValue() → ISO 8601
- `integer` — getIntegerValue()
- `double` — getDoubleValue()
- `boolean` — getBooleanValue()
- `uid` — getUidValue() → string UID

**Critério de saída:** A resposta de `get_object_properties` inclui o tipo de
cada propriedade.

---

### 1.5 Atualizar `src/teamcenter-soa.js` (validação)

**Objetivo:** Adicionar validação para as 6 novas operações.

**Arquivos afetados:**

- `src/teamcenter-soa.js`
- `test/teamcenter-soa.test.js`

**Implementação:**

Adicionar cases no `validateTeamcenterReadRequest`:

```javascript
case "get_related_objects":
    if (typeof request.object_uid !== "string" ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(request.object_uid))
        throw new Error("object_uid invalido");
    return {
        check: request.check,
        objectUid: request.object_uid,
        relationType: typeof request.relation_type === "string"
            ? request.relation_type : "",
    };

case "get_dataset_content":
    if (typeof request.dataset_uid !== "string" ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(request.dataset_uid))
        throw new Error("dataset_uid invalido");
    return { check: request.check, datasetUid: request.dataset_uid };

case "get_bom_structure":
    if (typeof request.item_revision_uid !== "string" ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(request.item_revision_uid))
        throw new Error("item_revision_uid invalido");
    return {
        check: request.check,
        itemRevisionUid: request.item_revision_uid,
        bomViewName: typeof request.bom_view_name === "string"
            ? request.bom_view_name : "",
    };

case "get_workflow_info":
    if (typeof request.object_uid !== "string" ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(request.object_uid))
        throw new Error("object_uid invalido");
    return { check: request.check, objectUid: request.object_uid };

case "search_objects":
    if (typeof request.type_name !== "string" || !request.type_name)
        throw new Error("type_name obrigatorio");
    return {
        check: request.check,
        typeName: request.type_name,
        propertiesJson: typeof request.properties_json === "string"
            ? request.properties_json : "[]",
        limit: limit(request.limit),
    };

case "get_user_info":
    return { check: request.check };

case "discover_saved_queries":
    return { check: request.check };

case "execute_query_by_name":
    if (typeof request.query_name !== "string" || !request.query_name)
        throw new Error("query_name obrigatorio");
    return {
        check: request.check,
        queryName: request.query_name,
        entries: stringArray(request.entries_json, "entries_json"),
        values: stringArray(request.values_json, "values_json", {
            maxItems: 50, maxLength: 2_000,
        }),
        limit: limit(request.limit),
    };
```

Adicionar cases correspondentes no `adapterArgs`:

```javascript
case "get_related_objects":
    return [
        "--action", "get_related_objects",
        "--object-uid", request.objectUid,
        "--relation-type", request.relationType,
    ];
case "get_dataset_content":
    return [
        "--action", "get_dataset_content",
        "--dataset-uid", request.datasetUid,
    ];
case "get_bom_structure":
    return [
        "--action", "get_bom_structure",
        "--item-revision-uid", request.itemRevisionUid,
        "--bom-view-name", request.bomViewName,
    ];
case "get_workflow_info":
    return [
        "--action", "get_workflow_info",
        "--object-uid", request.objectUid,
    ];
case "search_objects":
    return [
        "--action", "search_objects",
        "--type-name", request.typeName,
        "--properties-json", request.propertiesJson,
        "--limit", String(request.limit),
    ];
case "get_user_info":
    return ["--action", "get_user_info"];
case "discover_saved_queries":
    return ["--action", "discover_saved_queries"];
case "execute_query_by_name":
    return [
        "--action", "execute_query_by_name",
        "--query-name", request.queryName,
        "--entries", JSON.stringify(request.entries),
        "--values", JSON.stringify(request.values),
        "--limit", String(request.limit),
    ];
```

**Critério de saída:** Todas as 8 operações (4 existentes + 4 novas de
discover/by-name) passam validação e são encaminhadas corretamente ao adapter.

---

### 1.6 Atualizar README.md

**Objetivo:** Documentar as novas operações SOA e permissões necessárias.

**Arquivo afetado:** `README.md`

**Seção a atualizar:** "Consultas Teamcenter SOA"

**Conteúdo a adicionar:**

```markdown
| Ação                     | Descrição                                     |
| ------------------------ | --------------------------------------------- |
| `session_info`           | Lista serviços SOA disponíveis                |
| `get_preferences`        | Obtém preferências por escopo e nomes         |
| `get_object_properties`  | Obtém propriedades de qualquer objeto por UID |
| `execute_saved_query`    | Executa saved query por UID                   |
| `discover_saved_queries` | Lista todas as saved queries disponíveis      |
| `execute_query_by_name`  | Executa saved query por nome                  |
| `get_related_objects`    | Navega relações entre objetos                 |
| `get_dataset_content`    | Lista arquivos de um Dataset                  |
| `get_bom_structure`      | Explodir estrutura BOM                        |
| `get_workflow_info`      | Estado de workflows e tasks                   |
| `search_objects`         | Busca por tipo e propriedades                 |
| `get_user_info`          | Usuário, grupo e role atuais                  |
```

**Permissões SOA necessárias:**

```markdown
| Serviço SOA                | Permissão requerida                     |
| -------------------------- | --------------------------------------- |
| `SessionService`           | Leitura de sessão e preferências        |
| `DataManagementService`    | Leitura de objetos e relações           |
| `DatasetManagementService` | Leitura de nomes de datasets            |
| `BOMManagementService`     | Leitura de estruturas BOM               |
| `WorkflowService`          | Leitura de processos e tasks            |
| `SavedQueryService`        | Execução de queries salvas              |
| `QueryService`             | Criação e execução de queries dinâmicas |
```

**Critério de saída:** README atualizado com tabela completa das 12 operações
e permissões.

---

## Fase 2 — Operacionalidade

### 2.1 Health check do agent

**Objetivo:** Adicionar tool `agent_health` que retorna status completo do agent.

**Arquivos afetados:**

- `src/tools.js` (novo tool)
- `src/config.js` (nenhuma mudança)
- `test/tools.test.js` (testes)

**Implementação:**

```javascript
// Em tools.js, adicionar tool condicional:
if (cfg.allowDbDiagnostics) {
  tools.agent_health = {
    description:
      "Status completo do agente: conectividade, versao, espaco em disco, memoria",
    input: {},
    async run() {
      const os = await import("node:os");
      const { execSync } = await import("node:child_process");
      const df = execSync("df -h /", { encoding: "utf8" });
      return {
        agent_version: "0.2.0",
        uptime_seconds: process.uptime(),
        memory_mb: Math.round(process.memoryUsage().rss / 1048576),
        platform: process.platform,
        node_version: process.version,
        disk: df.trim(),
        checks_available: listDbDiagnostics().length,
        timestamp: new Date().toISOString(),
      };
    },
  };
}
```

**Critério de saída:** `agent_health` retorna versão, uptime, memória, disco
e número de checks disponíveis.

---

### 2.2 Snapshot comparativo

**Objetivo:** Capturar todos os checks de uma vez como baseline, depois comparar.

**Arquivos afetados:**

- `src/db-diagnostics.js` (nova função)
- `src/tools.js` (novo tool)
- `test/db-diagnostics.test.js` (testes)

**Implementação:**

```javascript
// Em db-diagnostics.js, adicionar:
export async function captureSnapshot(cfg) {
  const sql = resolveMssqlModule(await import("mssql"));
  const pool = new sql.ConnectionPool(sqlConfig(cfg));
  try {
    await pool.connect();
    const snapshot = { timestamp: new Date().toISOString(), checks: {} };
    for (const [checkName, definition] of DIAGNOSTICS) {
      try {
        const statement = pool.request().input("limit", sql.Int, 50);
        const result = await statement.query(definition.query);
        snapshot.checks[checkName] = {
          rows: result.recordset,
          row_count: result.recordset.length,
        };
      } catch (err) {
        snapshot.checks[checkName] = { error: err.message };
      }
    }
    return snapshot;
  } finally {
    await pool.close().catch(() => {});
  }
}

export function compareSnapshots(before, after) {
  const diffs = [];
  for (const check of Object.keys(before.checks)) {
    const b = before.checks[check];
    const a = after.checks[check];
    if (a.error) {
      diffs.push({ check, type: "error", message: a.error });
      continue;
    }
    if (b.error) {
      diffs.push({
        check,
        type: "recovered",
        message: `was error: ${b.error}`,
      });
      continue;
    }
    if (b.row_count !== a.row_count) {
      diffs.push({
        check,
        type: "row_count_change",
        before: b.row_count,
        after: a.row_count,
      });
    }
  }
  return { before: before.timestamp, after: after.timestamp, diffs };
}
```

**Tool `db_snapshot`:**

```javascript
tools.db_snapshot = {
  description: "Captura snapshot de todos os checks MSSQL como baseline",
  input: { action: "string" }, // "capture" ou "compare"
  async run(request) {
    if (request.action === "capture") {
      const snapshot = await captureSnapshot(cfg);
      return { snapshot };
    }
    if (request.action === "compare") {
      // Recebe dois snapshots via parâmetros
      return compareSnapshots(request.before, request.after);
    }
    throw new Error("acao invalida: use 'capture' ou 'compare'");
  },
};
```

**Critério de saída:** `db_snapshot` captura baseline e compara dois snapshots,
retornando diffs.

---

### 2.3 Alertas automáticos

**Objetivo:** Verificar métricas contra thresholds configuráveis.

**Arquivos afetados:**

- `src/db-diagnostics.js` (nova função)
- `src/tools.js` (novo tool)
- `src/config.js` (novas env vars)

**Implementação:**

```javascript
// Em db-diagnostics.js, adicionar:
const DEFAULT_THRESHOLDS = {
  transaction_log_used_percent: { warning: 70, critical: 90 },
  index_fragmentation_percent: { warning: 30, critical: 50 },
  backup_age_hours: { warning: 24, critical: 48 },
  disk_free_percent: { warning: 20, critical: 10 },
  blocking_sessions: { warning: 5, critical: 10 },
};

export async function runAlerts(cfg, thresholds = DEFAULT_THRESHOLDS) {
  const sql = resolveMssqlModule(await import("mssql"));
  const pool = new sql.ConnectionPool(sqlConfig(cfg));
  try {
    await pool.connect();
    const alerts = [];

    // Transaction log
    const logResult = await pool.request().query(`SELECT d.log_reuse_wait_desc,
                    CAST(ls.cntr_value AS bigint) AS log_size_kb,
                    CAST(lu.cntr_value AS bigint) AS log_used_kb
                    FROM sys.databases d
                    INNER JOIN sys.dm_os_performance_counters ls
                      ON ls.instance_name = d.name AND ls.counter_name = 'Log File(s) Size (KB)'
                    INNER JOIN sys.dm_os_performance_counters lu
                      ON lu.instance_name = d.name AND lu.counter_name = 'Log File(s) Used Size (KB)'
                    WHERE d.database_id = DB_ID()`);
    if (logResult.recordset.length > 0) {
      const row = logResult.recordset[0];
      const pct =
        row.log_size_kb > 0 ? (row.log_used_kb * 100) / row.log_size_kb : 0;
      if (pct >= thresholds.transaction_log_used_percent.critical) {
        alerts.push({
          metric: "transaction_log_used_percent",
          severity: "critical",
          value: pct,
          threshold: thresholds.transaction_log_used_percent.critical,
          message: `Log usage at ${pct.toFixed(1)}%`,
        });
      } else if (pct >= thresholds.transaction_log_used_percent.warning) {
        alerts.push({
          metric: "transaction_log_used_percent",
          severity: "warning",
          value: pct,
          threshold: thresholds.transaction_log_used_percent.warning,
          message: `Log usage at ${pct.toFixed(1)}%`,
        });
      }
    }

    // Backup age
    const backupResult = await pool.request()
      .query(`SELECT TOP 1 backup_finish_date
                    FROM msdb.dbo.backupset
                    WHERE database_name = DB_NAME()
                    ORDER BY backup_finish_date DESC`);
    if (backupResult.recordset.length > 0) {
      const lastBackup = backupResult.recordset[0].backup_finish_date;
      const ageHours = (Date.now() - lastBackup.getTime()) / 3600000;
      if (ageHours >= thresholds.backup_age_hours.critical) {
        alerts.push({
          metric: "backup_age_hours",
          severity: "critical",
          value: Math.round(ageHours),
          threshold: thresholds.backup_age_hours.critical,
          message: `Last backup ${Math.round(ageHours)}h ago`,
        });
      }
    }

    // Blocking
    const blockingResult = await pool.request()
      .query(`SELECT COUNT(*) AS blocking_count
                    FROM sys.dm_exec_requests
                    WHERE blocking_session_id > 0`);
    const blockingCount = blockingResult.recordset[0].blocking_count;
    if (blockingCount >= thresholds.blocking_sessions.critical) {
      alerts.push({
        metric: "blocking_sessions",
        severity: "critical",
        value: blockingCount,
        threshold: thresholds.blocking_sessions.critical,
        message: `${blockingCount} blocking sessions`,
      });
    }

    return {
      timestamp: new Date().toISOString(),
      alert_count: alerts.length,
      alerts,
      all_clear: alerts.length === 0,
    };
  } finally {
    await pool.close().catch(() => {});
  }
}
```

**Tool `db_alerts`:**

```javascript
tools.db_alerts = {
  description: "Verifica metricas MSSQL contra thresholds e retorna alertas",
  input: {},
  async run() {
    return runAlerts(cfg);
  },
};
```

**Variáveis de ambiente adicionais:**

```env
TC_DB_ALERT_LOG_WARNING=70
TC_DB_ALERT_LOG_CRITICAL=90
TC_DB_ALERT_BACKUP_WARNING=24
TC_DB_ALERT_BACKUP_CRITICAL=48
```

**Critério de saída:** `db_alerts` retorna alertas quando métricas ultrapassam
thresholds, com severidade e valor atual.

---

### 2.4 Registrar novos tools no capability system

**Objetivo:** Garantir que os novos tools participam do sistema de capabilities.

**Arquivo afetado:** `src/tools.js`

**Implementação:**

Adicionar no bloco `addHandler`:

```javascript
addHandler("teamcenter.get_related", "tc_soa_read");
addHandler("teamcenter.get_dataset", "tc_soa_read");
addHandler("teamcenter.get_bom", "tc_soa_read");
addHandler("teamcenter.get_workflow", "tc_soa_read");
addHandler("teamcenter.search", "tc_soa_read");
addHandler("teamcenter.get_user", "tc_soa_read");
addHandler("teamcenter.discover_queries", "tc_soa_read");
addHandler("teamcenter.query_by_name", "tc_soa_read");
addHandler("database.snapshot", "db_snapshot");
addHandler("database.alerts", "db_alerts");
addHandler("agent.health", "agent_health");
```

**Critério de saída:** Todos os novos tools estão acessíveis via capabilities
e auditados.

---

## Fase 3 — Arquitetura PLM

### 3.1 BMIDE Model Reader

**Objetivo:** Ler o modelo de dados Teamcenter a partir de arquivos de configuração.

**Arquivos afetados:**

- `src/bmide-reader.js` (novo arquivo)
- `src/tools.js` (novo tool)
- `test/bmide-reader.test.js` (testes)

**Implementação:**

```javascript
// src/bmide-reader.js
import fs from "node:fs/promises";
import path from "node:path";

export async function readBmideModel(tcDataPath) {
  const defaultXml = path.join(tcDataPath, "xml", "teamcenter", "default.xml");
  const content = await fs.readFile(defaultXml, "utf8");

  // Parse XML (usando regex para extração básica)
  const businessObjects = extractBusinessObjects(content);
  const properties = extractProperties(content);
  const lovs = extractLOVs(content);
  const namingRules = extractNamingRules(content);

  return {
    business_objects: businessObjects,
    properties: properties,
    lovs: lovs,
    naming_rules: namingRules,
    source_file: defaultXml,
  };
}

function extractBusinessObjects(xml) {
  // Extrair <business-object> tags com nome, extendido, descrição
  const regex =
    /<business-object[^>]*name="([^"]*)"[^>]*(?:extends="([^"]*)")?[^>]*>/g;
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push({
      name: match[1],
      extends: match[2] || null,
    });
  }
  return results;
}

function extractProperties(xml) {
  // Extrair <property> tags com nome, tipo, proprietário
  const regex =
    /<property[^>]*name="([^"]*)"[^>]*type="([^"]*)"[^>]*(?:owner="([^"]*)")?[^>]*>/g;
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push({
      name: match[1],
      type: match[2],
      owner: match[3] || null,
    });
  }
  return results;
}

function extractLOVs(xml) {
  // Extrair <lov> tags
  const regex = /<lov[^>]*name="([^"]*)"[^>]*>/g;
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push({ name: match[1] });
  }
  return results;
}

function extractNamingRules(xml) {
  // Extrair <naming-rule> tags
  const regex =
    /<naming-rule[^>]*name="([^"]*)"[^>]*(?:pattern="([^"]*)")?[^>]*>/g;
  const results = [];
  let match;
  while ((match = regex.exec(xml)) !== null) {
    results.push({
      name: match[1],
      pattern: match[2] || null,
    });
  }
  return results;
}
```

**Tool `bmide_model`:**

```javascript
tools.bmide_model = {
  description: "Le o modelo de dados BMIDE do Teamcenter (default.xml)",
  input: { tc_data_path: "string" },
  async run({ tc_data_path }) {
    if (!isWithinAllowed(tc_data_path, cfg.readPaths)) {
      throw new Error("Path fora da whitelist de leitura");
    }
    return readBmideModel(tc_data_path);
  },
};
```

**Critério de saída:** `bmide_model` retorna business objects, properties,
LOVs e naming rules de um ambiente Teamcenter.

---

### 3.2 Environment Comparator

**Objetivo:** Comparar dois ambientes Teamcenter via MSSQL.

**Arquivos afetados:**

- `src/db-diagnostics.js` (nova função)
- `src/tools.js` (novo tool)

**Implementação:**

```javascript
// Em db-diagnostics.js, adicionar:
export async function compareEnvironments(cfg1, cfg2) {
  const sql = resolveMssqlModule(await import("mssql"));

  async function getEnvSnapshot(dbConfig) {
    const pool = new sql.ConnectionPool(sqlConfig(dbConfig));
    try {
      await pool.connect();
      const result = {};
      // Versão
      const ver = await pool.request().query(`SELECT
                SERVERPROPERTY('ProductLevel') AS level,
                SERVERPROPERTY('ProductVersion') AS version,
                SERVERPROPERTY('Edition') AS edition`);
      result.server_version = ver.recordset[0];
      // Collation
      const col = await pool.request().query(`SELECT
                DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS collation`);
      result.collation = col.recordset[0].collation;
      // Tamanho
      const size = await pool.request().query(`SELECT
                CAST(SUM(size * 8.0 / 1024) AS decimal(18,2)) AS total_size_mb
                FROM sys.database_files`);
      result.total_size_mb = size.recordset[0].total_size_mb;
      // Índices
      const idx = await pool.request().query(`SELECT
                COUNT(*) AS index_count
                FROM sys.indexes WHERE index_id > 0`);
      result.index_count = idx.recordset[0].index_count;
      return result;
    } finally {
      await pool.close().catch(() => {});
    }
  }

  const [env1, env2] = await Promise.all([
    getEnvSnapshot(cfg1),
    getEnvSnapshot(cfg2),
  ]);

  const diffs = [];
  for (const key of Object.keys(env1)) {
    if (JSON.stringify(env1[key]) !== JSON.stringify(env2[key])) {
      diffs.push({
        field: key,
        source: env1[key],
        target: env2[key],
      });
    }
  }

  return { source: env1, target: env2, diffs };
}
```

**Tool `compare_environments`:**

```javascript
tools.compare_environments = {
  description: "Compara dois ambientes Teamcenter via MSSQL",
  input: {
    source_server: "string",
    source_db: "string",
    target_server: "string",
    target_db: "string",
  },
  async run({ source_server, source_db, target_server, target_db }) {
    // Configuração temporária para cada ambiente
    const cfg1 = { ...cfg, dbServer: source_server, dbName: source_db };
    const cfg2 = { ...cfg, dbServer: target_server, dbName: target_db };
    return compareEnvironments(cfg1, cfg2);
  },
};
```

**Critério de saída:** `compare_environments` retorna diffs entre dois ambientes
com versão, collation, tamanho e número de índices.

---

### 3.3 Upgrade Readiness Check

**Objetivo:** Verificar pré-requisitos antes de um upgrade Teamcenter.

**Arquivos afetados:**

- `src/db-diagnostics.js` (nova função)
- `src/tools.js` (novo tool)

**Implementação:**

```javascript
// Em db-diagnostics.js, adicionar:
export async function checkUpgradeReadiness(cfg) {
  const sql = resolveMssqlModule(await import("mssql"));
  const pool = new sql.ConnectionPool(sqlConfig(cfg));
  try {
    await pool.connect();
    const checks = [];

    // 1. Versão do SQL Server
    const ver = await pool.request().query(`SELECT
            SERVERPROPERTY('ProductLevel') AS level,
            SERVERPROPERTY('ProductVersion') AS version`);
    const sqlVersion = ver.recordset[0];
    const majorVersion = parseInt(sqlVersion.version.split(".")[0]);
    checks.push({
      name: "sql_version",
      status: majorVersion >= 13 ? "ok" : "warning",
      current: sqlVersion.version,
      minimum_required: "13.0 (SQL Server 2016)",
      message:
        majorVersion >= 13
          ? "SQL Server version compatible"
          : "SQL Server version below minimum for TC 2606",
    });

    // 2. Collation
    const col = await pool.request().query(`SELECT
            CONVERT(nvarchar(128), DATABASEPROPERTYEX(DB_NAME(), 'Collation')) AS collation`);
    const collation = col.recordset[0].collation;
    checks.push({
      name: "collation",
      status: collation.includes("_BIN") ? "ok" : "warning",
      current: collation,
      recommended: "Latin1_General_BIN",
      message: collation.includes("_BIN")
        ? "Binary collation (recommended)"
        : "Non-binary collation may cause case sensitivity issues",
    });

    // 3. Espaço em disco
    const disk = await pool.request().query(`SELECT
            CAST(SUM(CASE WHEN type = 0
                THEN FILEPROPERTY(name, 'SpaceUsed') * 8.0 / 1024
                ELSE 0 END) AS decimal(18,2)) AS used_mb,
            CAST(SUM(CASE WHEN type = 0
                THEN size * 8.0 / 1024
                ELSE 0 END) AS decimal(18,2)) AS allocated_mb
            FROM sys.database_files`);
    const diskInfo = disk.recordset[0];
    const usagePercent =
      diskInfo.allocated_mb > 0
        ? (diskInfo.used_mb / diskInfo.allocated_mb) * 100
        : 0;
    checks.push({
      name: "disk_usage",
      status: usagePercent < 80 ? "ok" : "warning",
      used_mb: diskInfo.used_mb,
      allocated_mb: diskInfo.allocated_mb,
      usage_percent: usagePercent.toFixed(1),
      message:
        usagePercent < 80
          ? "Disk usage within limits"
          : `Disk usage at ${usagePercent.toFixed(1)}% - consider cleanup`,
    });

    // 4. Recovery model
    const rec = await pool.request().query(`SELECT
            recovery_model_desc FROM sys.databases WHERE database_id = DB_ID()`);
    const recovery = rec.recordset[0].recovery_model_desc;
    checks.push({
      name: "recovery_model",
      status: recovery === "FULL" ? "ok" : "warning",
      current: recovery,
      recommended: "FULL",
      message:
        recovery === "FULL"
          ? "Full recovery model (supports point-in-time restore)"
          : "Simple recovery model - no point-in-time restore",
    });

    // 5. Backups recentes
    const backup = await pool.request().query(`SELECT TOP 1
            backup_finish_date, type
            FROM msdb.dbo.backupset
            WHERE database_name = DB_NAME()
            ORDER BY backup_finish_date DESC`);
    if (backup.recordset.length > 0) {
      const lastBackup = backup.recordset[0].backup_finish_date;
      const ageHours = (Date.now() - lastBackup.getTime()) / 3600000;
      checks.push({
        name: "backup_recency",
        status: ageHours < 24 ? "ok" : "warning",
        last_backup: lastBackup.toISOString(),
        age_hours: Math.round(ageHours),
        message:
          ageHours < 24
            ? "Recent backup exists"
            : `Last backup ${Math.round(ageHours)}h ago`,
      });
    } else {
      checks.push({
        name: "backup_recency",
        status: "critical",
        message: "No backups found",
      });
    }

    // 6. Query Store
    const qs = await pool.request().query(`SELECT
            actual_state_desc, desired_state_desc
            FROM sys.database_query_store_options`);
    if (qs.recordset.length > 0) {
      const qsInfo = qs.recordset[0];
      checks.push({
        name: "query_store",
        status: qsInfo.actual_state_desc === "READ_WRITE" ? "ok" : "info",
        current_state: qsInfo.actual_state_desc,
        desired_state: qsInfo.desired_state_desc,
        message:
          qsInfo.actual_state_desc === "READ_WRITE"
            ? "Query Store active and writable"
            : `Query Store state: ${qsInfo.actual_state_desc}`,
      });
    }

    const overallStatus = checks.some((c) => c.status === "critical")
      ? "not_ready"
      : checks.some((c) => c.status === "warning")
        ? "ready_with_warnings"
        : "ready";

    return {
      overall_status: overallStatus,
      check_count: checks.length,
      checks,
      timestamp: new Date().toISOString(),
    };
  } finally {
    await pool.close().catch(() => {});
  }
}
```

**Tool `upgrade_readiness`:**

```javascript
tools.upgrade_readiness = {
  description: "Verifica pre-requisitos para upgrade Teamcenter",
  input: {},
  async run() {
    return checkUpgradeReadiness(cfg);
  },
};
```

**Critério de saída:** `upgrade_readiness` retorna status geral (ready,
ready_with_warnings, not_ready) com detalhes de cada check.

---

### 3.4 Preference Auditor

**Objetivo:** Listar todas as preferências Teamcenter e comparar com baseline.

**Arquivos afetados:**

- `src/teamcenter-soa.js` (novo check)
- `test/teamcenter-soa.test.js` (testes)

**Implementação:**

Adicionar ao `validateTeamcenterReadRequest`:

```javascript
case "audit_preferences":
    return {
        check: request.check,
        scope: typeof request.scope === "string"
            ? request.scope : "SITE",
    };
```

Adicionar ao `adapterArgs`:

```javascript
case "audit_preferences":
    return [
        "--action", "get_preferences",
        "--scope", request.scope,
        "--preference-names", JSON.stringify([]),  // empty = all
    ];
```

**Critério de saída:** `audit_preferences` retorna todas as preferências de um
escopo, permitindo comparação com baseline.

---

## Fase 4 — Interface do Engenheiro PLM

### 4.1 Object Explorer

**Objetivo:** Navegação interativa de objetos Teamcenter.

**Arquivos afetados:**

- `src/teamcenter-soa.js` (novo check)
- `test/teamcenter-soa.test.js` (testes)

**Implementação:**

Adicionar ao `validateTeamcenterReadRequest`:

```javascript
case "explore_object":
    if (typeof request.object_uid !== "string" ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(request.object_uid))
        throw new Error("object_uid invalido");
    return {
        check: request.check,
        objectUid: request.object_uid,
        depth: typeof request.depth === "number"
            ? Math.min(request.depth, 3) : 1,
    };
```

Adicionar ao `adapterArgs`:

```javascript
case "explore_object":
    return [
        "--action", "explore_object",
        "--object-uid", request.objectUid,
        "--depth", String(request.depth),
    ];
```

**Implementação Java:**

```java
case "explore_object":
    args.parse(new String[]{"--object-uid", "--depth"});
    // 1. DataManagementService.loadObjects(new String[]{objectUid})
    // 2. DataManagementService.getProperties(objectUid, {"object_name", "object_type", "owning_user"})
    // 3. ICMService.getRelatedObjects(objectUid, null, null) // todas as relações
    // 4. Para cada relacionado, repetir se depth > 1
    // 5. Retornar árvore: {uid, name, type, owner, relations: [{type, target: {...}}]}
    break;
```

**Critério de saída:** `explore_object` retorna a árvore de relações de um
objeto com nome, tipo e owner.

---

### 4.2 BOM Viewer

**Objetivo:** Visualização de estrutura BOM.

**Arquivos afetados:**

- `src/teamcenter-soa.js` (novo check)
- `test/teamcenter-soa.test.js` (testes)

**Implementação:**

Adicionar ao `validateTeamcenterReadRequest`:

```javascript
case "view_bom":
    if (typeof request.item_revision_uid !== "string" ||
        !/^[A-Za-z0-9_-]{8,128}$/.test(request.item_revision_uid))
        throw new Error("item_revision_uid invalido");
    return {
        check: request.check,
        itemRevisionUid: request.item_revision_uid,
        bomViewName: typeof request.bom_view_name === "string"
            ? request.bom_view_name : "",
        maxLevels: typeof request.max_levels === "number"
            ? Math.min(request.max_levels, 5) : 3,
    };
```

Adicionar ao `adapterArgs`:

```javascript
case "view_bom":
    return [
        "--action", "view_bom",
        "--item-revision-uid", request.itemRevisionUid,
        "--bom-view-name", request.bomViewName,
        "--max-levels", String(request.maxLevels),
    ];
```

**Critério de saída:** `view_bom` retorna estrutura BOM com UIDs, nomes,
quantidades e níveis.

---

### 4.3 Workflow Dashboard

**Objetivo:** Dashboard de workflows e tasks.

**Arquivos afetados:**

- `src/teamcenter-soa.js` (novo check)
- `test/teamcenter-soa.test.js` (testes)

**Implementação:**

Adicionar ao `validateTeamcenterReadRequest`:

```javascript
case "workflow_dashboard":
    return {
        check: request.check,
        objectType: typeof request.object_type === "string"
            ? request.object_type : "",
        status: typeof request.status === "string"
            ? request.status : "",
        limit: limit(request.limit),
    };
```

Adicionar ao `adapterArgs`:

```javascript
case "workflow_dashboard":
    return [
        "--action", "workflow_dashboard",
        "--object-type", request.objectType,
        "--status", request.status,
        "--limit", String(request.limit),
    ];
```

**Implementação Java:**

```java
case "workflow_dashboard":
    args.parse(new String[]{"--object-type", "--status", "--limit"});
    // 1. SavedQueryService para buscar objetos com workflow
    // 2. WorkflowService.getWorkflowProcesses() para cada objeto
    // 3. Filtrar por status e tipo
    // 4. Retornar: [{object_uid, object_name, process_name, state, tasks: [...]}]
    break;
```

**Critério de saída:** `workflow_dashboard` retorna lista de workflows com
estado, tasks e responsável.

---

## Resumo de dependências

```
Fase 1 (SOA Adapter)
├── 1.1 Expandir adapter Java ← PREREQUISITO para 1.2, 1.3, 1.4
├── 1.2 discover_saved_queries ← DEPENDE de 1.1
├── 1.3 execute_query_by_name ← DEPENDE de 1.2
├── 1.4 Tipagem de properties ← DEPENDE de 1.1
├── 1.5 Atualizar validação JS ← DEPENDE de 1.1
└── 1.6 Atualizar README ← DEPENDE de 1.1-1.5

Fase 2 (Operacionalidade)
├── 2.1 Health check ← INDEPENDENTE
├── 2.2 Snapshot comparativo ← DEPENDE de 1.1 (pool de conexão)
├── 2.3 Alertas automáticos ← DEPENDE de 1.1
└── 2.4 Capability system ← DEPENDE de 1.1-2.3

Fase 3 (Arquitetura PLM)
├── 3.1 BMIDE Model Reader ← INDEPENDENTE
├── 3.2 Environment Comparator ← DEPENDE de 1.1
├── 3.3 Upgrade Readiness ← DEPENDE de 1.1
└── 3.4 Preference Auditor ← DEPENDE de 1.1

Fase 4 (Interface Engenheiro)
├── 4.1 Object Explorer ← DEPENDE de 1.1
├── 4.2 BOM Viewer ← DEPENDE de 1.1
└── 4.3 Workflow Dashboard ← DEPENDE de 1.1, 4.1
```

---

## Ordem de implementação recomendada

1. **1.1** Expandir adapter Java (6 operações)
2. **1.5** Atualizar validação JS (para as 6 operações)
3. **1.2** discover_saved_queries
4. **1.3** execute_query_by_name
5. **1.4** Tipagem de properties
6. **1.6** Atualizar README
7. **2.1** Health check
8. **2.2** Snapshot comparativo
9. **2.3** Alertas automáticos
10. **2.4** Capability system
11. **3.1** BMIDE Model Reader
12. **3.4** Preference Auditor
13. **3.2** Environment Comparator
14. **3.3** Upgrade Readiness
15. **4.1** Object Explorer
16. **4.2** BOM Viewer
17. **4.3** Workflow Dashboard

---

## Padrões de código a seguir

### Java (TeamcenterSoaAdapter.java)

- Cada operação é um `case` no switch de `main()`
- Leitura de credenciais via `System.getenv()` (jamais args)
- Output JSON via método `toJson()` existente
- Tratamento de erros com `safeMessage()` para redação
- Não expor texto SQL ou service context
- Timeout de 30s por operação

### JavaScript (teamcenter-soa.js)

- Validação de input no `validateTeamcenterReadRequest()`
- Mapeamento para args no `adapterArgs()`
- Padrão existente: UID regex `/^[A-Za-z0-9_-]{8,128}$/`
- Arrays como JSON string (`stringArray()`)

### MSSQL (db-diagnostics.js)

- Todas as queries são SELECT (somente leitura)
- Usar `sys.dm_*` e `sys.*` (views do sistema)
- Usar `@limit` via `TOP (@limit)` para listas
- Não usar `KILL`, `DBCC`, `ALTER`, `CREATE`, `DROP`
- Descrições em português

### Testes

- Usar `node:test` e `node:assert/strict`
- Testar validação (accept/reject)
- Testar limites (min/max)
- Testar tool gating (enable/disable por config)
- Não testar contra banco real (mockar mssql)

---

## Riscos e mitigações

| Risco                                                 | Impacto | Mitigação                                             |
| ----------------------------------------------------- | ------- | ----------------------------------------------------- |
| Teamcenter SOA API muda entre versões                 | Alto    | Testar adapter em TC 2312 e TC 2606 antes de merge    |
| BOM extraction é lenta para estruturas grandes        | Médio   | Limitar profundidade a 3 níveis, timeout de 30s       |
| BMIDE default.xml tem formato diferente entre versões | Médio   | Usar parsing flexível com fallback para XML bruto     |
| Múltiplos bancos no mesmo servidor SQL                | Baixo   | Sempre usar `DB_ID()` para filtrar banco atual        |
| Capability TTL muito curto para operações longas      | Baixo   | Usar 60s padrão; BOM extraction pode precisar de 120s |

---

## Critérios de conclusão do plano

- [ ] Todas as 12 operações SOA funcionam em homologação
- [ ] discover_saved_queries retorna lista completa
- [ ] execute_query_by_name resolve por nome
- [ ] Properties retornam tipo + valor
- [ ] Health check retorna métricas completas
- [ ] Snapshot comparativo gera baseline e diff
- [ ] Alertas disparam quando thresholds são ultrapassados
- [ ] BMIDE Model Reader extrai modelo corretamente
- [ ] Environment Comparator identifica diferenças
- [ ] Upgrade Readiness retorna status geral
- [ ] Object Explorer navega relações
- [ ] BOM Viewer explodir estrutura
- [ ] Workflow Dashboard mostra estado
- [ ] Todos os tools estão no capability system
- [ ] README atualizado com documentação completa
- [ ] Testes passando (node --test)
- [ ] Commit atômico por funcionalidade
