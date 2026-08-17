<!-- @translation: it, ai-translated 2026-06-06 -->
# Schema del Database — jobs.db (V6)

**Aggiornato**: 2026-05-29
**Versione schema**: `PRAGMA user_version = 6`
**Modifiche rispetto a V5**: aggiunte colonne `positions.write_requested` (INTEGER DEFAULT 0) e `positions.write_requested_at` (TIMESTAMP) per Writer-on-demand. L'utente seleziona dalla dashboard web (pulsante "Scrivi CV") o via Telegram (`/cv <id>`) le posizioni per cui vuole un CV; il Capitano genera Scrittori on-demand solo quando il flag è attivo. Migrazione idempotente tramite `_migrate_positions_write_requested()` (ALTER TABLE ADD COLUMN). Vedi BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) e mig Supabase 024.
**Modifiche V4→V5**: aggiunta tabella `pending_user_messages` per il pattern fallback notifiche via cloud sync (decisione 2026-05-13 — Telegram down/non configurato ⇒ scrivi su DB ⇒ cloud sync ⇒ dashboard web). La migrazione è non distruttiva: `CREATE TABLE IF NOT EXISTS` + trigger touch_updated_at standard. I DB pre-V5 si auto-aggiornano alla prima `ensure_schema()`.
**Modifiche V3→V4**: aggiunte colonne `created_at` e `updated_at` uniformi su tutte le 5 tabelle dati, con `DEFAULT CURRENT_TIMESTAMP` (DB nuovi) e trigger `touch_updated_at` (AFTER UPDATE) che mantiene `updated_at` aggiornato automaticamente ad ogni UPDATE. I campi di dominio (`scored_at`, `applied_at`, `written_at`, `analyzed_at`, `found_at`, `last_checked`) restano per la semantica degli eventi. Migrazione retroattiva automatica tramite `_migrate_v3_to_v4()` in `shared/skills/_db.py`: ALTER TABLE ADD COLUMN (senza DEFAULT — limite SQLite) + UPDATE delle righe esistenti con i campi di dominio `*_at` come fallback (es. `created_at = COALESCE(found_at, CURRENT_TIMESTAMP)`).
**Modifiche V2→V3**: aggiunto `CHECK` constraint su `positions.status`. Migrazione tramite `_migrate_v2_to_v3()`.
**Percorso**: `$JHT_HOME/jobs.db` (canonico) o `$JHT_DB=<file>`. Fuori dal container la copia nel repo `shared/data/jobs.db` va CHIESTA con `JHT_DB_FALLBACK=1`: senza nessuna di queste il modulo fallisce invece di indovinare un path (O-26).
**Script degli skill**: `shared/skills/`

Questo file è il RIFERIMENTO UFFICIALE per lo schema del database. Tutti gli agenti devono leggere QUESTO file per conoscere la struttura delle tabelle e i comandi disponibili.

---

## Tabelle

### companies
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| name | TEXT NOT NULL UNIQUE | | Nome azienda (chiave di corrispondenza) |
| website | TEXT | | URL sito aziendale |
| hq_country | TEXT | | Paese sede principale |
| sector | TEXT | | Settore (fintech, ai, ecc.) |
| size | TEXT | | Dimensione (startup, PMI, enterprise) |
| glassdoor_rating | REAL | | Valutazione Glassdoor |
| red_flags | TEXT | | Segnali d'allarme trovati |
| culture_notes | TEXT | | Note sulla cultura aziendale |
| analyzed_by | TEXT | | Chi l'ha analizzata (analista-1, ecc.) |
| analyzed_at | TIMESTAMP | CURRENT_TIMESTAMP | Quando è stata analizzata |
| verdict | TEXT | | GO, CAUTIOUS, NO_GO |
| logo | TEXT | | **mig 056** — data-URI base64 del logo (≤ ~35KB) — scrive SOLO `logo_fetch.py` |
| logo_source | TEXT | | **mig 056** — URL sorgente del logo (audit/refresh) |
| logo_fetched | INTEGER | 0 | **mig 056** — 1 = estrazione tentata (pattern office_geocoded); coda `next-for-logo-missing` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserimento riga |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — aggiornato automaticamente ad ogni UPDATE tramite trigger |

