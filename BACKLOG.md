# BACKLOG — Job Hunter Team

Ultimo aggiornamento: 2026-03-15

---

## STATO ATTUALE

**Infrastruttura completata:**
- ✅ Supabase cloud attivo (Frankfurt)
- ✅ Schema PostgreSQL V2 applicato (migrations 001 + 002)
- ✅ Google OAuth funzionante
- ✅ Next.js app (web/) si builda, login funziona
- ✅ CI/CD Vercel pipeline scritta (`.github/workflows/deploy.yml`)
- ✅ Documentazione setup: `docs/supabase-setup.md`
- ✅ Maturità stimata: ~65%

---

## SPRINT CORRENTE — SaaS Platform v1

### 🔴 ALTA PRIORITÀ

#### [JHT-FRONTEND-01] Collegare Dashboard a Supabase (dati reali)
- **File:** `web/app/(protected)/dashboard/page.tsx`
- **Problema:** mostra mock data statici, non legge da Supabase
- **Task:** query alle tabelle `positions`, `scores`, `applications` con il client server-side
- **Riferimento:** `web/lib/supabase/server.ts`, `web/lib/types.ts`

#### [JHT-FRONTEND-02] Collegare Profile Edit a Supabase
- **File:** `web/app/(protected)/profile/edit/page.tsx`
- **Problema:** il form non salva su Supabase (nessuna chiamata a `upsert`)
- **Task:** on submit → `supabase.from('candidate_profiles').upsert(...)` con `user_id = auth.uid()`

#### [JHT-INFRA-01] Configurare Vercel Deploy
- **Problema:** CI/CD pipeline esiste ma mancano i secrets GitHub
- **Task:**
  1. Creare progetto Vercel collegato a `leopu00/job-hunter-team`
  2. Aggiungere secrets GitHub: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
  3. Aggiungere env vars Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`
  4. Testare deploy automatico su push

### 🟡 MEDIA PRIORITÀ

#### [JHT-FRONTEND-03] Pagina Positions (lista posizioni trovate)
- **Task:** nuova pagina `web/app/(protected)/positions/page.tsx`
- Query a `positions` + `scores` per l'utente corrente
- Tabella con: Azienda, Titolo, Score, Status, Link

#### [JHT-FRONTEND-04] Pagina Applications (candidature)
- **Task:** nuova pagina `web/app/(protected)/applications/page.tsx`
- Query a `applications` per l'utente corrente
- Mostra: CV link, CL link, critic score, status (writing/ready/applied)

#### [JHT-BACKEND-01] API layer per agenti → Supabase
- **Contesto:** gli agenti (Scout, Analista, Scorer, Scrittore) attualmente scrivono su SQLite locale
- **Task:** creare `shared/skills/db_supabase.py` — wrapper che usa `supabase-py` invece di sqlite3
  - Stesse funzioni di `db_insert.py` / `db_update.py` / `db_query.py`
  - Legge `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` da `.env`
  - Multi-tenant: ogni operazione include `user_id`

#### [JHT-QA-01] Test E2E piattaforma web
- **Task:** test Playwright che simula login Google → salva profilo → visualizza dashboard
- File: `tests/test_web_platform.py`

### 🟢 BASSA PRIORITÀ

#### [JHT-FRONTEND-05] Pagina Settings (gestione account)
- Email, piano, logout, delete account

#### [JHT-BACKEND-02] Webhook Telegram → Supabase
- Notifiche push quando una posizione raggiunge status `ready`

---

## BUG NOTI (da sprint precedente)

| Bug | Descrizione | Assegnato a |
|-----|-------------|-------------|
| BUG-06 | `db_insert.py score` accetta total=150 (no validazione range) | JHT-BACKEND |
| BUG-07 | `db_update.py position 9999` dice "aggiornata" su ID inesistente | JHT-BACKEND |
| BUG-08 | `db_migrate_v2.py --verify` crasha ZeroDivisionError su DB vuoto | JHT-BACKEND |
| BUG-09 | `db_update.py` mostra "status = ?" nel messaggio di conferma | JHT-BACKEND |
| BUG-10 | `db_query.py stats` mostra "schema: V0" su DB nuovo | JHT-BACKEND |

---

## DATI SUPABASE (per i worker)

```
Project ref:  [in .env.local]
URL:          [in .env.local]
Region:       eu-central-1 (Frankfurt)
Credenziali:  in web/.env.local (NON in git)
```

> Le chiavi e il project ref sono solo in `web/.env.local` (NON versionato) — i worker che ne hanno bisogno devono chiedere al COORD.
