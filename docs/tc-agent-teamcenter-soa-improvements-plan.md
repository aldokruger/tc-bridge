# Plano de melhorias do acesso Teamcenter SOA no tc-agent

Status: proposto  
Escopo: diagnóstico Teamcenter 2606 somente leitura  
Data: 2026-09-01

## 1. Objetivo

Evoluir o adaptador SOA do `tc-agent` para oferecer diagnósticos Teamcenter
úteis, previsíveis e auditáveis, sem transformá-lo em um cliente SOA genérico
ou em um meio de exportação arbitrária de dados.

O resultado deve permitir diagnosticar conexão, sessão, encoding, preferências,
objetos, saved queries, datasets e FMS com operações predefinidas, limites
locais e respostas normalizadas.

## 2. Estado atual

A implementação atual possui uma base segura para homologação:

- usa as bibliotecas Java SOA oficiais instaladas no host Teamcenter;
- expõe apenas `session_info`, `get_preferences`, `get_object_properties` e
  `execute_saved_query`;
- não aceita nome de serviço ou método SOA arbitrário;
- cria capabilities Ed25519 de uso único;
- valida emissor, agente, expiração, escopo e replay;
- encerra a sessão Teamcenter em `finally`;
- limita quantidade de propriedades, critérios e resultados.

As principais lacunas são:

1. todas as consultas compartilham a action ampla `teamcenter.read`;
2. preferências, propriedades, UIDs e saved queries não possuem allowlist local;
3. a resposta Java é serializada genericamente por reflexão;
4. `ServiceData.partialErrors` não é normalizado;
5. stdout, truncamento e encoding não possuem contrato binário explícito;
6. o processo Java herda todo o ambiente do processo Node.js;
7. cada requisição cria uma JVM e uma sessão sem limite de concorrência;
8. não há preflight confiável de Java, JARs e classpath;
9. o `audit_id` não acompanha a chamada até o adaptador;
10. a conta técnica não representa as ACLs do usuário final do AWC ou RAC.

## 3. Princípios

1. **Somente leitura não significa baixo risco.** Queries e propriedades
   calculadas podem consumir recursos ou expor dados sensíveis.
2. **Negação por padrão.** Toda operação, preferência, propriedade e saved query
   precisa estar declarada localmente.
3. **Sem SOA genérico.** O broker nunca escolhe livremente serviço, método ou
   payload Teamcenter.
4. **Serviços suportados.** Preferir os strong services públicos presentes nos
   stubs oficiais 2606. Serviços `Internal-*` ficam bloqueados por padrão.
5. **Metadados antes de conteúdo.** Retornar resumos e indicadores; conteúdo de
   negócio ou arquivo exige capacidade específica.
6. **Segredos permanecem locais.** Senhas, cookies, tickets FMS e connection
   strings não retornam ao broker.
7. **Contrato versionado.** Entradas, resultados e erros possuem schemas
   estáveis e testáveis.
8. **Carga limitada.** Concorrência, tempo, volume e frequência são controlados
   no agente, não apenas no cliente remoto.
9. **Compatibilidade comprovada.** Cada operação nova deve compilar e ser
   homologada contra os JARs oficiais da versão instalada.

## 4. Fora de escopo

Nesta evolução não serão implementados:

- serviço ou método SOA arbitrário;
- alteração de objetos, preferências, workflows ou datasets;
- importação, exportação ou upload de arquivos;
- retorno de tickets FMS completos;
- shell, Java, SQL ou JavaScript fornecido pelo usuário;
- login com senha recebida pela requisição;
- impersonação de usuário Teamcenter;
- reutilização de cookie ou sessão capturada do AWC/RAC;
- uso de `Internal-*` sem decisão arquitetural, versionamento e homologação
  específicos.

## 5. Arquitetura alvo

```text
Usuário autorizado
        │
        ▼
Broker — policy por action e agente
        │ capability curta e assinada
        ▼
tc-agent — policy local + fila + limites
        │
        ▼
Adaptador SOA versionado
        │
        ▼
Strong services públicos Teamcenter 2606
        │
        ▼
Resposta normalizada, reduzida e auditável
```

### 5.1 Actions propostas

