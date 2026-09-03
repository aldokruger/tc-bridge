# Plano de implementação — diagnóstico de projeto BMIDE de uma instalação Teamcenter

Status: planejado

Data: 2026-09-03

Referência analisada: `bmide_sample/e5exxonbase`

Escopo inicial: projeto BMIDE em workspace, mídia gerada e evidências read-only
da instalação Teamcenter

## 1. Objetivo

Evoluir o diagnóstico BMIDE do `tc-bridge` para analisar um projeto completo,
detectar riscos de modelo, dependência, build e deploy, e relacionar o projeto
fonte com os artefatos efetivamente preparados para uma instalação Teamcenter.

O diagnóstico deve responder com rapidez:

1. Qual template está sendo analisado e para qual release foi preparado?
2. O projeto está estruturalmente íntegro?
3. Quais objetos, propriedades e regras ele adiciona, altera ou remove?
4. Existem referências quebradas, conflitos ou configurações incompletas?
5. O pacote gerado corresponde ao projeto atual?
6. O projeto é compatível com a instalação alvo?
7. Quais riscos bloqueiam build, deploy, upgrade ou operação?

Fluxo alvo:

```text
Descobrir → Classificar arquivos → Construir modelo → Resolver referências
          → Executar regras → Comparar artefatos/instalação → Priorizar findings
          → Explicar com evidências
```

O resultado principal é diagnóstico técnico, não documentação descritiva. Uma
documentação detalhada poderá ser gerada a partir do mesmo modelo normalizado,
sem duplicar parser ou regras.

## 2. Evidências obtidas do `bmide_sample`

O sample foi analisado somente em leitura. Ele representa um projeto BMIDE real
e suficientemente grande para orientar arquitetura, performance e testes.

### 2.1 Perfil do projeto

| Evidência | Valor observado |
| --- | ---: |
| Arquivos totais | 1.864 |
| Tamanho total aproximado | 11,6 MB |
| XMLs em `extensions/` | 1.564 |
| XMLs fonte no primeiro nível de `extensions/` | 132 |
| Includes ativos em `master.xml` | 130 |
| Includes ausentes | 0 |
| Arquivos de idioma | 1.431 |
| Locales | 11 |
| Artefatos em `output/` | 287 |
| Pacotes históricos distintos | 28 |

Todos os XMLs verificados são bem formados. Isso confirma que well-formedness é
apenas o primeiro gate; a maior parte do valor está na validação semântica e na
correlação entre arquivos.

### 2.2 Elementos relevantes observados

| Elemento | Quantidade |
| --- | ---: |
| `TcClass` | 232 |
| `TcStandardType` | 232 |
| `TcForm` | 109 |
| `TcRuntimeType` | 3 |
| `TcAttribute` | 645 |
| `TcProperty` | 50 |
| `TcPropertyAttach` | 315 |
| `TcLOV` estática | 62 |
| `LOVDynamic` | 213 |
| `TcLOVAttach` | 378 |
| `TcNamingRule` | 45 |
| `TcNamingRuleAttach` | 47 |
| `TcGRMRule` | 64 |
| `TcDeepCopyRule` | 12 |
| `TcCompoundPropertyRule` | 28 |
| `TcTypeConstantAttach` | 858 |
| `TcPropertyConstantAttach` | 2.375 |
| `Condition` | 41 |
| `TcExtensionAttach` | 4 |
| `DispatcherServiceConfig` | 7 |
| `IRDC` | 4 |
| `VerificationRule` | 2 |
| `PropagationRule` | 3 |

### 2.3 Lições arquiteturais do sample

1. `extensions/default.xml` não contém o modelo inteiro. Ele possui somente
   constantes globais e a declaração da funcionalidade.
2. `master.xml` é a raiz real do grafo de 130 fragmentos de modelo.
3. O modelo usa principalmente `TcClass` e `TcStandardType`; procurar apenas
   tags como `TcItem` ou `business-object` gera inventário vazio.
4. LOVs dinâmicas superam LOVs estáticas. Ignorar `LOVDynamic` perderia 213 de
   275 definições.
5. Propriedades precisam ser reconstruídas a partir de `TcAttribute`,
   `TcProperty`, `TcPropertyAttach` e constantes de propriedade.
6. Forms devem ser correlacionados com suas classes Storage; Storage não é um
   tipo ausente nem um erro de modelagem.
7. Referências OOTB só podem ser validadas considerando os templates dependentes.
8. Source, mídia TEM, pacote Deployment Center e outputs históricos podem divergir
   legitimamente; o checker deve compreender direct/transitive dependencies.
9. Relatórios e outputs podem pertencer a outro projeto. No sample,
   `output/upgrade/migration.html` identifica `plm4template`, não
   `e5exxonbase`.
