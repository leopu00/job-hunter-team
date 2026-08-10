# Database Schema — jobs.db (V6)

**Aggiornato**: 2026-05-29
**Schema version**: `PRAGMA user_version = 6`
**Cambio rispetto a V5**: aggiunte colonne `positions.write_requested` (INTEGER DEFAULT 0) e `positions.write_requested_at` (TIMESTAMP) per Writer-on-demand. L'utente seleziona dal dashboard web (button "Scrivi CV") o via Telegram (`/cv <id>`) le posizioni per cui vuole un CV; il Capitano spawna Scrittori on-demand solo quando il flag e' acceso. Migrazione idempotente via `_migrate_positions_write_requested()` (ALTER TABLE ADD COLUMN). Vedi BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) e mig Supabase 024.
**Cambio V4→V5**: aggiunta tabella `pending_user_messages` per il pattern fallback notifiche via cloud sync (decisione 2026-05-13 — Telegram down/non configurato ⇒ scrivi su DB ⇒ cloud sync ⇒ dashboard web). La migrazione e' non-distruttiva: `CREATE TABLE IF NOT EXISTS` + trigger touch_updated_at standard. DB pre-V5 si auto-aggiornano alla prima `ensure_schema()`.
**Cambio V3→V4**: aggiunte colonne `created_at` e `updated_at` uniformi su tutte le 5 tabelle dati, con `DEFAULT CURRENT_TIMESTAMP` (DB freschi) e trigger `touch_updated_at` (AFTER UPDATE) che mantiene `updated_at` aggiornato automaticamente ad ogni UPDATE. I campi domain (`scored_at`, `applied_at`, `written_at`, `analyzed_at`, `found_at`, `last_checked`) restano per event semantics. Migrazione retroattiva automatica via `_migrate_v3_to_v4()` in `shared/skills/_db.py`: ALTER TABLE ADD COLUMN (senza DEFAULT — limite SQLite) + UPDATE delle righe esistenti con i domain `*_at` come fallback (es. `created_at = COALESCE(found_at, CURRENT_TIMESTAMP)`).
**Cambio V2→V3**: aggiunto `CHECK` constraint su `positions.status`. Migrazione via `_migrate_v2_to_v3()`.
**Path**: `$JHT_HOME/jobs.db` (canonical) or `$JHT_DB=<file>`. Outside the container the repo copy `shared/data/jobs.db` must be ASKED for with `JHT_DB_FALLBACK=1`: with none of these set the module fails instead of guessing (O-26).
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
| logo | TEXT | | **mig 056** — data-URI base64 del logo (≤ ~35KB) — scrive SOLO `logo_fetch.py` |
| logo_source | TEXT | | **mig 056** — URL sorgente del logo (audit/refresh) |
| logo_fetched | INTEGER | 0 | **mig 056** — 1 = estrazione tentata (pattern office_geocoded); coda `next-for-logo-missing` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserimento riga |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — auto-touched ad ogni UPDATE via trigger |

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
| status | TEXT | new | new → checked → scored → writing → ready → applied → response · `excluded` da qualsiasi step. **V3: vincolato da `CHECK` constraint** — i valori non in questa lista vengono rigettati con `IntegrityError`. |
| notes | TEXT | | Note libere |
| last_checked | TIMESTAMP | | Ultima verifica link/JD |
| write_requested | INTEGER | 0 | **V6** — `1` = utente ha richiesto CV per questa posizione (via web button o `/cv` Telegram). Il Capitano polla questa colonna per spawnare Scrittori on-demand. |
| write_requested_at | TIMESTAMP | NULL | **V6** — quando l'utente ha richiesto il CV. Usato dal Capitano per FIFO ordering quando spawna Scrittori. |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserimento riga |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — auto-touched ad ogni UPDATE via trigger |

### position_highlights
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL | | Link a positions(id) |
| type | TEXT NOT NULL | | pro, con |
| text | TEXT NOT NULL | | Testo del pro/contro |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserimento riga |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — auto-touched ad ogni UPDATE via trigger |

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
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserimento riga |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — auto-touched ad ogni UPDATE via trigger |

> ⚠️ **Gate profilo (2026-07)**: `db_insert.py score` rifiuta l'INSERT se il profilo candidato è sostanzialmente assente (manca `candidate_profile.yml` o il suo `target_role` — vedi `shared/skills/profile_gate.py`). NON è un check di completezza: i profili parziali passano. Scorer: RULE-01 punto 0.

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
| status | TEXT | draft | draft (default) — il flag operativo è `applied` (BOOLEAN). Gli stati `review/approved` non sono attualmente popolati dagli agenti. |
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
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserimento riga |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — auto-touched ad ogni UPDATE via trigger |

