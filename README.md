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
- Por padrão é **somente leitura**. Escrita só com `TC_ALLOW_WRITE=1` + whitelist
  `TC_ALLOWED_WRITE_PATHS`.

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
TC_ALLOW_WRITE=1
TC_ALLOWED_WRITE_PATHS=D:\upgrade;D:\logs
```

Depois:

```bash
tc-bridge
```

Saída esperada:

```
[tc-bridge] MCP escutando em http://127.0.0.1:4100
[tc-bridge] Tunel ativo: https://tc-xxxxxxxxxxxx.loca.lt
[tc-bridge] Registrar no opencode: tipo remote, url "https://tc-xxxxxxxxxxxx.loca.lt/mcp", header Authorization: Bearer <token>
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
| `TC_ALLOW_WRITE`         | `0`             | `1` habilita escrita                            |
| `TC_ALLOWED_WRITE_PATHS` | —               | Whitelist de escrita, separada por `;` ou `,`   |
| `TC_STAGING_DIR`         | `./staging`     | Diretório de staging (uso futuro)               |

## Ferramentas MCP expostas

| Ferramenta        | Descrição                                                            |
| ----------------- | -------------------------------------------------------------------- |
| `list_dir`        | Lista conteúdo de um diretório                                       |
| `read_file`       | Lê arquivo de texto (UTF-8 ou latin-1)                               |
| `stat_file`       | Metadados de arquivo/diretório                                       |
| `search_files`    | Busca por nome com padrão `*` e `?`                                  |
| `write_file`      | Escreve arquivo (off por padrão; whitelist)                          |
| `copy_to_staging` | Copia arquivo para `TC_STAGING_DIR` (seguro em modo somente-leitura) |

## Segurança

- Token obrigatório, comparado com `timingSafeEqual`.
- Leitura livre (é a finalidade), escrita limitada por whitelist.
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
