# 7. Contrato CheckResult (alvo)

Date: 2026-09-01

## Status

Proposed

## Context

O plano (seção 7.3) define `CheckResult` como o envelope único de resultado
de um check, carregando identidade, duração, impacto e evidências. Sem esse
contrato, cada collector expõe resultado com forma própria, e budget, timeout,
truncamento e partial errors não são comparáveis entre checks.

## Decision

Adotar o schema proposto:

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

Esse contrato absorve a telemetria já propagada à auditoria
(ADR-0004: `duration_ms`, `truncated`, `partial_errors`, `warnings`) e a
estende com referências a evidências e identidade de ambiente/componente.

## Consequences

### Positive

- Um envelope único para todos os collectors (Fase 1, entrega 8).
- Campos de budget/truncamento/partial errors testáveis e versionados.
- Compatível com a telemetria de auditoria já implementada.

### Negative

- Não implementado: collectors atuais ainda não emitem `CheckResult`.
- Exige `evidence_refs` → dependência do modelo de evidência (ADR-0009).
