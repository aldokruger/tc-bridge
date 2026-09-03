# Plano de implementação — documentação assistida para diagnóstico e engenharia Teamcenter

Status: implementado

Escopo inicial: Teamcenter 2606, com compatibilidade documental explícita por release

Data: 2026-09-02

Baseline analisada: workspace atual do `tc-bridge`

Legenda:

- ✅ implementado e coberto por teste;
- 🟡 existente parcialmente ou dependente de integração;
- ⬜ planejado;
- ⛔ bloqueado por segurança, versão ou decisão.

## 1. Objetivo

Adicionar ao `tc-bridge` uma camada de conhecimento Teamcenter capaz de combinar
documentação Siemens, evidências do ambiente e conhecimento validado do projeto
para:

- explicar e diagnosticar problemas;
- auxiliar a criação de Saved Queries e consultas suportadas;
- auxiliar o desenho e a validação de workflows;
- auxiliar customizações BMIDE, ITK, SOA e Active Workspace;
- gerar artefatos em modo rascunho, com fontes e validações explícitas;
- impedir que conteúdo gerado seja tratado como suportado quando a versão ou a
  fonte não puder ser confirmada.

O fluxo alvo é:

```text
Intenção → Contexto da release → Recuperação documental → Evidências do ambiente
        → Geração de rascunho → Validação → Revisão humana → Exportação
```

Este plano amplia o uso atual da LLM. A LLM continua sendo uma camada de
orquestração e explicação; documentação, schemas, policies e validadores são as
fontes de autoridade.

## 2. Estado atual e ponto de integração

O projeto já possui:

- chat OpenAI-compatible com chamada de tools em
  `src/zero-trust/llm-chat.js`;
- actions granulares, capabilities assinadas e execução deny-by-default;
- collectors read-only para logs, host, SQL Server, navegador e SOA;
- `EnvironmentProfile`, `CheckResult`, `Evidence` e `Finding` como contratos em
  `src/environments/schemas.js`;
- leitura parcial do modelo BMIDE em `src/bmide-reader.js`;
- policy SOA local para propriedades, queries e objetos autorizados;
- gateway documental interno acessível por MCP.

Na inspeção de 2026-09-02, o gateway documental apresentou:

| Domínio      | Documentos | Trechos indexados | Formatos              |
| ------------ | ---------: | ----------------: | --------------------- |
| `teamcenter` |         19 |            12.812 | PDF, Markdown e texto |
| `tc2606`     |         12 |             4.048 | Markdown              |

A busca encontrou conteúdo de Query Builder, Workflow Handlers e customização
ITK/BMIDE. Alguns resultados, porém, vieram sem arquivo, seção ou página. A
primeira entrega deve corrigir ou contornar essa lacuna: geração assistida exige
proveniência verificável.

### 2.1 Lacuna arquitetural

Atualmente, todas as tools apresentadas ao chat derivam de `allowedActions` e
são despachadas ao agente Windows por capability. Busca documental e geração de
rascunhos pertencem ao broker, não ao agente. Antes de adicionar as novas
capacidades, o chat precisa distinguir:

- **tools locais do broker**: documentação, geração e validação de rascunhos;
- **actions remotas do agente**: coleta de evidência no ambiente Teamcenter.

Essa separação evita criar capabilities remotas para operações que não precisam
acessar o host Teamcenter.

## 3. Escopo funcional

### 3.1 Diagnóstico assistido

- correlacionar mensagens de logs, status de serviços, resultados SOA, banco,
  FMS, Solr e AWC;
- localizar procedimentos aplicáveis à release;
- apresentar hipóteses como `observed`, `inferred` ou `unverified`;
- informar evidências presentes, hipóteses excluídas e checks ainda necessários;
- sempre devolver referências documentais rastreáveis.

### 3.2 Consultas Teamcenter

O tipo de consulta deve ser obrigatório para eliminar ambiguidade:

| `queryKind`       | Uso                              | Resultado inicial                       |
| ----------------- | -------------------------------- | --------------------------------------- |
| `saved-query`     | Query Builder/POM                | especificação e passos de criação       |
| `soa-saved-query` | consumo de Saved Query por SOA   | request validado contra policy          |
| `rest-query`      | endpoint suportado na release    | exemplo de request e contrato           |
| `sql-diagnostic`  | análise administrativa read-only | rascunho SQL, nunca execução arbitrária |

