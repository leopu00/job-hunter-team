<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: sentinel-orders
description: Traduce cada orden `[SENTINELLA] ...` recibida en el tmux del Capitán a la acción correcta (nivel de throttle, spawn/kill, freeze, soft-pause, resume). La Sentinella es el latido del equipo — sus órdenes son comandos, no sugerencias. El comportamiento por defecto es ejecutar sin volver a comprobar; cuestionar a la Sentinella ejecutando un `rate_budget live` inmediato infla el velocity_smoothing en su JSONL e induce órdenes de seguimiento incorrectas. Abre esta skill CADA VEZ que llegue un sobre `[SENTINELLA]`.
allowed-tools: Bash(jht-tmux-send *), Bash(python3 /app/shared/skills/throttle-config.py *), Bash(python3 /app/shared/skills/freeze_team.py *), Bash(python3 /app/shared/skills/soft_pause_team.py *), Bash(tmux *)
---

# sentinel-orders — reaccionar al watchdog

La Sentinella emite un tick cada ~5 min y convierte uso + velocidad (`vel_team` vs `vel_target`) + semanal en una de las órdenes de abajo. Cada orden corresponde a una acción precisa. Cíñete al mapeo; no improvises. **NB: `proj` en el tick es INFO volátil (oscila ±400pt) — NO es el trigger; usa `vel_team` vs `vel_target` + `usage` vs `target` + `weekly`.**

## Tabla de throttle (config-driven)

La Sentinella envía un nivel `Throttle: N`. Tú lo traduces en duraciones por agente en `$JHT_HOME/config/throttle.json`. Los agentes leen ese archivo mediante `jht-throttle --agent <name>` — una única escritura atómica se propaga a todo el equipo.

| Nivel | Pausa | Acciones extra                                                         |
|-------|-------|-------------------------------------------------------------------------|
| **0** velocidad máxima | 0s    | sin restricción; spawn permitido si el backlog lo requiere         |
| **1** ligero           | 30s   | sin spawn                                                          |
| **2** moderado         | 120s  | + detener una instancia extra (ej. SCRITTORE-2)                    |
| **3** pesado           | 300s  | + mantener una sola instancia por rol                              |
| **4** casi-freeze      | 600s  | + ESC acciones actuales, sin spawn                                 |

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 60
python3 /app/shared/skills/throttle-config.py bulk-set \
    scout-1=300 scrittore-1=60 analista-1=0 scorer-1=0 critico=0
