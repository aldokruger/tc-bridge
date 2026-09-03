# Testes E2E em ambiente controlado — broker na VPS, agente no host Teamcenter e AI no Mac

Runbook passo a passo para homologar a suíte completa (`tc-broker` + `tc-agent` +
capabilities zero-trust + registro de ambientes QA/PRD + cliente MCP da AI) em
um ambiente controlado, com cada componente no seu local:

```text
┌──────────────────┐     HTTPS (Bearer)      ┌──────────────────────┐
│  Mac (AI)        │ ──────────────────────▶ │  VPS (tc-broker)     │
│  opencode/Codex  │   https://broker:8444/  │  API MCP cloud 8444  │
└──────────────────┘        mcp              │  mTLS wss 8443       │
                                             └──────────┬───────────┘
                                                        │ wss://.../agent (mTLS,
                                                        │ conexão iniciada pelo agente)
                                             ┌──────────▼───────────┐
                                             │ Host Teamcenter QA   │
                                             │ (tc-agent + registry)│
                                             │ SOA/browser/SQL/logs │
                                             └──────────────────────┘
```

O registro de ambientes (`TC_ENVIRONMENT_REGISTRY_FILE`, perfis QA/PRD) é
carregado **no agente** (host Teamcenter) — é lá que os checks são executados.
O broker não conhece ambientes: ele autentica o agente por mTLS, lista agentes
conectados e despacha tarefas com capability assinada. A AI fala somente com o
broker via HTTPS + Bearer token.

> Comandos deste guia foram validados contra o código atual (branch
> `feat/soa-granular-authorization`, commit `406c85a`). Onde uma saída real é
> mostrada, ela foi obtida executando o comando.

---

## 1. Pré-requisitos

| Item                    | Local             | Observação                                                                                         |
| ----------------------- | ----------------- | -------------------------------------------------------------------------------------------------- |
| Node.js `>= 20`         | VPS, host TC, Mac | Suíte usa apenas o runner nativo `node --test`                                                     |
| Repositório `tc-bridge` | VPS e host TC     | `npm install` executado na raiz                                                                    |
| Acesso de rede          | VPS → 8443 (mTLS) | Firewall libera **somente** a porta 8443 para o(s) IP(s) do host TC                                |
| Hostname público        | VPS               | `broker.exemplo.com` resolvendo para a VPS; certificado TLS público ou privado aceito pelo cliente |
| Chrome (opcional)       | host TC           | Para cenários de browser AWC (`--remote-debugging-port=9222`)                                      |
| Teamcenter QA           | host TC           | Acesso SOA/WebTier e SQL Server quando os cenários SOA/database forem testados                     |

### 1.1 Suíte automatizada primeiro

Antes de qualquer teste de ambiente, a suíte deve estar verde:

```bash
npm test
```

Resultado esperado nesta baseline: **156 testes, 0 falhas** (101 pré-existentes +
55 do módulo de configuração). Ver `docs/tc-configuration-testing.md` para o
detalhamento dos testes do módulo de configuração.

---

## 2. Identidades e materiais

O canal agente↔broker usa mTLS: o broker exige certificado de cliente assinado
por uma CA que ele confia, e o **CN do certificado do agente deve ser
exatamente o `agent_id`** (o broker recusa conexão se divergir). As
capabilities são assinadas com um par de chaves Ed25519 separado do TLS.

### 2.1 Arquivos de teste (já versionados)

`test/certs/` contém um conjunto pronto para o smoke test local (seção 3):

| Arquivo                                            | Uso                                      |
| -------------------------------------------------- | ---------------------------------------- |
| `ca.pem` / `ca-key.pem`                            | CA de teste `CN=tc-test-ca`              |
| `broker-cert.pem` / `broker-key.pem`               | Certificado de servidor (`CN=localhost`) |
| `agent-cert.pem` / `agent-key.pem`                 | Certificado de cliente (`CN=agent-test`) |
| `capability-private.pem` / `capability-public.pem` | Par Ed25519 das capabilities             |