10. Versões precisam ser interpretadas, não apenas comparadas como string:
    `currentTemplateVersion=2312.0_0`, path de templates contendo
    `Teamcenter2406/Tc2312`, mídia `3.3:202606110` e dependência Foundation 2506.

### 2.4 Limitação comprovada no código atual

Executado contra `bmide_sample/e5exxonbase/extensions`, o leitor atual retornou:

```text
business_object_count = 0
property_count        = 0
lov_count             = 0
naming_rule_count     = 0
```

A causa é dupla:

- leitura exclusiva de `default.xml`;
- vocabulário de tags incompatível com o formato exportado pelo sample.

O novo diagnóstico deve substituir a implementação interna atual. O nome da tool
`bmide_model` pode permanecer temporariamente como wrapper de compatibilidade.

## 3. Escopo do diagnóstico

### 3.1 Modos de entrada

| Modo | Entrada | Finalidade |
| --- | --- | --- |
| `workspace` | raiz com `ProjectInfo.xml` e `extensions/master.xml` | análise completa do projeto fonte |
| `package` | diretório de pacote ou ZIP previamente colocado no staging | validar mídia gerada |
| `installation` | perfil do ambiente + metadados/export suportado | verificar o que está instalado |
| `compare` | dois snapshots ou workspace + package/installation | detectar drift e impacto |

O MVP implementa `workspace`, `package` e comparação entre snapshots. A
comparação direta com a base Teamcenter só avança após existir um mecanismo
Siemens read-only, documentado e allowlisted para obter o estado implantado.

### 3.2 Perfis de profundidade

| Perfil | Conteúdo | Uso esperado |
| --- | --- | --- |
| `inventory` | identidade, includes, versões e contagens | resposta interativa rápida |
| `standard` | modelo, referências e checks prioritários | diagnóstico padrão |
| `deep` | idiomas, outputs, package, regras avançadas e grafos | revisão técnica |
| `release-readiness` | deep + baseline + impacto de Add/Change/Delete | gate de entrega |

### 3.3 Fora de escopo

- abrir o BMIDE IDE por automação;
- editar XML ou corrigir o projeto automaticamente;
- executar `bmide_manage_templates`, TEM ou Deployment Center;
- instalar ou atualizar templates;
- consultar/escrever diretamente tabelas internas do banco;
- extrair ZIP fora de staging controlado;
- declarar compatibilidade apenas por inferência da LLM;
- transportar os XMLs completos para o broker ou para o provedor de LLM.

## 4. Princípios de arquitetura PLM

1. **Project graph first.** O projeto é um grafo de includes e referências, não
   um único XML.
2. **Source of truth explícita.** Workspace, package e instalação são estados
   distintos e nunca devem ser combinados silenciosamente.
3. **Release-aware.** Checks conhecem release do template, toolchain e ambiente.
4. **Evidence first.** Cada finding aponta para arquivo relativo, elemento,
   linha e hash.
5. **Semântica Teamcenter.** O diagnóstico entende classes POM, business types,
   Forms/Storage, inputs gerados, GRM e herança.
6. **Dependências antes de órfãos.** Uma referência externa só é considerada
   quebrada depois de consultar o catálogo de templates dependentes.
7. **Baixo falso positivo.** Ausência de dependência ou baseline gera
   `unverified`, não `critical`.
8. **Incremental por hash.** Arquivos inalterados não são reprocessados.
9. **Saída limitada.** A LLM recebe resumo e findings; detalhes são recuperados
   sob demanda.
10. **Read-only por construção.** O collector não possui operações de escrita.

## 5. Arquitetura alvo

```text
bmide_diagnostic tool
        │
        ▼
BmideProjectAnalyzer
  ├─ ProjectLocator
  ├─ FileClassifier
  ├─ IncludeGraphLoader
  ├─ SafeXmlParser
  ├─ BmideModelBuilder
  ├─ ReferenceResolver
  │    ├─ LocalProjectCatalog
  │    ├─ DependencyTemplateCatalog
  │    └─ InstalledModelSnapshot (futuro)
  ├─ DiagnosticRuleEngine
  ├─ PackageInspector
  ├─ SnapshotDiffer
  └─ ReportStore
        │
        ├─ CheckResult
        ├─ Evidence[]
        ├─ Finding[]
        ├─ bmide-snapshot.json
        └─ relatório Markdown/JSON
```

### 5.1 Módulo principal

Criar um módulo profundo com uma única interface pública:

```js
bmideProjectAnalyzer.analyze(request)
```

Request:

```json
{
  "operation": "analyze",
  "sourceKind": "workspace",
  "projectRoot": "<path allowlisted>",
  "profile": "standard",
  "environmentId": "tc2606-qa",
  "baselineSnapshotId": null,
  "scopes": ["structure", "model", "lov", "relations", "deployment"]
}
```

