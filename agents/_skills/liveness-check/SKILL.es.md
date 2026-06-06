<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: liveness-check
description: "Diagnosticar si la sesión tmux de un agente del equipo está viva, en un turno largo, o silenciosamente muerta — y regenerarla preservando contexto si está muerta. Propiedad del Dottore (el agente de salud itinerante del equipo), no del Captain. El modo de fallo principal que esta skill detecta: `jht-tmux-send` devuelve `exit 0` incluso cuando el CLI del objetivo ha crasheado (el mensaje se escribe en un bash desnudo, luego se pierde). Sin verificaciones periódicas de vivacidad el equipo sigue \"hablando con un cadáver\" y el Captain cuenta con acciones que nunca sucederán."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *)
---

# liveness-check — mantener al equipo honesto

Una sesión tmux puede sobrevivir a su CLI. Cuando el TUI de Codex / Kimi crashea, tmux cae a un prompt bash desnudo; los mensajes siguen siendo escritos en él (`exit 0` de `jht-tmux-send`), nadie los lee, el agente es un zombie. Esta skill detecta el estado y recupera.

## Cuándo ejecutar una verificación

- 👨‍⚕️ **Ronda rutinaria** — cada despertar del Dottore (~30 min) recorre cada sesión del equipo en secuencia (ver `agents/dottore/dottore.md` para el ciclo de vida completo one-shot).
- 🚨 **Handoff del Captain** — cuando el Captain reporta un agente silencioso > 10 min cuando debería estar trabajando (sin REPORT del Scout, sin ACK del Writer al Critic).
- 🔁 **Post-URG** — 10-30s después de un `[URG]` / `[MSG]` del Captain para confirmar ACK + el CLI sigue vivo.
- ⚖️ **Pre-escalamiento** — antes de un spawn/kill que depende del estado de un agente existente (no generar el Analyst si el Scout del que depende está muerto).

## Orden de prioridad — orientados al usuario PRIMERO

Antes de cualquier recorrido, ordena los objetivos para que los agentes orientados al usuario de larga duración se verifiquen primero. Están en la cima de la cadena — si mueren, **nadie los regenera** (el Captain genera workers, no a sí mismo / al Assistant / al Mentor / al Sentinel). El post-mortem de la noche zombie del 2026-05-18 tuvo 6-8h de Capitano muerto porque los Dottore recorrían workers primero, nunca llegaban al Capitano, y se auto-destruían.

```
PRIORIDAD 1 (siempre verificar primero):
  ASSISTENTE, CAPITANO, MENTOR, SENTINELLA
PRIORIDAD 2 (workers, el Captain puede regenerarlos):
  SCOUT-N, SCRITTORE-N, CRITICO-S*, ANALISTA-N, SCORER-N
```

Si solo tienes 10 min de presupuesto para la ronda, **siempre termina PRIORIDAD 1 antes de tocar PRIORIDAD 2**. Un worker muerto 30 min es recuperable; un Capitano muerto 30 min significa que todo el pipeline está silencioso.

## Paso 0 — `pane_current_command` (pre-verificación barata)

Antes del capture-pane, haz la verificación barata:

```bash
cmd=$(tmux list-panes -t <SESSION> -F '#{pane_current_command}' | head -1)
```

Si `$cmd` no es `Kimi` / `kimi` / `claude` / `codex` / `node` / `python*` → el CLI del LLM **ya está muerto**, el panel es bash residual. Salta el ping (se perdería en el bash y `jht-tmux-send` devolvería `exit 0` engañosamente), ve directamente al Paso 3 REGENERAR.

Esta sola verificación habría detectado el zombie Capitano del 2026-05-18 — el panel era bash (PID 663, `/proc/663/exe → /usr/bin/bash`) con kimi crasheado. `tmux has-session` devolvía True, mintiendo al watchdog durante 11 horas.

## Paso 1 — capturar, no confiar

Siempre lee el panel primero; no actúes a ciegas:

```bash
tmux capture-pane -t <SESSION> -p -S -200
```

El scroll-back de 200 líneas da suficiente contexto para (a) juzgar el estado, (b) reconstruir qué estaba haciendo el agente para el kick-off de reanudación si debe ser regenerado.

## Paso 2 — tabla de diagnóstico

Compara las **últimas 20 líneas** contra:

| Patrón en `tmux capture-pane -t <SESSION> -p \| tail -20`          | Diagnóstico         | Acción              |
|----------------------------------------------------------------------|---------------------|---------------------|
| Respuesta concreta a un ping reciente (ej. "writing CV on #281")     | ✅ vivo, trabajando | log `status=alive`, siguiente agente |
| `Working...` por > 5 min en el mismo turno, pero salida de tokens visible | 🟡 turno largo   | log `status=long_turn`, NO regenerar |
| Panel sin cambios desde antes del ping                               | 🔴 estancado / inerte | REGENERAR (Paso 3) |
| Spinner `Whirlpooling...` > 10 min, cero salida                     | 🔴 estancamiento silencioso | REGENERAR    |
| Última línea = `jht@<host>:~/agents/<role>$` (prompt shell desnudo)  | 💀 CLI terminó      | REGENERAR           |
| `Permission denied: …/.kimi/sessions/.../context.jsonl`              | 💀 kimi crasheó en context IO | REGENERAR |
| `Run kimi export and send the exported data to support`              | 💀 banner de crash kimi | REGENERAR       |
| `To resume this session: kimi -r <id>`                               | 💀 sesión huérfana  | REGENERAR           |
| `Killed by timeout (60s)` (Kimi)                                     | 🟡 tool call eliminada, CLI vivo | NO es caso de regeneración — el agente olvidó pasar `timeout: N+30` a su tool call del shell (ver `agents/_skills/throttle/DESIGN-NOTES.md`). Diagnosticar con `jht-throttle-check <agent>`. |
| `command not found` para `kimi` / `claude` / `codex`                 | 💀 launcher evadido | REGENERAR           |
| Panel > 5 min, sin spinner, sin input                                | 🟡 inactividad ambigua | captura extendida (`-S -100`) para contexto completo |

