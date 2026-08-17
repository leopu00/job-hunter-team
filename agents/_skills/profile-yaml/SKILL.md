---
name: profile-yaml
description: "Maintain `$JHT_HOME/profile/candidate_profile.yml` — the structured candidate data the entire team consumes. The frontend polls this file every ~2s; an invalid YAML makes the user's left panel go silently blank. Owned by the Assistente. Use this skill on EVERY new piece of information from the user (text or uploaded file): write incrementally, validate immediately, talk to the user only after the validator says VALID_PROFILE. Also covers `ready.flag` (the unlock for the \"Vai alla dashboard\" button) with its strict 3-step verify-then-announce protocol."
allowed-tools: Bash(jht profile validate *), Bash(python3 *), Bash(mkdir -p *), Bash(date *), Bash(test *), Bash(rm -f *)
---

# profile-yaml — single source of truth on the candidate

The team reads `candidate_profile.yml` for every CV, every score, every match decision. If you keep it accurate the rest of the system works; if you let it drift the Writers produce sterile CVs and the Scorer mis-matches positions.

## Path & ownership

| Path                                          | Who writes it       | Who reads it             |
|-----------------------------------------------|---------------------|--------------------------|
| `$JHT_HOME/profile/candidate_profile.yml`     | **Assistente** (you), Capitano, user via the web UI | every other agent (read-only — T10) |
| `$JHT_HOME/profile/ready.flag`                | **Assistente** (you) | the dashboard's CTA gate |

Create the directory if it does not exist:
```bash
mkdir -p "$JHT_HOME/profile"
```

## Live update — incremental, after EVERY relevant input

The frontend polls the file every ~2s. Do not wait until the end of the conversation; **every time the user gives you a new datum, write it now**.

- "my name is Mario" → write `name: Mario` immediately.
- "I'm looking for a job as a cook" → update `target_role: cook` immediately.
- information typed in chat → update **all** the relevant fields in one Write.

Each new datum = one `Write` or `Edit` on the file. Then validate. Then keep the conversation moving.

### Uploaded CVs are reviewed before they become persisted profile data

A message containing `[FILE ALLEGATI]` is the one exception to the direct-write rule. After reading the CV:

1. Write only the extracted fields to `$JHT_AGENT_DIR/profile-review.yml`. Never write them directly to `candidate_profile.yml`.
2. Run `python3 /app/shared/skills/profile_review.py stage`.
3. Only when it returns `ok: true`, tell the user that the extracted data is ready to review and ask them to press **Confirm and save** in the profile panel. Do not claim that the profile was saved.
4. If staging fails, say that the review could not be prepared. Do not ask the user to remind you in chat and do not bypass the review by editing the canonical profile.

The badge reads only persisted `candidate_profile.yml`. It must not advance while a CV review is pending.

## Mandatory validation after EVERY write/edit

Validate against the **canonical schema** (not just "it parses as YAML"): see the
[`profile-schema`](../profile-schema/SKILL.md) skill for the full schema.

```bash
jht profile validate
# direct fallback:
# python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → carry on. `INVALID_PROFILE` → read the `ERROR:` lines (field + reason),
fix that field, revalidate. The `WARN:` lines (legacy keys, e.g. `languages[].name` instead
of `language`) do not block but should be cleaned up when you touch that section.

**Do NOT continue the conversation with the user until `VALID_PROFILE`.** A broken profile
empties the whole left panel; the user thinks the app has crashed.

If you forgot to add the validation step you can be sure the file is broken — there is no "probably ok". Always run it.

## YAML safety rules

The frontend's parser is strict. Five rules that prevent every issue we have seen:

1. **Block scalar (`|-` or `>-`) for any text > 60 characters** — descriptions, summaries, free notes, strengths. Inline strings break on commas, colons, quotes, newlines, parentheses.
   ```yaml
   summary: |-
     Here you can write long text, with commas, colons, apostrophes,
     newlines, parentheses: the parser takes it exactly as it is.
   ```
2. **Quote inline strings with special chars** — if you must keep a string inline and it contains `"`, `:`, `#`, `&`, `*`, `>`, `|`, `%`, `@`, wrap it in double quotes (`"…"`) or switch to block scalar.
3. **Space after every `:`** — `role: Senior` ✅ · `role:Senior` ❌.
4. **Indent with 2 spaces, never tabs** — list bullets indent at the same column as the parent's first content character.
5. **No long em dashes / smart quotes** — paste from rich-text editors injects `—`, `“`, `”`. Replace with plain `-`, `"`, or use block scalar.