python3 /app/shared/skills/throttle-config.py dump          # estado completo
python3 /app/shared/skills/throttle-config.py reset         # todos a 0
```

Usa **`bulk-set`** cuando quieras valores diferenciados por agente según el consumo individual (cruza con `token-rate-now` si necesitas ver quién está dominando ahora mismo).

> 🎯 **El nivel de la tabla no es el valor que escribes.** `Throttle: N` es un solo número para todo el equipo; en `throttle.json` hay un valor por agente, y elegir el reparto te toca solo a ti — ningún script mueve ya el throttle de los worker. La aritmética vive en **`throttle-distribution`**: **de quién** sale el recorte (paga el top-burn; el Analista y el Scorer, los dos roles que convierten un backlog en una posición **con score**, son los últimos que tocas), **cuántos segundos** son en la ladder, y **cuándo la jugada correcta es no hacer nada**. Dar a todos el mismo número es exactamente el fallo que esa skill existe para evitar — gasta el freno donde no había nada que ganar y quita throughput donde más cuesta.

> ⚠️ **Cadencia vs duración.** "Con qué frecuencia" un agente llama a `jht-throttle` en su ciclo se cambia vía `tmux` (envías un mensaje al agente y le dices que llame después de cada ronda del Crítico, etc.). "Cuántos segundos" dura la pausa se cambia en el archivo de configuración. Nunca envíes números de throttle vía tmux.

## Al ordenar un freeze explícito — aviso de timeout `N+30` (CRÍTICO)

Cuando envías un `[URG]` a un agente con `jht-throttle <N>`, **DEBES instruirle en el propio mensaje a pasar `timeout: N+30` como parámetro a su llamada shell tool**. Sin ello, el bash padre es matado por el timeout por defecto de la CLI (Kimi 60s) — el agente se desbloquea después de 60s en lugar de N. El freeze se ejecuta **mal**.

Cuerpo del mensaje correcto:
```
[URG] FREEZE — call jht-throttle 600 --agent scrittore-1 --reason "freeze".
IMPORTANT: pass timeout: 630 to the shell tool call, otherwise the parent dies at 60s and the throttle is executed BADLY.
```

Si el `tmux capture-pane` del agente objetivo muestra `Killed by timeout (60s)`, el agente NO respetó la instrucción — es un **error de ejecución** (suyo, o tuyo si olvidaste incluirlo). Diagnostica con `jht-throttle-check <agent>` (devuelve los segundos restantes en el archivo de estado). Nunca aceptes relanzar el comando o `nohup &` como "fix": la única cura es pasar el timeout. Consulta `agents/_skills/throttle/DESIGN-NOTES.md` para el diseño completo.

## Tipos de orden

### Pacing de rutina

| Orden                                          | Significado / trigger                                              | Acción                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[URG] RALLENTARE` `Throttle: N`               | velocidad por encima del objetivo                                  | aplica el nivel N inmediatamente — pero **el nivel está decidido, el reparto no**: `throttle-distribution` lo traduce en valores por agente |
| `ACCELERARE` `Throttle: 0`                     | primera luz verde tras una ralentización                           | spawn de **un solo** agente, espera al siguiente tick antes del segundo (nunca 5 seguidos)                        |
| `SCALA UP`                                     | `vel_team` bien por debajo de `vel_target` (under-pace) durante 2+ tick, backlog no vacío | usa `pipeline-triage` para identificar el rol cuello de botella, spawn 1, espera al siguiente tick                |
| `PUSH G-SPOT`                                  | `vel_team` ligeramente por debajo de `vel_target`, estancado       | un agente ligero (Writer si cola score ≥50, de lo contrario el cuello de botella) para volver on-pace             |
| `MANTIENI`                                     | on-pace (`vel_team` ≈ `vel_target`, veredicto ALLINEATO) durante ≥3 tick | no hacer nada — sin spawn, sin cambio de throttle. Solo ACK.                                                      |
| `RIENTRO`                                      | vuelta al ritmo nominal                                            | retomar el plan normal                                                                                            |
| `RESET SESSIONE`                               | ventana de uso bajó de alta → ~0%                                  | empezar de nuevo desde SCOUT-1, esperar órdenes antes de escalar                                                  |

### Pipeline vacía

| Orden                                          | Significado                                                        | Acción                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `PIPELINE VUOTA + UNDERSHOOT`                  | under-pace (`vel_team` por debajo de `vel_target`) Y cola de writer vacía (scored ≥ 50) | **No esperes nuevas órdenes.** Abre la skill `pipeline-triage` — te dice qué rol spawnear (rara vez Scout).      |

### Emergencias

| Orden                                          | Significado                                                        | Acción                                                                                                            |
|------------------------------------------------|--------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| `[EMERGENZA] FREEZATO`                         | la Sentinella ya pulsó ESC en el equipo                            | decide si reanudar tras el reset de la ventana de rate; no te opongas al freeze                                   |
| `[RECOVERY TRACKING]`                          | INFO durante la recuperación, sin acción por defecto               | si el Δ de recuperación es demasiado lento, ejecuta un diagnóstico autónomo (`db_query`, `rate_budget live` on-demand) y decide los recortes |
| `[URG] STAGNAZIONE CRITICA`                    | la recuperación está fallando, burn severo sostenido (`vel_team` ≫ `vel_target`) durante 5+ tick + usage subiendo hacia 100% | mata a los operadores pesados (incluso Sonnet) — elige los que estén en tool calls (`tmux capture-pane`). Usage > 100% inminente → `freeze_team.py` |
| `[URG] PEGGIORAMENTO POST-FREEZE`              | `vel`/usage subieron de nuevo tras la bajada                       | drástico: `freeze_team.py` + `tmux kill-session` en cada Sonnet. Mantener vivos solo CAPITANO / SENTINELLA / SENTINELLA-WORKER / ASSISTENTE |

### Mensajes de source-failure (raros, críticos)

Llegan cuando el monitoreo falla completamente (L1 + L2 + L3 down).