Para Saved Queries, o assistente deve considerar o schema POM/BMIDE do ambiente,
tipo raiz, propriedades pesquisáveis, nomes de entrada, cardinalidade esperada e
controle de acesso. O resultado nunca deve supor que uma propriedade existe sem
evidência do modelo ou documentação.

Para SQL, o sistema deve deixar explícito que consultas diretas ao banco não são
substituto para APIs de negócio Teamcenter. A primeira versão apenas gera e
valida offline consultas `SELECT`; não as envia ao collector atual, que continua
aceitando somente checks predefinidos.

### 3.3 Workflows

- transformar requisitos em uma representação de tarefas e transições;
- recomendar handlers OOTB compatíveis com a release;
- validar action handlers, rule handlers, argumentos, ordem e anexos esperados;
- identificar quando um handler customizado é realmente necessário;
- gerar especificação revisável e, futuramente, artefato de importação;
- comparar um workflow existente com a intenção e com regras documentadas.

O primeiro release não importa, publica, altera ou executa templates de workflow.

### 3.4 Customizações

Categorias suportadas progressivamente:

| Categoria        | Assistência prevista                                                   |
| ---------------- | ---------------------------------------------------------------------- |
| BMIDE            | tipos, propriedades, LOVs, naming rules, operações e impacto de deploy |
| ITK C/C++        | seleção de módulos/funções, handler skeleton, build e compatibilidade  |
| SOA custom       | contrato, namespace, operação, payload e esqueleto de implementação    |
| Active Workspace | commands, declarative UI, XRT/View Model e localização                 |
| Workflow custom  | rule/action handlers, argumentos e registro                            |
| Integrações      | preferência, mapping e pontos de extensão documentados                 |

Todo artefato gerado deve usar prefixo de namespace configurado, declarar release
alvo, dependências, limitações e fontes. Código gerado só alcança o estado
`validated` após verificações estáticas e, quando aplicável, compilação em
ambiente controlado.

## 4. Fora de escopo inicial

- aplicar deploy BMIDE;
- importar ou publicar workflow;
- compilar diretamente no servidor PRD;
- executar SQL arbitrário;
- criar ou alterar objetos Teamcenter em PRD;
- alterar preferences, ACLs ou configurações;
- copiar integralmente documentação Siemens para o repositório;
- usar resposta da LLM sem referência como procedimento suportado;
- gerar código para APIs `Internal-*` sem policy e homologação específicas.

Aplicação e deploy exigirão um plano separado, aprovação explícita, rollback e
controles diferentes dos módulos de consulta e geração.

## 5. Princípios

1. **Release first.** Nenhuma recomendação técnica sem release alvo conhecida.
2. **Source first.** Afirmações suportadas apontam para documento, seção/página
   ou trecho identificável.
3. **Evidence first.** Diagnósticos apontam para evidências observadas.
4. **Draft by default.** Todo conteúdo gerado nasce como rascunho.
5. **Read-only por construção.** Geração não implica aplicação.
6. **Deny-by-default.** Domínios, ferramentas, tipos de artefato e ações são
   allowlisted.
7. **Validação determinística.** A LLM propõe; schemas e validadores decidem se
   o formato e as restrições são válidos.
8. **Mínimo contexto necessário.** Somente trechos relevantes seguem ao modelo.
9. **Separação de autoridades.** Siemens é autoridade documental; modelo do
   ambiente é autoridade estrutural; qmd é memória não normativa.
10. **Sem falsa compatibilidade.** Divergência de release reduz a confiança ou
    bloqueia a geração.

## 6. Fontes de conhecimento

### 6.1 Hierarquia de autoridade

| Prioridade | Fonte                                       | Uso                                                      |
| ---------: | ------------------------------------------- | -------------------------------------------------------- |
|          1 | Documentação Siemens da release alvo        | procedimentos, sintaxe e compatibilidade                 |
|          2 | Schema observado do ambiente                | tipos, propriedades, LOVs, handlers e configuração reais |
|          3 | Policies e catálogos versionados do projeto | limites permitidos e padrões aprovados                   |
|          4 | Casos internos revisados                    | exemplos homologados e decisões locais                   |
|          5 | qmd                                         | aprendizados e histórico; nunca autoridade isolada       |

Se fontes de maior prioridade divergirem de exemplos locais, a resposta deve
expor a divergência e não mesclar silenciosamente os conteúdos.

### 6.2 Uso do gateway documental

