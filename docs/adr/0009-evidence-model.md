# 9. Modelo de evidência (alvo)

Date: 2026-09-01

## Status

Proposed

## Context

O plano (seção 7.4) define `Evidence` como a observação sanitizada que dá
lastro a conclusões. Sem modelo de evidência, `CheckResult` não tem
`evidence_refs` utilizáveis, findings não apontam para provas e o bundle de
suporte não pode ser montado com retenção e redação definidas.

## Decision

Adotar o schema proposto:

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

Princípios vinculados: evidence-first (toda conclusão aponta para evidências
observadas), payload sempre sanitizado, hash SHA-256 para integridade e classe
de retenção para o bundle de suporte/auditoria.

## Consequences

### Positive

- CheckResults referenciam evidências verificáveis (ADR-0007).
- Sanitização e hash são parte do contrato, não convenção.
- Base para bundles de suporte e comparação QA/PRD.

### Negative

- Requer `src/evidence/` (schemas, store, redaction, bundle) ainda não criado.
- Payloads precisam de redator central reforçado (Fase 2) antes de ampliar.
