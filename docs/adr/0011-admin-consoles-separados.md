# 11. Consoles administrativos separados e segredos do agente somente locais

Date: 2026-09-01

## Status

Accepted

## Context

O pacote expõe dois executáveis com papéis distintos: `tc-broker` (canal mTLS
reverso + API MCP de despacho) e `tc-agent` (host Teamcenter, valida capabilities
e executa tarefas autorizadas). A administração atual é feita por variáveis de
ambiente na inicialização — editar `process.env` não persiste configuração nem
atualiza um processo já iniciado, e `.env` não oferece revisão, concorrência,
versionamento ou rollback.

Ao desenhar a interface gráfica administrativa (plano §2 e §6), surgiu a
tentação de um único endpoint administrativo genérico reutilizado por ambos os
processos. Isso unificaria a UI, mas criaria uma autoridade administrativa
compartilhada entre broker e agente, misturando superfícies de ataque e
semânticas de autenticação distintas.

## Decision

Cada processo terá seu próprio console HTTP local: autenticação, autorização,
conjunto de operações e listener próprios. Uma base visual poderá ser
reutilizada, mas não haverá endpoint administrativo genérico compartilhando a
mesma autoridade entre broker e agente.

O console do agente escuta somente em loopback e inicia sessão local por código
de uso único exibido no próprio console. Segredos do agente (`TC_TOKEN`,
`TC_TEAMCENTER_PASSWORD`, `TC_DB_PASSWORD`, material criptográfico) são
write-only: a UI exibe apenas status ("configurado" ou não), nunca o valor, e
nenhuma operação remota de edição de segredo do agente é exposta — segredos são
registrados no ambiente protegido do processo/serviço no host, fora da
superfície HTTP.

## Consequences

### Positive

- Superfícies de ataque separadas: comprometer o console do broker não concede
  autoridade sobre a configuração do agente (e vice-versa).
- Segredos do agente nunca cruzam a interface HTTP nem chegam ao navegador.
- Autenticação e autorização podem evoluir de forma independente por processo.

### Negative

- Duas UIs para manter (mitigado por base visual compartilhada).
- Usuário precisa autenticar em cada console separadamente.

## References

- Plano: seção 2 (arquitetura) e seção 6.1 (módulo profundo de configuração).
- Decisão registrada na Fase 0 do plano (item 1).
