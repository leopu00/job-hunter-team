# Audit src/ — Moduli non ancora portati in JHT

Data: 2026-04-03

## GIA PORTATI (13 moduli)

| Sorgente | JHT | Note |
|----------|-----|------|
| config/ | shared/config/ | Schema Zod, IO, tipi |
| channels/ | shared/channels/ | Channel abstraction layer |
| cron/ | shared/cron/ | Service, jobs, schedule, store |
| daemon/ | shared/daemon/ | Install/uninstall scripts |
| gateway/ | shared/gateway/ | Router, server |
| logging/ | shared/logger/ | Logger strutturato, formatter |
| secrets/ | shared/secrets/ + shared/credentials/ | Crypto AES-256, storage |
| wizard/ | cli/wizard/ | Setup interattivo clack |
| cli/ | cli/ | Comandi setup, config, status, team |
| tools (bash, heartbeat) | shared/tools/ | Registry, bash executor, heartbeat |
| tui/ | web/ | TUI layout + chat panel |
| memory (custom) | shared/memory/ | Soul, identity, bootstrap files |
| providers | shared/llm/ + shared/providers/ | Factory multi-provider |

## NON PORTATI — PRIORITA CRITICA (6 moduli)

| Modulo | File | Cosa fa | Perche serve |
|--------|------|---------|--------------|
| **agents/** | ~556 | Orchestrazione agenti, lifecycle, spawning, policy | Core per agenti autonomi |
| **tasks/** | ~44 | Task registry, executor, workflow persistence (SQLite) | Tracking job application |
| **sessions/** | ~10 | Session lifecycle, transcript events, model overrides | Persistenza conversazioni |
| **hooks/** | ~31 | Event hooks, Gmail watcher, plugin hooks | Trigger su eventi (email job) |
| **context-engine/** | ~6 | Context registry, compaction, rewriting | Gestione contesto AI lungo |
| **plugins/** + **plugin-sdk/** | ~527 | Ecosistema plugin, provider integration, SDK | Estensibilita piattaforma |

## NON PORTATI — ESSENZIALE (5 moduli)

| Modulo | File | Cosa fa | Perche serve |
|--------|------|---------|--------------|
| **security/** | ~41 | Audit SSRF, safe-regex, config scanning | Sicurezza operazioni esterne |
| **infra/** | ~548 | Exec approvals, safe bins, port probe, shell env | Safety execution boundaries |
| **mcp/** | ~7 | Model Context Protocol server | Integrazione Claude standard |
| **routing/** | ~6 | Routing messaggi, account lookup, session key | Multi-utente, canali |
| **acp/** | ~34 | Access Control Policies, approval workflow | Controllo accessi multi-user |

## NON PORTATI — MOLTO UTILE (9 moduli)

| Modulo | File | Cosa fa | Perche serve |
|--------|------|---------|--------------|
| **auto-reply/** | ~255 | Dispatch risposte, command registry, model runtime | Risposte automatiche |
| **commands/** | ~265 | Definizioni comandi CLI, agent mgmt, auth | Comandi utente |
| **flows/** | ~9 | Flow interattivi (channel setup, model picker) | Wizard avanzati |
| **process/** | ~29 | Supervisor, PTY, spawn, kill-tree | Processi long-running |
| **media/** | ~50 | File/image/audio/PDF handling, MIME, security | Upload CV, cover letter |
| **media-understanding/** | ~60 | Vision, audio transcription, image description | Analisi job posting |
| **link-understanding/** | ~6 | URL detection, SSRF validation | Link offerte lavoro |
| **web-fetch/** | ~2 | Web fetch provider runtime | Scraping offerte |
| **web-search/** | ~2 | Web search provider runtime | Ricerca posizioni |

## NON PORTATI — UTILE (7 moduli)

| Modulo | File | Cosa fa |
|--------|------|---------|
| **interactive/** | ~2 | UI payloads (bottoni, select) |
| **markdown/** | ~15 | Rendering markdown, chunking |
| **utils/** | ~35 | Queue, concurrency, timeout, text |
| **shared/** | ~68 | Tipi chat, device auth, net utils |
| **terminal/** | ~14 | ANSI colors, tables, progress bars |
| **i18n/** | ~1 | Registry traduzioni multi-lingua |
| **types/** | ~11 | Type stubs per librerie esterne |

## NON PORTATI — BASSA PRIORITA (10 moduli)

| Modulo | File | Cosa fa |
|--------|------|---------|
| bootstrap/ | 2 | Startup env setup |
| canvas-host/ | 4 | Canvas rendering server |
| compat/ | 1 | Legacy name mapping |
| image-generation/ | 7 | AI image generation |
| node-host/ | 12 | Node exec host |
| pairing/ | 6 | Device pairing protocol |
| tts/ | 15 | Text-to-speech |
| chat/ | 1 | Tool content handling |
| bindings/ | 1 | Session bindings |
| generated/ + scripts/ + docs/ | 7 | Build/docs tools |

## RIEPILOGO NUMERICO

- **Portati:** 13 moduli
- **Da portare (critico):** 6 moduli (~1174 file)
- **Da portare (essenziale):** 5 moduli (~636 file)
- **Da portare (molto utile):** 9 moduli (~678 file)
- **Da portare (utile):** 7 moduli (~146 file)
- **Bassa priorita / skip:** 10 moduli (~56 file)
- **Totale non portato:** ~2690 file

## RACCOMANDAZIONE PROSSIME FASI

1. **FASE 2A:** agents/ + sessions/ + context-engine/ (orchestrazione agenti)
2. **FASE 2B:** tasks/ + hooks/ (workflow e trigger)
3. **FASE 2C:** security/ + infra/ (safety layer)
4. **FASE 3A:** auto-reply/ + commands/ + routing/ (dispatch messaggi)
5. **FASE 3B:** media/ + web-fetch/ + web-search/ (input/output)
6. **FASE 3C:** plugins/ + mcp/ (estensibilita)
