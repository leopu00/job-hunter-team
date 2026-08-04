---
name: location-enrichment
description: Standardize positions.location free-text into structured loc_*/work_*/role_family columns BEFORE marking any position as `checked`. Covers 10 special cases (Europe Remote, Italy+remote, multi-location, US-entity-in-EU). Enforces one-position-at-a-time, peer-aligned vocabulary, never-NULL work_country. Use whenever the Analyst is about to set status=checked on a position.
allowed-tools: Bash(python3 *), Bash(curl *), Bash(jq *), WebSearch
---

# location-enrichment — location + role_family structuring playbook

The Analista fills **11 columns** of the `positions` table BEFORE
marking `status=checked`. Never leave a position `checked` without
location enrichment.

## The 11 columns to fill

```
role_family         text   semantic category of the role
loc_city            text   office city (NULL if country only)
loc_region          text   region/state (optional)
loc_country         text   physical office country (NULL if continent only)
loc_country_code    text   ISO-3166 alpha-2: IT, IE, HU, ...
loc_continent       text   Europe | Asia | Americas | Africa | Oceania
work_mode           text   onsite | hybrid | remote
work_country        text   contracting country (the signing entity) — NEVER NULL
work_country_code   text   ISO-2 of work_country
is_multi_location   bool   true if the JD lists several cities/countries
location_notes      text   analyst free-text notes
```

## Behavioural RULES (CRITICAL — sim 1-2 found problems here)

### R1 — One position at a time (NO BATCH)

Process your range one position per turn: read the JD → reason →
db-update → status=checked → next. Do NOT load 20+ JDs in a single
LLM turn. Exception: 3-5 trivial cases with no web search (e.g.
"Dublin, Ireland" + hybrid).

**Why**: a 17k+ token batch (sim 1) produces generic responses
("multi-location + remote + EU") instead of data specific to each
record. And the other analysts spin idle during your mega-turn.

### R2 — Peer DB taxonomy lookup (every 5-10 records)

BEFORE picking a `role_family` value, check what your colleagues
have used:

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n FROM positions
   WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

If you find a **semantically equivalent** family, ALIGN to their
name. Wrong examples seen in sim 1:

```
✗ "Translation / Localization" vs "Localization / Language Quality"
  vs "Language / Localization"           → only one
✗ "Customer Support" vs "Customer Success / Technical"
  vs "Technical Support"                 → only one
✗ "Technical Engineering" for a Technical Writer   → wrong
```

If the position really is a new category, note why in
`location_notes`.

### R3 — work_country fallback (NEVER NULL on checked)

If after 2 web search attempts you cannot establish `work_country`
with confidence, do NOT leave it NULL. Proceed:

1. Country of the **posting board** (e.g. linkedin.it → IT) + note
   `"work_country inferred from posting board (low confidence)"`
2. Country mentioned in the JD as "region" / "office" even if it is not the legal seat
3. Last resort: the `loc_continent` as a placeholder + note
   `"work_country=Europe placeholder, entity unverified"`

### R4 — Peer DB city lookup (BEFORE writing `loc_city`)

Exactly like R2 for `role_family`, but for **cities**. BEFORE
writing `loc_city`, check which form your colleagues have already
used for that country, so you don't create a duplicate in another
language (Rome vs Roma, Milan vs Milano):

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT loc_country, loc_city, COUNT(*) AS n FROM positions
   WHERE loc_city IS NOT NULL
   GROUP BY loc_country, loc_city ORDER BY loc_country, n DESC"
