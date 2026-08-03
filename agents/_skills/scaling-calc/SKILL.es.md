<!-- @translation: es, ai-translated 2026-08-03 -->
---
name: scaling-calc
description: "Calibración gradual del roster — mide el burn de 1 worker, calcula cuántos workers y qué throttle hacen falta para alcanzar la velocidad objetivo, y spawnea por etapas (nunca en sexta)."
---

# 🎚️ scaling-calc — cambia de marcha un escalón cada vez, no arranques en sexta

Cuando el equipo abre la ventana de trabajo (o necesitas consumir más), **NO** arranques
en sexta ("hay presupuesto de sobra → spawnear 5 scouts / throttle a 0"): todavía no sabes
cuánto consume realmente un worker en ESTE ciclo. Te calibras por escalones.

## Procedimiento

**1. Empieza con 1 SOLO worker** en el floor (5min, el mínimo para los workers).

**2. Observa durante ~30 min** para medir el burn real. Lee el burn del worker:
```
python3 /app/shared/skills/rate_budget.py            # velocidad objetivo sostenible (S)
# burn por agente: de la tabla que te reenvía la Sentinella, o bien:
python3 /app/shared/skills/agent-speed-table.py
```
Toma: **S** = velocidad sostenible (p. ej. `sustainable_burn` %weekly/h) y **b** = el
burn medido del worker (misma unidad).

**3. Calcula** roster + throttle:
```
python3 /app/agents/_skills/scaling-calc/scaling_calc.py --target <S> --measured <b>
# si has observado N workers a throttle T:
python3 .../scaling_calc.py --target <S> --measured <b_total> --workers <N> --throttle <T>
```
Te da: **cuántos workers**, **qué throttle** y un **plan por etapas**.

**4. Spawnea POR ETAPAS** siguiendo el plan: **de uno en uno**, **volviendo a medir** antes del
siguiente (~10 min bastan para ver el burn del recién llegado). NUNCA spawnees todo el bloque
de golpe.

> Esos 10 minutos son una **ventana de observación**, no un desfase: la distancia de fase entre
> dos workers del mismo escalón es `T/N` (el periodo dividido entre el número de workers que se
> lo reparten) y el launcher la aplica por sí solo en el momento del spawn. No es un número que
> haya que decidir aquí, y no es una constante: en un escalón de 5 minutos, tres workers quieren
> estar a 100s unos de otros.

## Las dos palancas
- **Worker por debajo del objetivo** (1 worker quema menos que el objetivo) → la palanca es el
  **número de workers** (paralelismo), todos **en el floor**. Añádelos por etapas.
- **Worker por encima del objetivo** (1 worker ya quema más que el objetivo) → la palanca es el
  **throttle**: mantén 1 worker y **sube** su throttle (la herramienta te da el valor exacto).
  NUNCA pongas el throttle a cero (los workers tienen de todos modos un floor de 5min).

## Qué NO hacer
- ❌ "Equipo ON, presupuesto de sobra → ACELERARLO TODO" — ese es el frenesí que quema una
  ventana de presupuesto en 25 min con cero output. **ACELERAR = subir UN escalón** (un worker
  más, o un escalón de throttle menos **hasta el floor**), y luego volver a medir.
- ❌ Spawnear 2-3 workers juntos. Siempre **escalonados**.
- ❌ Throttle a 0 en un worker (imposible: floor de 5min; y de todas formas es de eso de lo que están hechas las maratones).

## Ejemplo
1 scout en el floor (5min) quemó **1.4%/h**, objetivo sostenible **0.7%/h**:
```
scaling_calc.py --target 0.7 --measured 1.4
→ 1 worker @ 600s (10min) → burn ≈ 0.7/h   (basta con subir el throttle, sin spawn)
```
Si en cambio 1 scout quema solo **0.3%/h** con un objetivo de 0.7:
```
→ 2 workers @ 300s (floor), por etapas: spawnea el #1, observa 10min, vuelve a medir, luego el #2.
```
