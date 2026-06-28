# 🔵 Codex monitoring — 12h snapshot (2026-05-09 AM)

Report 12h del mattino del 9 maggio. Include il **bridge-mailbox**
deployato la sera del 8 mag (19:53 UTC) come fallback per i verdetti
del pacing-bridge persi quando `jht-tmux-send rc=3` (capitano busy).

## 📂 Contenuto

- `index.html` — KPI, usage chart, token cumulativi per agente, tabella
  finestre, tabella round dottore, **sezione 📬 Bridge mailbox** con
  breakdown delivery (`✓tmux` direct vs `✗ → mailbox` recovered) e
  tabella ultime 15 entry con status.
- `sentinel.json` — 12h timeseries.
- `by-agent.json` — token-by-agent.
- `doctor-actions.jsonl.txt` — 748 righe doctor activity.
- `bridge-mailbox.jsonl.txt` — 11 verdetti bridge (post-deploy).

## 📊 Numeri chiave

- 6 finestre Codex attraversate
- 13 round Dottore completati
- Mailbox primi 11 verdetti scritti (di cui ~33% recovered da rc=3)

## ✅ Privacy

Stesso pattern dei report precedenti: solo metriche aggregate + ID
interni JHT + nomi ruolo. Nessun PII reale.