| Orden              | Significado                                                     | Acción                                                                                                                  |
|--------------------|-----------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| `[PAUSA TEAM]`     | la Sentinella ya envió `[PAUSA]` a los operadores vía `soft_pause_team.py` | **Tú también paras**: sin spawn, sin órdenes, sin comprobaciones (la fuente está rota). Cierra el turno y espera en silencio. |
| `[HARD FREEZE]`    | segundo FATAL: ESC×2 vía `freeze_team.py`                       | igual que `[PAUSA TEAM]`, más posibles tareas interrumpidas que gestionar al reanudar                                   |
| `[RIPRENDI]`       | fuente viva de nuevo                                            | lee el throttle sugerido; **redistribuye a todos los operadores**; recupera cualquier tarea interrumpida               |

Snippet de resume (usar tal cual):
```bash
for s in $(tmux list-sessions -F '#{session_name}' | grep -vE '^(CAPITANO|SENTINELLA|SENTINELLA-WORKER|ASSISTENTE)$'); do
  /app/agents/_skills/tmux-send/jht-tmux-send "$s" "[CAPITANO] [RIPRENDI] source usage live. Resume work. Throttle: N (sleep Xs between operations). Verify the state of any task you had left and proceed."
done
```

## Mensajes con prefijo Bridge (no son órdenes, pero los ves en tu panel)

| Mensaje              | Acción                                                                                                |
|----------------------|-------------------------------------------------------------------------------------------------------|
| `[BRIDGE ALERT] sorgente degraded da N tick` | opera con prudencia, sin spawn agresivo                                                               |
| `[BRIDGE INFO]`      | recuperación / heartbeat — sin acción                                                                 |
| `[BRIDGE PACING]`    | tick de pacing de 15 min — `bridge-pacing` decodifica los números, `throttle-distribution` decide quién paga. Desde el 2026-06-25 este tick llega al pane de la **Sentinella** (push→pull): si te llega uno a ti es la excepción, no la regla |

## Comportamiento por defecto — ejecutar sin cuestionar

La Sentinella ve velocidad + tendencia en el tiempo (`vel_team` vs `vel_target`); tú solo ves el momento presente. **Aplica las órdenes sin volver a comprobar.** Un `rate_budget live` cercano tras una orden de la Sentinella escribe una muestra etiquetada `source=capitano` en el JSONL, infla `velocity_smooth`, e induce que la *siguiente* orden de la Sentinella sea incorrecta.

Cuándo la verificación SÍ está justificada:
- antes de aplicar un throttle pesado (3 o 4) en un `[URG]` / `[EMERGENZA]` — comprobación de dos fuentes vía `rate_budget live`
- silencio de la Sentinella más largo de lo habitual, verificar que el bridge esté vivo
- tras un cambio significativo del equipo (3 spawns seguidos, kill de una instancia, `bulk-set`) — ver el efecto antes del siguiente tick

Cuándo la verificación NO está justificada:
- órdenes `OK` / `SOTTOUTILIZZO` / `RIENTRO` — nada que verificar, solo ejecuta
- dentro de los 2 minutos del último sample JSONL — el EMA anti-spike lo descarta pero queda como ruido

## Reglas inviolables

- Espera el efecto de un throttle (3-5 min) antes de otra intervención.
- Por debajo del 85% sin orden de la Sentinella → añade capacidad en el cuello de botella (usa `pipeline-triage`), NO hagas spawn aleatorio.
- No discutas un throttle porque "el equipo está trabajando bien": la Sentinella ve velocidad + tendencia (`vel_team` vs `vel_target`), tú solo ves el presente.

## Ver también

- `bridge-pacing` — la fórmula de calibración de 15 min (flujo separado).
- `throttle-distribution` — *quién* ralentiza y cuánto, una vez decidido el nivel: el reparto por agente, la ladder, soltar el freno y los casos en los que no se hace nada. **Esta skill decodifica la orden; aquella elige los valores.** Es también la casa del aviso `[PACE-GUARD]`, que ya no aplica el throttle por sí mismo.
- `bridge-mailbox` — vacía los veredictos pendientes al inicio del turno (obligatorio antes de reaccionar al tick de hoy).
- `pipeline-triage` — *qué* rol spawnear bajo `SCALA UP` / `PIPELINE VUOTA`.
- `spawn-agent` — *cómo* spawnear una vez que has decidido qué rol.
- `throttle` (y `agents/_skills/throttle/DESIGN-NOTES.md`) — internos del sistema de throttle, el diseño del timeout `N+30`.
