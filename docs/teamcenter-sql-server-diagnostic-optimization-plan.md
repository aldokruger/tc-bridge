# Plano de diagnóstico e otimização do SQL Server — Teamcenter 2606

Status: planejado. Diagnóstico inicial executado em 2026-09-01 no banco
`tc_DEV_2026`. Nenhuma alteração de banco está autorizada por este documento.

## 1. Objetivo

Completar o diagnóstico de desempenho do SQL Server utilizado pelo Teamcenter,
transformar os achados em mudanças controladas e validar os resultados em
homologação antes de qualquer aplicação em produção.

O plano cobre:

- uso real, crescimento, VLFs e retenção do transaction log;
- recovery model, backups e integridade do banco;
- Query Store, consultas, planos e regressões;
- estatísticas e índices;
- latência de I/O e capacidade dos discos;
- memória, paralelismo e `tempdb`;
- deadlocks, bloqueios e jobs do SQL Agent;
- validação funcional do AWC, RAC e Solid Edge.

## 2. Princípios e limites

1. A coleta inicial deve ser somente leitura.
2. O `tc-agent` não deve aceitar SQL arbitrário.
3. Toda execução deve possuir limite de linhas, timeout e registro de auditoria.
4. Não executar `SHRINK`, `ALTER INDEX`, `UPDATE STATISTICS`, `DBCC CHECKDB`
   completo ou alteração de configuração sem aprovação e janela definida.
5. Não criar, remover ou alterar índices Teamcenter sem identificar sua origem e
   validar compatibilidade com Teamcenter/BMIDE.
6. Cada mudança deve possuir evidência, risco, rollback e comparação antes/depois.
7. Alterações devem ser testadas individualmente em homologação.

## 3. Baseline já coletado

O diagnóstico inicial encontrou:

- banco com collation `Latin1_General_BIN` e página de código 1252;
- arquivo de dados com aproximadamente 52,5 GB alocados e 19,7 GB utilizados;
- transaction log com aproximadamente 100 GB alocados;
- crescimento de 10% configurado nos arquivos de dados e log;
- 26 índices com mais de 1.000 páginas e fragmentação superior a 30%;
- waits acumulados relevantes em estatísticas síncronas, rede, CPU e locks;
- consultas com duração média entre 14 e 92 segundos;
- ausência de bloqueio de aplicação comprovado na amostra instantânea coletada.

As métricas de waits e consultas existentes são acumuladas na instância. Elas não
podem ser atribuídas exclusivamente ao banco Teamcenter sem correlação pelo Query
Store ou pelo contexto do banco.

## 4. Fase 1 — ampliar os diagnósticos do tc-agent

Adicionar operações MSSQL allowlisted e somente leitura:

| Check | Finalidade |
| --- | --- |
| `transaction_log_health` | Uso do log, retenção, transações abertas e VLFs. |
| `backup_history` | Histórico de backups full, differential e log. |
| `checkdb_history` | Evidências de execução e resultado do último `DBCC CHECKDB`. |
| `query_store_status` | Estado, tamanho, retenção e modo de captura do Query Store. |
| `statistics_health` | Idade, alterações e amostragem das estatísticas. |
| `index_usage` | Seeks, scans, lookups, updates e custo de escrita. |
| `index_redundancy` | Índices duplicados, sobrepostos e possivelmente redundantes. |
| `file_io_latency` | Latência, operações e bytes por arquivo. |
| `server_configuration` | Memória, CPU, `MAXDOP` e cost threshold. |
| `tempdb_health` | Arquivos, crescimento, capacidade e contenção do `tempdb`. |
| `blocking_history` | Deadlocks e bloqueios históricos disponíveis. |
| `sql_agent_jobs` | Jobs, agenda, duração, falhas e sobreposição. |

### Requisitos de implementação

- consultas definidas e versionadas no código;
- usuário SQL dedicado e com menor privilégio;
- nenhum DDL, DML, `KILL` ou comando enviado pelo cliente;
- limite máximo de resultados;
- timeout específico por check;
- ocultação ou resumo de textos SQL sensíveis;
- auditoria com agente, check, horário, duração e resultado;
- testes unitários de validação, SQL permitido, limites e erros;
- documentação das permissões SQL necessárias.

### Critério de saída

Todos os checks executam em homologação, são somente leitura, possuem testes e
não expõem credenciais ou conteúdo sensível.

## 5. Fase 2 — transaction log, recovery e backups

### Coleta

- tamanho alocado e percentual utilizado do log;
- `log_reuse_wait_desc`;
- transações abertas e sua duração;
- quantidade, tamanho e estado dos VLFs;
- recovery model;
- último backup full, differential e log;
- duração, tamanho e resultado dos backups;
- continuidade da cadeia de backups de log;
- jobs responsáveis pelos backups;
- espaço disponível no volume do log.

### Análise

