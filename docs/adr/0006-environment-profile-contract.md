# 6. Contrato EnvironmentProfile (alvo)

Date: 2026-09-01

## Status

Proposed

## Context

O plano (`docs/tc-agent-teamcenter-qa-prd-analysis-implementation-plan.md`,
seção 7.1) define o `EnvironmentProfile` como o contrato que representa uma
configuração Teamcenter conhecida pelo agente. Hoje a configuração representa
um ambiente por processo, sem identidade imutável nem separação QA/PRD formal.
Um host com várias instalações pode selecionar `TC_DATA` incorreto.

## Decision

Adotar o schema proposto:

```json
{
  "schemaVersion": 1,
  "environmentId": "tc2606-dev",
  "classification": "QA",
  "displayName": "Teamcenter 2606 DEV",
  "teamcenterRelease": "2606",
  "hosts": ["SRV26-TC1-DEV"],
  "expectedComponents": ["server-manager", "webtier", "gateway", "fsc"],
  "policyProfile": "qa-standard"
}
```

Paths, URLs e credenciais permanecem na configuração local protegida; o broker
recebe apenas identificadores e metadados. Perfil inválido impede somente o
ambiente afetado, não o agente inteiro.

## Consequences

### Positive

- Identidade imutável por ambiente; diferencia instalações no mesmo host.
- Separação QA/PRD explícita via `classification` e `policyProfile`.
- Base para registro local de ambientes e validação na inicialização.

### Negative

- Não implementado: requer `src/environments/` e migração compatível.
- Contrato novo exige testes de schema antes de ampliar collectors.