### positions
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| title | TEXT NOT NULL | | Titolo della posizione |
| company | TEXT NOT NULL | | Nome azienda (testo) |
| company_id | INTEGER FK | NULL | Collegamento a companies(id) — risolto automaticamente |
| location | TEXT | | Località unificata (Remote EU, London, ecc.) |
| remote_type | TEXT | | full_remote, hybrid, onsite |
| salary_declared_min | INTEGER | | Stipendio dichiarato nella JD — minimo |
| salary_declared_max | INTEGER | | Stipendio dichiarato nella JD — massimo |
| salary_declared_currency | TEXT | EUR | Valuta stipendio dichiarato |
| salary_estimated_min | INTEGER | | Stipendio stimato — minimo |
| salary_estimated_max | INTEGER | | Stipendio stimato — massimo |
| salary_estimated_currency | TEXT | EUR | Valuta stipendio stimato |
| salary_estimated_source | TEXT | | Fonte della stima: glassdoor, levels.fyi, manual |
| url | TEXT | | URL della job description |
| source | TEXT | | linkedin, indeed, glassdoor, dynamite, ecc. |
| jd_text | TEXT | | Testo COMPLETO della job description |
| requirements | TEXT | | Requisiti estratti dalla JD |
| found_by | TEXT | | Chi l'ha trovata (scout-1, ecc.) |
| found_at | TIMESTAMP | CURRENT_TIMESTAMP | Quando è stata trovata |
| deadline | TEXT | | Scadenza (YYYY-MM-DD o "non presente") |
| status | TEXT | new | new → checked → scored → writing → ready → applied → response · `excluded` da qualsiasi step. **V3: vincolato da `CHECK` constraint** — i valori non in questa lista vengono rigettati con `IntegrityError`. |
| notes | TEXT | | Note libere |
| last_checked | TIMESTAMP | | Ultima verifica link/JD |
| write_requested | INTEGER | 0 | **V6** — `1` = l'utente ha richiesto un CV per questa posizione (tramite pulsante web o `/cv` Telegram). Il Capitano interroga questa colonna per generare Scrittori on-demand. |
| write_requested_at | TIMESTAMP | NULL | **V6** — quando l'utente ha richiesto il CV. Usato dal Capitano per l'ordinamento FIFO nella generazione degli Scrittori. |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserimento riga |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — aggiornato automaticamente ad ogni UPDATE tramite trigger |

### position_highlights
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL | | Collegamento a positions(id) |
| type | TEXT NOT NULL | | pro, con |
| text | TEXT NOT NULL | | Testo del pro/contro |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserimento riga |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — aggiornato automaticamente ad ogni UPDATE tramite trigger |

### scores
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Collegamento a positions(id) |
| total_score | INTEGER NOT NULL | | Punteggio totale 0-100 |
| stack_match | INTEGER | | Sub-score stack /40 |
| remote_fit | INTEGER | | Sub-score remoto /25 |
| salary_fit | INTEGER | | Sub-score stipendio /20 |
| experience_fit | INTEGER | | Sub-score esperienza |
| strategic_fit | INTEGER | | Sub-score strategico /15 |
| breakdown | TEXT | | Dettaglio del punteggio |
| notes | TEXT | | Note dello scorer |
| scored_by | TEXT | | Chi ha assegnato il punteggio |
| scored_at | TIMESTAMP | CURRENT_TIMESTAMP | Quando è stato assegnato il punteggio |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserimento riga |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — aggiornato automaticamente ad ogni UPDATE tramite trigger |

