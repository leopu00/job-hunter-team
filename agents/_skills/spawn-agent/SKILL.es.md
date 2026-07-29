<!-- @translation: es, ai-translated 2026-06-13 -->
---
name: spawn-agent
description: "Inicia un agente del equipo JHT (Scout, Analista, Scorer, Scrittore, Critico, Assistente, Capitano-2) a través del launcher, luego envía el mensaje de kick-off que realmente inicia su bucle principal. Solo Capitano — el Capitano es el único propietario del escalado del equipo. USA SIEMPRE esta skill: saltarse `start-agent.sh` con `tmux new-session` + `send-keys \"kimi ...\"` directo produce sesiones donde la CLI nunca arranca (`command not found`), el Capitano ve una sesión \"activa\" que en realidad está muerta, y el equipo rinde por debajo silenciosamente."
allowed-tools: Bash(bash /app/.launcher/start-agent.sh *), Bash(tmux *), Bash(jht-tmux-send *), Bash(sleep *), Bash(jht-throttle-check *)
---

# spawn-agent — poner un agente en línea

Contrato de dos fases: **lanzar** la CLI, luego **kick-off** de su bucle. Saltarse el kick-off deja al agente en un prompt vacío — el Capitano cree que está trabajando, pero no es así.

## Fase 1 — lanzamiento vía `start-agent.sh`

```bash
bash /app/.launcher/start-agent.sh <role> [instance_number]
```

Ejemplos:
```bash
bash /app/.launcher/start-agent.sh scout 2       # SCOUT-2
bash /app/.launcher/start-agent.sh analista 1    # ANALISTA-1
bash /app/.launcher/start-agent.sh critico       # CRITICO (singleton, sin número)
```

**Número de instancia — tira el dado (workers escalables, 2026-06-13).** Para `scout` / `analista` / `scorer` / `scrittore`, **NO** elijas el número de forma secuencial: el trabajo siempre se acumulaba en `-1`/`-2` mientras `-4` apenas hacía nada. Tira primero un número aleatorio libre, luego pásalo:
```bash
N=$(python3 /app/shared/skills/roll_worker_number.py scout) && \
  bash /app/.launcher/start-agent.sh scout "$N"
```
`roll_worker_number.py` tira un **d6 excluyendo los números ya en uso** (sesiones `SCOUT-N` existentes) → nunca una colisión, y la carga de trabajo se reparte entre los números de instancia en lugar de caer siempre en `-1`. Aplica **solo a NUEVOS spawns**; los singletons (Critico / Sentinella / Dottore / Assistente / Mentor) no llevan número, y el session-refresh del Dottore recrea el **mismo** número (no tira el dado).

El launcher ejecuta, atómicamente:
- crea la sesión tmux con el nombre canónico (`SCOUT-2`, `ANALISTA-1`, …)
- establece `cwd` en `$JHT_HOME/agents/<role>[-N]/`
- exporta `JHT_HOME · JHT_DB · JHT_AGENT_DIR · PATH · JHT_USER_DIR · JHT_CONFIG`
- detecta el proveedor activo desde `jht.config.json` (claude / kimi / codex)
- copia `agents/<role>/<role>.md` al workspace como `CLAUDE.md` / `AGENTS.md`
- inicia la CLI con los flags correctos para ese proveedor + nivel
- deriva el **desfase** inicial del escalón de throttle y pre-arma el throttle del nuevo worker

> ⚠️ **NUNCA** inicies con `tmux new-session ... ; tmux send-keys "kimi ..."`. La CLI no está en el `PATH` fuera del entorno del launcher → `command not found` → la sesión es solo bash. El `jht-tmux-send` del Capitano devuelve `exit 0` escribiendo en ese bash vacío, el mensaje se pierde silenciosamente, y el equipo rinde por debajo sin causa visible.

### Desfase — lo deriva el launcher, tú nunca esperas

