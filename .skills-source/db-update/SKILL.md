---
name: db-update
description: Update existing records in the JHT DB (positions / applications). Use it to promote positions to checked/excluded, write Critic score/verdict, mark applications as sent, update salary, last-checked, etc. Always after a `db-query` that confirms the current record state.
allowed-tools: Bash(python3 *)
---

# db-update — record updates on the JHT DB

Wrapper at `/app/shared/skills/db_update.py`. Updates specific fields on existing records. **Does not create** records — for that, see `db-insert`.

## General pattern

```bash
python3 /app/shared/skills/db_update.py <table> <id> --<field> <value> [--<field> <value>...]
```

Tables: `position`, `application`.

## Positions

```bash
# Promote to checked / excluded (Analyst's job)
python3 /app/shared/skills/db_update.py position 42 --status checked
python3 /app/shared/skills/db_update.py position 42 --status excluded

# last-checked marker (link confirmed alive — also used as anti-collision claim)
python3 /app/shared/skills/db_update.py position 42 --last-checked now

# Salary as declared in the JD
python3 /app/shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Estimated salary (glassdoor / levels.fyi / analyst's estimate)
python3 /app/shared/skills/db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor
```

## Applications

```bash
# Critic verdict (per-round: NEEDS_WORK / PASS / REJECT) + score 0-10 + notes
python3 /app/shared/skills/db_update.py application 42 --critic-verdict NEEDS_WORK --critic-score 5.0 --critic-notes "needs more detail on project X"

# CV/cover letter committed (Writer marks as written)
python3 /app/shared/skills/db_update.py application 42 --written-at now

# User confirmed the application was sent
python3 /app/shared/skills/db_update.py application 42 --applied-at "2026-02-28" --applied-via linkedin
python3 /app/shared/skills/db_update.py application 42 --applied true

# Response received (interview / rejection / ghosted)
python3 /app/shared/skills/db_update.py application 42 --response "rejected" --response-at now
```

## Safety rules

1. **Read first.** Run `db-query position <id>` (or `application`) to see the current state before writing. Blind overwrites produce inconsistent records.
2. **Status flow is forward-only.** Legitimate transitions: `new → checked → scored → writing → ready → applied → response`. `excluded` is reachable from any step but no step ever moves backward. Don't reverse.
3. **`now` timestamp.** The wrapper converts the literal string `now` into the current timestamp. Don't pass `$(date)` — parsing is handled Python-side.
4. **Exclusion tags in `--notes`.** When marking a position `excluded`, prefix the notes with one of the canonical tags: `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` · `[STACK]`. Same taxonomy used by the Analyst (see `agents/analista/analista.md` REGOLA-06).

## Don't use it for

- Reads: use **`db-query`**
- Creating records: use **`db-insert`** (only the Scout INSERTs positions)
- Schema changes: never run raw `sqlite3` against the tables — it bypasses foreign keys and Next.js's WAL journaling