Essa interface esconde descoberta, parsing, cache, resolução e regras. O mesmo
seam aceita adapters de filesystem real e fixture em memória.

### 5.2 Parser XML seguro

Selecionar na implementação um parser XML compatível com Node 20 após avaliação
de manutenção e segurança. Requisitos obrigatórios:

- DTD e entidades externas desabilitados;
- proteção contra XXE e expansão de entidades;
- preservação de atributos, ordem e localização de origem;
- suporte a namespaces;
- consumo previsível de memória;
- erros com arquivo e linha;
- nenhuma execução de conteúdo XML.

Regex pode apoiar busca textual, mas não deve interpretar a semântica XML.

### 5.3 Processamento em duas passagens

**Passagem 1 — declarações**

- identidade, versão, prefixos e GUID;
- includes;
- classes, business types, forms e runtime types;
- atributos, propriedades, LOVs, naming rules, conditions e relations;
- artefatos de deploy e localização.

**Passagem 2 — vínculos**

- herança;
- classe POM ↔ business type;
- Item ↔ Revision ↔ Master ↔ RevisionMaster;
- Form ↔ Storage;
- propriedade ↔ atributo persistente/runtime/compound;
- LOV/naming rule/constants ↔ tipo/propriedade;
- GRM ↔ primary/secondary/relation/condition;
- CreateInput/SaveAsInput ↔ business type;
- extension ↔ operation/type/dependency;
- source ↔ package ↔ instalação.

Separar as passagens elimina diagnósticos dependentes da ordem dos fragmentos.

## 6. Modelo normalizado

### 6.1 `BmideProjectSnapshot`

```text
schemaVersion
snapshotId
sourceKind
projectName
displayName
guid
namespace
prefixes
templateVersion
mediaVersion
foundationRelease
targetEnvironmentId
files[]
includeGraph
dependencies[]
entities[]
references[]
packageArtifacts[]
sourceHash
createdAt
```

### 6.2 `BmideEntity`

```text
entityId: <kind>:<name>
kind
name
parentName
className
artifactName
functionality
abstract
attributes
sourceRef
operation: add | change | delete
```

Kinds iniciais:

```text
class, standard-type, form, runtime-type, operation-input,
attribute, property, lov-static, lov-dynamic, naming-rule,
revision-naming-rule, relation, grm-rule, condition, extension,
status, unit-of-measure, irdc, dispatcher-config,
verification-rule, propagation-rule
```

### 6.3 `BmideReference`

```text
referenceId
referenceKind
fromEntityId
targetName
targetEntityId
resolution: local | dependency | installation | unresolved | unverified
dependencyTemplate
sourceRef
```

### 6.4 Evidência e finding

Reutilizar `Evidence` e `Finding` existentes. Para BMIDE, o payload sanitizado da
evidência deve conter:

```text
relativeFile
line
xmlElement
entityId
selectedAttributes
contentHash
```

Paths absolutos, conteúdo completo, comentários e credenciais não seguem ao
broker.

## 7. Catálogo de checks

### 7.1 Estrutura e integridade

| ID | Check | Severidade padrão |
| --- | --- | --- |
| `BMIDE-STRUCT-001` | `ProjectInfo.xml`, `master.xml` ou `dependency.xml` ausente | critical |
| `BMIDE-STRUCT-002` | XML malformado | critical |
| `BMIDE-STRUCT-003` | include ausente, fora da raiz ou duplicado | high |
| `BMIDE-STRUCT-004` | ciclo no grafo de includes | critical |
| `BMIDE-STRUCT-005` | fragmento fonte não incluído por `master.xml` | medium |
| `BMIDE-STRUCT-006` | declaração duplicada de mesmo kind/name | high |
| `BMIDE-STRUCT-007` | nome/GUID/prefixo divergente entre manifestos | high |
| `BMIDE-STRUCT-008` | arquivo gerado tratado como fonte | medium |

### 7.2 Release, build e compatibilidade

| ID | Check | Severidade padrão |
| --- | --- | --- |
| `BMIDE-VER-001` | template version incompatível com release alvo | blocker |
| `BMIDE-VER-002` | path/toolchain de build aponta para release diferente | high |
| `BMIDE-VER-003` | Foundation da mídia diverge do ambiente | blocker |
| `BMIDE-VER-004` | compilador/padrão C++ incompatível | high |
| `BMIDE-VER-005` | versão do pacote não corresponde ao source atual | high |
| `BMIDE-VER-006` | informação insuficiente para concluir compatibilidade | unverified |

