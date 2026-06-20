# 🔬 Design-doc — Espansione ruolo ANALISTA

> **Stato:** DRAFT — schema da lockare PRIMA di codare (design-doc-first, ordine lead dev3).
> **Owner:** dev1 (DB/migration + agents/analista + agents/capitano) · dev2 (web/ + skills salary-estimate/office-geocoding lato consumo) · dev3 (lead, review).
> **Data apertura:** 2026-06-13. **Branch:** Analista-expansion (dev1+dev2, split per-file rigido).
> ⛔ Fuori scope qui: fix#4 weekly-pacing (lo implementa dev3 su compute_metrics/sentinel-bridge/pacing-bridge — file disgiunti, zero collisione).

## 🎯 Obiettivo (dal brainstorm utente)
L'Analista è diventato il ruolo centrale. Espanderlo con: scadenze candidature machine-readable + richeck giornaliero, coordinate ufficio di default, stima salario via web con cache, e un Capitano che coordina/sostituisce analisti con compiti differenziati. La dashboard deve mostrare "in scadenza" e un archivio "scadute".

## 🧱 Stato attuale (analisi indipendente dev2, file:line)
| Ambito | Esiste | % | Gap |
|---|---|---|---|
| Schema `positions` | `deadline` TEXT libero (003_align_legacy_schema.sql:20); `status` enum (001:57-60); office_lat/lon/address + office_geocoded/office_verified (017); salary_estimated_min/max/currency/source (001:70-72) | 60% | manca `expires_at` (machine-readable), `is_open`, `last_open_check` |
| agents/analista | RULE-03 link-check (analista.md:71-83) — 1 check all'analisi, NON periodico; RULE-04/08 | 85% | no richeck giornaliero; no office-geocoding; no salary ownership |
| skill office-geocoding | SKILL.md presente, Nominatim/Photon, skip remote | 70% | nessun agente la invoca; no backfill ~219 storiche |
| skill salary-estimate | L1/L2/L4 ok, cache salary_estimates.json TTL30g | 90% | L3 web = STUB; owner oggi = Scorer |
| web dashboard | Position type (lib/types.ts:13-54, ha `deadline`, NO office_lat/lon); dashboard pipeline; positions list+filtri; **JobsGlobe.tsx ESISTE** (web/app/components/) | 50% | no card in-scadenza, no sezione scadute/archivio, no filtro deadline, Position type non espone office coords |

## 📋 Contratto DB (LOCKARE — owner dev1) — confermato dev1
Nuove colonne `positions` (in **Postgres** `supabase/migrations/` **E** SQLite `jobs.db` del container — dual-schema, owner dev1):
- `expires_at TIMESTAMPTZ NULL` — null = sconosciuta/sempre-aperta. L'analista la PARSA da `deadline` (TEXT grezzo, resta) quando una data è presente.
- `is_open BOOLEAN DEFAULT true` — l'analista la setta `false` al richeck se link morto OPPURE `expires_at` passata.
- `last_open_check TIMESTAMPTZ NULL` — timestamp ultimo richeck (per il loop giornaliero).
- office: `office_lat REAL`, `office_lon REAL`, `office_address TEXT`, `office_geocoded`, `office_verified` — **già esistenti** (017). Skip geocoding su `remote_type`/`work_mode` remoti.
- salary: `salary_estimated_min/max/currency/source` — **già esistenti** (001). Ownership → **Analista** (scrive in fase analisi, pre-scoring); Scorer LEGGE per `salary_fit` (⚠️ dev1 verifica che il prompt Scorer non assuma di scriverli lui).

**Soglia "in scadenza"** = calcolata nel WEB da `expires_at` (es. ≤7gg), nessun campo/write extra.

## 🖥️ Sezione WEB (owner dev2)
1. **Position type** (`web/lib/types.ts`): aggiungere `expires_at`, `is_open`, `office_lat`, `office_lon`, `office_address`. (Backend `/api/positions` deve esporli.)
2. **Card dashboard "📅 In scadenza"**: posizioni con `is_open=true AND expires_at <= now+7gg`, ordinate per `expires_at` asc.
3. **Sezione/Archivio "Scadute"**: `is_open=false` → vista archivio (read-only, NON delete). Bucket "cancellabile" evidenziato = `is_open=false AND applied=false` (le applied-scadute restano). Delete vero = cleanup differito futuro, NON in questo scope.
4. **Filtro deadline** in `PositionsFilterSidebar.tsx`: daterange / preset "in scadenza" / "scadute".
5. **Mappa**: `JobsGlobe.tsx` esiste → estendere per leggere `office_lat/lon` (verificare cosa usa oggi).
6. **Skill salary-estimate L3** (`agents/_skills/salary-estimate`): implementare L3 web reale + cache TTL30g (riuso `(stack, seniority, country, mode)`).