> Estes materiais são para **teste local apenas**. Em ambiente controlado
> compartilhado, gere um conjunto próprio (seção 2.2) e nunca reutilize a CA
> de teste fora da sua máquina.

### 2.2 Gerar conjunto próprio (ambiente controlado)

```bash
# 1) CA
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout ca-key.pem -out ca.pem -subj "/CN=tc-qa-ca"

# 2) Certificado do broker (server) — CN = hostname público da VPS
openssl req -newkey rsa:2048 -nodes -keyout broker-key.pem -out broker.csr \
  -subj "/CN=broker.exemplo.com"
printf "subjectAltName=DNS:broker.exemplo.com" > broker.ext
openssl x509 -req -in broker.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out broker-cert.pem -days 825 -sha256 -extfile broker.ext

# 3) Certificado do agente (client) — CN DEVE ser o agent_id (ex.: tc2606-qa-01)
openssl req -newkey rsa:2048 -nodes -keyout agent-key.pem -out agent.csr \
  -subj "/CN=tc2606-qa-01"
openssl x509 -req -in agent.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out agent-cert.pem -days 825 -sha256

# 4) Par de chaves Ed25519 das capabilities (privada fica SÓ no broker)
node --input-type=module -e '
import { generateKeyPairSync } from "node:crypto";
import { writeFileSync } from "node:fs";
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
writeFileSync("capability-private.pem", privateKey.export({ type: "pkcs8", format: "pem" }));
writeFileSync("capability-public.pem", publicKey.export({ type: "spki", format: "pem" }));
'
```

**Distribuição segura:**

| Material                             | Vai para                         | Nunca deve ir para |
| ------------------------------------ | -------------------------------- | ------------------ |
| `ca.pem`                             | broker e agente                  | —                  |
| `broker-key.pem` / `broker-cert.pem` | VPS                              | host Teamcenter    |
| `agent-key.pem` / `agent-cert.pem`   | host Teamcenter                  | VPS                |
| `capability-private.pem`             | VPS (broker)                     | host Teamcenter    |
| `capability-public.pem`              | host Teamcenter (agente)         | VPS                |
| `TC_BROKER_API_TOKEN`                | VPS (broker) e Mac (cliente MCP) | logs, repositório  |

---

## 3. Smoke test local (uma máquina só)

Antes de distribuir por VPS/host, valide o par broker+agente na mesma máquina
usando `test/certs/`. Este teste comprova: mTLS, handshake `agent.hello`, CN
do certificado e a API MCP cloud.

**Passo 3.1 — subir o broker:**

```bash
TC_BROKER_PORT=18443 TC_BROKER_API_PORT=18444 \
TC_BROKER_TLS_KEY=test/certs/broker-key.pem \
TC_BROKER_TLS_CERTIFICATE=test/certs/broker-cert.pem \
TC_BROKER_CLIENT_CA=test/certs/ca.pem \
TC_BROKER_API_TOKEN=dev-token \
TC_CAPABILITY_PRIVATE_KEY=test/certs/capability-private.pem \
TC_CAPABILITY_ISSUER=https://localhost:18443 \
TC_BROKER_ALLOWED_ACTIONS="diagnostic.run" \
node bin/tc-broker.js
```

Saída esperada:

```
[tc-broker] escutando com mTLS na porta 18443
[tc-broker] MCP cloud escutando em https://0.0.0.0:18444/mcp
```

**Passo 3.2 — subir o agente** (segundo terminal):

