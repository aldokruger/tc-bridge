# Plano de evolução do tc-bridge

Status: Fase 1 concluída em 2026-08-28. Fase 2 em andamento; controles de token e leitura/cópia concluídos localmente e aguardando implantação homologada.

## Objetivo

Transformar o bridge MCP de apoio à manutenção do Teamcenter em uma ferramenta operacional previsível: acesso mínimo necessário, trilha de auditoria, diagnósticos seguros e implantação confiável em hosts Windows restritos.

O bridge não deve se tornar um terminal remoto genérico. A execução deve ser feita somente por operações declaradas, versionadas e autorizadas.

## Princípios e limites

- Manter o processo escutando somente em `127.0.0.1`; o acesso externo é exclusivamente por túnel de saída.
- Separar leitura, diagnóstico e manutenção em perfis independentes.
- Exigir autorização explícita para cada superfície de escrita ou execução.
- Não registrar tokens, senhas, conteúdo de arquivos de segredo ou URLs assinadas em logs.
- Priorizar comandos de fabricante para ações que alteram Teamcenter/Solr. Nunca inventar uma rotação ou uma sincronização de credencial.
- Cada mudança operacional deve possuir validação e rollback documentados.

## Fase 1 — baseline de segurança e operação (concluída)

### Escopo executado

Foram inspecionados o servidor MCP, CLI, configuração, túnel, ferramentas e testes atuais. Não houve alteração comportamental nesta fase.

### Inventário atual

| Superfície | Estado atual | Controle existente |
| --- | --- | --- |
| Transporte MCP | HTTP streamable em `/mcp`; bind padrão `127.0.0.1:4100` | Bearer token com comparação em tempo constante |
| Túnel | `localtunnel`, `cloudflared` temporário ou URL estática | Processo local só aceita saída; URLs temporárias não são estáveis |
| Leitura | `list_dir`, `read_file`, `stat_file`, `search_files`, `list_tree`, `grep_content` | Limites de tamanho/profundidade; não há whitelist de leitura |
| Cópia | `copy_to_staging` | Diretório de destino configurável; origem continua sem limite de caminho |
| Escrita | `write_file` | Desativada por padrão; requer `TC_ALLOW_WRITE` e `TC_ALLOWED_WRITE_PATHS` |
| Diagnóstico | `path_exists`, `service_status`, `tcp_connect` | Desativado por padrão; tipos e hosts TCP em allowlist |

### Matriz de autoridade inicial

| Perfil | Pode fazer | Deve continuar sem poder fazer |
| --- | --- | --- |
| Observação (padrão) | Ler e pesquisar artefatos aprovados | Alterar arquivos, serviços, processos ou configuração |
| Diagnóstico | Executar apenas verificações predefinidas | Executar PowerShell arbitrário, scripts, comandos ou acesso TCP fora da allowlist |
| Manutenção | Escrever em diretórios explicitamente permitidos | Escrever fora da allowlist, sobrescrever sem confirmação/auditoria, reiniciar serviços sem procedimento específico |
| Administração do bridge | Iniciar/parar bridge e configurar o túnel | Expor token ou segredos em console, arquivo ou telemetria |

### Achados

1. **Crítico — token no console.** `bin/tc-bridge.js` inclui o Bearer token na mensagem de instrução após publicar o túnel. Logs de terminal podem vazar a credencial; a correção e a rotação do token são prioridade da Fase 2.
2. **Alto — leitura sem escopo de diretório.** As ferramentas de leitura aceitam caminhos arbitrários do host. Isso também permite que `copy_to_staging` copie um arquivo legível para uma área de saída.
3. **Alto — escrita não é transacional.** `write_file` sobrescreve diretamente arquivos permitidos. Falta política de criação versus atualização, backup, escrita atômica, hash pré/pós-operação e confirmação de overwrite.
4. **Médio — túnel público temporário.** `localtunnel` e `trycloudflare.com` geram URLs efêmeras. O modo `static` delega a segurança a infraestrutura externa e precisa de validação explícita de origem e TLS.
5. **Médio — diagnóstico TCP frágil.** `tcp_connect` usa `Test-NetConnection` dentro de um limite geral de 10 segundos. No host de homologação ele excedeu esse limite apesar de Solr estar escutando. A Fase 3 deve usar uma verificação TCP com timeout próprio e previsível.
6. **Médio — cobertura de testes inicial.** Há três testes unitários para a validação de diagnóstico e sua exposição condicional. Ainda não existem testes de handshake MCP, autenticação HTTP, Windows/PowerShell, túnel ou regras de arquivo.
7. **Decisão pendente — health endpoint.** O endpoint `/health` está atrás da autenticação. Isto é seguro para um serviço exposto, mas impede probes sem token; a política precisa ser deliberada e testada.

### Critérios de saída atingidos

- Superfícies de leitura, cópia, escrita, diagnóstico, transporte e túnel foram identificadas.
- Permissões implícitas e limites ausentes foram registrados.
- Nenhuma capacidade de execução arbitrária foi introduzida.
- A melhoria de confiabilidade de diagnóstico foi registrada como trabalho posterior, não mascarada como indisponibilidade de Solr.

