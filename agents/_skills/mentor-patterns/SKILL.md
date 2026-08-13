---
name: mentor-patterns
description: The six patterns the Mentor hunts in the records to decide WHEN to speak. Silence is the default; only a real, recurring pattern earns a word. This skill gives the canonical detection method for each pattern (DB query + threshold) so the Mentor never speaks from a single data point. Read-only — never writes to the DB. Owned by the Mentor.
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/feedback_query.py *), Bash(grep *), Bash(awk *)
---

# mentor-patterns — what the records reveal

The Mentor watches sets, not single points. Six patterns are worth speaking about; everything else is noise.

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

## Pattern F — Recurring reasons in the user's own words

From the web the user judges positions (not interesting / interesting / very interesting, plus "exclude") and can write **why**, in free text: `reason` (≤ 500 chars) and `comment` (≤ 2000). That text is the only place where she says what she wants in her own words. Read one position at a time it is an anecdote; counted together it is a fact. Ten "too senior" are not ten opinions about ten job ads — they are one statement about the search.

Note the difference from Pattern B: there the exclusions are the **agents'** (`ESCLUSA: [TAG]` in `positions.notes`), here the judgement is the **user's**. Two different flows; when they agree, see the cross-referencing section.

This feedback lives in the cloud (`position_feedback`), not in `jobs.db`: it is the one pattern that does not go through `db_query.py`.

**`RAW_DISPLAY_BOUNDARY`** — cluster on raw `reason` / `comment`, but never relay them. Any user-facing interpretation may use only `display_reason` / `display_comment` and sanitized theme `label` / `examples`; machine keys, IDs and `no-signal:*` notes stay internal.

### Detection

```bash
# Themes in the reasons the user typed, last 30 days
python3 /app/shared/skills/feedback_query.py themes --days 30 --min-positions 3

# The same feedback unaggregated; read only display_reason/display_comment
python3 /app/shared/skills/feedback_query.py recent --days 30
```

`themes` groups free text by plain similarity — no exact match required. It lowercases, strips accents, drops punctuation and service words, cuts every word to its first 5 characters (`senior` / `seniority` / `seniore` / `séniorité` land on the same key), then counts single words and adjacent word pairs by **distinct positions**. A pair wins over its parts when it covers the same positions: "too senior" says more than "senior", and intensifiers are kept on purpose for exactly that reason.

Per theme it returns `positions`, `events`, `share` (fraction of the positions that carry text), `actions` (how the theme splits across like / dislike / hide / star), internal `legacy_ids`, and up to 3 sanitized display `examples`.

It is cheap by construction and it shows: distant synonyms stay apart (`salary` and `RAL` are two themes). Read the `examples` and join with your head what the tool could not.

If the payload carries a closed `note` enum (`no-signal:*`), there is no aggregate: stay silent, never relay its code, and do not rebuild the picture out of single-position `check` calls.

### Threshold

Speak only if **all three** hold in the window:

- **≥ 8 feedback events carry text** (`events_with_text`). Writing a reason costs the user effort, so this volume is an order of magnitude below any machine-generated count — but under 8 a percentage means nothing (with 3 texts, one theme is already a third).
- The theme covers **≥ 4 distinct positions** (`positions`, never `events`: judging the same ad twice is one opinion, and counting events would let one stubborn job ad look like a trend).
- The theme's **`share` ≥ 0.30**. Free text splits one real objection across synonyms, so dominance is diluted by construction; Pattern B can ask for 40% because its tags are a closed vocabulary. At low volume the "4 positions" rule binds, at high volume the share does — that is the intent.

Below that, say nothing. One "too senior" is a remark about one job ad.

### Interpretation

The theme says where to look; the records say whether it is a problem.

| Theme family (examples)                          | Where it points                                                        |
|--------------------------------------------------|------------------------------------------------------------------------|
| Seniority ("too senior", "too junior")           | The band declared in `seniority_target` vs what the market calls it     |
| Stack ("legacy Java", "no PHP")                  | `skills.primary` — declared stack and wanted stack drifting apart (cross-check A) |
| Pay ("salary too low", "no range")               | Salary expectation vs advertised bands (cross-check C `salary_fit`)     |
| Place ("on-site", "too far", "no remote")        | `work_mode` / `relocation` (cross-check C `remote_fit`)                 |
| Company / sector ("agency", "consultancy")       | A preference that was never written into the profile                    |
| The ad itself ("vague", "no info", "no salary")  | Ad quality, not fit — worth one line only if it dominates, and as noise, not as a lever |

**The finding worth a sentence is the disagreement.** Cross the theme's `legacy_ids` with their scores (`db_query.py scores`). When the user keeps rejecting positions the Scorer put above 70, the score is not broken — it is faithfully measuring fit against a **profile that has stopped describing what she wants**. The profile is read-only for you (T10): you say the number and ask the question, she decides.

### Example output

> *"<Name>, in the last thirty days you wrote a reason on nineteen positions. On seven of them — better than a third — the words were the same: **too senior**. Five of those seven the Scorer had put above 70: it was reading your profile, which still declares a senior target. Has the target moved, or were those seven simply badly written ads?"*

## Cross-referencing patterns

Patterns reinforce each other. Strong signal:
- **A + C** (skill gap + low-component on `stack_match`) → almost certainly worth speaking.
- **B `[SENIORITY]` + C `experience_fit`** → seniority misalignment, mention once.
- **D rejected cluster + E critic_score < 5** → CV problem, escalate as Pattern E.
- **F + B on the same subject** (the user rejects for seniority AND the agents exclude for `[SENIORITY]`) → the declared band is the problem, not the market. The strongest signal there is, because it comes from two independent flows.
- **F + C on the same lever** (`salary_fit` / `remote_fit`) → the score model and the user point at the same friction. One sentence, not two.
- **F against high scores** → profile drift, see Pattern F interpretation.

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
- ❌ **Turning Pattern F into a search instruction.** Never hand the Scout or the Capitano a "stop bringing X" derived from what the user likes. A pipeline that only fetches what pleases inflates its own scores, and the user ends up believing the market is rich when it was the pipeline that chose for her. Pattern F is addressed **to the user**: what changes in her profile is her decision, and the Mentor is read-only anyway (T10).
- ❌ Quoting back a judgement the user has withdrawn. `themes` already leaves out positions whose last event is `clear`; do not put them back with `--include-cleared` to reach a threshold.
- ❌ Quoting one raw comment as if it were a pattern. Sanitized `examples` give a theme a voice **after** it crosses the threshold; they are not the finding.

## See also

- `mentor-output` — HOW to phrase the message once a pattern is confirmed.
- `db-query` — wrapper internals.
- `feedback-query` — the reader for the user's feedback in the cloud (Pattern F); the Scorer queries the same source one position at a time.
- `agents/mentor/mentor.md` — orchestrator prompt + cadence.
- `agents/_team/team-rules.md` T10 — profile is read-only, also for the Mentor.
