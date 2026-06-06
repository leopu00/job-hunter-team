<!-- @translation: pt, ai-translated 2026-06-06 -->
---
name: memory-state
description: Variaveis de estado que a Sentinela deve manter entre ticks (ultima ordem enviada, flag de freeze, serie FATAL, contadores por estado, historico de emergencias, cooldowns). Use esta skill em cada tick para atualizar a memoria e decidir se uma nova ordem e necessaria (edge-triggered).
---

# Skill — Memoria de estado (variaveis entre ticks)

Mantenha estas variaveis na sua memoria conversacional. Voce as usa para decidir se deve notificar o Capitao (edge-triggered).

## Variaveis

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
freeze_active             = bool   # True apos freeze_team.py
fatal_streak              = int    # 0/1/2: ciclos FATAL consecutivos
tick_steady_count         = int    # ticks consecutivos proj 90-95%
                                   # (para MANTIENI apos 3)
tick_below_gspot_count    = int    # ticks consecutivos proj 70-90%
                                   # (para PUSH G-SPOT apos 2)
tick_sotto_count          = int    # ticks consecutivos proj<70 + vel<ideale×0.7
                                   # (para SCALA UP apos 2)
emergency_proj_history    = list   # ultimos 5 proj durante zona >100%
                                   # (para RECOVERY TRACKING / STAGNAZIONE)
emergency_proj_min        = float  # proj minima atingida no episodio
                                   # (para PEGGIORAMENTO POST-FREEZE)
push_gspot_cooldown       = int    # cooldown PUSH G-SPOT (0/1/2/3 tick)
scala_up_cooldown         = int    # cooldown SCALA UP (0/1/2 tick)
recovery_tracking_cooldown = int   # cooldown RECOVERY TRACKING (0/1/2/3)
```

## Atualizacao em cada tick

```python
# Pseudocodigo a executar em cada [BRIDGE TICK]:

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
    # Saida da zona de emergencia: reset
    emergency_proj_history = []
    emergency_proj_min = None

# 4. Evento de reset
if last_sample.usage - usage > 30:
    reset_session()  # reinicia historico, envia RESET SESSIONE
```

## Quando atualizar `last_ordine`

Atualize **somente apos ter enviado uma ordem ao Capitao**:

```python
last_ordine = {
    tipo:     "<tipo dell'ordine inviato>",
    throttle: <throttle del messaggio>,
    usage:    <usage al momento>,
    proj:     <proj al momento>,
    ts:       "<HH:MM:SS>",
}
```

Se voce decidir SILENZIO (sem notificacao), `last_ordine` permanece inalterado.

## Reset ao RESET SESSIONE

Se `usage` cair mais de 30 pontos em relacao ao sample anterior:
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

Em seguida, envie ORDINE: RESET SESSIONE ao Capitao (veja skill `order-formats`).
