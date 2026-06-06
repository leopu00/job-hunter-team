<!-- @translation: hu, ai-translated 2026-06-06 -->
---
name: memory-state
description: Allapotvalttozok, amelyeket az Orszem tickek kozott meg kell oriznie (utolso kuldott parancs, freeze flag, FATAL sorozat, allapotonkenti szamlalok, veszhelyzeti elozmeny, cooldownok). Hasznald ezt a skillt minden ticknel a memoria frissitesehez es annak eldontsehez, hogy szukseges-e uj parancs (edge-triggered).
---

# Skill — Allapotmemoria (valtozok tickek kozott)

Tartsd ezeket a valtozokat a beszelgetesi memoriadban. Ezek alapjan dontod el, hogy ertesitened kell-e a Kapitanyt (edge-triggered).

## Valtozok

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
freeze_active             = bool   # True a freeze_team.py utan
fatal_streak              = int    # 0/1/2: egymas utani FATAL ciklusok
tick_steady_count         = int    # egymas utani tickek proj 90-95%
                                   # (MANTIENI-hez 3 utan)
tick_below_gspot_count    = int    # egymas utani tickek proj 70-90%
                                   # (PUSH G-SPOT-hoz 2 utan)
tick_sotto_count          = int    # egymas utani tickek proj<70 + vel<ideale×0.7
                                   # (SCALA UP-hoz 2 utan)
emergency_proj_history    = list   # utolso 5 proj a >100%-os zonaban
                                   # (RECOVERY TRACKING / STAGNAZIONE-hoz)
emergency_proj_min        = float  # az epizodban elert minimalis proj
                                   # (PEGGIORAMENTO POST-FREEZE-hez)
push_gspot_cooldown       = int    # cooldown PUSH G-SPOT (0/1/2/3 tick)
scala_up_cooldown         = int    # cooldown SCALA UP (0/1/2 tick)
recovery_tracking_cooldown = int   # cooldown RECOVERY TRACKING (0/1/2/3)
```

## Frissites minden ticknel

```python
# Pseudokod, amelyet minden [BRIDGE TICK]-nel vegre kell hajtani:

# 1. Cooldown csokkentese
push_gspot_cooldown = max(0, push_gspot_cooldown - 1)
scala_up_cooldown   = max(0, scala_up_cooldown - 1)
recovery_tracking_cooldown = max(0, recovery_tracking_cooldown - 1)

# 2. Allapotszamlalok
if status == "STEADY":          tick_steady_count += 1
else:                            tick_steady_count = 0

if 70 <= proj < 90:             tick_below_gspot_count += 1
else:                            tick_below_gspot_count = 0

if proj < 70 and vel < ideale * 0.7:
                                tick_sotto_count += 1
else:                            tick_sotto_count = 0

# 3. Veszhelyzeti memoria (proj > 100% zona)
if proj > 100:
    emergency_proj_history.append(proj)
    emergency_proj_history = emergency_proj_history[-5:]
    emergency_proj_min = min(emergency_proj_min or float('inf'), proj)
else:
    # Kileptes a veszhelyzeti zonabol: reset
    emergency_proj_history = []
    emergency_proj_min = None

# 4. Reset esemeny
if last_sample.usage - usage > 30:
    reset_session()  # nullazza az elozmenyt, RESET SESSIONE-t kuld
```

## Mikor frissitsd a `last_ordine`-t

Frissitsd **csak azutan, hogy parancsot kuldtel a Kapitanynak**:

```python
last_ordine = {
    tipo:     "<tipo dell'ordine inviato>",
    throttle: <throttle del messaggio>,
    usage:    <usage al momento>,
    proj:     <proj al momento>,
    ts:       "<HH:MM:SS>",
}
```

Ha SILENZIO mellett dontesz (nincs ertesites), a `last_ordine` valtozatlan marad.

## Reset a RESET SESSIONE-nal

Ha a `usage` tobb mint 30 ponttal csokken az elozo samplehez kepest:
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

Ezutan kuldd el az ORDINE: RESET SESSIONE-t a Kapitanynak (lasd skill `order-formats`).
