# Bridge V6 + token-based monitoring — note di sessione (2026-05-01)

> Documento di lavoro per brainstorming. Rappresenta lo stato dopo la sessione
> di refactor del bridge e PoC del monitoring token-based. Da promuovere o
> archiviare quando le idee qui dentro saranno tradotte in codice.

## TL;DR

- Il bridge V5 aveva un loop autoindotto: tick ogni minuto sveglia la Sentinella
  che sveglia il Capitano, entrambi LLM consumano, il consumo gonfia la
  proiezione, la Sentinella riceve un nuovo tick e il loop riparte. In 8 minuti
  bruciava ~64k token solo di dialogo bridge↔sentinella↔capitano.
- Bridge V6 (oggi in produzione) risolve con state machine g-spot + cooldown
  Sentinella 15 min. Risultato osservato: media proiezione **91 %** (target
  92.5 %), 68 % dei tick dentro il g-spot, Sentinella svegliata 1× ogni 15 min
  invece di ogni minuto.
- I log locali dei CLI (Kimi `wire.jsonl`, Claude Code project jsonl, Codex
  rollout) contengono i token consumati per ogni risposta API. Si possono
  leggere e aggregare per agente con risoluzione sub-token.
- Calibrazione empirica Kimi K2 Plan: 1 % rate budget ≈ **30 kT weighted**.
- Direzione futura: bridge V7 con throttle PID per-agente. Misura fine già c'è,
  manca solo la parte di azione fine.

## Cosa c'era prima (V5)

- Tick fisso ogni 1.5 min in fast mode, 5 min in slow.
- Ogni tick → `[BRIDGE TICK]` alla Sentinella → LLM call.
- Sentinella decide throttle e manda ordine al Capitano → LLM call.
- Capitano risponde con ACK → LLM call.
- Nessun cooldown reale durante emergenza (proj > 200 % bypassava i 2 tick).
- L'API web replicava la formula `_choose_tick_interval` in TS, fragile a ogni
  bump di versione del bridge: cambiata logica Python → UI mostrava timer
  sballato finché qualcuno non ricordava di aggiornare anche il TS.

Sintomo osservato in produzione: 8 tick consecutivi alle 21:18-21:23 hanno
generato 6 dialoghi Sentinella↔Capitano consecutivi che da soli portavano la
proiezione da 60 % a 288 %. Il termometro era diventato la febbre.

## Cosa è V6 (in produzione)

### State machine del tick interval

```
DEFAULT (3 min)        ← proj fuori g-spot (sotto 80 % o sopra 105 %)
GSPOT_FAST (2 min)     ← appena entrato nel g-spot, monitoring reattivo
GSPOT_STABLE (5 min)   ← 3 tick consecutivi nel g-spot
GSPOT_CALM (10 min)    ← 3 tick consecutivi a STABLE
```

G-spot definito come `proj ∈ [80, 105]` (banda larga rispetto a STEADY 90-95
del compute_metrics).

### Notifica Sentinella

```
in g-spot               → bridge tace, scrive solo JSONL
fuori g-spot, 1° tick   → sveglia Sentinella + parte cooldown 15 min
fuori g-spot, in cooldown → bridge tace
fuori g-spot, post 15min → rinotifica
ritorno in g-spot       → reset cooldown
```

### State file pubblico

Il bridge scrive `~/.jht/logs/sentinel-bridge-state.json` con scrittura atomica
(tmp + os.replace). Contiene: `next_tick_at`, `tick_phase`, `tick_interval_min`,
`last_status`, `last_projection`, `last_usage`, `g_spot`,
`sentinella_cooldown_min`, `last_sentinella_notify_at`.

L'API web `/api/bridge/status` legge direttamente da qui invece di ricalcolare:
fonte unica di verità, niente più drift V*→TS.

### Numeri reali della sessione (22:44 → 23:30 UTC, ~46 min)