O adapter do gateway utilizará, no mínimo:

- busca híbrida para conceitos e procedimentos;
- busca especializada de código para símbolos e exemplos;
- recuperação de trecho com contexto;
- resumo de arquivo somente para orientação inicial.

Requisitos obrigatórios para cada resultado aceito:

```text
source_id
domain
release ou releases aplicáveis
source_file
section ou page_or_line
chunk_id
content_hash
retrieved_at
```

Resultados sem `source_file` e localização são classificados como
`unverified_source`. Eles podem sugerir uma nova busca, mas não podem sustentar
um rascunho marcado como validado.

### 6.3 Uso do qmd

O qmd permanece como memória de engenharia do projeto para decisões, soluções de
incidentes e padrões internos. Ele não deve ser o armazenamento primário da
documentação Siemens nem uma dependência obrigatória do runtime do broker.

Casos confirmados podem ser registrados no qmd depois da resolução. Para uso em
runtime, um caso precisa ser promovido por revisão para o catálogo versionado do
repositório.

### 6.4 Catálogo local versionado

Usar JSON para registros processados pelo runtime e Markdown para conteúdo
humano. Isso evita introduzir um parser YAML apenas para esta capacidade.

```text
knowledge/
  catalog/
    diagnostic-patterns/
    query-patterns/
    workflow-patterns/
    customization-patterns/
  runbooks/
  examples/
    queries/
    workflows/
    bmide/
    itk/
    soa/
    awc/
  schemas/
  README.md
```

O diretório `knowledge/` deverá ser incluído no pacote publicado somente quando
o runtime começar a consumi-lo.

## 7. Arquitetura alvo

```text
Console / cliente MCP
        │
        ▼
ChatToolRegistry
  ├─ AgentActionAdapter ── capability ── tc-agent ── collectors/evidências
  └─ EngineeringAssistant
       ├─ KnowledgeRetriever
       │    ├─ SiemensDocsGatewayAdapter
       │    ├─ LocalCatalogAdapter
       │    └─ QmdAdapter opcional
       ├─ ContextAssembler
       ├─ ArtifactGenerator
       ├─ ArtifactValidators
       └─ ProvenanceGuard
                │
                ▼
       Draft → Validated → Approved → Exported
```

### 7.1 Seam do chat

Criar um registro de tools que esconda a diferença entre execução local e
remota. Interface proposta:

```js
toolRegistry.list({ allowedAgentActions, allowedLocalTools });
toolRegistry.execute({ name, arguments, executionContext });
```

`execute` resolve internamente o adapter correto. O chamador não conhece
capabilities, transporte MCP nem gateway documental. Testes usam adapters em
memória pela mesma interface.

### 7.2 Módulo de recuperação

Interface proposta:

```js
knowledgeRetriever.search({
  query,
  release,
  domains,
  artifactKind,
  languages,
  limit,
});
```

O módulo executa busca, remove duplicatas, aplica filtro de release, normaliza
referências e calcula qualidade da proveniência. O chamador recebe uma forma
única independentemente da fonte.

### 7.3 Módulo de engenharia assistida

Interface proposta:

```js
engineeringAssistant.draft(request);
engineeringAssistant.validate(draft);
```

`draft` recupera contexto e produz um `ArtifactDraft`. `validate` é
determinístico onde possível e não exige que o chamador conheça validadores por
categoria.

## 8. Tools expostas à LLM

Manter uma superfície pequena:

### 8.1 `tc_documentation_search`

```json
{
  "query": "como validar argumentos de um action handler",
  "release": "2606",
  "artifact_kind": "workflow",
  "domains": ["teamcenter", "tc2606"],
  "top_k": 6
}
```

Somente leitura. Retorna trechos normalizados, qualidade da fonte e referências.

### 8.2 `tc_artifact_draft`

```json
{
  "artifact_kind": "saved-query",
  "release": "2606",
  "requirements": "Localizar revisões liberadas por projeto e data",
  "environment_id": "tc2606-dev",
  "constraints": {
    "namespace_prefix": "acme",
    "max_results": 200
  }
}
```

Gera somente `ArtifactDraft`; não executa nem instala.

### 8.3 `tc_artifact_validate`

```json
{
  "draft_id": "draft-...",
  "validation_profile": "qa-standard"
}
```

Valida schema, referências, release, policy, propriedades, handlers, funções e
restrições específicas do tipo.

