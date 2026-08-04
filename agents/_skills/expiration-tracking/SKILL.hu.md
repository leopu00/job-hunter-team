<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: expiration-tracking
description: Hataridoket nyer ki az allasleirasokbol, es tenyszeru hatarido-informaciot csak a felhasznalo kifejezett keresere ad. Soha ne ertesits vagy osztonozz automatikusan.
allowed-tools: Bash(python3 /app/shared/skills/deadline_extract.py *), Bash(python3 /app/shared/skills/expiration_alerts.py *)
---

# expiration-tracking — hatarido-adatok keresre

A hataridok segitik a felhasznalot a lehetosegek ertekeleseben. Orizd meg oket pontosan, de ne alakitsd emlekeztetove, jelentkezesre valo osztonzesse vagy haladasi mertekke.

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

## C. Hatarido-informacio, csak keresre

Ezt a reszt csak akkor hasznald, amikor a felhasznalo kifejezett kerdesere valaszolsz egy pozicio vagy jelentkezes hataridejerol. Soha ne idozitsd, kuldd proaktivan, vagy tovabbitsd az outputjat ertesiteskent.

Futtatas: python3 /app/shared/skills/expiration_alerts.py --user-requested

A kimenet tenyszeru hatarido-informaciot ad a felhasznalo nyilvantartasaban mar szereplo poziciokrol, peldaul: [DEADLINE] Sisal Data Analyst (PASS 7.5) — lejar 2026-05-18 (holnap).

## B. Régi pozíciók periodikus újra-ellenőrzése (Analista) — ELVÉGZENDŐ

A `liveness-check` skill jövőbeli kiterjesztése: 6 óránként refetch URL
a `status IN ('scored', 'ready')` pozíciókhoz, ahol `last_checked <
NOW() - 12h`. Ha az URL 404-et / "no longer accepting"-et ad → státusz váltás
`status='expired'` + megjegyzés. Az F-4 kezdeti hatókörén kívül; a JD-ből
kinyert határidők alulról felfelé fedik a legtöbb esetet.

## Anti-minták

- Ne futtasd a hataridojelentest a felhasznalo kifejezett kerese nelkul.
- Ne alakitsd a hatarido-informaciot jelentkezesre osztonzo meghivassa, emlekeztetove vagy nyomassa.

## Lásd még

- `shared/skills/deadline_extract.py` — parser
- shared/skills/expiration_alerts.py — hataridojelentes keresre
- `agents/_skills/db-update/SKILL.md` § Positions — `--deadline` jelző
