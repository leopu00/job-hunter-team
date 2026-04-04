# BACKLOG — Job Hunter Team

Ultimo aggiornamento: 2026-04-04

---

## VISIONE PRODOTTO

Job Hunter Team diventa un'applicazione desktop scaricabile da chiunque — anche utenti non tecnici.
L'utente scarica un installer (.dmg / .exe / .AppImage), lo installa, e un wizard lo guida nel setup del team.
Da browser, fa login e monitora il team da remoto (es. dal telefono mentre il PC lavora).

**Tre modalità di esecuzione (scelta utente):**

1. **Locale** — il team gira sul computer dell'utente, zero costi extra
2. **Computer dedicato** — un altro PC in rete locale (es. vecchio portatile sempre acceso)
3. **Cloud remoto** — l'app provisiona una VM su un cloud provider (AWS, GCP, Hetzner, ecc.) e ci installa JHT

**Stack decisioni:**

- Desktop app: **Electron** (riusa frontend Next.js, Node.js nativo per agenti, ecosistema maturo per installer/auto-update)
- Web dashboard: **Next.js su Vercel** (pipeline CI/CD già scritta)
- Backend dati: **Supabase** (Frankfurt, già attivo)
- Cloud provisioning: **Multi-provider** (AWS + GCP + Hetzner fin dall'inizio, layer di astrazione con adapter)

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

## ROADMAP — Da Open Source a Prodotto Desktop

### FASE 1 — Consolidamento Web Platform (sprint corrente)

Obiettivo: la web app funziona end-to-end con dati reali.

#### 🔴 ALTA PRIORITÀ

##### [JHT-FRONTEND-01] Collegare Dashboard a Supabase (dati reali)
- **File:** `web/app/(protected)/dashboard/page.tsx`
- **Problema:** mostra mock data statici, non legge da Supabase
- **Task:** query alle tabelle `positions`, `scores`, `applications` con il client server-side
- **Riferimento:** `web/lib/supabase/server.ts`, `web/lib/types.ts`

##### [JHT-FRONTEND-02] Collegare Profile Edit a Supabase
- **File:** `web/app/(protected)/profile/edit/page.tsx`
- **Problema:** il form non salva su Supabase (nessuna chiamata a `upsert`)
- **Task:** on submit → `supabase.from('candidate_profiles').upsert(...)` con `user_id = auth.uid()`

##### [JHT-INFRA-01] Configurare Vercel Deploy
- **Problema:** CI/CD pipeline esiste ma mancano i secrets GitHub
- **Task:**
  1. Creare progetto Vercel collegato a `leopu00/job-hunter-team`
  2. Aggiungere secrets GitHub: `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`
  3. Aggiungere env vars Vercel: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`
  4. Testare deploy automatico su push

#### 🟡 MEDIA PRIORITÀ

##### [JHT-FRONTEND-03] Pagina Positions (lista posizioni trovate)
- **Task:** nuova pagina `web/app/(protected)/positions/page.tsx`
- Query a `positions` + `scores` per l'utente corrente
- Tabella con: Azienda, Titolo, Score, Status, Link

##### [JHT-FRONTEND-04] Pagina Applications (candidature)
- **Task:** nuova pagina `web/app/(protected)/applications/page.tsx`
- Query a `applications` per l'utente corrente
- Mostra: CV link, CL link, critic score, status (writing/ready/applied)

##### [JHT-BACKEND-01] API layer per agenti → Supabase
- **Contesto:** gli agenti (Scout, Analista, Scorer, Scrittore) attualmente scrivono su SQLite locale
- **Task:** creare `shared/skills/db_supabase.py` — wrapper che usa `supabase-py` invece di sqlite3
  - Stesse funzioni di `db_insert.py` / `db_update.py` / `db_query.py`
  - Legge `SUPABASE_URL` e `SUPABASE_SERVICE_KEY` da `.env`
  - Multi-tenant: ogni operazione include `user_id`

##### [JHT-QA-01] Test E2E piattaforma web
- **Task:** test Playwright che simula login Google → salva profilo → visualizza dashboard
- File: `tests/test_web_platform.py`

#### 🟢 BASSA PRIORITÀ

##### [JHT-FRONTEND-05] Pagina Settings (gestione account)
- Email, piano, logout, delete account

##### [JHT-BACKEND-02] Webhook Telegram → Supabase
- Notifiche push quando una posizione raggiunge status `ready`

---

### FASE 2 — App Desktop Electron

Obiettivo: un installer scaricabile che rende JHT usabile da chiunque.

#### [JHT-DESKTOP-01] Scaffolding progetto Electron
- Creare `desktop/` nella root del progetto
- Setup electron-forge o electron-builder
- Integrare il frontend Next.js esistente (web/) come renderer
- Il processo main di Electron gestisce il lifecycle degli agenti

#### [JHT-DESKTOP-02] Setup Wizard integrato
- Wizard first-run nell'app: lingua, profilo candidato, API key (o Claude Max detection)
- Genera `jht.config.json` e `candidate_profile.yml` tramite UI guidata
- Nessun terminale necessario — tutto da interfaccia grafica

#### [JHT-DESKTOP-03] Gestione agenti come processi background
- L'app Electron avvia/ferma gli agenti come child process Node.js
- Sostituire la dipendenza da tmux con process management nativo (cross-platform)
- Tray icon con stato del team (icona verde/giallo/rosso)
- Notifiche desktop native (posizione trovata, candidatura pronta, errore)

#### [JHT-DESKTOP-04] Auto-install dipendenze
- Al primo avvio, l'app verifica e installa silenziosamente le dipendenze necessarie
- Node.js bundlato con Electron, Python embedded o rilevato dal sistema
- Progress bar durante l'installazione iniziale
- Nessun requisito manuale per l'utente

#### [JHT-DESKTOP-05] Installer cross-platform e auto-update
- Build con electron-builder: .dmg (macOS), .exe NSIS (Windows), .AppImage + .deb (Linux)
- Code signing per macOS e Windows (evitare warning "app non verificata")
- Auto-update via electron-updater (check update al lancio, install silenzioso)
- Release tramite GitHub Releases

#### [JHT-DESKTOP-06] Modalità "Computer dedicato"
- Dall'app, opzione per configurare un altro PC in rete locale come runner
- Discovery automatico via mDNS/Bonjour o IP manuale
- SSH-based setup: l'app installa JHT sul PC remoto via SSH
- Dashboard mostra lo stato del team remoto in tempo reale

---

### FASE 3 — Cloud Provisioning Multi-Provider

Obiettivo: l'utente clicca un bottone e JHT gira su un server cloud.

#### [JHT-CLOUD-01] Layer di astrazione provisioning
- Creare `shared/cloud/` con interfaccia `CloudProvider`
- Metodi: `provision()`, `deploy()`, `status()`, `destroy()`, `ssh()`
- Ogni provider implementa questa interfaccia

#### [JHT-CLOUD-02] Adapter AWS EC2
- Provisioning EC2 instance (t3.small o simile)
- Security group con porte necessarie (SSH, HTTPS, API gateway)
- User data script che installa JHT automaticamente
- Gestione lifecycle: start, stop, terminate, resize

#### [JHT-CLOUD-03] Adapter Google Cloud (GCE)
- Compute Engine instance provisioning
- Firewall rules equivalenti
- Startup script per auto-install JHT

#### [JHT-CLOUD-04] Adapter Hetzner Cloud
- Hetzner Cloud API per server provisioning
- Opzione EU-only per compliance GDPR
- Costo più basso dei tre (~€4-5/mese per CX22)

#### [JHT-CLOUD-05] UI Cloud nell'app desktop
- Pagina "Scegli dove far girare il team" nel wizard
- Inserimento credenziali cloud provider (API key)
- Stima costi in tempo reale per provider
- One-click deploy, monitoring, e teardown
- Billing alert: notifica quando i costi superano una soglia

#### [JHT-CLOUD-06] Tunnel sicuro app ↔ cloud
- Connessione sicura tra app desktop e VM cloud (WireGuard o SSH tunnel)
- La dashboard locale mostra i dati del team remoto in tempo reale
- Fallback: la web dashboard su Vercel come alternativa per il monitoring

---

### FASE 4 — Internazionalizzazione Completa

Obiettivo: la piattaforma parla la lingua dell'utente. Inglese come lingua principale.

#### [JHT-I18N-01] Inglese come lingua principale
- Convertire tutta l'interfaccia web, desktop app, e documentazione in inglese come lingua di default
- L'italiano diventa seconda lingua (già supportato in `shared/i18n/`)
- Aggiornare README.md, docs/, e tutti i testi user-facing in inglese
- Il modulo `shared/i18n/` già supporta it/en con fallback — estendere le chiavi per coprire tutte le nuove pagine (desktop wizard, cloud setup, ecc.)

#### [JHT-I18N-02] Infrastruttura per lingue aggiuntive
- Refactor `shared/i18n/translations.ts` per caricare traduzioni da file separati per lingua (es. `locales/en.json`, `locales/it.json`)
- Aggiungere language switcher nell'app desktop e nella web dashboard
- Selezione lingua nel setup wizard (primo step)

#### [JHT-I18N-03] Espansione lingue future
- Framework pronto per contribuzioni community (file JSON per lingua)
- Priorità lingue successive: spagnolo, tedesco, francese, portoghese
- Documentazione per traduttori: guida su come aggiungere una nuova lingua

---

### FASE 5 — Sito Web Pubblico e Distribuzione

Obiettivo: landing page, download, onboarding per utenti non tecnici.

#### [JHT-WEB-01] Landing page pubblica (in inglese)
- Pagina marketing: cosa fa JHT, come funziona, download
- Sezioni: hero, features, come funziona (3 step), download, FAQ
- Responsive, ottimizzata per SEO

#### [JHT-WEB-02] Pagina download con rilevamento OS
- Rileva automaticamente il sistema operativo del visitatore
- Bottone principale per il download corretto (.dmg / .exe / .AppImage)
- Link alternativi per altri OS
- Checksum SHA256 per verifica integrità

#### [JHT-WEB-03] Documentazione utente (non-dev, in inglese)
- Guide visuali: "How to install JHT", "How to set up your profile", "How to start the team"
- Screenshot dell'app desktop
- FAQ per problemi comuni
- Video tutorial (opzionale, fase successiva)
- Versione italiana come seconda lingua

#### [JHT-WEB-04] Dominio e DNS
- ✅ Dominio acquistato: **jobhunterteam.ai** (Cloudflare, $80/anno)
- ✅ DNS configurato: record A → 216.198.79.1 (Vercel), DNS only (no proxy)
- ✅ Dominio collegato a Vercel (progetto job-hunter-team), SSL auto-generato
- ✅ Supabase ripristinato e attivo (Frankfurt, eu-central-1)
- ✅ Supabase Auth: Site URL aggiornato a `https://jobhunterteam.ai`, redirect URL aggiunto
- Sottodomini previsti: `app.jobhunterteam.ai` (dashboard), `docs.jobhunterteam.ai` (documentazione), `api.jobhunterteam.ai` (gateway)

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
