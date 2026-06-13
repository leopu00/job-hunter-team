<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Extrair prazos do JD (helper deadline_extract) e produzir alertas ao utilizador quando uma candidatura READY está prestes a expirar (helper expiration_alerts, idempotente). F-4 task #50. Scout/Analista populam positions.deadline, Mentor/Capitano notificam o utilizador quando deadline-now ≤ 3 dias.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *), Bash(jht-telegram-send *)
---

# expiration-tracking — não perder top PASS por expiração

Bug latente F-4: utilizador acumula 50 CVs `ready`, esquece-se de candidatar
durante 2 dias, oportunidade top (ex. Sisal PASS 7.5) expira em silêncio.
O pipeline é user-curated apply (bug #9 desclassificado) → sem alerta
proativo, o zelo da equipa em preparar CVs top é anulado pelo
silêncio do utilizador.

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

## C. Mentor/Capitano: alerta proativo ao utilizador

Trigger recomendado: após cada `[BRIDGE TICK]` (Capitano) ou fim-de-passagem
do Mentor. Idempotência faz com que chamadas frequentes produzam alertas
apenas para NOVOS pares (app_id, deadline_iso).

```bash
alerts=$(python3 /app/shared/skills/expiration_alerts.py)
if [ -n "$alerts" ]; then
  # Enviar ao utilizador via Telegram
  echo "$alerts" | jht-telegram-send --from capitano --keyboard capitano
fi
```

Output 1 linha por application em risco:
```
⏳ [ALERT scadenza] Sisal Data Analyst (PASS 7.5) — scade 2026-05-18 (DOMANI). Spedisci candidatura o perdi l'opportunità.
```

O state de idempotência está em `$JHT_HOME/state/expiration_alerts_sent.json`
(conjunto de `(app_id, deadline_iso)` já notificados). Para re-enviar um
alerta já mandado: `expiration_alerts.py --reset` (apenas dev).

## B. Re-check periódico de positions antigas (Analista) — POR FAZER

Extensão futura da skill `liveness-check`: a cada 6h, refetch URL
das positions em `status IN ('scored', 'ready')` com `last_checked <
NOW() - 12h`. Se o URL retornar 404 / "no longer accepting" → flip para
`status='expired'` + nota. Fora de escopo para F-4 inicial; o bottom-up
dos deadlines capturados do JD cobre a maioria dos casos.

## Anti-padrões

- ❌ Parsear prazo à mão com regex inline — use o helper, tem
  fallback EN/IT + sanity check em datas passadas.
- ❌ Inventar prazo quando o JD não o especifica explicitamente —
  melhor `NULL` que `+30d arbitrário`.
- ❌ Spammar o utilizador com o mesmo alerta a cada 6h — o state de
  idempotência existe para isso.
- ❌ Enviar o alerta de bot diferente do Capitano (ex. Assistente
  genérico) — perde contexto operacional; o Capitano acompanha
  ao pipeline.

## Ver também

- `shared/skills/deadline_extract.py` — parser
- `shared/skills/expiration_alerts.py` — emitter + state de idempotência
- `agents/_skills/db-update/SKILL.md` § Positions — flag `--deadline`
