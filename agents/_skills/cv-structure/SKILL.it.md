<!-- @translation: it, ai-translated 2026-06-06 -->
---
name: cv-structure
description: Scrivi il markdown del CV che verrà trasformato in PDF e revisionato dal Critico. Sei sezioni fisse, massimo 2 pagine, ogni affermazione tracciabile a `candidate_profile.yml` (zero invenzioni — T10). I bullet seguono il pattern "metrica in grassetto + tech tra parentesi"; il tono corrisponde al tipo di azienda del JD (startup/corporate/fintech); Cover Letter solo se il JD la chiede esplicitamente. Responsabilità dello Scrittore. Abbina con `application-flow` (claim + path) e `critic-loop` (iterazioni di revisione).
allowed-tools: Bash(pandoc *)
---

# cv-structure — il layout canonico del CV

L'output va in `$JHT_USER_DIR/cv/CV_<Candidato>_<Company>.md` (poi PDF via pandoc/typst). Regola path: skill `application-flow` — mai scrivere il CV finale sotto `$JHT_AGENT_DIR` (quello è solo scratch, T11).

`<Candidato>` = `Nome_Cognome` dal profilo. `<Company>` = nome azienda normalizzato PascalCase, senza spazi o slash (es. `Acme_Corp` → `AcmeCorp`).

## Le 6 sezioni (ordine fisso, massimo 2 pagine)

| # | Sezione            | Lunghezza     | Contenuto                                                                                        |
|---|--------------------|---------------|--------------------------------------------------------------------------------------------------|
| 1 | **Intestazione**   | 4-6 righe     | Nome, titolo ruolo allineato al JD, contatti (email/telefono/LinkedIn/GitHub), lingue (CEFR)    |
| 2 | **Chi sono**       | 2-3 righe     | Credibilità concreta. **MAI** frasi generiche ("appassionato di", "orientato ai risultati")      |
| 3 | **Esperienza**     | 4-5 sotto     | Ogni sotto-blocco = un'esperienza, mappata a **un requisito specifico del JD**. Bullet: metrica + tech |
| 4 | **Competenze Tecniche** | 1 tabella | Corrisponde alle keyword del JD. Solo tech effettivamente documentata nel profilo.               |
| 5 | **Formazione**     | 2-4 righe     | Titoli esatti dal profilo. Non scusarti per titoli mancanti.                                     |
| 6 | **Progetti Personali** | 0-3 sotto | Solo se rafforzano il fit con il JD. Salta la sezione interamente se nulla si adatta.           |

## Sezione 1 — Intestazione

```markdown
# <Nome Cognome>
**<Titolo ruolo allineato al JD>** · <Città, Paese>
✉️ <email> · 📱 <telefono> · 🔗 linkedin.com/in/<handle> · 💻 github.com/<handle>
🗣 <Lingua1 (livello)>, <Lingua2 (livello)>
```

Adatta il titolo del ruolo: se il JD dice "Backend Engineer (Python)" usa quello, non il target generico del profilo. Resta veritiero — mai dichiarare una seniority che non hai.

## Sezione 2 — Chi sono

2-3 righe. L'utente è una persona reale che ha fatto cose reali; mostralo in 30-50 parole. Frasi vietate:

| ❌ Vietate                             | ✅ Sostituisci con                                           |
|----------------------------------------|--------------------------------------------------------------|
| "Appassionato di <X>"                  | un fatto: "5 anni di costruzione di <X> in produzione"       |
| "Professionista orientato ai risultati"| un numero: "Ridotto p95 latenza 320ms → 110ms su 3 servizi"  |
| "Alla ricerca di un'opportunità di crescita" | elimina del tutto; la candidatura stessa lo segnala    |
| "Team player attento ai dettagli"      | dai un esempio o ometti                                      |

## Sezione 3 — Esperienza

La sezione più difficile. Ogni sotto-blocco è **un'esperienza** mappata a **un requisito del JD**.

```markdown
### <Ruolo> @ <Azienda> — <Mar 2022 – presente>
- **Ridotto tempo di cold-start 4.2s → 0.8s** riscrivendo il layer di bootstrap (Python, asyncio, uvloop)
- **Rilasciati 3 prodotti dati customer-facing** gestendo il full stack (FastAPI, Postgres, dbt, Airflow)
- **Formati 2 ingegneri backend junior** attraverso i loro primi incidenti in produzione
```

Regole per i bullet:
- **Metrica in grassetto** all'inizio (numero, %, tempo, scala)
- **Tech tra parentesi** alla fine del bullet
- **Verbo d'azione** come prima parola (vedi lista vietati/consentiti sotto)
- Una riga per bullet. Se va a capo, stai comprimendo troppo.
- 3-5 bullet per esperienza. Meno = l'esperienza sembra sottile; di più = rumore.

### Verbi d'azione

