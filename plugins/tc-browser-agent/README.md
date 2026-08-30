# tc-browser-agent

Plugin opcional do tc-bridge para diagnosticar um Chrome local iniciado com
remote debugging. A implementacao esta em `src/browser-agent.js` para que as
ferramentas sejam publicadas pelo mesmo endpoint MCP autenticado do tc-bridge.

Ative somente com `TC_ALLOW_BROWSER_DIAGNOSTICS=1`. O endpoint CDP e limitado
a loopback e as ferramentas nao leem cookies, storage ou corpos HTTP.
