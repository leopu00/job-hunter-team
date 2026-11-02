---
name: scout-coverage
description: "Search the core national portals of the profile's languages BEFORE any minor source, and know how much of the plan is done. `next` names the portal, the country to log and the kind of query to run; a portal is covered with 3 passes and 3 different queries, and «exhausted» needs the core portals covered. Run `next` at the start of every search."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *)
---

# scout-coverage — where to search first, and how much is done

Search where the profile's own markets are FIRST, and know how much of it is done. A real run asked 105 sources once each and never opened the biggest national portals of the user's language: «exhausted» was declared with the home market untouched. This skill gives the list (national portals of every language the profile speaks, core first, then the English-first and remote ones) and the counter over your own pass log.

## 1. Ask what comes next, every search

`next` prints one JSON line: the portal (`source`, `country`, `tier`), the KIND of query (`query_kind`: `role_language` = the title in the portal's language, `role` = the title in English, `synonym` = an adjacent title, `level` = the title with a level word of the language, listed in `level_terms`, `city` = the title with a place, listed in `cities`), what you have (`have`) against what is needed (`need`) and the `log` line to use afterwards. Search exactly that, then log the pass with the same `--query-kind`. `plan_done: true` means the plan is done: go on to the other sources.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# the whole plan for this profile (once), and how much of it is done (any time)
python3 /app/shared/skills/scout_coverage.py plan
python3 /app/shared/skills/scout_coverage.py status

# after the search: the same portal, country and kind that `next` named
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --query-kind role_language --query "<the query you ran>" --returned 12
# a portal that answers 403 / a login wall / a challenge (closed) or 410 (gone): ONE pass closes it
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --returned 0 --status closed
```

## Rules

- Core before minor: no minor source while `next` names a core portal.
- A portal is COVERED with 3 passes and 3 DIFFERENT queries (one in the portal's language when that is not English). The same query three times counts once: change the kind, not the wording.
- A portal that answers 403, 410, a login wall or a challenge is CLOSED with ONE pass logged `--status closed` (or `gone` for 410): say so and move on, do not insist.
- `exhausted` (`scout_exhaustion.py check`) needs the core portals covered as well as the sources, queries and minutes: `core_missing` says where you still have to go.
- Nothing of the profile is ever written: the log has slugs, country codes, kinds and counts.
