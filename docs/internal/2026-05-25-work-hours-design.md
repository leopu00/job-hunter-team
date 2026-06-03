# Work hours UI — design + monitoring settimanale

> Sessione di design 2026-05-25. Mette le basi per `[JHT-MONITORING-WORKHOURS]`
> e completa `[JHT-MONITORING-WEEKLY]`. Mockup HTML interattivo iterato in
> ~6 round, poi trascritto qui.

## 🎯 Problem statement

Oggi il team gira 24/7 una volta avviato:

- Spreco token nelle ore in cui l'utente non userà mai gli output (notte profonda, weekend per chi cerca solo nei weekday).
- Tutte le finestre 5h vengono pacchate al ~92% → il budget settimanale Anthropic/Codex si esaurisce in 2-4 giorni, lasciando il team forzato idle per il resto della settimana.

Vogliamo passare al modello "team as employee": l'utente sceglie l'orario di lavoro, il team rispetta quegli orari e distribuisce il 100% del budget settimanale **solo** sulle ore attive.

## 🧩 Modello concettuale

```
budget_per_ora        = 100% / ore_attive_settimana
target_per_finestra5h = ore_attive_in_finestra × budget_per_ora
```

Quando il bridge entra in una finestra 5h:

1. Conta le ore attive che ricadono in `[window_start, window_start + 5h]`
2. Se 0 → emette `phase: OFF` al Capitano → team idle
3. Se >0 → setta `current_window_target` e abbassa/alza il throttle per atterrare lì

## 🗓️ UI — picker work hours

### Preset (one-click)

| Preset | Schedule | Ore/sett |
|---|---|---|
| 💼 Office hours (default) | Lun–Ven · 9:00–18:00 | 45h |
| 🌴 Solo weekend | Sab–Dom · 9:00–18:00 | 18h |
| ☀️ Tutti i giorni | Lun–Dom · 9:00–18:00 | 63h |
| 🌙 Notturno | Lun–Dom · 22:00–07:00 | 63h |
| 🎛️ Custom | clicca celle nella heatmap | variabile |

### Heatmap 7×24

Griglia giorni × ore (24 colonne, 7 righe). Celle arancioni = attive, grigie = idle. Click su qualsiasi cella per toggle → auto-switch su Custom.

### Pannello "Distribuzione budget"

- Ore attive/settimana (totale)
- Giorni attivi (N/7)
- Budget per ora (= 100 / totale)
- Budget per finestra 5h (= per_ora × 5)
- Δ vs. 24/7 (% del tempo)

### Bar chart per-giorno

Barre orizzontali per ogni giorno della settimana con quota % del budget settimanale per quel giorno (es. office hours: 5 barre uguali al 20%).

### Timeline finestre 5h (giorno tipo)

Track 24h orizzontale del primo giorno attivo, con:

- Blocchi arancioni per ore attive
- Linee tratteggiate verticali ai boundary delle finestre 5h
- Label per finestra con target % calcolato

Toggle ancoraggio finestre:

- **Inizio giornata lavorativa** (consigliato) — match comportamento reale Anthropic (windows resettano al primo prompt)
- **Mezzanotte** — più deterministico ma frammenta in 3 finestre invece di 2

### Tabella finestre

| Finestra | Range | Ore attive | Quota teorica | vs. oggi (92%) |
|---|---|---|---|---|
| W1 | 09:00 → 14:00 | 5h / 5h | 11.1% | −80.9pp |
| W2 | 14:00 → 19:00 | 4h / 5h | 8.9% | −83.1pp |
| W3 | 19:00 → 00:00 | 0h / 5h | — | team idle |
| ... | ... | ... | ... | ... |
| **Σ giornaliera** | | **9h** | **20%** | = 100% / 5 giorni |

## 🚧 Vincoli da rispettare (validazione UI bidirezionale)

Il rapporto `cap_5h / cap_settimanale` (chiamato `windowCapPct` qui sotto) determina due soglie:

### ⚠️ Vincolo 1 — spreco (troppe poche ore)

Se le ore selezionate sono insufficienti, il team non riesce a consumare il 100% weekly anche correndo al massimo:

```
min_ore_settimana = 100 / burn_naturale_pct_per_ora
```

Esempio Codex Pro (burn 2.70%/h):
- Min: **~38h/sett** per saturare il sub
- Weekend only (18h) → solo 49% raggiungibile → **51% sprecato** (~€51/mo equivalente buttato su sub da €100/mo)

UI: meter rosso/giallo + callout esplicito "Stai pagando €X ma usandone ~€Y".

### ⚠️ Vincolo 2 — diluizione (troppe ore)

Se le ore sono troppe, ogni finestra 5h userà meno del 25% del cap finestra → overhead alto per output basso. Soglia: target finestra ≥ 25% cap finestra.

```
max_ore_settimana = 2000 / windowCapPct_percent
```

