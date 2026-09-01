# 2. Fingerprint SHA-256 do adapter JAR no preflight

Date: 2026-09-01

## Status

Accepted

## Context

O bridge executa `TeamcenterSoaAdapter.jar` compilado a partir de código
local. Sem verificação, um JAR corrompido, substituído ou em versão duplicada
no diretório de bibliotecas passaria despercebido até falhar em runtime, e o
preflight não distinguiria o artefato esperado de um arbitrário.

## Decision

A função `soaAdapterFingerprint(cfg)` em `src/teamcenter-soa.js` computa:

- SHA-256 do `adapter JAR` apontado por `TC_TEAMCENTER_SOA_ADAPTER_JAR`;
- flag de corrupção baseada no magic ZIP (`PK\x03\x04`) e na existência do
  arquivo;
- detecção de JARs duplicados/versões conflitantes no diretório de libs.

O preflight em `src/tools.js` expõe o resultado como `adapter_sha256` e
`adapter_jar_corrupt` no payload de `teamcenter.soa.preflight`.

## Consequences

### Positive

- Integridade do artefato verificada antes da primeira chamada SOA.
- Fingerprint estável permite comparar o JAR instalado entre hosts e builds.
- Corrupção vira condição visível de preflight, não erro obscuro de runtime.

### Negative

- Rebuilds do adapter exigem recálculo; o fingerprint muda a cada compilação.
- Detecção de versões duplicadas é heurística baseada em nome/versão do JAR.
