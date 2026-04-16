# Changelog

Tutte le modifiche notevoli a questo progetto sono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

---

## [0.1.12] — 2026-04-17

### Fix

- **Bundle**: il DMG/EXE della v0.1.11 crashava al primo avvio con `Cannot find module './docker-installer'` perché il campo `build.files` in `desktop/package.json` è una whitelist esplicita e i nuovi moduli (`disk-space.js`, `docker-installer/**`) non erano stati inclusi. Aggiunti alla lista; i `*.test.js` dei nuovi moduli sono esplicitamente esclusi dal bundle di release.

Nessun'altra modifica funzionale rispetto a v0.1.11: è un bugfix dell'installazione.

---

## [0.1.11] — 2026-04-17

Release focalizzata sulla riscrittura dell'esperienza del launcher desktop in base al 2° round di test E2E su Windows ARM64 (vedi `e2e-runs/2026-04-17-windows-arm64-round2/`).

### Desktop launcher — riscrittura wizard

- **UI step-based** al posto della pagina unica scrollabile: quattro step discreti — Welcome → Setup → Ready → Running — ognuno con un solo pulsante primario. Il log tecnico non è più visibile di default, sta dietro una disclosure "Dettagli tecnici" nello step Running
- **Topbar "Alpha · in fase di test"** persistente in tutti gli step, così l'utente sa sempre lo stato del prodotto
- **Checklist dipendenze essenziale**: la schermata Setup mostra solo Docker (unica dipendenza obbligatoria in container mode). Node/Git/Python sono rimossi dalla superficie principale
- **Start bloccato** finché Docker non è pronto: il pulsante "Avvia Job Hunter Team" compare solo dallo step Ready, e Ready è raggiungibile solo dopo che la checklist è verde

### Setup wizard — gestione dipendenze

- **Stato Docker a tre valori**: `ok` (pronto), `needs-reboot` (binary presente ma `docker ps` non risponde — tipicamente utente ha installato Docker Desktop ma non ha riavviato), `missing` (non installato)
- **Flusso install manuale guidato**: quando Docker manca, un pulsante "Scarica installer" apre la pagina ufficiale `docker.com/products/docker-desktop/` nel browser di default. L'utente installa, (se necessario) riavvia, torna al launcher e preme "Ho installato, ricontrolla" / "Ho riavviato, ricontrolla"
- **Pre-install preview**: prima di installare, la card Docker mostra peso stimato dell'installazione e spazio libero sul disco dell'utente (via `powershell Get-PSDrive` su Windows, `fs.statfs`/`df` su Unix — zero dipendenze npm aggiuntive)
- Nuovo modulo `desktop/docker-installer/` con `manifest` (strategia per OS), `check` (status a tre valori), `download-url` (URL ufficiale per OS). Policy rispettata: su macOS la strategia è Colima via Homebrew (NON Docker Desktop); su Linux è `get.docker.com`; solo su Windows è Docker Desktop

### IPC

- Nuovo canale `setup:get-docker-status` → `{platform, arch, strategy, check, disk}`
- Nuovo canale `setup:open-docker-download-page` → apre URL ufficiale Docker in browser
- Esposti al renderer come `window.setupApi`

### Note

- **F4** (installer Windows si chiude al 1° tentativo, round 1): non affrontato in questa release, ancora aperto
- Il precedente `launcher:open-external` con whitelist HTTP resta per uso generico; il nuovo `setup:open-docker-download-page` è un endpoint dedicato che non espone URL arbitrari

---

## [0.1.10] — 2026-04-16

Release focalizzata sui friction point emersi dai test E2E manuali su Windows ARM64 e macOS (vedi `e2e-runs/2026-04-16-windows-arm64-parallels/` e `e2e-runs/2026-04-16-macos-dev-machine/`).

### Desktop launcher
- Nuova **checklist dipendenze** in-app che rileva Docker, Node (≥20), Git e Python con hint di installazione per OS; Start è bloccato finché le dipendenze obbligatorie non sono OK — fix al gap UX trovato durante i test (app non segnalava nulla se mancava Docker)
- **Thin launcher**: rimosso `extraResources: app-payload` da electron-builder; il payload (webapp) viene scaricato in `userData/app-payload` al primo Start via git sparse-checkout e aggiornabile da UI. Dimensioni `JHT Desktop.app` da ~300 MB a footprint più leggero; niente re-download dell'installer per ogni update della webapp
- Nuovo pulsante "Come installare" per ogni dipendenza mancante, apre la doc ufficiale in browser
- `launcher:open-external` IPC handler con whitelist http/https

