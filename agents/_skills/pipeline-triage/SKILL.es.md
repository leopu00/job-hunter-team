<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: pipeline-triage
description: "Decidir QUÉ rol generar / pausar / eliminar basándose en el estado del backlog, no en intuición. Abrir esta skill CADA VEZ que observes — vel team < 50% del objetivo, O cualquier cola de rol = 0, O fuentes del Scout agotadas, O [SCALA UP] de Sentinella, O `PIPELINE VUOTA + UNDERSHOOT`, O `MARGINE` de bridge-pacing, O cold start, O cada vez que estés tentado de \"simplemente generar otro Scout\". NO esperes un `[SCALA UP]` explícito de Sentinella cuando las condiciones ya son visibles para ti en las métricas. El punto central: leer 4 números, elegir el un rol que rompe el cuello de botella, pasar a `spawn-agent`."
allowed-tools: Bash(python3 /app/shared/skills/db_query.py *), Bash(tmux *)
---

# pipeline-triage — escalamiento basado en datos

El pipeline es un sistema dinámico. Cada rol consume de forma muy diferente por tarea — añadir un 2.º Writer cuesta mucho más que añadir un 2.º Scout. Escalar en la cabeza cuando el cuello de botella está en la cola produce *más* backlog, no más output. Siempre empezar desde los datos.

## Cuándo abrir esta skill (bug #17)

La abres por **condiciones observadas**, no solo por órdenes explícitas del Sentinella. Triggers:

- Velocidad del equipo por debajo del 50% del objetivo
- Cualquier cola de rol en 0 (Scout agotado, Scorer/Writer inactivos)
- Fuentes del Scout reportadas como agotadas ("bebee, indeed, glassdoor — nada nuevo")
- `[SCALA UP]` del Sentinella
- `MARGINE` / `PIPELINE VUOTA + UNDERSHOOT` de bridge-pacing
- Cold start de una ventana

El anti-patrón histórico: el Capitano ve `SCRITTORE_QUEUE=0` + `PROMOTABLE_40_49=6`, **describe** la situación perfectamente al usuario, **no** ejecuta la promoción. Esta skill es *activa*, no *consultiva* — cuando las condiciones coinciden, ejecutas.

## Paso 1 — leer el backlog (siempre, antes de cualquier spawn)

```bash
python3 /app/shared/skills/db_query.py stats
```

De `positions` (P), `scores` (S), `applications` (A), computar:

| Métrica             | Fórmula                                                       | Qué significa                                       |
|---------------------|---------------------------------------------------------------|-----------------------------------------------------|
| **UNSCORED**        | P − S                                                         | posiciones que el Scorer aún tiene que evaluar      |
| **DRAFT_BLOCKED**   | applications con `status = draft`                             | Bucle Writer ↔ Critic estancado                     |
| **SCRITTORE_QUEUE** | posiciones con `score ≥ 50` Y sin application                 | Cola del Writer (demanda real de nuevos CVs)        |
| **PROMOTABLE_40_49**| posiciones con `score 40-49` Y sin application                | banda de parking — promovibes bajo demanda          |

También útil: `python3 /app/shared/skills/db_query.py dashboard` para estado de un vistazo + instancias activas por rol.

## Paso 1 bis — quién produce y quién se ha callado (2026-07-27)