No sample, as referências a 2312, 2406 e Foundation 2506 devem produzir um
finding de revisão de compatibilidade. Não devem ser declaradas automaticamente
como erro, porque podem representar migração legítima de template.

### 7.3 Tipos, classes e propriedades

- toda classe customizada possui business type correspondente quando aplicável;
- toda herança customizada resolve localmente;
- heranças OOTB resolvem em template dependente ou snapshot da instalação;
- não existem ciclos de herança;
- Item family tem pares Item/Revision/Master coerentes;
- Form referencia Storage compatível;
- Storage é validado como artefato POM interno, não como tipo de UI ausente;
- CreateInput/SaveAsInput existem e apontam para propriedades válidas;
- propriedade anexada referencia atributo/propriedade válido;
- tipo, tamanho, array, referência e cardinalidade são coerentes;
- constantes `Required`, `Enabled`, `Modifiable`, `InitialValue` e search flags
  são normalizadas por tipo/propriedade;
- propriedades removidas em `<Delete>` recebem análise de impacto.

### 7.4 LOVs

Checks obrigatórios:

- LOV estática e `LOVDynamic` entram no mesmo catálogo, preservando o kind;
- nome duplicado ou colisão static/dynamic;
- LOV definida e nunca anexada;
- attach para LOV inexistente;
- attach para tipo/propriedade inexistente;
- exhaustive vazia sem justificativa;
- valores duplicados, vazios ou incompatíveis com o tipo;
- sub-LOV quebrada;
- query clause dinâmica referencia tipo/propriedade existente;
- dependência de `Fnd0AdminLOVValue` é identificada;
- mudanças e exclusões de LOV recebem impacto sobre dados existentes;
- cobertura de idioma dos labels é calculada.

O diagnóstico não deve confundir a `queryClause` de Dynamic LOV com SQL de
banco. Ela é validada no contexto do mecanismo Teamcenter.

### 7.5 Naming rules e geradores

- incluir `TcNamingRule` e `TcRevNamingRule`;
- validar sintaxe do pattern conforme release;
- validar counter, faixa, overflow e colisão provável;
- regra definida sem attach;
- attach para regra/tipo/propriedade inexistente;
- múltiplas regras conflitantes no mesmo alvo/condição;
- `case` e `override` explicitados;
- gerador derivado de `Fnd0BaseIdGenerator` possui propriedades runtime;
- `Fnd0IdGenerator` referencia classe existente;
- composição do ID é documentável e testável.

### 7.6 Relations, GRM e deep copy

- relation customizada existe antes de ser usada;
- tipos primary/secondary resolvem localmente ou em dependências;
- condition resolve;
- cardinalidades são válidas e coerentes;
- attachability, changeability e detachability são avaliadas;
- GRM duplicada ou contraditória;
- deep-copy rule aponta para relation e operação válidas;
- compound properties resolvem cadeia, tipo e cardinalidade;
- propagation rules não formam ciclo não intencional;
- mudança/delete de relation recebe impacto sobre dados e integrações.

### 7.7 Extensions e customizações

- extension attachment possui tipo, operação, point e condition válidos;
- extension é classificada como OOTB, dependency-provided ou custom;
- extensão custom possui fonte/binário/registro correspondente quando esperado;
- argumentos obrigatórios estão presentes;
- operação e assinatura são compatíveis com a release;
- ausência do template/biblioteca que fornece a extensão gera `unverified`, não
  falso “símbolo inexistente”;
- código ITK, se presente, é inventariado separadamente.

O sample possui quatro attachments e nenhum fonte C/C++ ou `libtypes_ext.txt`.
O relatório deve indicar “implementação externa/não presente no projeto” até que
as dependências ou a instalação resolvam os símbolos.

### 7.8 AWC e indexação

- `Awp0SearchCanFilter`, `Awp0SearchIsIndexed`, `Awp0SearchIsStored` e constantes
  relacionadas são correlacionadas;
- filtro sem indexação recebe análise de impacto/performance;
- indexação de propriedade inexistente é bloqueante;
- referências de tipo para search são resolvidas;
- mudança de flags é destacada para planejamento de reindexação, sem executar
  qualquer operação Solr.

### 7.9 IRDC, Dispatcher e regras adicionais

- IRDC resolve business object, dataset, named relation e condição;
- DispatcherServiceConfig possui provider/service/priority coerentes;
- input/derived dataset e relation existem;
- VerificationRule resolve funcionalidade e tipo;
- PropagationRule resolve source, property/relation e target;
- statuses e units of measure possuem nomes/símbolos válidos;
- qualquer dependência operacional ausente é apontada como pré-requisito.

### 7.10 Localização

