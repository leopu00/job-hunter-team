<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: tmux-send
description: Entrega un mensaje a la sesion tmux de otro agente de forma atomica. USA SIEMPRE este skill para comunicarte con SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO. NUNCA llames a `tmux send-keys` manualmente — las TUI basadas en Ink (Codex, Kimi) pierden el caracter Enter.
allowed-tools: Bash(jht-tmux-send *)
---

# tmux-send — mensajeria inter-agente

Wrapper de shell ubicado en `/app/agents/_skills/tmux-send/jht-tmux-send` (tambien en el `PATH` mediante symlink en `/usr/local/bin`, creado durante la build de la imagen).

## Por que existe

Las TUI basadas en Ink (Codex, Kimi Code) **pierden el Enter** si llega en la misma llamada `tmux send-keys` junto con el cuerpo del mensaje. El texto se envia caracter por caracter; Ink debe terminar el renderizado antes de aceptar otra pulsacion de tecla. Si llamas a `tmux send-keys "msg" Enter`, el mensaje permanece en el buffer de entrada del peer sin enviarse → deadlock silencioso entre agentes.

El wrapper lo gestiona atomicamente: `text → sleep 0.3 → Enter → sleep 0.5 → Enter` (el segundo Enter es idempotente para mayor robustez).

## Uso

```bash
jht-tmux-send <SESSION> "<message>"
```

## Ejemplos (V5)

```bash
# Captain → Scout (INFO, mensaje operativo generico)
jht-tmux-send SCOUT-1 "[@capitano -> @scout-1] [INFO] Start the main loop. Begin from CIRCLE 1 (Remote EU); ping after each batch of 3-5 positions."

# Captain → Writer (URG, orden en tiempo real)
jht-tmux-send SCRITTORE-1 "[@capitano -> @scrittore-1] [URG] FREEZE — finish the current Critic round, then sleep until throttle returns to T0/T1."

# Analyst → Scout (FEEDBACK, coaching sobre patrones de rechazo)
jht-tmux-send SCOUT-2 "[@analista-1 -> @scout-2] [FEEDBACK] [SENIORITY] 4 of last 5 inserts from greenhouse.io require senior+ — switch source or query for the next batch."

# Sentinel → Captain (URG, cambio de estado)
jht-tmux-send CAPITANO "[@sentinella -> @capitano] [URG] Usage 94%, projection 102% — recommend throttle T2 + freeze Writers."

# Writer → Captain (REPORT, resultado final)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [REPORT] Position 42 — verdict PASS, score 7.5/10. PDF: /jht_user/.../CV.pdf"

# Worker → Captain (ACK, confirmacion de URG)
jht-tmux-send CAPITANO "[@scrittore-1 -> @capitano] [ACK] freeze applied, sleeping."
```

## Sobre del mensaje

Mantén siempre el prefijo estructurado:

```
[@<from> -> @<to>] [<TYPE>] <text>
```

Tipos estandar (consulta `agents/_manual/communication-rules.md` para la taxonomia completa y las expectativas por rol):

- `BLOCKED` — worker → Capitano: has **DEJADO de producir** y no deja rastro en la DB (herramienta rota, `403`/`LOCKED`, fuentes secas, un elemento que no puedes procesar ni saltar). Desde el 2026-07-27 es lo ÚNICO que distingue un stall del trabajo silencioso
- `URG` — orden en tiempo real que requiere accion inmediata (FREEZE, throttle, kill)
- `FEEDBACK` — coaching hacia el agente anterior con una etiqueta de rechazo (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`)
- `REQ` / `RES` — solicitud/respuesta sincrona entre agentes
- `ACK` — acuse de recibo de un `URG` o `REQ` que aun no puedes atender
- ~~`INFO` / `REPORT`~~ — **retirados para el tráfico entre pares** (2026-07-27): eran 8 de los 30 mensajes de puro estado que despertaban al Capitano en ~1,5h. El avance se tira de `db_query.py recent-activity`, no se narra

> 💬 `[CHAT]` esta reservado para mensajes **usuario → agente** desde la web UI (consulta el protocolo en el prompt del Capitan). No lo uses para trafico inter-agente.

## Codigos de salida

- `0` — mensaje entregado
- `1` — argumentos faltantes
- `2` — la sesion de destino no existe (verifica el nombre con `tmux ls`)

## Reglas

- **NUNCA** uses `tmux send-keys` directamente para comunicarte con otro agente. Pasa siempre por `jht-tmux-send`.
- **NUNCA** termines la sesion tmux de otro agente (regla #0 del Capitan).
- Si `tmux ls` muestra que la sesion de destino no existe, **no la crees** — pregunta al Capitan (o usa `start-agent.sh` si *eres* el Capitan).
- Por defecto usa la **coordinacion via DB** para los traspasos de pipeline (Scout→Analyst→Scorer→Writer); usa este skill solo para las senales en tiempo real listadas arriba. Consulta `agents/_manual/communication-rules.md`.
