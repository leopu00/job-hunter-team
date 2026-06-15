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
2. **At write (analyst).** Before tagging an offer the analyst **reads the candidate's ACTIVE
   categories** (the registry, read at runtime — see `analista.md`) and assigns the **most similar
   one**. If none genuinely fits → `'Other'` + the raw label in `role_family_proposed`. **Never
   create a category for a one-off** (this is what kills the singleton explosion at the root).
3. **Birth by support (promotion).** A periodic, deterministic pass groups the `'Other'` proposals by
   their *normalized* label; when a group reaches **support ≥ N** (threshold, a user knob) it is
   **promoted** to an active category — **named from the data** (the most frequent raw label in the
   group) — and its rows are re-tagged. The team, not us, names it.
4. **Bounded & stable.** A per-candidate cap (~20 active) keeps the chart legible; beyond it the
   least-supported fall back to `'Other'`. Promotion/demotion use **hysteresis** (promote at ≥N,
   demote only below N−margin) so categories don't flap on the chart.

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
with a **bootstrap**: the promotion pass clusters the **candidate's EXISTING `role_family` values**
(deterministic, via `normalize_key`) and promotes the common ones into the registry **immediately**,
so they are already active and **not** re-queued — only genuine drift is reconciled. This is **not
hardcoding**: it clusters the **candidate's own data**, never our names (it's a *warm-start from the
candidate's data*, the legitimate cousin of the rejected *seed of our 15 names*). (Bootstrap lives in
the promotion pass — dev2's lane.)

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
