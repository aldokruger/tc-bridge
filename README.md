# tc-bridge

Bridge MCP (Model Context Protocol) para expor os arquivos de upgrade do Teamcenter
à ferramenta de IA que está rodando no seu Mac — sem precisar de SSH nem de pular
hosts. O bridge roda **na própria máquina de upgrade** (onde os arquivos estão) e
cria um túnel para fora, de modo que o opencode no Mac alcança os arquivos via HTTP.

## Modelo

```
[Mac: opencode] --(HTTPS túnel)--> [localtunnel/static] --(internet)--> [Máquina de upgrade: tc-bridge]
                                                                          Lê/escreve arquivos locais (D:\upgrade\...)
```

- O bridge escuta em `127.0.0.1:<porta>` e **cria um túnel outbound** por padrão
  (localtunnel). A máquina de upgrade precisa apenas de **internet de saída**
  (não precisa expor porta, não precisa SSH, não precisa de saltos).
- Toda requisição exige **Bearer token** (`TC_TOKEN`).
- A leitura é limitada a `TC_ALLOWED_READ_PATHS`. Escrita só com
  `TC_ALLOW_WRITE=1` + whitelist `TC_ALLOWED_WRITE_PATHS`.

## Instalação (na máquina de upgrade)

Requer Node.js >= 20.

```bash
npm install -g github:aldokruger/tc-bridge
```

## Uso

Crie um arquivo `.env` ao lado do comando (ou exporte as variáveis):

```env
TC_TOKEN=um-token-forte-e-aleatorio
TC_PORT=4100
TC_ALLOWED_READ_PATHS=D:\\upgrade;D:\\logs
TC_ALLOW_WRITE=1
TC_ALLOWED_WRITE_PATHS=D:\upgrade;D:\logs
```

Depois:

```bash
tc-bridge
```

### Configuração guiada e plugin remoto

Para criar a configuração mínima sem gerar ou exibir o token no terminal:

```powershell
tc-bridge setup --paths 'E:\PLM\tcdata2606;E:\PLM\volume'
tc-bridge doctor
```

Depois que o túnel publicar uma URL, gere um fragmento de configuração MCP
protegido (ele contém o token e é ignorado pelo Git):

```powershell
tc-bridge plugin-config --url https://sua-url-publica.example
```

O arquivo `tc-bridge.remote.mcp.json` pode ser incorporado na configuração do
cliente MCP. Ambos os comandos recusam sobrescrever arquivos existentes sem
`--force`.

Saída esperada:

```
[tc-bridge] MCP escutando em http://127.0.0.1:4100
[tc-bridge] Tunel ativo: https://tc-xxxxxxxxxxxx.loca.lt
[tc-bridge] Registrar o cliente MCP: tipo remote, url "https://tc-xxxxxxxxxxxx.loca.lt/mcp". Configure o header Authorization com o valor de TC_TOKEN sem registrá-lo em logs.
```

## Registrar no opencode (no Mac)

Adicione em `~/.config/opencode/opencode.json`:

```json
{
  "mcp": {
    "tc-bridge": {
      "type": "remote",
      "url": "https://tc-xxxxxxxxxxxx.loca.lt/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer <token>"
      }
    }
  }
}
```

## Variáveis de ambiente

