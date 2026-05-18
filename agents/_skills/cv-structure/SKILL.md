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
| 6 | **Side Companys**  | 0-3 sub       | Only if they reinforce the JD fit. Skip the section entirely if nothing fits.                   |

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

## Section 6 — Side Companys (optional)

Include ONLY if a project clearly reinforces the JD fit. Same bullet pattern as Experience.

```markdown
### <Company name> — <github link>
- **<metric / outcome>** (<tech stack>)
- One-line description of what it does and why it's relevant
```

If nothing fits, **skip the section entirely**. Empty padding signals lack of substance.

## Tone by company type (from JD signals)

| Company type | Tone                                          | Signals in JD                                                |
|--------------|-----------------------------------------------|--------------------------------------------------------------|
| Startup      | Confident, ownership-heavy, direct, action verbs first | "fast-paced", "wear many hats", "early-stage", small team size |
| Corporate    | Company, structured, process-aware       | "stakeholders", "cross-functional", larger team, well-defined process |
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

## PDF generation — engine + atomic write + DB UPDATE (W-03, bug #26)

### Engine: `wkhtmltopdf` (NON typst, NON fpdf2)

Decisione tecnica 2026-05-18 dopo indagine "CV estetica semplificata":

- **`wkhtmltopdf 0.12.6` (Qt 5.15.8)** → engine ufficiale, già installato
  nel container. Produce CV professionali HTML+CSS, 2 pagine, ~30 KB
  (output identico ai CV "belli" del 16 maggio).
- ❌ **NON usare `--pdf-engine=typst`**: typst non è disponibile in
  pandoc 2.17 del container (richiederebbe pandoc 3.x). Errore
  storico nella skill, segnalato 2026-05-18.
- ❌ **NON usare `pdf_gen.py` (fpdf2)** per CV: è solo fallback
  minimalista 80% casi semplici. Per CV user-facing produce layout
  spartano 1 pagina, niente CSS, niente spacing fine.

The historical anti-pattern: generate the PDF straight into
`$JHT_USER_DIR/cv/`, then run `db_update.py application --cv-pdf-path
...` separately. If the Sentinel killed the Writer between the two
steps (EMERGENZA freeze 2026-05-17 04:43), the PDF stayed on disk but
the DB had `cv_pdf_path=NULL`. Sisal 7.5/10 PASS became *"CV da
scrivere"* on the dashboard for the user — invisible top opportunity.

Fix: tempfile + size gate + atomic mv + single-shot UPDATE. If the
UPDATE fails, remove the final file so we don't leave an orphan.

