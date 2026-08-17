<!-- @translation: de, ai-translated 2026-06-06 -->
# Datenbankschema — jobs.db (V6)

**Aktualisiert**: 2026-05-29
**Schema-Version**: `PRAGMA user_version = 6`
**Änderungen gegenüber V5**: Spalten `positions.write_requested` (INTEGER DEFAULT 0) und `positions.write_requested_at` (TIMESTAMP) für Writer-on-demand hinzugefügt. Der Benutzer wählt über das Web-Dashboard (Button "CV schreiben") oder via Telegram (`/cv <id>`) die Positionen aus, für die er einen Lebenslauf möchte; der Kapitän erzeugt Schreiber on-demand nur wenn das Flag aktiviert ist. Idempotente Migration über `_migrate_positions_write_requested()` (ALTER TABLE ADD COLUMN). Siehe BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) und mig Supabase 024.
**Änderungen V4→V5**: Tabelle `pending_user_messages` für das Fallback-Pattern der Benachrichtigungen via Cloud-Sync hinzugefügt (Entscheidung 2026-05-13 — Telegram ausgefallen/nicht konfiguriert ⇒ Schreiben in DB ⇒ Cloud-Sync ⇒ Web-Dashboard). Die Migration ist nicht-destruktiv: `CREATE TABLE IF NOT EXISTS` + Standard-Trigger touch_updated_at. Pre-V5-Datenbanken aktualisieren sich beim ersten `ensure_schema()` automatisch.
**Änderungen V3→V4**: Einheitliche Spalten `created_at` und `updated_at` in allen 5 Datentabellen hinzugefügt, mit `DEFAULT CURRENT_TIMESTAMP` (neue DBs) und Trigger `touch_updated_at` (AFTER UPDATE), der `updated_at` bei jedem UPDATE automatisch aktualisiert. Die Domain-Felder (`scored_at`, `applied_at`, `written_at`, `analyzed_at`, `found_at`, `last_checked`) bleiben für die Event-Semantik bestehen. Automatische retroaktive Migration über `_migrate_v3_to_v4()` in `shared/skills/_db.py`: ALTER TABLE ADD COLUMN (ohne DEFAULT — SQLite-Limit) + UPDATE der vorhandenen Zeilen mit den Domain-Feldern `*_at` als Fallback (z.B. `created_at = COALESCE(found_at, CURRENT_TIMESTAMP)`).
**Änderungen V2→V3**: `CHECK`-Constraint auf `positions.status` hinzugefügt. Migration über `_migrate_v2_to_v3()`.
**Pfad**: `$JHT_HOME/jobs.db` (kanonisch) oder `$JHT_DB=<Datei>`. Außerhalb des Containers muss die Repo-Kopie `shared/data/jobs.db` mit `JHT_DB_FALLBACK=1` ANGEFORDERT werden: ohne diese schlägt das Modul fehl, statt einen Pfad zu raten (O-26).
**Skill-Skripte**: `shared/skills/`

Diese Datei ist die OFFIZIELLE REFERENZ für das Datenbankschema. Alle Agenten müssen DIESE Datei lesen, um die Tabellenstruktur und die verfügbaren Befehle zu kennen.

---

## Tabellen