| Variável                                                                             | Padrão                              | Descrição                                                                                                                                              |
| ------------------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TC_TOKEN`                                                                           | — (obrigatório)                     | Token de acesso (Bearer)                                                                                                                               |
| `TC_HOST`                                                                            | `127.0.0.1`                         | Host de escuta do HTTP                                                                                                                                 |
| `TC_PORT`                                                                            | `4100`                              | Porta de escuta                                                                                                                                        |
| `TC_TUNNEL`                                                                          | `localtunnel`                       | `localtunnel` ou `static`                                                                                                                              |
| `TC_PUBLIC_URL`                                                                      | —                                   | URL pública fixa (usada com `TC_TUNNEL=static`)                                                                                                        |
| `TC_ALLOWED_READ_PATHS`                                                              | — (obrigatório)                     | Whitelist de leitura/cópia, separada por `;` ou `,`                                                                                                    |
| `TC_ALLOW_WRITE`                                                                     | `0`                                 | `1` habilita escrita                                                                                                                                   |
| `TC_ALLOWED_WRITE_PATHS`                                                             | —                                   | Whitelist de escrita, separada por `;` ou `,`                                                                                                          |
| `TC_STAGING_DIR`                                                                     | `./staging`                         | Diretório de staging (uso futuro)                                                                                                                      |
| `TC_ALLOW_DIAGNOSTICS`                                                               | `0`                                 | Habilita diagnósticos PowerShell allowlisted                                                                                                           |
| `TC_DIAGNOSTIC_HOSTS`                                                                | loopback local                      | Hosts permitidos em testes TCP, separados por `;`                                                                                                      |
| `TC_ALLOW_DB_DIAGNOSTICS`                                                            | `0`                                 | Habilita diagnósticos MSSQL predefinidos, somente leitura                                                                                              |
| `TC_DB_SERVER` / `TC_DB_PORT`                                                        | —                                   | Host/porta MSSQL; obrigatórios ao habilitar o recurso                                                                                                  |
| `TC_DB_NAME` / `TC_DB_USER` / `TC_DB_PASSWORD`                                       | —                                   | Base e conta SQL exclusiva de diagnóstico; obrigatórios ao habilitar o recurso                                                                         |
| `TC_DB_ENCRYPT`                                                                      | `true`                              | Exige criptografia TLS na conexão MSSQL                                                                                                                |
| `TC_DB_TRUST_SERVER_CERTIFICATE`                                                     | `false`                             | Não habilite exceto quando aprovado para homologação                                                                                                   |
| `TC_ALLOW_DB_COMPARE`                                                                | `0`                                 | Habilita comparacao MSSQL entre a base configurada e o ambiente alvo declarado em TC_DB_TARGET_* (mesma conta SQL de diagnostico; somente leitura)     |
| `TC_DB_TARGET_SERVER` / `TC_DB_TARGET_PORT`                                          | —                                   | Host e porta MSSQL do ambiente alvo da comparacao; obrigatorios ao habilitar o recurso (porta opcional: herda TC_DB_PORT)                              |
| `TC_DB_TARGET_NAME`                                                                  | —                                   | Base MSSQL do ambiente alvo; obrigatoria ao habilitar o recurso                                                                                        |
| `TC_ALLOW_TEAMCENTER_READ`                                                           | `0`                                 | Master switch das consultas SOA somente leitura; sem ele, nenhuma action SOA é exposta                                                                 |
| `TC_ALLOW_TEAMCENTER_SOA_PREFLIGHT` / `_HEALTH`                                      | herda de `TC_ALLOW_TEAMCENTER_READ` | Health/preflight seguem o master switch; `0` desliga uma action mesmo com ele ligado                                                                   |
| `TC_ALLOW_TEAMCENTER_SOA_PREFERENCES` / `_OBJECTS` / `_QUERIES`                      | `0`                                 | Exigem flag granular explícita (não herdam do master switch) + profile na policy local; PRD inicia somente com preflight/health                        |
| `TC_ALLOW_TEAMCENTER_SOA_DATASETS` / `_FMS`                                          | `0`                                 | Permanecem desligadas por padrão até homologação contra a distribuição SOA instalada                                                                   |
| `TC_TEAMCENTER_SOA_POLICY_FILE`                                                      | —                                   | Policy local JSON (deny-by-default) para preferences/objects/queries/dataset/fms; sem arquivo, essas actions falham                                    |
| `TC_ENVIRONMENT_REGISTRY_FILE`                                                       | —                                   | Registro local de ambientes (Fase 1): perfis com identidade imutável e classificação QA/PRD; inválidos são isolados sem derrubar o agente              |
| `TC_TEAMCENTER_SOA_MAX_CONCURRENCY` / `_QUEUE_LIMIT` / `_RATE_LIMIT` / `_TIMEOUT_MS` | `1` / `4` / `30` / `30000`          | Controles de carga sobre o adaptador SOA                                                                                                               |
| `TC_TEAMCENTER_SOA_REQUIRE_TLS` / `_TRUST_STORE`                                     | `0` / —                             | Exige https na URL SOA e aponta o truststore JKS para hosts com certificado privado                                                                    |
| `TC_TEAMCENTER_URL` / `TC_TEAMCENTER_USER` / `TC_TEAMCENTER_PASSWORD`                | —                                   | WebTier e conta técnica SOA; obrigatórios quando habilitado                                                                                            |
| `TC_TEAMCENTER_SOA_LIB` / `TC_TEAMCENTER_SOA_ADAPTER_JAR`                            | —                                   | Diretório oficial dos jars SOA e jar compilado do adaptador                                                                                            |
| `TC_TEAMCENTER_SOA_CLIENT_ENCODING`                                                  | autodetecção                        | Define `OPT_CLIENT_ENCODING` somente quando informado; deve coincidir com `TC_CHARACTER_ENCODING_SET` do `tcserver` (por exemplo, `Cp1252` ou `UTF-8`) |
| `TC_ALLOW_BROWSER_DIAGNOSTICS`                                                       | `0`                                 | Habilita diagnósticos Chrome DevTools somente leitura                                                                                                  |
| `TC_BROWSER_DEVTOOLS_URL`                                                            | `http://127.0.0.1:9222`             | Endpoint CDP local; aceita somente loopback                                                                                                            |
| `TC_ALLOW_LOG_READ` / `TC_TEAMCENTER_LOG_DIR`                                        | `0` / —                             | Habilita inspeção somente-leitura de logs em uma única pasta permitida                                                                                 |
| `TC_ALLOW_CAPABILITY_TASKS`                                                          | `0`                                 | Habilita capability Ed25519 assinada, única e auditada para tarefas autorizadas                                                                        |
| `TC_ENFORCE_CAPABILITIES`                                                            | `0`                                 | Oculta ferramentas diretas privilegiadas e exige capability para Browser, SOA, MSSQL e host                                                            |
| `TC_AGENT_ID` / `TC_CAPABILITY_PUBLIC_KEY` / `TC_CAPABILITY_ISSUER`                  | —                                   | Identidade do agente, PEM público e emissor confiável das capabilities                                                                                 |
| `TC_AGENT_RESULT_BUFFER_CAPACITY`                                                    | `100`                               | Tamanho do buffer local de resultados pendentes do agente (drop-oldest quando cheio)                                                                   |
| `TC_AUDIT_LOG_PATH`                                                                  | `./logs/tc-agent-audit.jsonl`       | Auditoria JSONL local das tarefas autorizadas                                                                                                          |
| `TC_TEAMCENTER_SOA_EXTRA_JARS`                                                       | —                                   | JARs extras do cliente SOA, separados por `;` (por exemplo, Log4j)                                                                                     |