As mesmas tools podem ser expostas pelo console e pela API MCP do broker. Elas
usam autorização própria e não entram em `TC_BROKER_ALLOWED_ACTIONS`, reservado
para actions enviadas ao agente.

## 9. Contratos

### 9.1 `SourceReference`

```text
source_ref_id
authority: siemens | environment | project | qmd
domain
release
source_file
section
page_or_line
chunk_id
content_hash
retrieved_at
verification_status: verified | version_mismatch | incomplete | unavailable
```

### 9.2 `KnowledgeExcerpt`

```text
excerpt_id
text
language
topics
source_ref
relevance_score
provenance_score
```

### 9.3 `ArtifactDraft`

```text
draft_id
schema_version
artifact_kind
target_release
environment_id
status: draft | validated | rejected | approved | exported
requirements
content
assumptions
source_refs
environment_evidence_refs
validation_findings
created_at
expires_at
```

### 9.4 `ValidationFinding`

```text
code
severity: info | warning | error | blocker
message
location
source_refs
suggested_change
```

Schemas Zod estritos devem rejeitar campos desconhecidos, texto excessivo,
release inválida e referências incompletas quando o perfil exige proveniência.

## 10. Pipelines por caso de uso

### 10.1 Diagnóstico

```text
Sintoma
  → identificar ambiente/release/componente
  → coletar evidências read-only autorizadas
  → extrair códigos e assinaturas
  → buscar documentação da mesma release
  → correlacionar evidência + documentação
  → produzir Finding com fontes e próximo check
```

Nenhuma hipótese passa a `observed` apenas porque apareceu na documentação.

### 10.2 Saved Query

```text
Requisito funcional
  → escolher queryKind
  → recuperar regras do Query Builder para a release
  → obter tipo/propriedades do BMIDE ou schema observado
  → montar especificação
  → validar tipos, propriedades, operadores e cardinalidade
  → gerar passos de criação/exportação e casos de teste
```

O MVP gera uma especificação, não XML de importação. XML só entra depois de
existirem exemplos oficiais e round-trip de exportação/importação em QA.

### 10.3 Workflow

```text
Requisito de processo
  → modelar estados, tarefas, responsáveis e decisões
  → buscar handlers documentados
  → validar argumentos e anexos
  → gerar grafo + especificação de template
  → validar caminhos, loops, condições e saída
  → revisão humana
```

O grafo intermediário deve ser independente do formato de importação. Isso
permite validar lógica antes de gerar um artefato específico da release.

### 10.4 Customização

```text
Requisito
  → classificar BMIDE/ITK/SOA/AWC/workflow/integration
  → localizar mecanismo suportado mais simples
  → recuperar símbolos e exemplos da release
  → aplicar namespace e convenções do projeto
  → gerar estrutura e testes
  → validar APIs, build e compatibilidade
  → exportar pacote de revisão
```

O assistente deve recomendar configuração OOTB quando ela eliminar a necessidade
de código customizado.

## 11. Validações específicas

### 11.1 Consultas

- tipo e propriedade existem no modelo observado;
- propriedade é pesquisável no mecanismo escolhido;
- operadores são compatíveis com o tipo;
- limite de resultados está definido;
- Saved Query SOA usa UID allowlisted pela policy;
- SQL começa com `SELECT`/CTE, contém uma única instrução e não possui tokens de
  escrita, execução, DDL ou hints proibidos;
- SQL gerado nunca é encaminhado automaticamente ao banco.

### 11.2 Workflows

- todos os nós são alcançáveis;
- há caminho terminal válido;
- decisões possuem saídas completas;
- handlers existem na release/documentação ou no catálogo customizado aprovado;
- argumentos obrigatórios, cardinalidade e anexos estão presentes;
- handler customizado informa biblioteca, função de registro e namespace;
- operações de privilégio ou proteção recebem alerta elevado.

### 11.3 Customizações

- prefixo de namespace obrigatório;
- função/classe/API existe na release alvo;
- APIs internas são bloqueadas por padrão;
- dependências e toolchain são declarados;
- BMIDE declara impacto em template/deploy;
- ITK inclui tratamento de erros e liberação de recursos;
- SOA declara contrato e partial errors;
- AWC declara módulo, locale e compatibilidade;
- testes ou estratégia de verificação acompanham o rascunho.

## 12. Segurança e governança

### 12.1 Classes de capacidade

