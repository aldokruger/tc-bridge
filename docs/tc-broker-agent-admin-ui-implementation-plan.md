# Plano de implementação — interfaces administrativas do tc-broker e tc-agent

Status: proposta inicial para revisão.

## 1. Objetivo

Criar interfaces web para operar e configurar `tc-broker` e `tc-agent` sem
enfraquecer o modelo zero-trust existente.

O resultado deve permitir:

- acompanhar agentes, conexões, capabilities, tarefas e auditoria no broker;
- executar diagnósticos e o preflight SOA a partir de fluxos guiados;
- validar, revisar e aplicar configurações não sensíveis;
- cadastrar ou substituir segredos somente no host que os consome;
- identificar quais mudanças entram em vigor imediatamente e quais exigem
  reinício;
- manter compatibilidade com as variáveis de ambiente atuais durante a
  migração.

## 2. Resultado esperado

```text
                         HTTPS + OIDC/MFA
Operador ──────────────────────────────────> Console do Broker
                                                   │
                                             Broker HTTP
                                                   │
                                      capability curta e auditada
                                                   │
                                            mTLS / WebSocket
                                                   ▼
                                         tc-agent no host TC
                                                   │
Administrador local ── localhost + sessão ──> Console do Agent
                                                   │
                                      configuração e segredos locais
```

Uma base visual poderá ser reutilizada pelos dois consoles, mas cada processo
terá sua própria interface HTTP, autenticação, autorização e conjunto de
operações. Não haverá endpoint administrativo genérico compartilhando a mesma
autoridade entre broker e agente.

## 3. Estado atual relevante

### 3.1 tc-broker

- `bin/tc-broker.js` carrega configuração exclusivamente de variáveis de
  ambiente na inicialização.
- O canal `/agent` usa WebSocket com mTLS e valida o CN do certificado contra o
  `agent_id`.
- A porta HTTPS/MCP usa Bearer token e expõe somente listagem de agentes e
  despacho de tarefas autorizadas.
- `TC_BROKER_ALLOWED_ACTIONS` é convertido em um `Set` imutável durante o
  startup.
- Agentes e tarefas pendentes ficam somente em memória.

### 3.2 tc-agent

- `bin/tc-agent.js` usa o mesmo `loadConfig()` do bridge e exige configuração
  completa antes de conectar ao broker.
- A conexão é sempre iniciada pelo agente e usa certificado cliente, chave
  privada e CA do broker.
- O agente valida capability, emissor, audiência, escopo, expiração e replay
  antes de executar uma ação.
- A auditoria local é JSONL.
- Não existe listener HTTP administrativo local.

### 3.3 Limitações para uma interface gráfica

- editar `process.env` não persiste configuração nem atualiza um processo já
  iniciado;
- `.env` não oferece revisão, concorrência, versionamento ou rollback;
- retornar configuração diretamente ao navegador pode vazar senhas, tokens e
  caminhos sensíveis;
- loopback reduz exposição, mas não substitui autenticação, proteção de origem
  e CSRF;
- o token MCP atual representa um serviço, não uma identidade humana com
  papéis administrativos.

## 4. Princípios e invariantes

1. **Segredos permanecem locais.** Senha Teamcenter, chave privada do agente e
   material de assinatura do broker nunca atravessam o canal broker–agent.
2. **Negação por padrão.** Uma configuração ausente, inválida ou sem policy não
   habilita novas ações.
3. **Sem alteração remota silenciosa.** A primeira versão não permite ao
   broker modificar a configuração do agente.
4. **Interface administrativa separada da interface MCP.** Autenticação e
   autorização humanas não reutilizam `TC_TOKEN` ou
   `TC_BROKER_API_TOKEN`.
5. **Segredos são write-only.** A interface informa apenas estado como
   `configured`, `missing` ou `invalid`; nunca retorna o valor.
6. **Toda mudança é planejada antes de aplicada.** O operador vê diff,
   validações, impacto e necessidade de restart.
