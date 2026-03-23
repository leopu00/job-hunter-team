# Database Schema — jobs.db (V2)

**Aggiornato**: 2026-02-28
**Schema version**: `PRAGMA user_version = 2`
**Path**: `shared/data/jobs.db`
**Skill scripts**: `shared/skills/`

Questo file e' il RIFERIMENTO UFFICIALE per lo schema del database. Tutti gli agenti devono leggere QUESTO file per conoscere la struttura delle tabelle e i comandi disponibili.

---

## Tabelle

### companies
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| name | TEXT NOT NULL UNIQUE | | Nome azienda (chiave di match) |
| website | TEXT | | URL sito aziendale |
| hq_country | TEXT | | Paese sede principale |
| sector | TEXT | | Settore (fintech, ai, etc.) |
| size | TEXT | | Dimensione (startup, PMI, enterprise) |
| glassdoor_rating | REAL | | Rating Glassdoor |
| red_flags | TEXT | | Red flags trovate |
| culture_notes | TEXT | | Note sulla cultura aziendale |
| analyzed_by | TEXT | | Chi l'ha analizzata (analista-1, etc.) |
| analyzed_at | TIMESTAMP | CURRENT_TIMESTAMP | Quando analizzata |
| verdict | TEXT | | GO, CAUTIOUS, NO_GO |

### positions
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| title | TEXT NOT NULL | | Titolo posizione |
| company | TEXT NOT NULL | | Nome azienda (testo) |
| company_id | INTEGER FK | NULL | Link a companies(id) — auto-risolto |
| location | TEXT | | Location unificata (Remote EU, London, etc.) |
| remote_type | TEXT | | full_remote, hybrid, onsite |
| salary_declared_min | INTEGER | | Stipendio dichiarato nella JD — min |
| salary_declared_max | INTEGER | | Stipendio dichiarato nella JD — max |
| salary_declared_currency | TEXT | EUR | Valuta stipendio dichiarato |
| salary_estimated_min | INTEGER | | Stipendio stimato — min |
| salary_estimated_max | INTEGER | | Stipendio stimato — max |
| salary_estimated_currency | TEXT | EUR | Valuta stipendio stimato |
| salary_estimated_source | TEXT | | Fonte stima: glassdoor, levels.fyi, manual |
| url | TEXT | | URL della job description |
| source | TEXT | | linkedin, indeed, glassdoor, dynamite, etc. |
| jd_text | TEXT | | Testo COMPLETO della job description |
| requirements | TEXT | | Requirements estratti dalla JD |
| found_by | TEXT | | Chi l'ha trovata (scout-1, etc.) |
| found_at | TIMESTAMP | CURRENT_TIMESTAMP | Quando trovata |
| deadline | TEXT | | Scadenza (YYYY-MM-DD o "non presente") |
| status | TEXT | new | new, checked, excluded, scored, writing, review, ready, applied, response |
| notes | TEXT | | Note libere |
| last_checked | TIMESTAMP | | Ultima verifica link/JD |

### position_highlights
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL | | Link a positions(id) |
| type | TEXT NOT NULL | | pro, con |
| text | TEXT NOT NULL | | Testo del pro/contro |

### scores
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Link a positions(id) |
| total_score | INTEGER NOT NULL | | Punteggio totale 0-100 |
| stack_match | INTEGER | | Sub-score stack /40 |
| remote_fit | INTEGER | | Sub-score remote /25 |
| salary_fit | INTEGER | | Sub-score stipendio /20 |
| experience_fit | INTEGER | | Sub-score esperienza |
| strategic_fit | INTEGER | | Sub-score strategico /15 |
| breakdown | TEXT | | Dettaglio punteggio |
| notes | TEXT | | Note scorer |
| scored_by | TEXT | | Chi ha dato il punteggio |
| scored_at | TIMESTAMP | CURRENT_TIMESTAMP | Quando scored |

### applications
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Link a positions(id) |
| cv_path | TEXT | | Path CV markdown |
| cl_path | TEXT | | Path cover letter markdown |
| cv_pdf_path | TEXT | | Path CV PDF |
| cl_pdf_path | TEXT | | Path cover letter PDF |
| critic_verdict | TEXT | | PASS, NEEDS_WORK, REJECT |
| critic_score | REAL | | Voto critico (1-10) |
| critic_notes | TEXT | | Note del critico |
| status | TEXT | draft | draft, review, approved, applied, response |
| written_at | TIMESTAMP | | Quando il CV e' stato creato |
| applied_at | TIMESTAMP | | Quando la candidatura e' stata inviata |
| applied_via | TEXT | | Dove inviata (linkedin, sito, etc.) |
| response | TEXT | | Risposta ricevuta |
| response_at | TIMESTAMP | | Quando e' arrivata la risposta |
| written_by | TEXT | | Chi ha scritto (scrittore-1, etc.) |
| reviewed_by | TEXT | | Chi ha fatto review |
| critic_reviewed_at | TIMESTAMP | | Auto-settato con --critic-score |
| applied | BOOLEAN | 0 | TRUE se l'utente ha inviato |
| interview_round | INTEGER | NULL | Fase colloquio (1, 2, 3...) |
| cv_drive_id | TEXT | | Google Drive file ID del CV PDF |
| cl_drive_id | TEXT | | Google Drive file ID della CL PDF |

