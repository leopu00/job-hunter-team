<p align="center">
  <img src="assets/banner.png" alt="Job Hunter Team Banner" width="100%" />
</p>

# 🎯 Job Hunter Team

> Un framework multi-agente AI open-source che automatizza la tua ricerca lavoro — dalla scoperta di posizioni alla scrittura di CV e cover letter su misura.

Punta il sistema al tuo profilo, avvia il team e revisiona solo le candidature che superano il quality bar.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## ✨ Cosa fa

| Agente | Ruolo |
|--------|-------|
| 🕵️ **Scout** | Cerca posizioni su job board EU e remote |
| 🔬 **Analista** | Verifica JD, aziende, cultura aziendale |
| 📊 **Scorer** | Assegna punteggio 0-100 vs il tuo profilo |
| ✍️ **Scrittore** | Genera CV e cover letter personalizzati |
| ⚖️ **Critico** | Blind review (3 round obbligatori) |
| 👨‍✈️ **Capitano** | Coordina la pipeline, gestisce anti-collision |
| 🛡️ **Sentinella** | Monitora token, rate limit e stato del team |

---

## 🏗️ Architettura

```
                        👨‍✈️  Capitano (alfa)
                            │
          ┌─────────────────┼─────────────────┐
          │                 │                 │
       🕵️ Scout         📊 Scorer        🛡️ Sentinella
          │                 │
       🔬 Analista       ✍️ Scrittore
                            │
                         ⚖️ Critico
                            │
                     ✅ Pronto per invio
```

Ogni agente è una sessione Claude Code con un file `CLAUDE.md` dedicato.
Il Capitano coordina la pipeline via tmux e un database SQLite condiviso.

### Interfacce disponibili

```
🖥️  Web Dashboard   →  http://localhost:3000      (Next.js)
💻  CLI             →  jht setup / team / status  (Node.js)
📟  TUI             →  jht tui                    (Terminal UI)
```

---

## 📦 Moduli

### `shared/` — Librerie condivise

| Modulo | Descrizione |
|--------|-------------|
| `config/` | Config centralizzata `jht.config.json` — schema Zod, I/O, tipi |
| `agents/` | Agent scope, runner con tool loop, config e sessioni agente |
| `sessions/` | Gestione sessioni agente — creazione, persistenza, registry |
| `hooks/` | Hook system — registry, loader, frontmatter, source precedence |
| `events/` | Event bus pub/sub tipizzato — canali agente, sistema, messaggi |
| `plugins/` | Sistema plugin — discovery, caricamento, lifecycle |
| `context-engine/` | Motore contesto — raccolta e prioritizzazione info per LLM |
| `tools/` | Tool registry — bash executor, heartbeat, tool custom per agenti |
| `llm/` | Astrazione provider AI — Claude, OpenAI, Minimax con factory |
| `rate-limiter/` | Rate limiting fixed-window, retry backoff, provider runner |
| `retry/` | Retry con backoff esponenziale e circuit breaker 3 stati |
| `queue/` | Job queue con priorita', retry, dead-letter, concorrenza |
| `templates/` | Template .md con frontmatter, variabili, composizione prompt |
| `notifications/` | Sistema notifiche — registry, notifier, canali multipli |
| `analytics/` | Tracking chiamate API, token usage, latenza p95, costi |
| `validators/` | Schema Zod per config, credentials, tasks, snapshot |
| `history/` | Buffer storico conversazioni e azioni agente |
| `gateway/` | Gateway HTTP multi-agente con router e middleware |
| `channels/` | Canali di comunicazione — Web, CLI, Telegram |
| `telegram/` | Bridge bidirezionale Telegram con bot Grammy |
| `credentials/` | Gestione credenziali cifrate AES-256 — API key e OAuth |
| `memory/` | Gestione identita', anima e memoria agenti (SOUL/IDENTITY/MEMORY) |
| `cron/` | Scheduler task ricorrenti con espressioni cron |
| `logger/` | Logger strutturato JSON con rolling file e output colorato |
| `deploy/` | Script deploy, health-check e monitor produzione |
| `daemon/` | Script installazione/disinstallazione daemon di sistema |
| `backup/` | Backup e restore dati con retention policy e compressione |
| `migrations/` | Migrazioni config con versioning sequenziale e rollback |
| `i18n/` | Internazionalizzazione — traduzioni it/en con fallback |

### Interfacce

