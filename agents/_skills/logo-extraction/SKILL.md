---
name: logo-extraction
description: Extract the company logo for a company in the companies table and store it as a small base64 data-URI (max ~35KB, min 32px). Primary path is fully automated via logo_fetch.py against the official website (apple-touch-icon → icon → og:image → favicon); when the site blocks bots or has no usable icon, find a direct logo image URL via web search and pass it with --from-url. Verify the website really belongs to the company BEFORE fetching. Sets companies.logo, logo_source, logo_fetched.
allowed-tools: Bash(python3 *), Bash(curl *), Bash(jq *), WebSearch, WebFetch
---

# logo-extraction — the company logo for the position page

The web shows the company logo on the position detail page. The logo
lives on the `companies` row (ONE per company: 1000 Wizz Air positions
= 1 logo) as a small base64 data-URI, and travels with the existing
companies sync. No upload, no external storage.

## 3 columns to fill in (`logo_fetch.py` writes them, NEVER by hand)

```
logo          text  base64 data-URI (png/jpeg/webp/ico), <= ~35KB raw
logo_source   text  URL the logo was extracted from (audit/refresh)
logo_fetched  bool  true = extraction ATTEMPTED (even if it failed) —
                    office_geocoded pattern: the company leaves the
                    next-for-logo-missing queue, no retry every round
```

## GOLDEN RULE: right company, right site

**The wrong logo is worse than no logo.** Before launching the fetch,
verify that `companies.website` REALLY belongs to the company of the
position (not a namesake, not the aggregator that published the ad, not
the wrong parent group). When in doubt: web search
`"<Company> official site"` and compare with the sector/country on the row.

- Ad published by an agency/recruiter (Manpower, Randstad, ...) BUT on
  behalf of a named hotel/company → the logo is that of the company on the
  `companies` row linked to the position, whichever it is.
- Chain vs property (e.g. "CARDO ROMA, Autograph Collection"): use the
  logo of the brand that appears as `companies.name`.

## Workflow

### Step 0 — The queue

```bash
python3 /app/shared/skills/db_query.py next-for-logo-missing
```

Lists companies with live positions and a logo never attempted, ordered by
number of positions (most visible first). `NO WEBSITE (cercalo
prima)` = do Step 1 first.

### Step 1 — Website missing? Find it and save it

```bash
# after a web search "<Company> official website":
python3 /app/shared/skills/db_update.py company "<Company>" \
  --website https://www.wizzair.com
```

### Step 2 — Automatic fetch (the normal path)

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>"
```

The script: downloads the homepage, tries `apple-touch-icon` → large
`icon` → `og:image` → `/favicon.*`, validates format (png/jpeg/webp/ico,
NEVER svg), weight (200B–35KB) and minimum side (>=32px), saves the
data-URI and marks `logo_fetched=1`. JSON output on stdout. `--dry-run` to
try without writing, `--force` to replace an existing logo.

### Step 3 — Anti-bot site or no usable icon → `--from-url`

If Step 2 returns `NO_CANDIDATE` (sites like marriott.com block bots):

1. Web search `"<Company> logo png"` / `"<Company> press kit logo"` /
   the company's Wikipedia page (Wikimedia files have direct URLs).
2. Find the **direct image URL** (it must end in .png/.jpg/.webp/.ico, or
   at least serve the raw image, not an HTML page).
3. ```bash
   python3 /app/shared/skills/logo_fetch.py "<Company>" \
     --from-url "https://upload.wikimedia.org/.../Wizz_Air_logo.png"
   ```
   The same validation (weight/format/size) applies: if the image is too
   heavy, look for a smaller variant (Wikimedia thumbnail: replace
   `/1200px-` with `/240px-` in the path).

### Step 4 — Nothing usable after 3 attempts → mark it and move on

```bash
python3 /app/shared/skills/logo_fetch.py "<Company>" --mark-attempted
```

`logo_fetched=1` with a NULL logo: the web page shows the initials
fallback, the company leaves the queue. Do NOT insist beyond 3 attempts.

## Saving policy (enrichment-policy)

The autonomous fetch respects `$JHT_HOME/profile/enrichment-policy.json`
(check it with `python3 /app/shared/skills/enrichment_policy.py show`).
Possible answers from `logo_fetch.py`:

- `POLICY_DISABLED` — saving mode is on (`economy=true`) or
  `logo.enabled=false`: do NOT extract, it is not an error. Move on.
- `POLICY_SCORE_GATE` — the company has no live positions yet with a
  score ≥ `logo.min_score`: do NOT insist. It does not mark
  `logo_fetched`: when the Scorer crosses the threshold, the company
  re-enters the queue on its own.

`--force` overrides the policy: use it ONLY on an explicit request from
the user, never on your own initiative.

## Expected quality

- **Prefer** square icons 96–256px (apple-touch-icon is ideal).
- 32–48px (favicon) is acceptable as a fallback: the web box is small.
  Below 32px the script rejects it by itself.
- The 35KB cap is **hard** (it protects DB and sync): do not work around
  it, look for a lighter variant.

## Forbidden

- ❌ The logo of a NAMESAKE company or of the wrong group (verify on the web!)
- ❌ The logo of the aggregator/job board (LinkedIn, Indeed) instead of
  the company's
- ❌ Writing `logo`/`logo_source`/`logo_fetched` by hand with db_update:
  ALWAYS go through `logo_fetch.py` (it is the only one that validates)
- ❌ SVG, images >35KB, icons <32px (the script rejects them: do not try
  to work around it)
- ❌ Homepage screenshots or crops: real logo files only
- ❌ More than 3 attempts per company: mark `--mark-attempted` and move on
