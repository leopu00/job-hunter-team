# 🗂️ role_family — emergent taxonomy MODEL (no hardcoded categories)

**What `role_family` is.** The semantic category of a job offer — it powers the dashboard category
chart and the "what kind of roles am I seeing" view for the candidate.

**The rule that governs everything here:** there is **NO predefined list of categories** anywhere —
not in this doc, not in code. The taxonomy is **emergent and per-candidate**: the team **discovers
and names** the categories by reading the candidate's real offers. Code holds only the *mechanics*
(matching, the registry, normalization, the `promote`/`merge` primitives the agents drive) — **never
the names, and no longer any string-clustering pass that decides categories**.

> Why. A fixed list (however reasonable) is fitting: it's right for one profile and wrong for the
> next (a finance candidate, a nurse, a lawyer). Free-text instead drifts (the same family written 5
> ways → the chart fragments — betaB produced 48 distinct values from 211 offers; betaA 63). The
> emergent model avoids BOTH: categories are not invented per-offer (no drift) and not hardcoded by
> us (no fitting). They **grow from the data, per candidate**.

---

## 🌱 The lifecycle of a category

```
new offer ─▶ [analyst] JUDGE the family, then reconcile with the ACTIVE registry (by MEANING):
                 │ same family as an active ─▶ role_family = that active name
                 │ none fits               ─▶ role_family = 'Other'  +  role_family_proposed = your label
                                          │
              [analyst, by JUDGEMENT] sees ~3+ similar offers in 'Other' (same family, surface-variants
              included) ─▶ promotes the family himself (role_registry.py promote --ids …):
              a NEW active category is BORN, named by the analyst, its rows re-tagged.
                                          │
              [Capitano, ARBITER C-17] family too big (>~25, hides finer ones) ─▶ SPLIT;
              two actives = same family ─▶ MERGE (role_registry.py merge). One bounded round.
```

1. **Empty start.** The active-category registry starts **empty for each candidate**. No seed, no
   universal list. The first offers all land in `'Other'` with a proposed label — this is expected
   (see Cold-start).
2. **At write (analyst) — JUDGE-FIRST, then reconcile.** The analyst **first names the family the
   offer genuinely belongs to** (its own semantic call), **then** reads the candidate's ACTIVE
   categories (the registry, read at runtime — see `analista.md`): if an active is the **same
   family** → write that exact name (synonyms collapse here); if none is → `'Other'` + the raw label
   in `role_family_proposed`. **Two symmetric failure modes are banned:** (i) **never create a
   category for a one-off** (kills the singleton explosion — betaB's 48 variants); (ii) **never dump a
   distinct role into a broad catch-all** just because the bucket is wide (kills the collapse — betaA
   into a single "Business & Operations"). A wide bucket is **residue, not a home**: if the only
   active that "fits" is over-broad, the family hasn't emerged yet → propose the finer label. The
   directional ~5-8 aim is **bi-directional**: aggregate near-dups when too many, propose finer
   families when below ~5-8 with only broad actives.
3. **Birth by JUDGEMENT, not by a string-pass (2026-06-20).** A category is born when an **analyst**,
   reading the `'Other'` parking lot (`db_query.py other-pile`), recognises **~3+ offers of the same
   family** — his semantic call, *surface-variants included* (`"IB / M&A Advisory"` + `"Transaction
   Advisory / M&A"` = one `"Investment Banking / M&A"`) — and **promotes it himself**:
   `role_registry.py promote --name "<family>" --ids <…>` activates it and re-tags those rows. **No
   periodic string-clustering pass decides categories any more**: grouping by identical normalized
   label fragmented near-synonyms and promoted nothing → everything stuck in `'Other'` (betaA
   rootcause 2026-06-20). A single offer never births a family (needs a cluster). The team — the
   analyst's brain — names it.
4. **Arbitrated & bounded (Capitano, C-17).** The **Capitano is the arbiter** the team previously
   lacked: a family that grows **too big** (>~25) and hides finer families → **split** (the analyst
   promotes the finer subsets); two actives that are the **same family** → **merge**
   (`role_registry.py merge`). Always **one bounded round**, then everyone works on (anti-loop). A
   safety **cap** (~20 active) still backstops explosion.
   **Directional aim (a guardrail, NOT a rule):** **few significant families — ~5-8, relative to the
   data** (fewer for a narrow profile; more only if the data justifies it). What converges there is the
   analysts' **judgement** + the Capitano's **verdicts**, expressed in `analista.md` step 8 and
   `capitano.md` C-17 — **not** a threshold.

---

## 🛡️ The anti-drift chain (how it converges without a synonym list)

Emergence fails if done naively (the drift just moves *inside* `'Other'`). Three generic layers, no
hardcoded names or synonym dictionary:

1. **Generic normalization** (mechanics, shared) — lowercase, trim, token-sort, collapse connectors
   (`/ & -`). Collapses **surface** variants (`"Equity / VC"` = `"VC / Equity"`). It is the cluster
   key for promotion and an assist for matching. It carries **no domain names**.
2. **Match-first, semantic (analyst)** — abbreviations/synonyms (`"PE"` ↔ `"Private Equity"`) are
   **not** solved by string normalization (a synonym map would be hardcoding). They collapse because
   the analyst, seeing `"PE"`, first **matches** it against the active categories and reuses the
   existing one — semantic judgement, not a dictionary. So the abbreviation never becomes a separate
   proposal.
3. **Judgement + arbitration (was: a numeric threshold).** A one-off never becomes a family — the
   analyst promotes only a **cluster** (~3+, by meaning). **Surface** near-dups are matched to the
   active at write (via `normalize_key` in the write-guard), so they rarely even reach `'Other'`.
   **Semantic** near-dups (`"PE"` vs `"Private Equity"`; `"IB / M&A Advisory"` vs `"Transaction
   Advisory / M&A"`) are caught two ways: the analyst **match-first** reuses an existing active once it
   exists, and when two actives still diverge the **Capitano MERGES them** (`role_registry.py merge`,
   C-17) — this is now an **implemented** step (LLM judgement of the agents), not the deferred
   "future LLM no-op" it used to be. The registry's `merged_into` status records the reconciliation.

---

## 🔖 `'Other'` is a sentinel, not a category

`'Other'` (the residue marker) is the **one literal the mechanics needs**: it means *"no active
category matched"*. It is not a domain category and not "hardcoding a category" — it's the absence of
one. The **DB value is `'Other'`** (stable, language-neutral); the dashboard shows it **localized via
i18n** (e.g. "Altro" in Italian) — the localization is a UI concern, the stored value stays `'Other'`.
All components (write-guard, the `promote`/`merge` primitives, this model) compare against the **same**
string `'Other'`. Everything in `'Other'` carries a `role_family_proposed` and is the **feedstock the
analyst promotes from** (`other-pile` → `role_registry.py promote`, §3).

**`NULL` ≠ `'Other'` — and `NULL` is NOT a category.** `role_family IS NULL` means *"never
categorized yet"* — the **default of every freshly-scouted offer** (the column has no default), a
**transient** state, never a resting place. A fresh candidate therefore **always** accumulates `NULL`
rows as the scout inserts faster than the analyst categorizes; left undrained they pile up **ignored**.
The analyst's job is to take each `NULL` to an active family or to `'Other'` (uncertain → `'Other'`,
never left `NULL`). The trap: `other-pile` and `category-sizes` only look at `'Other'`/actives, so a
large `NULL` backlog is **invisible** to them — a registry can read "healthy" while hundreds sit
uncategorized. `category-sizes` now prints the `NULL` count explicitly, and `next-for-categorize`
queues `NULL` + drift; the analyst must **drain that backlog as day-start priority** and never infer
"all categorized" from a view that cannot show the uncategorized (team-rule **RULE-T17**).

