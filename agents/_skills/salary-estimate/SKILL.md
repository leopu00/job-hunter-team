---
name: salary-estimate
description: Hierarchical salary estimate for the Scorer (bug #27). 4 levels — declared range (L1), local cache (L2), web search (L3), neutral default (L4). The cache is local to the Scorers only, no remote sync. TTL 30 days because salaries change year over year, not week over week. Use this skill every time you are about to write `salary_fit`: without it, 95% of positions end up with a neutral `salary_fit=5/10` (de facto inert).
allowed-tools: Bash(python3 /app/shared/skills/salary_estimate.py *), Bash(python3 /app/shared/skills/db_update.py *)
---

# salary-estimate — hierarchical estimate with a local cache

## Why it exists

Snapshot 2026-05-17 (43 Kimi scores): 41 scores out of 43 with
`salary_fit=5/10` (the "no data no bias" default), 2 with real values from
an explicit JD. Result: salary_fit (weight 10/100) was *de facto*
inert — the Scorer's decision space shrunk from 100 to 95.

Cause: nobody was populating `salary_estimated_*`. The Scorer is honest,
it does not make things up, and with no data it falls back to the default.
User decision: build a local cache of the estimates, so the first fetch
costs and the following ones are free. *"Salaries do not change from week
to week, they change from year to year"*.

## 4 levels (in order, stop at the first one that produces a range)

### LEVEL 1 — Declared range (position)
If `positions.salary_declared_min` and `salary_declared_max` are not NULL →
use those, no estimate. The Scrittore can call:

```bash
python3 /app/shared/skills/salary_estimate.py --position-id 42
```

The script reads the declared values from the DB and returns `level=1` with
the numbers.

### LEVEL 2 — Local cache
Path: `/jht_home/.cache/salary_estimates.json`. Key:
`(stack, seniority, country, mode)`. TTL 30 days.

```bash
python3 /app/shared/skills/salary_estimate.py \
    --stack python --seniority junior --country IT --mode remote
```

Hit → JSON with `level=2, source=cache, min, max`. Miss → falls through to
L3 or L4.

### LEVEL 3 — Web search (stub, depends on F-2)
For now it returns None: the skill falls straight through to L4. Once
F-2 (Scout web access) is available, the Scout/Analista will populate the
cache via web search on Glassdoor/Levels/Indeed. From then on the first
lookup of a new combination does a single fetch, then 29 days of free hits.

### LEVEL 4 — Neutral default + flag
If every level above fails → it returns `level=4, min=null,
max=null, estimation_failed=true, reason="no_data_default"`. The Scorer
sets `salary_fit=5` AND adds `no_data_default` to `score.notes` — so that
the Mentor (downstream) does not propagate the 5 as a real datum but as
"N/A" (see bug #27, Mentor fix).

## Output schema

```json
{
  "level": 1 | 2 | 3 | 4,
  "min": int | null,
  "max": int | null,
  "currency": "EUR",
  "source": "declared" | "cache" | "web" | "default",
  "fetched_at": "YYYY-MM-DD",
  "estimation_failed": false | true,
  "reason": "<optional>"
}
```

## What the Scorer does with the result

```bash
result=$(python3 /app/shared/skills/salary_estimate.py \
    --stack "$STACK" --seniority "$SENIORITY" \
    --country "$COUNTRY" --mode "$MODE" \
    --declared-min "$DECL_MIN" --declared-max "$DECL_MAX")

# 1. Extract the fields
min=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['min'] or '')")
max=$(echo "$result" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['max'] or '')")
failed=$(echo "$result" | python3 -c "import sys,json; print(json.load(sys.stdin).get('estimation_failed', False))")

# 2. If there are real numbers, populate positions.salary_estimated_*
if [ -n "$min" ] && [ -n "$max" ]; then
  python3 /app/shared/skills/db_update.py position "$POS_ID" \
    --salary-estimated-min "$min" --salary-estimated-max "$max" \
    --salary-estimated-source "salary-estimate"
fi

# 3. Compute salary_fit (0-10) with your existing logic
#    (comparison with the candidate target from candidate_profile.salary_annual_eur)
#    and include the "no_data_default" note if failed=True.
```

## Dev-only seed-cache

To warm the cache on a new container (e.g. for tests):

```bash
python3 /app/shared/skills/salary_estimate.py --seed-cache \
    --stack python --seniority junior --country IT --mode remote \
    --declared-min 28000 --declared-max 38000
```

In production the cache warms up by itself: L1 (declared from the JD) plus
the future L3 (web search) populate it organically over a week of
operation.

## Anti-patterns

- ❌ A web fetch for every position — the cache exists exactly to avoid
  it. The same `python junior IT remote` re-run 10 times = 9 wasted
  fetches.
- ❌ An aggressive TTL (1 day) — salaries have a yearly granularity,
  refreshing daily is zero info gain + waste.
- ❌ Caching the declared values — the declared range is already in the
  position's DB row, no need to duplicate it in the estimate cache.
- ❌ Syncing the cache to Supabase — it is a cache **local to the
  Scorers**, it must be neither backed up nor shared. It rebuilds itself
  from scratch in a few days.

## See also

- `agents/_skills/db-update/SKILL.md` § Positions — `salary-estimated-*`
- `docs/examples/candidate_profile.yml.example` — `salary_annual_eur` (candidate
  target, side-fix for bug #27)
- `agents/_skills/mentor-output/SKILL.md` — hide the "passive 5" when
  `notes` contains `no_data_default`