- `Fnd0SelectedLocales` corresponde às pastas disponíveis;
- cada fragmento fonte esperado possui arquivo de idioma;
- chaves da linguagem base existem nas demais linguagens;
- chaves órfãs e traduções vazias são reportadas;
- encoding declarado e conteúdo são compatíveis;
- cobertura é calculada por locale e por entidade.

No sample, `en_US` contém um arquivo adicional `ecad/ecad_en_US.xml`; essa
diferença deve ser classificada antes de ser considerada erro.

### 7.11 Build, mídia e deploy

- identidade, GUID e versão são consistentes entre dependency, media, TEM e DC;
- dependências de source, TEM e DC são comparadas com semântica direct/transitive;
- ZIPs esperados existem e podem ser inspecionados com limites;
- conteúdo do package corresponde ao snapshot do source;
- install/update scripts vazios são informativos quando não há migração custom;
- presença de `<Change>` e `<Delete>` eleva o nível de análise de upgrade;
- outputs antigos são separados do pacote candidato;
- package candidato é escolhido explicitamente, nunca pelo primeiro arquivo;
- migration/build report identifica o mesmo projeto, GUID e release;
- report com path absoluto ou outro projeto é sanitizado e marcado como stale.

No sample, o DC declara apenas cinco dependências enquanto dependency/TEM têm
conjuntos maiores. Isso exige classificação entre dependências diretas,
transitivas e opcionais; diferença simples de listas geraria falso positivo.

## 8. Comparação com a instalação

O diagnóstico deve separar três estados:

```text
ProjectSnapshot  = intenção no workspace
PackageSnapshot  = conteúdo entregue para instalação
InstalledSnapshot = estado observado na instalação
```

Comparações:

| Comparação | Pergunta respondida |
| --- | --- |
| Project ↔ Package | o build empacotou exatamente a intenção atual? |
| Package ↔ Installed | o pacote candidato já está implantado? |
| Project ↔ Installed | qual drift existe entre desenvolvimento e ambiente? |
| Installed A ↔ Installed B | QA e PRD possuem o mesmo modelo? |
| Snapshot anterior ↔ atual | qual o impacto real do upgrade? |

O `InstalledSnapshot` deve vir de export/metadados suportados ou collectors SOA
allowlisted. Sem essa evidência, o resultado limita-se a workspace/package e
declara a comparação com a instalação como não verificada.

### 8.1 Classificação de mudanças

| Mudança | Risco inicial |
| --- | --- |
| novo tipo/propriedade opcional | low/medium |
| propriedade passa a required | high |
| mudança de tipo/tamanho | high/critical |
| remoção de propriedade/tipo/LOV value | critical |
| alteração de naming counter | high |
| alteração de GRM cardinality | high |
| mudança de search indexing | medium/high |
| nova extension/handler | high |
| mudança somente de tradução | low |

O risco final considera dados existentes, uso observado e documentação da
release; não é definido apenas pela forma do XML.

## 9. Tool MCP e retorno para a LLM

### 9.1 Tool proposta

```text
bmide_diagnostic
```

Operações:

```text
inventory
analyze
compare
get_findings
get_entity
get_dependencies
get_impact
```

Inputs estritos:

```text
operation
environment_id
project_root              # somente dentro da allowlist
source_kind
profile
scopes
baseline_snapshot_id
candidate_snapshot_id
severity_filter
entity_id
limit
cursor
```

### 9.2 Retorno compacto

Uma execução `analyze` não devolve o modelo inteiro:

```json
{
  "report_id": "bmide-rpt-...",
  "snapshot_id": "bmide-snap-...",
  "project": {
    "name": "e5exxonbase",
    "template_version": "2312.0_0",
    "media_version": "3.3:202606110"
  },
  "summary": {
    "files": 1864,
    "entities": 344,
    "findings": { "critical": 0, "high": 0, "medium": 0 }
  },
  "top_findings": [],
  "check_result": {}
}
```

Detalhes usam paginação e `report_id`. Isso reduz payload, latência e contexto da
LLM.

### 9.3 Compatibilidade

Manter `bmide_model` durante uma release como wrapper:

```text
bmide_model(tc_data_path)
  → bmide_diagnostic(operation=inventory, source_kind=workspace)
```

Marcar o formato antigo como deprecated depois que consumidores forem migrados.

## 10. Integração ao `tc-bridge`

### 10.1 Estrutura proposta

```text
src/
  bmide/
    analyzer.js
    schemas.js
    project-locator.js
    file-classifier.js
    include-graph.js
    xml-parser.js
    model-builder.js
    reference-resolver.js
    package-inspector.js
    snapshot-differ.js
    report-store.js
    rules/
      structure.js
      versions.js
      types.js
      properties.js
      lovs.js
      naming.js
      relations.js
      extensions.js
      awc-search.js
      deployment.js
      localization.js
  bmide-reader.js             # wrapper temporário
test/
  fixtures/bmide/
  bmide-analyzer.test.js
  bmide-reference-resolver.test.js
  bmide-rules.test.js
  bmide-package-inspector.test.js
  bmide-snapshot-differ.test.js
  bmide-tool.test.js
```