| Classe     | Exemplos                    | Comportamento                 |
| ---------- | --------------------------- | ----------------------------- |
| `read`     | pesquisar documentação      | automático se allowlisted     |
| `draft`    | gerar query/workflow/código | cria artefato temporário      |
| `validate` | validar rascunho            | automático e sem side effects |
| `export`   | gravar pacote no staging    | requer solicitação explícita  |
| `apply`    | deploy/import/alteração     | fora de escopo                |

### 12.2 Controles

- allowlist separada para tools locais;
- timeout, tamanho máximo, quantidade de trechos e rodadas limitados;
- credenciais do gateway nunca entram em prompt, log ou artefato;
- sanitização antes de enviar evidências à LLM;
- prompt injection em documentos tratada como conteúdo, nunca instrução;
- hash de trechos e artefatos para auditoria;
- retenção curta de rascunhos por padrão;
- auditoria registra fonte, release, modelo, validações e usuário;
- exportação não implica aprovação nem aplicação.

## 13. Estrutura de código proposta

```text
src/
  chat-tools/
    registry.js
    agent-action-adapter.js
    local-tool-adapter.js
  knowledge/
    schemas.js
    retriever.js
    provenance.js
    context-assembler.js
    adapters/
      siemens-docs-gateway.js
      local-catalog.js
      qmd.js
  engineering/
    schemas.js
    assistant.js
    draft-store.js
    generators/
      saved-query.js
      workflow.js
      bmide.js
      itk.js
      soa.js
      awc.js
    validators/
      common.js
      saved-query.js
      workflow.js
      customization.js
  zero-trust/
    llm-chat.js
    cloud-mcp.js
knowledge/
  catalog/
  runbooks/
  examples/
  schemas/
test/
  chat-tool-registry.test.js
  knowledge-retriever.test.js
  knowledge-provenance.test.js
  engineering-assistant.test.js
  saved-query-assistant.test.js
  workflow-assistant.test.js
  customization-assistant.test.js
```

A estrutura é alvo, não autorização para criar todos os módulos de uma vez.
Cada fase adiciona somente os diretórios necessários ao slice entregue.

## 14. Configuração proposta

```text
TC_DOCS_MCP_URL
TC_DOCS_MCP_TOKEN
TC_DOCS_ALLOWED_DOMAINS=teamcenter,tc2606
TC_DOCS_REQUIRE_ATTRIBUTION=1
TC_DOCS_TIMEOUT_MS=10000
TC_DOCS_MAX_RESULTS=8
TC_BROKER_ALLOWED_LOCAL_TOOLS=tc_documentation_search,tc_artifact_draft,tc_artifact_validate
TC_ENGINEERING_DRAFT_DIR
TC_ENGINEERING_DRAFT_TTL_SECONDS
TC_CUSTOM_NAMESPACE_PREFIX
TC_QMD_KNOWLEDGE_ENABLED=0
```

Tokens e paths protegidos usam o sistema de secrets/configuração existente e
não aparecem no `EnvironmentProfile` enviado ao broker.

## 15. Plano incremental

### Fase 0 — decisões e spike documental

Objetivo: provar proveniência e compatibilidade antes de gerar artefatos.

- ✅ documentar matriz de releases e domínios;
- ✅ verificar recuperação de `source_file`, seção/página e `chunk_id`;
- ✅ definir comportamento quando documentação 2412 é encontrada para alvo 2606;
- ✅ validar limites de licença e retenção de trechos;
- ✅ escolher autenticação e timeout do gateway;
- ✅ criar conjunto ouro com perguntas de diagnóstico, query, workflow e ITK.

Gate: 100% dos trechos do conjunto ouro possuem referência recuperável; caso
contrário, o gateway ou adapter deve ser corrigido antes da Fase 3.

### Fase 1 — contratos e registro de tools

Objetivo: separar tools locais das actions remotas sem alterar comportamento.

- ✅ criar `ChatToolRegistry` e adapters em memória;
- ✅ migrar schemas atuais de tools mantendo nomes e payloads;
- ✅ preservar capability para actions remotas;
- ✅ adicionar allowlist de tools locais;
- ✅ testar roteamento, bloqueio e erros;
- ✅ registrar ADR da separação local/remota.

Gate: todos os testes atuais de chat e capabilities continuam passando.

### Fase 2 — recuperação documental

Objetivo: expor pesquisa Siemens normalizada e auditável.