```bash
TC_TOKEN=agent-token TC_ALLOWED_READ_PATHS=/tmp \
TC_ALLOW_CAPABILITY_TASKS=1 TC_AGENT_ID=agent-test \
TC_CAPABILITY_PUBLIC_KEY=test/certs/capability-public.pem \
TC_CAPABILITY_ISSUER=https://localhost:18443 \
TC_BROKER_URL=wss://localhost:18443/agent \
TC_AGENT_CERTIFICATE=test/certs/agent-cert.pem \
TC_AGENT_PRIVATE_KEY=test/certs/agent-key.pem \
TC_BROKER_CA=test/certs/ca.pem \
TC_AUDIT_LOG_PATH=/tmp/agent-audit.jsonl \
node bin/tc-agent.js
```

O agente não loga nada em conexão bem-sucedida (apenas erros/reconexão). O
processo deve permanecer vivo; se o CN do certificado não bater com
`TC_AGENT_ID`, o broker fecha a conexão e o agente entra em reconexão com
backoff logado (`broker desconectado; reconectando em ...ms`).

**Passo 3.3 — health da API MCP** (exige token):

```bash
curl -sk -H "Authorization: Bearer dev-token" https://localhost:18444/health
# {"ok":true}   (sem o header → HTTP 401)
```

**Passo 3.4 — listar agentes conectados** (fluxo MCP streamable HTTP):

```bash
# 1) initialize → captura o mcp-session-id do header da resposta
curl -ski -X POST https://localhost:18444/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer dev-token" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"qa","version":"1"}}}'
# → HTTP 200, header: mcp-session-id: <UUID>

# 2) notifications/initialized (mesmo session id)
curl -sk -o /dev/null -w "%{http_code}\n" -X POST https://localhost:18444/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer dev-token" \
  -H "mcp-session-id: <UUID>" \
  -d '{"jsonrpc":"2.0","method":"notifications/initialized"}'
# → 202

# 3) tools/call tc_list_agents
curl -sk -X POST https://localhost:18444/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer dev-token" \
  -H "mcp-session-id: <UUID>" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"tc_list_agents","arguments":{}}}'
```

Saída esperada com o agente conectado:

```
data: {"result":{"content":[{"type":"text","text":"[{\"agent_id\":\"agent-test\",\"connected_at\":\"...\"}]"}],"jsonrpc":"2.0","id":2}
```

**Passo 3.5 — dispatch e auditoria** (valida o caminho capability → agente):

```bash
curl -sk -X POST https://localhost:18444/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "Authorization: Bearer dev-token" \
  -H "mcp-session-id: <UUID>" \
  -d '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"tc_dispatch_authorized_task","arguments":{"agent_id":"agent-test","action":"diagnostic.run","parameters":{"check":"path_exists","remote_path":"/tmp"}}}}'
```

Comportamento zero-trust esperado neste smoke (sem `TC_ALLOW_DIAGNOSTICS=1`
no agente):

```
{"result":{"content":[{"type":"text","text":"ERRO: Acao bloqueada pela politica local"}],"isError":true},"jsonrpc":"2.0","id":3}
```

E o agente grava no audit (deve existir `failed:diagnostic.run`):

```bash
cat /tmp/agent-audit.jsonl
# {"audit_id":"...","status":"failed","agent_id":"agent-test","user_id":"codex-service","action":"diagnostic.run",...}
```

Isso é o **teste negativo correto**: o broker allowlist autorizou a ação, a
capability foi assinada e validada, mas a policy local do agente bloqueou —
prova de que as duas camadas de autorização funcionam. O dispatch só executa
quando a ação está habilitada no agente (ver seção 5.3).

Encerre os dois processos ao terminar o smoke.

---

## 4. Registry de ambientes QA/PRD no agente

O registro é um JSON apontado por `TC_ENVIRONMENT_REGISTRY_FILE` e é lido na
inicialização **do agente** (host Teamcenter). O repositório traz
`docs/environments.example.json` com dois perfis (`tc2606-dev` QA e
`tc2606-prd` PRD). No host QA desta homologação, use um registry de **perfil
único** `tc2606-qa` (é isso que ativa o `environment_id` no envelope — seção
4.3):