### 10.2 Collector SDK

Executar a análise por meio do Collector SDK existente:

- `collector_id`: `teamcenter.bmide`;
- `collector_version`: `1.0.0`;
- `impact_budget`: `zero` para workspace/package;
- timeout por perfil;
- warnings, partial errors e truncation no `CheckResult`;
- evidências com retenção `support`;
- métricas sem paths absolutos.

### 10.3 Integração com engenharia assistida

O `EngineeringAssistant` já tenta consultar `bmideReader` para Saved Query, mas:

- falha do leitor é ignorada;
- a validação usa listas vazias para `bmideTypes` e `bmideProperties`.

Após o novo analyzer:

1. drafts recebem `snapshot_id` explícito;
2. tipos e propriedades vêm do snapshot normalizado;
3. falha de contexto vira finding `environment_context_unavailable`;
4. draft não alcança `validated` quando depende de elemento não confirmado;
5. query, workflow e customização podem consultar entidades por ID, sem receber
   XML bruto.

## 11. Eficiência e produtividade

### 11.1 Classificação de arquivos

O analyzer não deve tratar 1.864 arquivos da mesma forma:

```text
source-critical  → ProjectInfo, master, dependency, default/common
source-model     → fragmentos alcançáveis por master
localization     → lang/<locale>
install          → TEM, DC, media, scripts
admin-data       → dados administrativos
generated        → output/packages
custom-code      → C/C++/headers/build files
irrelevant       → metadados do IDE e temporários
```

`inventory` lê apenas `source-critical` e metadados. `standard` lê o grafo fonte.
`deep` acrescenta idiomas, instalação e outputs.

### 11.2 Cache incremental

- SHA-256 por arquivo;
- cache de AST/fatos por hash;
- snapshot do include graph;
- invalidar somente arquivo alterado e referências dependentes;
- separar cache por parser/schema version;
- nunca reutilizar cache entre roots sem validar identidade/GUID.

### 11.3 Orçamento de execução

Metas iniciais no sample, medidas em CI antes de virarem SLO:

| Perfil | Meta cold | Meta warm | Memória alvo |
| --- | ---: | ---: | ---: |
| inventory | até 2 s | até 500 ms | até 128 MB |
| standard | até 10 s | até 2 s | até 256 MB |
| deep | até 30 s | até 5 s | até 384 MB |

Outros limites:

- tamanho máximo por arquivo e por projeto;
- quantidade máxima de includes e profundidade do grafo;
- concorrência limitada de leitura;
- paginação de entidades/findings;
- cancelamento por `AbortSignal`;
- partial results quando um escopo não crítico falhar.

## 12. Segurança

- project root precisa estar em `readPaths` ou perfil do ambiente;
- includes são resolvidos com path canônico e não escapam da raiz;
- symlinks são bloqueados ou revalidados;
- ZIP é inspecionado contra Zip Slip, tamanho expandido e quantidade de entradas;
- XML não resolve entidades externas;
- comentários e scripts não são executados;
- absolute paths são removidos de reports, como o `migration.html` do sample;
- evidências limitam atributos e tamanho;
- nenhuma credencial de DB, Teamcenter ou Deployment Center é coletada;
- somente report/snapshot sanitizado cruza agente → broker;
- operações continuam protegidas por action/capability granular.

## 13. Estratégia de testes

### 13.1 Fixtures pequenas

Criar fixtures mínimas e legíveis para cada comportamento:

- projeto válido com `master.xml` fragmentado;
- include ausente, duplicado, circular e com path traversal;
- `TcClass` + `TcStandardType` + Item family;
- Form/Storage válido e quebrado;
- LOV static/dynamic, attach, sub-LOV e orphan;
- naming/revision naming rule;
- GRM/deep-copy/compound property;
- extension local, dependency-provided e unresolved;
- Add/Change/Delete;
- locale incompleto;
- package divergente;
- XML malicioso com external entity;
- migration report de outro projeto.

### 13.2 Sample como teste de caracterização

Não copiar o sample para outra fixture. Usá-lo opcionalmente como corpus local de
caracterização e manter assertions estáveis:

- root detectado como `e5exxonbase`;
- 130 includes e zero missing includes;
- 62 static LOVs e 213 Dynamic LOVs;
- 45 naming rules mais uma revision naming rule;
- 41 custom relations;
- 11 locales;
- package candidato 3.3 identificado;
- migration report externo detectado;
- leitor não retorna modelo vazio.

