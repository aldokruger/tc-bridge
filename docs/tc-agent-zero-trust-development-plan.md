# Plano de desenvolvimento — tc-agent zero-trust

## 1. Objetivo

Evoluir o `tc-bridge` de um MCP remoto protegido por token estático para uma
plataforma de agentes gerenciados. Cada agente deve iniciar uma conexão de saída
segura para uma aplicação cloud, receber somente tarefas autorizadas e executar
capacidades limitadas no ambiente local do usuário ou servidor Teamcenter.

O produto deve suportar diagnóstico de:

- logs, arquivos e serviços Teamcenter;
- consultas Teamcenter SOA somente leitura;
- banco de dados MSSQL somente leitura;
- navegador Chromium local para Console, Network e Performance;
- conectividade e estado operacional do host.

O produto não deve aceitar shell, SQL, CDP, túnel, leitura de cookies ou escrita
arbitrária enviados pela nuvem.

## 2. Resultado esperado

```text
Usuário ── OIDC + MFA ──> Aplicação cloud
                              │
                       API / Broker de tarefas
                              │
                  WSS ou HTTP/2 + mTLS, saída
                              ▼
                    tc-agent Windows/macOS
                              │
             ┌────────────────┼────────────────┐
             ▼                ▼                ▼
          Teamcenter        MSSQL          Chrome CDP
```

O servidor cloud nunca inicia uma conexão direta com a estação do usuário. O
agente mantém a conexão de saída, autentica-se com identidade própria e rejeita
qualquer tarefa fora de sua política local.

## 3. Princípios de segurança

1. **Zero trust.** Uma conexão válida não concede acesso irrestrito. Cada tarefa
   precisa de autorização específica.
2. **Menor privilégio.** Cada módulo possui somente as permissões estritamente
   necessárias para sua finalidade.
3. **Sem comandos livres.** A API recebe nomes de operações allowlisted e
   parâmetros estruturados, nunca PowerShell, SQL ou JavaScript livres.
4. **Conexão reversa.** O agente usa somente tráfego de saída em TLS; não se
   abre porta de entrada, RDP ou CDP para a internet.
5. **Segredos locais.** Senhas Teamcenter, banco e certificados não retornam ao
   broker nem ao usuário remoto.
6. **Auditoria completa.** Toda ação tem usuário, agente, capacidade, escopo,
   horário, resultado e correlação.
7. **Aprovação humana.** Operações de maior impacto exigem confirmação local ou
   fluxo de aprovação na nuvem.
8. **Falha segura.** Sem identidade válida, política carregada ou conexão mTLS,
   o agente não executa tarefas.

## 4. Escopo funcional por módulo

### 4.1 Arquivos e logs

Operações iniciais:

- listar diretórios;
- buscar arquivos e texto em paths permitidos;
- ler arquivos com limites de tamanho;
- copiar artefatos para staging;
- escrever somente quando habilitado, com confirmação e hash esperado.

Restrições:

- paths normalizados e allowlisted por agente;
- exclusão de diretórios sensíveis e binários;
- limite de profundidade, arquivos, bytes e resultados;
- nenhuma exclusão remota na primeira versão.

### 4.2 Teamcenter SOA

Operações iniciais:

- `session_info`;
- `get_preferences`;
- `execute_saved_query` com limite de linhas.

Restrições:

- conta técnica dedicada e sem permissões de manutenção;
- bibliotecas SOA oficiais instaladas no host;
- sem seleção de serviço SOA arbitrário;
- sem importação, exportação, alteração de preferência ou workflow na primeira
  versão.

### 4.3 Diagnóstico MSSQL

O módulo existente deve permanecer somente leitura e ser incorporado ao modelo
de capabilities. As verificações previstas são:

- `database_files`;
- `waits`;
- `active_requests`;
- `expensive_queries`;
- `index_health`.

Requisitos:

- usuário SQL exclusivo para diagnóstico;
- TLS obrigatório; exceção de certificado apenas em homologação aprovada;
- queries parametrizadas e mantidas no código;
- permissões mínimas, normalmente `VIEW DATABASE STATE` e, quando justificável,
  `VIEW SERVER STATE`;
- limite de linhas, timeout e mascaramento de valores potencialmente sensíveis.

Não permitir:

- SQL enviado pelo cliente;
- DDL/DML;
- `KILL`, atualização de estatísticas, rebuild/reorganize de índices;
- alteração de configuração do SQL Server;
- exportação de dados sem fluxo específico de aprovação.

### 4.4 Navegador e Active Workspace