## Ferramentas MCP expostas

| Ferramenta                                            | Descrição                                                                                                 |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `list_dir`                                            | Lista conteúdo de um diretório (não recursivo)                                                            |
| `read_file`                                           | Lê arquivo de texto (UTF-8 ou latin-1)                                                                    |
| `stat_file`                                           | Metadados de arquivo/diretório                                                                            |
| `search_files`                                        | Busca por nome com padrão `*`/`?`. Com `recursive=true`, percorre subpastas (`max_depth`, `max_results`)  |
| `list_tree`                                           | Lista uma árvore de diretórios recursivamente (`max_depth`, `max_results`)                                |
| `grep_content`                                        | Busca texto/regex dentro do conteúdo de arquivos, opcionalmente recursivo (pula binários e >5MB)          |
| `write_file`                                          | Cria arquivo de forma atômica; overwrite exige confirmação e pode exigir hash (off por padrão; whitelist) |
| `copy_to_staging`                                     | Copia arquivo permitido para `TC_STAGING_DIR`                                                             |
| `bmide_model`                                         | Le o modelo BMIDE (default.xml) de um path permitido: business objects, properties, LOVs e naming rules com contagens |
| `run_diagnostic`                                      | Opcional; somente `path_exists`, `service_status` e `tcp_connect` — não aceita comandos arbitrários       |
| `run_db_diagnostic`                                   | Opcional; apenas consultas MSSQL predefinidas e somente leitura — não aceita SQL arbitrário               |
| `upgrade_readiness`                                   | Opcional; relatorio de pre-requisitos MSSQL para upgrade Teamcenter, somente leitura                      |
| `compare_environments`                                | Opcional; compara a base configurada com o alvo de TC_DB_TARGET_* (mesma conta de diagnostico), somente leitura |
| `tc_soa_read`                                         | Opcional; consultas Teamcenter SOA predefinidas e somente leitura                                         |
| `browser_status` / `browser_pages`                    | Opcional; estado e páginas de um Chrome local em depuração                                                |
| `browser_capture_diagnostics` / `browser_performance` | Opcional; Console/Network novos e métricas, somente leitura                                               |
| `teamcenter_log_inspect`                              | Opcional; lista, busca e lê o final de logs Teamcenter com limites e mascaramento de segredos             |
| `tc_authorized_task`                                  | Opcional; executa capability Ed25519 assinada, de uso único e auditada                                    |