### companies
| Spalte | Typ | Standard | Hinweise |
|--------|-----|----------|----------|
| id | INTEGER PK | AUTOINCREMENT | |
| name | TEXT NOT NULL UNIQUE | | Firmenname (Abgleichschlüssel) |
| website | TEXT | | URL der Firmenwebseite |
| hq_country | TEXT | | Land des Hauptsitzes |
| sector | TEXT | | Branche (fintech, ai, etc.) |
| size | TEXT | | Größe (startup, KMU, enterprise) |
| glassdoor_rating | REAL | | Glassdoor-Bewertung |
| red_flags | TEXT | | Gefundene Warnsignale |
| culture_notes | TEXT | | Notizen zur Unternehmenskultur |
| analyzed_by | TEXT | | Wer analysiert hat (analista-1, etc.) |
| analyzed_at | TIMESTAMP | CURRENT_TIMESTAMP | Wann analysiert wurde |
| verdict | TEXT | | GO, CAUTIOUS, NO_GO |
| logo | TEXT | | **mig 056** — base64-data-URI des Logos (≤ ~35KB) — schreibt NUR `logo_fetch.py` |
| logo_source | TEXT | | **mig 056** — Quell-URL des Logos (Audit/Refresh) |
| logo_fetched | INTEGER | 0 | **mig 056** — 1 = Extraktion versucht (office_geocoded-Muster); Queue `next-for-logo-missing` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — Zeileneinfügung |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — automatisch aktualisiert bei jedem UPDATE via Trigger |

### positions
| Spalte | Typ | Standard | Hinweise |
|--------|-----|----------|----------|
| id | INTEGER PK | AUTOINCREMENT | |
| title | TEXT NOT NULL | | Stellenbezeichnung |
| company | TEXT NOT NULL | | Firmenname (Text) |
| company_id | INTEGER FK | NULL | Verknüpfung zu companies(id) — automatisch aufgelöst |
| location | TEXT | | Vereinheitlichter Standort (Remote EU, London, etc.) |
| remote_type | TEXT | | full_remote, hybrid, onsite |
| salary_declared_min | INTEGER | | In der JD angegebenes Gehalt — Minimum |
| salary_declared_max | INTEGER | | In der JD angegebenes Gehalt — Maximum |
| salary_declared_currency | TEXT | EUR | Währung des angegebenen Gehalts |
| salary_estimated_min | INTEGER | | Geschätztes Gehalt — Minimum |
| salary_estimated_max | INTEGER | | Geschätztes Gehalt — Maximum |
| salary_estimated_currency | TEXT | EUR | Währung des geschätzten Gehalts |
| salary_estimated_source | TEXT | | Schätzungsquelle: glassdoor, levels.fyi, manual |
| url | TEXT | | URL der Stellenbeschreibung |
| source | TEXT | | linkedin, indeed, glassdoor, dynamite, etc. |
| jd_text | TEXT | | VOLLSTÄNDIGER Text der Stellenbeschreibung |
| requirements | TEXT | | Aus der JD extrahierte Anforderungen |
| found_by | TEXT | | Wer sie gefunden hat (scout-1, etc.) |
| found_at | TIMESTAMP | CURRENT_TIMESTAMP | Wann gefunden |
| deadline | TEXT | | Frist (YYYY-MM-DD oder "nicht vorhanden") |
| status | TEXT | new | new → checked → scored → writing → ready → applied → response · `excluded` aus jedem Schritt. **V3: durch `CHECK`-Constraint eingeschränkt** — Werte außerhalb dieser Liste werden mit `IntegrityError` abgewiesen. |
| notes | TEXT | | Freie Notizen |
| last_checked | TIMESTAMP | | Letzte Überprüfung des Links/JD |
| write_requested | INTEGER | 0 | **V6** — `1` = Der Benutzer hat einen Lebenslauf für diese Position angefordert (via Web-Button oder `/cv` Telegram). Der Kapitän fragt diese Spalte ab, um Schreiber on-demand zu erzeugen. |
| write_requested_at | TIMESTAMP | NULL | **V6** — Wann der Benutzer den Lebenslauf angefordert hat. Vom Kapitän für die FIFO-Sortierung bei der Schreiber-Erzeugung verwendet. |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — Zeileneinfügung |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — automatisch aktualisiert bei jedem UPDATE via Trigger |

### position_highlights
| Spalte | Typ | Standard | Hinweise |
|--------|-----|----------|----------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL | | Verknüpfung zu positions(id) |
| type | TEXT NOT NULL | | pro, con |
| text | TEXT NOT NULL | | Text des Pro/Contra |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — Zeileneinfügung |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — automatisch aktualisiert bei jedem UPDATE via Trigger |

