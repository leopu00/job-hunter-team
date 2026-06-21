<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: db-insert
description: Neue Datensätze in die JHT-DB einfügen (positions / scores / applications / companies / position_highlights). Nur verwenden, wenn ein Agent einen Datensatz erstellen muss — Scout für Positions, Analyst für Companies und Highlights, Scorer für Scores, Writer für Applications. Niemals blind überschreiben — für Updates `db-update` verwenden.
allowed-tools: Bash(python3 *)
---

# db-insert — Datensatzerstellung in der JHT-DB

Wrapper unter `/app/shared/skills/db_insert.py`. Erstellt neue Datensätze in der JHT SQLite-DB. Erforderliche Felder unterscheiden sich je nach Tabelle.

## Muster

```bash
python3 /app/shared/skills/db_insert.py <table> --<field> <value> [--<field> <value>...]
```

Tabellen: `position`, `company`, `score`, `application`, `highlight`.

## Position (Scout)

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "Python Developer" --company "Acme Corp" \
  --location "Remote EU" --remote-type full_remote \
  --url "https://acme.com/jobs/42" --source linkedin --found-by scout-1 \
  --jd-text "<vollständiger JD-Text>" --requirements "Python, Flask, PostgreSQL"
```

`--url` ist **erforderlich** (das Skript schlägt ohne fehl). Der Scout muss immer Duplikate mit `db-query check-url` vorher prüfen.

## Company (Analyst)

```bash
python3 /app/shared/skills/db_insert.py company \
  --name "Acme Corp" --hq-country "Italy" --sector "fintech" \
  --verdict GO --analyzed-by analista-1
```

`--verdict` akzeptiert `GO`, `CAUTIOUS`, `NO_GO`.

## Score (Scorer)

```bash
python3 /app/shared/skills/db_insert.py score \
  --position-id 42 --total 85 \
  --stack-match 35 --remote-fit 18 --salary-fit 8 \
  --experience-fit 9 --strategic-fit 15 \
  --scored-by scorer-1
```

Die 5 Teilscores bilden DB-Spalten ab: `stack_match · remote_fit · salary_fit · experience_fit · strategic_fit`. `--total` ist der kanonische 0-100-Score, den der Captain liest.

**Ein Score pro Aufruf — sofort schreiben.** Der Scorer schreibt den Score direkt nach der Bewertung EINER Position und geht dann zur nächsten. **Niemals** mehrere Positionen bewerten und am Ende der Runde alle `score`-Inserts zusammen abfeuern: sie würden dieselbe `scored_at`-Sekunde teilen und hastig wirken. Eine Position → eine Bewertung → ein sofortiges Insert → die nächste (Scorer RULE-08).

## Application (Writer)

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id 42 \
  --cv-path "/jht_user/applications/42/cv.md" \
  --cv-pdf-path "/jht_user/applications/42/cv.pdf" \
  --written-by scrittore-1 --written-at now
```

Anschreiben (`--cl-path` / `--cl-pdf-path`) nur wenn die JD eines verlangt hat.

## Highlight (Analyst / Scorer)

```bash
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack matches candidate primary stack 1:1"
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type con --text "Salary range below candidate target"
```

`--type` ist `pro` oder `con`.

## Sicherheitsregeln

1. **Erst lesen.** `db-query check-url <url>` vor dem Einfügen einer Position verwenden. `db-query position <id>` verwenden, um zu verifizieren, dass der Elterndatensatz existiert, bevor Score/Application eingefügt wird.
2. **URL bei Positions erforderlich.** Keine URL → kein Insert (das Skript erzwingt es).
3. **Idempotent bei Duplikaten.** Insert wird abgelehnt bei `(user_id, legacy_id)` oder Unique-Key-Konflikt — elegant handhaben und stattdessen `db-update` verwenden.
4. **`now`-Zeitstempel.** Der Wrapper konvertiert den Literal-String `now` in den aktuellen Zeitstempel.

## Nicht verwenden für

- Updates: **`db-update`** verwenden
- Leseoperationen: **`db-query`** verwenden
- Schemaänderungen: werden von `db_migrate.py` behandelt — Commander-Operation, nicht als Skill exponiert
