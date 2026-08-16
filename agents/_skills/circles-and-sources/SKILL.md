---
name: circles-and-sources
description: Strategy map for what to search WHERE, derived entirely from the candidate profile. The 5 concentric circles (work_mode + relocation) tell you the geographic scope; the 4 source tiers (LinkedIn → ATS aggregators → niche → web) tell you which platforms to drain in order. A scout that searches the wrong tier in the wrong circle wastes its quota and its `scout-coord` partition. Open this skill at boot (after `scout-coord`) and again whenever a circle is exhausted or a `[FEEDBACK]` from the Analyst suggests changing source.
allowed-tools: Bash(python3 /app/shared/skills/safe_fetch.py *), Bash(python3 /app/shared/skills/linkedin_check.py *)
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
| `"ovunque"`            | Global hubs **for the candidate's domain** (finance → London, NYC, Zurich, Frankfurt, Singapore, Dublin, Luxembourg; tech → SF, Berlin, Amsterdam, Lisbon, Tel Aviv…). **Rotate across them round-robin — do NOT drain the densest hub (e.g. London for finance) first**, or the shortlist ends up hub-dominated (see Anti-bias rule, location guard). |
| `"Europa"`             | EU tech hubs (Berlin, London, Amsterdam, Lisbon, Dublin, Madrid, Paris, Stockholm, ...)     |
| `"per la giusta posizione"` | Skip circle 3, mark borderline candidates from circle 4 with relocation flag in notes |

## The 4 source tiers

Drain a tier completely before moving to the next.

| Tier | Type                                | Sources                                                                                                       | Notes                                                                                          |
|------|-------------------------------------|--------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------|
| 1    | **LinkedIn**                        | `linkedin_check.py` (authenticated profile), `safe_fetch.py`                                          | Universal: covers remote, on-site, hybrid. Mandatory first step for every circle. **NEVER `fetch` MCP** — blocked by robots.txt. |
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

## Anti-bias rule (mandatory) — on **company AND location**

Two independent guards, both at end of batch:

1. **Company**: if **> 30% of a single batch's positions come from one company**, switch source/query for the next batch. One scaleup dumping 12 roles on a board floods the pool — diversity matters more than volume.
2. **Location** (city/area): if **> 40% of a single batch comes from one city**, the next batch MUST target a *different* circle-city. Without this, a candidate open to a multi-city circle (e.g. relocation `"ovunque"`/`"Europa"`) gets a pool dominated by the single hub that has the most postings for their domain — finance → **London**, tech → SF/Berlin. Real incident (beta tester #2): a finance candidate received an almost London-only shortlist because London out-posts every other hub by ~10×. Rotate across the circle's cities round-robin; don't drain the densest hub first.

```python
# pseudocode for the check at end of batch
from collections import Counter
batch = [...]
n = len(batch)

# guard 1 — company
top_company, c_count = Counter(p.company for p in batch).most_common(1)[0]
if c_count / n > 0.30:
    log(f"anti-bias company: {top_company} = {c_count}/{n} >30% → switch source/query")

# guard 2 — location (city), CUMULATIVO sull'intero run (NON solo questo batch)
# Il guard per-batch non basta: un hub (London per la finanza) resta sotto-soglia
# in ogni singolo batch eppure accumula il 60% del DB nel tempo (visto live sul
# beta: London=57/97=59%). Misura sul TOTALE del DB.
db_by_city = dict(db.execute(
    "SELECT COALESCE(loc_city, TRIM(SUBSTR(location,1,INSTR(location||',',',')-1))), COUNT(*) "
    "FROM positions GROUP BY 1"))
db_total = sum(db_by_city.values()) or 1
top_city, top_n = max(db_by_city.items(), key=lambda kv: kv[1])
if top_n / db_total > 0.35:                       # SOFT cap: nessuna città > ~35% del run
    log(f"anti-bias location CUMULATIVO: {top_city}={top_n}/{db_total} (>35%) → "
        f"STOP queries su {top_city}, prossimo sweep su città prioritarie sotto-servite")
```

**Regola di bilanciamento geografico (cumulativa, soft-cap) — incentiva lo spread, non impone la parità:**

1. **Leggi il profilo**: le `priority cities` (campo `location` / `preferences.relocation`) sono il target. È normale e giusto che le città con più fit pesino di più — NON forzare uno split uniforme.
2. **Misura sul run intero** prima di ogni nuovo sweep: `SELECT loc_city, COUNT(*) FROM positions GROUP BY loc_city ORDER BY 2 DESC`.
3. **Soft-cap ~35%**: se UNA sola città supera il ~35% del totale DB, **smetti di interrogarla** per i prossimi sweep e ridirigi lo sforzo. Un hub (es. London per la finanza out-posta ogni altra città ~10×): lasciarlo correre produce uno shortlist hub-dominated, inutile per chi ha priorità multi-città.
4. **Quota di copertura priorità**: le priority-city del profilo a **0 o sotto-servite** hanno precedenza nei prossimi sweep — dedica query mirate (`<provider>:<keyword>:<city>`) finché non hanno una presenza minima, prima di tornare sugli hub già pieni.
5. **Città fuori-profilo come hub = doppio allarme**: se la città dominante NON è tra le priority del profilo, è hub-bias + off-target → ribilancia con urgenza.

### ⚠️ Work-authorization come filtro PRIMA del bilanciamento (Brexit, visti)

Bilanciare le location non serve se le offerte non sono **lavorabili** dall'utente. Prima di accettare un hub, verifica la compatibilità di work-permit col profilo (cittadinanza / visti dichiarati):

- 🇬🇧 **UK post-Brexit**: un cittadino **UE senza visto UK** NON può lavorare a Londra/UK senza **sponsorship** (Skilled Worker visa). Quindi per un profilo solo-UE le offerte UK valgono **solo se** il JD menziona esplicitamente *visa sponsorship*; altrimenti sono work-auth incompatibili → SKIP (vedi "Permissive filters", regola geo).
- 🇨🇭 **Svizzera / non-UE**: stessa logica — verifica permesso di lavoro.
- Regola pratica: se l'hub dominante è in un paese che richiede un permesso che l'utente non ha (e i JD non offrono sponsorship), quel volume è **fantasma** — non conta come copertura e va escluso dal pool, non solo bilanciato.

### 🗣️ Language-aware sourcing — non raccogliere ciò che verrà escluso per lingua

Stesso principio della work-auth, sul fronte linguistico. Se le **lingue dell'utente** (`languages`, con livello) NON coprono la **lingua di lavoro locale** di una città target, i ruoli che la richiedono saranno scartati a valle dall'Analista (`[LANGUAGE]`) — raccoglierli è spreco. Caso reale (beta): candidato con inglese C1 + tedesco solo conversazionale + niente IT/ES/FR → su 18 escluse, 11 erano per lingua locale obbligatoria (M&A in tedesco a Monaco/Zurigo, IB in italiano a Milano, ecc.).

**Regola:** prima di interrogare una città il cui idioma locale l'utente non padroneggia a livello business, **biasa le query verso ruoli English-first / international**:
- Aggiungi qualificatori alla query: `"English-speaking"`, `"international team"`, `"English required"`, nome di multinazionali/firm globali (Big4, bulge-bracket, scale-up internazionali) che lavorano in inglese anche in mercati non-anglofoni.
- Per i ruoli che invece **richiedono** la lingua locale (e l'utente non l'ha a livello business): trattali come i UK-no-sponsor — non inserirli, oppure inseriscili solo se il JD dice esplicitamente che la lingua locale non è richiesta.
- Inglese come lingua di lavoro ≠ paese anglofono: a Amsterdam, Zurigo, Lussemburgo, Lisbona molti ruoli finance girano in inglese. Sono il **sweet spot** per chi parla solo inglese ma vuole l'Europa continentale.

Esito: il pool che sopravvive all'Analista è più piccolo ma **ad alto rendimento** (accessibile per lingua E per work-auth), invece di gonfiarsi di ruoli che verranno scartati.

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
- ❌ Using LinkedIn via `fetch` MCP — blocked by robots.txt; always `linkedin_check.py` (authenticated) or `safe_fetch.py`.
- ❌ Including senior-titled JDs hoping the Scorer will filter them — wastes Scorer budget, adds noise. The 4 SCOUT-level filters above are the right place.
- ❌ Anti-bias check forgotten — one greedy company swamps your batch.

## See also

- `scout-coord` — boot-time partition between scouts (HOW to split this map across instances).
- `position-insert` — what to do for each candidate position once you've decided WHERE to look.
- `agents/scout/scout.md` — the Scout's orchestrator prompt that calls this skill.
- `agents/_team/architettura.md` Phase 1 — bigger picture of Discovery within the pipeline.
