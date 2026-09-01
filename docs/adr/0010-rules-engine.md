# 10. Rules engine para findings (alvo)

Date: 2026-09-01

## Status

Proposed

## Context

O plano (seções 6.2 e 7.5) define a pipeline Evidence → Rules → Findings →
snapshots/diffs/reports. Hoje não existe motor de regras: resultados são
retornados ao cliente sem classificação de severidade, confiança ou
recomendações estruturadas, e sem exclusão de hipóteses.

## Decision

Adotar o modelo de finding proposto:

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

Regras residem em catálogo versionado (`src/rules/catalog/`), consomem
evidências (`ADR-0009`) e produzem findings com classificação honesta —
`observed` só com evidência direta; `inferred`/`unverified` explícitos.

## Consequences

### Positive

- Conclusões estruturadas com severidade, confiança e próximo passo.
- Classificação honesta evita apresentar inferência como fato.
- Compatível com a pipeline Evidence → Rules → Findings do plano.

### Negative

- Motor de regras não implementado; exige `src/rules/engine.js` e catálogo.
- Catálogo inicial de checks/regras precisa de owners e classificação de
  impacto (Fase 0, entregas 4 e 9).