### scores
| Spalte | Typ | Standard | Hinweise |
|--------|-----|----------|----------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Verknüpfung zu positions(id) |
| total_score | INTEGER NOT NULL | | Gesamtpunktzahl 0-100 |
| stack_match | INTEGER | | Sub-Score Stack /40 |
| remote_fit | INTEGER | | Sub-Score Remote /25 |
| salary_fit | INTEGER | | Sub-Score Gehalt /20 |
| experience_fit | INTEGER | | Sub-Score Erfahrung |
| strategic_fit | INTEGER | | Sub-Score Strategie /15 |
| breakdown | TEXT | | Score-Aufschlüsselung |
| notes | TEXT | | Scorer-Notizen |
| scored_by | TEXT | | Wer den Score vergeben hat |
| scored_at | TIMESTAMP | CURRENT_TIMESTAMP | Wann bewertet |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — Zeileneinfügung |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — automatisch aktualisiert bei jedem UPDATE via Trigger |

### applications
| Spalte | Typ | Standard | Hinweise |
|--------|-----|----------|----------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Verknüpfung zu positions(id) |
| cv_path | TEXT | | Pfad zum CV-Markdown |
| cl_path | TEXT | | Pfad zum Anschreiben-Markdown |
| cv_pdf_path | TEXT | | Pfad zum CV-PDF |
| cl_pdf_path | TEXT | | Pfad zum Anschreiben-PDF |
| critic_verdict | TEXT | | PASS, NEEDS_WORK, REJECT |
| critic_score | REAL | | Kritiker-Note (1-10) |
| critic_notes | TEXT | | Notizen des Kritikers |
| status | TEXT | draft | draft (Standard) — das operative Flag ist `applied` (BOOLEAN). Die Zustände `review/approved` werden derzeit nicht von den Agenten befüllt. |
| written_at | TIMESTAMP | | Wann der CV erstellt wurde |
| applied_at | TIMESTAMP | | Wann die Bewerbung abgeschickt wurde |
| applied_via | TEXT | | Wo abgeschickt (linkedin, Webseite, etc.) |
| response | TEXT | | Erhaltene Antwort |
| response_at | TIMESTAMP | | Wann die Antwort einging |
| written_by | TEXT | | Wer geschrieben hat (scrittore-1, etc.) |
| reviewed_by | TEXT | | Wer die Prüfung durchgeführt hat |
| critic_reviewed_at | TIMESTAMP | | Automatisch gesetzt mit --critic-score |
| applied | BOOLEAN | 0 | TRUE wenn der Benutzer abgeschickt hat |
| interview_round | INTEGER | NULL | Interviewphase (1, 2, 3...) |
| cv_drive_id | TEXT | | Google Drive Datei-ID des CV-PDF |
| cl_drive_id | TEXT | | Google Drive Datei-ID des Anschreiben-PDF |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — Zeileneinfügung |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — automatisch aktualisiert bei jedem UPDATE via Trigger |

### pending_user_messages

**V5** — Benachrichtigungswarteschlange für den Benutzer mit Fallback auf das Web-Dashboard, wenn Telegram nicht verfügbar/konfiguriert ist. Jeder Agent, der mit dem Benutzer kommunizieren möchte, führt hier eine INSERT durch, BEVOR er Telegram versucht: Wenn der Telegram-Versand erfolgreich ist, aktualisiert der Agent `delivered_via='telegram'`; wenn er fehlschlägt oder Telegram nicht konfiguriert ist, bleibt `delivered_via='web'` und die Zeile wird über `jht cloud push` auf Supabase synchronisiert → das Web-Dashboard präsentiert sie dem Benutzer. Die Antwort des Benutzers über das Web kommt in den Spalten `user_reply`/`user_reply_at` zurück; im nächsten Zyklus sieht der Agent den Marker und antwortet über denselben Kanal.

