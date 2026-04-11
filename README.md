<p align="center">
  <img src="assets/banner.png" alt="Job Hunter Team — Your AI-Powered Job Search Team" width="100%" />
</p>

<h1 align="center">Job Hunter Team</h1>

<p align="center">
  <strong>Il tuo team di agenti AI che cerca lavoro per te.</strong><br/>
  7 agenti autonomi — dalla scoperta di posizioni alla scrittura di CV e cover letter su misura.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/stargazers"><img src="https://img.shields.io/github/stars/leopu00/job-hunter-team?style=social" alt="GitHub Stars" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/network/members"><img src="https://img.shields.io/github/forks/leopu00/job-hunter-team?style=social" alt="GitHub Forks" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/issues"><img src="https://img.shields.io/github/issues/leopu00/job-hunter-team" alt="Issues" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/commits/master"><img src="https://img.shields.io/github/last-commit/leopu00/job-hunter-team" alt="Last Commit" /></a>
</p>

<p align="center">
  <a href="#il-team">Il Team</a> ·
  <a href="#architettura">Architettura</a> ·
  <a href="#installazione">Installazione</a> ·
  <a href="#utilizzo">Utilizzo</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="https://jobhunterteam.ai">Website</a>
</p>

---

Punta il sistema al tuo profilo, avvia il team e revisiona solo le candidature che superano il quality bar. Ogni agente è specializzato in un compito preciso: lo Scout trova le posizioni, l'Analista le valuta, lo Scorer le classifica, lo Scrittore prepara i documenti, e il Critico controlla tutto prima dell'invio.

---

## Il Team

| | Agente | Ruolo |
|---|--------|-------|
| 🕵️ | **Scout** | Cerca posizioni su job board EU e remote |
| 👨‍🔬 | **Analista** | Verifica job description, aziende e cultura aziendale |
| 👨‍💻 | **Scorer** | Assegna punteggio 0–100 rispetto al tuo profilo |
| 👨‍🏫 | **Scrittore** | Genera CV e cover letter personalizzati per ogni posizione |
| 👨‍⚖️ | **Critico** | Blind review in 3 round obbligatori prima dell'invio |
| 👨‍✈️ | **Capitano** | Coordina la pipeline e gestisce l'anti-collision fra agenti |
| 💂 | **Sentinella** | Monitora token, rate limit, costi API e stato del team |

---

## Architettura

```
                      👨‍✈️ Capitano
                            |
          +-----------------+-----------------+
          |                 |                 |
      🕵️ Scout        👨‍💻 Scorer        💂 Sentinella
          |                 |
      👨‍🔬 Analista    👨‍🏫 Scrittore
                            |
                       👨‍⚖️ Critico
                            |
                     Pronto per invio
```

Ogni agente è una sessione Claude Code autonoma con un file `CLAUDE.md` dedicato che ne definisce personalità, competenze e regole operative. Il Capitano coordina l'intera pipeline via tmux e un database SQLite condiviso per sincronizzare lo stato fra gli agenti.

### Interfacce

| Interfaccia | Avvio | Stack |
|-------------|-------|-------|
| **Web Dashboard** | `cd web && npm run dev` | Next.js · 56 pagine |
| **Desktop Launcher** | `JHT Desktop` | Installer `.dmg/.exe/.AppImage/.deb` · runtime locale · browser su `localhost` |
| **CLI** | `jht team start` | Node.js · 15+ comandi |
| **TUI** | `jht tui` | Terminal UI interattiva |
| **Telegram** | Bot bridge bidirezionale | Grammy |

### Stack tecnologico

| Layer | Tecnologie |
|-------|-----------|
| **Agenti** | Claude Code sessions · tmux · SQLite |

## Runbook