### applications
| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Collegamento a positions(id) |
| cv_path | TEXT | | Percorso CV markdown |
| cl_path | TEXT | | Percorso lettera di presentazione markdown |
| cv_pdf_path | TEXT | | Percorso CV PDF |
| cl_pdf_path | TEXT | | Percorso lettera di presentazione PDF |
| critic_verdict | TEXT | | PASS, NEEDS_WORK, REJECT |
| critic_score | REAL | | Voto del critico (1-10) |
| critic_notes | TEXT | | Note del critico |
| status | TEXT | draft | draft (default) — il flag operativo è `applied` (BOOLEAN). Gli stati `review/approved` non sono attualmente popolati dagli agenti. |
| written_at | TIMESTAMP | | Quando il CV è stato creato |
| applied_at | TIMESTAMP | | Quando la candidatura è stata inviata |
| applied_via | TEXT | | Dove è stata inviata (linkedin, sito, ecc.) |
| response | TEXT | | Risposta ricevuta |
| response_at | TIMESTAMP | | Quando è arrivata la risposta |
| written_by | TEXT | | Chi ha scritto (scrittore-1, ecc.) |
| reviewed_by | TEXT | | Chi ha effettuato la revisione |
| critic_reviewed_at | TIMESTAMP | | Impostato automaticamente con --critic-score |
| applied | BOOLEAN | 0 | TRUE se l'utente ha inviato |
| interview_round | INTEGER | NULL | Fase del colloquio (1, 2, 3...) |
| cv_drive_id | TEXT | | ID file Google Drive del CV PDF |
| cl_drive_id | TEXT | | ID file Google Drive della lettera di presentazione PDF |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — inserimento riga |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — aggiornato automaticamente ad ogni UPDATE tramite trigger |

### pending_user_messages

**V5** — coda notifiche utente con fallback sulla dashboard web quando Telegram non è disponibile/configurato. Ogni agente che vuole comunicare con l'utente effettua una INSERT qui PRIMA di tentare Telegram: se l'invio Telegram riesce, l'agente aggiorna `delivered_via='telegram'`; se fallisce o Telegram non è configurato, lascia `delivered_via='web'` e la riga viene sincronizzata su Supabase tramite `jht cloud push` → la dashboard web la presenta all'utente. La risposta dell'utente via web torna nelle colonne `user_reply`/`user_reply_at`; al ciclo successivo l'agente vede il marcatore e risponde tramite lo stesso canale.

| Colonna | Tipo | Default | Note |
|---------|------|---------|------|
| id | INTEGER | PK AUTOINCREMENT | |
| agent | TEXT | NOT NULL | Chi scrive: `capitano`, `mentor`, `assistente`, ... |
| body | TEXT | NOT NULL | Testo del messaggio (markdown ammesso) |
| kind | TEXT | 'notification' | `notification` / `question` / `digest` / `alert` |
| related_position_id | INTEGER | FK positions(id) | Opzionale — per notifiche legate a un'offerta |
| delivered_via | TEXT | NULL | `telegram` (consegnato tramite bot) / `web` (in attesa sulla dashboard) / NULL (in coda) |
| delivered_at | TIMESTAMP | | Quando è stato consegnato sul canale scelto |
| acknowledged_at | TIMESTAMP | | L'utente ha letto/archiviato tramite la dashboard |
| user_reply | TEXT | | Risposta dell'utente tramite dashboard web (opzionale) |
| user_reply_at | TIMESTAMP | | Quando l'utente ha risposto |
| agent_seen_reply_at | TIMESTAMP | | Quando l'agente ha visto la risposta — usato dal marcatore di protezione prompt-injection per evitare processi duplicati |
| cloud_synced_at | TIMESTAMP | | Impostato da `jht cloud push` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | Aggiornato automaticamente ad ogni UPDATE tramite trigger |

---

## Indici

| Nome | Tabella | Colonne |
|------|---------|---------|
| idx_positions_status | positions | status |
| idx_positions_company | positions | company |
| idx_positions_company_id | positions | company_id |
| idx_positions_url | positions | url |
| idx_positions_write_requested | positions | write_requested (parziale WHERE = 1) |
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
python3 shared/skills/db_query.py positions --min-score 70     # Filtra per punteggio
python3 shared/skills/db_query.py position 42                  # Dettaglio singola posizione
python3 shared/skills/db_query.py companies --verdict GO       # Aziende per verdetto
python3 shared/skills/db_query.py company "Azienda"            # Dettaglio azienda
python3 shared/skills/db_query.py check-url 4361788825         # Verifica duplicati
python3 shared/skills/db_query.py next-for-scorer              # Coda scorer
python3 shared/skills/db_query.py next-for-scrittore           # Coda scrittore
python3 shared/skills/db_query.py next-for-critico             # ⚠️ legacy — il Critico oggi viene generato dallo Scrittore, non preleva dalla coda
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