| ✅ Usa                                                | ❌ Vietati                      |
|-------------------------------------------------------|---------------------------------|
| Costruito, Architettato, Rilasciato, Ingegnerizzato,  | imparato, studiato, assistito,  |
| Ridotto, Migrato, Progettato, Gestito, Formato,       | aiutato, coinvolto in,          |
| Scalato, Tagliato                                     | partecipato a, responsabile di  |

I verbi vietati segnalano una voce junior/incerta. Usa la lista attiva anche quando il ruolo era junior — concentrati su ciò che hai *consegnato*, non su ciò che hai *fatto*.

## Sezione 4 — Competenze Tecniche

Una tabella markdown a 2 colonne che rispecchia la lista keyword del JD. **Solo tech che il profilo effettivamente documenta.** Inventare un tool che non conosci è un fallimento istantaneo nella revisione del Critico (e un kill in un reclutamento reale).

```markdown
| Area              | Stack                                                  |
|-------------------|--------------------------------------------------------|
| Linguaggi         | Python, Go, Bash                                       |
| Backend           | FastAPI, Django, gRPC                                  |
| Dati              | PostgreSQL, Redis, dbt, Airflow                        |
| Infra             | Docker, GitHub Actions, AWS (EC2, S3, RDS)             |
```

Le categorie devono corrispondere a ciò che il JD enfatizza. Se il JD non menziona mai l'infra, elimina o comprimi quella riga.

## Sezione 5 — Formazione

```markdown
### <Titolo>, <Istituto> — <Anno>
<nota di una riga: GPA solo se > 28/30 ≈ 3.5/4, titolo tesi solo se rilevante per il JD>
```

Se il candidato non ha una laurea:
- **Non scusarti** ("attualmente in corso", "autodidatta al posto di"). Scusarsi segnala debolezza.
- Elenca certificazioni pertinenti, bootcamp, programmi online come voci a sé.
- Appoggiati sulla sezione Esperienza per portare peso.

## Sezione 6 — Progetti Personali (opzionale)

Includi SOLO se un progetto rafforza chiaramente il fit con il JD. Stesso pattern bullet dell'Esperienza.

```markdown
### <Nome progetto> — <link github>
- **<metrica / risultato>** (<stack tecnico>)
- Descrizione di una riga di cosa fa e perché è rilevante
```

Se nulla si adatta, **salta la sezione interamente**. Il padding vuoto segnala mancanza di sostanza.

## Tono per tipo di azienda (dai segnali del JD)

| Tipo azienda   | Tono                                          | Segnali nel JD                                                |
|----------------|-----------------------------------------------|--------------------------------------------------------------|
| Startup        | Sicuro, ownership-heavy, diretto, verbi d'azione prima | "fast-paced", "wear many hats", "early-stage", team piccolo  |
| Corporate      | Professionale, strutturato, process-aware     | "stakeholder", "cross-funzionale", team più grande, processo ben definito |
| Fintech / regolamentato | Compliance-aware, preciso, cita framework (PCI-DSS, SOC 2, ISO 27001) | menzioni di audit, regolatori, team compliance       |
| Agenzia        | Versatile, client-facing, ampiezza sopra profondità | "progetti vari", "client-facing", "delivery"               |

Non esagerare — il tono è un colore, non un costume. I bullet restano fattuali in ogni caso.

## Cover Letter (solo se il JD la chiede)

Default: **non scriverla**. Token + tempo risparmiati. Scrivila SOLO se il JD la menziona esplicitamente ("please include a cover letter", "tell us why you want this role").

Lunghezza: 250-400 parole. Path: `$JHT_USER_DIR/allegati/CoverLetter_<Candidato>_<Company>.{md,pdf}`.

```markdown
Apertura (diretta, NON "Scrivo per esprimere il mio interesse"):
"Mi candido per <ruolo> perché <3-4 prove concrete che corrispondono al JD>."

Corpo (1-2 paragrafi):
- Un achievement specifico passato che mappa al pain point principale del JD
- Una cosa che hai notato sull'azienda che va oltre la loro landing page

Chiusura:
- Una riga proiettata: cosa vorresti fare nei primi 90 giorni
- "Disponibile ad approfondire."
```

Vietati nelle cover letter:
- "Scrivo per esprimere il mio interesse…" → inizia con lo sforzo e finisce con nulla
- "In allegato troverà il mio CV…" → è una candidatura, ovvio che è allegato
- "Sarebbe un onore…" → cliché aziendale

## Generazione PDF — engine + scrittura atomica + DB UPDATE (W-03, bug #26)

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

L'anti-pattern storico: generare il PDF direttamente in
`$JHT_USER_DIR/cv/`, poi eseguire `db_update.py application --cv-pdf-path
...` separatamente. Se la Sentinella killava lo Scrittore tra i due
step (EMERGENZA freeze 2026-05-17 04:43), il PDF restava su disco ma
il DB aveva `cv_pdf_path=NULL`. Sisal 7.5/10 PASS diventava *"CV da
scrivere"* sulla dashboard per l'utente — opportunità top invisibile.