7. **Concorrência explícita.** Aplicação exige a revisão esperada da
   configuração para impedir sobrescrita perdida.
8. **Persistência atômica e recuperável.** Escrita usa arquivo temporário,
   `rename`, backup limitado e rollback explícito.
9. **Auditoria obrigatória.** Login, tentativa, validação, aplicação, rollback,
   preflight e restart geram eventos sem segredos.
10. **Bind seguro.** O console do agente escuta somente em loopback. O console
    do broker usa HTTPS com certificado confiável.

## 5. Escopo da primeira versão

### 5.1 Console do Broker

- dashboard de conectividade;
- agentes conectados, versão, horário de conexão e estado;
- edição da allowlist `TC_BROKER_ALLOWED_ACTIONS`;
- configuração de TTL e subject das capabilities;
- visualização sanitizada de tarefas e auditoria;
- execução de `preflight` e health checks já allowlisted;
- indicação de configurações bloqueadas por variável de ambiente;
- fluxo de validação, diff, aplicação e restart controlado.

### 5.2 Console local do Agent

- estado da conexão com o broker e tentativas de reconexão;
- configuração de identidade, endpoints e caminhos locais;
- flags granulares de Browser, SOA, MSSQL, logs e diagnósticos;
- formulário SOA para Java, adapter JAR, biblioteca, truststore e controles de
  carga;
- cadastro write-only de credenciais Teamcenter e MSSQL;
- execução local de preflight e apresentação estruturada do resultado;
- visualização da auditoria local com paginação e mascaramento;
- validação, diff, aplicação, rollback e orientação de restart.

### 5.3 Fora do escopo inicial

- shell, PowerShell, SQL ou JavaScript arbitrário;
- edição remota de senha, certificado ou chave privada do agente;
- distribuição automática de configuração do broker para agentes;
- rotação automática de certificados sem integração com uma PKI aprovada;
- atualização automática do binário;
- alteração de configurações Teamcenter, banco ou sistema operacional;
- editor livre de JSON para policies de segurança em produção.

## 6. Decisões arquiteturais propostas

### 6.1 Um módulo profundo de configuração

Introduzir um módulo `ConfigurationManager` como único seam para CLI, console
web e testes. Sua interface deve permanecer pequena:

```js
configurationManager.snapshot()
configurationManager.plan(change, expectedRevision)
configurationManager.apply(planId)
configurationManager.rollback(revision)
```

O módulo esconde:

- composição de defaults, arquivo e ambiente;
- validação Zod;
- redação de segredos;
- campos bloqueados por variável de ambiente;
- classificação entre hot reload e restart;
- diff seguro;
- controle de revisão;
- persistência atômica e backup;
- registro de auditoria.

CLI, HTTP e testes devem usar essa mesma interface. Nenhum handler HTTP deve
editar arquivo ou variável de ambiente diretamente.

### 6.2 Precedência de configuração

Manter a seguinte precedência:

```text
defaults < arquivo gerenciado < variáveis de ambiente < argumentos CLI
```

Consequências:

- a UI escreve somente no arquivo gerenciado;
- um valor definido por ambiente ou CLI aparece como `locked` na UI;
- a UI pode explicar qual fonte efetiva venceu sem revelar o valor de um
  segredo;
- remover um override exige ação fora da UI e restart do serviço;
- a migração não quebra instalações que continuam usando `.env`.

### 6.3 Arquivos gerenciados

Usar JSON versionado para evitar uma nova dependência de parser:

- broker: `TC_BROKER_CONFIG_FILE`;
- agente: `TC_AGENT_CONFIG_FILE`;
- `schemaVersion: 1` obrigatório;
- permissões restritas à conta do serviço;
- diretório e nome definidos pelo instalador, não pelo navegador;
- no máximo cinco backups locais, sem segredos em texto claro.

Exemplo sanitizado:

```json
{
  "schemaVersion": 1,
  "revision": 12,
  "broker": {
    "allowedActions": ["teamcenter.soa.preflight"],
    "capabilityTtlSeconds": 60,
    "subject": "tc-admin-console"
  }
}
```

No agente, campos secretos usam referência:

```json
{
  "teamcenter": {
    "url": "https://tc.example.com/tc",
    "user": "tc_bridge_reader",
    "passwordSecretRef": "credential://tc-agent/teamcenter-password"
  }
}
```

### 6.4 Armazenamento de segredos

Definir um seam `SecretStore` com pelo menos dois adapters reais:

- `EnvironmentSecretStore`: compatibilidade read-only com implantação atual;
- `WindowsCredentialSecretStore`: produção no host do agente;
- adapter futuro para secret manager do ambiente do broker.

Interface proposta:

```js
secretStore.status(reference)
secretStore.put(reference, value)
secretStore.remove(reference)
```

`status()` nunca retorna o segredo. `put()` deve aceitar o valor apenas no body
da requisição, mantê-lo fora de logs e limpar referências assim que possível.

### 6.5 Aplicação e restart

Cada campo de configuração terá uma classificação:

- `hot`: pode substituir estado imutável por uma nova revisão validada;
- `reconnect`: exige reconstruir a conexão reversa;
- `restart`: exige reiniciar o processo;
- `external`: é controlado por variável de ambiente, serviço ou secret
  manager externo.

A primeira entrega pode tratar todos os campos como `restart`, exceto a
allowlist e TTL do broker quando houver testes que comprovem hot reload seguro.
É preferível um restart explícito a estado parcialmente aplicado.

O processo não deve executar `process.exit()` a partir de um handler HTTP. A UI
grava a configuração e solicita restart a um adapter do supervisor:

- Windows Service Control Manager para `tc-agent`;
- systemd, container orchestrator ou serviço equivalente para `tc-broker`;
- adapter in-memory nos testes.

### 6.6 Uma base visual, dois deployments

Criar uma SPA em React, Vite e TypeScript, compilada como assets estáticos:

```text
web/admin-ui/
  src/
    app/
    broker/
    agent/
    shared/
```

O bootstrap `GET /admin/v1/context` informa `target: broker | agent` e somente
as rotas permitidas pelo servidor são exibidas. A separação de autoridade deve
ser garantida no servidor; esconder um botão não é autorização.

Ferramentas propostas para o frontend:

- React + Vite + TypeScript;
- Zod para contratos compartilhados;
- Biome para lint e formatação;
- Vitest para módulos da UI;
- Playwright para fluxos críticos no navegador.

Não adicionar biblioteca visual grande na primeira fase. Usar tokens CSS,
componentes acessíveis pequenos e navegação por teclado.

## 7. Estrutura de módulos proposta

```text
src/
  configuration/
    schemas.js
    manager.js
    field-catalog.js
    diff.js
    sources/
      environment-source.js
      json-file-source.js
    stores/
      atomic-json-store.js
      in-memory-config-store.js
    secrets/
      environment-secret-store.js
      windows-credential-secret-store.js
      in-memory-secret-store.js
  admin/
    shared/
      auth.js
      csrf.js
      errors.js
      audit.js
    broker/
      app.js
      routes.js
      presenters.js
    agent/
      app.js
      routes.js
      presenters.js
  supervision/
    windows-service-adapter.js
    process-adapter.js
    in-memory-adapter.js
web/
  admin-ui/
```

Os presenters constroem objetos sanitizados específicos da UI. Eles não devem
retornar o objeto interno produzido por `loadConfig()`.

## 8. Contratos HTTP administrativos

Todos os contratos serão versionados em `/admin/v1` e validados com Zod.

