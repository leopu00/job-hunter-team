<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: throttle
description: Pausa tu loop durante N segundos de forma rastreada. Usa SIEMPRE esto en lugar de `sleep` cada vez que quieras reducir la frecuencia de iteración para respetar el presupuesto de rate del equipo. La duración se lee de $JHT_HOME/config/throttle.json (el Capitán calibra los valores por agente allí); pasa --agent <tu-nombre> y la skill resuelve el resto. Usa un patrón de hijo separado que sobrevive a cualquier timeout de tool-call del proveedor (Kimi 60s, Codex 30s, Claude 120s/600s). Siempre combina con `jht-throttle-check` antes de cada tarea para recuperarse si un padre es terminado prematuramente. Registra cada pausa en $JHT_HOME/logs/throttle-events.jsonl. `sleep` para pausas de throttle está PROHIBIDO.
allowed-tools: Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle.py *), Bash(python3 /app/shared/skills/throttle-config.py *)
---

# throttle — pausa rastreada

Wrapper de shell en `/app/agents/_tools/jht-throttle`. Llama a
`/app/shared/skills/throttle.py` internamente.

## Por qué existe

Hasta ahora cada agente ponía `sleep N` en su loop "cuando le parecía correcto".
Funciona, pero el equipo no tiene observabilidad sobre ello: el Capitán no puede
ver *quién* está pausando, *durante cuánto tiempo*, *con qué frecuencia*. Con esta skill cada
pausa se añade a `$JHT_HOME/logs/throttle-events.jsonl` con el
nombre del agente, los segundos solicitados, los segundos aplicados y un motivo opcional.

El dashboard en `/team` lee este archivo y muestra un gráfico de throttle
por agente, para que podamos *ver* el ritmo del equipo y ajustarlo con el tiempo.

## Cómo funciona la calibración (lee esto con atención)

El Capitán calibra **la duración** para cada agente en
`$JHT_HOME/config/throttle.json` mediante:

```bash
python3 /app/shared/skills/throttle-config.py set <agent> <seconds>
```

Tú (el agente operativo) NO necesitas conocer el valor actual.
Simplemente llama:

```bash
jht-throttle --agent <tu-nombre> [--reason "..."]
```

y la skill lee la configuración, duerme esos segundos, registra el
evento y retorna. Si el Capitán te ha configurado a 0 (o no estás en
la configuración), la skill retorna inmediatamente como no-op — sin log, sin
sleep, tu loop corre a máxima velocidad.

Esto significa:

- El Capitán cambia la calibración con **una sola escritura en la config**, sin
  orquestación tmux. Tu próxima llamada recoge el nuevo valor.
- Nunca almacenas el valor de throttle en tu propia memoria; no
  hardcodeas `jht-throttle 60` en tu loop. El Capitán es dueño del valor.
