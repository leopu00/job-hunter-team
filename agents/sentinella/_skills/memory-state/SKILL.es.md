<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: memory-state
description: Variables de estado que el Centinela debe mantener entre ticks (ultima orden enviada, flag de freeze, racha FATAL, contadores por estado, historial de emergencias, cooldowns). Usa esta skill en cada tick para actualizar la memoria y decidir si se requiere una nueva orden (edge-triggered).
---

# Skill — Memoria de estado (variables entre ticks)

Mantiene estas variables en tu memoria conversacional. Las usas para decidir si notificar al Capitan (edge-triggered).

## Variables

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
freeze_active             = bool   # True despues de freeze_team.py
fatal_streak              = int    # 0/1/2: ciclos FATAL consecutivos
tick_steady_count         = int    # ticks consecutivos proj 90-95%
                                   # (para MANTIENI despues de 3)
tick_below_gspot_count    = int    # ticks consecutivos proj 70-90%
                                   # (para PUSH G-SPOT despues de 2)
tick_sotto_count          = int    # ticks consecutivos proj<70 + vel<ideale×0.7
                                   # (para SCALA UP despues de 2)
emergency_proj_history    = list   # ultimos 5 proj durante zona >100%
                                   # (para RECOVERY TRACKING / STAGNAZIONE)
emergency_proj_min        = float  # proj minima alcanzada en el episodio
                                   # (para PEGGIORAMENTO POST-FREEZE)
push_gspot_cooldown       = int    # cooldown PUSH G-SPOT (0/1/2/3 tick)
scala_up_cooldown         = int    # cooldown SCALA UP (0/1/2 tick)
recovery_tracking_cooldown = int   # cooldown RECOVERY TRACKING (0/1/2/3)
```

## Actualizacion en cada tick

```python
# Pseudocodigo a ejecutar en cada [BRIDGE TICK]:

# 1. Decremento de cooldown
push_gspot_cooldown = max(0, push_gspot_cooldown - 1)
scala_up_cooldown   = max(0, scala_up_cooldown - 1)
recovery_tracking_cooldown = max(0, recovery_tracking_cooldown - 1)

# 2. Contadores de estado
if status == "STEADY":          tick_steady_count += 1
else:                            tick_steady_count = 0

if 70 <= proj < 90:             tick_below_gspot_count += 1
else:                            tick_below_gspot_count = 0

if proj < 70 and vel < ideale * 0.7:
                                tick_sotto_count += 1
else:                            tick_sotto_count = 0

# 3. Memoria de emergencia (zona proj > 100%)
if proj > 100:
    emergency_proj_history.append(proj)
    emergency_proj_history = emergency_proj_history[-5:]
    emergency_proj_min = min(emergency_proj_min or float('inf'), proj)
else:
    # Salida de zona de emergencia: reset
    emergency_proj_history = []
    emergency_proj_min = None

# 4. Evento de reset
if last_sample.usage - usage > 30:
    reset_session()  # reinicia historial, envia RESET SESSIONE
```

## Cuando actualizar `last_ordine`

Actualiza **solo despues de haber enviado una orden al Capitan**:

```python
last_ordine = {
    tipo:     "<tipo dell'ordine inviato>",
    throttle: <throttle del messaggio>,
    usage:    <usage al momento>,
    proj:     <proj al momento>,
    ts:       "<HH:MM:SS>",
}
```

Si decides SILENZIO (sin notificacion), `last_ordine` permanece sin cambios.

## Reset al RESET SESSIONE

Si `usage` baja mas de 30 puntos respecto al sample anterior:
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

Luego envia ORDINE: RESET SESSIONE al Capitan (ver skill `order-formats`).
