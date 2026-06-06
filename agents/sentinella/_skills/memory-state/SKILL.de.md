<!-- @translation: de, ai-translated 2026-06-06 -->
---
name: memory-state
description: Zustandsvariablen, die der Wachposten zwischen Ticks beibehalten muss (letzter gesendeter Befehl, Freeze-Flag, FATAL-Serie, Zaehler pro Zustand, Notfall-Verlauf, Cooldowns). Verwende diese Skill bei jedem Tick, um den Speicher zu aktualisieren und zu entscheiden, ob ein neuer Befehl erforderlich ist (edge-triggered).
---

# Skill — Zustandsspeicher (Variablen zwischen Ticks)

Behalte diese Variablen in deinem Konversationsspeicher. Du verwendest sie, um zu entscheiden, ob du den Kapitaen benachrichtigen sollst (edge-triggered).

## Variablen

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
freeze_active             = bool   # True nach freeze_team.py
fatal_streak              = int    # 0/1/2: aufeinanderfolgende FATAL-Zyklen
tick_steady_count         = int    # aufeinanderfolgende Ticks proj 90-95%
                                   # (fuer MANTIENI nach 3)
tick_below_gspot_count    = int    # aufeinanderfolgende Ticks proj 70-90%
                                   # (fuer PUSH G-SPOT nach 2)
tick_sotto_count          = int    # aufeinanderfolgende Ticks proj<70 + vel<ideale×0.7
                                   # (fuer SCALA UP nach 2)
emergency_proj_history    = list   # letzte 5 proj waehrend Zone >100%
                                   # (fuer RECOVERY TRACKING / STAGNAZIONE)
emergency_proj_min        = float  # minimale proj im Episodenverlauf
                                   # (fuer PEGGIORAMENTO POST-FREEZE)
push_gspot_cooldown       = int    # cooldown PUSH G-SPOT (0/1/2/3 tick)
scala_up_cooldown         = int    # cooldown SCALA UP (0/1/2 tick)
recovery_tracking_cooldown = int   # cooldown RECOVERY TRACKING (0/1/2/3)
```

## Aktualisierung bei jedem Tick

```python
# Pseudocode, der bei jedem [BRIDGE TICK] ausgefuehrt wird:

# 1. Cooldown-Dekrementierung
push_gspot_cooldown = max(0, push_gspot_cooldown - 1)
scala_up_cooldown   = max(0, scala_up_cooldown - 1)
recovery_tracking_cooldown = max(0, recovery_tracking_cooldown - 1)

# 2. Zustandszaehler
if status == "STEADY":          tick_steady_count += 1
else:                            tick_steady_count = 0

if 70 <= proj < 90:             tick_below_gspot_count += 1
else:                            tick_below_gspot_count = 0

if proj < 70 and vel < ideale * 0.7:
                                tick_sotto_count += 1
else:                            tick_sotto_count = 0

# 3. Notfall-Speicher (Zone proj > 100%)
if proj > 100:
    emergency_proj_history.append(proj)
    emergency_proj_history = emergency_proj_history[-5:]
    emergency_proj_min = min(emergency_proj_min or float('inf'), proj)
else:
    # Verlassen der Notfallzone: Reset
    emergency_proj_history = []
    emergency_proj_min = None

# 4. Reset-Ereignis
if last_sample.usage - usage > 30:
    reset_session()  # setzt Verlauf zurueck, sendet RESET SESSIONE
```

## Wann `last_ordine` aktualisieren

Aktualisiere **nur nach dem Senden eines Befehls an den Kapitaen**:

```python
last_ordine = {
    tipo:     "<tipo dell'ordine inviato>",
    throttle: <throttle del messaggio>,
    usage:    <usage al momento>,
    proj:     <proj al momento>,
    ts:       "<HH:MM:SS>",
}
```

Wenn du dich fuer SILENZIO entscheidest (keine Benachrichtigung), bleibt `last_ordine` unveraendert.

## Reset beim RESET SESSIONE

Wenn `usage` um mehr als 30 Punkte gegenueber dem vorherigen Sample faellt:
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

Sende dann ORDINE: RESET SESSIONE an den Kapitaen (siehe Skill `order-formats`).