```json
{
  "environments": [
    {
      "schemaVersion": 1,
      "environmentId": "tc2606-qa",
      "classification": "QA",
      "displayName": "Teamcenter 2606 QA",
      "teamcenterRelease": "2606",
      "hosts": ["SRV26-TC1-QA"],
      "expectedComponents": ["server-manager", "webtier", "gateway", "fsc"],
      "policyProfile": "qa-standard"
    }
  ]
}
```

### 4.1 Regras de validação (comportamento verificado)

- Schema estrito: `classification` aceita somente `QA` ou `PRD`; campos extras
  são **rejeitados** (`Unrecognized key(s) in object`).
- Perfil inválido **não derruba o agente**: vira erro isolado em
  `environmentRegistryErrors` (ex.: `perfil tc2606-qa invalido: Invalid enum
value. Expected 'QA' | 'PRD', received 'HOMOLOG' em classification`).
- Arquivo que não é JSON válido **derruba** a inicialização com mensagem
  clara (`registro ... nao e JSON valido`); registro vazio também
  (`registro de ambientes nao pode estar vazio`).

### 4.2 Validação rápida (qualquer máquina com o repo)

```bash
node --input-type=module -e '
import { readEnvironmentRegistrySync } from "./src/environments/registry.js";
const r = readEnvironmentRegistrySync("docs/environments.example.json");
console.log("perfis validos:", [...r.environments.keys()].join(", "));
console.log("erros:", r.errors.length);
'
# perfis validos: tc2606-dev, tc2606-prd
# erros: 0
```

### 4.3 Impacto no envelope CheckResult

Quando o registry tem exatamente **um** perfil, o `environment_id` é
carregado no envelope `check_result` das ações SOA (via
`soaCheckResult`). Com múltiplos perfis, o envelope sai sem `environment_id`
até o collector receber o `environmentId` explícito — comportamento esperado
na Fase 1.

---

## 5. Homologação distribuída (VPS + host Teamcenter + Mac)

### 5.1 Preparar a VPS — broker

Crie `/opt/tc-bridge/.env` na VPS (modo `600`):

```bash
TC_BROKER_PORT=8443
TC_BROKER_API_PORT=8444
TC_BROKER_TLS_KEY=/etc/tc-certs/broker-key.pem
TC_BROKER_TLS_CERTIFICATE=/etc/tc-certs/broker-cert.pem
TC_BROKER_CLIENT_CA=/etc/tc-certs/ca.pem
TC_BROKER_API_TOKEN=<token-gerado-com-secrets-token-urlsafe-48>
TC_CAPABILITY_PRIVATE_KEY=/etc/tc-certs/capability-private.pem
TC_CAPABILITY_ISSUER=https://broker.exemplo.com
TC_BROKER_ALLOWED_ACTIONS=diagnostic.run;teamcenter.logs.read;teamcenter.soa.preflight;teamcenter.soa.connection_health;browser.status;browser.pages
TC_BROKER_SUBJECT=codex-service
TC_CAPABILITY_TTL_SECONDS=60
```

> `TC_BROKER_API_TLS_KEY`/`TC_BROKER_API_TLS_CERTIFICATE` são opcionais; se
> omitidos, a API MCP reutiliza o certificado mTLS do broker (adequado para
> homologação; para produção use um certificado que o cliente MCP da AI
> confie). `TC_BROKER_ALLOWED_ACTIONS` é a allowlist do broker — cada ação
> listada aqui ainda precisa estar habilitada **no agente** para executar.

Subir (testar primeiro em foreground):

```bash
cd /opt/tc-bridge && node bin/tc-broker.js
```

Comportamento validado:

```text
[tc-broker] escutando com mTLS na porta 8443
[tc-broker] MCP cloud escutando em https://0.0.0.0:8444/mcp
```

Verificações da VPS:

```bash
# sem token → 401; com token → {"ok":true}
curl -sk -o /dev/null -w "%{http_code}\n" https://broker.exemplo.com:8444/health
curl -sk -H "Authorization: Bearer $TC_BROKER_API_TOKEN" https://broker.exemplo.com:8444/health
```

**Exigências de inicialização** (o processo aborta se faltar qualquer uma):
`TC_BROKER_TLS_KEY`, `TC_BROKER_TLS_CERTIFICATE`, `TC_BROKER_CLIENT_CA`,
`TC_BROKER_API_TOKEN`, `TC_CAPABILITY_PRIVATE_KEY`, `TC_CAPABILITY_ISSUER`,
`TC_BROKER_ALLOWED_ACTIONS`. Valida também `1 <= TC_BROKER_API_PORT <= 65535`
e `1 <= TC_CAPABILITY_TTL_SECONDS <= 300`.

**Para produção/homologação contínua**, rode sob um gerenciador de processos
(systemd/PM2) com reinício automático e logs rotacionados. No `SIGTERM`/`SIGINT`
o broker encerra os websockets dos agentes e fecha a API e o canal mTLS, com
saída forçada após 5s se alguma conexão não ceder — não dependa do `SIGKILL` do
systemd. Se a unit ainda usar o `TimeoutStopSec` padrão (90s), reduza para 10s:

### 5.2 Preparar o host Teamcenter — agente

Na máquina Windows do upgrade, o script `scripts/setup-tc-agent.ps1` gera o
`.env` completo com token aleatório, caminhos e as variáveis do broker:

```powershell
.\scripts\setup-tc-agent.ps1 `
  -BrokerUrl 'wss://broker.exemplo.com:8443/agent' `
  -AgentId 'tc2606-qa-01' `
  -CapabilityPublicKeyPath 'E:\tc-agent\certs\capability-public.pem' `
  -AgentCertificatePath 'E:\tc-agent\certs\agent-cert.pem' `
  -AgentPrivateKeyPath 'E:\tc-agent\certs\agent-key.pem' `
  -BrokerCaPath 'E:\tc-agent\certs\ca.pem' `
  -AllowedReadPaths @('E:\PLM','E:\logs') `
  -EnableTeamcenterRead -TeamcenterUrl 'http://localhost:8080/tc' `
  -TeamcenterUser 'tc_bridge_reader' `
  -TeamcenterSoaLib 'E:\PLM\Teamcenter2606\SOA\lib' `
  -TeamcenterSoaAdapterJar 'E:\tc-agent\build\soa-adapter\tc-bridge-soa-adapter.jar' `
  -EnableDiagnostics -EnableBrowserDiagnostics `
  -StartAgent
