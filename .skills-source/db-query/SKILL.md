---
name: db-query
description: Query the JHT SQLite DB (positions, applications, stats). Use it whenever you need position status, per-agent queues, scores, match rate, or record counts. DB path from $JHT_DB, fallback /jht_home/jobs.db.
allowed-tools: Bash(python3 *)
---

# db-query — JHT DB lookups

The main database is `$JHT_DB` (default `/jht_home/jobs.db`). All query wrappers live in `/app/shared/skills/db_query.py`. This skill exposes the most common invocations.

## Stats and dashboard

```bash
# Aggregate counts by status + match rate (Commander overview)
python3 /app/shared/skills/db_query.py dashboard

# Numeric stats (per-table totals)
python3 /app/shared/skills/db_query.py stats
```

## Positions

```bash
# List by status
python3 /app/shared/skills/db_query.py positions --status new
python3 /app/shared/skills/db_query.py positions --status checked
python3 /app/shared/skills/db_query.py positions --status excluded

# Filter by minimum score
python3 /app/shared/skills/db_query.py positions --min-score 70

# Single position detail (all fields)
python3 /app/shared/skills/db_query.py position 42

# Duplicate URL/ID? (useful to SCOUT before INSERT)
python3 /app/shared/skills/db_query.py check-url 4361788825
```

## Per-agent queues (pipeline)

```bash
python3 /app/shared/skills/db_query.py next-for-analista
python3 /app/shared/skills/db_query.py next-for-scorer
python3 /app/shared/skills/db_query.py next-for-scrittore
python3 /app/shared/skills/db_query.py next-for-critico   # ⚠️ legacy — in V5 the Critic is spawned by the Writer per round, not pulled from a queue
```

Each returns the next batch ready for that role, following the V5 status flow: `new → checked → scored → writing → ready → applied → response` (with `excluded` as the off-ramp from any step).

## When to use it

- Before scaling decisions (Captain needs to know if there are ≥ 3 `checked` records before spawning a SCORER)
- Before INSERTs (Scout must check for URL duplicates)
- In response to Commander questions like "how many scouts active / how many pending applications / highest score"
- Before any update — see the `db-update` skill: always read the record first to avoid stomping on someone else's write

## Don't use it for

- Writes: use **`db-update`** / **`db-insert`** instead
- Schema changes: handled by `db_migrate.py` — not exposed as a skill (Commander operation)
