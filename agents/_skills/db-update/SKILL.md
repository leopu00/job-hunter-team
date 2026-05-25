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

# Role family (categoria semantica). Vedi docs/internal/2026-05-23-position-classifier-llm-roadmap.md
python3 /app/shared/skills/db_update.py position 42 --role-family "Technical Writing"

# Location strutturata (Analyst). Pieno esempio per "Dublin, Ireland" hybrid:
python3 /app/shared/skills/db_update.py position 42 \
  --loc-city "Dublin" --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false

# Esempi casi speciali (vedi docs/internal/2026-05-23-location-playbook.md):
# A) "Europe Remote" → country=NULL, continent=EU, work_country dall'HQ azienda
python3 /app/shared/skills/db_update.py position 42 \
  --loc-continent "Europe" --work-mode "remote" \
  --work-country "United States" --work-country-code "US" \
  --location-notes "Remote within EU, US-based company"

# B) "Italy" + full_remote
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Italy" --loc-country-code "IT" --loc-continent "Europe" \
  --work-mode "remote" --work-country "Italy" --work-country-code "IT"

# E) Multi-location stesso paese ("Barcelona / Malaga")
python3 /app/shared/skills/db_update.py position 42 \
  --loc-country "Spain" --loc-country-code "ES" --loc-continent "Europe" \
  --work-mode "hybrid" --work-country "Spain" --work-country-code "ES" \
  --is-multi-location true --location-notes "Barcelona or Málaga (candidato sceglie)"

# Per "ripulire" un campo (set NULL) passa stringa vuota:
python3 /app/shared/skills/db_update.py position 42 --loc-city ""
```

## Applications

```bash
# Critic verdict (per-round: NEEDS_WORK / PASS / REJECT) + score 0-10 + notes
python3 /app/shared/skills/db_update.py application 42 --critic-verdict NEEDS_WORK --critic-score 5.0 --critic-notes "needs more detail on project X"

# CV/cover letter committed (Writer marks as written)
python3 /app/shared/skills/db_update.py application 42 --written-at now

# Promote to ready after Critic PASS — Writer only, in application-flow Step 7
python3 /app/shared/skills/db_update.py application 42 --status ready

# User confirmed the application was sent
python3 /app/shared/skills/db_update.py application 42 --applied-at "2026-02-28" --applied-via linkedin
python3 /app/shared/skills/db_update.py application 42 --applied true

# Response received (interview / rejection / ghosted)
python3 /app/shared/skills/db_update.py application 42 --response "rejected" --response-at now
```

### Position state transitions are auto-logged (bug #14)

Every call to `db_update.py position <id> --status <s>` that actually
changes `positions.status` inserts a row in `position_state_transitions`
with `from_state`, `to_state`, `ts`, `by_agent` (from `JHT_AGENT_NAME`),
and the `--notes` you passed (if any). Same goes for the initial
`db_insert.py position` (logged as `NULL → 'new'`).

You don't have to do anything — the wrapper handles it. Don't bypass it
with raw SQL: a `python3 -c "import sqlite3; UPDATE positions SET
status=..."` workaround skips the transition log and makes throughput /
funnel charts undercount.

### Single-writer gate on `applications.status='ready'` (bug #21)

`applications.status='ready'` is **set exclusively by the Scrittore** in
`application-flow` Step 7, **only after** Critic PASS on the 3rd round.
This is the gate that makes the CV visible on the user's `/ready`
dashboard. Other agents:

- **Critic**: writes `critic_verdict` + `critic_score` only. Never `status`.
- **Capitano**: never writes `applications.status`. May read it.
- **Mentor / Assistente**: read-only on `applications`.

Without this gate, the Capitano can report "12 ready" verbally while the
DB still shows 0 — exactly the divergence that bug #21 fixed.

## Safety rules

1. **Read first.** Run `db-query position <id>` (or `application`) to see the current state before writing. Blind overwrites produce inconsistent records.
2. **Status flow is forward-only.** Legitimate transitions: `new → checked → scored → writing → ready → applied → response`. `excluded` is reachable from any step but no step ever moves backward. Don't reverse.
3. **`now` timestamp.** The wrapper converts the literal string `now` into the current timestamp. Don't pass `$(date)` — parsing is handled Python-side.
4. **Exclusion tags in `--notes`.** When marking a position `excluded`, prefix the notes with one of the canonical tags: `[LINK_MORTO]` · `[SCAM]` · `[GEO]` · `[LINGUA]` · `[SENIORITY]` · `[STACK]`. Same taxonomy used by the Analyst (see `agents/analista/analista.md` REGOLA-06).

## Don't use it for

- Reads: use **`db-query`**
- Creating records: use **`db-insert`** (only the Scout INSERTs positions)
- Schema changes: never run raw `sqlite3` against the tables — it bypasses foreign keys and Next.js's WAL journaling
