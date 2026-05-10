# TODO — Bridge V7 + Token Monitor (entry point)

> Punto di partenza per la prossima sessione di lavoro sul bridge / token monitor.
> NON è la roadmap completa (sta in `2026-05-01-bridge-and-token-monitoring.md`).
> Qui solo la **lista corta delle cose da fare**, in ordine, per non perdersi.

## 🎯 Decisioni già prese (non ridiscutere)

```
1. 2 daemon separati (bridge V6 + token-meter standalone)
2. Provider scope iniziale: solo Kimi
3. Output: state file JSON atomico in $JHT_HOME/logs/token-meter-state.json
4. Repo pubblica: SI, ma low-profile + 6-8 settimane di prep (non 1 maggio)
```

## 🚦 Sequenza di lavoro — bridge V7 / token-meter V1

### 🔹 Step 0 — precondizione (15 min) ⬜
- [ ] aggiungere `reset_at` al payload di `_write_state_file()` in `.launcher/sentinel-bridge.py`
- [ ] verificare che lo state file lo contenga
- [ ] ⚠️ blocca tutto il resto, va fatto per primo

### 🔹 Step 1 — refactor in libreria (45 min) ⬜
- [ ] creare `shared/skills/token_metrics_lib.py`
- [ ] funzioni pure: `read_kimi_events`, `parse_session_to_agent`, `billing_weighted`, `aggregate`, `rolling_rate`
- [ ] migrare `token-meter.py` a thin wrapper sopra la lib
- [ ] migrare anche `token-by-agent-plot.py` e `token-by-agent-rate.py`

### 🔹 Step 2 — window dinamica via reset_at (30 min) ⬜
- [ ] `token-meter` legge `sentinel-bridge-state.json` (se presente)
- [ ] `window_start = reset_at - 5h` (parametrizzabile per provider)
- [ ] filtra eventi → ratio cumulativo coerente con bridge_pct
- [ ] fallback graceful se state file mancante: usa `now - 5h` come prima

### 🔹 Step 3 — calibrazione incrementale (45 min) ⬜
- [ ] buffer in memoria delle ultime N coppie `(bridge_pct, weighted_total)`
- [ ] `ratio = Δw / Δpct` solo quando `Δpct >= 1` (no quantizzazione)
- [ ] EMA `alpha=0.3` per smoothing
- [ ] espone `ratio_kt_per_pct` nello state file

### 🔹 Step 4 — per-agent rate rolling 60s (30 min) ⬜
- [ ] per ogni agente, somma weighted negli ultimi 60s
- [ ] espone in `per_agent[<name>].rate_kt_per_min_60s`
- [ ] include `last_event_at` per detectare agenti idle

### 🔹 Step 5 — daemon persistente (45 min) ⬜
- [ ] singleton lock (PID file + cmdline check su `/proc/<pid>/cmdline`)
- [ ] loop ogni 30s
- [ ] atomic write (`.tmp` + `os.replace`)
- [ ] script bash `shared/skills/token-meter-control.sh` con `start|stop|status`
- [ ] integrazione in launcher (`start-agent.sh` o equivalente) — spawn al boot team

### 🔹 Step 6 — endpoint web (30 min) ⬜
- [ ] `web/app/api/tokens/status/route.ts`
- [ ] legge `token-meter-state.json` con staleness 5 min
- [ ] niente replica logica TS (lezione bridge V6)
- [ ] fallback se file mancante: `running: false`

### 🔹 Step 7 — DoD verifica (15 min) ⬜
- [ ] daemon parte/ferma puliti
- [ ] state file aggiornato ogni 30s
- [ ] ratio si stabilizza entro 5-6 calibrazioni
- [ ] endpoint `/api/tokens/status` 200 in dev
- [ ] aggiornare BACKLOG.md `[JHT-BRIDGE-V7]` ✅

**Totale stimato: ~4h di lavoro**

---

## 🐛 Bug pendenti (separati, non bloccano V7)

```
🔴 BUG-TUI-BUILD          tui/tsconfig.json rotto, CI Docker fail dal 27/04
🟡 BUG-CSP-JSONLD-LANDING JsonLd in production senza nonce → no rich snippet
🟡 UI countdown drift     dashboard mostra timer sballato dopo tab idle
```

Vedi BACKLOG.md → `🐛 KNOWN BUGS` per dettagli.

---

## 🚀 Dopo V7 — roadmap successiva (NON fare ora)

### Tier 3 — throttle controller PID (1 giornata)
- File nuovo: `shared/skills/throttle-controller.py`
- Setpoint per-agent: Scout 60% / Critico 15% / Capitano 15% / Sentinella 10%
- Convenzione `[THROTTLE @<agente> ±Ns]`
- Update prompt Capitano + agenti per onorare la pausa
- Calibrare setpoint su 24h di dati reali

### Tier 3.5 — auto-incentive bridge V8
- Trigger: `proj < 80% AND reset_window_remaining < 90min AND velocity < target × 0.7`
- Action: `[BRIDGE NUDGE] proj X%, reset in Y — push harder` al Capitano
- Cooldown: 15 min tra nudge (stessa disciplina V6)

### Tier 4 — strategico
- `[JHT-MONITORING-WEEKLY]` finestra settimanale
- `[JHT-MONITORING-WORKHOURS]` slot orari user-defined
- `[JHT-LAUNCH-LOW-PROFILE]` repo pubblica (timeline 6-8 settimane)
- Dashboard UI: secondo grafico in token assoluti

---

## 📂 File chiave per la prossima sessione

```
docs/internal/2026-05-01-bridge-and-token-monitoring.md   roadmap dettagliata
docs/internal/2026-05-01-team-session-report.md           numeri sessione test
BACKLOG.md → JHT-BRIDGE-V7 / V8 / LAUNCH-LOW-PROFILE      entry alta livello

.launcher/sentinel-bridge.py                              bridge V6 (da estendere)
shared/skills/token-meter.py                              PoC daemon (da rifattorizzare)
shared/skills/token-meter-plot.py                         analisi 4-panel
shared/skills/token-by-agent-plot.py                      cumulative per-agente
shared/skills/token-by-agent-rate.py                      rate per-agente
shared/skills/agent-communication-graph.py                network graph
web/app/api/bridge/status/route.ts                        api esistente (template)
```
