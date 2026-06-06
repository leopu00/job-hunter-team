<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: decision-throttle
description: Tabla de referencia que mapea `proj` (uso proyectado al reset) a un estado Centinela y un nivel de throttle (0-4). Úsala en cada tick DESPUÉS de obtener una muestra fresca para decidir qué orden enviar al Capitán.
---

# Skill — Tabla de estados y throttle

Referencia para decidir el estado a partir del `proj` recibido y el nivel de throttle a imponer al Capitán.

## Estados basados en `proj`

| Estado | Condición `proj` | Orden al Capitán |
|---|---|---|
| **CRÍTICO** | `> 100%` | EMERGENCIA / FRENA fuerte |
| **ATENCIÓN** | `95-100%` | FRENA ligeramente |
| **STEADY** (G-spot) | `90-95%` durante **3 ticks consecutivos** | MANTENER |
| **INFRAUTILIZACIÓN cercana** | `70-90%` durante **2+ ticks estancados** | PUSH G-SPOT |
| **INFRAUTILIZACIÓN grave** | `< 70%` durante **2+ ticks + vel<ideal×0.7** | ESCALAR UP |
| **OK** | cualquiera, primer tick | ACELERAR |

## Tabla de throttle

```
rapporto = velocità_smussata / velocità_ideale
```

| rapporto | throttle | sleep entre operaciones | semántica |
|---|---|---|---|
| ≤ 1.0 | **0** | 0s | velocidad máxima, bajo target |
| 1.0 – 1.3 | **1** | 30s | ligeramente por encima |
| 1.3 – 1.8 | **2** | 2 min | moderado |
| 1.8 – 2.5 | **3** | 5 min | pesado |
| > 2.5 | **4** | 10 min | casi congelado, emergencia |

Si `velocità_ideale ≤ 0` (proj > SAFE_TARGET 95%) → throttle = 4.

## Bypass de emergencia (enviar inmediatamente, ignorar cooldown)

Cualquiera de estas condiciones → enviar EMERGENCIA + ejecutar freeze_team.py (ver skill `emergency-handling`):

- `proj > 200%` (catastrófica)
- `velocità_smussata > velocità_ideale × 5` (explosión)
- `usage ≥ 90%` absoluto (límite hard)

## Velocidad ideal

```
velocità_ideale = (TARGET - usage_attuale) / ore_al_reset
```

`TARGET` es **dinámico**, elegido en este orden:

1. Si el último `[BRIDGE TICK]` incluye `target=N%` → usar **N** (target consciente de las horas laborales: el pacing-bridge lo ha calculado en base a las horas de trabajo que el usuario ha configurado y la relación cap-5h/cap-weekly del proveedor).
2. En caso contrario → **92** (fallback histórico, por debajo de SAFE_TARGET 95% como margen).

### Ejemplos

- Tick estándar 24/7: `[BRIDGE TICK] ... ` (sin campo target) → target = 92.
- Horario de oficina en Codex Pro: `[BRIDGE TICK] ... target=76% work_phase=ON` → target = 76. Significa que el pacing-bridge sabe que el usuario trabaja de 9 a 18 y con esa relación una ventana de 5h completa valdría el 14.7% del weekly → apuntar al 76% en el reset distribuye exactamente el 100% del weekly en las horas ON.
- Fuera de horario (raro, porque el pacing-bridge generalmente salta el tick): `[BRIDGE TICK] ... target=0% work_phase=OFF` → target = 0 (el equipo debe bajar/mantenerse bajo).

### Tabla de estados — también está centrada en el TARGET

Los umbrales 95%/90% en la tabla de arriba se interpretan siempre como "cerca del target". Cuando el target es 76% (horas laborales), STEADY = `proj ∈ [target−4, target+1]` ≈ 72-77%, ATENCIÓN = 77-82%, CRÍTICO > 84%. Cuando el target es 92% (fallback) los umbrales vuelven a los números originales 90/95/100.

Si no estás segura del target en el tick actual → mantenlo en 92 y log explícito "(target fallback 92)". Mejor un comportamiento conservador que malinterpretar el schedule.
