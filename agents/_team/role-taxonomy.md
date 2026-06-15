# 🗂️ role_family — Controlled Vocabulary (single source of truth)

**Purpose.** `positions.role_family` is the **semantic category** of a job offer. It powers the
dashboard category chart and the user's "what kind of roles am I seeing" view. Free text drifts:
on a real team (barto, 2026-06-14) 211 categorized positions produced **48 distinct values** —
`Technical Writing` vs `Technical Writing / Knowledge Management` vs `Technical Editing` vs
`Knowledge Management / Technical Writing`, `QA / Testing` vs `Quality / QC` vs `Quality Assurance
/ Regulatory` … the same family written 5 ways → the chart fragments into noise.

**Rule.** The Analista does **NOT invent** a category. It **MAPS** the JD to **exactly ONE** value
from the **closed list below**. One family per position, no compound `A / B` strings.

---

## ✅ Canonical list (closed)

Pick the SINGLE best fit. The scope note is the disambiguator.

| role_family | Scope (maps here) |
|---|---|
| `Technical Writing` | technical docs, API/SDK docs, manuals, user guides, technical editing, documentation, document control, technical publications |
| `Content & UX Writing` | content writing, copywriting, UX writing, content design, e-learning/instructional content, digital/web content |
| `Localization & Translation` | translation, localization, localization QA, interpretation, transcreation |
| `Knowledge Management` | knowledge base, knowledge architecture, documentation governance, enablement content |
| `Software Engineering` | backend, frontend, full-stack, general SWE, embedded/firmware |
| `Data Engineering` | data pipelines, ETL, data platform, BI engineering |
| `Data Science & AI` | data analysis, ML/AI engineering, data/AI operations, AI enablement, research |
| `DevOps / SRE / Platform` | devops, SRE, platform, infra, cloud, release |
| `QA & Testing` | QA, software testing, QC, test automation, regulatory/quality assurance |
| `Product & Project Mgmt` | product management, program/project management, product ownership |
| `Design` | UX/UI design, product design, graphic/visual (NOT UX *writing* → Content & UX Writing) |
| `Customer & Technical Support` | customer support, technical support, customer operations, developer relations |
| `Engineering (Other)` | civil, mechanical, electrical, production, field, manufacturing, packaging engineering |
| `Business & Operations` | finance, controlling, supply chain, consulting, sales/marketing ops, general operations |
| `Other` | **fallback** — no canonical fits. Set `role_family='Other'` AND flag for review (see Growth). |

---

## 🧭 Mapping rules

1. **One value, from the list.** Never a compound (`Technical Writing / Localization` → choose the
   PRIMARY: if the core deliverable is docs → `Technical Writing`; if it's translating/localizing →
   `Localization & Translation`).
