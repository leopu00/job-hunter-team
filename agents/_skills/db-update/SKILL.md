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

# Liveness: --is-open / --last-open-check also advance last_checked on
# their own, so a rechecked position leaves the care queue (which gates on
# the most recent of the two dates). Pass --last-checked only to override it.
python3 /app/shared/skills/db_update.py position 42 --is-open false --last-open-check now

# Salary as declared in the JD
python3 /app/shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Estimated salary (glassdoor / levels.fyi / analyst's estimate)
python3 /app/shared/skills/db_update.py position 42 --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Role family (categoria semantica).
python3 /app/shared/skills/db_update.py position 42 --role-family "Technical Writing"

# Location strutturata (Analyst). Pieno esempio per "Dublin, Ireland" hybrid:
python3 /app/shared/skills/db_update.py position 42 \
  --loc-city "Dublin" --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false

# Esempi casi speciali:
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

# Response received (`interview` / `rejected` / `ghosted`)
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

### Maintenance checks leave a history (`--action` / `--outcome`)

`last_checked` and `last_open_check` hold only the **latest** date: every pass
overwrites the previous one, so nothing records how many times a position was
looked at, or how often a check failed to conclude anything.

Pass `--action` on maintenance work and the check is kept in
`maintenance_events`, one row per changed field — or one row anyway when
nothing changed, because knowing a position was looked at is half the point.

```sh
db_update.py position 412 --last-checked now \
  --action liveness_check --outcome confirmed_open --is-open true \
  --evidence-url "<url>" --evidence-code 200
```

`--action`: `liveness_check` · `geocode` · `logo_fetch` · `website_fetch` ·
`jd_refresh` · `exclude` · `rescore`

`--outcome`: `confirmed_open` · `confirmed_closed` · **`inconclusive`** ·
`updated` · `unchanged` · `unreachable` · `skipped` · `failed`. Omit it and it
is derived from whether anything changed.

`--evidence-url` / `--evidence-code` / `--evidence-hash` are optional context:
a 403 that keeps recurring tells you about an authwall, not about a dead
posting.

> ⛔ **An unresolved check may not close a position.** With `--outcome`
> `inconclusive`, `unreachable`, `skipped` or `failed`, writing
> `--is-open false` or `--status excluded|expired` is refused with exit 1.
> Not knowing is not the same as knowing it expired, and a position binned on
> a doubt is an opportunity lost in silence — leave it alive, the check stays
> in the history and it will be retried. Everything else still goes through:
> notes, coordinates, summaries. Reopening is never blocked.

Read it back with `db_query.py check-history <id>`, which also reports the
streak of consecutive unresolved checks — that is a **source** problem to
report, not a position to discard.

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
