---
name: mentor-patterns
description: The five patterns the Mentor hunts in the records to decide WHEN to speak. Silence is the default; only a real, recurring pattern earns a word. This skill gives the canonical detection method for each pattern (DB query + threshold) so the Mentor never speaks from a single data point. Read-only — never writes to the DB. Owned by the Mentor.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — what the records reveal

The Mentor watches sets, not single points. Five patterns are worth speaking about; everything else is noise.

## Pattern A — Skill gap between profile and market

Skills that show up repeatedly in JD requirements but are absent from `candidate_profile.yml > skills`. If they also appear in **high-scoring** positions, the gap is **costly** (closing it would unlock submissions, not noise).

### Detection

```bash
# 1. Pull the last 30 positions with their requirements + score
python3 /app/shared/skills/db_query.py positions --limit 30 \
    --status scored,checked --order-by created_at:desc

# 2. Tokenise requirements, compare with profile.skills.primary + .secondary
# 3. Count tokens NOT in profile that appear in N positions
```

### Threshold

Speak only if a missing skill appears in **≥ 5 positions in the last 30** AND **≥ 1 of them has score ≥ 65** (within reach of the submission gate).

### Example output

> *"<Name>, I have counted. **Docker** appears in twelve of the last thirty positions in the records. Nine scored between 65 and 78 — within reach of the submission gate, never crossing it. One craft separates you from a third of the path before you."*

## Pattern B — Recurring exclusions

Counts of `ESCLUSA: [TAG]` markers in `positions.notes` over the last 30 days. If one tag dominates, the search direction is misaligned.

### Detection

```bash
python3 /app/shared/skills/db_query.py positions --status excluded --limit 50 \
    --order-by last_checked:desc \
    | grep -oE 'ESCLUSA: \[(SENIORITY|STACK|GEO|LINGUA|LINK_MORTO|SCAM)\]' \
    | sort | uniq -c | sort -rn
```

### Threshold

Speak only if **one tag accounts for ≥ 40% of exclusions** AND total exclusions ≥ 20 in the last 30 days.

### Interpretation

| Dominant tag    | Likely cause                                             | Suggested move                           |
|-----------------|----------------------------------------------------------|------------------------------------------|
| `[SENIORITY]`   | Aiming too high (or too low) for the candidate's level   | Adjust `seniority_target` in profile     |
| `[LINGUA]`      | A single language is closing entire markets              | Add the language, or shrink geographic scope |
| `[GEO]`         | `work_mode` / `relocation` out of step with the search   | Re-discuss preferences with the user     |
| `[STACK]`       | Adjacent-stack noise reaching the team                   | Tighten Scout filters via Capitano       |
| `[LINK_MORTO]` (>40%) | Source quality issue, not candidate issue          | Forward to Capitano, this is a Scout problem |

## Pattern C — Low-score "parking band" (40-49)

The richest signal: positions in the parking band are **near-fits**. One score component holds them back. That component is the **lever**.

### Detection

```bash
# Pull all 40-49 positions with their score breakdown
python3 /app/shared/skills/db_query.py scores \
    --min-total 40 --max-total 49 --limit 30
```

For each, identify the **lowest single component** (`stack_match` / `experience_fit` / `remote_fit` / `salary_fit` / `strategic_fit`). Aggregate: which component is the lever for the most positions?

### Threshold

Speak only if **≥ 5 positions in the parking band share the same low-component** AND that component is < 50% of its weight cap.

### Interpretation

| Lever component   | What it means                                                        |
|-------------------|-----------------------------------------------------------------------|
| `stack_match`     | Skill gap (cross-check with Pattern A)                                |
| `experience_fit`  | Seniority mismatch (cross-check with Pattern B `[SENIORITY]`)         |
| `salary_fit`      | Candidate's salary expectation drifting from market                   |
| `remote_fit`      | Geographic preferences too narrow                                     |
| `strategic_fit`   | Stack/sector bonus eroded — the niche is fading or wasn't strong yet  |

## Pattern D — Post-submission feedback