- El Capitán también puede decirte que llames a la skill **con más o menos
  frecuencia** en tu loop (ej. "throttle cada tarea" vs "throttle
  cada 3 tareas") — ese es un eje separado que controlas tú.

## Uso

```bash
# Recomendado (lee la config):
jht-throttle --agent <tu-nombre> [--reason "..."]

# Override explícito (salta la config; solo cuando el Capitán
# te lo indica con un número específico):
jht-throttle <seconds> --agent <tu-nombre> [--reason "..."]
```

## Cómo funciona internamente (patrón separado)

`jht-throttle` usa un patrón de **hijo separado** que sobrevive a cualquier
timeout de tool-call del proveedor (Kimi 60s, Codex 30s, Claude 120s/600s):

1. Lee la config para obtener la duración.
2. Escribe un archivo de estado `$JHT_HOME/state/throttle-<agent>.json` con
   `until = NOW + duration` (usado por `jht-throttle-check` y
   `jht-throttle-wait`).
3. Bifurca un subproceso `python3 throttle.py` como hijo de init
   (PPID 1) — fuera del árbol de subprocesos de la tool-call. Este hijo escribe
   el evento `start`, duerme, y escribe el evento `end` independientemente
   de lo que le pase a la tool-call que lo invocó.
4. El padre (el bash que estás llamando) se bloquea durante toda la duración
   en fragmentos de sleep de 15 segundos. El sleep fragmentado es más corto que cualquier
   timeout de tool-call por defecto del proveedor, así que incluso en Kimi 60s por defecto
   el padre sobrevive. **El agente permanece bloqueado todo el tiempo.**
5. Si el proveedor MATA al padre (ej. no pasaste suficiente
   timeout en tu tool call): el hijo separado sigue ejecutándose y
   escribe `end` correctamente → ningún huérfano en el log. Pero el agente (tú)
   ahora está libre y podría erróneamente iniciar la siguiente tarea. Para prevenir
   eso, ve el **patrón de gate** más abajo.

## Patrón de gate: comprueba SIEMPRE antes de la siguiente tarea

Después de cada `jht-throttle` (y especialmente en iteraciones normales del loop),
**antes de iniciar una nueva tarea**, ejecuta:

```bash
jht-throttle-check <tu-nombre>
# exit 0 → ok, inicia la siguiente tarea
# exit 1 → "STILL_THROTTLED remaining=Xs" en stderr, debes esperar
```

Si `jht-throttle-check` sale con 1, llama inmediatamente:

```bash
jht-throttle-wait <tu-nombre>
# Se bloquea (en fragmentos de 15s) hasta que until pase, luego sale.
```

Este es el camino de recuperación: un `jht-throttle` anterior cuyo padre fue
terminado prematuramente por el timeout del proveedor. El hijo separado
todavía está durmiendo, el archivo de estado sigue siendo válido, el check te dice
"no empieces una tarea todavía". El wait te re-bloquea de forma segura.

El loop seguro completo en tu role prompt:

```
loop:
    jht-throttle-check <me>          # gate
    if exit 1:
        jht-throttle-wait <me>       # re-bloquear
    do_task()
    jht-throttle --agent <me>        # el padre bloquea + hijo separado
```

## Reglas

- **NUNCA** uses `sleep N` para pausas de throttle. Usa `jht-throttle` en su lugar.
  El `sleep` simple solo está permitido para esperas muy cortas entre reintentos
  (≤ 5 s) donde el logging sería ruido.
- **DEBE ejecutarse en FOREGROUND, bloqueante.** `jht-throttle` es la pausa de
  tu loop — su propósito es impedirte hacer cualquier otra cosa
  hasta que retorne. Ejecútalo mediante tu herramienta de shell bloqueante normal (`Shell`
  / `Bash`), espera a que salga, y solo entonces emite la siguiente tool
  call. **NO** lo envuelvas en un `Task`/`TaskOutput`/`bash &`
  / `nohup` / `disown` en background y sigas trabajando en paralelo — el padre
  se bloquea por ti a propósito. (El *hijo* separado se ejecuta en
  background; eso es un detalle de implementación interno del
  wrapper, no algo que hagas tú.)
- **Comprueba SIEMPRE antes de la siguiente tarea.** Si tu tool call retornó antes
  de los segundos de la config (timeout del proveedor), llama a `jht-throttle-check`
  primero. No adivines.
- Siempre pasa `--agent <tu-nombre>` (ej. `scout-1`, `capitano`,
  `analista-2`) — es la clave por la que el dashboard agrupa Y la clave que el
  Capitán escribe en la config.
- `--reason` es opcional pero útil: una etiqueta corta como
  `"post-batch"`, `"cooldown after URG"`, `"waiting for analyst"`
  ayuda después al releer los eventos.

## Ejemplos

```bash
# Gate pre-tarea (siempre antes de iniciar una tarea)
jht-throttle-check scout-1 || jht-throttle-wait scout-1

# Scout: pausa entre lotes, duración configurada por el Capitán en la config.
jht-throttle --agent scout-1 --reason "post-batch cooldown"

# Capitán: override explícito (raro, solo para emergencias)
jht-throttle 60 --agent capitano --reason "between cycles"

# Escritor: pausa mientras espera al Crítico, dirigida por la config
jht-throttle --agent scrittore-1 --reason "waiting critic review"
```

## Códigos de salida

- `0` — pausa realizada y registrada, O la config devolvió 0 (camino rápido no-op)
- `1` — argumentos faltantes o no válidos

## Nota del Capitán

Para ralentizar un agente, **edita la config**, no envíes un número por
tmux:

```bash
# Agente individual
python3 /app/shared/skills/throttle-config.py set scout-1 60

# Multi-agente en una sola escritura atómica
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=60 scrittore-1=120 analista-1=0

# Mostrar el estado actual
python3 /app/shared/skills/throttle-config.py dump
```

Usa tmux solo para decirles a los agentes que llamen a la skill **con más o menos frecuencia**
en su loop, no para dictar la duración.