## ❄️ Cold-start — two cases (a known, accepted property — not a bug)

**(a) Brand-new candidate (no data).** With an empty registry the first analyses **all land in
`'Other'`** until the first clusters cross the threshold; early on the chart is mostly one `'Other'`
bucket, then categories emerge over the following days. This is the **accepted cost of
zero-hardcoding** (chosen over the convenience of a seed).

**(b) Existing candidate at DEPLOY (has legacy `role_family` values).** The registry **persists** across
deploys, so a candidate that already has active categories (betaB's 12) keeps them — nothing
re-storms. Genuine **drift** (legacy labels not in the active set) is reconciled by the **analyst**
through `next-for-categorize`: he matches each to an active or, on a cluster, **promotes** it (§3) —
bounded, brain-driven, no mass re-analysis triggered by us.

> **NB — the automatic bootstrap pass was REMOVED (2026-06-20)**, together with the periodic
> string-pass. The old bootstrap clustered legacy `role_family` values by `normalize_key` and promoted
> the common ones at boot. On an **already-collapsed** legacy (betaA: `"Business & Operations" ×175`
> swallowing everything) it seeded a **lone dominant catch-all**, the analyst deferred to that one-item
> menu, and the collapse self-perpetuated. A `CATCHALL_DOMINANCE`/`CATCHALL_TAIL_MIN` guard tried to
> suppress that seed but was bootstrap-only and brittle. **Rebuilding is now the analysts' judgement,
> not a string heuristic** — the guard/auto-bootstrap live on only in the legacy `pass` (diagnostics).

**A production candidate already collapsed** (registry already holds a lone catch-all, e.g. betaA's
`"Business & Operations"`) is repaired by a one-time, **user-gated registry reset** at deploy: clear
the polluted registry → `next-for-categorize` re-queues the backlog → the **judge-first** analysts
rebuild the real families and promote the clusters (§3), with the **Capitano arbitrating** (C-17). See
the finding doc runbook.

---

## 🧩 Ownership of the mechanics (who builds what — names live nowhere)

| Piece | Owner | Holds names? |
|---|---|---|
| This MODEL doc + analyst behavior (`analista.md` step 8: judge-first → match / park in `'Other'` / **promote a cluster**) + Capitano arbitration (`capitano.md` C-17: split / merge verdicts) | dev1 | ❌ |
| Generic `normalize()` + write-guard (validate role_family ∈ active-registry else `'Other'`) + `next-for-categorize` (re-queue rows not in the active set) + `other-pile` / `category-sizes` reads | dse3 | ❌ |
| The registry (per-user state table) + the **brain-driven primitives** (`promote --ids` / `merge`) the analysts & Capitano invoke + the safety cap + sync to dashboard | dev2 | ❌ |

The registry is read the **same way** by all three through **one shared interface** (a runtime
read of "active categories for this user"). No component embeds a category name; the names exist only
as **data**, born from the candidate's offers.
