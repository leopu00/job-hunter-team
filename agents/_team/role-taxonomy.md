# 🗂️ role_family — emergent taxonomy MODEL (no hardcoded categories)

**What `role_family` is.** The semantic category of a job offer — it powers the dashboard category
chart and the "what kind of roles am I seeing" view for the candidate.

**The rule that governs everything here:** there is **NO predefined list of categories** anywhere —
not in this doc, not in code. The taxonomy is **emergent and per-candidate**: the team **discovers
and names** the categories by reading the candidate's real offers. Code holds only the *mechanics*
(matching, the registry, normalization, the promotion pass, the threshold) — **never the names**.

> Why. A fixed list (however reasonable) is fitting: it's right for one profile and wrong for the
> next (a finance candidate, a nurse, a lawyer). Free-text instead drifts (the same family written 5
> ways → the chart fragments — betaB produced 48 distinct values from 211 offers; betaA 63). The
> emergent model avoids BOTH: categories are not invented per-offer (no drift) and not hardcoded by
> us (no fitting). They **grow from the data, per candidate**.

---

## 🌱 The lifecycle of a category

```
new offer ─▶ [analyst] match to the most similar ACTIVE category?
                 │ yes ─▶ role_family = that active category
                 │ no  ─▶ role_family = 'Other' (residue)  +  role_family_proposed = raw label
                                          │
                       [promotion pass, periodic] cluster the 'Other' proposals by normalize(label);
                       a cluster with support ≥ N  ─▶ a NEW category is BORN, named from the data,
                                                       its rows re-tagged. Below N → stays in 'Other'.
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
3. **Birth by support (promotion).** A periodic, deterministic pass groups the `'Other'` proposals by
   their *normalized* label; when a group reaches **support ≥ N** (threshold, a user knob) it is
   **promoted** to an active category — **named from the data** (the most frequent raw label in the
   group) — and its rows are re-tagged. The team, not us, names it.
4. **Bounded & stable.** A per-candidate cap (~20 active) keeps the chart legible; beyond it the
   least-supported fall back to `'Other'`. Promotion/demotion use **hysteresis** (promote at ≥N,
   demote only below N−margin) so categories don't flap on the chart.
   **Directional aim (a guardrail, NOT a rule):** the team aims for **few significant families —
   ~5-8, but relative to the data** (fewer for a narrow profile; more only if the data truly
   justifies it). This lives in the analysts' **judgement** (they decide together via the registry —
   aggregate small-similar, surface a swelling `'Other'`), expressed in `analista.md`. The promotion
   threshold (a floor against fragmentation) and the ~20 cap (a ceiling against explosion) are
   **mechanical safety nets**, not the target.

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
3. **Threshold (promotion)** — a one-off never promotes (needs ≥N support). On near-dups: **surface**
   near-dups never reach promotion — the write-guard already matches them to the active via
   `normalize_key` at write, so they never land in `'Other'` (a promoting cluster therefore cannot
   share an active's key). **Semantic** near-dups (`"PE"` vs `"Private Equity"`) are prevented by
   match-first once the active exists; only at **cold-start** (no actives yet) can two close labels
   briefly co-emerge — an **accepted residual** (no deterministic fix without a synonym map, which we
   reject; a future LLM-assisted merge could reconcile, not v1). An explicit "merge-near-dup" step
   would be a no-op and is intentionally omitted; the registry's `merged` status exists only for such
   a future manual/LLM reconciliation.

---

## 🔖 `'Other'` is a sentinel, not a category

`'Other'` (the residue marker) is the **one literal the mechanics needs**: it means *"no active
category matched"*. It is not a domain category and not "hardcoding a category" — it's the absence of
one. The **DB value is `'Other'`** (stable, language-neutral); the dashboard shows it **localized via
i18n** (e.g. "Altro" in Italian) — the localization is a UI concern, the stored value stays `'Other'`.
All components (write-guard, promotion pass, this model) compare against the **same** string `'Other'`.
Everything in `'Other'` carries a `role_family_proposed` and is feedstock for the promotion pass.

## ❄️ Cold-start — two cases (a known, accepted property — not a bug)

**(a) Brand-new candidate (no data).** With an empty registry the first analyses **all land in
`'Other'`** until the first clusters cross the threshold; early on the chart is mostly one `'Other'`
bucket, then categories emerge over the following days. This is the **accepted cost of
zero-hardcoding** (chosen over the convenience of a seed).

**(b) Existing candidate at DEPLOY (has legacy `role_family` values).** Naively, an empty registry +
`next-for-categorize` re-queuing every non-`'Other'` legacy row would trigger a **one-time
re-analysis storm** of the whole backlog (hundreds of positions through the LLM analyst). Avoid it
with a **bootstrap**: the promotion pass clusters the **candidate's EXISTING `role_family` values`**
(deterministic, via `normalize_key`) and promotes the common ones into the registry **immediately**,
so they are already active and **not** re-queued — only genuine drift is reconciled. This is **not
hardcoding**: it clusters the **candidate's own data**, never our names (it's a *warm-start from the
candidate's data*, the legitimate cousin of the rejected *seed of our 15 names*). (Bootstrap lives in
the promotion pass — dev2's lane.)

**⚠️ Anti-catch-all guard (2026-06-16, betaA lesson).** The bootstrap is only as good as the legacy:
if the candidate's legacy was **already collapsed** (an old free-text run that dumped most offers into
ONE generic bucket, e.g. betaA's `"Business & Operations" ×175` alongside 61 distinct finance labels
each below threshold), a naïve bootstrap promotes **only** that mega-bucket as the **sole** seed → the
analyst then defers to a one-item menu and the collapse **self-perpetuates**. So at bootstrap (empty
registry) the pass **must not seed a lone dominant catch-all**: if the *only* cluster reaching
threshold dominates the corpus (≥ `CATCHALL_DOMINANCE`) **and** a large diverse sub-threshold tail
exists (≥ `CATCHALL_TAIL_MIN` distinct labels), that cluster is **suppressed** (left as drift, not
promoted) → cold-start proceeds, `next-for-categorize` re-queues the backlog, and the **judge-first**
analyst rebuilds the real families from scratch. The guard is **bootstrap-gated** (fires only on an
empty registry) and **self-limiting** (once ≥2 real families emerge it never triggers), so it cannot
disturb a healthy multi-category registry (betaB's 12). Implemented in `role_registry.py` (dev2's
lane). A candidate **already** collapsed in production (registry already holds the lone catch-all) is
repaired by a one-time **registry reset** at deploy — see the finding doc runbook.

A future opt-in *warm-start from the candidate's profile* could also pre-populate likely categories —
again **team/data-generated, never hardcoded by us** (user's later call, not part of v1).

---

## 🧩 Ownership of the mechanics (who builds what — names live nowhere)

| Piece | Owner | Holds names? |
|---|---|---|
| This MODEL doc + the analyst behavior (`analista.md`: read-active → match-best-or-`Altro`, never invent) | dev1 | ❌ |
| Generic `normalize()` + write-guard (validate role_family ∈ active-registry else `'Other'`) + `next-for-categorize` (re-queue rows not in the active set) | dse3 | ❌ |
| The registry (per-user state table) + the promotion pass (cluster → support ≥N → born, hysteresis, merge-near-dup, cap) + sync to dashboard | dev2 | ❌ |

The registry is read the **same way** by all three through **one shared interface** (a runtime
read of "active categories for this user"). No component embeds a category name; the names exist only
as **data**, born from the candidate's offers.