O `tc-browser-agent` atual conecta apenas a um navegador Chromium na mesma
máquina do agente, por `http://127.0.0.1:9222`.

Operações iniciais:

- `browser_status`;
- `browser_pages`;
- `browser_capture_diagnostics`;
- `browser_performance`.

Restrições:

- aceitar somente `localhost`, `127.0.0.1` e `::1`;
- perfil de navegador isolado;
- sem cookies, local storage, corpos de request/response e query strings;
- sem execução JavaScript, cliques ou navegação iniciados pelo agente;
- captura limitada a 15 segundos e 100 eventos;
- porta CDP nunca é publicada por túnel, NAT ou proxy.

## 5. Arquitetura alvo

### 5.1 Componentes

| Componente | Responsabilidade |
|---|---|
| Aplicação cloud | Interface do usuário, autenticação, autorização, auditoria e visualização de resultados. |
| API/Broker | Registro de agentes, entrega de tarefas, validação de capabilities, fila e retransmissão. |
| Serviço de política | Calcula quais usuários, agentes e ferramentas podem executar determinada ação. |
| Autoridade de identidade | OIDC para usuários, MFA e emissão/validação de identidade de dispositivo. |
| tc-agent | Conexão reversa, validação de tarefas, aplicação de política local e execução allowlisted. |
| Adaptadores locais | Teamcenter SOA, MSSQL, navegador CDP, arquivos e diagnósticos de host. |
| Auditoria | Eventos imutáveis, métricas, alertas e retenção configurável. |

### 5.2 Plano de controle e plano de dados

O plano de controle decide e registra. O plano de dados executa estritamente a
tarefa autorizada.

```text
Usuário -> API: solicita diagnóstico
API -> Política: valida usuário, papel, agente e escopo
API -> Broker: cria capability curta e tarefa
Agente -> Broker: busca/recebe tarefa por conexão existente
Agente -> Adaptador: executa apenas ação permitida
Agente -> Broker: envia resultado truncado e metadados
Broker -> Auditoria: grava evento de execução
API -> Usuário: apresenta resultado e referência de auditoria
```

## 6. Identidade e registro de agentes

### 6.1 Instalação

1. Administrador instala o pacote `tc-agent` assinado.
2. Instalador cria serviço do sistema com conta de baixo privilégio.
3. Agente gera par de chaves `Ed25519` no host.
4. Chave privada é protegida por DPAPI/Windows Certificate Store ou TPM quando
   disponível.
5. Instalador mostra um código de pareamento de uso único.
6. Operador autenticado na aplicação cloud aprova o agente, informa nome,
   ambiente e tags.
7. Broker emite certificado mTLS de curta duração e política inicial.
8. Agente valida identidade do broker, instala o certificado e abre a conexão
   reversa.

### 6.2 Ciclo de vida

- certificados curtos e renovação automática;
- revogação imediata por agente, usuário, ambiente ou organização;
- possibilidade de desabilitar uma capability sem reinstalar o agente;
- detecção de versão incompatível e atualização controlada;
- inventário de agentes ativos, versão, SO, última conexão e capacidades.

## 7. Protocolo de tarefas

### 7.1 Envelope de tarefa

O broker envia mensagens JSON versionadas, assinadas e pequenas:

```json
{
  "version": 1,
  "task_id": "tsk_01J...",
  "capability": {
    "issuer": "https://cloud.exemplo.com",
    "audience": "agent_srv26_tc1_dev",
    "subject": "user_123",
    "action": "browser.capture_diagnostics",
    "scope": {
      "page_id": "7CFB...",
      "max_capture_ms": 10000
    },
    "expires_at": "2026-08-30T20:00:00Z",
    "nonce": "..."
  },
  "parameters": {
    "page_id": "7CFB...",
    "capture_ms": 10000
  }
}
```

### 7.2 Validações no agente

Antes de executar, o agente deve validar:

1. assinatura e chave de emissão;
2. emissor, audiência e identidade do próprio agente;
3. expiração, `nonce` e prevenção de replay;
4. compatibilidade de `action` e `parameters`;
5. política recebida e política local;
6. estado de aprovação humana quando exigido;
7. limites de duração, dados e frequência.

### 7.3 Resultados

Resultados devem conter somente conteúdo necessário, truncamento explícito e
metadados para auditoria:

```json
{
  "task_id": "tsk_01J...",
  "status": "completed",
  "started_at": "...",
  "finished_at": "...",
  "result": {},
  "truncated": false,
  "audit_id": "aud_01J..."
}
```

