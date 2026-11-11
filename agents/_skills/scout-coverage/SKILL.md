---
name: scout-coverage
description: "Search the core national portals of the profile's languages BEFORE any minor source, and know how much of the plan is done. `next` names the portal, the country to log and the kind of query to run; a portal is covered with 3 passes and 3 different queries, and «exhausted» needs the core portals covered. Run `next` at the start of every search."
allowed-tools: Bash(python3 /app/shared/skills/scout_coverage.py *) Bash(python3 /app/shared/skills/scout_pass_log.py *) Bash(python3 /app/shared/skills/profile_version.py *) Bash(python3 /app/shared/skills/linkedin_access.py *)
---

# scout-coverage — where to search first, and how much is done

Search where the profile's own markets are FIRST, and know how much of it is done. A real run asked 105 sources once each and never opened the biggest national portals of the user's language: «exhausted» was declared with the home market untouched. This skill gives the list (national portals of every language the profile speaks, core first, then the English-first and remote ones) and the counter over your own pass log.

## 1. Ask what comes next, every search

`next` prints one JSON line: the portal (`source`, `country`, `tier`), the KIND of query (`query_kind`: `broad` = a WIDE query, always the first: the role's family or an entry word on its own (listed in `broad_terms`), no full title and no place in the keywords; keep the profile geographic filter, `role_language` = the title in the portal's language, `role` = the title in English, `synonym` = an adjacent title, `level` = the title with a level word of the language, listed in `level_terms`, `city` = the title with a place, listed in `cities`), what you have (`have`) against what is needed (`need`) and the `log` line to use afterwards. Search exactly that, then log the pass with the same `--query-kind`. `plan_done: true` means the plan is done: go on to the other sources. `avoid`, when present, lists sources that fail with certainty (shut down, bot wall, a page only JavaScript fills, or found dead on this run by a colleague): do not open them and do not log them.

`next` also says, with your id, whether the profile changed since you built your circles: `"profile": {"changed": true, "groups": [...]}`. Read the profile again, redo the circles of the groups that changed, keep your positions and your passes, then run `profile_version.py ack`.

```bash
# the next thing to search: portal, country to log, kind of query, and the line to log it with
python3 /app/shared/skills/scout_coverage.py next

# with your id: also says if the profile changed since you built your circles (then read it again, redo the circles, and ack)
python3 /app/shared/skills/scout_coverage.py next --agent $MY_ID
python3 /app/shared/skills/profile_version.py ack --agent $MY_ID

# the whole plan for this profile (once), and how much of it is done (any time)
python3 /app/shared/skills/scout_coverage.py plan
python3 /app/shared/skills/scout_coverage.py status

# after the search: the same portal, country and kind that `next` named
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --query-kind role_language --query "<the query you ran>" --returned 12
# a portal that answers 403 / a login wall / a challenge (closed) or 410 (gone): ONE pass closes it
python3 /app/shared/skills/scout_pass_log.py pass --source platsbanken --country se --returned 0 --status closed
```

## Rules

- The FIRST question on a portal is always `broad`: a word of `broad_terms` or the role's family, ALONE. A portal that ANDs the words answers 0 to «junior project coordinator» + a city and hundreds to «praktik». Read ALL its results, every page, and filter them against the profile yourself. A portal is covered only with a `broad` pass, besides the 3 different queries and the one in its language.
- Platsbanken (Sweden) has a public API, no key: `python3 /app/shared/skills/platsbanken_search.py --q "praktik" --city stockholm --no-experience --query-kind broad --log`. The company boards of a country: `python3 /app/shared/skills/scout_coverage.py boards --country se`.
- For the other countries `next` (and `plan`) gives, when the table has them, `api` and `hint`: the public address that answers in JSON or open data with no key (Germany: Arbeitnow) and the search address of each portal. Ask THAT, not the home page, with a WIDE word, and read all the pages. The company boards of FR, DE, ES, PT, NL, BE, CH and AT: `python3 /app/shared/skills/scout_coverage.py boards --country <cc>`.
- A company board (Greenhouse, Lever, Teamtailor) is read WHOLE with `python3 /app/shared/skills/ats_board_search.py --provider greenhouse --board truecaller --country se --log --query-kind broad`: it recognises the country in every form of place, gives the seniority read from the title and says how many ads each reason removed (`counts`, `dropped`). Read `dropped` before you call a board empty; `--drop-seniority senior,lead` and `--title-any` are yours to choose, nothing is dropped unless you ask.
- Core before minor: no minor source while `next` names a core portal.
- A portal is COVERED with 3 passes and 3 DIFFERENT queries (one in the portal's language when that is not English). The same query three times counts once: change the kind, not the wording.
- A portal that answers 403, 410, a login wall or a challenge is CLOSED with ONE pass logged `--status closed` (or `gone` for 410): say so and move on, do not insist.
- `exhausted` (`scout_exhaustion.py check`) needs EVERY portal of the plan covered in the last 24 hours (core and minor, every country) as well as the sources, queries and minutes: `uncovered` says where you still have to go (`core_missing` is its core part). A source that is dry while others are not covered is not a dry market: go on with `next`. A portal that answered with an error is `blocked` (`--status blocked`): it rests about 3 hours and is asked again, and it is neither covered nor dry.
- Nothing of the profile is ever written: the log has slugs, country codes, kinds and counts.

## Geographic scope and explicit search outcomes

The profile's target places and preferences determine the search area. `broad` widens only the role keywords: keep the geographic filter, including on every page. A portal's country or suggested city does not authorize relocation. With LinkedIn use this command (QUERY is the role family; COUNTRY and KIND come from `next`):

```bash
python3 /app/shared/skills/linkedin_access.py search --profile "$JHT_HOME/profile/candidate_profile.yml" --keywords "$QUERY" --log --country "$COUNTRY" --query-kind "$KIND" --agent "$MY_ID" --posted-within-days 7
```

This command records the actual outcome: do not log it again manually. Exit 4 and the last JSON line `search_outcome` identify a source, profile or geographic mismatch error; follow its `status` (`blocked`, `closed`, `gone`) and move to another compatible source, keeping any candidates already returned. Exit 3 retains the rate-limit/cooldown rule. Only a successful empty list is `empty`. `scope_match` compares declared place names, not a geocoder: `unmatched` or `unknown` is NOT proof of exclusion. Verify the full location/JD against the profile, keeping every existing gate; do not insert a position proven outside the accepted area. `scout_search_geo_mismatch` means no returned name matched: diagnose the source's area or use another source; never call this a dry local market. No invented geographic IDs or country inferred from a spoken language. On a native harness without shell, keep the same profile area in the native search query and assess the source's evidence; do not execute container commands on the host.
