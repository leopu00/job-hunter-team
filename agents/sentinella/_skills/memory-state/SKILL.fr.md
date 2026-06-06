<!-- @translation: fr, ai-translated 2026-06-06 -->
---
name: memory-state
description: Variables d'etat que la Sentinelle doit conserver entre les ticks (dernier ordre envoye, flag de freeze, serie FATAL, compteurs par etat, historique des urgences, cooldowns). Utilise cette skill a chaque tick pour mettre a jour la memoire et decider si un nouvel ordre est necessaire (edge-triggered).
---

# Skill — Memoire d'etat (variables entre ticks)

Conserve ces variables dans ta memoire conversationnelle. Tu les utilises pour decider si tu dois notifier le Capitaine (edge-triggered).

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
freeze_active             = bool   # True apres freeze_team.py
fatal_streak              = int    # 0/1/2: cycles FATAL consecutifs
tick_steady_count         = int    # ticks consecutifs proj 90-95%
                                   # (pour MANTIENI apres 3)
tick_below_gspot_count    = int    # ticks consecutifs proj 70-90%
                                   # (pour PUSH G-SPOT apres 2)
tick_sotto_count          = int    # ticks consecutifs proj<70 + vel<ideale×0.7
                                   # (pour SCALA UP apres 2)
emergency_proj_history    = list   # 5 derniers proj pendant la zone >100%
                                   # (pour RECOVERY TRACKING / STAGNAZIONE)
emergency_proj_min        = float  # proj minimale atteinte dans l'episode
                                   # (pour PEGGIORAMENTO POST-FREEZE)
push_gspot_cooldown       = int    # cooldown PUSH G-SPOT (0/1/2/3 tick)
scala_up_cooldown         = int    # cooldown SCALA UP (0/1/2 tick)
recovery_tracking_cooldown = int   # cooldown RECOVERY TRACKING (0/1/2/3)
```

## Mise a jour a chaque tick

```python
# Pseudocode a executer a chaque [BRIDGE TICK]:

# 1. Decrementation des cooldowns
push_gspot_cooldown = max(0, push_gspot_cooldown - 1)
scala_up_cooldown   = max(0, scala_up_cooldown - 1)
recovery_tracking_cooldown = max(0, recovery_tracking_cooldown - 1)

# 2. Compteurs d'etat
if status == "STEADY":          tick_steady_count += 1
else:                            tick_steady_count = 0

if 70 <= proj < 90:             tick_below_gspot_count += 1
else:                            tick_below_gspot_count = 0

if proj < 70 and vel < ideale * 0.7:
                                tick_sotto_count += 1
else:                            tick_sotto_count = 0

# 3. Memoire d'urgence (zone proj > 100%)
if proj > 100:
    emergency_proj_history.append(proj)
    emergency_proj_history = emergency_proj_history[-5:]
    emergency_proj_min = min(emergency_proj_min or float('inf'), proj)
else:
    # Sortie de zone d'urgence: reset
    emergency_proj_history = []
    emergency_proj_min = None

# 4. Evenement de reset
if last_sample.usage - usage > 30:
    reset_session()  # reinitialise l'historique, envoie RESET SESSIONE
```

## Quand mettre a jour `last_ordine`

Met a jour **uniquement apres avoir envoye un ordre au Capitaine**:

```python
last_ordine = {
    tipo:     "<tipo dell'ordine inviato>",
    throttle: <throttle del messaggio>,
    usage:    <usage al momento>,
    proj:     <proj al momento>,
    ts:       "<HH:MM:SS>",
}
```

Si tu decides SILENZIO (pas de notification), `last_ordine` reste inchange.

## Reset au RESET SESSIONE

Si `usage` baisse de plus de 30 points par rapport au sample precedent:
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

Puis envoie ORDINE: RESET SESSIONE au Capitaine (voir skill `order-formats`).
