# 5. Defaults deny-by-default para preferences, objects e queries

Date: 2026-09-01

## Status

Accepted

## Context

O master switch `TC_ALLOW_TEAMCENTER_READ` habilita o coletor SOA. Sem
decisão explícita, preferences/objects/queries herdariam esse master switch e
estariam ativas em qualquer ambiente que ligasse o coletor — incluindo PRD.
O plano exige perfis distintos: PRD inicia somente com preflight/health.

## Decision

Em `src/config.js`, as flags granulares passam a ter padrão `false` e **não
herdam** do master switch:

- `allowTeamcenterSoaPreferences`;
- `allowTeamcenterSoaObjects`;
- `allowTeamcenterSoaQueries`.

Ativar qualquer uma delas exige flag granular explícita **e** perfil
correspondente na policy local (`TC_TEAMCENTER_SOA_POLICY_FILE`). Dataset e
FMS permanecem desabilitados por padrão até homologação contra a distribuição
SOA instalada.

## Consequences

### Positive

- PRD seguro por construção: sem flag explícita, só preflight/health rodam.
- Fail-closed: flag esquecida resulta em action rejeitada, não em dado exposto.
- Compatível com a matriz QA/PRD do plano (8.1).

### Negative

- Configuração mais verbosa para QA (cada capacidade exige flag + policy).
- Operador precisa conhecer as flags granulares para habilitar coletas.