- ✅ implementar schemas `SourceReference` e `KnowledgeExcerpt`;
- ✅ implementar `SiemensDocsGatewayAdapter`;
- ✅ implementar deduplicação, filtro de release e provenance score;
- ✅ adicionar cache curto por hash da consulta;
- ✅ expor `tc_documentation_search` ao chat e MCP do broker;
- ✅ adicionar métricas, timeout e circuit breaker;
- ✅ criar fake adapter para testes sem gateway.

Gate: respostas documentais mostram release e fonte; falha do gateway produz
erro explícito e nunca conteúdo inventado.

### Fase 3 — contexto e diagnóstico assistido

Objetivo: correlacionar documentação com Evidence/Finding existentes.

- ✅ implementar `ContextAssembler` com orçamento de tokens/caracteres;
- ✅ extrair assinaturas de erro sem enviar segredos;
- ✅ vincular trechos a `Evidence` e `Finding`;
- ✅ diferenciar observado, inferido e não verificado;
- ✅ criar playbooks iniciais para SOA, FMS, Solr, AWC e banco;
- ✅ testar contradição entre documentação e evidência.

Gate: todo diagnóstico gerado contém evidência ou declara exatamente o que falta.

### Fase 4 — assistente de Saved Query

Objetivo: gerar especificações de query validáveis.

- ✅ implementar `ArtifactDraft` e armazenamento temporário;
- ✅ adicionar `queryKind` e schema de requisitos;
- ✅ enriquecer o leitor BMIDE para tipos/propriedades pesquisáveis necessários;
- ✅ gerar especificação de Saved Query com entradas e casos de teste;
- ✅ gerar request de execução SOA somente para UID já allowlisted;
- ✅ adicionar validador read-only de SQL offline;
- ✅ criar exemplos ouro positivos e negativos.

Gate: o assistente bloqueia propriedade inexistente, release incerta e tentativa
de executar SQL arbitrário.

### Fase 5 — assistente de workflow

Objetivo: transformar requisitos em grafo e especificação verificáveis.

- ✅ definir schema intermediário de workflow;
- ✅ importar catálogo versionado de handlers e argumentos;
- ✅ gerar grafo de tarefas/transições;
- ✅ implementar validadores estruturais e de handlers;
- ✅ gerar documentação de implementação e testes de aceite;
- ✅ comparar especificação com export de workflow de QA quando disponível.

Gate: nenhum handler ou argumento é apresentado como válido sem catálogo ou
fonte compatível com a release.

### Fase 6 — assistente de customização

Objetivo: gerar rascunhos técnicos pequenos e verificáveis.

- ✅ começar por ITK workflow handler, por possuir interface e validação claras;
- ✅ integrar busca de símbolos/funções ITK do gateway;
- ✅ gerar skeleton, build config e teste de registro;
- ✅ validar namespace, compatibilidade e APIs proibidas;
- ✅ adicionar BMIDE, SOA e AWC em slices independentes;
- ✅ permitir exportação para staging após solicitação explícita.

Gate por categoria: conjunto ouro, validação estática e build/teste em fixture ou
ambiente controlado. Uma categoria não bloqueia as demais.

### Fase 7 — catálogo local e aprendizado

Objetivo: promover casos confirmados sem contaminar a autoridade documental.

- ✅ criar schema dos padrões locais;
- ✅ adicionar `LocalCatalogAdapter`;
- ✅ definir revisão obrigatória para promover caso do qmd;
- ✅ registrar hash, autor, data, releases e fontes da promoção;
- ✅ detectar conteúdo obsoleto quando uma release muda.

Gate: qmd não pode elevar sozinho um rascunho ao estado `validated`.

### Fase 8 — hardening e operação

- ✅ testes de prompt injection em documentos;
- ✅ testes de vazamento de secrets e paths;
- ✅ limites de contexto, concorrência, timeout e custo;
- ✅ auditoria ponta a ponta;
- ✅ avaliação de precisão e taxa de bloqueio correto;
- ✅ runbook de indisponibilidade do gateway;
- ⬜ homologação QA 2606 antes de habilitar no perfil PRD.

## 16. Estratégia de testes

### 16.1 Testes unitários

- normalização e deduplicação de fontes;
- filtro de release e detecção de mismatch;
- provenance score;
- schemas estritos;
- roteamento local/remoto;
- validadores por artefato;
- sanitização e limites.

### 16.2 Testes de integração