### 8.1 Comuns

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/admin/v1/context` | Target, versão, usuário, papéis e features |
| `GET` | `/admin/v1/config` | Snapshot sanitizado, fontes e revisão |
| `POST` | `/admin/v1/config/plans` | Validar mudança e produzir diff/impacto |
| `POST` | `/admin/v1/config/plans/:id/apply` | Aplicar plano ainda válido |
| `POST` | `/admin/v1/config/rollback` | Planejar rollback para revisão anterior |
| `GET` | `/admin/v1/audit` | Eventos paginados e sanitizados |
| `GET` | `/admin/v1/health` | Saúde administrativa sem segredos |

Regras:

- `expectedRevision` obrigatório ao planejar;
- plano expira em poucos minutos e contém hash do diff;
- aplicação rejeita revisão divergente;
- erros usam códigos estáveis e não incluem stack trace;
- bodies têm limites pequenos;
- nenhuma resposta inclui token, password, chave ou conteúdo PEM.

### 8.2 Broker

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/admin/v1/agents` | Inventário e conectividade |
| `GET` | `/admin/v1/agents/:id` | Estado sanitizado do agente |
| `GET` | `/admin/v1/tasks` | Histórico de tarefas |
| `POST` | `/admin/v1/agents/:id/checks` | Executar action de health allowlisted |
| `POST` | `/admin/v1/restart` | Solicitar restart supervisionado |

O endpoint de checks reutiliza criação de capability e despacho existentes. Ele
não chama diretamente adaptadores do agente.

### 8.3 Agent local

| Método | Rota | Finalidade |
| --- | --- | --- |
| `GET` | `/admin/v1/connection` | Broker, estado e reconexões |
| `GET` | `/admin/v1/capabilities` | Ações locais efetivamente habilitadas |
| `POST` | `/admin/v1/secrets/:name` | Criar/substituir segredo write-only |
| `DELETE` | `/admin/v1/secrets/:name` | Remover segredo permitido |
| `POST` | `/admin/v1/checks/preflight` | Executar preflight local |
| `POST` | `/admin/v1/restart` | Solicitar restart supervisionado |

Os nomes de segredo devem vir de enumeração fechada. O cliente não pode enviar
uma referência ou caminho arbitrário.

## 9. Autenticação e autorização

### 9.1 Broker

Produção:

- OIDC Authorization Code + PKCE;
- MFA exigido pelo provedor de identidade;
- cookie de sessão `HttpOnly`, `Secure` e `SameSite=Strict`;
- expiração curta e reautenticação para segredos, policy e restart;
- papéis `viewer`, `operator` e `admin`.

Matriz inicial:

| Operação | viewer | operator | admin |
| --- | --- | --- | --- |
| Ver agentes e saúde | sim | sim | sim |
| Ver auditoria | sim | sim | sim |
| Executar preflight/health | não | sim | sim |
| Alterar allowlist/TTL | não | não | sim |
| Aplicar rollback/restart | não | não | sim |

Não usar `TC_BROKER_API_TOKEN` como sessão humana.

### 9.2 Agent local

- bind obrigatório em `127.0.0.1` e, quando disponível, `::1` separado;
- sessão local iniciada por código de uso único exibido no console/instalador;
- token raiz armazenado via DPAPI/Windows Credential Manager;
- cookie `HttpOnly` e `SameSite=Strict` após o pareamento local;
- validação estrita de `Origin` e `Host`;
- CSRF token em qualquer operação mutável;
- CORS desabilitado;
- rate limit de login e bloqueio temporário;
- sessão expirada após inatividade.

Loopback sem essas proteções não é suficiente, pois uma página maliciosa aberta
no navegador pode tentar alcançar serviços locais.

## 10. Experiência de uso

### 10.1 Console do Broker

1. **Visão geral:** agentes online/offline, tarefas em execução, falhas recentes
   e expiração de certificados.
2. **Agentes:** busca, tags, versão, conexão e ações efetivamente permitidas.
3. **Policies:** allowlist com descrições, impacto e dependências.
4. **Tarefas:** status, duração, action, usuário, agente e `audit_id`.
5. **Configuração:** formulário por seção, origem de cada campo, diff e impacto.
6. **Auditoria:** filtros, paginação e exportação sanitizada.