```

> O script de setup **não** possui switch `-EnableLogRead` (parâmetros
> disponíveis: `-EnableDiagnostics`, `-EnableDbDiagnostics`,
> `-EnableTeamcenterRead`, `-EnableBrowserDiagnostics`). A leitura de logs
> Teamcenter é habilitada à parte, acrescentando ao `.env` gerado:
> `TC_ALLOW_LOG_READ=1` e `TC_TEAMCENTER_LOG_DIR=E:\logs` — junto com a
> permissão da action `teamcenter.logs.read` na allowlist do broker.

> Pré-requisitos do SOA: compilar o adaptador com
> `scripts/build-soa-adapter.ps1 -TeamcenterLib <lib SOA> -JdkHome E:\PLM\JAVA_JDK`
> e apontar `-TeamcenterSoaAdapterJar` para o artefato gerado
> (`build\soa-adapter\tc-bridge-soa-adapter.jar`). O setup grava somente o
> master switch `TC_ALLOW_TEAMCENTER_READ=1` (via `-EnableTeamcenterRead`);
> `preflight` e `connection_health` ficam habilitados por herança desse master
> (fallback no catálogo de campos) — não precisam de flag própria. As ações
> granulares restantes (`preferences`, `objects`, `queries`, `datasets`, `fms`)
> **não** são geradas pelo setup: permanecem desligadas até você acrescentar a
> flag explícita (`TC_ALLOW_TEAMCENTER_SOA_*`) e o arquivo de policy local
> (`TC_TEAMCENTER_SOA_POLICY_FILE`) ao `.env`, somente quando o ambiente QA
> estiver pronto para elas.

**Registry QA no agente** — acrescente ao `.env` gerado:

```
TC_ENVIRONMENT_REGISTRY_FILE=E:\tc-agent\environments.qa.json
```

com o conteúdo do exemplo de perfil único `tc2606-qa` da seção 4. Reinicie o
agente após alterar o `.env`.

O agente exige na inicialização (aborta se faltar): `TC_TOKEN`,
`TC_ALLOWED_READ_PATHS`, `TC_ALLOW_CAPABILITY_TASKS=1`, `TC_AGENT_ID`,
`TC_CAPABILITY_PUBLIC_KEY`, `TC_CAPABILITY_ISSUER`, `TC_BROKER_URL`
(obrigatório `wss://`), `TC_AGENT_CERTIFICATE`, `TC_AGENT_PRIVATE_KEY`,
`TC_BROKER_CA`.

Com `TC_ENFORCE_CAPABILITIES=1` (default do setup), as ferramentas diretas
privilegiadas (browser, SOA, SQL, diagnóstico) ficam ocultas do MCP e só
executam via `tc_authorized_task` com capability.

### 5.3 Teste positivo de dispatch (validação do caminho completo)

Com o agente **QA** tendo `TC_ALLOW_DIAGNOSTICS=1` (Windows), repita o
Passo 3.5 trocando o agente e a ação:

```bash
# action habilitada no agente e na allowlist do broker
... "tc_dispatch_authorized_task" ...
... {"agent_id":"tc2606-qa-01","action":"diagnostic.run","parameters":{"check":"service_status","service_name":"TcServer"}} ...
```

Saída esperada: `content` com o resultado do check e **sem** `isError`. O
audit do agente registra `started` e `completed` com `audit_id`, `user_id`
(`codex-service`). No `completed`, a telemetria `volume_bytes` é sempre
preenchida; `duration_ms` aparece quando o handler reporta
`_meta.durationMs` — é o caso das ações SOA (o adaptador injeta `_meta`),
não do `diagnostic.run`.

### 5.4 Conectar a AI (Mac)

Configure um servidor MCP remoto apontando para a API do broker.

**opencode** (`~/.config/opencode/opencode.json`):

```json
{
  "mcp": {
    "tc-broker": {
      "type": "remote",
      "url": "https://broker.exemplo.com:8444/mcp",
      "enabled": true,
      "headers": {
        "Authorization": "Bearer <TC_BROKER_API_TOKEN>"
      }
    }
  }
}
```

**Codex** (configuração equivalente de MCP remoto HTTPS; a API MCP não usa o
certificado de agente — somente o canal `/agent` usa mTLS).

Ferramentas expostas ao modelo:

- `tc_list_agents` — lista agentes Teamcenter conectados ao broker.
- `tc_dispatch_authorized_task` — assina capability de uso único e executa uma
  ação permitida num agente conectado (argumentos: `agent_id`, `action`,
  `parameters`).

**Cenário de fumaça com a AI** (valida ponta a ponta Mac → VPS → host):

1. Peça ao modelo: _"liste os agentes Teamcenter conectados"_ →
   `tc_list_agents` → retorna `tc2606-qa-01`.
2. Peça: _"rode o preflight SOA no agente tc2606-qa-01"_ →
   `tc_dispatch_authorized_task` com `action: teamcenter.soa.preflight` (impact
   budget `zero`, não executa query) → resposta com `check_result` (envelope
   `CheckResult` com `checkId`, `collector: teamcenter.soa`, `status`,
   `impactBudget: zero`).
