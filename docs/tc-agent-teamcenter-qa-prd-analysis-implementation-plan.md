# Plano de implementação — análise de ambientes Teamcenter QA e PRD com tc-agent

Status: em execução  
Escopo inicial: Teamcenter 2606 em Windows e SQL Server  
Data: 2026-09-01  
Última revisão: 2026-09-01  
Baseline revisado: `37664bd` (`feat/soa-granular-authorization`)

Legenda de acompanhamento:

- ✅ implementado e coberto por teste automatizado;
- 🟡 implementado parcialmente ou aguardando validação em Teamcenter 2606;
- ⬜ planejado;
- ⛔ bloqueado por decisão, segurança ou homologação.

Uma marca ✅ confirma o comportamento coberto pelo repositório. Ela não substitui
o aceite de integração no ambiente QA nem autoriza promoção para PRD.

## 1. Objetivo

Evoluir o `tc-agent` para uma plataforma confiável de diagnóstico e análise de
ambientes Teamcenter, adequada tanto para QA quanto para PRD.

O agente deve coletar evidências, construir a topologia do ambiente, executar
health checks suportados, correlacionar resultados, detectar drift e produzir
findings acionáveis. Em PRD, ele deve permanecer read-only e não executar
correções automáticas.

O fluxo operacional desejado é:

```text
Descobrir → Medir → Correlacionar → Comparar → Explicar → Recomendar
```

## 2. Relação com os planos existentes

Este é o plano integrado de produto e operação. Ele utiliza como pré-requisitos:

- `docs/tc-agent-zero-trust-development-plan.md` para identidade, broker,
  capabilities, auditoria e conexão reversa;
- `docs/tc-agent-teamcenter-soa-improvements-plan.md` para o collector SOA;
- `docs/teamcenter-sql-server-diagnostic-optimization-plan.md` para o collector
  SQL Server;
- `docs/tc-bridge-improvements-plan.md` para confinamento de arquivos, logs e
  implantação;
- `docs/tc-bridge-implementation-plan.md` como backlog anterior a ser revisado.

Em caso de conflito, este plano estabelece os seguintes gates obrigatórios:

1. nenhuma operação Teamcenter nova antes de policy e action granulares;
2. nenhuma resposta SOA por reflexão genérica;
3. nenhuma query, propriedade ou relação arbitrária;
4. nenhuma operação `Internal-*` sem decisão e homologação específicas;
5. nenhuma escrita, manutenção ou correção automática no perfil PRD;
6. nenhum retorno de segredo, cookie, ticket FMS ou conteúdo não autorizado.

Funcionalidades propostas anteriormente, como BOM Explorer, workflow, datasets
ou pesquisa genérica, somente poderão avançar depois desses gates.

### 2.1 Estado da implementação na baseline revisada

O branch `feat/soa-granular-authorization` já materializa parte relevante dos
gates de segurança do collector SOA:

| Capacidade | Estado | Evidência na baseline | Próximo gate |
| --- | --- | --- | --- |
| Policy SOA local, versionada e deny-by-default | ✅ | `src/soa-policy.js` e `docs/soa-policy.example.json` | definir profiles oficiais QA/PRD e processo de distribuição |
| Actions SOA granulares com schemas estritos | ✅ | `src/soa-actions.js` | estabilizar versão pública dos contratos |
| Concorrência, fila, rate limit, timeout e circuit breaker | ✅ | `src/soa-gate.js` | métricas, persistência mínima e teste de carga em QA |
| Protocolo Node.js ↔ Java em JSON/UTF-8 | ✅ | `src/teamcenter-soa.js` e `TeamcenterSoaAdapter.java` | contrato de compatibilidade e testes com adapter real |
| Sanitização, limite de saída e correlation ID | ✅ | camada Node.js/Java e task runner | ampliar auditoria com duração, volume e código estável |
| Preflight, connection health e session context | 🟡 | implementados no adapter | validar conta restrita, locale, TLS e erros reais no QA 2606 |
| Preferences e object inspect allowlisted | 🟡 | implementados por profile local | validar propriedades, partial errors e volume em QA |
| Saved query com UID/entries/limite locais | 🟡 | implementada sem query arbitrária | homologar uma query canária e validar paginação/limites |
| Encoding probe | 🟡 | contrato e action implementados | corrigir leitura da lista de propriedades e testar caracteres especiais |
| Dataset inspect e FMS probe | ⛔ | scaffolds defensivos, desabilitados por padrão | confirmar APIs/JARs 2606 e implementar sem expor tickets |
| Diagnóstico SQL allowlisted | 🟡 | arquivos, encoding, tipos de texto, waits, requests, custo e fragmentação | completar o plano DBA e validar permissões mínimas |
| EnvironmentProfile, topologia, evidence e findings | ⬜ | ainda não implementados como contratos comuns | iniciar após estabilização do núcleo SOA |

A suíte atual possui 52 testes automatizados passando. A cobertura confirma os
controles locais e contratos Node.js, mas ainda não cobre uma sessão SOA real,
as APIs Dataset/FMS nem a matriz completa QA/PRD.

## 3. Resultados esperados

Ao final do programa, o `tc-agent` deve permitir:

- registrar um ambiente Teamcenter por identidade imutável;
- diferenciar instalações coexistentes no mesmo host;
- descobrir componentes e dependências;
- executar diagnósticos adequados ao perfil QA ou PRD;
- produzir resultados com evidência, severidade e confiança;
- comparar QA com PRD;
- comparar estado anterior e posterior a upgrade ou mudança;
- gerar pacote sanitizado para suporte e auditoria;
- executar smoke tests read-only de ponta a ponta;
- operar sem shell, SQL ou SOA arbitrários;
- limitar automaticamente carga, frequência, duração e volume;
- manter trilha auditável do broker ao collector local.