### 10.2 Console do Agent

1. **Visão geral:** conexão, versão, última tarefa, saúde e avisos.
2. **Broker e identidade:** URL, agent ID e estado dos certificados.
3. **Teamcenter SOA:** URL, conta, Java, JARs, encoding, TLS e truststore.
4. **Capabilities:** switches granulares com motivo quando bloqueados.
5. **Diagnósticos:** preflight, conexão SOA e checks locais permitidos.
6. **Auditoria local:** eventos e correlação sem conteúdo sensível.

### 10.3 Fluxo de alteração

```text
Editar formulário
  -> validar no cliente
  -> planejar no servidor
  -> mostrar diff sanitizado
  -> mostrar warnings e impacto
  -> confirmação explícita
  -> aplicar com expectedRevision
  -> informar hot reload/restart
  -> verificar health após aplicação
```

## 11. Catálogo inicial de campos

### 11.1 Broker

| Campo | UI | Segredo | Aplicação |
| --- | --- | --- | --- |
| `TC_BROKER_ALLOWED_ACTIONS` | editável | não | hot após testes |
| `TC_CAPABILITY_TTL_SECONDS` | editável | não | hot após testes |
| `TC_BROKER_SUBJECT` | editável | não | hot após testes |
| portas e bind | somente leitura inicialmente | não | restart/external |
| paths TLS | somente leitura inicialmente | sensível | restart/external |
| API token | status apenas | sim | secret manager/restart |
| chave privada de capability | status apenas | sim | secret manager/restart |
| issuer | editável com reautenticação | não | restart |

### 11.2 Agent

| Campo | UI | Segredo | Aplicação |
| --- | --- | --- | --- |
| flags `TC_ALLOW_*` | editável | não | restart inicialmente |
| `TC_AGENT_ID` | editável localmente | não | reconnect/restart |
| `TC_BROKER_URL` | editável localmente | não | reconnect/restart |
| paths de certificado/CA | seleção local | sensível | restart |
| chave privada do agente | status apenas | sim | store local/restart |
| URL/usuário Teamcenter | editável localmente | parcial | restart inicialmente |
| senha Teamcenter | write-only | sim | store local/restart |
| Java, adapter, lib e JARs extras | seleção local | não | restart inicialmente |
| encoding, TLS e truststore | editável localmente | sensível | restart inicialmente |
| controles de carga SOA | editável localmente | não | restart inicialmente |
| MSSQL host/base/usuário | editável localmente | parcial | restart inicialmente |
| senha MSSQL | write-only | sim | store local/restart |
| paths permitidos e logs | seleção local | sensível | restart inicialmente |

## 12. Fases de implementação

### Fase 0 — decisões e contratos

1. Registrar ADR para consoles separados e impossibilidade de edição remota de
   segredos do agente.
2. Registrar ADR de precedência `defaults < file < env < CLI`.
3. Definir schema versionado de broker e agente.
4. Definir catálogo de campos, sensibilidade, fonte e impacto de aplicação.
5. Definir códigos de erro administrativos.

Critério de saída: contratos revisados por segurança e operação antes de
qualquer formulário mutável.

### Fase 1 — módulo ConfigurationManager

1. Extrair schemas Zod das variáveis atuais sem mudar comportamento.
2. Implementar composição de fontes e snapshot sanitizado.
3. Implementar `plan`, diff seguro e controle de revisão.
4. Implementar store JSON atômico, backups e rollback.
5. Implementar adapters in-memory para testes.
6. Fazer `loadConfig()` consumir o novo módulo mantendo compatibilidade.

Critério de saída: CLI e testes existentes continuam passando; mudança
concorrente é rejeitada; nenhum snapshot contém segredo.

### Fase 2 — Console local do Agent somente leitura