### pending_user_messages

**V5** — coda notifiche utente con fallback su dashboard web quando Telegram non e' disponibile/configurato. Ogni agente che vuole parlare all'utente fa una INSERT qui PRIMA di tentare Telegram: se il send-Telegram riesce, l'agente aggiorna `delivered_via='telegram'`; se fallisce o Telegram non e' configurato, lascia `delivered_via='web'` e la riga viene sincronizzata su Supabase via `jht cloud push` → la dashboard web la presenta all'utente. La risposta utente via web torna nelle colonne `user_reply`/`user_reply_at`; al tick successivo l'agente vede il marker e risponde via lo stesso canale.

| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER | PK AUTOINCREMENT | |
| agent | TEXT | NOT NULL | Chi scrive: `capitano`, `mentor`, `assistente`, ... |
| body | TEXT | NOT NULL | Testo messaggio (markdown ammesso) |
| kind | TEXT | 'notification' | `notification` / `question` / `digest` / `alert` |
| related_position_id | INTEGER | FK positions(id) | Opzionale — per notifiche legate a un'offerta |
| delivered_via | TEXT | NULL | `telegram` (consegnato via bot) / `web` (in attesa su dashboard) / NULL (in coda) |
| delivered_at | TIMESTAMP | | Quando consegnato sul canale scelto |
| acknowledged_at | TIMESTAMP | | Utente ha letto/dismisso via dashboard |
| user_reply | TEXT | | Risposta utente via dashboard web (opzionale) |
| user_reply_at | TIMESTAMP | | Quando l'utente ha risposto |
| agent_seen_reply_at | TIMESTAMP | | Quando l'agente ha visto la risposta — usato dal marker prompt-injection per evitare doppi processi |
| cloud_synced_at | TIMESTAMP | | Settato da `jht cloud push` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | Auto-touched ad ogni UPDATE via trigger |

---

## Indici

| Nome | Tabella | Colonne |
|------|---------|---------|
| idx_positions_status | positions | status |
| idx_positions_company | positions | company |
| idx_positions_company_id | positions | company_id |
| idx_positions_url | positions | url |
| idx_positions_write_requested | positions | write_requested (partial WHERE = 1) |
| idx_scores_total | scores | total_score |
| idx_applications_status | applications | status |
| idx_pending_user_messages_agent | pending_user_messages | agent |
| idx_pending_user_messages_delivery | pending_user_messages | delivered_via, acknowledged_at |
| idx_pending_user_messages_unseen_reply | pending_user_messages | user_reply_at, agent_seen_reply_at |

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
python3 shared/skills/db_query.py next-for-critico             # ⚠️ legacy — il Critico oggi viene spawnato dallo Scrittore, non pulla dalla coda
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

### Sync (storage cloud opt-in)
```bash
python3 shared/skills/db_to_sheets.py sync            # DB → Google Sheets
python3 shared/skills/db_to_sheets.py sync --dry-run  # Preview senza scrivere

python3 shared/skills/db_to_supabase.py sync          # DB → Supabase (mirror read-only)
python3 shared/skills/db_to_supabase.py sync --dry-run

python3 shared/skills/db_to_drive.py sync             # CV/CL PDF → Google Drive
python3 shared/skills/db_to_drive.py sync --dry-run
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
new → checked → scored → writing → ready → applied → response
  │       │         │         │       │
  ▼       ▼         ▼         ▼       ▼
        excluded (link morto, non qualificato, score < 40, critic_score < 5, ecc.)
```

**Stato per fase:**
- `new` — Scout ha appena inserito (Phase 1)
- `checked` — Analista ha verificato e promosso (Phase 2) · `excluded` se [LINK_MORTO/SCAM/GEO/LINGUA/SENIORITY/STACK]
- `scored` — Scorer ha assegnato punteggio (Phase 3) · `excluded` se score < 40
- `writing` — Scrittore l'ha presa in carico (Phase 4) — claim peer-coordinated
- `ready` — Round 3 del Critico ha dato score ≥ 5 (Phase 4) · `excluded` se score < 5
- `applied` — l'utente ha confermato l'invio (Phase 5) — manuale, mai dal team
- `response` — risposta ricevuta (interview/rejection/ghosted) — flag user-tracked