- [Quickstart](docs/quickstart.md)
- [Supabase Setup](docs/supabase-setup.md)
- [Feedback Ticketing](docs/feedback-ticketing.md)
| **Backend** | Node.js · TypeScript · Zod |
| **Frontend** | Next.js · Tailwind CSS |
| **Database** | Supabase (PostgreSQL, Frankfurt) · SQLite (locale) |
| **Auth** | Google OAuth · credenziali AES-256 |
| **LLM** | Claude · OpenAI · Minimax (factory pattern) |
| **CI/CD** | GitHub Actions · 6 workflow · Vercel |
| **Test** | Vitest · 800+ test case · 168 file |

---

## Moduli

### `shared/` — Core

| Categoria | Moduli |
|-----------|--------|
| **Agenti** | `agents/` runner e tool loop · `sessions/` persistenza e registry · `memory/` identità e anima (SOUL/IDENTITY/MEMORY) · `context-engine/` prioritizzazione contesto LLM |
| **Orchestrazione** | `config/` config centralizzata Zod · `hooks/` hook system con precedence · `events/` pub/sub tipizzato · `plugins/` discovery e lifecycle · `queue/` job queue con dead-letter |
| **LLM e Resilienza** | `llm/` astrazione multi-provider · `rate-limiter/` fixed-window e backoff · `retry/` circuit breaker 3 stati · `tools/` tool registry e bash executor |
| **Comunicazione** | `gateway/` HTTP multi-agente · `channels/` Web, CLI, Telegram · `telegram/` bridge Grammy · `notifications/` multi-canale |
| **Dati** | `templates/` prompt con frontmatter · `analytics/` token, costi, p95 · `validators/` schema Zod · `history/` buffer conversazioni · `credentials/` AES-256 |
| **Infra** | `logger/` JSON strutturato · `cron/` scheduler · `deploy/` health-check e monitor · `daemon/` servizio di sistema · `backup/` restore con retention · `migrations/` versioning e rollback · `i18n/` it/en |

### Interfacce

| Modulo | Descrizione |
|--------|-------------|
| `cli/` | CLI `jht` — setup, config, status, team, cron, export, backup |
| `tui/` | Terminal UI — lista agenti, chat live, status bar |
| `web/` | Dashboard Next.js — 56 pagine: pipeline, agenti, sessioni, task, analytics, config |

---

## Installazione

### Installer one-liner (macOS / Linux / WSL)

```bash
# Default: gli agenti girano in container, isolati dal filesystem host
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

Lo script rileva il sistema, installa il runtime container (**Colima** su macOS, **docker.io** su Linux/WSL2), scarica l'immagine ufficiale `ghcr.io/leopu00/jht:latest` e crea un wrapper `jht` in `~/.local/bin` che fa `docker run` con due sole cartelle bind-mountate dall'host:

- `~/.jht/` → `/jht_home` — zona nascosta: config, database, agenti, credenziali. **Non toccare.**
- `~/Documents/Job Hunter Team/` → `/jht_user` — zona visibile: droppa qui i tuoi CV (`cv/`), allegati (`allegati/`) e leggi gli output generati (`output/`).

Tutto il resto del filesystem **non e' visibile** agli agenti.

Per aggiornare: ri-esegui il comando curl sopra.

#### Modalita' nativa (expert mode)

> ⚠️ **Senza container, gli agenti AI girano con `--dangerously-skip-permissions` e hanno accesso completo al tuo filesystem.** Usa questa modalita' solo se sai cosa stai facendo o se hai dedicato un PC/VM al solo JHT.

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --no-docker
```

In questa modalita' lo script installa Node 20+, tmux, git, Claude CLI, clona la repo in `~/.jht/src`, compila TUI/CLI e crea un simlink `jht` in `~/.local/bin`.

### Desktop Launcher

- **macOS**: pacchetto `.dmg` (Colima incluso, niente Docker Desktop)
- **Windows**: installer `.exe` (NSIS)
- **Linux**: `.AppImage` e `.deb`