```
projection avg     91.47 %         ← target ideale 90-95 %
projection median  95.31 %
% tick g-spot      68.4 % (13/19)
proj range         20 - 112 %      (20 % è outlier post wake-up VM)
usage             20 → 39 %        (Δ +19 in 19 tick)
```

Il sistema è già "centrato": la media coincide col setpoint, l'oscillazione è
dovuta principalmente a quantizzazione 1 % e a un wake-up VM all'avvio.

### Bug fixati lungo il percorso

- Container `jht` in crash loop per `croner` non installato sull'host
  (bind-mount maschera `/app/shared/cron/node_modules` del container). Fix:
  `npm install --prefix shared/cron` sull'host.
- `web/middleware.ts` (deprecato in Next 16) coesisteva con `web/proxy.ts`,
  causava unhandled rejection silenziosa che bloccava il dev server. Fix:
  portato CSP nonce dentro `proxy.ts`, rimosso `middleware.ts`.
- `JsonLd.tsx` (Client Component) importava `csp.ts` che usa `next/headers`
  (Server only). Fix: rimosso `getNonce()` da `JsonLd.tsx`. TODO: spostare
  `<JsonLd />` in Server Component per ripristinare nonce in produzione.

## Cosa abbiamo scoperto sui token

### I log locali contengono i token consumati per ogni risposta

| provider | path | campo |
|---|---|---|
| Kimi | `~/.kimi/sessions/<sess>/wire.jsonl` | `message.payload.token_usage = {input_other, output, input_cache_read, input_cache_creation}` + `context_tokens`, `max_context_tokens` |
| Claude Code | `~/.claude/projects/<proj>/<id>.jsonl` | `message.usage = {input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens}` |
| Codex | `~/.codex/sessions/.../rollout-*.jsonl` | event `token_count` con `info.last_token_usage` e `info.total_token_usage` |

Aggiornati a ogni risposta del modello, **prima** che l'endpoint /usage del
provider si aggiorni. Cioè la fonte locale è sempre più fresca dell'API.

### Mapping session → agente

- **Claude Code**: directory `~/.claude/projects/-jht-home-agents-<agent>/` —
  decoding diretto dal nome.