| Modulo | Descrizione |
|--------|-------------|
| `cli/` | CLI `jht` — setup, config, status, team, cron |
| `tui/` | Terminal UI multi-agente — lista agenti, chat, status bar |
| `web/` | Dashboard Next.js — agenti, impostazioni, cron, profilo |

---

## 🚀 Installazione

### Prerequisiti

- **Node.js** 18+ e npm
- **Python** 3.10+
- **tmux** (Linux/macOS) — WSL2 + tmux su Windows
- **Claude CLI** — Claude Max subscription o Anthropic API key
- **pandoc + typst** (opzionale, per generazione PDF)

### Setup

```bash
# 1. Clona il repo
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# 2. Installa le dipendenze
npm install
npm install --prefix shared/cron

# 3. Wizard di setup interattivo
jht setup

# 4. Compila il tuo profilo candidato
# Modifica candidate_profile.yml — skills, esperienza, ruoli target
```

> **Claude Max:** nessuna API key necessaria — il CLI usa la tua subscription.
> **API key:** aggiungi `ANTHROPIC_API_KEY` a `.env`.

---

## 🖥️ Utilizzo

### CLI

```bash
# Setup e configurazione
jht setup          # Wizard configurazione guidata
jht config show    # Mostra configurazione corrente
jht migrate        # Esegui migrazioni config (--dry-run)

# Team e agenti
jht team start     # Avvia tutto il team
jht team stop      # Ferma tutto il team
jht agents         # Lista agenti con stato tmux e task

# Monitoraggio
jht status         # Stato agenti e sistema
jht health         # Health check 7 moduli con semafori
jht stats          # Statistiche aggregate task/API/sessioni
jht logs           # Log strutturati (--level, --module, --tail)
jht providers      # Provider LLM configurati e stato auth

# Gestione dati
jht export <src>   # Esporta sessioni/task/analytics (JSON/CSV)
jht import <file>  # Importa da file JSON (merge/replace)
jht backup         # Crea/lista/ripristina backup
jht cache stats    # Statistiche cache, jht cache clear

# Plugin e cron
jht plugins        # Lista/attiva/disattiva plugin
jht cron list      # Lista job schedulati
jht cron add       # Aggiungi job cron
```

### TUI (Terminal UI)

```bash
jht tui
# Tab / ↑↓  — naviga tra gli agenti
# Ctrl+C×2  — esci
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
cd web && npm run dev
# → http://localhost:3000
```

Oppure con Docker:

```bash
cd web && docker compose up
```

### Pagine Web (56 pagine)

| Categoria | Pagine |
|-----------|--------|
| **Pipeline** | `/dashboard` · `/positions` · `/positions/[id]` · `/applications` · `/ready` · `/risposte` · `/crescita` |
| **Agenti** | `/agents` · `/agents/[id]` · `/agents/metrics` · `/team` · `/scout` · `/analista` · `/scorer` · `/scrittore` · `/critico` · `/sentinella` · `/capitano` · `/assistente` |
| **Sessioni** | `/sessions` · `/sessions/[id]` (chat replay) |
| **Task** | `/tasks` · `/tasks/[id]` (timeline stati) |
| **Cronologia** | `/history` · `/history/[id]` (replay conversazione) |
| **Infrastruttura** | `/analytics` · `/health` · `/retry` · `/rate-limiter` · `/queue` · `/events` · `/logs` |
| **Configurazione** | `/settings` · `/config` · `/credentials` · `/plugins` · `/tools` · `/templates` · `/providers` · `/migrations` |
| **Dati** | `/export` · `/import` · `/backup` |
| **Sistema** | `/overview` · `/memory` · `/gateway` · `/channels` · `/notifications` · `/cron` · `/daemon` · `/deploy` · `/setup` |
| **Profilo** | `/profile` · `/profile/edit` · `/assistant` |

---

## 🧪 Test

**800+ test case** distribuiti su 168 file di test:

- `tests/js/` — Test unitari e integrazione moduli shared (vitest)
- `shared/*/` — Test co-locati nei moduli (agent runner, plugins, sessions, ecc.)
- Copertura: config, validators, queue, retry, analytics, events, sessions, hooks, cron, templates, credentials, memory, agents, tools, telegram, logger, daemon, deploy, backup, history, assistant

```bash
cd tests/js && npx vitest run    # Esegui tutti i test JS
```

---

## 🔄 CI/CD

