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

| Variável                 | Padrão          | Descrição                                       |
| ------------------------ | --------------- | ----------------------------------------------- |
| `TC_TOKEN`               | — (obrigatório) | Token de acesso (Bearer)                        |
| `TC_HOST`                | `127.0.0.1`     | Host de escuta do HTTP                          |
| `TC_PORT`                | `4100`          | Porta de escuta                                 |
| `TC_TUNNEL`              | `localtunnel`   | `localtunnel` ou `static`                       |
| `TC_PUBLIC_URL`          | —               | URL pública fixa (usada com `TC_TUNNEL=static`) |
| `TC_ALLOWED_READ_PATHS`  | — (obrigatório) | Whitelist de leitura/cópia, separada por `;` ou `,` |
| `TC_ALLOW_WRITE`         | `0`             | `1` habilita escrita                            |
| `TC_ALLOWED_WRITE_PATHS` | —               | Whitelist de escrita, separada por `;` ou `,`   |
| `TC_STAGING_DIR`         | `./staging`     | Diretório de staging (uso futuro)               |
| `TC_ALLOW_DIAGNOSTICS`   | `0`             | Habilita diagnósticos PowerShell allowlisted     |
| `TC_DIAGNOSTIC_HOSTS`    | loopback local  | Hosts permitidos em testes TCP, separados por `;`|
| `TC_ALLOW_DB_DIAGNOSTICS` | `0`            | Habilita diagnósticos MSSQL predefinidos, somente leitura |
| `TC_DB_SERVER` / `TC_DB_PORT` | —            | Host/porta MSSQL; obrigatórios ao habilitar o recurso |
| `TC_DB_NAME` / `TC_DB_USER` / `TC_DB_PASSWORD` | — | Base e conta SQL exclusiva de diagnóstico; obrigatórios ao habilitar o recurso |
| `TC_DB_ENCRYPT` | `true` | Exige criptografia TLS na conexão MSSQL |
| `TC_DB_TRUST_SERVER_CERTIFICATE` | `false` | Não habilite exceto quando aprovado para homologação |
| `TC_ALLOW_TEAMCENTER_READ` | `0` | Habilita consultas SOA predefinidas, somente leitura |
| `TC_TEAMCENTER_URL` / `TC_TEAMCENTER_USER` / `TC_TEAMCENTER_PASSWORD` | — | WebTier e conta técnica SOA; obrigatórios quando habilitado |
| `TC_TEAMCENTER_SOA_LIB` / `TC_TEAMCENTER_SOA_ADAPTER_JAR` | — | Diretório oficial dos jars SOA e jar compilado do adaptador |
| `TC_TEAMCENTER_SOA_EXTRA_JARS` | — | JARs extras do cliente SOA, separados por `;` (por exemplo, Log4j) |

## Ferramentas MCP expostas

| Ferramenta        | Descrição                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------- |
| `list_dir`        | Lista conteúdo de um diretório (não recursivo)                                                           |
| `read_file`       | Lê arquivo de texto (UTF-8 ou latin-1)                                                                   |
| `stat_file`       | Metadados de arquivo/diretório                                                                           |
| `search_files`    | Busca por nome com padrão `*`/`?`. Com `recursive=true`, percorre subpastas (`max_depth`, `max_results`) |
| `list_tree`       | Lista uma árvore de diretórios recursivamente (`max_depth`, `max_results`)                               |
| `grep_content`    | Busca texto/regex dentro do conteúdo de arquivos, opcionalmente recursivo (pula binários e >5MB)         |
| `write_file`      | Cria arquivo de forma atômica; overwrite exige confirmação e pode exigir hash (off por padrão; whitelist) |
| `copy_to_staging` | Copia arquivo permitido para `TC_STAGING_DIR`                                                        |
| `run_diagnostic`  | Opcional; somente `path_exists`, `service_status` e `tcp_connect` — não aceita comandos arbitrários       |
| `run_db_diagnostic` | Opcional; apenas consultas MSSQL predefinidas e somente leitura — não aceita SQL arbitrário |
| `tc_soa_read` | Opcional; consultas Teamcenter SOA predefinidas e somente leitura |

### Consultas Teamcenter SOA

`tc_soa_read` usa o cliente Java SOA oficial instalado localmente e mantém a
credencial técnica apenas no host do bridge. As operações iniciais são
`session_info`, `get_preferences` e `execute_saved_query`. O plugin não pode
escolher um serviço SOA, enviar uma operação de escrita ou receber a senha de
Teamcenter.

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
