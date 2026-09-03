# Runbook: Indisponibilidade do Gateway Documental

## Sintoma

- `tc_documentation_search` retorna erro ou resultado vazio.
- Log do broker: `Gateway documental indisponivel: ...`
- Adapter do gateway lança exceção (timeout, DNS, certificado).

## Impacto

- Busca documental Siemens fica indisponível.
- O broker continua operando com catálogo local e qmd (se habilitado).
- Rascunhos que dependem de fontes Siemens não podem alcançar `validated` até
  que o gateway retorne.

## Verificação imediata

1. **Verificar conectividade de rede**
   - Do host do broker, teste `curl -I <TC_DOCS_MCP_URL>/health`.
   - Verifique DNS, proxy e TLS.

2. **Verificar credenciais**
   - `TC_DOCS_MCP_TOKEN` não expirou.
   - Token não foi revogado no gateway.

3. **Verificar limites de cota**
   - Gateway pode estar retornando `429 Too Many Requests`.
   - Reduza `TC_DOCS_MAX_RESULTS` e aumente `TC_DOCS_TIMEOUT_MS`.

## Mitigação

| Cenário                    | Ação                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| Timeout esporádico         | Retry com backoff; aumentar `TC_DOCS_TIMEOUT_MS`.                     |
| Gateway offline prolongado | Desativar `tc_documentation_search` nas tools locais até recuperação. |
| Erro de certificado        | Atualizar truststore; verificar `TC_DOCS_MCP_URL` com TLS válido.     |
| Token inválido             | Rotacionar `TC_DOCS_MCP_TOKEN` sem expor em logs.                     |

## Fallback operacional

1. Usar catálogo local (`knowledge/catalog/`) para queries e workflows
   já promovidos.
2. Direcionar usuário para documentação Siemens oficial via portal até
   recuperação do gateway.
3. Não usar respostas da LLM sem fonte como substituto da documentação.

## Recuperação

1. Após gateway voltar, executar busca de teste com query conhecida.
2. Verificar se `source_file`, `section` e `chunk_id` retornam preenchidos.
3. Se referências continuarem incompletas, abrir incidente para correção do
   indexador.

## Prevenção

- Monitorar latência do gateway (threshold: p95 < 3s).
- Alertar quando taxa de erro > 5% em 5 minutos.
- Manter catálogo local atualizado com padrões revisados.
- Nunca armazenar credenciais do gateway em repositório.