## 🔎 Correzione stato attuale (analisi indipendente dev1) — RIUSO > reinvento
Skill GIÀ esistenti che la tabella sopra non elencava (vanno **riusate**, non ricreate):
- **`shared/skills/deadline_extract.py`** (F-4 #50): parser robusto JD→ISO (`parse_deadline()`, gestisce ISO / dd-mm-yyyy / "Month dd" EN+IT / "expires in N days"). È IL parser per popolare `expires_at`. Conservativo: ritorna None se non sicuro.
- **`shared/skills/expiration_alerts.py`** (F-4): trova application `ready` con `deadline` entro 3gg → alert anti-spam. Da **estendere** (oggi solo READY apps, non tutte le posizioni; lavora sul `deadline` TEXT).
- **Dato LIVE (219 pos):** `deadline` ha 164 valori non-null ma **solo 3 ISO** — il resto è testo spazzatura (`"non presente"` ecc.). ⇒ `deadline` NON è usabile come campo macchina. Conferma: serve `expires_at` PULITO; e l'analista deve smettere di scrivere `"non presente"` in `deadline` (→ `expires_at=NULL`).

## ⛓️ Sezioni owner dev1 (riempite)

### Migration 038 (dual-schema Postgres + SQLite)
File: `supabase/migrations/038_positions_expiry_tracking.sql` (Postgres). DDL:
```sql
ALTER TABLE positions
  ADD COLUMN IF NOT EXISTS expires_at  DATE,          -- parsata da deadline_extract; NULL = sconosciuta/sempre-aperta
  ADD COLUMN IF NOT EXISTS is_open     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS last_open_check TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_positions_open_expiry ON positions (is_open, expires_at);
```
SQLite `jobs.db` (container): stesse 3 colonne via il meccanismo migration esistente (`shared/skills/db_migrate*.py` / `db_init.py`), ADD COLUMN idempotente (guard su `PRAGMA table_info`). `deadline` TEXT **resta** (raw, da bonificare in backfill). `last_checked` resta (= ultima ANALISI); `last_open_check` è distinto (= ultimo RICHECK apertura).

### agents/analista (nuovi doveri)
- **RULE-12 — Richeck giornaliero apertura.** Nuovo dovere + nuova coda `db_query.py next-for-recheck` (criterio `is_open=true AND (last_open_check IS NULL OR last_open_check < now-24h)`). Per ogni posizione: re-esegui RULE-03 (link-check) **e** confronta `expires_at` con oggi → se link morto OPPURE `expires_at < today` ⇒ `is_open=false` (+ nota). Scrivi sempre `last_open_check=now`.
- **expires_at all'analisi (RULE-04 estesa).** In fase di analisi chiama `deadline_extract.py` sul `jd_text` → scrivi `expires_at` (ISO) o `NULL` (mai `"non presente"`).
- **Office-geocoding di DEFAULT.** Nel main loop, per ogni posizione **non-remota** (`remote_type`/`work_mode` ≠ remote) invoca la skill `office-geocoding` (già esistente) → popola `office_lat/lon/address`. Skip esplicito se remota.
- **Salary ownership.** Pre-pass `salary-estimate` in analisi → scrivi `salary_estimated_min/max/currency/source` (prima dello Scorer).

### agents/scorer (read-only salary — risolve checklist)
VERIFICATO: oggi `scorer.md:100` dice "The Scorer also populates `positions.salary_estimated_*`". Cambio: lo Scorer **LEGGE** i campi (popolati dall'Analista a monte); invoca la skill **solo come fallback** se NULL. Edit lane dev1 (prompt). `salary_fit` invariato.

### agents/capitano (coordinamento Analisti + handoff C-09)
- Coordina/**sostituisce** analisti: se un Analista esce e ci sono code (`next-for-analista` o `next-for-recheck` non vuote) → re-spawn. Mai lasciare il ruolo scoperto.
- **Compiti differenziati**: es. ANALISTA-1 = nuove (`next-for-analista`), ANALISTA-2 = richeck+backfill (`next-for-recheck`). Assegna esplicitamente la coda a ciascuno.
- **Handoff C-09 (da fix#4 dev3)**: su ATTENZIONE-WEEKLY → throttle-to-pace + stop SOLO nuovi spawn finché rientri, **mai** freeze duro.

### Backfill ~219 storiche — RISOLTO: via richeck, non script separato
Il dovere RULE-12 (richeck) pesca per definizione le posizioni con `expires_at NULL` / `office_lat NULL` / `salary_estimated NULL` e le **backfilla organicamente** (re-parsa `expires_at` dal `jd_text`, bonifica i `deadline="non presente"`, geocoda, stima salario). Il Capitano dedica un Analista alla passata di backfill (compito differenziato). Niente script una-tantum.

## 🔀 Split per-file (anti-collisione — lezione pacing-bridge 2026-06-13)
- **dev1**: `supabase/migrations/*`, `jobs.db` schema, `agents/analista/*`, `agents/capitano/*`.
- **dev2**: `web/**`, `agents/_skills/salary-estimate/*`, `agents/_skills/office-geocoding/*` (solo se estensione lato consumo).
- Nessuno tocca i file dell'altro. Crossmerge `origin/master` frequente + commit piccoli.

## ✅ Aperti / da confermare
- [x] dev1: DDL migration finale → **038** (037 = ultima su origin/master); DDL nella sezione sopra.
- [x] dev1: RULE Scorer → VERIFICATO oggi SCRIVE `salary_estimated_*` (scorer.md:100) → passa a READ-ONLY (fallback skill se NULL). Edit `scorer.md` lane dev1.
- [x] Backfill storiche → RISOLTO: organico via RULE-12 richeck (re-parsa `expires_at` dal `jd_text`, bonifica `deadline="non presente"`), niente script una-tantum.
- [x] dev3↔dev1 su `capitano.md` → RISOLTO: dev3 NON tocca `capitano.md` (fix#4 implementato su `compute_metrics`/`pacing-bridge`, commit 8962b60c6); **C-09 è handoff a dev1** = unico owner di `capitano.md`, zero collisione.
- [x] RIUSO: `deadline_extract.py` (parser) + `expiration_alerts.py` (alert) GIÀ esistono → riusare/estendere, non ricreare.
- [ ] dev2: cosa legge oggi JobsGlobe (city-level? office coords?) prima di estenderla.
- [ ] dev2: estendere `expiration_alerts.py`/web a `expires_at`+`is_open` (oggi lavora su `deadline` TEXT, polluto).