### macOS code signing & notarization
- Config electron-builder con `hardenedRuntime: true`, `notarize: true`, `desktop/build/entitlements.mac.plist` (set minimale: JIT, unsigned-executable-memory, network.client)
- Workflow release importa cert da `MACOS_CERTIFICATE` + `MACOS_CERTIFICATE_PWD`, passa `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` a `@electron/notarize`
- Verifica post-build con `codesign -dv --verbose=4` e `spctl --assess` — fallisce il job mac se Gatekeeper non accetta il DMG
- Fallback a build **unsigned** quando i secrets mancano (warning, build non fallisce → altri OS pubblicano comunque)
- Playbook maintainer in `docs/release.md` con tutti gli step: CSR → `.p12` → base64, App-Specific Password, Team ID, rotazione certificato

### Release pipeline
- Nuovo `scripts/check-release-version.sh` come **primo job CI**: verifica che tag git (`vX.Y.Z`), `package.json` root e `desktop/package.json` siano sulla stessa versione. Blocca la release con exit non-zero se c'è mismatch — fix al bug visto in v0.1.8 (tag `v0.1.8` con asset nominati `0.1.7` perché `desktop/package.json` non era stato bumpato)
- Pre-release checklist per il maintainer in `docs/release.md`

### Windows
- **Build ARM64 nativa**: `desktop/package.json` ora produce sia `job-hunter-team-<ver>-windows-x64.exe` sia `job-hunter-team-<ver>-windows-arm64.exe`. Prima c'era solo x64 → su Windows ARM (Surface, Snapdragon, VM Apple Silicon) girava in emulazione

### Download page
- `/download` rileva OS e architettura dell'utente **server-side via User-Agent** (`Windows NT ... ARM64` / `aarch64`, `Mac OS X` → default arm64, `Linux`)
- Mostra una sola CTA primaria con link diretto all'asset corretto della **ultima release** (fetched via `api.github.com/repos/.../releases/latest` con `revalidate: 300`)
- "Altre opzioni" collassabile per gli altri OS/arch
- **Niente più redirect a GitHub Releases** — l'utente resta su `jobhunterteam.ai`
- API `/api/download` riorganizzata attorno al concetto di "variant" (id + arch), backward-compatible con il campo `platforms`

### CLI install
- `scripts/install.sh --dry-run` stampa ogni comando che verrebbe eseguito senza toccare il sistema (utile per debug e pairing)
- `setup.ps1` allineato a `install.sh` sui dependency checks (parità minima, non è un rewrite completo)
- Nuovo `docs/cli-install.md` con descrizione AS-IS dello script e sezione "tested environments"

### Known issues (non risolti in questa release)
- **F4**: installer Windows si chiude silenziosamente dopo la 2ª schermata al **primo** doppio click (al secondo tentativo parte regolare). Root cause non identificata — va riprodotta su VM fresca guardando Event Viewer e `%TEMP%\nsis*.log`. Documentato in `e2e-runs/2026-04-16-windows-arm64-parallels/README.md`

---

## [0.1.9] — 2026-04-11

### Auth
- Aggiunto login **GitHub OAuth** come secondo provider accanto a Google, target developer e contributor open source
- Whitelist `avatars.githubusercontent.com` in `next/image` e nel CSP `img-src` per evitare il crash della dashboard al primo login GitHub

### Cloud Sync (opt-in)
- Nuova tabella `cloud_sync_tokens` (migration 006) con RLS per-user, hash SHA-256 del token e soft-delete via `revoked_at`
- API CRUD `/api/cloud-sync/tokens` (GET lista, POST crea, DELETE revoca) — il token in chiaro viene restituito una sola volta al momento della creazione
- Pagina `/settings/cloud-sync` per generare, copiare e revocare i token; ogni token ha un nome leggibile per identificare il dispositivo (es. "MacBook Leone", "Linux cron")
- Endpoint `/api/cloud-sync/ping` per verifica Bearer token (usa service-role admin client per bypassare RLS), aggiorna `last_used_at` a ogni verifica
- CLI commands `jht cloud enable/status/disable` — `enable` valida il token contro `/api/cloud-sync/ping` e lo persiste in `~/.jht/cloud.json` (chmod 0600); `--url` supporta self-hosted e sviluppo locale
- Nuovo helper `web/lib/supabase/admin.ts` per client service-role usato solo lato server
- Migration 007: constraint `UNIQUE (user_id, legacy_id)` su `positions` per permettere upsert atomico delle righe sincronizzate da SQLite locale
- Endpoint `POST /api/cloud-sync/push` che accetta batch di `positions/scores/applications`: upsert idempotente di positions via `legacy_id`, build del mapping legacy_id → UUID, upsert di scores e applications con i nuovi UUID come FK. Normalizzazione di `status` e `critic_verdict` contro le enum Supabase
- CLI command `jht cloud push` che legge SQLite tramite `node:sqlite` built-in (richiede Node 22.5+, zero native deps), supporta `--db <path>` e `--dry-run`, gestisce gracefully database/tabelle mancanti
- Nuovo helper `web/lib/cloud-sync/auth.ts` con `verifyBearerToken` condiviso tra ping e push
- Nota operativa: la env var `SUPABASE_SERVICE_ROLE_KEY` deve essere configurata su Vercel (Production + Preview) perché gli endpoint cloud-sync funzionino in prod

