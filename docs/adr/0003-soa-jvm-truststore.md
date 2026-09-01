# 3. Truststore JVM explícito para TLS SOA

Date: 2026-09-01

## Status

Accepted

## Context

O cliente SOA Java conversa com o WebTier Teamcenter. Em ambientes com
certificados de CA privada, o JVM padrão não confia no certificado do servidor
e a conexão falha; em ambientes sem requisito de TLS, a URL poderia ser
enviada em texto claro. O processo Java herda a JVM embutida do Node, sem
controle explícito do truststore.

## Decision

Quando `TC_TEAMCENTER_SOA_REQUIRE_TLS` está habilitado e/ou
`TC_TEAMCENTER_SOA_TRUST_STORE` está configurado, o spawn do adaptador passa
`-Djavax.net.ssl.trustStore=<caminho>` ao JVM (em `src/teamcenter-soa.js`).
O caminho do truststore é validado antes do spawn, e o preflight reporta o
estado da configuração TLS.

## Consequences

### Positive

- TLS com CA privada funciona sem alterar o JVM global do host.
- Explicitude: o bridge decide qual truststore o adaptador usa.
- Requisito de TLS reduz risco de credencial em texto claro.

### Negative

- Truststore JKS precisa ser mantido em sincronia com a CA do WebTier.
- Certificado expirado/revogado exige atualização manual do arquivo JKS.