## Minimum schema (the floor)

The frontend has a fallback that unlocks "Vai alla dashboard" when these are present + non-empty (so the user can proceed even before you create `ready.flag`). Populate them all:

```yaml
name: <First Last>
target_role: <target role — descriptive phrase>
target_roles_priority:        # 2-5 CONCRETE, searchable role titles, in priority order
  - <e.g. "Investment Analyst">  # it is the "Ruoli desiderati" field the UI shows
  - <e.g. "Private Equity Analyst">  # and the one the Scout searches on (NOT the target_role phrase)
location: <city or area>
experience_years: <int>
has_degree: <true|false>
seniority_target: <junior|mid|senior>
industry: <sector>

skills:
  primary: [...]              # >= 2 entries
  secondary: [...]

languages:                    # >= 1 entry
  - language: <name>
    level: <A1..C2 | native>

candidate:
  name: <same as above>
  target_role: <same as above>
  contacts:
    email: ...
    phone: ...
    linkedin: ...
    github: ...
  experience:                 # >= 1 entry, each with company/role/years/summary
    - company: ...
      role: ...
      years: ...              # e.g. "Mar 2022 - present" — used for the real duration
      summary: |-
        ...
  education:                  # >= 1 entry, each with institution/degree/year
    - institution: ...
      degree: ...
      year: ...
  strengths:                  # 2-4 qualities as short entries (it is the UI's "Punti di forza"
    - <e.g. "DCF modelling">  # field). Same list you narrate in strengths.md;
    - <e.g. "Credit risk analysis">  # here as tags, there in narrative form

preferences:                  # EXACT KEYS — the frontend looks for exactly these
  work_mode: <remoto|ibrido|in sede|flessibile>
  work_mode_flexibility: <optional, free text>
  relocation: <true|false|"per la giusta posizione">
  salary_annual_eur: <e.g. "30-35k" | null>

sector_details:
  <free keys, snake_case — see the section below>
```

The keys `preferences.work_mode`, `preferences.relocation`, `preferences.salary_annual_eur` are read literally by the frontend to populate the "Preferenze di lavoro" section. Alternative names (`work_location`, `flexible`, `remote`) stay written but are invisible to the user.

Full schema + examples: `docs/examples/candidate_profile.yml.example` (for documentation, **do NOT copy its values** — see anti-hallucination).

## `sector_details` — free keys for the user's sector

A generic key/value section that the frontend shows as a list. You choose the keys based on the user's trade. Real examples:

```yaml
# Kitchen
sector_details:
  specializzazione: Pasticceria
  brigate: "ristoranti grandi (10+ persone in cucina)"
  patenti: ["HACCP", "antincendio rischio medio"]
  ruolo_attuale: "Capo partita salata"

# Healthcare
sector_details:
  specializzazione_infermieristica: "Area critica"
  iscrizione_albo: "OPI Roma n. 12345"
  reparti: ["Pronto soccorso", "Terapia intensiva"]
  turni_abituali: "notturni + festivi"

# Construction / plant engineering
sector_details:
  patenti: ["CAP carrello elevatore", "PES/PAV", "patentino ponteggi"]
  specializzazione: "Impianti elettrici industriali"
  anni_cantiere: 12

# Teaching
sector_details:
  classe_concorso: "A-12 (Italiano, Storia)"
  anni_ruolo: 8
  specializzazione_sostegno: true
```

Rules:
- Keys in `snake_case`, short and readable.
- Only add keys with a real value for the candidate. If you do not know → omit (never `null` / `""`).
- Values: string, number, boolean, array of strings.
- Sector not in the list → invent the right keys yourself, based on what matters in that trade. E.g. truck driver: `patente: CE+CQC`, `anni_alla_guida: 15`, `tratte_abituali: [...]`.

