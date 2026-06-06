<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Határidő kinyerése a JD-ből (deadline_extract helper) és felhasználói riasztás generálása, amikor egy READY pályázat hamarosan lejár (expiration_alerts helper, idempotens). F-4 task #50. Scout/Analista feltöltik a positions.deadline-t, Mentor/Capitano értesítik a felhasználót, ha deadline-now ≤ 3 nap.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *), Bash(jht-telegram-send *)
---

# expiration-tracking — ne veszíts el top PASS-t lejárat miatt

Rejtett bug F-4: a felhasználó felhalmoz 50 `ready` CV-t, elfelejt pályázni
2 napig, a top lehetőség (pl. Sisal PASS 7.5) csendben lejár.
A pipeline felhasználó-kurált apply (bug #9 visszasorolva) → proaktív riasztás
nélkül a csapat buzgalmát a top CV-k betanítására a
felhasználó csendje semmisíti meg.

## A. Scout/Analista: határidő kinyerés a JD-ből

Amikor új pozíciót szúrsz be (Scout) vagy gazdagítod a JD-t
(Analista), futtasd át a szöveget a `deadline_extract`-en:

```bash
# Közvetlen CLI: stdin-ről vagy --jd-ből olvas
echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py
# → 2026-06-15 (ISO dátum) vagy üres string

# Inline a db_insert.py position-ban
deadline_iso=$(echo "$JD_TEXT" | python3 /app/shared/skills/deadline_extract.py)
if [ -n "$deadline_iso" ]; then
  python3 /app/shared/skills/db_insert.py position \
    --title "$TITLE" --company "$COMPANY" --url "$URL" \
    --jd-text "$JD_TEXT" \
    --deadline "$deadline_iso"  # ← új, F-4
fi
```

A parser **konzervatív** (csak ISO, dd/mm/yyyy EU, Month dd[, yyyy]
EN/IT, "expires in N days"). Ha nem talál magas megbízhatóságú egyezést,
üres stringet ad → jobb a NULL a DB-ben, mint kitalált dátum.

## C. Mentor/Capitano: proaktív felhasználói riasztás

Javasolt trigger: minden `[BRIDGE TICK]` után (Capitano) vagy a
Mentor menet végén. Az idempotencia biztosítja, hogy a gyakori hívások csak
ÚJ (app_id, deadline_iso) párokra produkálnak riasztást.

```bash
alerts=$(python3 /app/shared/skills/expiration_alerts.py)
if [ -n "$alerts" ]; then
  # Küldés a felhasználónak Telegramon
  echo "$alerts" | jht-telegram-send --from capitano --keyboard capitano
fi
```

Kimenet 1 sor veszélyeztetett alkalmazásonként:
```
⏳ [ALERT scadenza] Sisal Data Analyst (PASS 7.5) — scade 2026-05-18 (DOMANI). Spedisci candidatura o perdi l'opportunità.
```

Az idempotenciás állapot a `$JHT_HOME/state/expiration_alerts_sent.json`-ban van
(már értesített `(app_id, deadline_iso)` halmaz). Egy már küldött
riasztás újraküldéséhez: `expiration_alerts.py --reset` (csak dev).

## B. Régi pozíciók periodikus újra-ellenőrzése (Analista) — ELVÉGZENDŐ

A `liveness-check` skill jövőbeli kiterjesztése: 6 óránként refetch URL
a `status IN ('scored', 'ready')` pozíciókhoz, ahol `last_checked <
NOW() - 12h`. Ha az URL 404-et / "no longer accepting"-et ad → státusz váltás
`status='expired'` + megjegyzés. Az F-4 kezdeti hatókörén kívül; a JD-ből
kinyert határidők alulról felfelé fedik a legtöbb esetet.

## Anti-minták

- ❌ Határidő kézi regex-szel való parse-olása inline — használd a helper-t, ami
  EN/IT tartalékkal és múltbeli dátum szanálás-ellenőrzéssel rendelkezik.
- ❌ Határidő kitalálása, amikor a JD nem specifikálja kifejezetten —
  jobb a `NULL`, mint az `+30d önkényes`.
- ❌ A felhasználó spammelése ugyanazzal a riasztással 6 óránként — az idempotenciás
  állapot pontosan ezért létezik.
- ❌ A riasztás küldése a Capitano-tól eltérő bottól (pl. általános Assistente)
  — elveszíti az operatív kontextust; a Capitano a pipeline-hoz kíséri.

## Lásd még

- `shared/skills/deadline_extract.py` — parser
- `shared/skills/expiration_alerts.py` — emitter + idempotenciás állapot
- `agents/_skills/db-update/SKILL.md` § Positions — `--deadline` jelző
- `docs/internal/_archive/2026-05-17-team-strategy-bugs.md` §F-4
