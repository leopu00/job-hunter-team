---
name: circles-and-sources
description: Strategy map for what to search WHERE, derived entirely from the candidate profile. The 5 concentric circles (work_mode + relocation) tell you the geographic scope; the 4 source tiers (LinkedIn → ATS aggregators → niche → web) tell you which platforms to drain in order. A scout that searches the wrong tier in the wrong circle wastes its quota and its `scout-coord` partition. Open this skill at boot (after `scout-coord`) and again whenever a circle is exhausted or a `[FEEDBACK]` from the Analyst suggests changing source.
allowed-tools: Bash(curl *), Bash(python3 /app/shared/skills/linkedin_check.py *)
---

# circles-and-sources — read the profile, build the map

Two orthogonal axes:
- **Circles** = WHERE (geographic / work-mode scope)
- **Tiers** = WHICH platforms (in priority order)

Both come from `$JHT_HOME/profile/candidate_profile.yml`. **Don't assume**: read `preferences.work_mode`, `location`, `preferences.relocation`, then build the circles on top of what the candidate actually wants.

## The 5 concentric circles

Exhaust each circle inside-out before moving outward.

| # | Circle                       | What it is                                                                                                  | When to enter                                                            |
|---|------------------------------|-------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------|
| 1 | 🎯 **Primary preference**    | The mode + geography the candidate declared as priority.                                                    | Always start here. Drain it first.                                       |
| 2 | 🗺️ **Geo neighbours**        | Areas immediately extensible from circle 1.                                                                 | Only if `relocation` allows OR circle 1 is exhausted.                    |
| 3 | ✈️ **Targeted relocation**    | Cities / countries listed in `preferences.relocation` (or inferred from `"ovunque"` / `"Europa"`).          | Only if `relocation` is non-empty (true / list / `"ovunque"`).           |
| 4 | 🛰️ **Satellite**             | Geography outside the core target, lower probability.                                                       | Only if circles 1-3 are exhausted.                                       |
| 5 | 🌗 **Frontier**              | Roles **adjacent** to the candidate's primary stack (sub-domains of same language, cross-functional, automation, ML adjacent, etc.). The candidate is treated as adaptable; the Scorer applies the gap penalty downstream. | Only after circles 1-4 are drained for the day. |

### How to materialise circle 1 from the profile

```yaml
preferences:
  work_mode: <remoto|ibrido|in sede|flessibile>
  ...
location: <city/area>
preferences:
  relocation: <true|false|"per la giusta posizione"|list>
```

| `work_mode`   | Circle 1 = WHAT to search                                                                                |
|---------------|---------------------------------------------------------------------------------------------------------|
| `remote`      | Remote roles compatible with the candidate's timezone / country (e.g. `Remote (EU only)` for EU-based)   |
| `on-site`     | Roles in `location` (city base) only                                                                     |
| `hybrid`      | Roles in `location` city, hybrid-tagged or commute radius                                                |
| `flessibile`  | Union of the three above — exhaust in order remote → city → hybrid                                       |

### Circle 2 — geo neighbours

| Circle 1 type    | Circle 2 expansion                                                                            |
|------------------|------------------------------------------------------------------------------------------------|
| Remote (national)| Remote regional / continental compatible with candidate's timezone + work-auth                 |
| On-site          | Region / metropolitan area of the base country                                                |
| Hybrid           | Same as on-site (commute radius widening)                                                     |

### Circle 3 — targeted relocation

Only if `preferences.relocation` is non-empty:

| `relocation` value     | Circle 3 expansion                                                                          |
|------------------------|---------------------------------------------------------------------------------------------|
| List (`["Berlin", "Lisbon"]`) | Just those cities                                                                    |
| `"ovunque"`            | Global tech hubs (NYC, London, Berlin, Singapore, Lisbon, Amsterdam, Dublin, Tel Aviv)      |
| `"Europa"`             | EU tech hubs (Berlin, London, Amsterdam, Lisbon, Dublin, Madrid, Paris, Stockholm, ...)     |
| `"per la giusta posizione"` | Skip circle 3, mark borderline candidates from circle 4 with relocation flag in notes |

## The 4 source tiers

Drain a tier completely before moving to the next.

