# ADR-0001: Separacao de tools locais e actions remotas no chat do broker

Status: aceito
Data: 2026-09-02

## Contexto

O console administrativo do broker expoe um chat com LLM. Todas as tools
apresentadas ao modelo derivavam de `allowedActions` e eram despachadas ao
agente Windows via capability Ed25519. Isso funciona para acoes de coleta de
evidence, mas e inadequado para operacoes que pertencem ao proprio broker:

- pesquisa em documentacao Siemens (nao precisa do agente);
- geracao e validacao de rascunhos (sem side effects, executadas no broker);
- montagem de contexto a partir de multiplas fontes (orquestracao local).

Despachar essas operacoes ao agente criaria capabilities desnecessarias,
aumentaria a latencia e confundiria a superficie de ataque: o agente nao
deveria ter permissao para acessar o gateway documental nem criar rascunhos.

## Decisao

Criar um `ChatToolRegistry` com dois adapters:

1. `LocalToolAdapter` — executa tools no processo do broker (sem capability).
2. `AgentActionAdapter` — despacha actions ao agente via capability (comportamento existente).

O `runChatTurn` recebe um `toolRegistry` opcional. Quando presente, usa-o
para `list()` e `execute()`. Quando ausente, mantem o comportamento legado,
garantindo compatibilidade com testes e integracoes existentes.

As tools locais sao controladas por uma allowlist separada:
`TC_BROKER_ALLOWED_LOCAL_TOOLS`. Elas nunca entram em
`TC_BROKER_ALLOWED_ACTIONS`.

## Consequencias

- Superficie de ataque reduzida: o agente nao recebe capabilities para
  operacoes que nao precisa executar.
- Latencia menor para operacoes puramente locais.
- Testes mais simples: o fake adapter substitui o transporte sem mockar
  capabilities.
- Risco de confusao: e preciso documentar claramente que
  `allowedActions` != `allowedLocalTools`.

## Alternativas rejeitadas

1. Criar capabilities remotas para busca documental: rejeitado porque
   aumentaria a superficie do agente sem beneficio.
2. Expor tools locais como actions genericas do agente: rejeitado porque
   quebraria o principio de menor privilegio.

## Implementacao

- `src/chat-tools/registry.js`
- `src/chat-tools/agent-action-adapter.js`
- `src/chat-tools/local-tool-adapter.js`
- `src/chat-tools/broker-local-tools.js`
- Modificacoes em `src/zero-trust/llm-chat.js` e `src/zero-trust/admin-console.js`