Esempio Codex Pro (windowCapPct = 14.7%):
- Max: **~136h/sett** prima di diluire troppo
- 24/7 (168h) → max window al 20% del cap → **diluito** (target sotto soglia 25%)

UI: warning + suggerimento "Riduci di ~32h, sweet spot 38–136h".

### 🍯 Sweet spot per provider

| Provider | Min ore (saturate) | Max ore (no diluizione) | Sweet spot | Confidenza |
|---|---|---|---|---|
| Codex Pro | 38h | 136h | **38–136h** | 🟢 alta (case study reale) |
| Codex Plus | ~38h | ~136h | **38–136h** | 🟡 bassa (estrapolato) |
| Claude Max x20 | ~40h | ~133h | **40–133h** | 🟡 bassa (stima) |
| Claude Max x5 | ~40h | ~133h | **40–133h** | 🟡 bassa (stima) |
| Kimi K2 Plan | ∞ (no weekly cap) | n/a | **nessun vincolo budget** | 🟢 alta |

## 📊 Calcolo concreto Office hours su Codex Pro

Dati base (case study 2026-05-21):

```
Run continuo  : 34.84h
Consumo       : 96% weekly budget = 396.9M token weighted
Burn rate     : 2.70%/h del weekly
→ 100% weekly Codex Pro = 413.4M token
→ 100% finestra 5h      = 60.7M token (= 14.7% weekly)
```

Office hours (45h/sett → 2.22%/h):

| Finestra | % weekly | Token weighted | % cap 5h | vs. 92% oggi |
|---|---|---|---|---|
| W1 (5h attive) | 11.1% | 45.9M | 75.6% | −16.4pp |
| W2 (4h attive) | 8.9% | 36.8M | 60.6% | −31.4pp |
| W3-W5 (idle) | 0% | 0 | 0% | team idle |
| **Σ giorno** | **20%** | **82.7M** | — | — |
| **Σ settimana** | **100%** | **413M** | — | 100% sostenibile |

### Velocità richiesta vs. naturale

- Naturale (no throttle): 2.70%/h → finestra piena al 13.5% weekly
- Richiesta (work hours): 2.22%/h → finestra piena all'11.1% weekly
- Rallentamento: **82% velocità naturale** → ~18% sleep aggiuntivo distribuito sui 7 agenti

Il `pacing-bridge.py` esistente già modula throttle per atterrare sul target band. Cambio chirurgico: sostituire `target_pct = 92` (finestra) con `target_pct = compute_target(now, schedule)` (work-hours-aware).

### Beneficio economico stimato

- **Oggi**: 96% weekly bruciato in 35h continui → team idle per altri 133h
- **Con work hours**: 100% weekly distribuito su 45h attive → +10h produttive (+28%) a parità di sub
- **Cost per CV**: oggi €0.95 → proiezione €0.74 (più CV prodotti / mese)

## 🧮 Scalabilità — il problema dell'incognita

`windowCapPct` (cap 5h come % del weekly) è **diverso per ogni piano** e **non documentato dai provider**. Soluzione: **seed estimate + auto-calibrazione**.

### Lookup table seed (day 0)

```js
const PROVIDERS = {
  "codex":      { seedWindowCapPctOfWeekly: 14.7, seedNatBurnPctH: 2.70, confidence: "high" },
  "codex-plus": { seedWindowCapPctOfWeekly: 14.7, seedNatBurnPctH: 2.70, confidence: "low"  },
  "claude":     { seedWindowCapPctOfWeekly: 15.0, seedNatBurnPctH: 2.50, confidence: "low"  },
  "claude-max5":{ seedWindowCapPctOfWeekly: 15.0, seedNatBurnPctH: 2.50, confidence: "low"  },
  "kimi":       { seedWindowCapPctOfWeekly: null, seedNatBurnPctH: null, weeklyUnlimited: true },
};
```

### Auto-calibrazione (pattern speculare a `token-meter`)

Nuovo daemon `shared/skills/window-ratio-meter.py`:

```
input:
  - sentinel-bridge-state.json  (5h window pct corrente)
  - compute_metrics.py output   (weekly pct corrente)

algoritmo:
  ad ogni tick (es. ogni 60s):
    sample (Δweekly_pct, Δwindow_pct) tra due osservazioni
    if Δwindow_pct > soglia_minima:
      ratio_instantaneous = Δweekly_pct / Δwindow_pct
      ema_update(ratio_instantaneous, half_life_days=7)

output:
  ~/.jht/logs/window-ratio-state.json
  {
    "provider": "codex",
    "seed_ratio_pct":   14.7,
    "observed_ratio_pct": 15.8,
    "ema_ratio_pct":    15.6,
    "samples_count":   1284,
    "days_observed":   3.5,
    "confidence_0_1":  0.875,
    "last_updated_at": "2026-05-28T14:23:00Z"
  }
```

### Blend seed + observed nel bridge