### Docker Runtime (default-on)
- Nuovo `Dockerfile` root + `docker-compose.yml` per il runtime container JHT, pubblicato come `ghcr.io/leopu00/jht:latest` (multi-arch amd64+arm64)
- Nuovo workflow GitHub Actions per build e push automatici su GHCR
- Runtime node bumpato a **Node 22 LTS** per compatibilità con `node:sqlite` built-in usato dal cloud-sync
- Bootstrap automatico di `shared/` modules e build TUI dentro il container, `dashboard` wired come PID 1
- `isContainer()` gate (env `IS_CONTAINER=1` o `/.dockerenv`) in tutti i call site di `open/xdg-open/explorer`: invece di lanciare il browser dal container, la CLI stampa path/URL
- Contratto bind mount: `~/.jht → /jht_home`, `~/Documents/Job Hunter Team → /jht_user`

### Installer
- `install.sh` riscritto **Docker-by-default**: installa il runtime (Colima su macOS, docker.io su Linux/WSL2), pulla l'immagine GHCR, crea wrapper `jht` in `~/.local/bin` che fa `docker run` con il contratto standard
- Opt-out con `curl ... | bash -s -- --no-docker` per modalità nativa (expert mode)
- `install.sh` ora servito come **asset statico Vercel**: `curl -fsSL https://jobhunterteam.ai/install.sh | bash`
- Wrapper compatibile con bash 3.2 (macOS system bash)
- Fix `--help` line range e leak di `set -e`
- Hint `cancel-wizard` aggiornato a `jht setup`

### Desktop Launcher
- Electron launcher ora spawna `docker run ghcr.io/leopu00/jht:latest dashboard --no-browser` invece del native next dev
- Bootstrap automatico di Colima su macOS al primo avvio
- `JHT_NO_DOCKER=1` per fallback in modalità nativa (debug/sviluppo)

### Fix
- **Build Vercel**: `next.config.ts` ora imposta esplicitamente `outputFileTracingRoot` e `turbopack.root` alla root del monorepo, con `outputFileTracingExcludes` per skippare `cli/`, `desktop/`, `tui/`, `agents/`, `e2e/`, `scripts/`, ecc. Questo risolve il limite di 250 MB unzipped per Serverless Function che altrimenti includeva tutto il monorepo
- **Assistente page**: rimosso blocco JSX orfano `{workspace && (...)}` rimasto dopo il refactor che ha rimosso lo state `workspace` (build rotta con `Cannot find name 'workspace'`)
- **Banner download**: rimosso il banner giallo "asset pending" dalla pagina `/download` (obsoleto dopo il rilascio dei pacchetti desktop)
- **Fix post-merge path refactor**: consistency sui path centralizzati su `JHT_HOME`

---

## [0.1.8] — 2026-04-10

### Fix
- Aggiunto `overrides` per `@swc/helpers` nel `package.json` per risolvere conflitti di dipendenze durante `npm ci` nel workflow di release

---

## [0.1.7] — 2026-04-10

### Web app
- Rimossa di nuovo dalla home la landing deprecated rientrata durante il recovery della `0.1.6`, mantenendo la versione semplificata prevista per il live
- Riallineata la pagina iniziale al set di sezioni effettivamente supportato in produzione

### Release e deploy
- Corretto il flusso di verifica Vercel in CI, che ora controlla il progetto Git collegato anche senza metadata locali `.vercel`
- Bloccata la pubblicazione di tag release che non puntano all'HEAD corrente di `production`
- Aggiunto workflow dedicato per creare il tag release direttamente dall'HEAD di `production`

## [0.1.6] — 2026-04-09

### Web app
- Rientrodotto il layer i18n completo con supporto `it` / `en` / `hu`, fallback piu robusti e persistenza lingua corretta tra API, landing e dashboard
- Riallineate landing, pagina `/project`, download e chrome dell'app con metadata e contenuti coerenti alla release corrente
- Ripristinati messaggi, layout e loading state tradotti nelle principali pagine protette e pubbliche

### TUI
- Nuovo setup wizard con flusso verticale pulito, file picker corretto e navigazione delle select ripristinata
- Aggiunto sistema auth multi-provider con supporto OpenAI OAuth PKCE, API key e storage credenziali cifrato
- Rifinita l'integrazione del wizard con provider, metodo di autenticazione e bootstrap workspace

### Desktop, test e tooling
- Aggiornato il payload desktop standalone e la preparazione runtime per packaging locale
- Sistemati test e script runtime collegati al launcher desktop e alla documentazione di setup
- Versioni e metadati visibili allineati a `0.1.6` in tutti i package tracciati del monorepo

