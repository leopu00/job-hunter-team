---
name: profile-schema
description: "Single source of truth for the SCHEMA of candidate_profile.yml — the canonical format that the WHOLE team produces and consumes. 3-level model: frozen core + standard blocks + free custom blocks. Defines the 6 block `kind`s the web knows how to render and the governance rule (no agent invents the format). Every profile write must be validated with `jht profile validate`. Referenced by profile-yaml, onboarding-flow, parse-cv, cv-structure."
allowed-tools: Bash(jht profile validate *), Bash(python3 *)
---

# profile-schema — the canonical profile format

Everyone writes and reads the same profile: the Assistente builds it, the web displays it,
Analista/Scorer/Scrittore consume it. If everyone uses different keys, the web cannot
render and the push loses data. This skill is **the only agreed format**. The
machine-verifiable definition lives in:
- `shared/config/profile-schema.ts` (Zod types, web side)
- `shared/skills/validate_profile.py` (runtime gate, agent/CLI side)

## 🎚️ 3-level model

```
L1 CORE      frozen and mandatory fields → typed, queryable (matching, /map)
L2 STANDARD  recommended slots (about, goals, preferences, strengths) → blocks
L3 CUSTOM    free rein: blocks tailored to THIS person → blocks
```

L2 and L3 are both **blocks** in the same `blocks:` array. The only difference is that
L2 uses recommended `key`s (below); L3 has a free `key` that you choose.

## 🧊 L1 — core (always present, never invent the keys)

```yaml
name: <str>                 # mandatory
target_role: <str>          # mandatory
location: <str>             # mandatory
experience_years: <int>     # mandatory (>= 0)
has_degree: <true|false>    # mandatory
seniority_target: <str>     # mandatory (junior|mid|senior|…)
email: <str>                # optional
timezone: <str>             # optional
nationality: <str>          # optional
birth_year: <int>           # optional
industry: <str>             # optional

skills:                     # mandatory, primary >= 1
  primary: [<str>, …]
  secondary: [<str>, …]
languages:                  # mandatory, >= 1.  ⚠️ key 'language' (NOT 'name')
  - language: <str>
    level: <str>
experience:                 # list, each one company+role
  - company: <str>
    role: <str>
    period: "Sep 2021 - Feb 2023"   # raw; the web shows it in the TIMELINE
    summary: |- …
education:
  - institution: <str>
    degree: <str>
    year: <str>
work_authorization:         # typed list (NOT {eu,ch,…} nested)
  - region: eu
    status: "EU citizen — free movement"
location_preferences: [<city>, …]
contacts:                   # PII — the web shows it reveal-on-click
  email: …  phone: …  linkedin: …  github: …  website: …  address: …
```

## 🧩🎨 L2/L3 — `blocks` (the heart of the flexibility)

```yaml
blocks:
  - key: <stable slug>        # about / goals / preferences / strengths (L2) or free (L3)
    kind: <one of the 6 below>  # the rendering "contract"
    title: <displayed title>
    ord: <int optional>       # order
    content: <shape depends on the kind>
```

### The 6 `kind`s (these are ALL of them — do not invent others)

| kind | content | when |
|---|---|---|
| `narrative` | markdown string (1st person) | narrated texts: about, goals, aspirations |
| `key_points` | `[{heading, text}]` | preferences, strengths (sectioned, NOT one blob) |
| `tag_list` | `[<str>]` | extra skills, interests, cities, target roles |
| `key_value` | `[{label, value}]` | paired data: "consulting fit", industry details |
| `timeline` | `[{title, subtitle, period, detail}]` | further dated sequences |
| `distribution` | `[{label, value}]` | when a donut/chart helps (e.g. city mix) |

`narrative` is the **universal fallback**: if a datum does not fit the other 5, put it there.

### Real examples

```yaml
blocks:
  - key: about
    kind: narrative
    title: About me
    content: |-
      I am a credit risk analyst with two years in private equity…
  - key: strengths
    kind: key_points
    title: Strengths
    content:
      - heading: Credit analysis
        text: Forensic due diligence, ratings, portfolio reviews.
      - heading: Communication
        text: I present sector deep dives and case studies.
  - key: consulting_fit            # ← L3 custom, free key
    kind: key_value
    title: Consulting fit
    content:
      - label: Interest
        value: High, on finance/transaction/strategy topics
      - label: Weak spot
        value: Grades not always a match for the most selective tracks
  - key: beyond_work               # ← L3 custom
    kind: tag_list
    title: Beyond work
    content: [Downhill skateboarding (HU champion), Rowing, Theatre]
```

## 🤝 Governance — do NOT invent the format

Every profile is different and deserves to be shown at its best: you have **free rein on the
content** of the L3 blocks. But the **format is frozen**. Rules:

1. **Never invent a `kind`** outside the 6. If a datum does not fit, use `narrative`.
2. **Never invent L1 keys** or rename them (e.g. `languages[].name` ❌ → `language` ✅).
3. If you really need a new `kind` or a new core field, **propose it to the Capitano** —
   schema extensions go through here (and through `profile-schema.ts` + `validate_profile.py`),
   never through a local convention of a single agent.

## ✅ Mandatory validation after EVERY write

It replaces the old `yaml.safe_load` "it is valid YAML" with "it conforms to the schema":

```bash
jht profile validate
# or directly:
python3 /app/shared/skills/validate_profile.py "$JHT_HOME/profile/candidate_profile.yml"
```

`VALID_PROFILE` → carry on. `INVALID_PROFILE` → read the `ERROR:` lines, fix, revalidate.
The `WARN:` lines (e.g. a legacy key) do not block but should be cleaned up when you touch that section.
**Do not talk to the user until it is `VALID_PROFILE`** (a broken profile empties the UI).

## See also

- `profile-yaml` — the write/validate mechanics of the file (it uses THIS schema)
- `profile-summaries` — the narrative texts → they become `kind: narrative` blocks
- `onboarding-flow` — when to update what
- `shared/config/profile-schema.ts` · `shared/skills/validate_profile.py`