## 4. Princípios de arquitetura

1. **Evidence first.** Toda conclusão deve apontar para evidências observadas.
2. **Read-only por construção.** PRD não depende apenas de convenção ou prompt.
3. **Negação por padrão.** Actions, collectors, parâmetros e dados precisam
   estar explicitamente autorizados.
4. **Perfis distintos.** QA e PRD possuem policies próprias.
5. **Mecanismos Siemens suportados.** TEM, Deployment Center, Teamcenter
   Management Console, Gateway ping e diagnósticos FMS são priorizados.
6. **Versão explícita.** Collectors Teamcenter são compatíveis com releases
   declaradas e testadas.
7. **Metadados antes de conteúdo.** O agente retorna o mínimo necessário.
8. **Sem correção automática.** Diagnóstico e manutenção permanecem módulos
   separados.
9. **Carga previsível.** Toda coleta possui orçamento operacional.
10. **IA como explicação, não autoridade.** Findings primários vêm de regras
    determinísticas e versionadas.
11. **Falha segura.** Dependência, identidade ou policy inválida desabilita a
    capability afetada.
12. **Rollback obrigatório.** Atualizações do agente e policies são reversíveis.

## 5. Fora de escopo

Não fazem parte deste plano inicial:

- terminal remoto;
- PowerShell, Java, SQL ou JavaScript enviado pelo usuário;
- alteração de preferência Teamcenter;
- deploy BMIDE;
- rebuild de índice, estatística ou mudança no SQL Server;
- restart remoto genérico de serviço;
- criação, revisão ou exclusão de objeto em PRD;
- upload ou exportação arbitrária de arquivo;
- retorno de ticket FMS;
- uso de `infodba` como conta permanente do agente;
- reutilização de cookie ou sessão do AWC/RAC;
- impersonação de usuário;
- health score opaco sem evidências.

Uma futura capacidade de manutenção deve ser outro produto ou módulo, com
dupla aprovação, runbook e controles independentes.

## 6. Arquitetura alvo

```text
Usuário / Console operacional
            │ OIDC + MFA + RBAC
            ▼
API / Broker de tarefas
            │ capability assinada e curta
            ▼
tc-agent por host
   ├─ policy local QA/PRD
   ├─ scheduler, fila e limites
   ├─ redator e auditoria
   └─ collectors versionados
       ├─ host/services
       ├─ Teamcenter SOA
       ├─ Server Manager/pool
       ├─ AWC/Gateway
       ├─ FMS
       ├─ SQL Server
       ├─ Solr/indexação
       ├─ RAC/TCCS
       ├─ BMIDE/deployment
       └─ Dispatcher/integrações
            │
            ▼
Evidence store → rules engine → findings → snapshots/diffs/reports
```

### 6.1 Componentes lógicos

| Componente | Responsabilidade |
| --- | --- |
| Agent core | Identidade, configuração, lifecycle, fila e execução |
| Environment registry | Perfis locais, classificação QA/PRD e componentes esperados |
| Collector SDK | Contrato comum para diagnósticos versionados |
| Collectors | Obter evidências sem comandos arbitrários |
| Evidence store | Persistência local temporária e sanitizada |
| Rules engine | Converter evidências em findings determinísticos |
| Baseline engine | Snapshot, comparação e drift |
| Playbook engine | Orquestrar checks por sintoma |
| Reporter | Markdown, JSON, PDF e evidence bundle |
| Broker/API | Autorização, entrega, inventário e auditoria central |
| Console | UX por papel, ambiente, componente e incidente |

### 6.2 Estrutura de código proposta

```text
src/
  agent/
    lifecycle.js
    scheduler.js
    rate-limiter.js
    health.js
  environments/
    registry.js
    profile-schema.js
    discovery.js
  collectors/
    collector-contract.js
    host/
    teamcenter-soa/
    server-manager/
    awc/
    fms/
    database/
    solr/
    rac/
    bmide/
    dispatcher/
  evidence/
    schemas.js
    store.js
    redaction.js
    bundle.js
  rules/
    engine.js
    catalog/
  baselines/
    snapshot.js
    diff.js
  playbooks/
    engine.js
    catalog/
  reporting/
    markdown.js
    json.js
```

Essa organização é um alvo. A migração deve ser incremental, mantendo os
contratos existentes até cada módulo estar coberto por testes.

## 7. Modelo de domínio

### 7.1 EnvironmentProfile

Representa uma configuração Teamcenter conhecida pelo agente:

```json
{
  "schemaVersion": 1,
  "environmentId": "tc2606-dev",
  "classification": "QA",
  "displayName": "Teamcenter 2606 DEV",
  "teamcenterRelease": "2606",
  "hosts": ["SRV26-TC1-DEV"],
  "expectedComponents": ["server-manager", "webtier", "gateway", "fsc"],
  "policyProfile": "qa-standard"
}
```

Paths, URLs e credenciais permanecem na configuração local protegida. O broker
recebe apenas identificadores e metadados necessários.

### 7.2 Component

```text
component_id
environment_id
kind
host
version
instance
dependencies
discovery_source
last_observed_at
```

### 7.3 CheckResult

```text
check_id
collector
collector_version
environment_id
component_id
status
started_at
finished_at
duration_ms
impact_budget
evidence_refs
warnings
partial_errors
truncated
```

### 7.4 Evidence