Evitar snapshot tests gigantes. Testar fatos e findings relevantes.

### 13.3 Integração

- filesystem adapter real em diretório temporário;
- tool → collector → CheckResult/Evidence/Finding;
- analyzer → engineering assistant para validar propriedade existente/inexistente;
- workspace → package diff;
- timeout/cancelamento/truncation;
- execução sem gateway documental;
- documentação Siemens indisponível produz `unverified`, não hipótese inventada.

### 13.4 Qualidade

Após mudanças JS/TS:

```text
testes
typecheck
lint
Biome
git diff --check
```

## 14. Plano incremental de implementação

### Fase 0 — contratos e caracterização

- ⬜ congelar as métricas estruturais do sample;
- ⬜ criar schemas Zod de request, snapshot, entity e reference;
- ⬜ definir códigos de finding e severidades;
- ⬜ criar fixtures mínimas;
- ⬜ registrar ADR: project graph e estados Source/Package/Installed.

Gate: sample e fixtures possuem resultados esperados documentados.

### Fase 1 — localização e grafo de includes

- ⬜ detectar project root;
- ⬜ classificar arquivos;
- ⬜ carregar `master.xml` recursivamente;
- ⬜ bloquear traversal, symlink e ciclo;
- ⬜ validar XML e includes;
- ⬜ produzir inventory compacto.

Gate: o sample retorna 130 includes, sem ler `output/` como modelo fonte.

### Fase 2 — parser e modelo normalizado

- ⬜ selecionar parser XML seguro;
- ⬜ implementar passagem de declarações;
- ⬜ implementar vínculos centrais;
- ⬜ suportar `TcClass`, `TcStandardType`, `TcForm`, `TcRuntimeType` e inputs;
- ⬜ reconstruir propriedades/atributos/constants;
- ⬜ gerar `BmideProjectSnapshot` determinístico.

Gate: o modelo do sample deixa de retornar contagens zero e hashes permanecem
estáveis entre execuções.

### Fase 3 — rules engine estrutural

- ⬜ estrutura, versões, identidade e dependências;
- ⬜ types/classes/forms/storage;
- ⬜ property/attribute references;
- ⬜ Evidence e Finding integrados;
- ⬜ severidade ajustada por disponibilidade de dependency catalog.

Gate: referências OOTB não viram falsos positivos quando a dependência está
declarada.

### Fase 4 — LOV, naming e relations

- ⬜ static/dynamic LOVs e attachment matrix;
- ⬜ query clauses e sub-LOVs;
- ⬜ naming/revision rules e counters;
- ⬜ relations, GRM, deep copy e compound properties;
- ⬜ conditions e referências cruzadas.

Gate: os totais de LOV/rules/relations do sample são reproduzidos e referências
custom válidas são resolvidas.

### Fase 5 — customizações e experiência AWC

- ⬜ extension attachments;
- ⬜ inventário opcional de ITK/build files;
- ⬜ search/index constants;
- ⬜ IRDC, Dispatcher, verification e propagation;
- ⬜ análise de localization.

Gate: extensão sem implementação local é `unverified_external`, não
`missing_custom_code` sem evidência adicional.

### Fase 6 — package e release readiness

- ⬜ analisar media/TEM/DC/install/update;
- ⬜ inspecionar ZIPs com segurança;
- ⬜ identificar package candidato explicitamente;
- ⬜ comparar source hash/fatos com package;
- ⬜ analisar Add/Change/Delete e impacto;
- ⬜ detectar reports/output de outro projeto.

Gate: o `migration.html` externo do sample é detectado e seus paths absolutos não
aparecem no payload remoto.

### Fase 7 — tool e compatibilidade

- ⬜ expor `bmide_diagnostic`;
- ⬜ integrar Collector SDK e capabilities;
- ⬜ implementar report store e paginação;
- ⬜ manter wrapper `bmide_model`;
- ⬜ atualizar README e configuração;
- ⬜ integrar snapshot ao EngineeringAssistant.

Gate: consumidores existentes continuam funcionando e novos consumidores obtêm
modelo completo por `report_id`/`snapshot_id`.

### Fase 8 — comparação de instalação

- ⬜ definir coleta suportada do InstalledSnapshot por release;
- ⬜ implementar adapter read-only;
- ⬜ comparar QA/PRD e source/package/installed;
- ⬜ validar em Teamcenter 2606 QA;
- ⬜ documentar permissões mínimas e indisponibilidades.

Gate: nenhuma afirmação sobre estado instalado sem Evidence do ambiente.

## 15. Prioridade de entrega

### MVP

Fases 0 a 4:

- inventário correto;
- modelo completo e navegável;
- checks estruturais;
- LOV/naming/relations;
- snapshot reutilizável por query e customização.

