# 1. Allowlist nominal de variáveis de ambiente para o adaptador SOA

Date: 2026-09-01

## Status

Accepted

## Context

O bridge lança o adaptador Java SOA como processo filho. Originalmente o
código encaminhava de forma ampla todas as variáveis `TC_TEAMCENTER_*` do
ambiente do Node para o processo Java, sem saber quais delas o adaptador
realmente lê em runtime. Isso ampliava a superfície de ataque: qualquer
variável com prefixo `TC_TEAMCENTER_` vazava para o filho, inclusive
credenciais de outras integrações que por convenção usassem o mesmo prefixo.

## Decision

Toda variável que o adaptador lê foi confirmada no código-fonte de
`TeamcenterSoaAdapter.java` e centralizada em um allowlist nominal
(`JAVA_ENV_ALLOWLIST`, exportada como `SOA_ENV_ALLOWLIST`) em
`src/teamcenter-soa.js`. Apenas 14 variáveis entram no processo Java:

- sistema: `PATH`, `SystemRoot`, `WINDIR`, `TEMP`, `TMP`, `USERPROFILE`,
  `JAVA_HOME`;
- integração Teamcenter: `TC_TEAMCENTER_URL`, `TC_TEAMCENTER_USER`,
  `TC_TEAMCENTER_PASSWORD`, `TC_TEAMCENTER_GROUP`, `TC_TEAMCENTER_ROLE`,
  `TC_TEAMCENTER_LOCALE`, `TC_TEAMCENTER_SOA_CLIENT_ENCODING`.

Nenhuma outra variável é propagada, mesmo que comece com `TC_TEAMCENTER_`.

## Consequences

### Positive

- Menor superfície: variáveis não autorizadas nunca alcançam o processo Java.
- Propagação explícita e auditável; adicionar variável exige mudança revisável.
- Testes unitários garantem que o allowlist é a única fonte de ambiente.

### Negative

- Toda nova variável de runtime exigida pelo adaptador precisa ser adicionada
  ao allowlist em duas pontas (Java + Node), sob risco de quebra silenciosa.