| Spalte | Typ | Standard | Hinweise |
|--------|-----|----------|----------|
| id | INTEGER | PK AUTOINCREMENT | |
| agent | TEXT | NOT NULL | Wer schreibt: `capitano`, `mentor`, `assistente`, ... |
| body | TEXT | NOT NULL | Nachrichtentext (Markdown erlaubt) |
| kind | TEXT | 'notification' | `notification` / `question` / `digest` / `alert` |
| related_position_id | INTEGER | FK positions(id) | Optional — für Benachrichtigungen zu einem Stellenangebot |
| delivered_via | TEXT | NULL | `telegram` (via Bot zugestellt) / `web` (im Dashboard wartend) / NULL (in Warteschlange) |
| delivered_at | TIMESTAMP | | Wann auf dem gewählten Kanal zugestellt |
| acknowledged_at | TIMESTAMP | | Benutzer hat über Dashboard gelesen/bestätigt |
| user_reply | TEXT | | Antwort des Benutzers über Web-Dashboard (optional) |
| user_reply_at | TIMESTAMP | | Wann der Benutzer geantwortet hat |
| agent_seen_reply_at | TIMESTAMP | | Wann der Agent die Antwort gesehen hat — verwendet vom Prompt-Injection-Schutzmarker zur Vermeidung doppelter Verarbeitung |
| cloud_synced_at | TIMESTAMP | | Gesetzt von `jht cloud push` |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | Automatisch aktualisiert bei jedem UPDATE via Trigger |

---

## Indizes

| Name | Tabelle | Spalten |
|------|---------|---------|
| idx_positions_status | positions | status |
| idx_positions_company | positions | company |
| idx_positions_company_id | positions | company_id |
| idx_positions_url | positions | url |
| idx_positions_write_requested | positions | write_requested (partiell WHERE = 1) |
| idx_scores_total | scores | total_score |
| idx_applications_status | applications | status |
| idx_pending_user_messages_agent | pending_user_messages | agent |
| idx_pending_user_messages_delivery | pending_user_messages | delivered_via, acknowledged_at |
| idx_pending_user_messages_unseen_reply | pending_user_messages | user_reply_at, agent_seen_reply_at |

---

## CLI-Befehle

### Abfragen
```bash
python3 shared/skills/db_query.py dashboard                    # Vollständiges Dashboard
python3 shared/skills/db_query.py stats                        # Tabellenzähler
python3 shared/skills/db_query.py positions --status new       # Nach Status filtern
python3 shared/skills/db_query.py positions --min-score 70     # Nach Score filtern
python3 shared/skills/db_query.py position 42                  # Einzelne Details
python3 shared/skills/db_query.py companies --verdict GO       # Unternehmen nach Verdict
python3 shared/skills/db_query.py company "Azienda"            # Unternehmensdetails
python3 shared/skills/db_query.py check-url 4361788825         # Duplikate prüfen
python3 shared/skills/db_query.py next-for-scorer              # Scorer-Warteschlange
python3 shared/skills/db_query.py next-for-scrittore           # Schreiber-Warteschlange
python3 shared/skills/db_query.py next-for-critico             # ⚠️ Legacy — der Kritiker wird heute vom Schreiber erzeugt, er holt nicht aus der Warteschlange
```

