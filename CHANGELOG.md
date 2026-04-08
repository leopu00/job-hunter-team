# Changelog

Tutte le modifiche notevoli a questo progetto sono documentate in questo file.
Formato basato su [Keep a Changelog](https://keepachangelog.com/it/1.0.0/).

---

## [0.1.5] — pending release

### Web app
- AI Assistant completo con endpoint server, pagina dedicata e floating chat condivisa
- Nuova pagina pubblica `/project` e riallineamento della landing hero con CTA, auth e footer coerenti
- Banner cookie coerente su pagine marketing e login, piu fix su download e route marketing

### TUI
- Home panel e opening banner rivisti
- Wizard profilo migliorato con bozza persistente, validazioni e inizializzazione workspace piu robusta

### CI, test e tooling
- Fix cross-platform per Git Bash su Windows e shutdown dei processi shell
- Workflow CI/test riallineati alle dipendenze reali del progetto
- Suite Vitest finale aggiornata al nuovo assistant, a `/project` e ai redirect intenzionali

### Release prep
- Versioni allineate a `0.1.5` in tutti i package tracciati del monorepo
- Metadati visibili nell'interfaccia allineati alla prossima release
- Workflow release predisposto per leggere le note curate dal changelog

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