Dos workers en el mismo escalón de throttle que arrancan juntos *siguen* juntos: cada ciclo suyo cae en el mismo instante, y cada coincidencia es un pico de peticiones simultáneas. La distancia que reparte `N` workers sobre un periodo `T` es `T/N` — en el escalón de 5 minutos tres workers se quieren a **100s** uno de otro, no a 10 minutos. Un offset mayor que `T` es el peor caso (el primer worker ya ha ciclado dos veces antes de que arranque el segundo, así que las fases caen donde caen), y uno exactamente igual a `T` es lockstep permanente.

Esa aritmética la hace el launcher por ti, sobre el periodo real en `config/throttle.json` y sobre los workers que de verdad comparten ese escalón, e imprime lo que decidió:

```
  Stagger:      100s prima del primo ciclo (throttle pre-armato, gradino condiviso)
```

**Tú nunca esperas.** El launcher pre-arma el throttle del worker nuevo, de modo que es el worker quien se detiene *solo* en el gate `jht-throttle-check` que su propio prompt ya le impone en la primera vuelta de su loop. Manda el kick-off enseguida, como siempre.

Lo que se sigue de esto:
- **El primer worker de un escalón no espera nada.** El camino anti-idle queda intacto: lo lanzas y arranca.
- Un worker desfasado se queda en `jht-throttle-wait` sin salida durante 5 minutos como máximo. Es un worker **sano** — antes de leer el silencio justo después de un spawn como un atasco, confirma con `jht-throttle-check <agente>` (`STILL_THROTTLED remaining=Xs`).
- El offset fija solo la fase *inicial*. La duración de las tareas varía lo bastante como para que las fases deriven solas después, así que no hay nada que recalibrar más tarde.
- Un spawn que **no** debe retrasarse — recrear un worker que ya tenía una buena fase — lo desactiva con `JHT_SPAWN_STAGGER=0` en el entorno.

## Fase 2 — kick-off (obligatorio)

El launcher arranca la CLI pero **no envía ningún primer mensaje**. Sin un kick-off el agente espera en un prompt vacío para siempre.

Secuencia estándar:
```bash
bash /app/.launcher/start-agent.sh scout 1
sleep 12   # Arranque CLI 8-15s — nunca menos de 10
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [MSG] <cuerpo del kick-off>"
```

### Cuerpo del kick-off por rol

| Rol         | Cuerpo del kick-off                                                                                          |
|-------------|--------------------------------------------------------------------------------------------------------------|
| `scout`     | "Inicia el bucle principal. Lee tu prompt, el perfil del candidato (`$JHT_HOME/profile/candidate_profile.yml`), y comienza desde el CÍRCULO 1 (preferencia primaria). Notifica a los Analistas después de lotes de 3-5 posiciones." |
| `analista`  | "Inicia el bucle principal. Cola: `db_query.py next-for-analista`. Para cada posición, completa los 5 campos obligatorios y promueve a `checked` o `excluded`." |
| `scorer`    | "Inicia el bucle principal. Cola: `db_query.py next-for-scorer`. PRE-CHECK primero, luego puntuación 0-100. Umbrales: <40 excluido, 40-49 aparcado, ≥50 notificar Scrittori." |
| `scrittore` | "Inicia el bucle principal. Cola: `db_query.py next-for-scrittore`. Máximo esfuerzo, 3 rondas obligatorias con el Critico. El PDF va bajo `$JHT_USER_DIR/cv/`." |
| `critico`   | "Serás llamado por tu Scrittore padre con PDF + JD. Una revisión ciega por llamada, luego para." |
| `assistente`| "Inicia el bucle principal. Espera `[@utente -> @assistente] [CHAT]` desde la web UI." |

Si el contexto posición-currículum no es trivial (el agente tenía trabajo en curso antes de un crash), añádelo al kick-off para que retome donde lo dejó — nunca digas solo "retoma", di *qué* y *dónde*:

```bash
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [MSG] Retomar: posición #281 (Qargo TMS), la ronda 2 con el Critico estaba a punto de empezar. Continúa desde ahí, NO reinicies desde cero."
```

## Fase 3 — verificar que el arranque fue exitoso

Aproximadamente 5 segundos después del kick-off:
```bash
tmux capture-pane -t <SESSION> -p | tail -10
```

Lee la salida:
- ✅ Banner CLI + spinner + cuerpo del kick-off visible en el área de entrada → arranque OK
- 🟡 `context: 0.0%` y un área de entrada vacía → el kick-off no llegó, reintenta una vez
- 🔴 Prompt de shell `jht@host:~/agents/<role>$` (sin CLI) → fallo del launcher, ver fallback abajo

> Nota: las comprobaciones de salud periódicas (detección de zombis, agentes silenciosos > 10 min) NO son responsabilidad de esta skill — pertenecen al **Dottore** a través de la skill `liveness-check`. Esta skill termina una vez que la Fase 3 confirma el arranque.

## Fallback — fallo del launcher

Si la Fase 3 muestra un prompt de shell puro (sin CLI iniciada), comprueba primero:

```bash
tmux capture-pane -t <SESSION> -p -S -50 | grep -iE "command not found|permission denied|no such file"
```

Causas probables:
1. CLI del proveedor no en el `PATH` del entorno del launcher → verifica que el proveedor en `jht.config.json` coincida con la CLI instalada
2. La plantilla del rol `agents/<role>/<role>.md` falta → el launcher copia un archivo vacío → la CLI arranca pero no tiene instrucciones
3. `$JHT_HOME` no establecido / no exportado en el padre → escalar al usuario, NO intentes establecerlo manualmente

Cierra la sesión rota antes de reintentar:
```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
```

## Anti-patrones

- ❌ Iniciar múltiples agentes en un bucle cerrado sin pacing — las reglas de escalado están en `pipeline-triage` (un spawn cada vez, re-midiendo en medio). Lo que nunca debes hacer es *inventar un número fijo de minutos* entre un worker y el siguiente: la distancia viene del escalón (`T/N`) y la aplica el launcher por ti.
- ❌ Re-iniciar a ciegas después de un crash sin leer `db_query.py` para recuperar el estado del último task — el nuevo agente empieza desde cero y duplica trabajo.
- ❌ Usar esta skill para "reiniciar" un agente que funciona porque parece lento. Lento ≠ muerto. Turnos largos con salida de tokens visible no son un caso de spawn — son un caso de `liveness-check` (Dottore).
- ❌ Spawnear un reemplazo porque `jht-tmux-send` falló al entregar. **`exit 4` = la TUI destino está mid-turn (`Working … esc to interrupt`) → el agente está VIVO, solo ocupado.** El mensaje NO se entregó síncronamente: reintenta el envío más tarde, nunca spawnees un clon. Solo `exit 3` (el texto nunca apareció Y el pane no está ocupado → shell pelado / modal atascado) es una posible señal de muerte, e incluso entonces el veredicto pertenece al **Dottore** (`liveness-check`), no a un spawn por reflejo. Spawnear sobre un agente ocupado es exactamente el bug de overspawn del 2026-06-07 (`docs/internal/postmortems/2026-06-11-overspawn-rootcause.md`): el clon toma el control mientras el original sigue quemando presupuesto como un zombie.
- ❌ Iniciar un Critico. El Scrittore inicia su propio `CRITICO-S<N>` autónomamente — el Capitano nunca toca al Critico directamente.

## Ver también

- `liveness-check` (Dottore) — cuando un agente existente parece muerto.
- `pipeline-triage` (Capitano) — *qué* rol iniciar según el backlog.
- `tmux-send` — convenciones del sobre de mensajes.
- `agents/_team/team-rules.md` T01 — nunca cerrar la sesión de otro agente.