| Tier | Type                                | Sources                                                                                                       | Notes                                                                                          |
|------|-------------------------------------|--------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| 1    | **LinkedIn**                        | `linkedin_check.py` (authenticated profile), `curl` with browser UA                                          | Universal: covers remote, on-site, hybrid. Mandatory first step for every circle. **NEVER `fetch` MCP** — blocked by robots.txt. |
| 2    | **ATS aggregators**                 | Greenhouse boards, Lever boards, Indeed, Wellfound (ex AngelList)                                            | Work for any work_mode. Cover many companies in one scrape.                                    |
| 3    | **Niche boards (profile-specific)** | Pick by `work_mode` AND domain                                                                              | (see table below)                                                                              |
| 4    | **WebSearch + career pages**        | `WebSearch` queries + scrape of company career pages                                                        | Last resort only after tier 1-3 are drained.                                                   |

### Tier 3 — choose by work_mode + domain

| Candidate's `work_mode` | Niche boards to consider                                                                                          |
|-------------------------|--------------------------------------------------------------------------------------------------------------------|
| `remote`                | Remote.co, WeWorkRemotely, RemoteOK, EURemoteJobs (or regional equivalents)                                       |
| `on-site` / `hybrid`    | Local / national boards (InfoJobs, Glassdoor regional, Stepstone, Welcome to the Jungle FR, ...)                  |
| `flessibile`            | Combine remote + local                                                                                            |
| Domain-specific (any)   | Stack-specific niche: PyJobs (Python), GoJobs (Go), Djinni (Eastern Europe / dev), 4dayweek.io (4-day-week), ...   |

> ⚠️ **Don't bring remote-specific boards into a non-remote search**, and vice versa. WeWorkRemotely on a candidate who wants on-site Milan is wasted scraping.

## Anti-bias rule (mandatory)

If **> 30% of a single batch's positions come from one company**, switch source or query for the next batch. Without this, one scaleup that dumps 12 roles on a single board will flood the pool — diversity matters more than volume.

```python
# pseudocode for the check at end of batch
batch = [...]
from collections import Counter
counts = Counter(p.company for p in batch)
top_company, top_count = counts.most_common(1)[0]
if top_count / len(batch) > 0.30:
    log(f"anti-bias triggered: {top_company} = {top_count}/{len(batch)} = >30%")
    # next batch: change source or query
```

## Permissive filters at SCOUT level

The Scout pre-filters only the **totally out-of-scope** cases. **Do not do the Analyst's job** — the candidate is treated as adaptable to adjacent roles. Skip a posting only if:

- 🚫 Title contains explicitly: `senior`, `lead`, `staff`, `principal`, `head of`, `director` → SKIP (seniority gap too wide)
- 🚫 Geographic work-auth incompatible with the profile (e.g. `US-only` / `Canada-only` and the candidate doesn't have visa) → SKIP
- 🚫 Domain completely outside IT/coding (e.g. pastry chef, accountant, sales) when the candidate is in IT → SKIP
- 🚫 Hard requirement of `> real_years + 3` years of experience → SKIP (moderate gap is fine, the Scorer decides)

Everything else: **insert it**. Adjacent stacks (data, devops, platform, frontend, automation, ML adjacent, etc.) all go through; the Scorer assigns a fit-proportional score and the user sees them.

## Listening to Analyst feedback

When the Analyst sends `[FEEDBACK]` with a recurring tag (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`):

1. ACK the message
2. Adjust the next batch's queries / sources per the suggestion
3. Prioritise the suggested alternative source/filter for the next rotation
4. Notify the Capitano only if a systemic bias emerges (not solvable by source change)

Example: Analyst says "4 of last 5 from greenhouse.io require senior+, switch source". Next batch you skip greenhouse.io, try a Lever board or a niche junior-friendly source.

## Anti-patterns

- ❌ Searching circle 2 before exhausting circle 1 — wastes scope, dilutes results.
- ❌ Going to tier 4 (WebSearch) before tier 1-3 are drained — `WebSearch` is the noisiest source, save it for last.
- ❌ Inferring `relocation = "ovunque"` for a candidate whose profile says `false` — read the profile, don't project.
- ❌ Using LinkedIn via `fetch` MCP — blocked by robots.txt; always `linkedin_check.py` (authenticated) or `curl` with browser UA.
- ❌ Including senior-titled JDs hoping the Scorer will filter them — wastes Scorer budget, adds noise. The 4 SCOUT-level filters above are the right place.
- ❌ Anti-bias check forgotten — one greedy company swamps your batch.

## See also

- `scout-coord` — boot-time partition between scouts (HOW to split this map across instances).
- `position-insert` — what to do for each candidate position once you've decided WHERE to look.
- `agents/scout/scout.md` — the Scout's orchestrator prompt that calls this skill.
- `agents/_team/architettura.md` Phase 1 — bigger picture of Discovery within the pipeline.