- determinar por que o log atingiu aproximadamente 100 GB;
- verificar se existe retenção por backup, transação, replicação ou outro motivo;
- comparar o crescimento do log com as maiores cargas e manutenções;
- definir tamanho operacional esperado e reserva de capacidade;
- avaliar substituição de `FILEGROWTH=10%` por crescimento fixo;
- verificar quantidade e distribuição dos VLFs.

### Restrições

- não executar shrink como manutenção rotineira;
- não alterar recovery model sem análise de RPO/RTO;
- não reduzir o log antes de confirmar truncamento e necessidade futura;
- não interromper transações pelo agente.

### Critério de saída

Motivo do tamanho do log identificado, cadeia de backup validada e proposta de
tamanho/crescimento documentada com rollback.

## 6. Fase 3 — integridade e DBCC CHECKDB

1. Localizar evidência do último `DBCC CHECKDB` nos logs e jobs do SQL Agent.
2. Registrar data, duração, opções utilizadas e resultado.
3. Caso não exista execução recente, preparar uma estimativa de duração e I/O.
4. Programar inicialmente `PHYSICAL_ONLY` em janela aprovada, se adequado.
5. Programar o `DBCC CHECKDB` completo conforme política do DBA.
6. Registrar qualquer erro de alocação ou consistência como incidente crítico.

O `tc-agent` deve consultar histórico e evidências. A execução do DBCC completo
deve permanecer fora do diagnóstico automático.

### Critério de saída

Existe evidência recente de integridade sem erros ou uma execução controlada está
agendada com responsáveis e janela definidos.

## 7. Fase 4 — Query Store e consultas

### Coleta

- `actual_state_desc` e `desired_state_desc`;
- tamanho atual, limite e espaço disponível;
- capture mode;
- intervalo de agregação e retenção;
- política de limpeza;
- queries com maior CPU, duração, leituras e execuções;
- planos existentes por query;
- regressões de plano;
- waits por query, quando suportado.

### Correlação prioritária

Identificar banco, texto, plano e origem dos hashes:

- `0x2FA0E221BFA5D2C7`;
- `0x3503F279BB8263D8`;
- `0x6CDCD478082F6CF2`;
- `0x175ED7CC7BCE671F`;
- `0x72B45E24D60546E6`.

Se o Query Store estiver desabilitado, preparar uma configuração proposta. A
ativação requer aprovação, definição de tamanho, retenção e modo de captura.

### Critério de saída

As consultas prioritárias estão atribuídas ao banco e associadas a seus planos,
objetos, consumo e intervalo de ocorrência.

## 8. Fase 5 — estatísticas

### Coleta

- data da última atualização;
- quantidade de linhas;
- `modification_counter`;
- percentual e quantidade de linhas amostradas;
- estatísticas automáticas, manuais e pertencentes a índices;
- estatísticas das tabelas utilizadas pelas consultas prioritárias;
- opções `AUTO_CREATE_STATISTICS`, `AUTO_UPDATE_STATISTICS` e
  `AUTO_UPDATE_STATISTICS_ASYNC`.

### Análise

- priorizar estatísticas antigas com grande volume de alterações;
- correlacionar com `WAIT_ON_SYNC_STATISTICS_REFRESH`;
- identificar tabelas de crescimento contínuo;
- distinguir atualização de estatísticas de rebuild de índices;
- evitar atualização excessiva e recompilações desnecessárias.

### Critério de saída

Lista priorizada de estatísticas a atualizar, método de amostragem, frequência e
impacto esperado documentados.

## 9. Fase 6 — índices

### Coleta

- fragmentação e quantidade de páginas;
- densidade das páginas;
- seeks, scans, lookups e updates;
- última utilização por operação;
- custo de escrita;
- índices duplicados ou sobrepostos;
- sugestões de missing indexes;
- chaves, includes e filtros;
- origem dos índices `CUSTOM_*` e `missing_index_*`;
- uptime do SQL Server, pois as DMVs de uso reiniciam com a instância.

### Classificação

Cada índice deve ser classificado como:

- rebuild;
- reorganize;
- somente atualizar estatísticas;
- manter;
- investigar redundância;
- candidato a remoção após validação Teamcenter.

A fragmentação isolada não autoriza manutenção. Tamanho, densidade, uso, custo de
escrita, tipo de armazenamento e impacto nas consultas devem ser considerados.

### Critério de saída

Plano seletivo de manutenção com ordem, duração estimada, espaço necessário,
janela, risco de bloqueio e rollback.

## 10. Fase 7 — I/O e capacidade dos discos

### Coleta

- caminho e volume de cada arquivo;
- espaço livre por volume;
- leituras e escritas por arquivo;
- bytes processados;
- tempo acumulado de leitura e escrita;
- latência média por operação;
- eventos de autogrowth;
- separação física de dados, log e `tempdb`;
- estado do Instant File Initialization.

A latência deve ser coletada em pelo menos dois momentos para calcular deltas. Um
único snapshot acumulado não representa necessariamente o comportamento atual.

### Critério de saída

Latência e capacidade documentadas por arquivo, com alertas e projeção de
crescimento definidos.

