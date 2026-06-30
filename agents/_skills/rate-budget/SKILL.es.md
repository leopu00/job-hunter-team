<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: rate-budget
description: Lee el snapshot del presupuesto de rate-limit para el proveedor activo (uso %, tiempo hasta reset, velocidad, proyección, throttle recomendado) desde la bridge. Usarlo al inicio del Captain para planificar el ritmo y decidir cuántos agentes spawnear, luego periódicamente cuando quieras un snapshot fresco sin gastar tokens llamando al proveedor directamente. Cero llamadas al proveedor — lee el último tick ya escrito por la bridge.
allowed-tools: Bash(python3 *)
---

# rate-budget — snapshot del presupuesto de rate-limit

La bridge de monitoreo (`.launcher/sentinel-bridge.py`) sondea al proveedor activo cada 1–10 min (dinámico — más frecuente bajo presión) y escribe cada muestra en `/jht_home/logs/sentinel-data.jsonl`. Esta skill lee solo la **última muestra** ya escrita — ninguna llamada extra al proveedor.

## Al inicio del Captain

Antes de spawnear cualquier agente, ejecutar:

```bash
python3 /app/shared/skills/rate_budget.py plan
```

Salida típica:
```
=== Rate Budget — claude ===
  Usage:            53%
  Reset:            tra 2h 34m (2026-04-24 15:49 CEST)
  Measured velocity:+0.39%/h (EMA)
  Target velocity:  11.38%/h (to close at 92% by reset)
  Reset projection: 56%
  Status:           OK
  Throttle:         T0 full speed
  Host:             cpu=4.7% ram=9.8% (OK)

  Recommended policy: Spawn freely in parallel — keep normal pace.
  Margin to 92% target: 39%
  Last tick:        2026-04-24T10:23:18.705062+00:00
```

**Interpretación del Captain** (usar `Measured velocity` vs `Target velocity` — NO `Reset projection`, que es INFO volátil):
- `Throttle T0–T1` + `Measured velocity` muy por debajo de `Target velocity` (bajo ritmo) → spawn completo (Scout + Analyst + Scorer + Writer + Critic)
- `Throttle T1–T2` + `Measured` ≈ `Target` (a ritmo) → spawn reducido (una instancia por rol)
- `Throttle T2+` o `Measured velocity` por encima de `Target velocity` (quemando) → **sin spawn**, esperar a que la bridge libere el throttle
- `Reset projection` es solo INFO (extrapolación volátil al final de la ventana) — no basar el spawn en eso.

**Si la salida es `NO_DATA`:** la bridge aún no ha sondeado. Esperar 1-2 min y reintentar. No iniciar el equipo sin esta señal — arriesgas saturar el rate-limit a ciegas.

## Versión de una línea (scriptable)

```bash
python3 /app/shared/skills/rate_budget.py status
# → provider=claude usage=55% status=OK throttle=0 reset_in=2h 34m (at 2026-04-24 15:49 CEST)
```

Útil para logs rápidos o comprobaciones a mitad de bucle.

## Cuándo NO usarla

- **No llamarla en cada paso.** Usarla en los *cambios de fase* de tu plan (bootstrap, fin del batch Scout, después de una pausa, etc.). La bridge se actualiza a su propio ritmo; llamar más frecuentemente no devuelve datos más frescos.
- **No reemplaza el flujo asíncrono `[BRIDGE ORDER]`:** la bridge te notifica *cuando* la política cambia; tú planificas *mientras miras* el presupuesto. Los dos mecanismos son complementarios.