## Fase 2 — endurecimento, segredo e auditoria

### Entregue nesta execução

- Removida a impressão do valor de `TC_TOKEN` pela CLI; o operador recebe apenas a orientação para configurar o header no cliente MCP.
- Implementada `TC_ALLOWED_READ_PATHS`/`--read-paths` como configuração obrigatória. Leitura, busca, árvore, grep, cópia e o diagnóstico `path_exists` agora recusam caminhos fora dela, inclusive tentativas com `..`.
- Protegido o nome de `copy_to_staging` contra inclusão de diretórios.
- Adicionados testes para negação de leitura/cópia e escape por segmentos de caminho.
- `write_file` agora cria/substitui por arquivo temporário + rename atômico. A substituição exige `overwrite: true` e pode exigir `expected_sha256` para impedir atualização sobre conteúdo inesperado.
- Adicionado teste de escrita atômica, overwrite explícito e hash esperado.

### Pendente

1. Rotacionar o token exposto anteriormente antes da implantação e atualizar a configuração do cliente MCP.
2. Configurar `TC_ALLOWED_READ_PATHS` no host remoto antes de reiniciar o bridge; sem essa variável a nova versão recusa iniciar de propósito.
3. Separar as capacidades em perfis: `readonly`, `diagnostics` e `maintenance`.
4. Implementar log estruturado local sem segredos: data, sessão, ferramenta, alvo normalizado, resultado, duração e correlação. Definir retenção.
5. Definir backup configurável e registro de alteração para `write_file`.
6. Criar um modo de negação por padrão para staging, com destinos permitidos e limites de volume.

Critério de saída: nenhum token é emitido em log; toda leitura/cópia/escrita é confinada e auditável; um teste automatizado prova as negações.

## Fase 3 — diagnóstico operacional seguro

1. Substituir `Test-NetConnection` por um teste TCP de timeout curto e parametrizado internamente, sem aceitar código do usuário.
2. Ampliar a biblioteca de diagnósticos apenas com operações úteis e versionadas: status de serviço, porta TCP, processo por nome, espaço em disco, existência/hash de arquivo e últimas linhas de logs permitidos.
3. Definir argumentos estritos para cada operação e uma allowlist de serviços, hosts, portas, caminhos e logs.
4. Adicionar mensagens de erro acionáveis e códigos de resultado estáveis.
5. Para Teamcenter/Solr, incorporar somente procedimentos Siemens validados; ações como sincronizar/regenerar credencial devem ser um runbook aprovado, não um comando livre do bridge.

Critério de saída: os diagnósticos cobrem o incidente AWC/Solr sem shell arbitrário, com timeout previsível e testes em Windows.

## Fase 4 — confiabilidade e implantação

1. Definir instalação suportada (pacote assinado ou serviço Windows) e uma conta de serviço com privilégios mínimos.
2. Preferir túnel nomeado/autenticado, com TLS e política de origem, em vez de URL temporária para uso recorrente.
3. Implementar reinício supervisionado, health/readiness, logs rotacionados e diagnóstico de inicialização sem segredo.
4. Validar incompatibilidades de proxy/firewall e publicar um modo estático documentado para redes que bloqueiam os provedores de túnel.
5. Adicionar compatibilidade de configuração e migração de versão.

Critério de saída: uma instalação limpa consegue iniciar, reconectar e ser observada sem copiar tokens para logs ou depender de URL efêmera.

## Fase 5 — homologação e governança

1. Criar cenários de teste: autenticação inválida, tentativa fora de diretório, overwrite, indisponibilidade de túnel, timeout TCP e erros de Solr.
2. Executar validação com o time de infraestrutura/segurança e os responsáveis por Teamcenter.
3. Criar runbooks curtos para iniciar, parar, rotacionar token, recuperar túnel, coletar evidência e fazer rollback.
4. Registrar responsáveis por allowlists e revisão periódica de auditoria.

Critério de saída: aprovação de segurança/operação, evidências de teste e procedimentos de rollback disponíveis.

## Fase 6 — decisão de tecnologia (Node.js, Go ou Rust)

O bridge atual não precisa ser reescrito para corrigir os riscos identificados. Node.js é adequado enquanto o escopo permanecer pequeno, com operações allowlisted, testes e implantação controlada.

Reavaliar Go ou Rust somente se houver requisito comprovado de binário único, serviço Windows sem runtime Node, políticas de endpoint que bloqueiem Node, integração nativa de credenciais/certificados ou maior volume de concorrência. Uma migração deve manter o mesmo contrato MCP e ser feita depois da Fase 5, com teste de compatibilidade e rollback para a implementação atual.

## Ordem recomendada

1. Fase 2: conter exposição de token e limitar acesso a arquivos.
2. Fase 3: tornar os diagnósticos de Teamcenter/Solr confiáveis e suportados.
3. Fase 4: estabilizar implantação e túnel.
4. Fase 5: homologar com segurança e operação.
5. Fase 6: decidir por dados se uma reescrita é necessária.