```python
w = min(1.0, days_observed / 4.0)
effective_ratio = w * observed_ratio + (1 - w) * seed_ratio

# da qui ricalcolo dinamico:
window_cap_pct_of_weekly = effective_ratio
sweet_spot_min = ceil(100 / observed_burn_rate)
sweet_spot_max = floor(2000 / window_cap_pct_of_weekly)
```

### Companycycle utente

1. **Day 0** — onboarding: utente sceglie provider+tier → seed dalla lookup table → UI mostra badge "🌱 seed (stima iniziale)"
2. **Day 1-3** — bridge accumula osservazioni → badge "📊 calibrating (day N)" → sweet spot si raffina
3. **Day 4+** — "✅ calibrated" → EMA stabilizzato, sweet spot affidabile
4. **Drift** — se observed devia >20% dal trend EMA, log warning per debug

### 🎁 Bonus: dataset per case study futuri

Ogni run anonimo che fa autocalibrazione produce un sample `{provider, tier, observed_ratio}`. Aggregabile (opt-in cloud-sync) per costruire una lookup seed sempre più accurata → benefici a cascata per nuovi utenti. Diventa anche un asset comunicabile pubblicamente al lancio OSS.

## ⚙️ Decisioni di design lockate

| # | Decisione | Reco accettata |
|---|---|---|
| 1 | Granularità slot | day-of-week + slot multipli `{mon: [{09:00-13:00}, {14:00-18:00}], sat: []}` |
| 2 | Storage | `~/.jht/schedule.json` local-first + DB mirror via cloud_sync |
| 3 | Comportamento OFF | Soft pause via Captain (`phase: OFF` flag) — no `docker pause` |
| 4 | Timezone | IANA tz da browser onboarding, salvata in `schedule.json.timezone` |
| 5 | Ancoraggio finestre | Inizio giornata lavorativa (matcha reset Anthropic) |
| 6 | UI placement | Nuova sezione in `/team` sotto org-chart |
| 7 | Provider ratio | Seed + auto-calibrazione, no valori hardcoded persistenti |

## 📐 Schema files

### `~/.jht/schedule.json`

```jsonc
{
  "schema_version": 1,
  "timezone": "Europe/Rome",
  "preset": "office",                // office | weekend | daytime | night | custom
  "slots": {
    "mon": [{ "start": "09:00", "end": "18:00" }],
    "tue": [{ "start": "09:00", "end": "18:00" }],
    "wed": [{ "start": "09:00", "end": "18:00" }],
    "thu": [{ "start": "09:00", "end": "18:00" }],
    "fri": [{ "start": "09:00", "end": "18:00" }],
    "sat": [],
    "sun": []
  },
  "anchor": "workstart",             // workstart | midnight
  "enabled": true,
  "updated_at": "2026-05-25T18:30:00Z"
}
```

### `~/.jht/logs/window-ratio-state.json`

Vedi sezione auto-calibrazione sopra.

### Estensione `sentinel-bridge-state.json`

Aggiungere campi:

```jsonc
{
  // ... esistenti
  "work_phase": "ON",                // ON | OFF
  "current_window_target_pct": 11.1, // % weekly per la finestra corrente
  "next_phase_transition_at": "2026-05-25T18:00:00Z"
}
```

## 🚢 Implementation plan

Ordine consigliato (dipendenze):

1. **Schema** `~/.jht/schedule.json` + `~/.jht/logs/window-ratio-state.json` — fondazione
2. **API web** `GET/PUT /api/work-hours` (legge/scrive file via container exec, come `cloud.json`)
3. **Componente React** `<WorkHoursPicker />` su `/team` (porting del mockup HTML → JSX/Tailwind/shadcn)
4. **`window-ratio-meter.py`** (nuovo daemon, modellato su `token-meter.py`)
5. **`pacing-bridge.py`** integration: legge schedule + state → emette `work_phase` + `current_window_target_pct`
6. **Capitano**: rispetta `work_phase: OFF` → idle agenti (no nuovi assignment, finisci job in corso)
7. **Sentinella**: aggiorna projection per allinearsi al target window, non più 92% fisso

## 🔗 Riferimenti

- `BACKLOG.md` — entries `[JHT-MONITORING-WORKHOURS]`, `[JHT-MONITORING-WEEKLY]`, `[JHT-BRIDGE-V8]`
- `docs/internal/2026-05-01-bridge-and-token-monitoring.md` — pattern `ema_kt_per_pct` (analogo a `ema_ratio_pct`)
- `web/data/case-studies/seed.sql` — case study Codex Pro con 396.9M token / 34.84h
- `docs/about/RESULTS.md` — narrative case study pubblica
- `.launcher/pacing-bridge.py` — bridge V8 (auto-incentive), va esteso work-hours-aware
- `shared/skills/token_metrics_lib.py` — libreria condivisa metriche, base per `window-ratio-meter`