Erros devem ter código estável, mensagem não sensível e referência de
correlação. Não retornar stack traces, senhas, tokens ou configuração completa
do host ao usuário final.

## 8. Modelo de autorização

### 8.1 Papéis iniciais

| Papel | Permissões propostas |
|---|---|
| Viewer | Ver resultados de diagnósticos autorizados. |
| Support Engineer | Executar diagnósticos read-only em agentes atribuídos. |
| Teamcenter Admin | Habilitar módulos Teamcenter e aprovar operações de ambiente. |
| DBA | Habilitar e revisar diagnósticos MSSQL e suas permissões. |
| Security Admin | Registrar/revogar agentes, políticas e retenção de auditoria. |

### 8.2 Sensibilidade das operações

| Nível | Exemplos | Aprovação |
|---|---|---|
| Baixo | Status de serviço, versão do navegador, leitura de log. | Política padrão. |
| Médio | Consulta SOA, métricas MSSQL, captura Network/Console. | Usuário autorizado + agente atribuído. |
| Alto | Escrita de arquivo, exportação de dados, mudança de configuração. | Dupla aprovação ou confirmação local. |
| Bloqueado inicialmente | Shell livre, SQL livre, acesso a cookies/CDP completo. | Não implementado. |

## 9. Persistência, segredos e privacidade

### 9.1 Segredos

- usar secret manager cloud para configurações do broker;
- usar armazenamento protegido do SO para segredos locais;
- nunca gravar token de autenticação em query string, log, output ou arquivo de
  diagnóstico;
- mascarar `password`, `token`, `cookie`, `authorization`, `secret`, `key` e
  padrões equivalentes;
- permitir rotação sem indisponibilidade prolongada.

### 9.2 Dados e retenção

- armazenar resultados resumidos por padrão;
- armazenar anexos somente sob solicitação e com criptografia;
- definir retenção por organização/ambiente;
- oferecer exclusão de artefatos conforme política;
- identificar dados pessoais e técnicos antes de exportação.

## 10. Auditoria e observabilidade

Eventos mínimos:

- registro, renovação, revogação e desconexão de agente;
- login do usuário e decisão de política;
- criação, entrega, início, fim, cancelamento e falha de tarefa;
- negação por política, expiração, replay ou parâmetro inválido;
- alterações de configuração e atualização do agente.

Cada evento deve registrar identificador de organização, usuário, agente,
versão, ação, escopo reduzido, IP de saída, duração e `audit_id`.

Alertas iniciais:

- repetidas falhas mTLS ou de autenticação;
- tentativa de ação não allowlisted;
- grande volume de resultados ou timeouts;
- agente com versão vulnerável/desatualizada;
- uso de credencial SQL fora do módulo permitido;
- múltiplas tentativas de reenviar a mesma capability.

## 11. Instalação, atualização e operação

### 11.1 Instalador

Entregáveis:

- instalador Windows MSI/EXE assinado;
- serviço `tc-agent` com recuperação automática;
- assistente de registro e diagnóstico de pré-requisitos;
- configuração por arquivo protegido ou parâmetros de instalação;
- modo silencioso para gestão corporativa.

### 11.2 Atualização

1. Broker informa versão disponível e compatibilidade.
2. Agente baixa pacote assinado por canal TLS.
3. Verifica assinatura, hash e compatibilidade.
4. Cria ponto de rollback.
5. Para serviço de forma controlada, instala e reinicia.
6. Executa health check e registra sucesso/falha.
7. Reverte automaticamente se o health check não passar.

### 11.3 Compatibilidade

- versionar protocolo e schemas de tarefas;
- suportar janela mínima de duas versões de agente;
- bloquear capability que depende de versão não instalada;
- registrar versão do Teamcenter, Java, SO, navegador e adaptadores.

## 12. Plano de implementação

### Fase 0 — Descoberta e decisões

Entregas:

- documento de ameaças;
- requisitos de conformidade e retenção;
- decisão entre broker próprio, Cloudflare Tunnel/Access ou outro provedor;
- modelo de tenancy e papéis;
- contrato inicial de capabilities.

Critério de aceite: arquitetura revisada por segurança, Teamcenter Admin e DBA.

### Fase 1 — Base do agente

Entregas:

- separar núcleo de agente do servidor MCP atual;
- configuração tipada e política local versionada;
- serviço Windows e health check local;
- registro de identidade e inventário do agente;
- logs estruturados sem segredos.

Critério de aceite: agente registra-se, renova identidade e não expõe porta de
entrada.

### Fase 2 — Broker e canal reverso

Entregas:

- API cloud autenticada por OIDC/MFA;
- broker de tarefas com WSS ou HTTP/2;
- mTLS para agente;
- fila, correlação, timeout, cancelamento e reconexão;
- capability assinada e prevenção de replay.

Critério de aceite: tarefa read-only atravessa nuvem-agente com identidade,
expiração e auditoria verificáveis.

### Fase 3 — Migração dos módulos existentes

Ordem recomendada:

1. arquivos/logs;
2. serviços e conectividade;
3. Teamcenter SOA read-only;
4. MSSQL read-only;
5. navegador read-only.

Para cada módulo:

- definir schema de entrada/saída;
- definir capability e política;
- limitar custo e volume;
- mascarar dados;
- adicionar testes unitários, integração e negativos;
- documentar pré-requisitos e permissões.

Critério de aceite: cada módulo recusa ações e parâmetros fora de sua allowlist.

### Fase 4 — Aprovação e dados sensíveis

Entregas:

- aprovação local e/ou de dois responsáveis;
- exportação controlada de artefatos;
- classificação de dados e retenção;
- política de anexos e criptografia em repouso.

Critério de aceite: ações sensíveis não são executadas sem evidência de
aprovação válida.

### Fase 5 — Console operacional

Entregas:

- lista de agentes, status e versão;
- execução de diagnósticos permitidos;
- histórico e auditoria pesquisável;
- revogação, rotação e configuração de política;
- dashboards de conectividade, falhas e consumo.

Critério de aceite: operador consegue identificar agente, usuário e resultado de
qualquer tarefa sem acessar o host diretamente.

### Fase 6 — Piloto de homologação

Ambiente:

- um servidor Teamcenter de homologação;
- uma instância MSSQL de homologação;
- uma estação com Chrome isolado;
- contas técnicas exclusivas.

Cenários:

- agente offline e reconexão;
- certificado revogado;
- capability expirada ou reutilizada;
- parâmetro fora de allowlist;
- indisponibilidade de Teamcenter, SQL, browser ou broker;
- dados grandes e truncamento;
- usuário sem permissão;
- tentativa de leitura fora do path permitido;
- validação de logs e mascaramento.

Critério de aceite: nenhum cenário permite escalonamento de privilégio ou
vazamento de segredo; resultados são reproduzíveis e auditáveis.

## 13. Estratégia de testes

### Unitários

- validação de schema;
- validação de capability, expiração e replay;
- normalização de paths;
- allowlists;
- redação de dados sensíveis;
- política de aprovação;
- limites de timeout e tamanho.

### Integração

- broker com agente real;
- mTLS e rotação de certificado;
- Teamcenter SOA oficial;
- MSSQL com usuário limitado;
- Chrome CDP em perfil isolado;
- persistência de auditoria.

### Segurança

- testes de autorização por mensagem;
- fuzzing de payload;
- replay de tarefas;
- simulação de agente falsificado;
- varredura de dependências e assinatura de artefatos;
- revisão de configuração de tunnel e firewall;
- pentest antes de produção.

### Operação

- reinício de serviço;
- indisponibilidade temporária da nuvem;
- atualização com rollback;
- carga de múltiplos agentes;
- observabilidade e alertas.

## 14. Critérios para produção

1. Todas as conexões usam TLS e agentes usam mTLS.
2. Não existem portas de entrada para o agente.
3. Usuários usam OIDC e MFA; agentes não compartilham credenciais de usuário.
4. Nenhum módulo aceita comandos livres.
5. Banco e Teamcenter usam contas técnicas de menor privilégio.
6. CDP permanece local e isolado.
7. Logs e resultados não contêm segredos.
8. Auditoria cobre todas as tarefas e decisões de política.
9. Atualizações são assinadas, verificadas e reversíveis.
10. Piloto em homologação passou testes funcionais, negativos e de segurança.

## 15. Decisões pendentes

- provedor e região da aplicação cloud;
- uso de broker próprio ou serviço gerenciado;
- duração de certificados e capabilities;
- modelo de aprovação para exportação/escrita;
- retenção de logs e artefatos;
- requisitos LGPD e classificação de dados;
- suporte a proxy corporativo;
- plataformas iniciais: Windows Server, Windows desktop e macOS;
- estratégia comercial de distribuição e atualização do agente.

## 16. Próximo passo recomendado

Executar a Fase 0 com uma sessão curta de arquitetura para decidir provedor
cloud, identidade corporativa, modelo de aprovação e requisitos de dados. Em
seguida, implementar um protótipo vertical mínimo: registro de agente, conexão
reversa mTLS e uma capability `service_status` read-only com auditoria.
