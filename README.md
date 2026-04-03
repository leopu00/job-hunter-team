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
jht setup          # Wizard configurazione guidata
jht config show    # Mostra configurazione corrente
jht status         # Stato agenti e sistema
jht team start     # Avvia tutto il team
jht team stop      # Ferma tutto il team
jht cron list      # Lista task schedulati
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

Pagine disponibili: `/dashboard` · `/agents` · `/settings` · `/cron` · `/team`

---

## 🗺️ Roadmap

- [x] Pipeline multi-agente (scout → analista → scorer → scrittore → critico)
- [x] CLI `jht` con setup wizard interattivo
- [x] TUI multi-agente con navigazione agenti
- [x] Web dashboard (agenti, cron, impostazioni)
- [x] Astrazione provider LLM (Claude / OpenAI / Minimax)
- [x] Gateway HTTP multi-agente
- [x] Canali di comunicazione (Web, CLI, Telegram)
- [x] Credenziali cifrate AES-256
- [x] Memoria agenti (SOUL / IDENTITY / MEMORY)
- [x] Logger strutturato con rolling file
- [x] Script deploy e health-check produzione
- [x] Agent runner con tool loop e abort
- [x] Hook system con source precedence
- [x] Event bus pub/sub tipizzato
- [x] Plugin system con lifecycle
- [x] Context engine per LLM
- [x] Rate limiter e retry con circuit breaker
- [x] Job queue con dead-letter
- [x] Template engine con composizione prompt
- [x] Sistema notifiche multi-canale
- [x] Analytics token usage e costi
- [ ] Supporto multi-workspace
- [ ] Export candidature in formato ATS-ready
- [ ] Supporto modelli locali (Ollama)

---

## 🤝 Contributing

Pull request benvenute. Prima di aggiungere nuovi agenti leggi [`shared/docs/add-agent.md`](shared/docs/add-agent.md).

---

## 📄 Licenza

MIT — vedi [LICENSE](LICENSE).