### Capabilities zero-trust

Com `TC_ALLOW_CAPABILITY_TASKS=1`, o bridge expõe `tc_authorized_task`. Cada
tarefa contém uma capability JWS Ed25519 assinada pelo broker e um JSON de
parâmetros. O agente valida assinatura, emissor, audiência, expiração, escopo e
uso único antes de chamar qualquer adaptador. O resultado recebe `audit_id` e o
host grava eventos JSONL locais. A chave privada do emissor nunca deve ser
copiada para o agente.

Em produção, habilite também `TC_ENFORCE_CAPABILITIES=1`. Ele mantém somente
`tc_authorized_task` para capacidades privilegiadas e impede o uso direto de
Browser, SOA, MSSQL e diagnósticos de host pelo endpoint MCP.

### Inspeção de logs Teamcenter

Com `TC_ALLOW_LOG_READ=1`, configure `TC_TEAMCENTER_LOG_DIR` para a única
pasta de logs autorizada. A ação `teamcenter.logs.read` aceita `list`, `tail`
e `search`, nunca aceita caminhos absolutos e mascara tokens, senhas e cookies
na saída. Inclua essa ação em `TC_BROKER_ALLOWED_ACTIONS` no broker.

### Agente reverso e broker mTLS

O pacote inclui os executáveis `tc-agent` e `tc-broker` para homologação do
canal reverso. O broker exige certificado de servidor, CA de certificados de
cliente e mTLS; o agente exige certificado próprio, chave privada, CA do broker
e `TC_ALLOW_CAPABILITY_TASKS=1`. A conexão é sempre iniciada pelo agente.

```powershell
# Host do agente
$env:TC_BROKER_URL = 'wss://broker.exemplo.com/agent'
tc-agent
```

O `tc-broker` também expõe uma API MCP HTTPS em uma porta separada (padrão
`8444`). Ela aceita apenas Bearer token, lista agentes conectados e disponibiliza
`tc_dispatch_authorized_task`, que cria uma capability Ed25519 de uso único e a
encaminha pelo canal mTLS. Configure `TC_BROKER_API_TOKEN`,
`TC_CAPABILITY_PRIVATE_KEY`, `TC_CAPABILITY_ISSUER` e uma allowlist explícita em
`TC_BROKER_ALLOWED_ACTIONS`. O token da API e a chave privada nunca devem ser
copiados para o agente Teamcenter.

Configure o Codex com MCP remoto HTTPS em `https://broker.exemplo.com:8444/mcp`
e o header `Authorization: Bearer <TC_BROKER_API_TOKEN>`. A API MCP não usa o
certificado do agente; somente o canal `/agent` usa mTLS.

Use um hostname e certificado TLS publicamente confiável para a API MCP,
configurados em `TC_BROKER_API_TLS_KEY` e
`TC_BROKER_API_TLS_CERTIFICATE`. Reutilizar o certificado mTLS do broker só é
adequado para homologação; clientes MCP remotos normalmente não confiam em uma
CA privada de agentes.

Esta é uma base de homologação com token de serviço. Produção ainda requer
OIDC/MFA, autorização por usuário, registro/persistência de agentes e auditoria
central.

### Console administrativo do broker (HTTPS /admin)

O mesmo listener HTTPS da API MCP (padrão `8444`) pode servir um console de
operação em `/admin`, habilitado somente quando `TC_BROKER_ADMIN_TOKEN` está
definido — sem o token não existem rotas `/admin` (negação por padrão). A
autenticação do console é própria (sessão criada com `TC_BROKER_ADMIN_TOKEN`,
com validação de Origin) e não reutiliza `TC_TOKEN` nem `TC_BROKER_API_TOKEN`.

O console apresenta, somente leitura sobre agentes e configuração remota:
dashboard de conectividade, agentes conectados, a allowlist efetiva
(`TC_BROKER_ALLOWED_ACTIONS`), TTL/subject das capabilities, tarefas e
auditoria sanitizadas, e execução de health checks já allowlisted.