If `applications.applied = true`, the outcome funnels carry the truth.

### Detection

```bash
# Submitted applications in the last 60 days
python3 /app/shared/skills/db_query.py applications --applied true \
    --order-by applied_at:desc --limit 30
```

Group by `response`: `interview` / `rejected` / `ghosted` / `null` (not yet replied). Compute:
- Interview rate = interviews / submitted
- Rejection rate = rejected / submitted
- Ghost rate = ghosted (`now - applied_at > 30d` AND no reply) / submitted

### Threshold

Speak only on **≥ 10 submitted applications** in the window (otherwise sample too small).

### Interpretation

| Pattern observed                                | Move                                                                  |
|-------------------------------------------------|-----------------------------------------------------------------------|
| Rejections share company kind / seniority gap   | Re-target the search (skill gap or seniority gap, see Pattern A/B)    |
| Ghosting > 60% with no specific cluster          | CV doesn't stand out OR market oversaturated → review CV with Critic / pause aggressive submissions |
| Interviews exist → look for what they share     | **Gold**: replicate the JD shape, the company size, the stack         |

## Pattern E — Review verdict trends

When the Critic bounces CVs that have nothing concrete to stand on. The Critic's `critic_score` lives in `applications` after the 3-round loop.

### Detection

```bash
python3 /app/shared/skills/db_query.py applications \
    --critic-score-max 5 --order-by written_at:desc --limit 20
```

Cluster the `critic_notes` by recurring failure mode (e.g. "no metrics", "stack mismatch", "About too generic").

### Threshold

Speak only if **≥ 5 recent CVs scored < 6** AND the same kind of remark appears in ≥ 3 of them.

### Interpretation

A recurring `critic_score < 5` with similar notes does NOT mean "the Writer is bad" — it means **the profile does not say enough**. The fix is upstream:
- About is too generic → ask the user for one concrete career inflection
- No metrics → mine the user for numbers (food cost %, latency reductions, headcount, hours saved)
- Stack mismatch → re-check `skills.primary` against actual JD requirements

## Cross-referencing patterns

Patterns reinforce each other. Strong signal:
- **A + C** (skill gap + low-component on `stack_match`) → almost certainly worth speaking.
- **B `[SENIORITY]` + C `experience_fit`** → seniority misalignment, mention once.
- **D rejected cluster + E critic_score < 5** → CV problem, escalate as Pattern E.

Avoid **A alone** when the skill is mentioned in only 5/30 positions and none scores high — that's noise, stay silent.

## Cadence reminder

This skill says **how to detect**. WHEN to speak is governed by the Mentor's prompt:
- 🌅 First wake — quick walk through the records, one observation if it earns it
- 🌗 Daily — quiet pass, speak only if a pattern crosses threshold
- 🌕 Weekly — digest even if nothing burns (use `mentor-output` skill, weekly format)
- 📞 On-demand — answer the user's question with the data you hold

If you have nothing pattern-grade to say, **say nothing**. Silence is an answer.

## Anti-patterns

- ❌ Speaking after detecting a single hit (1 position with `Docker` requirement) — sample too small, comes across as flailing.
- ❌ Aggregating across the whole DB (e.g. last 6 months) — old positions distort current market signal. Stick to last 30 days unless explicitly comparing trends.
- ❌ Using the round `experience_years` field for Pattern B/C reasoning — compute REAL years from `candidate.experience[].years` (same rule as the Analista).
- ❌ Speaking from web data without a record-based pattern first — the records are the trigger, the web is the verification (see `WebSearch` / `WebFetch` confirm-step in `mentor.md`).
- ❌ Doomsaying ("this leads nowhere") OR cheerleading ("you can do it!") — both violate the Mentor's voice. Numbers, then a question. See `mentor-output` skill.

## See also

- `mentor-output` — HOW to phrase the message once a pattern is confirmed.
- `db-query` — wrapper internals.
- `agents/mentor/mentor.md` — orchestrator prompt + cadence.
- `agents/_team/team-rules.md` T10 — profile is read-only, also for the Mentor.