---

## Indici

| Nome | Tabella | Colonne |
|------|---------|---------|
| idx_positions_status | positions | status |
| idx_positions_company | positions | company |
| idx_positions_company_id | positions | company_id |
| idx_positions_url | positions | url |
| idx_scores_total | scores | total_score |
| idx_applications_status | applications | status |

---

## Comandi CLI

### Query
```bash
python3 shared/skills/db_query.py dashboard                    # Dashboard completa
python3 shared/skills/db_query.py stats                        # Conteggi tabelle
python3 shared/skills/db_query.py positions --status new       # Filtra per stato
python3 shared/skills/db_query.py positions --min-score 70     # Filtra per score
python3 shared/skills/db_query.py position 42                  # Dettaglio singola
python3 shared/skills/db_query.py companies --verdict GO       # Aziende per verdict
python3 shared/skills/db_query.py company "Azienda"            # Dettaglio azienda
python3 shared/skills/db_query.py check-url 4361788825         # Check duplicati
python3 shared/skills/db_query.py next-for-scorer              # Coda scorer
python3 shared/skills/db_query.py next-for-scrittore           # Coda scrittore
python3 shared/skills/db_query.py next-for-critico             # Coda critico
```

### Insert
```bash
# Posizione (Scout)
python3 shared/skills/db_insert.py position \
  --title "Python Developer" --company "Azienda" \
  --location "Remote EU" --remote-type full_remote \
  --salary-declared-min 40000 --salary-declared-max 65000 \
  --url "https://..." --source linkedin --found-by scout-1 \
  --jd-text "TESTO COMPLETO JD" --requirements "Python, Flask"

# Azienda (Analista)
python3 shared/skills/db_insert.py company \
  --name "Azienda" --hq-country "Italia" --sector "fintech" \
  --verdict GO --analyzed-by analista-1

# Score (Scorer)
python3 shared/skills/db_insert.py score \
  --position-id 42 --total 85 --stack-match 35 --remote-fit 20 \
  --salary-fit 15 --experience-fit 5 --strategic-fit 10 --scored-by scorer

# Application (Scrittore)
python3 shared/skills/db_insert.py application \
  --position-id 42 --cv-path "..." --cl-path "..." \
  --cv-pdf-path "..." --cl-pdf-path "..." \
  --written-by scrittore-1 --written-at now

# Highlight (Analista/Scorer)
python3 shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack identico"
```

### Update
```bash
# Stato posizione
python3 shared/skills/db_update.py position 42 --status checked

# Salary dichiarato
python3 shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Salary stimato
python3 shared/skills/db_update.py position 42 \
  --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Last checked (OBBLIGATORIO dopo verifica link)
python3 shared/skills/db_update.py position 42 --last-checked now

# Voto critico (critic_reviewed_at si setta automaticamente)
python3 shared/skills/db_update.py application 42 \
  --critic-verdict PASS --critic-score 8.5 --critic-notes "note"

# Applied (applied=1 si setta automaticamente con --applied-at)
python3 shared/skills/db_update.py application 42 \
  --applied-at "2026-02-28" --applied-via linkedin

# Risposta
python3 shared/skills/db_update.py application 42 \
  --response "rejected" --response-at now

# Fase colloquio (1=prima intervista, 2=seconda, etc.)
python3 shared/skills/db_update.py application 42 --interview-round 1
```

### Sync
```bash
python3 shared/skills/db_to_sheets.py sync           # Sync DB → Google Sheets
python3 shared/skills/db_to_sheets.py sync --dry-run  # Preview senza scrivere
```

### Migrazione
```bash
python3 shared/skills/db_migrate_v2.py --verify       # Verifica integrita'
```

---

## Comportamenti automatici

| Azione | Effetto automatico |
|--------|-------------------|
| `--critic-score X` | Setta `critic_reviewed_at = NOW` |
| `--applied-at "..."` | Setta `applied = 1` |
| Insert position con `--company "X"` | Auto-resolve `company_id` da companies |
| Update position con `--company "X"` | Auto-resolve `company_id` da companies |

---

## Pipeline degli stati

```
new → checked → scored → writing → review → ready → applied → response
                    ↘ excluded (link morto, non qualificati, etc.)
```
