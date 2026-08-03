<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: emergency-handling
description: Cómo gestionar las emergencias de rate-limit y la cascada FATAL cuando el bridge queda ciego. Incluye los triggers de bypass de cooldown, la ruta de recuperación L4-SOFT/L5-HARD y el manejo del RESET SESSIONE ante una caída de usage > 30 puntos.
allowed-tools: Bash(python3 *)
---

# Skill — Gestión de emergencias y cascada FATAL

## 🚨 Bypass de cooldown de emergencia (enviar de inmediato)

Cualquiera de estas condiciones → envía orden inmediata sin esperar cooldown:

- `proj > 200%` (catastrófica) **y** `reset_edge_guard != true`
- `velocità_smussata > velocità_ideale × 5` (explosión)
- `usage ≥ 90%` absoluto (límite hard)

En estos casos, **ANTES de la notificación ejecuta freeze_team.py**:

```bash
python3 /app/shared/skills/freeze_team.py
```

Envía Esc x2 a todos los operativos (excluye CAPITANO/ASSISTENTE/SENTINELLA/SENTINELLA-WORKER). El consumo se detiene incluso si el mensaje al Capitano se pierde.

Establece `freeze_active = True`.

### Guard en el borde del reset (últimos 30 minutos)

Cuando el tick tiene `reset_edge_guard=true`, la proyección es solo
diagnóstica: no hagas freeze, throttle, kill ni actualices
`emergency_proj_history` por `proj`, incluida la persistencia `proj > 150%`.
Mantén `suggested_throttle_s=0`. Las señales hard independientes
(`usage >= 90%`, FATAL del bridge) siguen activas.

## 📊 Triggers durante zona de emergencia (proj > 100%, guard inactivo)

Mantén `emergency_proj_history` (últimos 5) y `emergency_proj_min`. Tres triggers:

### RECOVERY TRACKING (info cada 3 ticks)
```
SE recovery_tracking_cooldown == 0 AND len(history) >= 3:
    delta_3 = history[-3] - history[-1]
    SE delta_3 > 0:    manda RECOVERY TRACKING (calo)
    SE delta_3 ≈ 0:    → vedi STAGNAZIONE
    SE delta_3 < -5:   → vedi PEGGIORAMENTO
    recovery_tracking_cooldown = 3
```

### STAGNAZIONE CRITICA (estancamiento crítico)
```
SE len(history) >= 5 AND proj > 150% AND (max(history) - min(history)) < 10:
    manda STAGNAZIONE CRITICA → "kill altri agenti, throttle non basta"
    cooldown 5 tick prima di rimandarla
```

### PEGGIORAMENTO POST-FREEZE (empeoramiento post-freeze)
```
SE proj > emergency_proj_min + 10:
    manda PEGGIORAMENTO POST-FREEZE → "secondo freeze + kill totale"
    no cooldown: scatta subito
```

## 🛡️ Cascada FATAL (bridge totalmente ciego)

Cuando el bridge no logra leer el usage y recibes `[BRIDGE FAILURE]`:

```
L1 — fetch HTTP rápido (ver skill `check-usage-http`)
     • OK → continúa normalmente
     • FAIL → ↓
L2 — TUI worker manual (ver skill `check-usage-tui`)
     • OK → continúa normalmente
     • FAIL → ↓
L3 — FATAL: ningún dato del bridge durante N ciclos consecutivos
```

### L4-SOFT — primer FATAL (`fatal_streak == 0 → 1`)

```bash
python3 /app/shared/skills/soft_pause_team.py
```

La skill envía 2 mensajes diferenciados vía `jht-tmux-send`:
- a los operativos: "[PAUSA] termina task corrente, attendi [RIPRENDI]"
- al CAPITANO: mensaje largo explicativo

Establece `fatal_streak = 1`. Silencio hasta que llegue un BRIDGE TICK válido o INFO.

### L5-HARD — segundo FATAL consecutivo (`fatal_streak == 1 → 2`)

```bash
python3 /app/shared/skills/freeze_team.py
```

Envía Esc x2 a todos los operativos (más agresivo). Además envía al Capitano la orden HARD FREEZE (ver skill `order-formats`).

Establece `fatal_streak = 2`.

### RIPRENDI (recuperación tras FATAL)

Cuando llega un `[BRIDGE TICK]` válido o `[BRIDGE INFO]` con `fatal_streak >= 1`:

1. Reset `fatal_streak = 0`, `freeze_active = False`
2. Calcula inmediatamente el throttle a partir del sample
3. Envía al Capitano la orden RIPRENDI con datos frescos (ver skill `order-formats`)
4. El Capitano se encarga de redistribuir `[RIPRENDI]` a sus operativos

### Tabla resumen FATAL

| `fatal_streak` | Trigger | Acción |
|---|---|---|
| 0 → 1 | primer L1+L2 ko | `soft_pause_team.py` + PAUSA TEAM al Capitano |
| 1 → 2 | segundo L1+L2 ko consecutivo | `freeze_team.py` + HARD FREEZE al Capitano |
| ≥ 1 → 0 | `[BRIDGE TICK]` válido o `[BRIDGE INFO]` | `[RIPRENDI]` al Capitano |

## 🔁 RESET SESSIONE

Si en un tick detectas que `usage` bajó **> 30 puntos** respecto al sample anterior, es un reset de ventana:

1. Borra todo el histórico (ver skill `memory-state`)
2. Envía RESET SESSIONE al Capitano (ver skill `order-formats`)
3. Trata el siguiente tick como "primer check" (baseline, sin orden)
