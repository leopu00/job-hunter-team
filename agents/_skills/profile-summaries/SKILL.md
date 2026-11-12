---
name: profile-summaries
description: Write the 4 narrative Markdown summaries under `$JHT_HOME/profile/summaries/` that complement the structured YAML. The Writers downstream NEED these — a YAML alone produces sterile CVs because it has no voice, no narrative, no positioning. Owned by the Assistente. Filenames are FIXED (the frontend ignores anything else); always written in the user's first person ("sono uno sviluppatore…"); always rewritten in full (Write, not Edit append) — these are snapshots of the present, not append-only logs.
allowed-tools: Bash(mkdir -p *)
---

# profile-summaries — the candidate's voice on disk

The structured YAML is great for filters and matches but says nothing about *who* the candidate is. The 4 MD files in `summaries/` carry the narrative the Writers need to produce CVs that read like a person, not a checkbox list.

## 🌍 Language (binding)

Write the four files in the user's language — `python3 /app/shared/skills/text_language.py lang` prints it (`i18n-prefs.json`, then `$JHT_LANG`) — **even if the conversation, the CV or the messages you read are in another language** (RULE-T14). Proper names, companies and tools stay as they are. Before you save a file, `python3 /app/shared/skills/text_language.py check "<text>"` must answer `OK`; on `WRONG_LANGUAGE`, rewrite the text.

## The 4 files (filenames are FIXED)

| File             | UI title shown to the user (in their language) | What it contains                                             | Length cap |
|------------------|----------------------------|-----------------------------------------------------------------------------|-----------|
| `about.md`       | **About you**               | Persona summary: current/target role, years, sector, distinctive trait      | ~400 char |
| `preferences.md` | **Preferences in your words** | Work mode, relocation, pay, hours, environment                            | ~400 char |
| `goals.md`       | **Goals and dream job**     | What they look for in the next 1-3 years, dream context/company             | ~500 char |
| `strengths.md`   | **Strengths**               | 2-4 concrete qualities with a short example for each                        | ~500 char |

Path: `$JHT_HOME/profile/summaries/<file>.md`. Crea la dir se manca:
```bash
mkdir -p "$JHT_HOME/profile/summaries"
```

Filenames diversi (es. `about-mario.md`, `goals_v2.md`) sono **silenziosamente ignorati** dal frontend.

## Style constraints (binding)

- **Plain Markdown**: paragraphs separated by a blank line, `**bold**` for emphasis, lists only when they help readability.
- **No tables, no `#` headers** — these MDs live in UI cards that already have a title.
- **Length**: respect the cap. No walls of text.
- **The user's first person**: `"I am a developer…"`, `"I prefer to work remotely…"`. Never the third person (`"Mario is…"`).
- **Tone**: natural, as if the user were talking about themselves to a friend who knows the field.
- **Never paths / file names / jargon** in the text — the user reads "the summary", not "about.md".

## Update rule — rewrite in full, never append

When a piece of information changes the meaning of an existing MD, **rewrite the file from scratch** (`Write` tool, NOT `Edit` append). They are snapshots of the present, not chronological logs. An append risks leaving obsolete paragraphs next to the new one.

A salary target given by the person must also be saved in the YAML field `preferences.salary_annual_eur`, with the same amount, currency and period. The narrative alone is not the structured preference; keep both in step, without guessing or converting.

## Trigger — quando scrivere ciascun file

| File              | When to write it the first time / update it                                                                                                                                                            |
|-------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `about.md`        | You have role + years + ≥1 experience. Rewrite it whenever something substantial changes (role, seniority, sector).                                                                                    |
| `preferences.md`  | You discussed with the user at least one of: work mode, relocation, pay. Update it whenever one of them changes.                                                                                      |
| `goals.md`        | The user told you about aspirations / ideal context / dream job (even partly). Do not force it: if it does not come up by itself, **ask once** "is there a kind of context or company where you would see yourself particularly well?". |
| `strengths.md`    | You collected **2+ relevant experiences or projects**. Extract 2-4 recurring qualities from the pattern.                                                                                               |

> ⚠️ When you write `strengths.md`, ALWAYS also fill the structured array `candidate.strengths` in the YAML (the same 2-4 qualities as short items) — see `profile-yaml`. The MD is the narrative for the Writer; the array is what the UI shows as "Strengths" and what the profile completion checks. Writing only the MD leaves that section empty.

## Boot rule — primo CV caricato

When the user uploads a CV, after filling the YAML write AT LEAST **`about.md` + `strengths.md`** in the same turn. You have enough data (role, years, experiences, skills, tone) to do it at once; do not postpone it. Skipping this step means the CV Writer downstream will never have the candidate's narrative context → it will produce sterile CVs. You are the only point where that narrative is captured.

`preferences.md` e `goals.md` arriveranno nei turni successivi (dopo la discussione specifica).

## Examples

### `about.md` (tech sector)
```markdown
I am a backend developer with 4 years of experience in **Python** and
distributed systems, lately focused on ETL pipelines and high-throughput
APIs. I come from a mixed path between **data engineering** and
"classic" backend, and I do well when the problem sits in between:
modelling the data + the service that exposes it.

I am looking for a senior backend or data role where I can own the
service end to end, not just "tickets".
```

### `strengths.md` (non-tech sector, a kitchen example)
```markdown
**Holding up at peak times.** I ran a brigade of 12 people in a
restaurant with 200 covers in the evening: I learned to keep pace and
quality even when it gets really hot.

**Cost of ingredients.** In the last 3 years I brought the food cost
of the savoury station from 34% to 28% by working on the menu and on
the relationship with suppliers, without touching quality.

**Team mentoring.** I trained 2 sous-chefs who now run their
brigades on their own.
```

## Anti-patterns

- ❌ Writing in the third person ("Mario is a developer…") — the frontend renders the text as the candidate's own voice; the third person sounds alienating.
- ❌ Appending with `Edit` instead of `Write` — the file ends up with two contradictory intros.
- ❌ Tables / `#` headers / verbose numbered lists — the UI card already has its own chrome.
- ❌ Skipping `about.md` / `strengths.md` after a CV upload "because it's in the YAML anyway" — the YAML has no tone, the writers produce sterile CVs.
- ❌ Putting paths or file names (`/jht_home/profile/summaries/about.md`) in the text — the user does not know what they are.
- ❌ Writing past the length cap — the UI card cuts / scrolls sideways, the message is lost.

## See also

- `profile-yaml` — sister skill: the structured data, updated alongside these MDs.
- `onboarding-flow` — when in the conversation to collect the data that feeds these MDs.
- `agents/scrittore/scrittore.md` — the downstream agent that reads these MDs to write CVs with a voice.