### Release 2

Fases 5 a 7:

- extensions/AWC/IRDC/localization;
- package e release readiness;
- tool MCP e integração completa.

### Release 3

Fase 8:

- drift contra instalação real e comparação QA/PRD.

## 16. Critérios de aceite do MVP

1. O analyzer descobre `master.xml` e processa todos os includes alcançáveis.
2. O sample retorna inventário não vazio e as contagens de caracterização.
3. `TcClass` e `TcStandardType` são ligados corretamente.
4. Form/Storage não produz falso positivo.
5. LOV estática e dinâmica aparecem na attachment matrix.
6. References locais, dependentes e não verificadas são distintas.
7. Cada finding possui arquivo relativo, elemento, linha e hash.
8. XML, include ou referência crítica inválida produz severidade consistente.
9. O retorno para a LLM é paginado e não contém XML integral/path absoluto.
10. Cache não altera resultado e reduz o trabalho em segunda execução.
11. O wrapper antigo continua funcional durante a migração.
12. Testes, typecheck, lint e Biome passam.

## 17. Critérios de aceite de release readiness

1. Um único package candidato é selecionado por entrada explícita.
2. Source e package geram snapshots comparáveis.
3. Add/Change/Delete possui impacto classificado.
4. Versão/GUID/nome/dependências são coerentes ou geram finding.
5. Output pertencente a outro projeto é detectado.
6. ZIPs são analisados sem extração insegura.
7. Resultado separa blocker, risco, observação e não verificado.
8. Nenhum deploy é executado.

## 18. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| formato BMIDE varia por release | parser extensível + fixtures por release |
| referência OOTB parece quebrada | dependency catalog + estado `unverified` |
| outputs antigos distorcem análise | file classifier e package explícito |
| volume de localization aumenta latência | perfil deep + cache por hash |
| XML malicioso | parser sem DTD/entidade + limites |
| snapshot expõe IP do modelo | fatos mínimos, sanitização e controle de acesso |
| comparação por nome gera falso drift | IDs normalizados + kind + parent + hash semântico |
| LLM inventa compatibilidade | rules determinísticas e documentação versionada |
| mudança destrutiva passa despercebida | análise dedicada de Change/Delete |
| ferramenta vira documentador gigante | interface compacta e detalhes sob demanda |

## 19. Decisões recomendadas

1. Substituir o parser interno, preservando `bmide_model` apenas como wrapper.
2. Tratar `master.xml` como raiz do modelo e `dependency.xml` como catálogo de
   contexto externo.
3. Construir um snapshot normalizado antes de implementar regras específicas.
4. Implementar resolução local e dependency-aware antes de reportar órfãos.
5. Priorizar LOVs, naming rules e GRM após tipos/propriedades; são os elementos
   com maior impacto em dados e comportamento.
6. Manter source/package/installed como snapshots independentes.
7. Entregar primeiro diagnóstico de workspace; não bloquear o MVP aguardando
   acesso ao ambiente real.
8. Usar o sample como teste de caracterização e fixtures pequenas para regras.
9. Nunca enviar todo o projeto à LLM; fornecer consultas por entity/finding.
10. Alimentar Saved Query, workflow e customizações com o snapshot, eliminando
    validações baseadas em listas vazias.

## 20. Primeiro slice executável

Ordem sugerida para iniciar a implementação:

1. criar schemas `BmideAnalyzeRequest`, `BmideProjectSnapshot`, `BmideEntity` e
   `BmideReference`;
2. criar `ProjectLocator` e `FileClassifier`;
3. implementar `IncludeGraphLoader` seguro;
4. escolher e encapsular o parser XML;
5. extrair identidade + `TcClass` + `TcStandardType` + `TcForm`;
6. gerar inventory/snapshot do sample;
7. criar checks de include, duplicidade, herança e Form/Storage;
8. integrar `CheckResult`, Evidence e Finding;
9. medir cold/warm e adicionar cache somente depois da baseline;
10. migrar `bmide_model` para o novo analyzer.

Esse slice elimina a falha atual de “modelo vazio” e estabelece o seam correto
para todas as análises posteriores.

## 21. Definition of Done

- interface pequena e invariantes documentadas;
- parser seguro e isolado atrás do seam;
- schemas estritos e versionados;
- evidências e severidades reproduzíveis;
- testes positivos, negativos, segurança e performance;
- sample caracterizado sem ser modificado;
- sem falsos positivos conhecidos de Form/Storage ou referências dependentes;
- payload limitado e sanitizado;
- README/configuração atualizados;
- testes, typecheck, lint, Biome e `git diff --check` passando;
- validação em QA antes de qualquer uso para release/deploy em PRD.