```text
evidence_id
source
observation_type
observed_at
host
component
sanitized_payload
sha256
retention_class
```

### 7.5 Finding

```text
finding_id
rule_id
severity
confidence
classification: observed | inferred | unverified
title
impact
evidence_refs
excluded_hypotheses
missing_checks
recommended_next_step
runbook_ref
```

### 7.6 Snapshot e Drift

Um snapshot contém somente campos declarados como comparáveis. Um drift contém:

- valor anterior;
- valor atual;
- classificação esperada ou inesperada;
- severidade;
- owner;
- justificativa/waiver;
- data de aprovação;
- evidências.

## 8. Perfis QA e PRD

### 8.1 Matriz operacional

| Capacidade | QA | PRD |
| --- | --- | --- |
| Inventário/topologia | Habilitado | Habilitado |
| Status de serviço/porta | Habilitado | Habilitado |
| Logs | Detalhado e limitado | Resumo, janela e redator reforçado |
| SOA health | Habilitado | Habilitado com menor frequência |
| SOA object/query | Perfis homologados | Allowlist mínima |
| SQL diagnóstico | Amplo read-only | Checks aprovados e agendados |
| Browser/CDP | Perfil isolado permitido | Desabilitado por padrão |
| Dataset/FMS probe | Dados de teste | Arquivo canário preexistente |
| Conteúdo de negócio | Dados de teste | Bloqueado por padrão |
| Synthetic write | Módulo futuro separado | Bloqueado |
| Correção automática | Bloqueada | Bloqueada |

### 8.2 Impact budget

Cada check deve declarar:

| Nível | Exemplo | Uso em PRD |
| --- | --- | --- |
| Zero | Ler estado já mantido pelo agente | Livre conforme policy |
| Baixo | Ping, status de serviço, tail curto | Permitido |
| Médio | Login SOA, query pequena, diagnóstico SQL | Rate limit e janela |
| Alto | Download FMS, snapshot amplo, browser capture | Aprovação específica |
| Bloqueado | Escrita, restart, SQL livre | Não executado |

O scheduler deve suspender operações médias/altas quando CPU, memória, disco,
pool ou banco estiverem acima dos limites definidos.

## 9. Workstreams

### WS1 — Core e segurança

- profiles QA/PRD;
- policy local;
- actions granulares;
- secrets;
- assinatura e atualização;
- auditoria;
- rate limit e fila;
- health do agente.

### WS2 — Inventário e topologia

- instalações Teamcenter;
- serviços e processos;
- endpoints;
- dependências;
- versões;
- service accounts;
- Deployment Center/TEM;
- configuração esperada versus descoberta.

### WS3 — Collectors Teamcenter

- Server Manager/pool;
- SOA;
- AWC;
- FMS;
- Solr/indexação;
- RAC/TCCS;
- BMIDE/deployment;
- Dispatcher/integrações.

### WS4 — Banco e infraestrutura

- SQL Server;
- disco;
- certificados;
- rede;
- relógio/timezone;
- backup e recovery;
- filas e jobs.

### WS5 — Evidência, rules e drift

- schemas;
- redator;
- persistência;
- rules engine;
- baselines;
- diffs;
- waivers;
- confidence.

### WS6 — Experiência operacional

- playbooks;
- dashboards;
- relatórios;
- evidence bundles;
- histórico;
- integração com chamados.

### WS7 — Qualidade e release

- matriz de compatibilidade;
- fixtures;
- integração em homologação;
- chaos tests;
- pacote assinado;
- rollout canário;
- rollback.

## 10. Fases de implementação

### Fase 0 — decisões, segurança e governança

Objetivo: fechar decisões que afetam todo o programa.

Estado atual: 🟡 os princípios de menor privilégio, negação por padrão,
read-only e actions granulares já estão refletidos no código SOA. Permanecem
pendentes o threat model formal, a matriz RBAC QA/PRD, a classificação de dados,
os owners e os ADRs.

Entregas:

1. threat model QA/PRD;
2. matriz RBAC por action e ambiente;
3. classificação de dados e retenção;
4. catálogo inicial de collectors e checks;
5. regra de uso de APIs Siemens públicas versus `Internal-*`;
6. política de conta técnica por componente;
7. política de TLS, certificados e secret store;
8. critérios para synthetic transaction em QA;
9. owners: PLM, Infra, DBA, Segurança e Service Desk;
10. ADRs para decisions de alto impacto.

Critérios de aceite:

- PRD read-only aprovado por arquitetura e segurança;
- nenhum check sem owner e impacto classificado;
- operações bloqueadas documentadas;
- retenção e redator aprovados;
- ambiente de homologação designado.

### Fase 1 — contratos comuns e EnvironmentProfile

Objetivo: criar a base tipada antes de ampliar collectors.

Estado atual: 🟡 existem schemas estritos para requests SOA, policy local v1 e
envelope Node.js ↔ Java v1. Ainda faltam os contratos transversais de
`EnvironmentProfile`, `Component`, `CheckResult`, `Evidence`, `Finding` e o
Collector SDK. A configuração continua representando um ambiente por processo.

Entregas:

1. schemas versionados para profile, component, check, evidence e finding;
2. registro local de ambientes;
3. validação de configuração na inicialização;
4. identidade imutável do ambiente;
5. separação QA/PRD;
6. contrato do Collector SDK;
7. contrato de budget, timeout, truncamento e partial errors;
8. envelope único de resultados;
9. migração compatível dos checks existentes;
10. testes de schema e migração.

Arquivos/módulos principais:

- `src/config.js`;
- `src/tools.js`;
- novos `src/environments/`, `src/collectors/` e `src/evidence/`;
- `src/zero-trust/task-runner.js`;
- testes unitários e fixtures.

Critérios de aceite:

- um host com várias instalações não seleciona `TC_DATA` incorreto;
- profile inválido impede somente o ambiente afetado;
- nenhum path ou URL arbitrário vem do broker;
- todos os resultados possuem schema e versão;
- compatibilidade com as actions atuais é testada.

### Fase 2 — hardening e confiabilidade do agente

Objetivo: tornar o próprio agente confiável antes de confiar nos diagnósticos.

Estado atual: 🟡 fila limitada, concorrência, rate limit por usuário/action,
timeout, cancelamento, circuit breaker, limite de saída, sanitização e
correlation ID estão implementados para SOA. Serviço Windows dedicado, secret
store, buffer/reconexão, artefatos assinados, SBOM, update/rollback e métricas
operacionais do agente continuam pendentes.

Entregas:

1. serviço Windows com conta dedicada;
2. health e readiness locais;
3. fila limitada e backpressure;
4. concorrência por collector;
5. rate limit por usuário/action/ambiente;
6. timeout, cancelamento e circuit breaker;
7. reconexão com exponential backoff e jitter;
8. buffer local limitado para resultados pendentes;
9. secret store via DPAPI/Windows Credential Manager ou equivalente;
10. pacote, manifest e atualização assinados;
11. rollback automático de atualização;
12. SBOM e hashes dos artefatos;
13. redator central reforçado;
14. self-metrics de CPU, memória, disco, fila e versão.

Critérios de aceite:

- broker indisponível não derruba o agente;
- flooding não cria processos ou sessões ilimitadas;
- segredo não aparece em logs, auditoria ou retorno;
- update inválido é rejeitado;
- falha de collector não derruba outros collectors;
- rollback de versão é demonstrado.

### Fase 3 — inventário e topologia

Objetivo: saber o que está instalado e como os componentes dependem entre si.

Estado atual: ⬜ há checks locais isolados de path, serviço e TCP, mas ainda não
existe descoberta versionada de instalações nem grafo de componentes. Esses
checks não devem ser apresentados como topologia até que origem, confiança e
identidade do ambiente estejam modeladas.

Entregas:

1. descoberta de versões Teamcenter e Java;
2. descoberta de configurações TC_ROOT/TC_DATA sem variável global do sistema;
3. serviços Windows, PID, parent PID, usuário e command line sanitizada;
4. portas e endpoints;
5. Server Manager/pools;
6. WebTier;
7. Gateway, File Repository e microservices;
8. FSC/FCC e volumes conhecidos;
9. SQL Server e banco associado;
10. Solr/FTS;
11. Dispatcher;
12. Deployment Center/TEM;
13. grafo de componentes e dependências;
14. inventário manual complementar para componentes não detectáveis.

Critérios de aceite:

- o ambiente 2606 DEV é representado sem misturar instalações antigas;
- processos órfãos e portas ocupadas têm owner identificado;
- origem de cada observação é registrada;
- componente não confirmado aparece como `unverified`, não como ausente;
- nenhuma credencial é incluída na topologia.

### Fase 4 — collectors essenciais

Objetivo: cobrir os incidentes Teamcenter de maior frequência com mecanismos
read-only e suportados.

Estado atual: 🟡 há uma base funcional para diagnósticos locais, logs, SQL e SOA.
AWC, Server Manager, FMS, Solr e a visão integrada de host ainda não possuem os
collectors completos definidos nesta fase.

#### 4.1 Host e serviços

Estado atual: 🟡 checks allowlisted de serviço, TCP e path já existem. Métricas
de processo, disco, certificado, relógio e ACL associada à service account ainda
precisam ser implementadas como collectors tipados.

- status de serviço;
- processo associado;
- porta;
- uptime e reinícios;
- CPU, memória e handles;
- espaço e latência de disco;
- certificado e expiração;
- sincronização de relógio;
- ACL de path e service account.

#### 4.2 Server Manager e pool

Estado atual: ⬜ logs Teamcenter podem ser lidos de forma confinada, porém não há
collector específico de Server Manager/pool nem métricas de saturação.

- pools configurados;
- total, warm, assigned e processos indisponíveis;
- tempo de criação e falha de tcserver;
- saturação;
- versão;
- erros agregados por código;
- evidência proveniente de mecanismo suportado ou log identificado.

#### 4.3 Teamcenter SOA

Implementar o plano SOA dedicado na ordem:

| Ordem | Action | Estado | Gate restante |
| --- | --- | --- | --- |
| 1 | `teamcenter.soa.preflight` | ✅ código/teste | executar no host Windows com classpath real |
| 2 | `teamcenter.soa.connection_health` | 🟡 | validar login/logout e conta restrita no QA |
| 3 | `teamcenter.soa.session_context` | 🟡 | validar site, group, role, locale e minimização da resposta |
| 4 | `teamcenter.soa.health_bundle` | 🟡 | validar preflight + conexão no mesmo cenário operacional |
| 5 | `teamcenter.soa.preferences.read` | 🟡 | homologar scopes e preferências permitidas |
| 6 | `teamcenter.soa.object.inspect` | 🟡 | homologar tipos, propriedades e partial errors |
| 7 | `teamcenter.soa.encoding_probe` | 🟡 | corrigir o acesso à lista `properties` e validar Unicode ponta a ponta |
| 8 | `teamcenter.soa.saved_query.execute` | 🟡 | homologar query UID fixa, resultado UID-only e limites |
| 9 | `teamcenter.soa.dataset.inspect` | ⛔ | substituir chamada best-effort por API 2606 confirmada |
| 10 | `teamcenter.soa.fms.probe` | ⛔ | confirmar API 2606, download limitado e descarte seguro |