- gateway fake com busca e recuperação de chunk;
- chat → tool local → contexto → resposta;
- chat → tool remota → Evidence → busca documental → Finding;
- falha, timeout e referência incompleta;
- draft → validate → export em diretório temporário.

### 16.3 Avaliações com conjunto ouro

Cada caso deve declarar:

```text
pergunta/requisito
release
fontes esperadas
evidências disponíveis
elementos obrigatórios
elementos proibidos
resultado esperado da validação
```

Métricas mínimas:

- precisão de fonte;
- compatibilidade correta de release;
- cobertura dos requisitos;
- taxa de símbolos/handlers/propriedades inexistentes;
- taxa de bloqueio de operações proibidas;
- completude das validações;
- custo e latência por fluxo.

## 17. Critérios de aceite do MVP

O MVP inclui as Fases 0 a 4 e está aceito quando:

1. o chat pesquisa documentação sem despachar a busca ao agente;
2. cada resposta documental possui domínio, release e localização verificável;
3. falha documental é exibida como indisponibilidade, sem fallback inventado;
4. um Finding pode referenciar Evidence e documentação separadamente;
5. o assistente cria especificação de Saved Query usando tipo e propriedades
   confirmados pelo ambiente;
6. nenhuma query é criada ou executada no Teamcenter automaticamente;
7. SQL gerado permanece offline e tentativas de escrita são bloqueadas;
8. rascunhos possuem expiração, hash, fontes, hipóteses e findings de validação;
9. policies atuais e testes zero-trust permanecem intactos;
10. lint, testes e verificações estáticas passam.

Workflow e customizações são incrementos posteriores, cada um com seu gate.

## 18. Riscos e mitigação

| Risco                                 | Mitigação                                                       |
| ------------------------------------- | --------------------------------------------------------------- |
| documentação sem referência           | bloquear validação e corrigir adapter/indexador                 |
| mistura de releases                   | filtro obrigatório e status `version_mismatch`                  |
| alucinação de propriedade/handler/API | validar contra ambiente, catálogo ou fonte                      |
| prompt injection documental           | tratar trechos como dados e limitar instruções do sistema       |
| excesso de contexto                   | ranking, deduplicação e orçamento por consulta                  |
| conteúdo Siemens licenciado           | armazenar referências/resumos permitidos, não redistribuir PDFs |
| código inseguro                       | validators, denylist de APIs internas e build controlado        |
| confusão entre gerar e aplicar        | lifecycle de rascunho e ausência de tool `apply`                |
| qmd desatualizado                     | autoridade baixa e promoção revisada para catálogo              |
| acoplamento ao gateway                | seam com adapters e fake para testes                            |

## 19. Decisões recomendadas

1. Implementar primeiro diagnóstico + Saved Query; são os slices com maior
   reutilização da infraestrutura read-only existente.
2. Implementar workflow usando representação intermediária antes de qualquer
   XML de importação.
3. Iniciar customizações por ITK workflow handler, depois BMIDE, SOA e AWC.
4. Manter documentação Siemens no gateway; versionar localmente somente schemas,
   padrões aprovados, referências e exemplos próprios.
5. Manter qmd fora do caminho crítico do runtime.
6. Não adicionar execução genérica de SQL, código, import ou deploy.
7. Exigir proveniência completa antes de habilitar geração validada.

## 20. Primeiro slice executável

Ordem sugerida para a primeira implementação:

1. criar `ChatToolRegistry` sem mudar comportamento;
2. criar contratos `SourceReference` e `KnowledgeExcerpt`;
3. implementar gateway fake e `SiemensDocsGatewayAdapter`;
4. expor `tc_documentation_search` apenas no console;
5. adicionar filtro obrigatório de release e provenance guard;
6. integrar uma resposta documental ao chat;
7. criar cinco casos ouro: diagnóstico SOA, FMS, Saved Query, workflow handler e
   função ITK;
8. só então iniciar `ArtifactDraft` para Saved Query.

Esse slice prova o seam, a fonte, a segurança e a experiência do usuário antes
de investir nos geradores específicos.

## 21. Definition of Done por entrega

- interface e invariantes documentadas;
- schema estrito e versionado;
- testes positivos, negativos, timeout e autorização;
- referências de release verificadas;
- nenhuma credencial ou path sensível em saída;
- auditoria e métricas mínimas;
- documentação de configuração atualizada;
- typecheck, lint, Biome e testes passando quando houver alteração JS/TS;
- validação controlada em QA antes de qualquer habilitação em PRD.
