---
name: db-insert
description: Insert NEW records into the JHT DB (positions / scores / applications / companies / position_highlights). Use it ONLY when an agent needs to create a record — Scout for positions, Analyst for companies and highlights, Scorer for scores, Writer for applications. Never blind-overwrite — for updates use `db-update`.
allowed-tools: Bash(python3 *)
---

# db-insert — record creation on the JHT DB

Wrapper at `/app/shared/skills/db_insert.py`. Creates new records in the JHT SQLite DB. Required fields differ per table.

## Pattern

```bash
python3 /app/shared/skills/db_insert.py <table> --<field> <value> [--<field> <value>...]
```

Tables: `position`, `company`, `score`, `application`, `highlight`.

## Position (Scout)

```bash
python3 /app/shared/skills/db_insert.py position \
  --title "Python Developer" --company "Acme Corp" \
  --location "Remote EU" --remote-type full_remote \
  --url "https://acme.com/jobs/42" --source linkedin --found-by scout-1 \
  --jd-text "<full JD text>" --requirements "Python, Flask, PostgreSQL"
```

`--url` is **required** (the script fails without it). The Scout must always pre-check duplicates with `db-query check-url` first.

## Company (Analyst)

```bash
python3 /app/shared/skills/db_insert.py company \
  --name "Acme Corp" --hq-country "Italy" --sector "fintech" \
  --verdict GO --analyzed-by analista-1
```

`--verdict` accepts `GO`, `CAUTIOUS`, `NO_GO`.

## Score (Scorer)

```bash
python3 /app/shared/skills/db_insert.py score \
  --position-id 42 --total 85 \
  --stack-match 35 --remote-fit 18 --salary-fit 8 \
  --experience-fit 9 --strategic-fit 15 \
  --scored-by scorer-1
```

The 5 sub-scores map to DB columns: `stack_match · remote_fit · salary_fit · experience_fit · strategic_fit`. `--total` is the canonical 0–100 score the Captain reads.

## Application (Writer)

```bash
python3 /app/shared/skills/db_insert.py application \
  --position-id 42 \
  --cv-path "/jht_user/applications/42/cv.md" \
  --cv-pdf-path "/jht_user/applications/42/cv.pdf" \
  --written-by scrittore-1 --written-at now
```

Cover letter (`--cl-path` / `--cl-pdf-path`) only if the JD requested one.

## Highlight (Analyst / Scorer)

```bash
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack matches candidate primary stack 1:1"
python3 /app/shared/skills/db_insert.py highlight \
  --position-id 42 --type con --text "Salary range below candidate target"
```

`--type` is `pro` or `con`.

## Safety rules

1. **Read first.** Use `db-query check-url <url>` before inserting a position. Use `db-query position <id>` to verify the parent record exists before inserting score/application.
2. **Required URL on positions.** No URL → no insert (the script enforces it).
3. **Idempotent on duplicates.** Insert is rejected if `(user_id, legacy_id)` or unique-key conflict — handle gracefully and `db-update` instead.
4. **`now` timestamp.** The wrapper converts the literal string `now` into the current timestamp.

## Don't use it for

- Updates: use **`db-update`**
- Reads: use **`db-query`**
- Schema changes: handled by `db_migrate.py` — Commander operation, not exposed as a skill