Gates específicos antes de liberar a action em PRD:

1. propagar `code` estável do envelope Java até o resultado/auditoria;
2. validar Java, JARs vazios/corrompidos, classes requeridas e hashes no
   preflight;
3. aplicar de fato o truststore configurado e tornar TLS obrigatório no profile
   PRD;
4. substituir o repasse amplo de variáveis `TC_TEAMCENTER_*` por allowlist
   nominal;
5. definir reload/versionamento seguro da policy, sem ampliar privilégios por
   alteração remota;
6. registrar duração, resultado, truncamento e volume na auditoria;
7. manter Dataset/FMS desabilitados até homologação específica.

#### 4.4 Active Workspace

Estado atual: 🟡 existe diagnóstico opcional via browser e checks locais de
porta/log, mas não há collector próprio para Gateway, File Repository, versão,
rotas ou consistência dos assets.

- Gateway `/ping`;
- owner da porta;
- processo duplicado;
- File Repository e Eureka;
- rotas e endpoints configurados;
- versão/build;
- consistência `site`/`siteDev`;
- assets e módulos duplicados;
- erros agrupados de Gateway/FileRepo;
- browser collector opcional e isolado em QA.

#### 4.5 FMS

Estado atual: ⛔ o adapter contém apenas scaffold defensivo e não confirma a API
Teamcenter 2606. A análise atual continua baseada em arquivo/path/log allowlisted;
ela não substitui topologia FSC/FCC nem um probe FMS suportado.

- topologia FSC;
- IDs, parent FSC e client mapping;
- service account;
- volume lógico versus path físico;
- existência e ACL;
- logs FSC/FCC;
- arquivo canário;
- latência e tamanho;
- diagnóstico local sem retorno de ticket.

#### 4.6 SQL Server

Estado atual: 🟡 `database.diagnostic` já oferece queries fixas para arquivos,
collation/encoding, tipos de colunas de texto, waits, requests ativos sem texto
SQL, queries por hash e fragmentação de índices. Transaction log/VLF, recovery e
backups, CHECKDB, Query Store, estatísticas, uso/redundância de índices, latência
por arquivo, tempdb, configurações de instância, deadlocks e SQL Agent continuam
pendentes.

- encoding/collation;
- transaction log/VLF;
- recovery e backups;
- CHECKDB;
- Query Store;
- estatísticas;
- índices;
- latência de arquivos;
- espaço;
- waits filtrados e contextualizados;
- bloqueios/deadlocks;
- tempdb;
- configurações de instância;
- SQL Agent jobs.

#### 4.7 Solr/indexação

Estado atual: ⬜ não há collector específico de Solr/FTS nesta baseline.

- endpoint e serviço;
- collections/cores;
- idade do índice;
- backlog e falhas;
- FTS Indexer;
- query canária;
- capacidade e espaço;
- versão e certificados.

Critérios de aceite da fase:

- cada collector possui action, schema, policy, budget e versão;
- não há comando genérico;
- checks possuem timeout e truncamento;
- ausência de evidência não gera diagnóstico definitivo;
- os casos Gateway duplicado, encoding e FMS transitório são reproduzíveis por
  fixtures e classificados corretamente.

### Fase 5 — correlação, rules engine e findings

Objetivo: transformar dados coletados em diagnóstico explicável.

Estado atual: ⬜ ainda não há rules engine nem modelo comum de findings. As
mensagens e erros estáveis dos collectors serão entradas desta fase, não um
substituto para ela.

Entregas:

1. catálogo de regras versionadas;
2. DSL simples e não executável para conditions;
3. severidade e confidence calculadas por evidência;
4. distinção `observed`, `inferred` e `unverified`;
5. correlação por UTC, host, componente, PID e correlation ID;
6. agrupamento e deduplicação de logs;
7. supressão de ruído conhecido com justificativa;
8. hipóteses descartadas e checks faltantes;
9. runbook e referência Siemens por finding;
10. testes unitários por regra.

Exemplo conceitual:

```yaml
id: gateway_duplicate_process
version: 1
severity: high
requires:
  - gateway_start_error:EADDRINUSE
  - port_listener:3000
  - new_gateway_process:exited
confidence: high
```

Critérios de aceite:

- finding mostra as evidências que o sustentam;
- regra não executa código arbitrário;
- um erro isolado não vira root cause sem evidência suficiente;
- findings são reproduzíveis com os mesmos inputs;
- regras possuem owner, versão e changelog.

### Fase 6 — baseline, snapshot e drift

Estado atual: ⬜ não implementado.

Objetivo: comparar ambientes e mudanças com contexto.

Entregas:

1. snapshot sanitizado de configuração e saúde;
2. baseline `known-good`;
3. comparação QA × PRD;
4. comparação pré × pós-upgrade;
5. campos comparáveis por collector;
6. diferenças esperadas e waivers;
7. owner e expiração de waiver;
8. classificação de drift;
9. histórico e assinatura/hash do snapshot;
10. relatório de diferenças materialmente relevantes.

Itens mínimos de comparação:

- versões e patches;
- templates BMIDE;
- componentes e service accounts;
- pools e JVM options;
- preferências críticas permitidas;
- Gateway/AWC build;
- FMS topology e volumes;
- Solr/indexação;
- SQL Server;
- certificados;
- integrações e clientes.

Critérios de aceite:

- diferenças intencionais não geram alerta recorrente;
- valores sensíveis não entram no snapshot;
- baseline possui owner e data;
- drift crítico é explicável e rastreável;
- snapshot antigo pode ser lido após atualização de schema suportada.

### Fase 7 — playbooks e usabilidade

Estado atual: ⬜ não implementado. Os diagnósticos atuais são actions isoladas e
ainda não formam playbooks versionados.

Objetivo: permitir diagnóstico por sintoma, não por conhecimento da ferramenta.

Playbooks iniciais:

1. AWC não abre;
2. login falha ou está lento;
3. arquivo não baixa;
4. arquivo não existe no volume;
5. RAC/AWC com caracteres incorretos;
6. item não aparece na busca;
7. pool saturado;
8. Gateway não reinicia;
9. Dispatcher não processa;
10. banco lento ou bloqueado;
11. ambiente pronto para upgrade;
12. o que mudou entre QA e PRD.

Cada playbook deve apresentar:

```text
Resumo
Checks executados
Evidências
Findings e confiança
Hipóteses descartadas
Verificações não realizadas
Impacto
Próximo teste seguro
Runbook/documentação
Declaração de que nenhuma alteração foi feita
```

Entregas de UX:

- visão por ambiente e componente;
- visão por papel: PLM Admin, Infra, DBA e Service Desk;
- timeline correlacionada;
- comparação QA/PRD;
- histórico de findings;
- filtros;
- português e inglês;
- exportação Markdown/JSON/PDF;
- preview de sanitização;
- evidence bundle para suporte;
- integração futura com issue tracker/ITSM.

Critérios de aceite:

- Service Desk executa playbook sem conhecer paths internos;
- o usuário vê o que será coletado antes de operação de maior impacto;
- relatório diferencia fato, inferência e recomendação;
- nenhuma recomendação é executada automaticamente;
- bundle não contém segredo conhecido pelos testes de segurança.

### Fase 8 — synthetic transactions e upgrade readiness

Estado atual: ⬜ não implementado. Nenhum synthetic ou canary deve ser ativado
antes dos budgets, dados canários e aprovação definidos nesta fase.

Objetivo: validar fluxos reais sem colocar PRD em risco.

#### 8.1 QA synthetic transaction

Fluxo read-only inicial:

1. conexão/login SOA;
2. query de item canário;
3. propriedades com caracteres especiais;
4. Dataset/named reference;
5. download de arquivo pequeno;
6. query Solr canária;
7. Gateway ping;
8. logout.

Uma futura synthetic transaction com escrita deve:

- ser outro módulo;
- funcionar somente em QA;
- usar conta, projeto, pasta, volume e objetos exclusivos;
- exigir aprovação explícita;
- possuir cleanup e verificação de resíduo;
- permanecer desabilitada por padrão.

#### 8.2 PRD canary

- objetos preexistentes;
- somente leitura;
- baixa frequência;
- arquivo pequeno;
- nenhum conteúdo retornado;
- interrupção automática sob pressão.

#### 8.3 Upgrade readiness

- inventário e baseline pré-upgrade;
- backup/recovery e CHECKDB;
- espaço em disco;
- FMS e volumes;
- filas e workflows pendentes;
- templates e customizações;
- clientes e integrações;
- prerequisite diagnostics suportados pelo TEM;
- comparação QA atualizado × PRD;
- smoke tests pós-upgrade;
- evidence bundle de aceite.

Critérios de aceite:

- transação QA detecta falha em cada dependência simulada;
- PRD não realiza escrita;
- teste FMS não expõe ticket ou conteúdo;
- readiness referencia evidências e checks suportados;
- gate de promoção lista diferenças e riscos pendentes.

### Fase 9 — piloto PRD e rollout

Estado atual: ⬜ não iniciado. A baseline atual permanece adequada a
desenvolvimento/QA controlado, não a liberação geral em PRD.

Objetivo: introduzir o agente em produção de forma controlada.

Etapas:

1. concluir QA com carga representativa;
2. revisar threat model e pentest;
3. instalar agente canário em PRD com collectors mínimos;
4. habilitar somente inventory, health e logs resumidos;
5. medir overhead e falsos positivos;
6. habilitar SOA health;
7. habilitar SQL checks aprovados;
8. habilitar FMS canary;
9. habilitar baseline/drift;
10. habilitar playbooks;
11. revisar operação após cada gate;
12. manter rollback e kill switch por collector.

Critérios de aceite:

- overhead do agente dentro do orçamento aprovado;
- nenhum incidente causado pelo agente;
- nenhum segredo detectado nos bundles;
- findings úteis e taxa de falso positivo aceitável;
- auditoria completa;
- runbooks e owners definidos;
- rollback exercitado.

## 11. Catálogo inicial de actions

### Core

```text
agent.health
agent.inventory
environment.discover
environment.topology
environment.snapshot
environment.compare
playbook.run
evidence.bundle.create
```

### Teamcenter

Actions SOA presentes na baseline, sujeitas às flags granulares e à policy local:

```text
teamcenter.soa.preflight
teamcenter.soa.connection_health
teamcenter.soa.session_context
teamcenter.soa.health_bundle
teamcenter.soa.preferences.read
teamcenter.soa.encoding_probe
teamcenter.soa.object.inspect
teamcenter.soa.saved_query.execute
teamcenter.soa.dataset.inspect
teamcenter.soa.fms.probe
```

`dataset.inspect` e `fms.probe` permanecem desabilitadas por padrão e bloqueadas
para uso operacional até homologação. Para compatibilidade, o MCP local ainda
pode expor `tc_soa_read` com um campo `action`; quando capabilities são
obrigatórias, a autorização e o handler são registrados por action granular.
O multiplexador não autoriza método, serviço, query ou propriedade arbitrária.

