<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: db-insert
description: ÚJ rekordok beszúrása a JHT DB-be (positions / scores / applications / companies / position_highlights). Csak akkor használd, amikor egy ágensnek rekordot kell létrehoznia — Scout pozíciókhoz, Analyst cégekhez és kiemelésekhez, Scorer pontszámokhoz, Writer alkalmazásokhoz. Soha ne írd vakon felül — frissítésekhez használd a `db-update`-t.
allowed-tools: Bash(python3 *)
---

# db-insert — rekord létrehozás a JHT DB-ben

Wrapper a `/app/shared/skills/db_insert.py`-ban. Új rekordokat hoz létre a JHT SQLite DB-ben. A kötelező mezők táblánként eltérnek.

## Minta

```bash
python3 /app/shared/skills/db_insert.py <table> --<field> <value> [--<field> <value>...]
```

Táblák: `position`, `company`, `score`, `application`, `highlight`.

## Position (Scout)

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "Python Developer" --company "Acme Corp" \
  --location "Remote EU" --remote-type full_remote \
  --url "https://acme.com/jobs/42" --source linkedin --found-by scout-1 \
  --jd-text "<teljes JD szöveg>" --requirements "Python, Flask, PostgreSQL"
```

A `--url` **kötelező** (a szkript nélküle sikertelen). A Scout-nak mindig előre ellenőriznie kell a duplikátumokat a `db-query check-url`-lel.

## Company (Analyst)

```bash
python3 /app/shared/skills/db_insert.py company \
  --name "Acme Corp" --hq-country "Italy" --sector "fintech" \
  --verdict GO --analyzed-by analista-1
```

A `--verdict` elfogadja: `GO`, `CAUTIOUS`, `NO_GO`.

## Score (Scorer)

```bash
python3 /app/shared/skills/db_insert.py score \
  --position-id 42 --total 85 \
  --stack-match 35 --remote-fit 18 --salary-fit 8 \
  --experience-fit 9 --strategic-fit 15 \
  --scored-by scorer-1
```

Az 5 alpontszám DB oszlopoknak felel meg: `stack_match · remote_fit · salary_fit · experience_fit · strategic_fit`. A `--total` a kanonikus 0–100 pontszám, amelyet a Capitano olvas.

**Egy score hívásonként — írd be azonnal.** A Scorer EGY pozíció kiértékelése után rögtön beírja a score-t, majd a következőre lép. **Soha** ne értékelj több pozíciót és lődd ki az összes `score` insertet együtt a kör végén: ugyanazt a `scored_at` másodpercet kapnák és kapkodónak tűnne. Egy pozíció → egy kiértékelés → egy azonnali insert → a következő (Scorer RULE-08).

## Application (Writer)

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id 42 \
  --cv-path "/jht_user/applications/42/cv.md" \
  --cv-pdf-path "/jht_user/applications/42/cv.pdf" \
  --written-by scrittore-1 --written-at now
```

Kísérőlevél (`--cl-path` / `--cl-pdf-path`) csak ha a JD kérte.

## Highlight (Analyst / Scorer)

```bash
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack matches candidate primary stack 1:1"
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type con --text "Salary range below candidate target"
```

A `--type` értéke `pro` vagy `con`.

## Biztonsági szabályok

1. **Először olvass.** Használd a `db-query check-url <url>`-t pozíció beszúrása előtt. Használd a `db-query position <id>`-t a szülő rekord létezésének ellenőrzéséhez score/application beszúrása előtt.
2. **Kötelező URL pozícióknál.** Nincs URL → nincs beszúrás (a szkript érvényesíti).
3. **Idempotens duplikátumoknál.** A beszúrás elutasítódik, ha `(user_id, legacy_id)` vagy egyedi-kulcs ütközés van — kezeld kegyesen és használj `db-update`-t helyette.
4. **`now` időbélyeg.** A wrapper a `now` literális stringet az aktuális időbélyeggé alakítja.

## Ne használd erre

- Frissítések: használd a **`db-update`**-t
- Olvasások: használd a **`db-query`**-t
- Séma változtatások: a `db_migrate.py` kezeli — Commander művelet, nem skill-ként elérhető