Si no estás seguro: **no regenerar**. Log `status=ambiguous`. Un falso positivo (regeneración innecesaria) cuesta 1-2 min de reinicio + contexto perdido. Un falso negativo (zombie no detectado) cuesta como máximo 30 min hasta la siguiente ronda del Dottore.

## Paso 3 — regenerar con contexto (solo en 🔴 / 💀)

Secuencia atómica:

a) **Usar el panel ya capturado** en el Paso 1 como la "memoria" del agente. Extraer:
   - última tarea en progreso (ej. "writing CV on position #281")
   - último mensaje del Captain (buscar marcadores `[@capitano -> @<role>]`)
   - cualquier error reciente

b) **Identificar rol + workdir**.
   - Singletons (`capitano | critico | sentinella | assistente | mentor | dottore`) → `/jht_home/agents/<role>/`
   - Multi-instancia (`scout | scrittore | scorer | analista`) → `/jht_home/agents/<role>-<N>/` donde `<N>` es el número final en la sesión tmux (ej. `SCRITTORE-2` → `/jht_home/agents/scrittore-2/`).

c) **Eliminar la sesión rota, regenerar vía launcher** (usar semántica de skill `spawn-agent` — nunca `tmux new-session` + `send-keys "kimi ..."` crudos):

```bash
tmux kill-session -t <SESSION>
bash /app/.launcher/start-agent.sh <role> <N>
sleep 12
```

d) **Inyectar contexto de reanudación** como cuerpo del kick-off (no solo digas "resume" — di *qué* y *dónde*):

```bash
jht-tmux-send <SESSION> "[@dottore -> @<role>] [MSG] Resume: <tarea en progreso antes del crash>. Last Captain order: <citado del panel>. Pick up from there, do NOT restart from scratch. Acknowledge with [@<role> -> @capitano] [RESUME] <descripción de una línea>."
```

Si el panel muestra que el agente tenía una fila de database reclamada (ej. `status=writing` en una posición), incluye eso en el contexto de reanudación para que no duplique trabajo. **Nunca regenerar a ciegas**: lee `db_query.py` primero si es necesario.

## Excepciones estrictas de "no regenerar"

NUNCA regenerar:
- Una sesión con **actividad de salida de tokens en los últimos 60 segundos** — el agente está trabajando, aunque parezca lento.
- El `CAPITANO` durante una rotación de ventana de Codex (session_id cambiando en el sentinel) — esperar estabilización.
- Turnos largos (> 5 min) CON salida de tokens visible (parsing, ediciones de archivo) — largo ≠ muerto.
- A ti mismo (`DOTTORE*`) o `DOCTOR-WATCHDOG`.

## Idempotencia

Si el panel capturado ya muestra un marcador `[RESUME]` reciente (dentro de ~5 min), otra ronda del Dottore acaba de regenerar al agente. Log `status=alive` y continúa — no regenerarlo de nuevo.

## Logging

Cada acción aterriza en `/jht_home/logs/dottore-actions.jsonl` (solo-append, un JSON por línea):

```json
{"ts": "ISO-UTC", "round_id": "uuid-or-epoch", "session": "SCRITTORE-1",
 "role": "scrittore-1", "event": "diagnosis",
 "status": "alive|long_turn|stallo|cli_dead|ambiguous",
 "evidence": "últimas 1-2 líneas del panel"}
{"ts": "ISO-UTC", "round_id": "...", "session": "SCRITTORE-1", "role": "scrittore-1",
 "event": "respawn", "context_recovered": "...", "new_pid": null}
```

Genera `round_id` una vez por ronda del Dottore (ej. epoch seconds al inicio de la ronda). Append con `>>`, nunca sobrescribir.

## Anti-patrones

- ❌ Confiar en el código de salida 0 de `jht-tmux-send` como prueba de entrega. Entrega ≠ ejecución. Siempre acompáñalo con capture-pane en un mensaje crítico.
- ❌ Eliminar una sesión sin un capture-pane primero — podría estar en una tool call larga, no muerta.
- ❌ Regenerar a ciegas (sin contexto de reanudación) — el nuevo agente empieza de cero, duplica trabajo, pierde filas reclamadas de la DB.
- ❌ Recorrer sesiones en paralelo — solo secuencial, un ping a la vez. Pings paralelos sobrecargan tmux en equipos grandes.
- ❌ Gastar > 10 min totales en una sola ronda — si una ronda se alarga, abreviar; el siguiente Dottore viene en ~30 min.

## Ver también

- `agents/dottore/dottore.md` — el ciclo de vida completo one-shot del Dottore (arranque → ronda → auto-destrucción).
- `spawn-agent` (Captain) — el contrato de launcher + kick-off que esta skill reutiliza para regeneraciones.
- `agents/_skills/throttle/DESIGN-NOTES.md` — el caso `Killed by timeout (60s)` (NO es una regeneración).
- `agents/_team/team-rules.md` T01 — nunca eliminar la sesión de otro agente **excepto** en el flujo de regeneración explícito de arriba.