| Action | Finalidade | Sensibilidade |
| --- | --- | --- |
| `teamcenter.soa.preflight` | Validar Java, adapter, JARs, charset e URL sem login | Baixa |
| `teamcenter.soa.connection_health` | Medir conexão, login, consulta mínima e logout | Média |
| `teamcenter.soa.session_context` | Exibir contexto técnico e versão do ambiente | Média |
| `teamcenter.soa.preferences.read` | Ler preferências explicitamente permitidas | Média |
| `teamcenter.soa.encoding_probe` | Inspecionar code points e bytes de uma propriedade | Média |
| `teamcenter.soa.object.inspect` | Ler propriedades definidas por perfil local | Média |
| `teamcenter.soa.saved_query.execute` | Executar queries e critérios homologados | Média/alta |
| `teamcenter.soa.dataset.inspect` | Ler metadados de Dataset, ImanFile e named references | Média/alta |
| `teamcenter.soa.fms.probe` | Testar acesso FMS local sem retornar ticket ou conteúdo | Alta |
| `teamcenter.soa.health_bundle` | Agregar verificações básicas em um relatório limitado | Média |

As actions de dataset, saved query e FMS devem poder ser desabilitadas
independentemente no agente.

### 5.2 Perfis locais

O broker deve selecionar um perfil pelo identificador, mas não definir suas
propriedades internas.

Exemplo conceitual:

```yaml
version: 1
teamcenter:
  profiles:
    encoding:
      allowed_types: [Item, ItemRevision]
      properties: [object_name, object_desc, awp0CellProperties]
      max_objects: 5
    fms_configuration:
      preferences: [Fms_BootStrap_Urls]
    item_lookup:
      saved_query_uid: LOCAL_CONFIGURED_UID
      allowed_entries: [Item ID]
      max_results: 20
```

O arquivo deve ser protegido pela conta do serviço, validado por schema e não
alterável por uma tarefa remota.

## 6. Contrato de resposta

Cada operação deve produzir um DTO explícito, sem reflexão genérica:

```json
{
  "schemaVersion": 1,
  "operation": "teamcenter.soa.object.inspect",
  "status": "completed",
  "correlationId": "aud_...",
  "durationMs": 315,
  "warnings": [],
  "partialErrors": [],
  "result": {},
  "truncated": false
}
```

Requisitos:

- serialização JSON por biblioteca consolidada;
- UTF-8 explícito na escrita e leitura;
- limite aplicado antes de emitir o JSON;
- nenhum corte do início ou meio da resposta;
- erro com código estável, mensagem sanitizada e correlação;
- tratamento de partial errors de todos os serviços;
- propriedades com tipo, valor de banco e valor de interface quando aplicável;
- indicação explícita de valor ausente, acesso negado e propriedade não
  carregada;
- nenhuma stack trace ou objeto Java refletido na resposta externa.

## 7. Fases de implementação

### Fase 0 — contrato e ameaças

Entregas:

1. inventariar dados que a conta técnica consegue acessar;
2. classificar preferências, propriedades, queries e metadados FMS;
3. definir schema versionado de tarefa, resposta e erro;
4. definir papéis autorizados para cada action;
5. registrar que a identidade técnica não representa ACL de usuário final;
6. decidir política para endpoint SOA HTTP versus HTTPS;
7. definir retenção e sanitização dos resultados.

Critérios de aceite:

- ameaça de exfiltração, abuso de query e vazamento de segredo documentada;
- actions e níveis de sensibilidade aprovados;
- nenhuma action de escrita incluída.

### Fase 1 — autorização granular e policy local

Entregas:

1. substituir `teamcenter.read` pelas actions independentes;
2. criar schema de entrada específico por action no broker e no agente;
3. introduzir arquivo de policy local versionado;
4. permitir somente scopes de preferência enumerados e em lowercase;
5. criar allowlists de tipos, propriedades, preferências, queries, critérios e
   limites;
6. rejeitar parâmetros desconhecidos;
7. manter `TC_ENFORCE_CAPABILITIES=1` como requisito de produção.

Critérios de aceite:

- uma capability de health não executa query ou leitura de objeto;
- propriedade ou preferência fora da policy é negada localmente;
- saved query não configurada não pode ser executada;
- testes negativos comprovam todas as negações.

### Fase 2 — protocolo, DTOs e encoding

Entregas:

1. remover o serializador reflexivo;
2. adotar DTOs explícitos por operação;
3. substituir o parser manual de arrays JSON;
4. implementar UTF-8 explícito entre Java e Node.js;
5. acumular stdout como bytes ou usar `StringDecoder`;
6. separar protocolo de resultado e logs do adaptador;
7. normalizar `ServiceData.partialErrors`;
8. implementar truncamento estrutural válido;
9. adicionar `schemaVersion`, `correlationId`, duração e avisos.

Critérios de aceite:

- `Ação revisão : çãéíóú` atravessa o fluxo sem substituição;
- uma resposta grande continua sendo JSON válido;
- partial errors aparecem de forma estruturada;
- logs Java no stdout não corrompem o protocolo;
- caracteres de controle possuem escape JSON correto.

### Fase 3 — segredos, ambiente e transporte

Entregas:

1. passar ao Java somente variáveis allowlisted;
2. retirar a senha Teamcenter de arquivos `.env` quando houver secret store
   disponível;
3. integrar DPAPI, Windows Credential Manager ou mecanismo corporativo
   equivalente;
4. validar URL, protocolo, trust store e hostname do WebTier;
5. sanitizar mensagens antes de auditoria e retorno;
6. mascarar password, token, cookie, authorization, connection string, `OBF:*`,
   tickets e assinaturas FMS;
7. documentar rotação da conta técnica.

Critérios de aceite:

- o processo Java não recebe variáveis do banco ou broker;
- segredo não aparece em stdout, stderr, auditoria ou resposta;
- conta técnica não possui `infodba`, bypass ou privilégios de manutenção;
- falha TLS produz código de erro seguro e acionável.

### Fase 4 — preflight, dependências e compatibilidade

Entregas:

1. implementar `teamcenter.soa.preflight` sem login;
2. verificar Java, adapter JAR, hashes e classes obrigatórias;
3. detectar JAR vazio, ZIP inválido e versões duplicadas críticas;
4. substituir classpath wildcard por classpath gerado e manifestado;
5. registrar versão do adapter e do cliente SOA;
6. publicar matriz de compatibilidade por versão Teamcenter;
7. falhar a inicialização da capability SOA quando o preflight não passar.

Critérios de aceite:

- JAR vazio ou JAXB incompatível é detectado antes da primeira consulta;
- o relatório não expõe paths ou segredos desnecessários;
- o mesmo pacote é reproduzível a partir de um manifest de dependências;
- o agente anuncia SOA como indisponível quando o adapter está inválido.

### Fase 5 — resiliência e controle de carga

Entregas:

1. limitar consultas SOA simultâneas, inicialmente a uma por agente;
2. criar fila limitada e rejeição por saturação;
3. aplicar rate limit por usuário, action e agente;
4. definir timeout por tipo de operação;
5. implementar cancelamento e encerramento confiável do processo Java;
6. criar circuit breaker para falhas repetidas de WebTier/pool;
7. medir tempo de startup, login, operação e logout;
8. impedir que saved query exceda limites locais mesmo após reconexão.

Critérios de aceite:

- várias requisições não criam JVMs sem limite;
- indisponibilidade do WebTier não gera tempestade de logins;
- timeout retorna erro estável e libera recursos;
- limites continuam válidos após reinício ou reconexão do agente.

Decisão adiada: manter uma JVM persistente ou pool de sessões. O modelo por
processo deve permanecer até métricas comprovarem que o custo justifica manter
sessão e segredo em memória por mais tempo.

### Fase 6 — capacidades essenciais

#### 6.1 Preflight e connection health

Retornar:

- estado do adapter;
- versão Java e cliente SOA;
- charset efetivo;
- conectividade e resultado de login/logout;
- latência por fase;
- versão/build Teamcenter quando disponível por serviço público suportado.

Não retornar senha, cookie, headers ou catálogo completo de serviços.

#### 6.2 Session context

Retornar somente informações técnicas permitidas:

- usuário técnico mascarado quando necessário;
- group/role configurados;
- locale;
- encoding do cliente;
- endpoint lógico;
- site e build quando suportados.

O `session_info` atual deve ser renomeado ou substituído, pois hoje corresponde
principalmente ao catálogo de serviços disponíveis.

#### 6.3 Preferences read

Requisitos:

- scopes enumerados: valores exatos validados contra o SDK 2606;
- nomes provenientes da policy local;
- diferenciação entre inexistente, vazio, sem acesso e erro parcial;
- redator específico para preferências sensíveis;
- retorno do scope consultado e, quando suportado, origem do valor efetivo.

#### 6.4 Encoding probe

Para uma propriedade autorizada, retornar:

- texto limitado;
- quantidade de caracteres e code points;
- representação dos code points;
- bytes UTF-8;
- SHA-256 do texto UTF-8;
- presença de `U+FFFD` e `?` suspeitos;
- tipo e nome da propriedade.

O probe deve ajudar a comparar banco, SOA, RAC e AWC sem alterar o objeto.

Critérios de aceite da fase:

- as quatro capacidades funcionam no ambiente 2606 de homologação;
- cada resultado possui schema, limites, métricas e auditoria;
- nenhum serviço `Internal-*` é necessário.