2. **Map to the nearest scope**, don't widen the list. A "Documentation Specialist" → `Technical
   Writing`. A "QA Engineer (regulatory)" → `QA & Testing`. A "Localization QA" → `Localization &
   Translation` (localization is the domain; QA is the activity).
3. **Doubt between two?** Pick the one matching the **main deliverable / day-to-day**, not a
   secondary skill. Record the nuance in the position notes, not in `role_family`.
4. **Never** leave `role_family` as free text outside this list. If nothing fits → `Other`.

## 🌱 Growth (the list is closed, but it grows DELIBERATELY)
The list is intentionally short. If a position genuinely doesn't fit any canonical (not just a
naming variant of one), set `role_family='Other'` and emit a proposal to the Capitano:
`[@analista-N -> @capitano] [TAXONOMY-PROPOSAL] new role_family "<name>" — N positions, scope: <...>`.
A new canonical is added to THIS file only after review (Capitano + Analisti agree). This prevents
runtime drift: analysts converge on the shared list instead of negotiating names per-position.
Until a proposal is accepted, those positions stay `Other` — they are NOT re-queued forever
(the categorize populator skips `Other` already reviewed; see analista.md).

---

## 📎 Appendix — the barto-48 consolidated (worked example)

Real drift → canonical, so analysts see the mapping in action:

- `Technical Writing`, `Technical Editing`, `Technical Writing / *`, `* / Technical Writing`,
  `Documentation / *`, `Document Control*`, `Technical Information / Document Control`,
  `Technical Content Development / Enablement` → **`Technical Writing`**
- `Content Writing / E-Learning`, `Digital Content / Web Operations`, `UX Writing / Content Design`,
  `UX Writing`, `Customer Operations / Writing` → **`Content & UX Writing`**
- `Translation / Localization`, `Localization QA`, `Localization / AI Enablement`,
  `Localization / Content Operations`, `Interpretation / Telephone` → **`Localization & Translation`**
- `Knowledge Management`, `Knowledge Architecture / Knowledge Management`,
  `Knowledge Management / Technical Writing` → **`Knowledge Management`**
- `Quality Assurance`, `QA / Testing`, `Quality / QC`, `Quality / Documentation`,
  `Quality Assurance / Engineering`, `Quality Assurance / Regulatory`, `Software Testing / Aerospace`
  → **`QA & Testing`**
- `Data / AI Operations`, `Data Analysis / Consulting` → **`Data Science & AI`**
- `Customer Support`, `Technical Support`, `Technical Support / Developer Relations`,
  `Technical Support / Field Engineering` → **`Customer & Technical Support`**
- `Civil Engineering / Construction`, `Field Engineering / Maintenance`, `Production Engineering`,
  `Manufacturing / Production`, `Packaging / Production Engineering`,
  `Production / Technical Office` → **`Engineering (Other)`**
- `Product Management` → **`Product & Project Mgmt`**
- `Finance / Controlling`, `Supply Chain / Operations` → **`Business & Operations`**

→ **48 free-text values collapse to ~11 canonical** for this profile. The chart goes from noise to
signal.

---

## 📎 Appendix — dev-domain mapping (software/data/devops profiles)

For **software-engineering candidates** (the largest profile by volume) the analyst emits dev titles.
These map deterministically (enforced upstream in `shared/skills/role_taxonomy.py`, after the
writer/localization/QA rules, before the `/ technical writing` catch-all):

- `backend`, `frontend`/`front-end`, `full stack`/`full-stack`, `software eng`, `software/web
  develop`, `embedded`/`firmware`, `mobile`/`ios`/`android develop` → **`Software Engineering`**
- `data engineer`, `data platform`, `etl`, `data pipeline`, `bi engineer` → **`Data Engineering`**
- `machine learning`, `ml engineer`, `ai engineer`, `ai/ml`, `data scien`(tist/ce), `data analy`(sis),
  `mlops`, `computer vision`, `nlp engineer` → **`Data Science & AI`**
- `devops`, `sre`/`site reliability`, `platform eng`, `infrastructure eng`, `cloud eng`, `release eng`
  → **`DevOps / SRE / Platform`**
- `ux/ui/product/graphic/visual design` → **`Design`** (NOT UX *writing* → `Content & UX Writing`)
- `project/program manage`, `product owner`, `scrum master`, `delivery manage` →
  **`Product & Project Mgmt`**

## 📎 Appendix — ⚠️ FINANCE domain GAP (open product decision)

The closed list has **no finance representation**. Finance candidates (e.g. Investment Banking,
Private Equity, Venture Capital, Corporate/Structured/Private Credit, Macro Trading, Real Assets,
Hedge Fund Research, Credit/Risk Analyst) all collapse to `Business & Operations` or `Other` → the
category chart loses the finance signal entirely.

**Decision pending (taxonomy lane + user product choice):**
- **(A)** add a small finance cluster (e.g. `Investment Banking & Advisory`, `Investment Management &
  Markets`, `Credit & Risk`, `Quant & Trading`) — recommended, finance is a primary candidate
  vertical; or
- **(B)** accept `Business & Operations` as the finance catch-all (no work, poor chart).

Not added unilaterally — list growth is **deliberate** (TAXONOMY-PROPOSAL → review → add, see Growth).
See `docs/internal/2026-06-15-taxonomy-upstream-fix-e-domain-gaps.md`.
