# 🏴‍☠️ Job Hunter — Architettura del Team

```
                        ┌─────────────────────────────────────┐
                        │   🎖️  CEO / Comandante               │
                        │   Click finale invio candidatura     │
                        └──────────────┬──────────────────────┘
                                       │ ordini & decisioni
                                       ▼
                        ┌─────────────────────────────────────┐
                        │   👨‍✈️  CAPITANO (Opus 4.6)            │
                        │   Coordina, monitora, reporta        │
                        │   Sessione: 🐺 ALFA                  │
                        └──────────────┬──────────────────────┘
                                       │ coordina tutto il flusso
                 ══════════════════════════════════════════════════
                                    P I P E L I N E
                 ══════════════════════════════════════════════════

  ╔══════════════════════════════════════════════════════════════════════════╗
  ║  FASE 1 — RICERCA                                                      ║
  ║                                                                        ║
  ║   ┌──────────────────┐     ┌──────────────────┐                        ║
  ║   │ 🔍 SCOUT-1       │     │ 🔍 SCOUT-2       │   MCP: fetch, jobspy  ║
  ║   │ Sonnet 4.5       │     │ Sonnet 4.5       │   linkedin, playwright║
  ║   │ Cerca posizioni  │     │ Cerca posizioni  │                        ║
  ║   └────────┬─────────┘     └────────┬─────────┘                        ║
  ║            │    INSERT positions     │                                  ║
  ║            └───────────┬─────────────┘                                  ║
  ╚════════════════════════╪════════════════════════════════════════════════╝
                           ▼
                    ┌─────────────┐
                    │  📦 jobs.db │  ← SQLite centrale
                    └──────┬──────┘
                           ▼
  ╔══════════════════════════════════════════════════════════════════════════╗
  ║  FASE 2 — ANALISI                                                      ║
  ║                                                                        ║
  ║   ┌──────────────────┐     ┌──────────────────┐                        ║
  ║   │ 🪩 ANALISTA-1    │     │ 🪩 ANALISTA-2    │   MCP: fetch,         ║
  ║   │ Sonnet 4.5       │     │ Sonnet 4.5       │   playwright          ║
  ║   │ Verifica JD +    │     │ Verifica JD +    │                        ║
  ║   │ aziende          │     │ aziende          │                        ║
  ║   └────────┬─────────┘     └────────┬─────────┘                        ║
  ║            │   UPDATE status (verified/rejected)                        ║
  ║            └───────────┬─────────────┘                                  ║
  ╚════════════════════════╪════════════════════════════════════════════════╝
                           ▼
  ╔══════════════════════════════════════════════════════════════════════════╗
  ║  FASE 3 — SCORING                                                      ║
  ║                                                                        ║
  ║              ┌──────────────────┐                                       ║
  ║              │ 🎯 SCORER        │   Punteggio 0-100 vs profilo utente  ║
  ║              │ Sonnet 4.5       │   score -1 = laurea obbligatoria     ║
  ║              └────────┬─────────┘                                       ║
  ║                       │ INSERT score                                    ║
  ╚═══════════════════════╪════════════════════════════════════════════════╝
                          ▼
                   score >= 70 ?
                  ╱             ╲
                SI               NO → 🗄️ archivio
                 ╲
                  ▼
  ╔══════════════════════════════════════════════════════════════════════════╗
  ║  FASE 4 — SCRITTURA                    FASE 5 — REVIEW                 ║
  ║                                                                        ║
  ║   ┌──────────────────┐                  ┌──────────────────┐           ║
  ║   │ ✍️ SCRITTORE-1   │ ◄──────────────► │ 🛡️ CRITICO      │           ║
  ║   │ Sonnet 4.5       │    loop fino a   │ Opus 4.6         │           ║
  ║   │ CV + Cover Letter│    PASS          │ Review "cieco"   │           ║
  ║   └──────────────────┘                  │ (no profilo)     │           ║
  ║   ┌──────────────────┐                  └──────────────────┘           ║
  ║   │ ✍️ SCRITTORE-2   │ ◄──────────────►        │                      ║
  ║   │ Sonnet 4.5       │    PASS / NEEDS_WORK    │                      ║
  ║   │ CV + Cover Letter│    / REJECT              │                      ║
  ║   └────────┬─────────┘                          │                      ║
  ║            │          UPDATE verdict             │                      ║
  ║            └────────────────┬────────────────────┘                      ║
  ╚═════════════════════════════╪══════════════════════════════════════════╝
                                ▼
  ╔══════════════════════════════════════════════════════════════════════════╗
  ║  FASE 6 — INVIO                                                        ║
  ║                                                                        ║
  ║   📲 Notifica Telegram → Utente → 🖱️ Click invio candidatura           ║
  ║                                                                        ║
  ╚══════════════════════════════════════════════════════════════════════════╝
```

## Comunicazione

```
  ┌─────────────┐   tmux send-keys    ┌─────────────┐
  │  CAPITANO   │ ◄──────────────────► │   AGENTI    │
  │  (🐺 ALFA)  │  [@mitt -> @dest]    │  (8 sessioni)│
  └──────┬──────┘  [MSG/REQ/RES/URG]   └─────────────┘
         │
         │  Telegram bot
         ▼
  ┌─────────────┐
  │  📲 Utente  │
  └─────────────┘
```

## Stack Tecnico

| Componente | Tecnologia |
|------------|------------|
| **Orchestrazione** | tmux (9 sessioni) |
| **Agenti** | Claude Code CLI |
| **Database** | SQLite (`shared/data/jobs.db`) |
| **Web scraping** | MCP Playwright + Fetch |
| **Job boards** | MCP JobSpy + LinkedIn |
| **PDF generation** | Pandoc + Typst |
| **Notifiche** | Bot Telegram |
| **Script gestione** | Bash (`alfa/scripts/scripts/`) |

## Numeri Chiave

- **9 agenti** (2 Scout, 2 Analisti, 1 Scorer, 2 Scrittori, 1 Critico, 1 Capitano)
- **2 modelli**: Opus 4.6 (Capitano + Critico), Sonnet 4.5 (tutti gli altri)
- **Soglia candidatura**: score >= 70
- **Loop Critico-Scrittore**: iterativo fino a PASS (testato: +1.0 punti su Bending Spoons)
- **Ultimo click**: SEMPRE l'utente