1. Criar listener administrativo separado e obrigatório em loopback.
2. Implementar autenticação local, sessão, Origin e CSRF.
3. Expor context, health, connection, config sanitizada e capabilities.
4. Criar shell da SPA, overview, conexão e tela SOA.
5. Integrar preflight local sem passar pelo broker.
6. Exibir `configured/missing/invalid` para segredos.

Critério de saída: operador diagnostica configuração completa sem conseguir
alterá-la e sem observar qualquer segredo.

### Fase 3 — Configuração local do Agent

1. Habilitar edição de campos não sensíveis.
2. Implementar fluxo plan/apply com diff e revisão.
3. Integrar Windows Credential Manager/DPAPI para segredos.
4. Implementar seleção segura de paths locais sem aceitar path remoto
   arbitrário.
5. Integrar supervisor de serviço e verificação pós-restart.
6. Implementar rollback de configuração.

Critério de saída: instalação limpa pode ser configurada localmente, executar
preflight, reiniciar e recuperar a revisão anterior.

### Fase 4 — Console do Broker somente leitura

1. Adicionar interface HTTP administrativa separada das rotas MCP.
2. Integrar OIDC, sessão e papéis.
3. Expor agentes, tarefas, saúde e auditoria sanitizada.
4. Criar dashboard, inventário de agentes e detalhe do agente.
5. Executar preflight/health usando o mesmo fluxo de capability do MCP.
6. Persistir metadados mínimos de tarefa necessários à UI.

Critério de saída: viewer observa; operator executa checks; nenhum papel altera
policy nesta fase.

### Fase 5 — Configuração do Broker

1. Habilitar edição de allowlist, TTL e subject.
2. Exigir reautenticação e papel admin.
3. Implementar plan/apply/rollback e auditoria.
4. Tornar allowlist/TTL hot reload somente após testes de concorrência.
5. Integrar restart supervisionado para mudanças estruturais.
6. Exibir drift entre arquivo gerenciado e overrides de ambiente.

Critério de saída: alteração de policy é versionada, auditada, reversível e não
interrompe tarefas já autorizadas de forma inconsistente.

### Fase 6 — hardening e homologação

1. Threat model formal dos dois consoles.
2. Testes de CSRF, XSS, sessão, enumeração, brute force e controle de papel.
3. Testes de redaction em requests, responses, logs e auditoria.
4. Testes de corrupção de arquivo, crash durante escrita e rollback.
5. Testes Windows Service e implantação do broker.
6. Runbooks de instalação, recuperação, rotação e revogação.
7. Homologação com infraestrutura, segurança e responsáveis Teamcenter.

Critério de saída: evidências aprovadas, rollback testado e nenhuma violação das
invariantes da seção 4.

## 13. Estratégia de testes

### 13.1 Módulo de configuração

- precedência entre defaults, arquivo, ambiente e CLI;
- snapshot sanitizado e indicação de fonte;
- schemas estritos e rejeição de campos desconhecidos;
- diff sem valores secretos;
- concorrência por `expectedRevision`;
- expiração e reaplicação de plano;
- escrita atômica, backup e rollback;
- classificação de hot reload/restart/external.

Os testes devem atravessar a interface do `ConfigurationManager`, não seus
helpers internos.

### 13.2 Interfaces HTTP

- autenticação obrigatória;
- matriz de papéis;
- CSRF, Origin, Host e CORS;
- limites de body e rate limit;
- contratos Zod de request/response;
- erros sanitizados;
- tentativa de leitura/escrita de segredo;
- revisão divergente e plano expirado.

### 13.3 Integração broker–agent

- listagem e desconexão de agente;
- preflight por capability allowlisted;
- action bloqueada no broker e no agente;
- timeout, reconexão e tarefa pendente;
- auditoria com `audit_id` e correlação;
- configuração do agente nunca incluída no envelope da tarefa.

### 13.4 Frontend

