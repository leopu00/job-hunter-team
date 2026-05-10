---
name: cv-structure
description: Write the CV markdown that will be PDF'd and reviewed by the Critico. Six fixed sections, max 2 pages, every claim traceable to `candidate_profile.yml` (zero invenzioni — T10). Bullets follow the "metric in bold + tech in parens" pattern; tone matches the JD's company type (startup/corporate/fintech); Cover Letter only if the JD explicitly asks. Owned by the Scrittore. Pair with `application-flow` (claim + path) and `critic-loop` (review iterations).
allowed-tools: Bash(pandoc *)
---

# cv-structure — the canonical CV layout

Output goes to `$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md` (then PDF via pandoc/typst). Path rule: `application-flow` skill — never write the final CV under `$JHT_AGENT_DIR` (that's scratch only, T11).

`<Candidato>` = `Nome_Cognome` from the profile. `<Company>` = company name normalised PascalCase, no spaces or slashes (e.g. `Acme_Corp` → `AcmeCorp`).

## The 6 sections (fixed order, max 2 pages)

| # | Section            | Length        | Content                                                                                          |
|---|--------------------|---------------|--------------------------------------------------------------------------------------------------|
| 1 | **Header**         | 4-6 lines     | Name, role title aligned to the JD, contacts (email/phone/LinkedIn/GitHub), languages (CEFR)    |
| 2 | **About Me**       | 2-3 lines     | Concrete credibility. **NEVER** generic phrases ("passionate about", "results-driven")           |
| 3 | **Experience**     | 4-5 sub       | Each sub = one experience, mapped to **one specific JD requirement**. Bullets: metric + tech    |
| 4 | **Technical Skills** | 1 table     | Matches JD keywords. Only tech actually documented in the profile.                              |
| 5 | **Education**      | 2-4 lines     | Exact titles from the profile. Don't apologise for missing degrees.                              |
| 6 | **Side Projects**  | 0-3 sub       | Only if they reinforce the JD fit. Skip the section entirely if nothing fits.                   |

## Section 1 — Header

```markdown
# <Nome Cognome>
**<Role title aligned to the JD>** · <City, Country>
✉️ <email> · 📱 <phone> · 🔗 linkedin.com/in/<handle> · 💻 github.com/<handle>
🗣 <Lingua1 (level)>, <Lingua2 (level)>
```

Adapt the role title: if the JD says "Backend Engineer (Python)" use that, not the generic profile target. Stay truthful — never claim a seniority you don't have.

## Section 2 — About Me

2-3 lines. The user is a real person who has done real things; show that in 30-50 words. Banned phrases:

| ❌ Banned                              | ✅ Replace with                                              |
|----------------------------------------|--------------------------------------------------------------|
| "Passionate about <X>"                 | a fact: "5 years building <X> in production"                 |
| "Results-driven professional"          | a number: "Reduced p95 latency 320ms → 110ms across 3 services" |
| "Looking for an opportunity to grow"   | drop entirely; the application itself signals that          |
| "Detail-oriented team player"          | give an example or omit                                     |

## Section 3 — Experience

The hardest section. Each sub-block is **one experience** mapped to **one JD requirement**.

```markdown
### <Role> @ <Company> — <Mar 2022 – present>
- **Reduced cold-start time 4.2s → 0.8s** rewriting the bootstrap layer (Python, asyncio, uvloop)
- **Shipped 3 customer-facing data products** owning the full stack (FastAPI, Postgres, dbt, Airflow)
- **Mentored 2 junior backend engineers** through their first production incidents
```

Bullet rules:
- **Metric in bold** at the start (number, %, time, scale)
- **Tech in parens** at the end of the bullet
- **Action verb** as the first word (see banned/allowed list below)
- One line per bullet. If it wraps, you're cramming too much.
- 3-5 bullets per experience. Fewer = the experience looks thin; more = noise.

### Action verbs

| ✅ Use                                                | ❌ Banned                       |
|-------------------------------------------------------|---------------------------------|
| Built, Architected, Shipped, Engineered, Reduced,     | learned, studied, assisted,     |
| Migrated, Designed, Owned, Mentored, Scaled, Cut       | helped, was involved in,        |
|                                                       | participated in, was responsible for |

Banned verbs signal a junior/uncertain voice. Use the active list even when the role was junior — focus on what you *delivered*, not what you *did*.

## Section 4 — Technical Skills

A 2-column markdown table that mirrors the JD's keyword list. **Only tech the profile actually documents.** Inventing a tool you don't know is an instant fail in the Critic's review (and a real-world recruiter kill).

```markdown
| Area              | Stack                                                  |
|-------------------|--------------------------------------------------------|
| Languages         | Python, Go, Bash                                       |
| Backend           | FastAPI, Django, gRPC                                  |
| Data              | PostgreSQL, Redis, dbt, Airflow                        |
| Infra             | Docker, GitHub Actions, AWS (EC2, S3, RDS)             |
```

Categories should match what the JD emphasises. If the JD never mentions infra, drop or compress that row.

## Section 5 — Education

```markdown
### <Degree>, <Institution> — <Year>
<one-line note: GPA only if > 28/30 ≈ 3.5/4, thesis title only if relevant to the JD>
```

If the candidate has no degree:
- **Don't apologise** ("currently pursuing", "self-taught instead of"). Apologising signals weakness.
- List relevant certifications, bootcamps, online programs as their own entries.
- Lean on the Experience section to carry weight.

## Section 6 — Side Projects (optional)

Include ONLY if a project clearly reinforces the JD fit. Same bullet pattern as Experience.

```markdown
### <Project name> — <github link>
- **<metric / outcome>** (<tech stack>)
- One-line description of what it does and why it's relevant
```

If nothing fits, **skip the section entirely**. Empty padding signals lack of substance.

## Tone by company type (from JD signals)

| Company type | Tone                                          | Signals in JD                                                |
|--------------|-----------------------------------------------|--------------------------------------------------------------|
| Startup      | Confident, ownership-heavy, direct, action verbs first | "fast-paced", "wear many hats", "early-stage", small team size |
| Corporate    | Professional, structured, process-aware       | "stakeholders", "cross-functional", larger team, well-defined process |
| Fintech / regulated | Compliance-aware, precise, cite frameworks (PCI-DSS, SOC 2, ISO 27001) | mentions of audits, regulators, compliance teams       |
| Agency       | Versatile, client-facing, breadth over depth  | "varied projects", "client-facing", "delivery"              |

Don't overdo it — tone is a colour, not a costume. The bullets stay factual either way.

## Cover Letter (only if the JD asks)

Default: **don't write one**. Token + time saved. Write it ONLY if the JD explicitly mentions it ("please include a cover letter", "tell us why you want this role").

Length: 250-400 words. Path: `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<Company>.{md,pdf}`.

```markdown
Opening (direct, NOT "I am writing to express my interest"):
"I'm applying for <role> because <3-4 concrete proofs that match the JD>."

Middle (1-2 paragraphs):
- One specific past achievement that maps to the JD's main pain point
- One thing you noticed about the company that goes beyond their landing page

Close:
- One forward-looking line: what you'd want to do in the first 90 days
- "Happy to discuss this in more detail."
```

Banned in cover letters:
- "I am writing to express my interest…" → starts with effort and ends with nothing
- "Please find attached my CV…" → it's an application, of course it's attached
- "I would be honoured…" → corporate cliché

## PDF generation

```bash
pandoc "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md" \
       -o "$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.pdf" \
       --pdf-engine=typst
```

Verify the PDF opens cleanly (size > 0, page count ≤ 2) before invoking `critic-loop`.

## Hard rules

- **Zero invenzioni.** Every metric, every tech, every project must trace back to `candidate_profile.yml` or the user-provided sources. Inventing fails the Critic and is a fireable offense in real life. T10.
- **Tailor per JD.** The same candidate gets a different CV per role: different About, different Experience emphasis, different Skills order. Generic CVs fail the score gate.
- **One requirement → one experience block.** If the JD has 5 requirements and your Experience section maps to 2, you're not telling the right story.
- **Max 2 pages.** Recruiters skim. If page 3 exists, cut.

## Anti-patterns

- ❌ Generic About Me ("passionate developer with strong skills") — instant kill in the Critic's review.
- ❌ Skills table with tech not documented in the profile — invention, T10 violation.
- ❌ Apologising for missing degree / years — signals weakness.
- ❌ Same CV across multiple JDs — score gate punishes generic CVs.
- ❌ Cover letter when not asked — wasted tokens, longer review cycle, no value.
- ❌ More than 5 bullets per experience — recruiters skim, you lose the lead bullet's impact.

## See also

- `application-flow` — claim + path + UPSERT BEFORE you write a single line of CV.
- `critic-loop` — the 3-round blind review that follows. Apply its `Concrete Actions` between rounds.
- `agents/_team/team-rules.md` T10 (read-only profile) + T11 (deliverables in `$JHT_USER_DIR`).
- `agents/scrittore/scrittore.md` — the orchestrator prompt that calls this skill in the main loop.
