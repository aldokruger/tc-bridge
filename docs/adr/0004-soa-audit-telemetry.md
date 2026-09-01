# 4. Propagação de telemetria do adapter para a auditoria

Date: 2026-09-01

## Status

Accepted

## Context

A auditoria JSONL das tarefas autorizadas registrava apenas campos básicos
(`status`, `agent_id`, `user_id`, `action`, `jti`). Erros SOA perdiam o
código estável do envelope (`envelope.error.code`) e resultados bem-sucedidos
perdiam duração, volume, truncamento, warnings e erros parciais — exatamente
os sinais necessários para diagnosticar incidentes de volume, lentidão e
corrupção de dados sem repetir a chamada.

## Decision

Em `src/zero-trust/task-runner.js`, a função `auditTelemetry(result)` extrai
do resultado do handler, quando presentes, os campos:

- `duration_ms` (de `_meta.durationMs`);
- `correlation_id` (de `_meta.correlationId`);
- `truncated`;
- `partial_error_count`;
- `warning_count`;
- `volume_bytes` (tamanho do JSON serializado do resultado).

No caminho de falha, o `error.code` (anexado pelo adaptador SOA em
`runTeamcenterSoa` a partir de `envelope.error.code`) é gravado como
`error_code` no registro de auditoria.

## Consequences

### Positive

- Auditoria autossuficiente: duração, volume e erros parciais sem reexecutar.
- Código estável do adaptador chega à auditoria em falhas SOA.
- Campos omitidos quando ausentes mantêm compatibilidade com handlers não-SOA.

### Negative

- Volume é aproximado (tamanho do JSON no Node, não do envelope Java).
- Registros de auditoria crescem com a telemetria.
