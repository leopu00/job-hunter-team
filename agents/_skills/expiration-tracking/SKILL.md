---
name: expiration-tracking
description: Extract deadlines from job descriptions and report factual deadline information only after an explicit user request. Never notify or prompt the user automatically.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *)
---

# expiration-tracking — deadline data on request

Deadline data helps the user evaluate opportunities. Preserve it accurately, but do not turn it into a reminder, a prompt to apply, or a measure of progress.

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

## C. Deadline information, only on request

Use this section only while answering the user's explicit question about the deadline of a position or application. Never schedule it, send it proactively, or forward its output as a notification.

Run: python3 /app/shared/skills/expiration_alerts.py --user-requested

The output is factual deadline information for positions already in the user's records, for example: [DEADLINE] Sisal Data Analyst (PASS 7.5) — expires 2026-05-18 (tomorrow).

## B. Re-check periodica positions vecchie (Analista) — DA FARE

Estensione futura della skill `liveness-check`: ogni 6h, refetch URL
delle positions in `status IN ('scored', 'ready')` con `last_checked <
NOW() - 12h`. Se l'URL ritorna 404 / "no longer accepting" → flip a
`status='expired'` + nota. Out of scope per F-4 iniziale; il bottom-up
dei deadline catturati dal JD copre la maggior parte dei casi.

## Anti-patterns

- Do not run the deadline report without an explicit user request.
- Do not turn deadline information into a prompt, reminder, or pressure to apply.

## See also

- `shared/skills/deadline_extract.py` — parser
- shared/skills/expiration_alerts.py — on-request deadline reporter
- `agents/_skills/db-update/SKILL.md` § Positions — `--deadline` flag
