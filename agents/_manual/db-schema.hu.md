<!-- @translation: hu, ai-translated 2026-06-06 -->
# Adatbázis-séma — jobs.db (V6)

**Frissítve**: 2026-05-29
**Séma verzió**: `PRAGMA user_version = 6`
**Változások a V5-höz képest**: hozzáadva a `positions.write_requested` (INTEGER DEFAULT 0) és `positions.write_requested_at` (TIMESTAMP) oszlopok a Writer-on-demand funkcióhoz. A felhasználó a webes irányítópultról (a "CV írása" gombbal) vagy Telegramon keresztül (`/cv <id>`) választja ki azokat a pozíciókat, amelyekhez önéletrajzot szeretne; a Kapitány csak akkor hoz létre Írókat on-demand, ha a flag aktív. Idempotens migráció a `_migrate_positions_write_requested()` segítségével (ALTER TABLE ADD COLUMN). Lásd BACKLOG [JHT-WRITER-ON-DEMAND] (2026-05-29) és Supabase mig 024.
**Változások V4→V5**: hozzáadva a `pending_user_messages` tábla az értesítések cloud sync-en keresztüli fallback mintájához (döntés 2026-05-13 — Telegram nem elérhető/nincs konfigurálva ⇒ írás a DB-be ⇒ cloud sync ⇒ webes irányítópult). A migráció nem destruktív: `CREATE TABLE IF NOT EXISTS` + szabványos touch_updated_at trigger. A V5 előtti DB-k automatikusan frissülnek az első `ensure_schema()` hívásnál.
**Változások V3→V4**: egységes `created_at` és `updated_at` oszlopok hozzáadva mind az 5 adattáblában, `DEFAULT CURRENT_TIMESTAMP` értékkel (új DB-k) és `touch_updated_at` (AFTER UPDATE) triggerrel, amely minden UPDATE-nél automatikusan frissíti az `updated_at` értéket. A tartományi mezők (`scored_at`, `applied_at`, `written_at`, `analyzed_at`, `found_at`, `last_checked`) megmaradnak az eseményszemantikához. Automatikus retroaktív migráció a `_migrate_v3_to_v4()` segítségével a `shared/skills/_db.py` fájlban: ALTER TABLE ADD COLUMN (DEFAULT nélkül — SQLite korlát) + UPDATE a meglévő sorokon a tartományi `*_at` mezőkkel fallbackként (pl. `created_at = COALESCE(found_at, CURRENT_TIMESTAMP)`).
**Változások V2→V3**: `CHECK` constraint hozzáadva a `positions.status` oszlophoz. Migráció a `_migrate_v2_to_v3()` segítségével.
**Elérési út**: `$JHT_HOME/jobs.db` (kanonikus) vagy `$JHT_DB=<fájl>`. A konténeren kívül a repó másolatát (`shared/data/jobs.db`) KÉRNI kell a `JHT_DB_FALLBACK=1` beállítással: egyik nélkül sem találgat a modul, hanem hibát dob (O-26).
**Képesség-szkriptek**: `shared/skills/`

Ez a fájl a HIVATALOS REFERENCIA az adatbázis-sémához. Minden ügynöknek EZT a fájlt kell olvasnia a táblaszerkezet és az elérhető parancsok megismeréséhez.

---

## Táblák