- **Codex**: rollout JSONL ha campo `cwd` (es. `/jht_home/agents/scout-1`).
- **Kimi**: l'hash di primo livello non corrisponde a `md5(cwd)`. Mapping via
  `state.json.custom_title`. Pattern noti:
  - `[@A -> @B] ...` → owner = B (l'**ultimo** `@<name>`, è il receiver)
  - `[@user -> @capitano] ...` → owner = capitano
  - `[SENTINELLA] [STATUS] ...` → owner = sentinella (uppercase fallback)

Trappola incontrata: il primo regex prendeva `cands[0]` (sender) e attribuiva
1.8 MT al CAPITANO che in realtà erano lavoro di SCOUT-1. Fix: prendere
`cands[-1]`.

### Calibrazione empirica Kimi K2 Plan

- Δ bridge 30 % → 34 % in 5 min, weighted Δ +121 kT → ratio incrementale
  **30 kT per 1 %**.
- Ratio cumulativo (3.3 MT / 35 %) dava ~110 kT per 1 % — falsato dalla
  finestra fissa 5 h dello script che includeva token consumati prima del
  rate budget window del provider.
- **Lezione**: la WINDOW del meter va legata al `reset_at` del bridge, non a
  un valore fisso.
- I pesi cache (cache_read = 0.1, cache_creation = 1.25) sono ipotesi di
  partenza. Da fittare con regressione su 10+ calibrazioni a Δ% ≥ 2.

### Risultati osservati per-agente nella sessione

```
🕵 SCOUT-1      1083.5 kT    91 events    avg 22.2 kT/min   peak 62.2
👑 CAPITANO      125.1 kT    24 events    avg  3.5 kT/min   peak 15.6
🔎 CRITICO       102.9 kT    27 events    avg  3.3 kT/min   peak 12.4
🛡 SENTINELLA     44.7 kT    10 events    avg  1.4 kT/min   peak  7.1
─────────────────────────────────────────────────────────────────
team total      1356.1 kT    152 events   team avg 27.8 kT/min
```

Lo Scout consuma 7× il Capitano: il sistema attuale tratta tutti uguali, ma il
contributo è radicalmente sbilanciato. Spazio enorme per throttle differenziato.

### Tool prodotti

- `shared/skills/token-meter.py` — daemon che legge i log ogni 30 s, scrive
  CSV a `~/.jht/logs/token-meter.csv`. Avviato in tmux session `TOKEN-METER`.
- `shared/skills/token-meter-plot.py` — analisi retroattiva con 4 pannelli
  (cumulativo + velocità + ratio incrementale + top sessioni).
- `shared/skills/token-by-agent-plot.py` — cumulative per-agente nel tempo +
  bar totali.
- `shared/skills/token-by-agent-rate.py` — rolling rate (kT/min) per-agente
  + media nel periodo.

## Direzione futura — bridge V7 con throttle PID per-agente

### Idea

Sostituire il bang-bang globale attuale ("Capitano dice a tutti +30s di
pausa") con un controllo proporzionale per-agente.

```
target per agente (allocation iniziale conservativa):
  🕵 Scout         60 % del budget    → 12 kT/min
  🔎 Critico       15 %               →  3 kT/min
  👑 Capitano      15 %               →  3 kT/min
  🛡 Sentinella    10 %               →  2 kT/min

ogni 30 s:
  per ogni agente:
    actual = rolling 60 s rate (dal token-meter)
    error  = actual - target
    se |error| > dead_band (10 % del target):
      delta_sleep = k_p × error
      Capitano riceve "[THROTTLE @<agente> ±Ns]"
      Capitano forwarda all'agente
      Agente onora la pausa nel loop
```

### Componenti necessari

1. **Bridge V7 state file** con `per_agent_rate` (kT/min, rolling 60s) per ogni
   agente attivo.
2. **throttle-controller.py** — script deterministico (no LLM), legge state
   file, calcola error per agent, scrive ordini.
3. **Convenzione di messaggio** `[THROTTLE @<agente> ±Ns]` riconosciuta dal
   Capitano.
4. **Regola nel prompt agenti**: "se ricevi `[THROTTLE +Ns]` aggiungi N secondi
   al sleep di fine iter".
5. **Anti-oscillazione**: dead-band ±10 %, rate-limit max ±3 s ogni 60 s,
   integrale per drift lento.

### Beneficio atteso

```
oggi:        media 91 %, stdev 20 %, in-target 68 %
con V7:      media 92 %, stdev  5 %, in-target 95 %
```

### Ragionamento di design

Il LLM diventa interrupt-driven, non polling-driven. La Sentinella non viene
più svegliata per gestire il throttle (lavoro meccanico) ma solo per decisioni
strategiche (freeze, switch provider, pausa programmata). Il Capitano riceve
solo URG, non più ACK su INFO.

## TODO derivate da questa sessione (ordine di priorità)

### Tier 2 — quick win post-sessione (1-2 h totali)

- `token-meter` con `WINDOW = since reset_at` invece di 5 h fissa.
- Promuovere `token-meter` a servizio persistente (singleton lock + autorestart
  da launcher, accanto al bridge).
- State file V7: bridge legge `wire.jsonl` e scrive `per_agent_rate` (anche se
  il throttle controller non c'è ancora, il dato è già esposto).

### Tier 3 — sessione dedicata (1 giornata)

- `throttle-controller.py` per-agente.
- Convenzione `[THROTTLE @<agente> ±Ns]` + aggiornamento prompt Capitano e
  agenti.
- Calibrazione setpoint per allocation: osservare 24 h, fittare i target sul
  pattern reale.

### Tier 4 — strategico

- Weekly window monitoring (`JHT-MONITORING-WEEKLY`): la state machine V6 +
  per-agent ci arriva senza riscrivere, basta cambiare le soglie.
- Hour slots (`JHT-MONITORING-WORKHOURS`): team off di notte, riallocation
  dei target nei giorni feriali.
- Dashboard UI: secondo grafico in token assoluti per agente.
- Fitting dei pesi cache (regressione su molteplici calibrazioni).

## Implementation plan — token-meter daemon V1

> Sezione operativa: scelte architetturali, schema, step concreti.
> Fonte di verità per la prossima sessione di implementazione.

### Decisioni architetturali

1. **Daemon**: 2 separati (bridge V6 invariato + nuovo `token-meter` standalone).
   - bridge resta autorevole su `% rate budget` (provider truth)
   - token-meter è autorevole su `tokens & per-agent rate` (local truth)
   - 2 lock, 2 lifecycle, ma decoupling pulito
   - se token-meter si rompe, il bridge continua a girare
2. **Provider scope iniziale**: solo Kimi (provider attivo oggi).
   Estensione a Claude / Codex come step successivo, dopo che il pattern è
   stabilizzato.
3. **Output**: state file JSON atomico (stesso pattern del bridge V6),
   path `$JHT_HOME/logs/token-meter-state.json`.

### Precondizione (PRIMO step, blocca tutto il resto)

- **`reset_at` deve essere esposto nello state file del bridge.**
  Oggi è nel JSONL ma non nel `sentinel-bridge-state.json`. Aggiungere campo
  in `_write_state_file()` di `.launcher/sentinel-bridge.py`. ~3 righe.
  Senza questo, il token-meter non può determinare la window provider.

### Schema `token-meter-state.json` (V1)

```json
{
  "version": 1,
  "pid": 12345,
  "updated_at": "2026-05-02T00:00:00+00:00",
  "provider": "kimi",
  "window_start": "2026-04-30T22:44:00+00:00",
  "window_end_estimated": "2026-05-01T03:44:00+00:00",
  "totals": {
    "events": 1134,
    "weighted_kt": 10785.9,
    "raw_in": 1410868,
    "raw_out": 575752,
    "raw_cache_read": 87992576,
    "raw_cache_creation": 0
  },
  "per_agent": {
    "scrittore-1": {
      "events": 455,
      "weighted_kt": 5205.1,
      "rate_kt_per_min_60s": 27.2,
      "last_event_at": "2026-05-01T02:11:50+00:00"
    }
  },
  "calibration": {
    "ratio_kt_per_pct": 30.5,
    "samples": 12,
    "last_bridge_pct": 84,
    "last_calibrated_at": "2026-05-01T02:11:00+00:00",
    "smoothing": "ema_alpha_0.3"
  }
}
```

### Step di implementazione (in ordine, ~3.5 h totali)

**Step 0 — precondizione (15 min)**
- File: `.launcher/sentinel-bridge.py`
- Aggiungi `reset_at` al payload di `_write_state_file()`.
- Aggiungi `last_status_provider` (alias di `last_status`) per chiarezza.

**Step 1 — refactor in libreria (45 min)**
- File nuovo: `shared/skills/token_metrics_lib.py` (puro, no I/O esterni)
- Funzioni:
  - `read_kimi_events(window_start_ts) -> Iterator[Event]`
  - `parse_session_to_agent(state_path) -> Optional[str]`
  - `billing_weighted(token_usage_dict) -> float`
  - `aggregate(events) -> {totals, per_agent, sessions}`
  - `rolling_rate(events, win_seconds) -> List[(dt, kT_per_min)]`
- L'attuale `token-meter.py` diventa thin wrapper sopra la lib.

**Step 2 — window dinamica via `reset_at` (30 min)**
- File: `shared/skills/token-meter.py` (refactor)
- Legge `sentinel-bridge-state.json`, estrae `reset_at`.
- Calcola `window_start = reset_at - 5h` (Kimi K2 finestra 5h sliding;
  parametrizzabile via `provider_window_hours`).
- Filtra eventi da `window_start` in poi → ratio cumulativo finalmente
  coerente con la pct del bridge.

**Step 3 — calibrazione incrementale (45 min)**
- Buffer in memoria delle ultime N coppie `(bridge_pct, weighted_total)`.
- Nuovo ratio = `Δw / Δpct` quando `bridge_pct` avanza.
- EMA con `alpha = 0.3` per smoothing.
- Se `Δpct < 1` (quantizzazione), skip calibrazione (no dato).
- Espone `ratio_kt_per_pct` nello state file.

**Step 4 — per-agent rate rolling 60s (30 min)**
- Per ogni agente, calcola somma weighted negli ultimi 60s.
- `rate_kt_per_min_60s = sum_60s / 60 * 60` (= sum_60s in kT/min).
- Espone in `per_agent[<name>].rate_kt_per_min_60s`.

**Step 5 — daemon persistente (45 min)**
- Singleton lock (PID file in `$JHT_HOME/logs/token-meter.pid`,
  check via `/proc/<pid>/cmdline` come fa il bridge).
- Loop ogni 30s.
- Atomic write dello state (`.tmp` + `os.replace`).
- Bash control: `shared/skills/token-meter-control.sh` con
  `start|stop|status` (stesso pattern di `bridge-control.sh`).
- Lifecycle integrato in launcher: `start-agent.sh` lo spawna al boot
  team se non già attivo.

**Step 6 — endpoint web (30 min)**
- File nuovo: `web/app/api/tokens/status/route.ts`
- Pattern: legge `token-meter-state.json` con staleness check (5 min).
- Niente replica logica TS (lezione V6).
- Se file mancante / stale: `running: false`, niente stima locale
  (il fallback può venire dopo).

### Definition of Done (DoD)

- Daemon gira come servizio singolarmente startabile e stoppabile.
- State file aggiornato ogni 30s con dati coerenti.
- Ratio calibrato si stabilizza (deviazione < 20%) entro 5-6 calibrazioni.
- Endpoint `/api/tokens/status` ritorna 200 + JSON valido in dev mode.
- Almeno 1 test unitario per `billing_weighted` e
  `parse_session_to_agent` (smoke).
- Documentato in `BACKLOG.md` come `[JHT-BRIDGE-V7]` con check ✅.

### Decisioni rinviate (non bloccano V1)

- Provider Claude / Codex (V2)
- UI dashboard con grafico token (post V1)
- Esposizione storica via JSONL append (oggi solo state corrente)
- Throttle controller PID (Tier 3, dopo V1)

## Bug noti ancora aperti

- **BUG-TUI-BUILD** (master rotta dal commit `6f35755d`, CI Docker fail
  silenzioso): `tui/src/oauth/storage.ts` importa fuori `rootDir`. Coperto
  per il dev mode dal bind-mount + patch host, ma da pulire.
- **BUG-CSP-JSONLD-LANDING**: `JsonLd.tsx` ora gira senza nonce, in produzione
  il rich snippet di Google viene bloccato dal CSP `strict-dynamic`. Fix:
  spostare `<JsonLd />` in un Server Component (es. `app/layout.tsx`).
- **UI countdown drift**: la dashboard web mostra "next tick fra X secondi"
  che si disallinea quando la tab resta in background. Lo state file ora è
  corretto (verificato), il problema è nel countdown frontend.

## Riferimenti veloci

- Bridge: `.launcher/sentinel-bridge.py` (~750 righe)
- API web: `web/app/api/bridge/status/route.ts`
- Compute metrics: `shared/skills/compute_metrics.py`
- Token meter: `shared/skills/token-meter*.py`
- Logs: `~/.jht/logs/sentinel-data.jsonl`, `sentinel-bridge-state.json`,
  `token-meter.csv`, `token-analysis.png`, `token-by-agent.png`,
  `token-by-agent-rate.png`
