# 12. Precedência de configuração: defaults < arquivo gerenciado < env < CLI

Date: 2026-09-01

## Status

Accepted

## Context

`loadConfig()` em `src/config.js` compõe hoje a configuração do agente
exclusivamente de variáveis de ambiente e argumentos CLI, com defaults
embutidos no código. O plano de console administrativo introduz um arquivo de
configuração gerenciado (JSON com revisão) como nova fonte de valor, o que
exige uma ordem determinística entre defaults, arquivo, ambiente e CLI — tanto
para a UI marcar campos como "locked" (fonte que sobrescreve) quanto para o
usuário prever o resultado da composição.

## Decision

Manter a seguinte precedência, da menor para a maior autoridade:

```text
defaults < arquivo gerenciado < variáveis de ambiente < argumentos CLI
```

`ConfigurationManager` (plano §6.1) é o único seam que aplica essa ordem, para
CLI, console web e testes. Nenhum handler HTTP edita arquivo ou variável de
ambiente diretamente. A fonte vencedora de cada campo é rastreada e exposta no
snapshot para a UI marcar campos locked.

Na Fase 1 (slice A), o arquivo gerenciado ainda não participa da composição de
`loadConfig()` — o entry point continua lendo env/CLI com os mesmos defaults, e
`composeEffectiveSync()` ignora o documento gerenciado até a Fase 2, quando
testes de equivalência de mensagens de erro validarem a inclusão do arquivo.

## Consequences

### Positive

- Ordem determinística e previsível; a UI sabe exatamente qual fonte venceu.
- CLI continua sendo a autoridade máxima para override pontual (ex.: `--port`).
- Ambiente pode sobrescrever o arquivo sem edição destrutiva do mesmo.

### Negative

- Um valor definido em env "esconde" silenciosamente o valor do arquivo —
  mitigado pela exposição de `source` por campo no snapshot.

## References

- Plano: seção 6.2 (precedência de configuração).
- `src/configuration/sources/environment-source.js` (implementação da ordem).
- Decisão registrada na Fase 0 do plano (item 2).