Actions Teamcenter planejadas:

```text
teamcenter.server_manager.health
teamcenter.pool.health
teamcenter.awc.gateway_health
teamcenter.awc.static_assets_health
teamcenter.fms.topology
teamcenter.fms.file_probe
teamcenter.solr.health
teamcenter.dispatcher.health
teamcenter.logs.read
```

### Infraestrutura

```text
host.service.health
host.process.inspect
host.port.inspect
host.path.inspect
host.acl.inspect
host.disk.health
host.certificate.health
host.clock.health
database.diagnostic
```

Cada action deve possuir schema próprio. Não substituir o catálogo por actions
genéricas com um campo `command`, `service`, `method` ou `sql`.

## 12. Estratégia de testes

Baseline em 2026-09-01: `bun test` executa 52 testes em 14 arquivos, todos
passando. Esse resultado é o gate de regressão local; o aceite de uma action SOA
exige também build do adapter no Windows e execução contra Teamcenter 2606 QA.

Uma capacidade somente muda de 🟡 para ✅ operacional quando passar, na ordem:

1. teste unitário/schema;
2. contrato Node.js ↔ Java;
3. build com os JARs reais e preflight no host Windows;
4. integração com conta técnica restrita no QA;
5. cenários positivo, negativo, timeout, partial error e truncamento;
6. revisão de dados retornados e auditoria;
7. aprovação do budget e da policy PRD, quando aplicável.

### 12.1 Unitários

- schemas;
- profiles;
- policies;
- redator;
- budgets;
- rules;
- snapshot/diff;
- DTOs;
- truncamento;
- locale/encoding;
- path normalization;
- capabilities.

### 12.2 Contrato

- broker ↔ agent;
- agent ↔ collector;
- Node.js ↔ Java SOA;
- versão anterior ↔ schema novo;
- relatório ↔ evidence bundle;
- policy ↔ action.

### 12.3 Integração local

- executáveis e serviços falsos;
- Java adapter falso;
- SQL fixture;
- logs Teamcenter anonimizados;
- Gateway/FMS/Solr stubs;
- stdout fragmentado;
- timeout e cancelamento;
- disco cheio e permissão negada.

### 12.4 Homologação Teamcenter

- Teamcenter 2606 com conta restrita;
- AWC;
- RAC/TCCS;
- FMS;
- SQL Server;
- Solr;
- Dispatcher;
- item e Dataset canários;
- caracteres especiais;
- cenário pré/pós-upgrade.

### 12.5 Segurança

- capability inválida, expirada e replay;
- action não autorizada;
- profile trocado;
- path traversal;
- query/property/preference fora da allowlist;
- segredo em stdout/stderr/log;
- ticket FMS;
- flooding;
- JAR adulterado;
- update inválido;
- broker comprometido tentando ampliar escopo.

### 12.6 Resiliência

- broker offline;
- WebTier offline;
- pool cheio;
- SQL timeout;
- FSC offline;
- volume indisponível;
- Gateway duplicado;
- agent restart durante tarefa;
- relógio incorreto;
- fila cheia;
- collector travado.

### 12.7 Performance

- custo idle;
- custo por check;
- concorrência máxima;
- tamanho de bundle;
- impacto de query;
- impacto no pool;
- latência QA e PRD;
- comportamento sob backpressure.

## 13. Observabilidade e SLOs

Métricas mínimas:

- agentes conectados/desconectados;
- agent version/policy version;
- checks iniciados/concluídos/falhos;
- duração por check;
- fila e saturação;
- bytes coletados e retornados;
- truncamentos;
- partial errors;
- findings por severidade;
- falsos positivos confirmados;
- falhas de redator;
- updates e rollbacks;
- uso de CPU, memória e disco do agente.

SLOs devem ser definidos após o piloto, incluindo:

- disponibilidade do agente;
- tempo de entrega de diagnóstico básico;
- overhead máximo em PRD;
- tempo de reconexão;
- taxa aceitável de falha de coleta;
- retenção e tempo de geração do evidence bundle.

Logs do agente devem ser estruturados, rotacionados e livres de conteúdo de
negócio por padrão.

## 14. Segurança e privacidade

Controles obrigatórios:

- mTLS por agente;
- OIDC/MFA no console;
- RBAC por organização, ambiente, action e perfil;
- capability curta e de uso único;
- policy local assinada;
- secret store local;
- conta de serviço mínima;
- resultado sanitizado;
- criptografia em trânsito e em repouso;
- retenção por classe;
- audit log local e central;
- code signing;
- SBOM;
- revogação de agente/certificado;
- rotação de segredo;
- approval para operações de maior impacto;
- preview antes de exportar bundle.

Dados brutos permanecem locais por padrão. O broker recebe resumos e evidências
reduzidas, salvo autorização explícita.