### Fase 7 — objetos, queries, datasets e FMS

#### 7.1 Object inspect

- aceitar UID somente dentro de um perfil autorizado;
- validar tipo real do objeto;
- carregar somente propriedades do perfil;
- retornar tipo de propriedade, dbValue e uiValue quando suportado;
- limitar arrays, strings e objetos relacionados;
- não seguir relações recursivamente por padrão.

#### 7.2 Saved query execute

- saved query configurada localmente por identificador lógico;
- critérios allowlisted e validados;
- limite pequeno por padrão;
- retorno normalizado com UID, tipo e propriedades mínimas;
- timeout e rate limit mais restritivos;
- métrica de quantidade retornada e truncamento;
- proibição de descoberta irrestrita do catálogo de queries.

#### 7.3 Dataset inspect

- Dataset UID e tipo;
- named references permitidas;
- metadados mínimos de `ImanFile`;
- nome original e tamanho, quando disponíveis;
- nenhuma extração do conteúdo;
- nenhuma travessia ilimitada de relações.

#### 7.4 FMS probe

- obter o ticket somente dentro do adaptador local quando indispensável;
- nunca retornar ticket, assinatura ou cookie;
- testar a operação no próprio host;
- retornar apenas status, duração, tamanho, hash e erro sanitizado;
- limitar tamanho e tempo de download;
- não manter cópia fora de cache temporário controlado;
- exigir action e policy independentes.

Critérios de aceite da fase:

- queries caras são bloqueadas ou interrompidas pelos limites;
- Dataset/FMS não expõem conteúdo ou ticket;
- testes usam arquivos pequenos e não sensíveis;
- resultados respeitam ACL da conta técnica;
- documentação deixa explícito que isso não valida ACL do usuário AWC/RAC.

### Fase 8 — observabilidade e auditoria

Entregas:

1. propagar `audit_id`/`correlationId` até o adaptador;
2. registrar início, fim, duração, action, perfil, quantidade e truncamento;
3. não registrar valores de propriedades, critérios ou preferências por padrão;
4. criar métricas de sucesso, falha, timeout, saturação e partial errors;
5. incluir versão do agente, adapter e cliente SOA;
6. alertar sobre falhas de autenticação repetidas, volume anormal e query lenta;
7. implementar rotação e retenção do audit log;
8. permitir correlação com syslog/WebTier sem enviar credenciais ou session ID.

Critérios de aceite:

- uma chamada pode ser rastreada do broker até o resultado local;
- auditoria contém metadados suficientes sem conteúdo de negócio;
- falhas e timeouts possuem códigos agregáveis;
- teste automatizado confirma a sanitização.

### Fase 9 — homologação e implantação gradual

Ordem de liberação:

1. `preflight`;
2. `connection_health`;
3. `session_context`;
4. `preferences.read`;
5. `encoding_probe`;
6. `object.inspect`;
7. `saved_query.execute`;
8. `dataset.inspect`;
9. `fms.probe`.

Para cada action:

1. compilar contra os JARs oficiais 2606;
2. testar com conta técnica restrita;
3. validar sucesso, acesso negado, objeto inexistente e partial error;
4. medir impacto no WebTier, pool e banco;
5. revisar resultado por segurança e Teamcenter Admin;
6. habilitar somente em homologação;
7. observar auditoria e métricas;
8. promover de forma independente;
9. manter flag de desativação e rollback.

Critérios de aceite:

- nenhuma regressão em AWC, RAC, Solid Edge, WebTier ou pool;
- nenhuma chamada de escrita observada;
- limites e negações comprovados no ambiente real;
- rollback testado;
- runbook operacional publicado.

## 8. Estratégia de testes

### 8.1 Testes Node.js

- validação de schema por action;
- parâmetros desconhecidos e fora da policy;
- capability de action diferente;
- rate limit, fila, timeout e cancelamento;
- ambiente mínimo enviado ao Java;
- stdout fragmentado em caracteres UTF-8 multibyte;
- resposta grande e truncamento válido;
- sanitização de erros e auditoria.

### 8.2 Testes Java

- parsing de entrada;
- DTO e JSON UTF-8;
- normalização de partial errors;
- propriedades string, array, data, número, booleano, tag, nulo e não carregado;
- encerramento da sessão em sucesso e falha;
- erro de credencial, endpoint, TLS e serviço;
- bloqueio de action não declarada.

### 8.3 Testes de integração