**5 workflow GitHub Actions:**

| Workflow | Trigger | Cosa fa |
|----------|---------|---------|
| `test.yml` | Push/PR | Vitest matrix parallelo su 12 moduli shared |
| `ci.yml` | Push/PR | Build Next.js, lint, type-check |
| `lint.yml` | Push/PR | ESLint + Prettier su tutti i moduli |
| `security.yml` | Schedule/PR | Audit dipendenze, scan segreti |
| `deploy.yml` | Tag release | Deploy produzione con health-check |

---

## 🏥 Health Check

Il sistema include un health check globale che verifica 7 moduli:

| Modulo | Cosa controlla |
|--------|---------------|
| Config | `jht.config.json` presente e valido |
| Sessioni | File sessioni e sessioni attive |
| Analytics | Dati metriche API |
| Credenziali | Provider configurati |
| Plugin | Directory e plugin installati |
| Memory | File bootstrap (SOUL/IDENTITY/MEMORY) |
| Agenti | Sessioni tmux attive |

```bash
curl http://localhost:3000/api/health   # Health check API
```

Pagina `/health` con semafori verde/giallo/rosso e auto-refresh.

---

## 🗺️ Roadmap

### ✅ Completato

- [x] Pipeline multi-agente (scout → analista → scorer → scrittore → critico)
- [x] CLI `jht` con 15 comandi (setup, config, status, team, cron, export, import, health, backup, migrate, cache, logs, providers, stats, plugins, agents)
- [x] TUI multi-agente con navigazione agenti
- [x] Web dashboard 56 pagine (pipeline, agenti, sessioni, task, cronologia, infrastruttura, config, dati)
- [x] Astrazione provider LLM (Claude / OpenAI / Minimax)
- [x] Gateway HTTP, event bus, plugin system, hook system, context engine
- [x] Rate limiter, retry con circuit breaker, job queue con dead-letter
- [x] Canali di comunicazione (Web, CLI, Telegram)
- [x] Credenziali cifrate AES-256, memoria agenti (SOUL/IDENTITY/MEMORY)
- [x] Logger strutturato, analytics token/costi, notifiche multi-canale
- [x] CI/CD con 5 workflow GitHub Actions, 800+ test case su 168 file
- [x] Internazionalizzazione it/en
- [x] Supabase cloud (Frankfurt), Google OAuth, schema PostgreSQL V2

### 🔨 Fase 1 — Consolidamento Web Platform (in corso, ~65%)

- [ ] Dashboard collegata a dati reali Supabase
- [ ] Profilo utente con salvataggio cloud
- [ ] Pagine posizioni e candidature
- [ ] Deploy Vercel con CI/CD
- [ ] API layer agenti → Supabase (multi-tenant)

### 📦 Fase 2 — App Desktop Electron

- [ ] App desktop scaricabile (.dmg / .exe / .AppImage) per utenti non tecnici
- [ ] Setup wizard grafico (nessun terminale necessario)
- [ ] Gestione agenti come processi background (sostituzione tmux)
- [ ] Auto-install dipendenze, tray icon, notifiche native
- [ ] Installer cross-platform con auto-update e code signing
- [ ] Modalita' "computer dedicato" via SSH in rete locale

### ☁️ Fase 3 — Cloud Provisioning Multi-Provider

- [ ] Layer di astrazione con adapter per AWS, GCP, Hetzner
- [ ] One-click deploy da app desktop
- [ ] Monitoring remoto, stima costi, billing alert
- [ ] Tunnel sicuro app ↔ cloud (WireGuard/SSH)

### 🌍 Fase 4 — Internazionalizzazione Completa

- [ ] Inglese come lingua principale dell'interfaccia e documentazione
- [ ] Infrastruttura per lingue aggiuntive (file JSON per lingua, language switcher)
- [ ] Espansione: spagnolo, tedesco, francese, portoghese (contribuzioni community)

### 🌐 Fase 5 — Sito Web Pubblico e Distribuzione

- [ ] Landing page con download e rilevamento OS automatico
- [ ] Documentazione utente visuale (guide, FAQ, video tutorial)
- [ ] Dominio, DNS, SSL

---

## 🤝 Contributing

Pull request benvenute. Prima di aggiungere nuovi agenti leggi [`shared/docs/add-agent.md`](shared/docs/add-agent.md).

---

## 📄 Licenza

MIT — vedi [LICENSE](LICENSE).
