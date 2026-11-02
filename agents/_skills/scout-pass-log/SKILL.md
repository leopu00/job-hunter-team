---
name: scout-pass-log
description: "Measure your searches so the team can tell whether a source is exhausted or the search is bad. After each search of a source log how many candidates came back, and after each candidate leaves the gates log where it ended. Two short commands, a closed vocabulary, never free text."
allowed-tools: Bash(python3 /app/shared/skills/scout_pass_log.py *)
---

# scout-pass-log — measure what your searches return

Nobody can tell from outside whether a profile's sources are exhausted or the Scout searches badly: a candidate dropped before the INSERT (dead link, a filter, a language seen in the ad) used to leave no trace. These two commands leave one short line each. They cost nothing and never stop your work.

## When

- **After each search of a source** (a list of candidates came back): the `pass` command.
- **When each candidate leaves the gates** (inserted, or dropped and why): the `candidate` command. Add `--opened` if you fetched the full JD for it (the expensive step).

## Commands

```bash
python3 /app/shared/skills/scout_pass_log.py pass --source greenhouse --country nl --returned 25 \
    --query-kind role --query "<the query you searched>"
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome language --opened
python3 /app/shared/skills/scout_pass_log.py candidate --source greenhouse --country nl --outcome inserted --opened
```

## Closed vocabulary

`--source`: the slug you also give to `--source` of the INSERT (`linkedin`, `greenhouse`, ...). `--country`: two letters (`nl`), or `multi` / `remote`. `--query-kind`: `role` · `role_language` · `company` · `generic` · `other`. `--outcome`: `inserted` · `duplicate` · `dead_link` · `closed_ad` · `seniority` · `work_auth` · `domain` · `experience` · `language` · `other`.

## Rules

- Free text is refused (exit 2, nothing written): never put a title, a company, a name or anything of the profile in a field. The query you searched goes in `--query` only so it is hashed; its text is never stored.
- If it is refused, fix the value and call again. Never skip the search or the candidate because of it.
- `language` is the outcome for a candidate you drop because the ad needs a language the user does not speak, whether you saw it in the list or in the JD.
- One call per search and one per candidate, in the same shell call as the gate that decided it when you can.
