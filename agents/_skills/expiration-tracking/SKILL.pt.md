<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Extrai prazos das ofertas e fornece informacao factual sobre eles apenas apos um pedido explicito do utilizador. Nunca notifiques nem pressiones automaticamente.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *)
---

# expiration-tracking — dados de prazo a pedido

Os prazos ajudam o utilizador a avaliar oportunidades. Conserva-os com precisao, mas nao os transformes num lembrete, convite a candidatar-se ou medida de progresso.

## A. Scout/Analista: extração de prazo do JD

Quando insere uma nova position (Scout) ou quando enriquece o JD
(Analista), passe o texto por `deadline_extract`:

```bash
# CLI direto: extrai de stdin ou --jd
echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py
# → 2026-06-15 (data ISO) ou string vazia

# Inline no db_insert.py position
deadline_iso=$(echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py)
if [ -n "$deadline_iso" ]; then
  python3 /app/shared/skills/db_insert.py position \
    --title "$TITLE" --company "$COMPANY" --url "$URL" \
    --jd-text "$JD_TEXT" \
    --deadline "$deadline_iso"  # ← novo, F-4
fi
```

O parser é **conservador** (apenas ISO, dd/mm/yyyy EU, Month dd[, yyyy]
EN/IT, "expires in N days"). Se não encontrar um match de alta confiança
retorna string vazia → melhor NULL no DB que data inventada.

## C. Informacao de prazo, so a pedido

Usa esta secao apenas enquanto respondes a pergunta explicita do utilizador sobre o prazo de uma posicao ou candidatura. Nunca a agendes, envies proativamente ou reencaminhes a saida como notificacao.

Executa: python3 /app/shared/skills/expiration_alerts.py --user-requested

A saida fornece informacao factual sobre prazos de posicoes que ja estao nos registos do utilizador, por exemplo: [DEADLINE] Sisal Data Analyst (PASS 7.5) — expira em 2026-05-18 (amanha).

## B. Re-check periódico de positions antigas (Analista) — POR FAZER

Extensão futura da skill `liveness-check`: a cada 6h, refetch URL
das positions em `status IN ('scored', 'ready')` com `last_checked <
NOW() - 12h`. Se o URL retornar 404 / "no longer accepting" → flip para
`status='expired'` + nota. Fora de escopo para F-4 inicial; o bottom-up
dos deadlines capturados do JD cobre a maioria dos casos.

## Anti-padrões

- Nao executes o relatorio de prazos sem um pedido explicito do utilizador.
- Nao transformes a informacao de prazo num convite, lembrete ou pressao para se candidatar.

## Ver também

- `shared/skills/deadline_extract.py` — parser
- shared/skills/expiration_alerts.py — relatorio de prazo a pedido
- `agents/_skills/db-update/SKILL.md` § Positions — flag `--deadline`
