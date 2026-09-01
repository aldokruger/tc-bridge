# 8. Contrato do Collector SDK (alvo)

Date: 2026-09-01

## Status

Proposed

## Context

O plano (seção 6.2 e Fase 1, entrega 6) define o Collector SDK como o contrato
comum para diagnósticos versionados. Hoje os collectors (SOA, host, SQL,
browser, logs) são handlers com formas distintas: sem contrato comum, não há
budget, timeout, truncamento e partial errors uniformes nem envelope único de
resultado entre eles.

## Decision

Adotar um contrato de collector com:

- `collector_id` e `collector_version` obrigatórios em todo resultado;
- contrato de execução: budget, timeout, truncamento e partial errors;
- envelope único de resultado (`CheckResult`, ADR-0007);
- compatibilidade com as actions atuais durante a migração incremental;
- negação por padrão: collector só roda se action autorizada por policy.

O collector SOA já materializa parte do contrato (gate com concurrency,
queue limit, rate limit, timeout, sanitização, correlation ID e telemetria na
auditoria — ADR-0004).

## Consequences

### Positive

- Todos os collectors produzem resultado com schema e versão.
- Budget/truncamento/partial errors uniformes e testáveis.
- Migração incremental sem quebrar os contratos existentes.

### Negative

- Exige reescrever collectors existentes para o envelope comum.
- Adiciona indireção (SDK) que precisa de testes antes de ampliar o catálogo.