# Punteggio (Scorer)
python3 shared/skills/db_insert.py score \
  --position-id 42 --total 85 --stack-match 35 --remote-fit 20 \
  --salary-fit 15 --experience-fit 5 --strategic-fit 10 --scored-by scorer

# Candidatura (Scrittore)
python3 shared/skills/db_insert.py application \
  --position-id 42 --cv-path "..." --cl-path "..." \
  --cv-pdf-path "..." --cl-pdf-path "..." \
  --written-by scrittore-1 --written-at now

# Punto di forza/debolezza (Analista/Scorer)
python3 shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack identico"
```

### Update
```bash
# Stato posizione
python3 shared/skills/db_update.py position 42 --status checked

# Stipendio dichiarato
python3 shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Stipendio stimato
python3 shared/skills/db_update.py position 42 \
  --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Ultima verifica (OBBLIGATORIO dopo la verifica del link)
python3 shared/skills/db_update.py position 42 --last-checked now

# Voto del critico (critic_reviewed_at viene impostato automaticamente)
python3 shared/skills/db_update.py application 42 \
  --critic-verdict PASS --critic-score 8.5 --critic-notes "note"

# Candidatura inviata (applied=1 viene impostato automaticamente con --applied-at)
python3 shared/skills/db_update.py application 42 \
  --applied-at "2026-02-28" --applied-via linkedin

# Risposta
python3 shared/skills/db_update.py application 42 \
  --response "rejected" --response-at now

# Fase del colloquio (1=primo colloquio, 2=secondo, ecc.)
python3 shared/skills/db_update.py application 42 --interview-round 1
```

### Sync (archiviazione cloud opzionale)
```bash
python3 shared/skills/db_to_sheets.py sync            # DB → Google Sheets
python3 shared/skills/db_to_sheets.py sync --dry-run  # Anteprima senza scrivere

python3 shared/skills/db_to_supabase.py sync          # DB → Supabase (mirror sola lettura)
python3 shared/skills/db_to_supabase.py sync --dry-run

python3 shared/skills/db_to_drive.py sync             # CV/CL PDF → Google Drive
python3 shared/skills/db_to_drive.py sync --dry-run
```

### Migrazione
```bash
python3 shared/skills/db_migrate_v2.py --verify       # Verifica integrità
```

---

## Comportamenti automatici

| Azione | Effetto automatico |
|--------|-------------------|
| `--critic-score X` | Imposta `critic_reviewed_at = NOW` |
| `--applied-at "..."` | Imposta `applied = 1` |
| Insert position con `--company "X"` | Risoluzione automatica di `company_id` da companies |
| Update position con `--company "X"` | Risoluzione automatica di `company_id` da companies |

---

## Pipeline degli stati

```
new → checked → scored → writing → ready → applied → response
  │       │         │         │       │
  ▼       ▼         ▼         ▼       ▼
        excluded (link morto, non qualificato, score < 40, critic_score < 5, ecc.)
```

**Stato per fase:**
- `new` — lo Scout ha appena inserito (Fase 1)
- `checked` — l'Analista ha verificato e promosso (Fase 2) · `excluded` se [LINK_MORTO/SCAM/GEO/LINGUA/SENIORITY/STACK]
- `scored` — lo Scorer ha assegnato il punteggio (Fase 3) · `excluded` se score < 40
- `writing` — lo Scrittore l'ha presa in carico (Fase 4) — claim coordinato tra pari
- `ready` — il Round 3 del Critico ha dato score ≥ 5 (Fase 4) · `excluded` se score < 5
- `applied` — l'utente ha confermato l'invio (Fase 5) — manuale, mai dal team
- `response` — risposta ricevuta (`interview`/`rejected`/`ghosted`) — flag gestito dall'utente
