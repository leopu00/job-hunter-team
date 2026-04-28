---
name: memory-state
description: State variables the Sentinel must keep across ticks (last order sent, freeze flag, FATAL streak, per-state counters, emergency history, cooldowns). Use this skill on every tick to update memory and decide if a new order is required (edge-triggered).
---

# Skill — Memoria di stato (variabili tra tick)

Mantieni queste variabili nella tua memoria conversazionale. Le usi per decidere se notificare il Capitano (edge-triggered).

## Variabili

```
last_ordine = {
    tipo:     "ACCELERA | RALLENTARE | EMERGENZA | RIENTRO | RESET |
               MANTIENI | SCALA_UP | PUSH_GSPOT | RECOVERY | STAGNAZIONE |
               PEGGIORAMENTO | None",
    throttle: 0..4,
    usage:    int,
    proj:     float,
    ts:       "HH:MM:SS",
}
freeze_active             = bool   # True dopo freeze_team.py
fatal_streak              = int    # 0/1/2: cicli FATAL consecutivi
tick_steady_count         = int    # tick consecutivi proj 90-95%
                                   # (per MANTIENI dopo 3)
tick_below_gspot_count    = int    # tick consecutivi proj 70-90%
                                   # (per PUSH G-SPOT dopo 2)
tick_sotto_count          = int    # tick consecutivi proj<70 + vel<ideale×0.7
                                   # (per SCALA UP dopo 2)
emergency_proj_history    = list   # ultimi 5 proj durante zona >100%
                                   # (per RECOVERY TRACKING / STAGNAZIONE)
emergency_proj_min        = float  # minima proj raggiunta nell'episodio
                                   # (per PEGGIORAMENTO POST-FREEZE)
push_gspot_cooldown       = int    # cooldown PUSH G-SPOT (0/1/2/3 tick)
scala_up_cooldown         = int    # cooldown SCALA UP (0/1/2 tick)
recovery_tracking_cooldown = int   # cooldown RECOVERY TRACKING (0/1/2/3)
```

## Aggiornamento ad ogni tick

```python
# Pseudocode da eseguire ad ogni [BRIDGE TICK]:

# 1. Cooldown decrement
push_gspot_cooldown = max(0, push_gspot_cooldown - 1)
scala_up_cooldown   = max(0, scala_up_cooldown - 1)
recovery_tracking_cooldown = max(0, recovery_tracking_cooldown - 1)

# 2. Counter stato
if status == "STEADY":          tick_steady_count += 1
else:                            tick_steady_count = 0

if 70 <= proj < 90:             tick_below_gspot_count += 1
else:                            tick_below_gspot_count = 0

if proj < 70 and vel < ideale * 0.7:
                                tick_sotto_count += 1
else:                            tick_sotto_count = 0

# 3. Memoria emergenza (zona proj > 100%)
if proj > 100:
    emergency_proj_history.append(proj)
    emergency_proj_history = emergency_proj_history[-5:]
    emergency_proj_min = min(emergency_proj_min or float('inf'), proj)
else:
    # Uscita zona emergenza: reset
    emergency_proj_history = []
    emergency_proj_min = None

# 4. Reset event
if last_sample.usage - usage > 30:
    reset_session()  # azzera storico, manda RESET SESSIONE
```

## Quando aggiornare `last_ordine`

Aggiorna **solo dopo aver inviato un ordine al Capitano**:

```python
last_ordine = {
    tipo:     "<tipo dell'ordine inviato>",
    throttle: <throttle del messaggio>,
    usage:    <usage al momento>,
    proj:     <proj al momento>,
    ts:       "<HH:MM:SS>",
}
```

Se decidi SILENZIO (no notifica), `last_ordine` resta invariato.

## Reset al RESET SESSIONE

Se `usage` cala di > 30 punti rispetto al sample precedente:
```
last_ordine            = None
freeze_active          = False
tick_steady_count      = 0
tick_below_gspot_count = 0
tick_sotto_count       = 0
emergency_proj_history = []
emergency_proj_min     = None
*_cooldown             = 0
fatal_streak           = 0
```

Poi manda ORDINE: RESET SESSIONE al Capitano (vedi skill `order-formats`).