### Einfügen
```bash
# Position (Scout)
python3 shared/skills/db_insert.py position \
  --title "Python Developer" --company "Azienda" \
  --location "Remote EU" --remote-type full_remote \
  --salary-declared-min 40000 --salary-declared-max 65000 \
  --url "https://..." --source linkedin --found-by scout-1 \
  --jd-text "TESTO COMPLETO JD" --requirements "Python, Flask"

# Unternehmen (Analista)
python3 shared/skills/db_insert.py company \
  --name "Azienda" --hq-country "Italia" --sector "fintech" \
  --verdict GO --analyzed-by analista-1

# Score (Scorer)
python3 shared/skills/db_insert.py score \
  --position-id 42 --total 85 --stack-match 35 --remote-fit 20 \
  --salary-fit 15 --experience-fit 5 --strategic-fit 10 --scored-by scorer

# Bewerbung (Schreiber)
python3 shared/skills/db_insert.py application \
  --position-id 42 --cv-path "..." --cl-path "..." \
  --cv-pdf-path "..." --cl-pdf-path "..." \
  --written-by scrittore-1 --written-at now

# Highlight (Analista/Scorer)
python3 shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack identico"
```

### Aktualisieren
```bash
# Positionsstatus
python3 shared/skills/db_update.py position 42 --status checked

# Angegebenes Gehalt
python3 shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Geschätztes Gehalt
python3 shared/skills/db_update.py position 42 \
  --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Letzte Prüfung (PFLICHT nach Link-Überprüfung)
python3 shared/skills/db_update.py position 42 --last-checked now

# Kritiker-Note (critic_reviewed_at wird automatisch gesetzt)
python3 shared/skills/db_update.py application 42 \
  --critic-verdict PASS --critic-score 8.5 --critic-notes "note"

# Beworben (applied=1 wird automatisch gesetzt mit --applied-at)
python3 shared/skills/db_update.py application 42 \
  --applied-at "2026-02-28" --applied-via linkedin

# Antwort
python3 shared/skills/db_update.py application 42 \
  --response "rejected" --response-at now

# Interviewphase (1=erstes Interview, 2=zweites, etc.)
python3 shared/skills/db_update.py application 42 --interview-round 1
```

### Synchronisation (optionaler Cloud-Speicher)
```bash
python3 shared/skills/db_to_sheets.py sync            # DB → Google Sheets
python3 shared/skills/db_to_sheets.py sync --dry-run  # Vorschau ohne Schreiben

python3 shared/skills/db_to_supabase.py sync          # DB → Supabase (Nur-Lese-Spiegel)
python3 shared/skills/db_to_supabase.py sync --dry-run

python3 shared/skills/db_to_drive.py sync             # CV/CL PDF → Google Drive
python3 shared/skills/db_to_drive.py sync --dry-run
```

### Migration
```bash
python3 shared/skills/db_migrate_v2.py --verify       # Integrität prüfen
```

---

## Automatische Verhaltensweisen

| Aktion | Automatischer Effekt |
|--------|---------------------|
| `--critic-score X` | Setzt `critic_reviewed_at = NOW` |
| `--applied-at "..."` | Setzt `applied = 1` |
| Insert position mit `--company "X"` | Automatische Auflösung von `company_id` aus companies |
| Update position mit `--company "X"` | Automatische Auflösung von `company_id` aus companies |

---

## Status-Pipeline

```
new → checked → scored → writing → ready → applied → response
  │       │         │         │       │
  ▼       ▼         ▼         ▼       ▼
        excluded (toter Link, nicht qualifiziert, Score < 40, critic_score < 5, etc.)
```

**Status pro Phase:**
- `new` — Scout hat gerade eingefügt (Phase 1)
- `checked` — Analyst hat überprüft und befördert (Phase 2) · `excluded` bei [LINK_MORTO/SCAM/GEO/LINGUA/SENIORITY/STACK]
- `scored` — Scorer hat Punktzahl vergeben (Phase 3) · `excluded` bei Score < 40
- `writing` — Schreiber hat es übernommen (Phase 4) — Peer-koordinierter Claim
- `ready` — Runde 3 des Kritikers hat Score ≥ 5 ergeben (Phase 4) · `excluded` bei Score < 5
- `applied` — Benutzer hat den Versand bestätigt (Phase 5) — manuell, nie vom Team
- `response` — Antwort erhalten (`interview`/`rejected`/`ghosted`) — vom Benutzer verwaltetes Flag