3. Confirme no host que o audit registrou o evento `completed`.

---

## 6. Matriz de cenários de homologação

### 6.1 Positivos

| #   | Cenário                      | Procedimento                                                           | Critério de aceite                                                                      |
| --- | ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| P1  | Broker sobe com mTLS         | Seção 5.1                                                              | Logs `escutando com mTLS na porta 8443` e `MCP cloud escutando em https://...:8444/mcp` |
| P2  | API MCP autentica            | `curl /health` sem e com token                                         | 401 sem token; `{"ok":true}` com token                                                  |
| P3  | Agente conecta ao broker     | Subir agente com certs corretos                                        | `tc_list_agents` retorna `agent_id` + `connected_at`; audit sem `failed`                |
| P4  | CN do cert casa com agent_id | Cert `CN=tc2606-qa-01`, `TC_AGENT_ID=tc2606-qa-01`                     | Conexão aceita (P3)                                                                     |
| P5  | Registry QA carregado        | `TC_ENVIRONMENT_REGISTRY_FILE` apontando para perfil QA válido         | Boot sem erro; validação da seção 4.2 retorna 0 erros                                   |
| P6  | Dispatch de ação autorizada  | `diagnostic.run`/`teamcenter.soa.preflight` habilitados nos dois lados | Resposta sem `isError`; audit `completed`                                               |
| P7  | AI ponta a ponta             | Seção 5.4                                                              | Modelo lista agentes e recebe resultado do dispatch                                     |
| P8  | Envelope CheckResult         | Dispatch `teamcenter.soa.preflight` com registry de 1 perfil           | Resposta traz `check_result` com `checkId`/`collector`/`status`/`impactBudget`          |

### 6.2 Negativos (segurança)

| #   | Cenário                            | Como provocar                                                                                                   | Resultado esperado                                                                              |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| N1  | API sem token                      | `curl /health` ou `/mcp` sem `Authorization`                                                                    | HTTP 401                                                                                        |
| N2  | Token errado                       | Bearer com valor inválido                                                                                       | HTTP 401                                                                                        |
| N3  | Action fora da allowlist do broker | Dispatch `action: teamcenter.soa.object.inspect` sem ela em `TC_BROKER_ALLOWED_ACTIONS`                         | `ERRO: Acao bloqueada pela politica do broker` (`isError: true`)                                |
| N4  | Action não habilitada no agente    | Action na allowlist do broker mas flag do agente desligada (ex.: `diagnostic.run` sem `TC_ALLOW_DIAGNOSTICS=1`) | `ERRO: Acao bloqueada pela politica local`; audit `failed`                                      |
| N5  | Agente inexistente                 | Dispatch com `agent_id` sem conexão                                                                             | `ERRO: Agente indisponivel: <id>`                                                               |
| N6  | CN diverge do agent_id             | Cert com CN diferente de `TC_AGENT_ID`                                                                          | Broker fecha conexão; agente entra em reconexão com backoff                                     |
| N7  | Parâmetro fora do escopo           | `parameters` com campo não autorizado ou acima do `max_*`                                                       | Falha no agente: `Parametro sem autorizacao no escopo` / `Parametro excede o maximo autorizado` |
| N8  | Replay de capability               | Reenviar a mesma capability                                                                                     | `Capability ja foi utilizada`                                                                   |
| N9  | Capability expirada                | Dispatch após `TC_CAPABILITY_TTL_SECONDS` (ou relógio adiantado)                                                | `Capability expirada`                                                                           |
| N10 | Registry com perfil inválido       | Perfil com `classification: HOMOLOG` ou campo extra                                                             | Agente **sobe**; erro isolado listado; envio de `environment_id` não ocorre                     |
| N11 | Registry não-JSON / vazio          | Arquivo malformado ou `environments: []`                                                                        | Inicialização aborta com mensagem clara                                                         |
| N12 | Capability adulterada              | Alterar payload/assinatura antes do envio                                                                       | `Assinatura de capability invalida`                                                             |
| N13 | Ferramenta direta com enforce      | `TC_ENFORCE_CAPABILITIES=1` e tentar chamar tool privilegiada direto                                            | Tool não existe no MCP (removida em `makeTools`)                                                |

