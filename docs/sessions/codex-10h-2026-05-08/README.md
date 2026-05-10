# 🔵 Codex monitoring — 10h snapshot (2026-05-08 mattina)

Primo report HTML interattivo prodotto dopo che il team JHT e' stato
spostato sul provider Codex GPT-5.5 (subscription openai), con i fix
Codex appena deployati lato bridge:

- `shared/skills/token-by-agent-series.py` esteso con `_collect_codex`
- `shared/skills/team-tokens-by-type.py` esteso con stessa logica
- `pacing-bridge.py` con damping cap 25% e top-consumer filter

## 📂 Contenuto

- `index.html` — entry point: KPI, usage chart con marker reset finestra,
  token cumulativi per agente, tabella finestre con esito, sezione esiti
  chiave. Chart.js zoom-only-via-bottoni.
- `sentinel.json` — sentinel timeseries 10h (usage, projection, velocity).
- `by-agent.json` — token-by-agent cumulativo bucketed.

## 🪟 Finestre coperte

3 finestre Codex 5h:
- W1 (`20260507T195322Z`) → 84% peak — pipeline si ferma a 59% per 30min
- W2 (`20260508T011502Z`) → **100% peak** (saturation, +10 oltre target band)
- W3 (`20260508T060215Z`) → 57% peak (undershoot dopo overshoot W2)

## ✅ Privacy

Solo metriche aggregate + nomi ruolo (scout-1, capitano, ecc.) +
ID interni `#NNN` di JHT. Nessun PII reale.