### companies
| Oszlop | Típus | Alapértelmezett | Megjegyzések |
|--------|-------|-----------------|--------------|
| id | INTEGER PK | AUTOINCREMENT | |
| name | TEXT NOT NULL UNIQUE | | Cégnév (egyeztetési kulcs) |
| website | TEXT | | Vállalati webhely URL-je |
| hq_country | TEXT | | Központi székhely országa |
| sector | TEXT | | Ágazat (fintech, ai, stb.) |
| size | TEXT | | Méret (startup, KKV, enterprise) |
| glassdoor_rating | REAL | | Glassdoor értékelés |
| red_flags | TEXT | | Talált figyelmeztető jelek |
| culture_notes | TEXT | | Megjegyzések a vállalati kultúráról |
| analyzed_by | TEXT | | Ki elemezte (analista-1, stb.) |
| analyzed_at | TIMESTAMP | CURRENT_TIMESTAMP | Mikor lett elemezve |
| verdict | TEXT | | GO, CAUTIOUS, NO_GO |
| logo | TEXT | | **mig 056** — a logó base64 data-URI-ja (≤ ~35KB) — CSAK a `logo_fetch.py` írja |
| logo_source | TEXT | | **mig 056** — a logó forrás-URL-je (audit/refresh) |
| logo_fetched | INTEGER | 0 | **mig 056** — 1 = kinyerés megkísérelve (office_geocoded-minta); `next-for-logo-missing` sor |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — sor beszúrása |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — automatikusan frissítve minden UPDATE-nél trigger segítségével |

### positions
| Oszlop | Típus | Alapértelmezett | Megjegyzések |
|--------|-------|-----------------|--------------|
| id | INTEGER PK | AUTOINCREMENT | |
| title | TEXT NOT NULL | | Pozíció neve |
| company | TEXT NOT NULL | | Cégnév (szöveg) |
| company_id | INTEGER FK | NULL | Kapcsolat a companies(id) táblához — automatikusan feloldva |
| location | TEXT | | Egységesített helyszín (Remote EU, London, stb.) |
| remote_type | TEXT | | full_remote, hybrid, onsite |
| salary_declared_min | INTEGER | | A JD-ben megadott fizetés — minimum |
| salary_declared_max | INTEGER | | A JD-ben megadott fizetés — maximum |
| salary_declared_currency | TEXT | EUR | Megadott fizetés pénzneme |
| salary_estimated_min | INTEGER | | Becsült fizetés — minimum |
| salary_estimated_max | INTEGER | | Becsült fizetés — maximum |
| salary_estimated_currency | TEXT | EUR | Becsült fizetés pénzneme |
| salary_estimated_source | TEXT | | Becslés forrása: glassdoor, levels.fyi, manual |
| url | TEXT | | Az álláshirdetés URL-je |
| source | TEXT | | linkedin, indeed, glassdoor, dynamite, stb. |
| jd_text | TEXT | | Az álláshirdetés TELJES szövege |
| requirements | TEXT | | A JD-ből kinyert követelmények |
| found_by | TEXT | | Ki találta meg (scout-1, stb.) |
| found_at | TIMESTAMP | CURRENT_TIMESTAMP | Mikor lett megtalálva |
| deadline | TEXT | | Határidő (YYYY-MM-DD vagy "nem szerepel") |
| status | TEXT | new | new → checked → scored → writing → ready → applied → response · `excluded` bármely lépésből. **V3: `CHECK` constraint által korlátozva** — a listában nem szereplő értékeket `IntegrityError` hibaüzenettel utasítja el. |
| notes | TEXT | | Szabad megjegyzések |
| last_checked | TIMESTAMP | | Utolsó link/JD ellenőrzés |
| write_requested | INTEGER | 0 | **V6** — `1` = a felhasználó CV-t kért ehhez a pozícióhoz (webes gombbal vagy `/cv` Telegram paranccsal). A Kapitány ezt az oszlopot kérdezi le az Írók on-demand létrehozásához. |
| write_requested_at | TIMESTAMP | NULL | **V6** — mikor kérte a felhasználó a CV-t. A Kapitány FIFO sorrendezéshez használja az Írók létrehozásakor. |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — sor beszúrása |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — automatikusan frissítve minden UPDATE-nél trigger segítségével |

### position_highlights
| Oszlop | Típus | Alapértelmezett | Megjegyzések |
|--------|-------|-----------------|--------------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL | | Kapcsolat a positions(id) táblához |
| type | TEXT NOT NULL | | pro, con |
| text | TEXT NOT NULL | | Az előny/hátrány szövege |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — sor beszúrása |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — automatikusan frissítve minden UPDATE-nél trigger segítségével |

