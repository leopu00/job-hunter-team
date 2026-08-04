<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Estrae le scadenze dalle job description e riporta informazioni fattuali sulle scadenze solo su richiesta esplicita dell'utente. Non notificare o sollecitare mai automaticamente.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *)
---

# expiration-tracking — dati sulle scadenze su richiesta

Le scadenze aiutano l'utente a valutare le opportunita'. Conservale con precisione, ma non trasformarle in un promemoria, un invito a candidarsi o una misura di avanzamento.

## A. Scout/Analista: estrazione deadline dal JD

Quando inserisci una nuova position (Scout) o quando arricchisci la JD
(Analista), passa il testo per `deadline_extract`:

```bash
# CLI diretto: estrae da stdin o --jd
echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py
# → 2026-06-15 (data ISO) o stringa vuota

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

## C. Informazioni sulla scadenza, solo su richiesta

Usa questa sezione solo mentre rispondi alla domanda esplicita dell'utente sulla scadenza di una posizione o candidatura. Non programmarla, non inviarla in modo proattivo e non inoltrare mai l'output come notifica.

Esegui: python3 /app/shared/skills/expiration_alerts.py --user-requested

L'output riporta informazioni fattuali sulle scadenze delle posizioni gia' nei record dell'utente, per esempio: [DEADLINE] Sisal Data Analyst (PASS 7.5) — scade 2026-05-18 (domani).

## B. Re-check periodica positions vecchie (Analista) — DA FARE

Estensione futura della skill `liveness-check`: ogni 6h, refetch URL
delle positions in `status IN ('scored', 'ready')` con `last_checked <
NOW() - 12h`. Se l'URL ritorna 404 / "no longer accepting" → flip a
`status='expired'` + nota. Fuori scope per F-4 iniziale; il bottom-up
dei deadline catturati dal JD copre la maggior parte dei casi.

## Anti-pattern

- Non eseguire il report delle scadenze senza una richiesta esplicita dell'utente.
- Non trasformare la scadenza in un invito, promemoria o pressione a candidarsi.

## Vedi anche

- `shared/skills/deadline_extract.py` — parser
- shared/skills/expiration_alerts.py — report delle scadenze su richiesta
- `agents/_skills/db-update/SKILL.md` § Positions — flag `--deadline`
