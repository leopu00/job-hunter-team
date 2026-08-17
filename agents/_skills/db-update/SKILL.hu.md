<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: db-update
description: Meglévő rekordok frissítése a JHT DB-ben (positions / applications). Használd pozíciók checked/excluded állapotra léptetéséhez, Critic pontszám/ítélet írásához, alkalmazások elküldöttnek jelöléséhez, fizetés frissítéséhez, last-checked frissítéséhez, stb. Mindig egy `db-query` után, amely megerősíti az aktuális rekord állapotot.
allowed-tools: Bash(python3 *)
---

# db-update — rekord frissítések a JHT DB-ben

Wrapper a `/app/shared/skills/db_update.py`-ban. Meglévő rekordok meghatározott mezőit frissíti. **Nem hoz létre** rekordokat — ahhoz lásd a `db-insert`-t.

## Általános minta

```bash
python3 /app/shared/skills/db_update.py <table> <id> --<field> <value> [--<field> <value>...]
```

Táblák: `position`, `application`.

## Pozíciók

```bash
# Léptetés checked / excluded állapotba (Analyst feladata)
python3 /app/shared/skills/db_update.py position 42 --status checked
python3 /app/shared/skills/db_update.py position 42 --status excluded

# last-checked jelölő (link életben levése megerősítve — anti-ütközés foglalásként is használt)
python3 /app/shared/skills/db_update.py position 42 --last-checked now

# Liveness: az --is-open / --last-open-check magától előre viszi a
# last_checked-et is, így az újraellenőrzött pozíció kikerül a gondozási
# sorból (amely a két dátum közül a frissebbre szűr). A --last-checked csak
# felülbírálásra kell.
python3 /app/shared/skills/db_update.py position 42 --is-open false --last-open-check now

# Fizetés a JD-ben deklarálva
python3 /app/shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Becsült fizetés (glassdoor / levels.fyi / analyst becslése)
python3 /app/shared/skills/db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Szerepkör család (szemantikai kategória).
python3 /app/shared/skills/db_update.py position 42 --role-family "Technical Writing"

# Strukturált helyszín (Analyst). Teljes példa "Dublin, Ireland" hibrid:
python3 /app/shared/skills/db_update.py position 42 \
  --loc-city "Dublin" --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false

# Speciális esetek példái:
# A) "Europe Remote" → country=NULL, continent=EU, work_country a cég HQ-jából
python3 /app/shared/skills/db_update.py position 42 \
  --loc-continent "Europe" --work-mode "remote" \
  --work-country "United States" --work-country-code "US" \
  --location-notes "Remote within EU, US-based company"

# B) "Italy" + full_remote
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Italy" --loc-country-code "IT" --loc-continent "Europe" \
  --work-mode "remote" --work-country "Italy" --work-country-code "IT"

# E) Több helyszín ugyanabban az országban ("Barcelona / Malaga")
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Spain" --loc-country-code "ES" --loc-continent "Europe" \
  --work-mode "hybrid" --work-country "Spain" --work-country-code "ES" \
  --is-multi-location true --location-notes "Barcelona or Málaga (candidato sceglie)"

# Mező "törléséhez" (NULL beállítás) adj meg üres stringet:
python3 /app/shared/skills/db_update.py position 42 --loc-city ""
```

## Alkalmazások

```bash
# Critic ítélet (körenként: NEEDS_WORK / PASS / REJECT) + pontszám 0-10 + megjegyzések
python3 /app/shared/skills/db_update.py application 42 --critic-verdict NEEDS_WORK --critic-score 5.0 --critic-notes "needs more detail on project X"

# CV/kísérőlevél elkészítve (Író megjelöli megírottként)
python3 /app/shared/skills/db_update.py application 42 --written-at now

# Léptetés ready-re Critic PASS után — csak Író, application-flow 7. lépésben
python3 /app/shared/skills/db_update.py application 42 --status ready

# Felhasználó megerősítette, hogy az alkalmazást elküldték
python3 /app/shared/skills/db_update.py application 42 --applied-at "2026-02-28" --applied-via linkedin
python3 /app/shared/skills/db_update.py application 42 --applied true

# Válasz érkezett (interjú / elutasítás / szellemítés)
python3 /app/shared/skills/db_update.py application 42 --response "rejected" --response-at now
```

### A pozíció állapot átmenetek automatikusan naplózódnak (bug #14)

Minden `db_update.py position <id> --status <s>` hívás, amely ténylegesen
megváltoztatja a `positions.status`-t, beszúr egy sort a `position_state_transitions`
táblába `from_state`, `to_state`, `ts`, `by_agent` (a `JHT_AGENT_NAME`-ből),
és az átadott `--notes` mezővel (ha van). Ugyanez vonatkozik az első
`db_insert.py position`-re (naplózva mint `NULL → 'new'`).

Nem kell semmit csinálnod — a wrapper kezeli. Ne kerüld meg
nyers SQL-lel: egy `python3 -c "import sqlite3; UPDATE positions SET
status=..."` megkerülés kihagyja az átmenet naplót és a throughput /
tölcsér diagramok alulszámlálnak.

### Egyetlen-író kapu az `applications.status='ready'`-n (bug #21)

Az `applications.status='ready'`-t **kizárólag a Scrittore** állítja be
az `application-flow` 7. lépésében, **csak** Critic PASS után a 3. körben.
Ez a kapu, ami a CV-t láthatóvá teszi a felhasználó `/ready`
dashboardján. Más ágensek:

- **Critic**: csak `critic_verdict` + `critic_score` írást végez. Soha `status`-t nem.
- **Capitano**: soha nem írja az `applications.status`-t. Olvashatja.
- **Mentor / Assistente**: csak olvasás az `applications`-en.

E kapu nélkül a Capitano jelenthet "12 ready"-t szóban, miközben a
DB még 0-t mutat — pontosan az az eltérés, amit a bug #21 javított.

## Biztonsági szabályok

1. **Először olvass.** Futtasd a `db-query position <id>`-t (vagy `application`-t), hogy lásd az aktuális állapotot írás előtt. A vak felülírások inkonzisztens rekordokat eredményeznek.
2. **Az állapotfolyam csak előre halad.** Jogos átmenetek: `new → checked → scored → writing → ready → applied → response`. Az `excluded` bármely lépésből elérhető, de egyetlen lépés sem megy hátra. Ne fordítsd meg.
3. **`now` időbélyeg.** A wrapper a `now` literális stringet az aktuális időbélyeggé alakítja. Ne adj meg `$(date)`-t — a parse-olást a Python oldal kezeli.
4. **Kizárási címkék a `--notes`-ban.** Amikor egy pozíciót `excluded`-ra jelölsz, az előtagot az egyik kanonikus címkével kezdd: `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` · `[STACK]`. Ugyanaz a taxonómia, amit az Analyst használ (lásd `agents/analista/analista.md` REGOLA-06).

## Ne használd erre

- Olvasások: használd a **`db-query`**-t
- Rekord létrehozás: használd a **`db-insert`**-t (csak a Scout INSERT-álja a pozíciókat)
- Séma változtatások: soha ne futtass nyers `sqlite3`-at a táblákon — megkerüli a foreign key-eket és a Next.js WAL naplózását
