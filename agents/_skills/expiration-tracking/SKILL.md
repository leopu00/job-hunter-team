---
name: expiration-tracking
description: Estrae deadline dal JD (helper deadline_extract) e produce alert utente quando una candidatura READY sta per scadere (helper expiration_alerts, idempotente). F-4 task #50. Scout/Analista popolano positions.deadline, Mentor/Capitano notificano l'utente quando deadline-now ≤ 3 giorni.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *), Bash(jht-telegram-send *)
---

# expiration-tracking — non perdere top PASS per scadenza

Bug latente F-4: utente accumula 50 CV `ready`, dimentica di applicare
per 2 giorni, top opportunità (es. Sisal PASS 7.5) scade in silenzio.
La pipeline è user-curated apply (bug #9 declassato) → senza alert
proattivo, lo zelo del team ad addestrare top CV viene vanificato dal
silenzio dell'utente.

## A. Scout/Analista: estrazione deadline dal JD

Quando inserisci una nuova position (Scout) o quando arricchisci la JD
(Analista), passa il testo per `deadline_extract`:

```bash
# Direct CLI: estrae da stdin o --jd
echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py
# → 2026-06-15 (ISO date) o stringa vuota

# Inline nel db_insert.py position
deadline_iso=$(echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py)
if [ -n "$deadline_iso" ]; then
  python3 /app/shared/skills/db_insert.py position \
    --title "$TITLE" --company "$COMPANY" --url "$URL" \
    --jd-text "$JD_TEXT" \
    --deadline "$deadline_iso"  # ← nuovo, F-4
fi
```

Il parser è **conservativo** (solo ISO, dd/mm/yyyy EU, Month dd[, yyyy]
EN/IT, "expires in N days"). Se non trova un match ad alta confidenza
restituisce stringa vuota → meglio NULL nel DB che data inventata.

## C. Mentor/Capitano: alert utente proattivo

Trigger consigliato: dopo ogni `[BRIDGE TICK]` (Capitano) o end-of-pass
del Mentor. Idempotenza fa sì che chiamate frequenti producano alert
solo per NUOVE coppie (app_id, deadline_iso).

```bash
alerts=$(python3 /app/shared/skills/expiration_alerts.py)
if [ -n "$alerts" ]; then
  # Manda all'utente via Telegram
  echo "$alerts" | jht-telegram-send --from capitano --keyboard capitano
fi
```

Output 1 riga per application a rischio:
```
⏳ [ALERT scadenza] Sisal Data Analyst (PASS 7.5) — scade 2026-05-18 (DOMANI). Spedisci candidatura o perdi l'opportunità.
```

Lo state idempotency è in `$JHT_HOME/state/expiration_alerts_sent.json`
(set di `(app_id, deadline_iso)` già notificati). Per re-spedire un
alert già mandato: `expiration_alerts.py --reset` (dev-only).

## B. Re-check periodica positions vecchie (Analista) — DA FARE

Estensione futura della skill `liveness-check`: ogni 6h, refetch URL
delle positions in `status IN ('scored', 'ready')` con `last_checked <
NOW() - 12h`. Se l'URL ritorna 404 / "no longer accepting" → flip a
`status='expired'` + nota. Out of scope per F-4 iniziale; il bottom-up
dei deadline catturati dal JD copre la maggior parte dei casi.

## Anti-patterns

- ❌ Parsare deadline a mano con regex inline — usa il helper, ha
  fallback EN/IT + sanity check su date passate.
- ❌ Inventare deadline quando il JD non la specifica esplicitamente —
  meglio `NULL` che `+30d arbitrario`.
- ❌ Spammare l'utente con lo stesso alert ogni 6h — l'idempotency
  state esiste apposta.
- ❌ Mandare l'alert da bot diverso dal Capitano (es. Assistente
  generico) — perde contesto operativo; il Capitano lo accompagna
  alla pipeline.

## See also

- `shared/skills/deadline_extract.py` — parser
- `shared/skills/expiration_alerts.py` — emitter + idempotency state
- `agents/_skills/db-update/SKILL.md` § Positions — `--deadline` flag
- `docs/internal/2026-05-17-team-strategy-bugs.md` §F-4