Los workers ya no envían `[START]` / `[DONE]` (esos bookends eran 30 de los 37 mensajes que recibió el
Capitano en ~1,5h en un equipo de primer arranque). Su avance se tira desde aquí:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 30
```

⚠️ **Lista quién PRODUCE, así que un agente en stall desaparece de ella en lugar de destacar.** Un
backlog que no se vacía no es automáticamente un worker que falta: puede ser un worker vivo y
atascado, y spawnear un segundo deja al primero quemando. Antes de decidir, cruza tres fuentes:

| Vivo (`tmux list-sessions`) | Cola (`next-for-*`) | Transiciones (`recent-activity`) | Veredicto |
|---|---|---|---|
| sí | no vacía | 0 | **STALL** — confirma con `capture-pane`, luego `agent-emergency` (Dottore-first → kill). **No** spawnees un segundo encima |
| sí | no vacía | > 0 | está trabajando — es un problema de capacidad, ve al Paso 2 |
| sí | vacía | 0 | idle legítimo — déjalo en paz (tras un `[SCOUT-ESAUSTO]` la quiescencia es deliberada) |
| no | no vacía | 0 | falta de verdad — spawnéalo (Paso 2) |

## Paso 2 — elegir prioridad (cuello de botella primero, nunca trabajo nuevo)

Aplicar la tabla de arriba a abajo. Detenerse en la primera condición que coincida.

| Condición                                                 | Acción (en este orden)                                                                                                              |
|-----------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| `DRAFT_BLOCKED ≥ 50`                                      | **Primero**: inspeccionar los Writers propietarios/critic-loop. Nunca generar Critics huerfanos; cada `SCRITTORE-N` inicia solo su `CRITICO-SN` mediante el launcher canonico. Generar un Writer solo si existe su cola pedida por el usuario. |
| `UNSCORED ≥ 20`                                           | **Luego**: generar `SCORER-2` (y `SCORER-3` si `UNSCORED ≥ 50`). Un Scorer es insuficiente con 20+ en cola.                        |
| `SCRITTORE_QUEUE ≥ 5`                                     | generar 1 `SCRITTORE-N` si no tienes ya 3 vivos (máximo).                                                                           |
| `PROMOTABLE_40_49 ≥ 5`                                    | promover los mejores 5 subiendo la puntuación (`db_query.py` + `UPDATE` directo), luego tratar como `SCRITTORE_QUEUE`.              |
| `SCRITTORE_QUEUE < 5 AND PROMOTABLE_40_49 < 5`            | **Solo ahora** generar 1 `SCOUT-N` para nuevas posiciones.                                                                          |

Una vez que hayas elegido el rol, pasar a `spawn-agent` para el lanzamiento real + kick-off.

## Paso 3 — anti-patrones a evitar

- ❌ Generar un Scout como primera acción cuando `UNSCORED > 20` — produce más backlog sin output extra.
- ❌ Resetear throttle globalmente (`throttle-config.py reset`) al escalar — aplicar throttle solo al rol que generaste.
- ❌ Generar múltiples roles en el mismo tick "por seguridad" — esperar al siguiente tick del Sentinel (~5 min) y releer los números.
- ❌ Eliminar agentes inactivos para "ordenar" — el inactivo cuesta casi cero. Eliminar solo si lo solicita explícitamente el usuario, o si un agente está quemando tokens en un bucle confuso.

## Razón empírica (por qué este orden, no otro)

Observado en ventanas W3-W6 (pico mediano proj 57-61%): los Scouts producen ~3 posiciones/h consistentemente, pero Scorer/Critic NO drenan el backlog → 88 sin puntuar y 217 drafts acumulados = 12+ puntos de presupuesto de tasa sin usar. **La cura está downstream, no upstream.** Cada vez que estés bajo ritmo (`vel_team` debajo de `vel_target`) con backlog no vacío, la causa es casi siempre Scorer o Critic, nunca Scout. *(Ignora `proj`: es INFO volátil, no un trigger.)*

## Consumo por rol — elegir con costo en mente

| Rol           | Consumo por tarea      | Notas                                                                                                  |
|---------------|--------------------------|--------------------------------------------------------------------------------------------------------|
| **Scout**     | bajo-medio, largo+acumulativo | scraping + filtrado en múltiples fuentes; 2 scouts a ritmo completo pueden saturar por sí solos     |
| **Analyst**   | medio, ráfagas cortas    | 1 tarea = leer 1 JD + escribir evaluación. Se refresca ~cada 2 min cuando hay cola                    |
| **Scorer**    | bajo, ráfagas cortas     | puntuación de coincidencia sobre perfil, casi determinístico. El rol más barato.                       |
| **Writer**    | **ALTO**                 | bucle interno con Critic 3-4 rondas, cada ronda escribe un CV/carta completo. Un Writer activo puede superar a todos los demás combinados. |
| **Critic**    | medio                    | se activa solo por llamada del Writer; el costo se suma al del Writer.                                  |
| **Assistant** | bajo, bajo demanda       | habla con el usuario; no está en el pipeline de datos.                                                  |

**Corolario**: el costo marginal del 2.º Writer es mucho mayor que el del 2.º Scout. Escalar de arriba a abajo (`más trabajo → más de todo`) se excede.

## Cuello de botella → acción (cualitativo, respaldo cuando las estadísticas son ambiguas)

| Estado del pipeline                                     | Cuello de botella               | Acción                                                                                       |
|---------------------------------------------------------|---------------------------------|----------------------------------------------------------------------------------------------|
| `0 new, 0 checked, 0 scored` (vacío)                   | cabeza: sin material            | arrancar **solo Scouts**, incluso 2 en paralelo. Sin Analyst/Scorer/Writer (sin input).      |
| muchos `new`, pocos `checked`                           | Analyst subdimensionado         | generar `analista 2`. **No** añadir Scouts (ya hay material; ralentizarlos si es necesario). |
| muchos `checked`, pocos `scored`                        | Scorer lento                    | generar `scorer 1` si falta; si ya está activo + cola `checked` > 20 por ≥2 ticks → generar `scorer 2` |
| muchos `scored ≥ 50`                                    | necesita capacidad de escritura | Writer. Precaución: 1 Writer activo + Critic puede saturar el presupuesto solo. Generar 1, observar 2-3 ticks, luego decidir. |
| Writers saturados, cola `score ≥ 50` no se drena        | límite de capacidad del plan    | NO generar Writers extra — riesgo de `RALLENTA` instantáneo. Ralentizar Scouts en su lugar para dejar de alimentar la cola. |
| cola baja `scored` PERO muchos `writing` en progreso    | Writers ocupados y produciendo  | no hacer nada. Esperar `writing → ready`.                                                    |

**Principio rector**: encender agentes **upstream** cuando falta input, **downstream** cuando falta output. Nunca "en todos los niveles" sin pensar.

## Puertas de escalamiento (reglas de pacing)

- **1 spawn por tick del Sentinel (~5 min).** Spawn → kick-off → esperar siguiente `[BRIDGE TICK]` → siguiente decisión. Nunca 5 seguidos.
- **Máximo por rol**: 2 Scout, 2 Analyst, **2 Scorer**, 3 Writer, 1 Critic (el Critic es generado por el Writer, tú no lo tocas).
- **Verificación pre-spawn**: `tmux has-session -t <SESSION> 2>/dev/null && echo ATTIVO` — nunca generar a ciegas sobre una sesión existente.
- **Orden de arranque**: Scouts + Analyst *primero*, Scorer + Writers *después*. Nunca en paralelo.

## Checklist pre-spawn (ejecutar mentalmente antes de cada spawn)

1. `db_query.py stats` — ¿dónde está el backlog?
2. `db_query.py dashboard` — ¿cuántas instancias por rol ya vivas?
3. El rol que estás a punto de generar — ¿disuelve el cuello de botella **real**, o estás "completando el equipo"? Si es lo segundo: **no generar** (presupuesto sin usar es mejor que excederse).

## Triage de sesiones preexistentes

Antes de cualquier `start-agent.sh`, lista lo que ya existe:

```bash
tmux list-sessions 2>/dev/null | awk -F: '{print $1}'
tmux capture-pane -t <SESSION> -p -S -40 2>/dev/null | tail -20
```

| Estado en capture-pane                                                       | Acción                                          |
|------------------------------------------------------------------------------|-------------------------------------------------|
| 🟢 CLI activo, contexto < 40%, bucle reciente                                | mantener, no regenerar                          |
| 🟡 CLI activo, contexto > 80% o inactivo > 10 min                           | juzgar: trabajo valioso → dejar; bucle confuso → kill + regenerar |
| 🔴 `command not found` / shell desnudo / panel vacío > 5 min                 | `tmux kill-session` + regenerar (usar `spawn-agent`) |

Para diagnóstico más profundo de vivacidad (procedimientos zombie, síntomas de muerte de CLI), ese es el trabajo del **Dottore** vía la skill `liveness-check` — no lo dupliques aquí.

## Ver también

- `spawn-agent` — lanzamiento real + kick-off después de la decisión de rol.
- `sentinel-orders` — qué disparó este triage (`SCALA UP`, `PIPELINE VUOTA + UNDERSHOOT`).
- `bridge-pacing` — cuando MARGINE significa "generar uno más en el cuello de botella".
- `liveness-check` (Dottore) — diagnóstico más profundo de salud de agentes.
- `agents/_team/architettura.md` — diagrama completo del pipeline y notas de coordinación por fase.
