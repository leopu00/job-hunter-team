---
name: tmux-send
description: Entrega un mensaje a la sesion tmux de otro agente de forma atomica. USA SIEMPRE este skill para comunicarte con SCOUT/ANALISTA/SCORER/SCRITTORE/CRITICO/SENTINELLA/CAPITANO. NUNCA llames a `tmux send-keys` manualmente — las TUI basadas en Ink (Codex, Kimi) pierden el caracter Enter.
allowed-tools: Bash(jht-tmux-send *)
---
<!-- @translation: es, ai-translated 2026-06-06 -->

# tmux-send — mensajeria inter-agente

Wrapper de shell ubicado en `/app/agents/_skills/tmux-send/jht-tmux-send` (tambien en el `PATH` mediante symlink en `/usr/local/bin`, creado durante la build de la imagen).

## Por que existe

Las TUI basadas en Ink (Codex, Kimi Code) **pierden el Enter** si llega en la misma llamada `tmux send-keys` junto con el cuerpo del mensaje. El texto se envia caracter por caracter; Ink debe terminar el renderizado antes de aceptar otra pulsacion de tecla. Si llamas a `tmux send-keys "msg" Enter`, el mensaje permanece en el buffer de entrada del peer sin enviarse → deadlock silencioso entre agentes.

El wrapper lo gestiona atomicamente: escribe el texto, **relee el panel para confirmar que aparecio**, envia Enter, y **relee el panel de nuevo para confirmar que el turno realmente arranco**. La entrega no es "haber escrito": es "haber visto arrancar el turno".

> ⚠️ Existe un segundo estado, mas insidioso: la TUI **acepta el texto e ignora el Enter**, dejando la linea colgada en el composer mientras el agente permanece parado durante horas. Visto 4 veces en 3 dias en una sola VPS, incluido el Capitan, cuando un mensaje llega mientras el peer esta cerrando un turno largo. Ahora el wrapper reintenta el Enter y, si el turno sigue sin arrancar, devuelve **`5`** en vez de declarar falsamente exito.

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

- `0` — mensaje entregado **y enviado** (verificado: el turno arranco)
  - Si el destinatario usa el buzón (`mail_receivers`), `0` significa **en cola**: el mensaje es un archivo duradero y el terminal solo recibió un aviso corto. Si el agente lo *tomó* lo dice `jht-mail status <agente> <id>`; un mensaje que nadie toma a tiempo se comunica al remitente. Una vez en cola, la salida es `0` pase lo que pase con el aviso, salvo `3` (un terminal que no responde); una sesión que desaparece tras encolar ya no responde `2`, el mensaje espera en el buzón. El aviso se escribe solo cuando el terminal espera en su prompt; si no, queda retenido (la salida sigue siendo `0`) y el watchdog lo repite.
- `1` — argumentos faltantes
- `2` — la sesion de destino no existe (verifica el nombre con `tmux ls`)
- `3` — el texto nunca aparecio y el panel no esta ocupado → TUI no receptiva. **El unico codigo que sugiere muerta/bloqueada.**
- `4` — peer ocupado en un turno largo mas alla del presupuesto de espera → **vivo**. Reintenta mas tarde, nunca respawnear.
- `5` — texto aceptado pero nunca enviado ("vivo pero mudo") → **vivo**. Reintenta mas tarde, nunca respawnear.
- `7` — el texto salio del composer pero nada prueba que la CLI lo tomara: **no se sabe**. Mira el panel antes de volver a escribir; nunca respawnear.
- `8` — otra entrega a la misma sesion seguia en curso: no se escribio nada. Reintenta.
- `130` — el composer no esta libre y el mensaje **NO esta entregado**. Lo que hay no es demostrablemente nuestro (un borrador de una persona, o un marcador de pegado que nadie nuestro explica): no se pego ni se pulso nada, y tu mensaje esta escrito en `logs/pending-input.jsonl` (`unsent`). No repitas en bucle: avisa al Capitan (`[BLOCKED]`). El mismo codigo **despues** del pegado significa que el composer ya no es solo nuestro texto: sin Enter, y el texto queda anotado alli (`draft`). El panel esta vivo: nunca respawnear. El texto alli se corta a 64 KiB.
- Un texto DEMOSTRABLEMENTE nuestro (dejado por una entrega nuestra anterior: identico, o su marcador de pegado, `[Pasted Content N chars]` en Codex / `[Pasted text #1 +N lines]` en Claude, con nuestro numero) recibe su Enter en la siguiente entrega, sea cual sea su edad. `jht-tmux-send --flush-ours <SESION>` hace solo eso (0 = libre o tomado, 130 = no nuestro, 5 = Enter tragado).
- Una caja que contiene SOLO texto firmado (uno o varios mensajes sin enviar, de quien sea: un sobre `[@x -> @y]`, las palabras de la persona entre las marcas `⟦UTENTE·id⟧ … ⟦/UTENTE·id⟧`, o un marcador de pegado que el registro de arriba explica: el de Codex de cualquier edad, el de Claude dentro de `JHT_TMUX_TOKEN_WINDOW` segundos, 600) es un mensaje que espera su Enter, no una persona escribiendo: tu mensaje se pega detras y un solo Enter se lleva los dos; el agente puede recibir el viejo con retraso. Un texto escrito a mano, una marca sin cerrar o un marcador que nadie explica siguen como antes (130). Cualquiera puede escribir a mano un sobre valido: no es una autenticacion, y el coste es el mismo que el de un mensaje viejo que llega tarde. Un sobre SIN marcas (un mensaje entre agentes) no tiene un final propio y una persona podria seguir escribiendo en su cola: cuenta como firmado solo si el registro del transporte tiene la huella de ese texto exacto (lo que pego el mismo y nunca vio tomado); si no, es texto de la persona (130).

> Solo `3` puede llevar a un liveness-check y a un respawn. `4` y `5` significan ambos que el peer esta vivo: tratarlos como muerte es exactamente como empiezan los over-spawn.

## Reglas

- **NUNCA** uses `tmux send-keys` directamente para comunicarte con otro agente. Pasa siempre por `jht-tmux-send`.
- **NUNCA** termines la sesion tmux de otro agente (regla #0 del Capitan).
- Si `tmux ls` muestra que la sesion de destino no existe, **no la crees** — pregunta al Capitan (o usa `start-agent.sh` si *eres* el Capitan).
- Por defecto usa la **coordinacion via DB** para los traspasos de pipeline (Scout→Analyst→Scorer→Writer); usa este skill solo para las senales en tiempo real listadas arriba. Consulta `agents/_manual/communication-rules.md`.
# Comunicación durante un turno ocupado

El mensaje se encola de inmediato. Si no se puede verificar la entrega, devuelve `queued/delivery unverified` (exit 6) con cola durable. Nunca se descarta ni se duplica al reintentar.