Scarica il pacchetto corretto dalla pagina [`/download`](https://jobhunterteam.ai/download) o da GitHub Releases.

Il launcher avvia automaticamente il runtime container `ghcr.io/leopu00/jht:latest` con i mount/env del contratto e apre la dashboard nel browser. Su macOS bootstrappa Colima al primo avvio se non e' gia' attivo. Per disattivare il container e cadere in modalita' nativa (debug / sviluppo): avvia con `JHT_NO_DOCKER=1`.

### Installazione da Sorgente (per contribuire)

Questa modalita e pensata per sviluppo locale, hacking del repo e PR.

**Prerequisiti:**

- **Node.js** 20+ e npm
- **tmux** (Linux/macOS) — WSL2 + tmux su Windows
- **git**
- **Claude CLI** (`npm install -g @anthropic-ai/claude-cli`)

**Quick start:**

```bash
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# Build TUI e CLI
npm --prefix tui install && npm --prefix tui run build
npm --prefix cli install

# Avvia il wizard
node cli/bin/jht.js
```

> **Claude Max:** nessuna API key necessaria — serve il `Claude CLI`.
> **OpenAI / Minimax / Anthropic API:** puoi usare direttamente le rispettive API key senza passare dal `Claude CLI`.

---

## Utilizzo

### CLI — comandi principali

```bash
jht setup              # Wizard configurazione guidata
jht team start         # Avvia tutto il team
jht team stop          # Ferma tutto il team
jht status             # Stato agenti e sistema
jht health             # Health check 7 moduli con semafori
jht stats              # Statistiche aggregate task/API/sessioni
jht logs               # Log strutturati (--level, --module, --tail)
jht export <src>       # Esporta sessioni/task/analytics (JSON/CSV)
jht backup             # Crea/lista/ripristina backup
jht plugins            # Lista/attiva/disattiva plugin
jht cron list          # Lista job schedulati
```

### TUI

```bash
jht tui    # Tab/↑↓ naviga · Ctrl+C×2 esci
```

```
┌─ JHT TUI ─ agente: scout ─ connected ──────────────────┐
│ AGENTI         │  [chat / log agente selezionato]       │
│ ────────────   │                                        │
│ > ● scout      │                                        │
│   ◐ analista   │                                        │
│   ✗ critico    │                                        │
├────────────────┴────────────────────────────────────────┤
│ connected │ 1/7 attivi │ tok 12k  │  Tab  Ctrl+C  esci  │
└─────────────────────────────────────────────────────────┘
```

### Web Dashboard

```bash
cd web && npm run dev        # Dev → http://localhost:3000
cd web && docker compose up  # Docker
```

**56 pagine** organizzate per area:

| Area | Pagine principali |
|------|-------------------|
| **Pipeline** | Dashboard · Posizioni · Candidature · Pronte per invio · Risposte · Crescita |
| **Agenti** | Lista agenti · Metriche · Pagina dedicata per ogni agente |
| **Dati** | Sessioni · Task · Cronologia (con chat replay) |
| **Infra** | Analytics · Health · Retry · Rate limiter · Queue · Events · Logs |
| **Config** | Settings · Credenziali · Plugin · Tools · Templates · Provider · Migrazioni |
| **Sistema** | Overview · Memory · Gateway · Canali · Notifiche · Cron · Deploy |

### Desktop Launcher

📦 La direzione prodotto per utenti non tecnici non è una riscrittura completa della UI in desktop native.

- Il launcher desktop usa Electron come shell minima e apre la GUI web locale nel browser.
- Le release desktop includono il payload web gia compilato: niente `npm install` o `next build` sul computer dell'utente.
- Il runtime locale parte sulla prima porta libera vicina a `3000` e apre automaticamente la dashboard.
- Le release vengono prodotte in CI con pacchetti nativi per macOS, Windows e Linux.
- `Claude CLI` resta opzionale: serve solo per i flussi che usano Claude Max invece di provider API-based.

---

## Test

**800+ test case** su 168 file — copertura completa di tutti i moduli shared.

```bash
cd tests/js && npx vitest run
```

---

## CI/CD

| Workflow | Trigger | Descrizione |
|----------|---------|-------------|
| `test.yml` | Push / PR | Vitest matrix parallelo su 12 moduli shared |
| `ci.yml` | Push / PR | Build Next.js, lint, type-check |
| `lint.yml` | Push / PR | ESLint + Prettier su tutti i moduli |
| `security.yml` | Schedule / PR | Audit dipendenze, scan segreti |
| `release.yml` | Tag release | Build desktop cross-platform (`.dmg`, `.exe`, `.AppImage`, `.deb`) + GitHub Release |
| `deploy.yml` | Push su `master` / manuale | Deploy produzione con health-check |

---

## Health Check

Health check globale su 7 moduli con semafori verde/giallo/rosso e auto-refresh.

```bash
curl http://localhost:3000/api/health
```

| Modulo | Verifica |
|--------|----------|
| Config | `jht.config.json` presente e valido |
| Sessioni | File sessioni e sessioni attive |
| Analytics | Dati metriche API |
| Credenziali | Provider configurati |
| Plugin | Directory e plugin installati |
| Memory | File bootstrap (SOUL/IDENTITY/MEMORY) |
| Agenti | Sessioni tmux attive |

---

## Roadmap

### Completato

- [x] Pipeline multi-agente completa (scout → analista → scorer → scrittore → critico)
- [x] CLI `jht` con 15+ comandi
- [x] TUI multi-agente con navigazione e chat live
- [x] Web dashboard 56 pagine
- [x] Astrazione provider LLM (Claude / OpenAI / Minimax)
- [x] Gateway HTTP, event bus, plugin system, hook system, context engine
- [x] Rate limiter, retry con circuit breaker, job queue con dead-letter
- [x] Canali: Web, CLI, Telegram
- [x] Credenziali AES-256, memoria agenti (SOUL/IDENTITY/MEMORY)
- [x] Logger strutturato, analytics token/costi, notifiche multi-canale
- [x] CI/CD con 6 workflow, 800+ test su 168 file
- [x] i18n it/en
- [x] Supabase cloud (Frankfurt), Google OAuth, schema PostgreSQL V2

### Fase 1 — Consolidamento Web Platform (in corso, ~65%)

- [ ] Dashboard collegata a dati reali Supabase
- [ ] Profilo utente con salvataggio cloud
- [ ] Pagine posizioni e candidature live
- [ ] Deploy Vercel con CI/CD
- [ ] API layer agenti → Supabase (multi-tenant)

### Fase 2 — Desktop Launcher (in corso)

- [x] Installer desktop (`.dmg` / `.exe` / `.AppImage` / `.deb`) per utenti non tecnici
- [x] Launcher/orchestratore locale che avvia JHT in background e apre il browser su `localhost`
- [x] Payload prebuildato: GUI web gia compilata, niente rebuild sul computer dell'utente
- [x] Release workflow cross-platform con GitHub Releases
- [ ] Setup wizard grafico con scelta provider AI (`Claude CLI` solo se serve davvero)
- [ ] Code signing completo macOS/Windows
- [ ] Auto-update cross-platform

### Fase 3 — Cloud Provisioning

- [ ] Adapter multi-provider (AWS, GCP, Hetzner)
- [ ] One-click deploy da app desktop
- [ ] Monitoring remoto, stima costi, billing alert
- [ ] Tunnel sicuro app ↔ cloud (WireGuard/SSH)

### Fase 4 — Internazionalizzazione Completa

- [ ] Inglese come lingua principale
- [ ] Infrastruttura multi-lingua (JSON per lingua, language switcher)
- [ ] Espansione community: ES, DE, FR, PT

### Fase 5 — Sito Web Pubblico

- [x] Landing page con download e rilevamento OS
- [ ] Documentazione visuale (guide, FAQ, video tutorial)

---

## Contributing

Pull request benvenute! Prima di aggiungere nuovi agenti leggi [`shared/docs/add-agent.md`](shared/docs/add-agent.md).

---

## Licenza

MIT — vedi [LICENSE](LICENSE).