### scores
| Oszlop | Típus | Alapértelmezett | Megjegyzések |
|--------|-------|-----------------|--------------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Kapcsolat a positions(id) táblához |
| total_score | INTEGER NOT NULL | | Összesített pontszám 0-100 |
| stack_match | INTEGER | | Al-pontszám stack /40 |
| remote_fit | INTEGER | | Al-pontszám távmunka /25 |
| salary_fit | INTEGER | | Al-pontszám fizetés /20 |
| experience_fit | INTEGER | | Al-pontszám tapasztalat |
| strategic_fit | INTEGER | | Al-pontszám stratégiai /15 |
| breakdown | TEXT | | Pontszám részletezése |
| notes | TEXT | | Scorer megjegyzései |
| scored_by | TEXT | | Ki adta a pontszámot |
| scored_at | TIMESTAMP | CURRENT_TIMESTAMP | Mikor lett pontozva |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — sor beszúrása |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — automatikusan frissítve minden UPDATE-nél trigger segítségével |

### applications
| Oszlop | Típus | Alapértelmezett | Megjegyzések |
|--------|-------|-----------------|--------------|
| id | INTEGER PK | AUTOINCREMENT | |
| position_id | INTEGER FK NOT NULL UNIQUE | | Kapcsolat a positions(id) táblához |
| cv_path | TEXT | | CV markdown elérési útja |
| cl_path | TEXT | | Kísérőlevél markdown elérési útja |
| cv_pdf_path | TEXT | | CV PDF elérési útja |
| cl_pdf_path | TEXT | | Kísérőlevél PDF elérési útja |
| critic_verdict | TEXT | | PASS, NEEDS_WORK, REJECT |
| critic_score | REAL | | Kritikus értékelése (1-10) |
| critic_notes | TEXT | | Kritikus megjegyzései |
| status | TEXT | draft | draft (alapértelmezett) — az operatív flag az `applied` (BOOLEAN). A `review/approved` állapotokat jelenleg az ügynökök nem töltik ki. |
| written_at | TIMESTAMP | | Mikor lett a CV elkészítve |
| applied_at | TIMESTAMP | | Mikor lett a pályázat elküldve |
| applied_via | TEXT | | Hova lett elküldve (linkedin, webhely, stb.) |
| response | TEXT | | Kapott válasz |
| response_at | TIMESTAMP | | Mikor érkezett a válasz |
| written_by | TEXT | | Ki írta (scrittore-1, stb.) |
| reviewed_by | TEXT | | Ki végezte az átnézést |
| critic_reviewed_at | TIMESTAMP | | Automatikusan beállítva a --critic-score használatakor |
| applied | BOOLEAN | 0 | TRUE ha a felhasználó elküldte |
| interview_round | INTEGER | NULL | Interjú fázis (1, 2, 3...) |
| cv_drive_id | TEXT | | A CV PDF Google Drive fájl-azonosítója |
| cl_drive_id | TEXT | | A kísérőlevél PDF Google Drive fájl-azonosítója |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — sor beszúrása |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | **V4** — automatikusan frissítve minden UPDATE-nél trigger segítségével |

### pending_user_messages

**V5** — felhasználói értesítési várakozási sor, fallbackként a webes irányítópultra, ha a Telegram nem elérhető/nincs konfigurálva. Minden ügynök, amely kommunikálni szeretne a felhasználóval, itt végez INSERT-et, MIELŐTT megpróbálná a Telegramot: ha a Telegram küldés sikeres, az ügynök frissíti `delivered_via='telegram'`-ra; ha sikertelen vagy a Telegram nincs konfigurálva, `delivered_via='web'` marad, és a sor szinkronizálódik a Supabase-re a `jht cloud push` segítségével → a webes irányítópult megjeleníti a felhasználónak. A felhasználó webes válasza a `user_reply`/`user_reply_at` oszlopokba kerül vissza; a következő ciklusban az ügynök látja a jelölőt és ugyanazon a csatornán válaszol.