## 11. Fase 8 — memória, CPU e paralelismo

### Coleta

- versão e edição do SQL Server;
- compatibility level do banco;
- CPUs lógicas, sockets, NUMA e memória física;
- `max server memory` e `min server memory`;
- `MAXDOP`;
- `cost threshold for parallelism`;
- `optimize for ad hoc workloads`;
- pressão de memória e grants pendentes;
- waits relacionados a CPU e paralelismo.

### Análise

- reservar memória adequada para Windows, Teamcenter e outros serviços;
- correlacionar `SOS_SCHEDULER_YIELD`, `CXPACKET`, `CXCONSUMER` e `CXSYNC_PORT`;
- evitar alterar `MAXDOP` somente pela presença de waits paralelos;
- revisar consultas e planos antes de mudanças globais.

### Critério de saída

Configuração atual comparada à topologia e ao workload, com recomendações
justificadas e testáveis.

## 12. Fase 9 — tempdb

### Coleta

- quantidade de arquivos de dados;
- tamanho e crescimento de cada arquivo;
- igualdade de tamanho e growth;
- localização e espaço livre;
- tamanho do log do `tempdb`;
- contenção `PAGELATCH_*`;
- uso por version store, objetos internos e objetos de usuário.

### Critério de saída

Configuração e capacidade do `tempdb` compatíveis com a topologia e sem evidência
de contenção relevante.

## 13. Fase 10 — deadlocks, bloqueios e SQL Agent

### Deadlocks e bloqueios

- consultar deadlocks preservados pela sessão `system_health`;
- identificar sessões bloqueadoras e bloqueadas;
- registrar duração, banco, objetos e tipos de lock;
- correlacionar com jobs e horários de manutenção;
- avaliar captura controlada de bloqueios caso o histórico seja insuficiente.

### SQL Agent

- inventariar jobs habilitados e desabilitados;
- registrar agenda, duração e proprietário;
- localizar falhas e execuções canceladas;
- identificar jobs de backup, índices, estatísticas e integridade;
- localizar sobreposição entre jobs;
- comparar horários com pool manager, indexadores e uso do Teamcenter.

### Critério de saída

Deadlocks e bloqueios possuem causa provável e evidência. O calendário de jobs não
possui sobreposição crítica com o workload Teamcenter.

## 14. Fase 11 — consolidar mudanças

Agrupar alterações aprováveis em pacotes independentes:

1. observabilidade e Query Store;
2. transaction log, backups e crescimento dos arquivos;
3. estatísticas;
4. manutenção seletiva de índices;
5. memória, paralelismo e `tempdb`;
6. bloqueios e consultas específicas;
7. jobs e calendário de manutenção.

Cada pacote deve informar:

- evidência e problema tratado;
- alteração proposta;
- objetos afetados;
- pré-requisitos;
- impacto e riscos;
- janela estimada;
- validação técnica e funcional;
- rollback;
- responsável e aprovação;
- métricas antes/depois.

## 15. Fase 12 — homologação e validação

1. Registrar um baseline antes de cada pacote.
2. Aplicar apenas um pacote por vez.
3. Executar workload representativo do Teamcenter.
4. Validar login, pesquisa, criação e alteração de objetos.
5. Validar download e upload pelo FMS.
6. Validar caracteres especiais no AWC, RAC e Solid Edge.
7. Comparar CPU, duração, leituras, waits, bloqueios e crescimento dos arquivos.
8. Observar o ambiente por período suficiente para cobrir o workload normal.
9. Executar rollback caso haja regressão funcional ou de desempenho.

## 16. Critérios de conclusão

- cadeia de backups íntegra e compatível com o RPO/RTO;
- evidência recente de `DBCC CHECKDB` sem erros;
- transaction log dimensionado e sem crescimento inesperado;
- crescimento dos arquivos configurado de forma previsível;
- Query Store operacional e gravável;
- consultas prioritárias identificadas por texto e plano;
- estatísticas mantidas de forma controlada;
- índices mantidos seletivamente e sem alteração Teamcenter não suportada;
- latência e capacidade dos discos monitoradas;
- memória, paralelismo e `tempdb` avaliados;
- deadlocks, bloqueios e jobs documentados;
- ausência de regressão no AWC, RAC, Solid Edge e FMS;
- relatório final com evidências, mudanças, rollback e resultados antes/depois.

## 17. Ordem recomendada de execução

1. Implementar e testar os checks somente leitura do `tc-agent`.
2. Coletar log, backups, integridade e capacidade dos discos.
3. Coletar Query Store, consultas, estatísticas e índices.
4. Coletar configurações da instância, `tempdb`, bloqueios e jobs.
5. Consolidar o relatório e priorizar riscos.
6. Preparar pacotes de mudança com rollback.
7. Aplicar e medir em homologação.
8. Obter aprovação dos responsáveis por Teamcenter, banco e infraestrutura.
9. Programar produção e monitoramento pós-mudança.