## `ready.flag` — unlocking "Vai alla dashboard"

The button is disabled by default. The frontend enables it IF:
- `$JHT_HOME/profile/ready.flag` exists (the explicit flag that YOU create), **OR**
- the backend detects that the minimum schema is already complete (automatic fallback).

So the button is often already unlocked by the fallback when the profile is complete — **do not announce the unlock if you were not the one who made the flag**.

### When to create the flag (3 STRICT steps, never skip them, never reorder them)

```bash
# 1. Create the flag with a UTC timestamp
date -u +"%Y-%m-%dT%H:%M:%SZ" > "$JHT_HOME/profile/ready.flag"

# 2. VERIFY that the file really exists (it can fail silently:
#    permissions, missing dir, disk quota, etc.)
test -f "$JHT_HOME/profile/ready.flag" && echo FLAG_OK || echo FLAG_MISSING

# 3. ONLY if step 2 = FLAG_OK → send the message in the chat.
#    If FLAG_MISSING → fix it (e.g. mkdir -p) and repeat from step 1.
#    NEVER announce the unlock without FLAG_OK in the previous step.
```


### 4. Notify the Capitano — this is where the team starts from

Only after `FLAG_OK`, and only once:

```bash
jht-tmux-send CAPITANO "[@assistente -> @capitano] [PROFILO-PRONTO] profilo del candidato completo e validato — il team può partire."
```

The Capitano does not look at the profile file: until someone tells it, on the first
run it leaves the user in front of an almost idle office. This message is the
trigger for its `first-run-burst` skill (full roster right away instead of the
step-by-step ramp). Without it, on day one the user sees one position every ten
minutes and concludes that the application is broken.

### Anti-hallucination of step 2

It is well known that an LLM tends to write "I did X" even when the tool call was never emitted. The `test -f` exists precisely to stop you if you skipped the creation: you see `FLAG_MISSING` and you remember to go back. **Do not trust your memory, trust only the output of `test -f`.**

### When to remove the flag

If during the conversation it turns out that a field of the blocking checklist is wrong or missing (e.g. the user says "ah no, that experience wasn't really mine"):

```bash
rm -f "$JHT_HOME/profile/ready.flag"
```

And tell the user: "I've put the button back on hold — let's review this point before moving on".

### Do NOT create the flag if

- the last profile validation printed `INVALID_PROFILE` (even once after the last Write);
- these are missing: name, target role, city, years of experience, email;
- these are missing: skills (≥2), languages (≥1), experiences (≥1), degrees (≥1).

## ⚠️ Anti-hallucination — the critical rule

**NEVER read `docs/examples/candidate_profile.yml.example` or `docs/examples/candidate_profile.hr.yml.example` as a source of values.** Those files document the *structure*, not the candidate. If you read them you risk writing "Mario Rossi" / "mario.rossi@example.com" into the real profile.

Use ONLY:
- what the user told you in the chat
- what you extracted from a CV / uploaded file

If you do not know a field: **leave `""` or omit it**, never invent a plausible value.

## Anti-patterns

- ❌ Writing the profile in your cwd `$JHT_AGENT_DIR` instead of `$JHT_HOME/profile/` — the frontend does not find it.
- ❌ Skipping the validation "it was only a small change" — every Write can break the YAML, always.
- ❌ Showing YAML / JSON / paths in the chat — the user is non-technical (see `assistente.md`, user-language section).
- ❌ Announcing the unlock without the `test -f` — it is the classic "I did X" hallucination without having done it.
- ❌ Appending (Edit) into existing sections without looking at the context again — the YAML must be rewritten coherently, not patched at random.

## See also

- `profile-summaries` — the 4 discursive MDs written in parallel with the YAML.
- `onboarding-flow` — the conversational protocol that decides when to update what.
- `chat-web` — how to communicate the confirmation to the user (1 line, no paths, no jargon).
- `agents/_team/team-rules.md` T10 — the profile is read-only for the other agents, verbatim quote.