| Oszlop | Típus | Alapértelmezett | Megjegyzések |
|--------|-------|-----------------|--------------|
| id | INTEGER | PK AUTOINCREMENT | |
| agent | TEXT | NOT NULL | Ki ír: `capitano`, `mentor`, `assistente`, ... |
| body | TEXT | NOT NULL | Üzenet szövege (markdown megengedett) |
| kind | TEXT | 'notification' | `notification` / `question` / `digest` / `alert` |
| related_position_id | INTEGER | FK positions(id) | Opcionális — ajánlathoz kapcsolódó értesítésekhez |
| delivered_via | TEXT | NULL | `telegram` (boton keresztül kézbesítve) / `web` (irányítópulton várakozik) / NULL (sorban áll) |
| delivered_at | TIMESTAMP | | Mikor lett kézbesítve a választott csatornán |
| acknowledged_at | TIMESTAMP | | A felhasználó elolvasta/nyugtázta az irányítópulton |
| user_reply | TEXT | | A felhasználó válasza a webes irányítópulton keresztül (opcionális) |
| user_reply_at | TIMESTAMP | | Mikor válaszolt a felhasználó |
| agent_seen_reply_at | TIMESTAMP | | Mikor látta az ügynök a választ — a prompt-injection védelmi jelölő használja a dupla feldolgozás elkerüléséhez |
| cloud_synced_at | TIMESTAMP | | A `jht cloud push` által beállítva |
| created_at | TIMESTAMP | CURRENT_TIMESTAMP | |
| updated_at | TIMESTAMP | CURRENT_TIMESTAMP | Automatikusan frissítve minden UPDATE-nél trigger segítségével |

---

## Indexek

| Név | Tábla | Oszlopok |
|-----|-------|----------|
| idx_positions_status | positions | status |
| idx_positions_company | positions | company |
| idx_positions_company_id | positions | company_id |
| idx_positions_url | positions | url |
| idx_positions_write_requested | positions | write_requested (részleges WHERE = 1) |
| idx_scores_total | scores | total_score |
| idx_applications_status | applications | status |
| idx_pending_user_messages_agent | pending_user_messages | agent |
| idx_pending_user_messages_delivery | pending_user_messages | delivered_via, acknowledged_at |
| idx_pending_user_messages_unseen_reply | pending_user_messages | user_reply_at, agent_seen_reply_at |

---

## CLI parancsok

### Lekérdezés
```bash
python3 shared/skills/db_query.py dashboard                    # Teljes irányítópult
python3 shared/skills/db_query.py stats                        # Tábla-összesítések
python3 shared/skills/db_query.py positions --status new       # Szűrés állapot szerint
python3 shared/skills/db_query.py positions --min-score 70     # Szűrés pontszám szerint
python3 shared/skills/db_query.py position 42                  # Egyedi részletek
python3 shared/skills/db_query.py companies --verdict GO       # Cégek verdikt szerint
python3 shared/skills/db_query.py company "Azienda"            # Cég részletei
python3 shared/skills/db_query.py check-url 4361788825         # Duplikátumok ellenőrzése
python3 shared/skills/db_query.py next-for-scorer              # Scorer várakozási sor
python3 shared/skills/db_query.py next-for-scrittore           # Író várakozási sor
python3 shared/skills/db_query.py next-for-critico             # ⚠️ legacy — a Kritikust ma az Író hozza létre, nem a várakozási sorból vesz
```

### Beszúrás
```bash
# Pozíció (Scout)
python3 shared/skills/db_insert.py position \
  --title "Python Developer" --company "Azienda" \
  --location "Remote EU" --remote-type full_remote \
  --salary-declared-min 40000 --salary-declared-max 65000 \
  --url "https://..." --source linkedin --found-by scout-1 \
  --jd-text "TESTO COMPLETO JD" --requirements "Python, Flask"

# Cég (Analista)
python3 shared/skills/db_insert.py company \
  --name "Azienda" --hq-country "Italia" --sector "fintech" \
  --verdict GO --analyzed-by analista-1

# Pontszám (Scorer)
python3 shared/skills/db_insert.py score \
  --position-id 42 --total 85 --stack-match 35 --remote-fit 20 \
  --salary-fit 15 --experience-fit 5 --strategic-fit 10 --scored-by scorer

# Pályázat (Író)
python3 shared/skills/db_insert.py application \
  --position-id 42 --cv-path "..." --cl-path "..." \
  --cv-pdf-path "..." --cl-pdf-path "..." \
  --written-by scrittore-1 --written-at now

# Kiemelés (Analista/Scorer)
python3 shared/skills/db_insert.py highlight \
  --position-id 42 --type pro --text "Stack identico"
```