```

- If the city is **already present** in one form → ALIGN to it
  (as long as it respects the "English exonym" standard, see below).
- If you see a duplicate in a different language already in the DB
  (e.g. both `Roma` and `Rome` exist), use the **English** form and
  note in `location_notes` which form has to be consolidated.

## Writing standard

### Countries (`loc_country` / `work_country`)

| Yes ✓ | No ✗ |
|---|---|
| `Italy` | `Italia`, `IT`, `Italie` |
| `United Kingdom` | `UK`, `Great Britain`, `England` |
| `Czechia` | `Czech Republic` |
| `Netherlands` | `Holland`, `The Netherlands` |
| `Székesfehérvár` | `Szekesfehervar` (always preserve the diacritics) |
| ISO-2 `IT, IE, HU, NL, DE, GB, US, ES` | ISO-3, lowercase |

### Cities (`loc_city`) — ENGLISH exonym when one exists

**Single rule**: always write the **English** form of the city when a
settled exonym exists. If the city does NOT have an English exonym,
use the local name **preserving the diacritics**. This aligns the
Analista with the Scout's dedup map (`_CITY_SYNONYMS` in
`shared/skills/db_insert.py`) and eliminates the Rome/Roma,
Milan/Milano duplicates.

| Yes ✓ (EN exonym) | No ✗ (local form) |
|---|---|
| `Rome` | `Roma` |
| `Milan` | `Milano` |
| `Naples` | `Napoli` |
| `Turin` | `Torino` |
| `Florence` | `Firenze` |
| `Venice` | `Venezia` |
| `Genoa` | `Genova` |
| `Munich` | `München`, `Monaco di Baviera` |
| `Cologne` | `Köln` |
| `Vienna` | `Wien` |
| `Prague` | `Praha` |
| `Brussels` | `Bruxelles` |
| `Lisbon` | `Lisboa` |
| `Plzeň` (no exonym → local + diacritics) | `Plzen` |

If you are unsure whether a settled exonym exists, apply the peer DB
lookup (R4) and **align to the form already present** for that city.

## Special cases (standard decision)

### A — "Europe Remote" / "EMEA - Flexible" / "Remote"

```
loc_city          = NULL
loc_country       = NULL          # no physical country bound
loc_continent     = "Europe"      # only if the area is explicit
work_mode         = "remote"
work_country      = <web search company HQ → fallback R3>
is_multi_location = false
location_notes    = "Remote within EU"
```

### B — "Italy" / "Spain" + full_remote (country + remote)

```
loc_country       = "Italy"
loc_country_code  = "IT"
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Italy"       # same country, IT contract
work_country_code = "IT"
```

### C — "Dublin, Ireland" + hybrid (clean city+country)

```
loc_city          = "Dublin"
loc_region        = "Leinster"    # optional
loc_country       = "Ireland"
loc_country_code  = "IE"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Ireland"
work_country_code = "IE"
```

### D — Multi-location, same country ("Barcelona / Malaga")

```
loc_city          = NULL
loc_country       = "Spain"
loc_country_code  = "ES"
loc_continent     = "Europe"
work_mode         = "hybrid"
work_country      = "Spain"
is_multi_location = true
location_notes    = "Barcelona or Málaga (candidate chooses)"
```

### E — Multi-country ("Amsterdam, Berlin, London, Remote-Europe")

```
loc_city          = NULL
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "hybrid"      # or remote
work_country      = <company HQ via web>
is_multi_location = true
location_notes    = "EU multi-country: NL, DE, GB + remote option"
```

### F — Vague metropolitan area ("Greater Bologna Metropolitan Area")

```
loc_city          = "Bologna"     # promote to the main city
loc_country       = "Italy"
location_notes    = "Bologna metropolitan area (~30km radius)"
```

### G — US company with an EU entity hiring in Spain

```
loc_country       = NULL
loc_continent     = "Europe"
work_mode         = "remote"
work_country      = "Spain"       # local entity that signs
location_notes    = "US company (X Inc.), hires through ES entity"
```

### H — The JD pins down a city the scout had generalized

The Scout had written "Italy" → the JD text specifies "Milano HQ":
**promote to city**.

```
loc_city          = "Milan"
loc_country       = "Italy"
location_notes    = "JD specifies Milan HQ (scout had 'Italy')"
```

### I — Abbreviated city ("Dublin 2")

```
loc_city          = "Dublin"
loc_region        = "Dublin 2"    # district goes in region
```

### J — Job-board-only company (Railsware, Top Remote Talent, etc.)

When the company is a distributed outfit with no clear HQ:
apply the R3 fallback (posting board country) + note it.

## Absolute prohibitions

- ❌ `loc_country = "Europe"` or `"EMEA"` — that is a continent, not a country
- ❌ Mapping "EMEA" to "Europe" without checking (it includes Middle East + Africa)
- ❌ `work_country = NULL` on a `checked` position (breaks the salary UI)
- ❌ Inventing a role_family when colleagues have already used similar ones → see R2
- ❌ Writing `loc_city` in the local language when the English exonym
  exists (`Roma`, `Milano`, `Napoli` → use `Rome`, `Milan`, `Naples`)
  or without the peer DB lookup → see R4 + city table
- ❌ Loading your whole range as one batch → see R1
- ❌ **`loc_city = "Remote" / "Anywhere" / "Distributed"`** — those are NOT cities.
  If the position is full-remote with no specific city, `loc_city = NULL`.
  Bug observed in sim 4: A2 wrote `loc_city='Remote'` on 8 records
  (Canonical, Miratech, Link Group, etc.). Always fix it with
  `db_update --loc-city ""` (empty string = NULL).

## Typical commands

### Saving the complete location structure

```bash
python3 /app/shared/skills/db_update.py position <ID> \
  --loc-city "Dublin" \
  --loc-region "Leinster" \
  --loc-country "Ireland" --loc-country-code "IE" \
  --loc-continent "Europe" \
  --work-mode "hybrid" \
  --work-country "Ireland" --work-country-code "IE" \
  --is-multi-location false \
  --role-family "Technical Writing" \
  --location-notes ""
```

### Peer taxonomy lookup (run it every 5-10 records)

```bash
python3 /app/shared/skills/db_query.py raw \
  "SELECT role_family, COUNT(*) AS n
   FROM positions WHERE role_family IS NOT NULL
   GROUP BY role_family ORDER BY n DESC"
```

### Promotion to checked (ONLY after complete enrichment)

```bash
python3 /app/shared/skills/db_update.py position <ID> --status checked \
  --notes "ESPERIENZA: ... \\n LINGUA: ... \\n SENIORITY: ..."
```