## 15. Riscos e mitigação

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| Agente sobrecarrega PRD | Alto | Budgets, fila, rate limit, circuit breaker |
| Conta técnica expõe dados | Alto | ACL mínima, profiles e metadados-first |
| Falso diagnóstico | Alto | Evidence refs, confidence e `unverified` |
| Incompatibilidade de release | Alto | Collectors versionados e matriz de teste |
| Vazamento em logs/bundle | Alto | Redator central, testes e preview |
| SOA/query cara | Alto | Allowlist, limite, timeout e agendamento |
| Processos/JARs incompatíveis | Médio | Preflight, manifest, hash e self-test |
| `encoding_probe` diverge do DTO de propriedades | Alto | Corrigir estrutura, criar teste Java/contrato e validar caracteres canários |
| Truststore configurado mas não aplicado ao Java | Alto | Passar propriedade JVM de forma controlada e validar cadeia TLS no preflight |
| Scaffold Dataset/FMS interpretado como collector pronto | Alto | Manter flags desligadas e exigir API 2606 homologada antes da liberação |
| Policy alterada sem rastreabilidade | Alto | Hash/versão, distribuição assinada, auditoria e reload controlado |
| Defaults amplos ativam mais actions que o esperado | Alto | Flags explícitas por ambiente e default PRD somente preflight/health |
| Drift esperado gera ruído | Médio | Waiver com owner e expiração |
| IA inventa procedimento | Alto | Rules determinísticas e docs aprovadas |
| Broker indisponível | Médio | Buffer local e reconexão |
| Atualização quebra agente | Alto | Pacote assinado, canário e rollback |
| Confusão QA/PRD | Alto | Environment ID imutável e policy separada |

## 16. Marcos de entrega

### M0 — arquitetura aprovada

Estado: 🟡 em andamento.

- Fase 0 concluída;
- threat model e RBAC aprovados;
- environment QA designado.

### M1 — foundation segura

Estado: 🟡 núcleo SOA parcial; foundation transversal pendente.

- Fases 1 e 2 concluídas;
- agent health, profiles, contracts e hardening disponíveis;
- nenhuma capacidade nova ampla liberada.

### M2 — diagnóstico essencial QA

Estado: ⬜ não atingido.

- Fases 3 e 4 concluídas para host, pool, SOA, AWC, FMS e SQL;
- topologia e health bundle funcionais.

### M3 — diagnóstico explicável

Estado: ⬜ não iniciado.

- Fase 5 concluída;
- rules e findings com evidências;
- incidentes conhecidos cobertos por fixtures.

### M4 — comparação e operação

Estado: ⬜ não iniciado.

- Fases 6 e 7 concluídas;
- QA/PRD diff, playbooks e evidence bundle.

### M5 — readiness e piloto PRD

Estado: ⬜ não iniciado.

- Fases 8 e 9 concluídas;
- canary read-only, upgrade readiness e rollout controlado.

## 17. Critérios globais de conclusão

O programa estará concluído quando:

1. QA e PRD possuírem profiles e policies independentes;
2. o agente identificar corretamente ambientes coexistentes;
3. os componentes formarem uma topologia com dependências;
4. todos os collectors forem versionados e allowlisted;
5. todo resultado tiver schema, timestamp, duração e evidence refs;
6. findings diferenciarem observado, inferido e não validado;
7. nenhuma capability aceitar shell, SQL ou SOA arbitrários;
8. nenhuma escrita for possível no perfil PRD;
9. segredos e tickets forem bloqueados por testes automatizados;
10. carga, frequência, duração e volume forem limitados;
11. baselines e drift suportarem QA × PRD e pré × pós-upgrade;
12. playbooks cobrirem os incidentes prioritários;
13. evidence bundles forem sanitizados e assinados;
14. synthetic transaction QA e canary PRD forem aprovados;
15. matriz Teamcenter/Java/SQL/AWC estiver documentada;
16. auditoria, observabilidade, runbooks e rollback estiverem disponíveis;
17. o agente operar em PRD dentro do orçamento aprovado;
18. nenhuma regressão for observada em AWC, RAC, FMS, pool, banco ou Solr.

## 18. Próximos passos imediatos

1. corrigir `encodingProbe`: `loadObjectAndProperties` retorna uma lista de
   propriedades, mas o probe atualmente a trata como mapa; adicionar teste de
   contrato e validar `Ação revisão : çãéíóú - Teste` no QA;
2. fazer o build do adapter no host Windows e executar preflight, connection
   health, session context, preferences, object inspect e saved query contra o
   Teamcenter 2606 com conta restrita;
3. propagar códigos estáveis do adapter, duração, volume, partial errors e
   truncamento até a auditoria;
4. reforçar o preflight com Java executável, JAR vazio/corrompido, classes
   requeridas, duplicidade/versão e hash do adapter/classpath;
5. aplicar o truststore configurado, exigir TLS em PRD e trocar o repasse
   `TC_TEAMCENTER_*` por allowlist nominal;
6. revisar defaults: PRD inicia somente com preflight/health; preferences,
   objects e queries exigem flags e profile explícitos; Dataset/FMS permanecem
   desligados;
7. versionar e distribuir policies QA/PRD com hash, owner, rollback e auditoria;
8. criar ADRs e schemas de `EnvironmentProfile`, `CheckResult`, Collector SDK,
   Evidence Model e rules engine;
9. completar o collector SQL conforme o plano DBA, priorizando transaction log,
   backups, CHECKDB, Query Store, estatísticas e latência de arquivos;
10. selecionar os cinco playbooks do MVP, preparar dados canários e definir o
    orçamento operacional de PRD;
11. revisar o backlog anterior e decompor as Fases 1–4 em issues independentes;
12. executar revisão conjunta PLM, Infra, DBA e Segurança antes de qualquer
    piloto PRD.

## 19. Sequência recomendada

```text
Governança e threat model
  → profiles e contratos
  → hardening do agente
  → inventário e topologia
  → collectors essenciais
  → correlação e rules
  → baseline e drift
  → playbooks e bundles
  → synthetic/readiness
  → piloto PRD e rollout
```

Essa ordem evita que usabilidade aparente seja construída sobre diagnósticos
sem evidência, autorização insuficiente ou collectors capazes de afetar PRD.