Uma aba de chat LLM permite operar o broker por linguagem natural. A chave do
provedor LLM é informada por requisição na própria interface, nunca é
persistida e nunca atravessa o canal broker–agente. O broker orquestra o turno
e qualquer chamada de ferramenta despacha somente actions presentes em
`TC_BROKER_ALLOWED_ACTIONS`; action fora da allowlist é recusada com `403`
antes de qualquer despacho. A resposta chega por SSE (com heartbeat) e cada
turno grava eventos de auditoria `chat.start`/`chat.done`/`chat.failed`/
`chat.aborted`. O corpo de `/v1/chat` aceita históricos de até 10 MB
(coerente com o schema de 100 mensagens); as demais rotas mantêm o limite de
64 KB.

O console usa o mesmo certificado da API MCP
(`TC_BROKER_API_TLS_KEY`/`TC_BROKER_API_TLS_CERTIFICATE`); em homologação com
CA privada, o navegador exige aceitar esse certificado para abrir `/admin`.

### Diagnóstico do navegador AWC

O agente de navegador é opcional e fica desabilitado por padrão. Ele só aceita
o endpoint Chrome DevTools em `localhost`, `127.0.0.1` ou `::1`; portanto, o
bridge não pode ser usado para alcançar navegadores de terceiros nem para
publicar a porta CDP.

Inicie um Chrome com perfil isolado na máquina que possui o navegador a ser
diagnosticado:

```powershell
$chrome = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
& $chrome --remote-debugging-port=9222 `
  --user-data-dir="$env:TEMP\tc-awc-debug-profile" `
  'http://172.18.2.221:3000'
```

Em seguida, habilite `TC_ALLOW_BROWSER_DIAGNOSTICS=1` e reinicie o tc-bridge.
As ferramentas permitem listar páginas, capturar por no máximo 15 segundos
eventos novos de Console/Network e consultar métricas de performance. Elas não
executam JavaScript, não automatizam cliques e não retornam cookies,
armazenamento local, corpos de requisição ou query strings.

### Consultas Teamcenter SOA

`tc_soa_read` usa o cliente Java SOA oficial instalado localmente e mantém a
credencial técnica apenas no host do bridge. Não existe action ampla: cada
consulta é uma action granular, autorizada por flag de configuração e — quando
toca dados — por uma policy local deny-by-default (`TC_TEAMCENTER_SOA_POLICY_FILE`).
O plugin não pode escolher um serviço SOA, enviar uma operação de escrita ou
receber a senha de Teamcenter.

Ações disponíveis (habilite via `TC_ALLOW_TEAMCENTER_READ=1` + flag granular):

| Action                               | Flag                                  | Policy local exigida |
| ------------------------------------ | ------------------------------------- | -------------------- |
| `teamcenter.soa.preflight`           | `TC_ALLOW_TEAMCENTER_SOA_PREFLIGHT`   | —                    |
| `teamcenter.soa.connection_health`   | `TC_ALLOW_TEAMCENTER_SOA_HEALTH`      | —                    |
| `teamcenter.soa.session_context`     | `TC_ALLOW_TEAMCENTER_SOA_HEALTH`      | —                    |
| `teamcenter.soa.health_bundle`       | `TC_ALLOW_TEAMCENTER_SOA_HEALTH`      | —                    |
| `teamcenter.soa.preferences.read`    | `TC_ALLOW_TEAMCENTER_SOA_PREFERENCES` | `preferences`        |
| `teamcenter.soa.encoding_probe`      | `TC_ALLOW_TEAMCENTER_SOA_OBJECTS`     | `objects`            |
| `teamcenter.soa.object.inspect`      | `TC_ALLOW_TEAMCENTER_SOA_OBJECTS`     | `objects`            |
| `teamcenter.soa.saved_query.execute` | `TC_ALLOW_TEAMCENTER_SOA_QUERIES`     | `saved_query`        |
| `teamcenter.soa.dataset.inspect`     | `TC_ALLOW_TEAMCENTER_SOA_DATASETS`    | `dataset`            |
| `teamcenter.soa.fms.probe`           | `TC_ALLOW_TEAMCENTER_SOA_FMS`         | `fms`                |

A policy local (exemplo em `docs/soa-policy.example.json`) declara os únicos
valores aceitos: escopos e nomes de preferência, tipos e propriedades de
objeto, UID de saved query, critérios e limites. Tudo fora da policy é
rejeitado antes de tocar o adaptador Java. Datasets e FMS permanecem desligados
por padrão até homologação contra a distribuição SOA instalada.

No host Windows, construa o adaptador uma vez com o JDK e as bibliotecas já
instaladas pelo Teamcenter:

```powershell
$env:TC_TEAMCENTER_SOA_LIB = 'E:\PLM\Teamcenter2606\TcFTSIndexer\lib'
.\scripts\build-soa-adapter.ps1
```

Configure o caminho produzido em `TC_TEAMCENTER_SOA_ADAPTER_JAR` e habilite
`TC_ALLOW_TEAMCENTER_READ=1`. Use uma conta SOA dedicada, sem privilégios de
escrita, e nunca forneça `TC_TEAMCENTER_PASSWORD` na linha de comando.

Quando a instalação SOA não mantiver Log4j no diretório configurado em
`TC_TEAMCENTER_SOA_LIB`, inclua explicitamente os JARs `log4j-api` e
`log4j-core` da mesma distribuição do Teamcenter em
`TC_TEAMCENTER_SOA_EXTRA_JARS`.

### Diagnóstico MSSQL

O recurso fica desabilitado por padrão e requer `TC_ALLOW_DB_DIAGNOSTICS=1` e
uma conta SQL dedicada. As operações são fechadas em allowlist:
`database_files`, `waits`, `active_requests`, `expensive_queries` e
`index_health`. Não há ferramenta para enviar SQL, alterar índices, atualizar
estatísticas, encerrar sessões ou escrever no banco.

Além do diagnóstico avulso, existem dois relatórios compostos somente
leitura usando a mesma conta: `upgrade_readiness` (pré-requisitos de
upgrade da base configurada) e `compare_environments` (base configurada vs.
ambiente alvo declarado em `TC_DB_TARGET_SERVER`/`TC_DB_TARGET_NAME`,
exigindo `TC_ALLOW_DB_COMPARE=1`). O host alvo nunca é informado pelo chamador.

Forneça `TC_DB_PASSWORD` somente no ambiente protegido do processo/serviço no
host Windows; a CLI não aceita senha como argumento para evitar exposição na
lista de processos.

Para os diagnósticos baseados em DMVs, o DBA deve conceder à conta somente as
permissões de consulta requeridas pela versão do SQL Server, normalmente
`VIEW DATABASE STATE` e, quando necessário, `VIEW SERVER STATE`. O primeiro
uso deve ser em homologação; recomendações de índice e manutenção exigem
validação posterior conforme o procedimento suportado do Teamcenter.

### Buscas recursivas — limites padrão

Para não sobrecarregar o host de upgrade nem estourar o payload de resposta,
`search_files` (recursivo), `list_tree` e `grep_content` têm limites
conservadores por padrão, ajustáveis por parâmetro:

- `max_depth` (padrão 6): quantos níveis de subpasta percorrer.
- `max_results` / `max_files` / `max_matches`: corta a resposta e retorna
  `truncated: true` quando o limite é atingido — refine `remote_path` ou o
  `pattern` em vez de aumentar o limite.
- Pastas como `node_modules`, `.git`, `$RECYCLE.BIN` e `System Volume
Information` são puladas automaticamente.
- `grep_content` pula arquivos binários (detecção por byte nulo) e arquivos
  maiores que 5MB, listando-os em `skipped` com o motivo.

## Segurança

- Token obrigatório, comparado com `timingSafeEqual`.
- Leitura e cópia limitadas por `TC_ALLOWED_READ_PATHS`; escrita limitada por
  `TC_ALLOWED_WRITE_PATHS` quando habilitada.
- `write_file` não sobrescreve por padrão. Para substituir um arquivo, informe
  `overwrite: true`; use `expected_sha256` para confirmar o conteúdo anterior.
- Diagnósticos ficam desligados por padrão. Quando `TC_ALLOW_DIAGNOSTICS=1`,
  o bridge não recebe PowerShell livre: ele executa apenas três verificações
  predefinidas, com timeout de 10 segundos e saída limitada. `tcp_connect` é
  restrito a `TC_DIAGNOSTIC_HOSTS` (por padrão, somente loopback).
- O túnel localtunnel é público — qualquer um com o URL e o token consegue
  acessar. **Use um token longo e aleatório** e troque-o se vazar.

## Desenvolvimento local (no Mac)

```bash
npm install
TC_TOKEN=dev node bin/tc-bridge.js --no-tunnel
# smoke test:
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4100/health   # 401 sem token
curl -s -H "Authorization: Bearer dev" http://127.0.0.1:4100/health     # {"ok":true}
```