```bash
# Final filename includes position_id so 2 openings @ same company don't collide (bug #25)
SRC_MD="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.md"
FINAL_PDF="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.pdf"
TMP_PDF="$(mktemp -t cv_${POSITION_ID}.XXXXXX.pdf)"

# ── PREFLIGHT ─────────────────────────────────────────────────────────
# Verifica esplicita che l'engine sia disponibile PRIMA di pandoc.
# Senza, in caso di skill obsoleta (typst che non c'è, pandoc 3.x che
# manca, …) lo Scrittore eseguiva il comando, fallba, improvvisava
# fallback random → CV brutti del 2026-05-18 mattina.
if ! command -v wkhtmltopdf >/dev/null 2>&1; then
  echo "[cv-structure] ABORT preflight: wkhtmltopdf non disponibile."
  echo "  Engine alternativi accettabili: weasyprint (pandoc --pdf-engine=weasyprint)."
  echo "  NEVER fallback a pdf_gen.py / fpdf2 per CV (output brutto)."
  echo "  Riportare il problema al Capitano via [REPORT] e ABORT."
  exit 2
fi

# 1. Render via pandoc → html → wkhtmltopdf (engine vincente, 32 KB / 2 pag).
#    --metadata title=... evita il warning di wkhtmltopdf "no title element".
pandoc "$SRC_MD" -o "$TMP_PDF" \
       --pdf-engine=wkhtmltopdf \
       --metadata title="CV $CANDIDATO"

# ── GATE POST-RENDER: size + Producer ─────────────────────────────────
# DUE check obbligatori. NESSUNO dei due è opzionale.
#
# Check A) size: < 20 KB indica engine sbagliato (fpdf2 ~22 KB ma 1 pag
# spartana, wkhtmltopdf ≥30 KB con HTML+CSS pieno). Soglia 20 KB OK per
# distinguere.
size=$(stat -c%s "$TMP_PDF" 2>/dev/null || stat -f%z "$TMP_PDF")
if [ ! -s "$TMP_PDF" ] || [ "$size" -lt 20000 ]; then
  echo "[cv-structure] ABORT post-render: PDF $size B sospetto (atteso ≥20 KB)."
  echo "  Probabile engine sbagliato (fpdf2 minimalista invece di wkhtmltopdf)."
  rm -f "$TMP_PDF"
  exit 3
fi

# Check B) Producer: deve essere wkhtmltopdf (= 'Qt 5.15.8' o simile).
# Se è 'fpdf2' / vuoto / '?', l'engine NON era wkhtmltopdf — il PDF
# uscirà comunque ma sarà brutto. ABORT loud così il Capitano vede.
producer=$(python3 -c "
from pypdf import PdfReader
import sys
try:
    r = PdfReader('$TMP_PDF')
    m = r.metadata or {}
    print(m.get('/Producer', ''))
except Exception as e:
    print('?'); sys.exit(1)
" 2>/dev/null)
case "$producer" in
  *Qt*)
    : # OK, wkhtmltopdf ha lavorato
    ;;
  *)
    echo "[cv-structure] ABORT post-render: Producer='$producer' (atteso 'Qt 5.x.x')."
    echo "  L'engine reale NON era wkhtmltopdf — output non professionale."
    rm -f "$TMP_PDF"
    exit 4
    ;;
esac

# 3. Atomic move + UPDATE in sequence; rollback se UPDATE fallisce
mv "$TMP_PDF" "$FINAL_PDF"
if ! python3 /app/shared/skills/db_update.py application "$POSITION_ID" \
        --cv-pdf-path "$FINAL_PDF" --written-at now; then
  echo "[cv-structure] UPDATE DB fallita, rimuovo PDF per non lasciare orfani"
  rm -f "$FINAL_PDF"
  exit 1
fi
```

Exit codes:
- `0` → CV OK, DB aggiornato, pronto per critic-loop
- `2` → preflight FAIL (engine non disponibile) — segnala al Capitano
- `3` → post-render FAIL (size < 20 KB, output minimalista) — engine sbagliato
- `4` → post-render FAIL (Producer != Qt) — engine sbagliato
- `1` → DB UPDATE FAIL (rollback file)

Il Dottore via `cv-disk-audit` healthcheck (bug #18) ricollega eventuali
orfani disk↔DB; in più ora segnala anche i CV con Producer non-Qt come
"engine sbagliato — rigenerare".

## Pre-generation status gate (W-04, bug #26)

Before running pandoc, verify the position is still scoring-grade.
Sometimes the Analyst marks `excluded` *after* the Writer has claimed
the position (race condition) and the Writer keeps writing — 3 CV
sprecati su Company 033 ContainerImages / K8s / Deloitte nei dump del
2026-05-17.

```bash
status=$(python3 /app/shared/skills/db_query.py position "$POSITION_ID" --field status)
case "$status" in
  excluded|rejected)
    echo "[cv-structure] position #$POSITION_ID is $status, skipping CV generation"
    exit 0
    ;;
esac
```

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
- ❌ Company than 5 bullets per experience — recruiters skim, you lose the lead bullet's impact.

## See also

- `application-flow` — claim + path + UPSERT BEFORE you write a single line of CV.
- `critic-loop` — the 3-round blind review that follows. Apply its `Concrete Actions` between rounds.
- `agents/_team/team-rules.md` T10 (read-only profile) + T11 (deliverables in `$JHT_USER_DIR`).
- `agents/scrittore/scrittore.md` — the orchestrator prompt that calls this skill in the main loop.