### Frissítés
```bash
# Pozíció állapota
python3 shared/skills/db_update.py position 42 --status checked

# Megadott fizetés
python3 shared/skills/db_update.py position 42 --salary-declared-min 40000 --salary-declared-max 55000

# Becsült fizetés
python3 shared/skills/db_update.py position 42 \
  --salary-estimated-min 35000 --salary-estimated-max 50000 --salary-estimated-source glassdoor

# Utolsó ellenőrzés (KÖTELEZŐ a link ellenőrzése után)
python3 shared/skills/db_update.py position 42 --last-checked now

# Kritikus értékelése (a critic_reviewed_at automatikusan beállítódik)
python3 shared/skills/db_update.py application 42 \
  --critic-verdict PASS --critic-score 8.5 --critic-notes "note"

# Elküldve (applied=1 automatikusan beállítódik a --applied-at használatakor)
python3 shared/skills/db_update.py application 42 \
  --applied-at "2026-02-28" --applied-via linkedin

# Válasz
python3 shared/skills/db_update.py application 42 \
  --response "rejected" --response-at now

# Interjú fázis (1=első interjú, 2=második, stb.)
python3 shared/skills/db_update.py application 42 --interview-round 1
```

### Szinkronizáció (opcionális felhőtárhely)
```bash
python3 shared/skills/db_to_sheets.py sync            # DB → Google Sheets
python3 shared/skills/db_to_sheets.py sync --dry-run  # Előnézet írás nélkül

python3 shared/skills/db_to_supabase.py sync          # DB → Supabase (csak olvasható tükör)
python3 shared/skills/db_to_supabase.py sync --dry-run

python3 shared/skills/db_to_drive.py sync             # CV/CL PDF → Google Drive
python3 shared/skills/db_to_drive.py sync --dry-run
```

### Migráció
```bash
python3 shared/skills/db_migrate_v2.py --verify       # Integritás ellenőrzése
```

---

## Automatikus viselkedések

| Művelet | Automatikus hatás |
|---------|-------------------|
| `--critic-score X` | Beállítja `critic_reviewed_at = NOW` |
| `--applied-at "..."` | Beállítja `applied = 1` |
| Insert position a `--company "X"` opcióval | A `company_id` automatikus feloldása a companies táblából |
| Update position a `--company "X"` opcióval | A `company_id` automatikus feloldása a companies táblából |

---

## Állapot-pipeline

```
new → checked → scored → writing → ready → applied → response
  │       │         │         │       │
  ▼       ▼         ▼         ▼       ▼
        excluded (halott link, nem megfelelő, score < 40, critic_score < 5, stb.)
```

**Állapot fázisonként:**
- `new` — a Scout most szúrta be (1. fázis)
- `checked` — az Elemző ellenőrizte és előléptette (2. fázis) · `excluded` ha [LINK_MORTO/SCAM/GEO/LINGUA/SENIORITY/STACK]
- `scored` — a Scorer pontszámot adott (3. fázis) · `excluded` ha score < 40
- `writing` — az Író átvette (4. fázis) — társak között koordinált claim
- `ready` — a Kritikus 3. körében a pontszám ≥ 5 (4. fázis) · `excluded` ha score < 5
- `applied` — a felhasználó megerősítette a küldést (5. fázis) — manuális, soha nem a csapat által
- `response` — válasz érkezett (`interview`/`rejected`/`ghosted`) — felhasználó által kezelt flag