## [0.1.4] — 2026-04-08

### Accesso web e setup
- Login web riorganizzato con accesso cloud-first e fallback immediato al workspace locale
- Aggiunta `NEXT_PUBLIC_APP_URL` per comporre correttamente il redirect OAuth in ambienti deployati
- Ignorati file temporanei Supabase e log locali del dev server

### TUI
- Nuovo profilo guidato con validazioni, checkpoint e banner di setup iniziale
- Vista team ripulita con layout orizzontale, banner ASCII corretto e comando `/workspace`
- Migliorati prompt, esempi e redraw del wizard profilo

### Sito pubblico
- Landing semplificata e resa piu leggibile nelle sezioni hero e CTA
- Pulizia diffusa delle pagine marketing e forte riduzione del contenuto nella pagina stats

## [0.1.3] — 2026-04-08

### Desktop Windows
- Alleggerito il payload web incluso nell'installer desktop, copiando solo asset e dipendenze di produzione
- Rimossi cache e sourcemap dal payload pacchettizzato per ridurre dimensione e tempi di installazione su Windows
- Confermato localmente il build `nsis` con installer Windows sensibilmente più piccolo

## [0.1.2] — 2026-04-08

### Release desktop
- Aggiunti i metadati richiesti da `electron-builder` per il pacchetto Linux `.deb`
- Confermato il packaging Windows `.exe` e macOS `.dmg` nel workflow release
- Preparata la release desktop cross-platform pubblicabile via GitHub Actions

## [0.1.1] — 2026-04-08

### Release desktop
- Allineate tutte le versioni `package.json` e `package-lock.json` a `0.1.1`
- Confermato il packaging desktop Electron per macOS, Windows e Linux
- Workflow GitHub Release pronto a pubblicare installer reali `.dmg`, `.exe`, `.AppImage` e `.deb`
- Pagina download e API leggono gli asset effettivi della latest release invece di assumere archivi legacy

## [0.1.0] — 2026-04-04

### Pipeline multi-agente
- Scout, Analista, Scorer, Scrittore, Critico, Sentinella, Alfa (Capitano)
- Agent runner con tool loop, abort e gestione errori
- Database SQLite condiviso con anti-collision tra agenti

### CLI `jht`
- Setup wizard interattivo con `@clack/prompts`
- `jht team start/stop` con prefisso sessioni JHT- per compatibilità TUI
- `jht status`, `jht config show`, `jht cron list`
- `jht export/import` (JSON/CSV, dry-run, merge/replace)
- `jht health` (7 moduli con semafori)
- `jht backup/restore` con manifest e retention
- `jht migrate` (versioning config con dry-run)
- `jht logs`, `jht providers`, `jht stats`
- `jht plugins`, `jht agents`

### TUI (Terminal UI)
- Navigazione multi-agente con `@mariozechner/pi-tui`
- Chat panel con streaming, tool messages, thinking blocks
- Contatore sessioni tmux attive in tempo reale
- Ctrl+C singolo per uscire

### Web Dashboard (50+ pagine)
- Pipeline: agenti, sessioni, candidature, analytics
- Infrastruttura: health, retry/circuit-breaker, rate-limiter, queue, events SSE
- Configurazione: settings, credentials, plugins, tools, templates, providers, memory
- Sistema: overview, gateway, channels, notifications, cron, daemon, deploy
- Import/export dati, backup, migrazioni, i18n it/en

### Shared modules
- `config/` — schema Zod, I/O centralizzato
- `llm/` — factory Claude, OpenAI, MiniMax
- `sessions/` — registry con persistenza JSON
- `hooks/` — source precedence, loader frontmatter
- `events/` — event bus pub/sub tipizzato
- `plugins/` — discovery, lifecycle, toggle
- `context-engine/` — raccolta e prioritizzazione contesto LLM
- `rate-limiter/`, `retry/` — circuit breaker 3 stati
- `queue/` — dead-letter, retry backoff esponenziale+jitter
- `templates/` — variabili, sezioni con budget caratteri
- `notifications/` — registry adapter multi-canale
- `analytics/` — token usage, latenza p95, costi provider
- `credentials/` — AES-256-GCM, OAuth
- `memory/` — SOUL/IDENTITY/MEMORY
- `history/`, `tasks/`, `validators/`, `migrations/`, `backup/`, `cache/`, `i18n/`

### Testing
- 736+ test case su 168 file (vitest)
- Test unitari, integrazione, E2E CLI e web (Playwright)

### CI/CD
- GitHub Actions: lint, type-check, vitest matrix, build, deploy Vercel
- Security: npm audit, gitleaks, Semgrep SAST
- Dependabot per npm e GitHub Actions
- PR template, issue templates, CONTRIBUTING.md