Fix: tempfile + gate dimensione + mv atomico + UPDATE singolo. Se
l'UPDATE fallisce, rimuovi il file finale per non lasciare un orfano.

```bash
# Il nome file finale include position_id così 2 aperture @ stessa azienda non collidono (bug #25)
SRC_MD="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.md"
FINAL_PDF="$JHT_USER_DIR/cv/CV_${CANDIDATO}_${POSITION_ID}_${COMPANY_SLUG}_${TITLE_SLUG}.pdf"
TMP_PDF="$(mktemp -t cv_${POSITION_ID}.XXXXXX.pdf)"

# ── PREFLIGHT ─────────────────────────────────────────────────────────
# Verifica esplicita che l'engine sia disponibile PRIMA di pandoc.
# Senza, in caso di skill obsoleta (typst che non c'è, pandoc 3.x che
# manca, …) lo Scrittore eseguiva il comando, falliva, improvvisava
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

# ── GATE POST-RENDER: dimensione + Producer ──────────────────────────
# DUE check obbligatori. NESSUNO dei due è opzionale.
#
# Check A) dimensione: < 20 KB indica engine sbagliato (fpdf2 ~22 KB ma 1 pag
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

# 3. Mv atomico + UPDATE in sequenza; rollback se UPDATE fallisce
mv "$TMP_PDF" "$FINAL_PDF"
if ! python3 /app/shared/skills/db_update.py application "$POSITION_ID" \
        --cv-pdf-path "$FINAL_PDF" --written-at now; then
  echo "[cv-structure] UPDATE DB fallita, rimuovo PDF per non lasciare orfani"
  rm -f "$FINAL_PDF"
  exit 1
fi
```

Codici di uscita:
- `0` → CV OK, DB aggiornato, pronto per critic-loop
- `2` → preflight FAIL (engine non disponibile) — segnala al Capitano
- `3` → post-render FAIL (dimensione < 20 KB, output minimalista) — engine sbagliato
- `4` → post-render FAIL (Producer != Qt) — engine sbagliato
- `1` → DB UPDATE FAIL (rollback file)

Il Dottore via `cv-disk-audit` healthcheck (bug #18) ricollega eventuali
orfani disco↔DB; in più ora segnala anche i CV con Producer non-Qt come
"engine sbagliato — rigenerare".

## Gate status pre-generazione (W-04, bug #26)

Prima di eseguire pandoc, verifica che la posizione sia ancora di grado scoring.
A volte l'Analista marca `excluded` *dopo* che lo Scrittore ha reclamato
la posizione (race condition) e lo Scrittore continua a scrivere — 3 CV
sprecati su Canonical ContainerImages / K8s / Deloitte nei dump del
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

## Regole ferree

- **Zero invenzioni.** Ogni metrica, ogni tech, ogni progetto deve essere tracciabile a `candidate_profile.yml` o alle fonti fornite dall'utente. Inventare fallisce la revisione del Critico ed è motivo di licenziamento nella vita reale. T10.
- **Personalizza per JD.** Lo stesso candidato riceve un CV diverso per ogni ruolo: Chi sono diverso, enfasi Esperienza diversa, ordine Competenze diverso. CV generici falliscono il gate di punteggio.
- **Un requisito → un blocco esperienza.** Se il JD ha 5 requisiti e la tua sezione Esperienza ne mappa 2, non stai raccontando la storia giusta.
- **Massimo 2 pagine.** I recruiter scansionano. Se esiste la pagina 3, taglia.

## Anti-pattern

- ❌ Chi sono generico ("sviluppatore appassionato con forti competenze") — kill istantaneo nella revisione del Critico.
- ❌ Tabella competenze con tech non documentata nel profilo — invenzione, violazione T10.
- ❌ Scusarsi per laurea / anni mancanti — segnala debolezza.
- ❌ Stesso CV su più JD — il gate di punteggio penalizza i CV generici.
- ❌ Cover letter quando non richiesta — token sprecati, ciclo di revisione più lungo, nessun valore.
- ❌ Più di 5 bullet per esperienza — i recruiter scansionano, perdi l'impatto del bullet in testa.

## Vedi anche

- `application-flow` — claim + path + UPSERT PRIMA di scrivere una singola riga di CV.
- `critic-loop` — la revisione cieca a 3 round che segue. Applica le sue `Azioni Concrete` tra i round.
- `agents/_team/team-rules.md` T10 (profilo read-only) + T11 (deliverable in `$JHT_USER_DIR`).
- `agents/scrittore/scrittore.md` — il prompt orchestratore che chiama questa skill nel loop principale.