### 6.3 Resiliência

| #   | Cenário                        | Como provocar                            | Resultado esperado                                                                                                                             |
| --- | ------------------------------ | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Broker offline                 | Derrubar broker com agente conectado     | Agente loga `broker desconectado` e reconecta com backoff exponencial + jitter (5s → 60s)                                                      |
| R2  | Broker volta                   | Religar broker                           | Agente reconecta e reaparece em `tc_list_agents`; resultados pendentes do buffer são enviados (`TC_AGENT_RESULT_BUFFER_CAPACITY`, drop-oldest) |
| R3  | Agente reinicia durante tarefa | Matar agente no meio de um dispatch      | Broker responde `Tempo esgotado aguardando agente` após `taskTimeoutMs` (60s)                                                                  |
| R4  | Restart limpo                  | `SIGINT`/`SIGTERM` no broker e no agente | Broker encerra websockets e fecha API+mTLS, saindo em ≤5s (sem esperar `SIGKILL` do systemd); agente reconecta com backoff                     |

---

## 7. Observabilidade

| Onde    | O quê                 | Como                                                                                                                                                                                                                                    |
| ------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VPS     | Logs do broker        | stdout: `escutando com mTLS`, `MCP cloud escutando`                                                                                                                                                                                     |
| host TC | Audit JSONL           | `TC_AUDIT_LOG_PATH` (padrão `logs/tc-agent-audit.jsonl`): eventos `started`/`completed`/`failed` com `audit_id`, `agent_id`, `user_id`, `action`, `jti`, telemetria (`duration_ms`, `volume_bytes`, `truncated`, `partial_error_count`) |
| host TC | Reconexão             | stdout do agente: `broker error`, `broker desconectado; reconectando em ...ms (tentativa N)`                                                                                                                                            |
| host TC | Health/readiness HTTP | Servidor `tc-bridge` (modo bridge) expõe `/health` e `/ready` públicos e `/metrics` com token; o modo `tc-agent` puro não escuta HTTP — use o broker como sonda                                                                         |
| VPS     | API MCP               | `GET /health` (Bearer)                                                                                                                                                                                                                  |

---

## 8. Encerramento e limpeza

1. Encerre a AI / remova o servidor MCP remoto da configuração do cliente.
2. Na VPS: `SIGTERM` no broker → confirma encerramento ordenado.
3. No host: `SIGTERM` no agente; remova o `.env` e os materiais de identidade
   se o ambiente for descartado.
4. Revogue/descarte a CA do ambiente controlado ao final da homologação.
5. Rotacione `TC_BROKER_API_TOKEN` se ele foi exposto em logs ou capturas.

---

## 9. Lacunas conhecidas (fora do escopo desta homologação)

- **Autenticação de usuário**: a API MCP usa token de serviço; produção exige
  OIDC/MFA e autorização por usuário (README, seção do broker).
- **Persistência de agentes**: o broker mantém agentes em memória; não há
  registro/persistência entre reinícios.
- **Auditoria central**: a auditoria é local ao agente (JSONL); não há coleta
  centralizada ainda.
- **Actions Fase 2**: `environment.discover`, `environment.topology`,
  `host.disk.health`, `teamcenter.server_manager.health` etc. estão no
  catálogo do plano QA/PRD (§11), não nesta baseline.
- **Browser/CDP**: os cenários de browser exigem Chrome com
  `--remote-debugging-port=9222` no host e são cobertos somente quando
  `TC_ALLOW_BROWSER_DIAGNOSTICS=1`.