- executável Java falso para testar protocolo sem Teamcenter;
- build contra os stubs oficiais 2606;
- Teamcenter homologação com conta restrita;
- item contendo `Ação revisão : çãéíóú`;
- saved query limitada e query negada;
- Dataset pequeno com named reference;
- FMS disponível, arquivo ausente, ACL negada e timeout;
- reinício do agente durante tarefa e prevenção de replay.

### 8.4 Testes de segurança

- tentativa de ler preferência não autorizada;
- tentativa de consultar propriedade sensível;
- tentativa de trocar query UID ou critério;
- tentativa de retornar ticket FMS;
- segredo em mensagem Java;
- flooding de login e saved query;
- capability expirada, repetida ou destinada a outro agente;
- JAR adulterado ou classpath incompatível.

## 9. Configurações propostas

Os nomes finais devem seguir as convenções do projeto, mas a separação desejada
é:

```text
TC_ALLOW_TEAMCENTER_SOA_PREFLIGHT
TC_ALLOW_TEAMCENTER_SOA_HEALTH
TC_ALLOW_TEAMCENTER_SOA_PREFERENCES
TC_ALLOW_TEAMCENTER_SOA_OBJECTS
TC_ALLOW_TEAMCENTER_SOA_QUERIES
TC_ALLOW_TEAMCENTER_SOA_DATASETS
TC_ALLOW_TEAMCENTER_SOA_FMS
TC_TEAMCENTER_SOA_POLICY_FILE
TC_TEAMCENTER_SOA_MAX_CONCURRENCY
TC_TEAMCENTER_SOA_QUEUE_LIMIT
TC_TEAMCENTER_SOA_RATE_LIMIT
TC_TEAMCENTER_SOA_TIMEOUT_MS
TC_TEAMCENTER_SOA_REQUIRE_TLS
TC_TEAMCENTER_SOA_TRUST_STORE
```

Não adicionar variáveis que aceitem serviço, método, classe Java ou payload SOA
arbitrário.

## 10. Riscos e decisões adiadas

| Tema | Decisão atual |
| --- | --- |
| JVM por chamada | Manter inicialmente; medir antes de criar worker persistente |
| Sessão reutilizada | Adiada por aumentar estado e exposição de segredo |
| Impersonação | Bloqueada nesta fase |
| Sessão do navegador | Não reutilizar no adaptador SOA |
| Serviços `Internal-*` | Bloqueados por padrão |
| Catálogo completo de saved queries | Não expor |
| Conteúdo de arquivo | Fora de escopo |
| Ticket FMS | Usar somente localmente e nunca retornar |
| Múltiplos ambientes por agente | Avaliar depois do contrato de profiles |
| Operações de manutenção | Permanecem fora do módulo SOA read-only |

## 11. Dependências

- JDK suportado pelo Teamcenter 2606;
- bibliotecas oficiais Java SOA da instalação;
- ambiente Teamcenter 2606 de homologação;
- conta técnica dedicada e restrita;
- apoio do Teamcenter Admin para validar serviços, propriedades e queries;
- apoio de segurança para secret store, TLS, auditoria e retenção;
- dados de teste não sensíveis, incluindo caracteres especiais;
- acesso aos logs do WebTier, pool e tcserver para correlação.

## 12. Definition of Done

A evolução SOA estará concluída quando:

1. não existir action ampla capaz de executar todas as consultas;
2. toda entrada estiver coberta por schema e policy local;
3. toda resposta usar DTO versionado e UTF-8 explícito;
4. partial errors forem tratados e apresentados de forma segura;
5. nenhuma credencial, ticket ou segredo aparecer em resultado ou auditoria;
6. concorrência, frequência, tempo e volume forem limitados;
7. preflight detectar dependências inválidas antes da execução;
8. cada capability possuir testes positivos e negativos;
9. operações estiverem homologadas contra o SDK oficial 2606;
10. AWC, RAC, Solid Edge, WebTier, pool, banco e FMS não apresentarem regressão;
11. houver métricas, auditoria, runbook e rollback;
12. serviços internos e operações de escrita permanecerem indisponíveis.

## 13. Ordem recomendada de execução

```text
Contrato e ameaças
  → autorização granular
  → DTO/protocolo/UTF-8
  → segredos e TLS
  → preflight e classpath
  → concorrência e resiliência
  → health/session/preferences/encoding
  → objetos e saved queries
  → datasets e FMS
  → observabilidade e promoção gradual
```

Essa sequência preserva o princípio de menor privilégio: nenhuma nova
capacidade de leitura é liberada antes dos controles que limitam autorização,
conteúdo, custo e rastreabilidade.
