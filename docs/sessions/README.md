# 📊 Session reports — JHT team experimentation

Indice cronologico dei report HTML interattivi prodotti durante le
sperimentazioni del team JHT (multi-agente sopra Kimi K2 / Claude Opus /
Codex GPT-5.5).

Ogni cartella e' **self-contained**: contiene un `index.html` che fetcha
JSON relativi nella stessa directory. Apri `index.html` in un browser
(serve internet per il CDN Chart.js) e vedi i grafici interattivi —
zoom solo via bottoni `➕➖⟲`, click in legenda per filtrare.

## 📅 Cronologia

| Data | Cartella | Cosa contiene |
|---|---|---|
| 2026-05-03 → 04 | [`long-session-2026-05-04/`](./long-session-2026-05-04/) | 🌙 Long session 10h+ Kimi K2, primo run con termostato pacing-bridge che attraversa 2 finestre 5h consecutive. **Il report più completo** (9 pagine: usage, throttle, agents, timeline, tokens, database, crashes, windows, retro). |
| 2026-05-08 (mattina) | [`codex-10h-2026-05-08/`](./codex-10h-2026-05-08/) | 🔵 Snapshot 10h Codex: usage curve + per-agent token cumulativi. Genesi: dopo deploy dei fix Codex (token-by-agent, team-tokens-by-type, pacing-bridge top-consumer filter). |
| 2026-05-08 PM | [`codex-12h-2026-05-08-pm/`](./codex-12h-2026-05-08-pm/) | 🔵 12h Codex con prima vista del 🩺 Dottore (health-check ogni 30min). Include `doctor-actions.jsonl.txt`. |
| 2026-05-09 AM | [`codex-12h-2026-05-09-am/`](./codex-12h-2026-05-09-am/) | 🔵 12h Codex con bridge-mailbox attivo. Include sezione delivery (`✓tmux` vs `✗ → mailbox`). |
| 2026-05-09 (overview) | [`experimentation-overview-2026-04-25-to-2026-05-09/`](./experimentation-overview-2026-04-25-to-2026-05-09/) | 🧪 **Panoramica 15 giorni** (25 apr → 9 mag): tre provider testati fino all'esaurimento weekly, 58 finestre, 379 positions, 244 applications. KPI + funnel pipeline + lessons learned. |

## 🧱 Convenzioni

- **Naming cartella**: `<descriptive-slug>-YYYY-MM-DD` o range
  `YYYY-MM-DD-to-YYYY-MM-DD`. La data e' parte del nome cosi' la
  cartella e' ordinabile cronologicamente.
- **File obbligatori**: `index.html` (entry visual). Se la cartella ha
  dati JSON/JSONL accanto, idealmente anche un `README.md` di briefing.
- **Estensioni dati**: `.json` per snapshot statici, `.jsonl.txt`
  (non `.jsonl` — pre-commit hook lo blocca) per JSONL append-only.
- **Privacy**: nessun PII personale. ID interni JHT (`#321`, ecc.) OK,
  nomi/cognomi/email reali NO. Audit prima di committare:
  `grep -rE '<personal-pattern>' docs/sessions/`.
- **Pendant markdown**: per i report importanti, considerare di scrivere
  anche `docs/internal/YYYY-MM-DD-<topic>.md` — i numeri puri grep-abili
  sono utili per future analisi senza dover aprire un browser.

## 🔄 Rigenerare i dati

I JSON snapshot vivono dentro la cartella stessa, quindi i report sono
storici e immutabili dal momento del commit. Per generare un report
nuovo si possono usare gli script in `shared/skills/`:

```bash
# Token-by-agent serie temporale
JHT_HOME=~/.jht python3 shared/skills/token-by-agent-series.py \
  --since-min 720 --bucket-sec 60 > by-agent.json

# Sentinel data filter (fai uno snippet python)
# DB stats (fai uno snippet python con sqlite3)
```

Il pattern per generare nuovi report e' visibile in
[`experimentation-overview-2026-04-25-to-2026-05-09/`](./experimentation-overview-2026-04-25-to-2026-05-09/) — quel report ha 5 JSON
diversi prodotti dai vari script.