- formulários e mensagens acessíveis;
- campos `locked`, `secret` e `restart required`;
- diff sanitizado;
- fluxo de conflito de revisão;
- expiração de sessão;
- Playwright para login, preflight, plan/apply e rollback.

## 14. Migração e compatibilidade

1. Entrega inicial lê somente variáveis de ambiente, como hoje.
2. O arquivo gerenciado passa a ser opcional e fica abaixo de env/CLI.
3. A UI marca overrides como bloqueados e mostra instrução para migração.
4. Um comando `tc-agent config import-env --dry-run` poderá gerar plano
   sanitizado, sem copiar segredos.
5. Segredos migram separadamente para o store local.
6. Somente após homologação considerar deprecar configuração sensível em
   `.env`; não remover suporte na primeira versão.

## 15. Observabilidade e auditoria

Eventos administrativos mínimos:

- `admin.login.succeeded/failed`;
- `config.plan.created/rejected`;
- `config.apply.started/completed/failed`;
- `config.rollback.started/completed/failed`;
- `secret.updated/removed`, sem valor;
- `preflight.started/completed/failed`;
- `service.restart.requested/completed/failed`;
- `policy.changed`;
- `session.expired/revoked`.

Cada evento deve conter timestamp, ator, target, revisão, request ID, resultado
e origem. Não registrar body de formulários sensíveis, cookie, token, PEM,
password ou URL com credencial.

## 16. Riscos e mitigação

| Risco | Impacto | Mitigação |
| --- | --- | --- |
| UI transforma agente em superfície remota | crítico | loopback, sessão local, sem CORS, sem edição remota |
| Vazamento de segredo em snapshot/diff/log | crítico | presenters sanitizados, write-only, testes de redaction |
| Token MCP usado como identidade humana | alto | OIDC/MFA e sessões administrativas separadas |
| Configuração parcialmente aplicada | alto | plano, revisão, persistência atômica e restart explícito |
| Env sobrescreve silenciosamente a UI | alto | fonte visível, campo locked e relatório de drift |
| Restart derruba tarefas em execução | alto | drain, timeout, supervisor e status pós-restart |
| Policy ampla habilita ações inesperadas | alto | catálogo fechado, diff semântico e negação por padrão |
| Página maliciosa acessa localhost | alto | Origin/Host, CSRF, sessão e rate limit |
| Crescimento excessivo do frontend | médio | uma SPA compartilhada e módulos por target |
| Auditoria JSONL não escala no broker | médio | adapter de store e persistência central antes de produção |

## 17. Critérios de aceite gerais

- Nenhuma resposta administrativa contém segredo ou material criptográfico.
- Broker não consegue alterar segredo ou arquivo de configuração do agente.
- Agent console não aceita conexão fora de loopback.
- Toda mudança mostra diff, impacto, revisão e necessidade de restart.
- Mudanças concorrentes são rejeitadas sem perda de dados.
- Configuração inválida nunca substitui a revisão ativa.
- Rollback restaura uma revisão previamente validada.
- Preflight pode ser executado localmente e pelo broker conforme allowlists.
- Actions continuam protegidas pelas policies atuais, independentemente da UI.
- Autorização é validada no servidor em todos os endpoints mutáveis.
- Testes de backend, frontend, integração, lint, typecheck e Biome passam.
- Instalação e recuperação possuem runbook testado.

## 18. Ordem recomendada

1. ADRs e contratos de configuração.
2. `ConfigurationManager` e adapters in-memory.
3. Console local do Agent somente leitura.
4. Edição local, secret store e restart supervisionado.
5. Console do Broker somente leitura com OIDC.
6. Edição controlada da policy do Broker.
7. Hardening, empacotamento e homologação.

Essa ordem entrega valor de diagnóstico cedo, mantém as superfícies mutáveis
atrás de módulos testados e evita introduzir controle remoto de segredos como
efeito colateral de uma interface gráfica.
