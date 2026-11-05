---
name: team-pause
description: "PAUSE the team (or one agent) without shutting anything down, and resume it. Open it the moment the user says «take a break», «pause», «hold on», «stop for now», «wait until I tell you», «freeze» — or «resume», «carry on», «you can start again». A pause keeps every session ON with its context; nobody works and nothing new starts until the user says to resume. It is NOT the stop: shutting the team down (`jht team stop`, `.team-halted.flag`, killing sessions) throws every agent's context away and is only for an explicit «turn the team off»."
allowed-tools: Bash(python3 /app/shared/skills/agent_control.py *), Bash(python3 /app/shared/skills/standby.py status *), Bash(python3 /app/shared/skills/agent_pause.py status *)
---

# team-pause — una pausa no es un apagado

El 05/11 el usuario le dijo al Assistente *«hagan una pausa, yo les digo cuándo reanudar»*. El Assistente pidió un «controlled freeze» al Capitano; el Capitano, sin ninguna skill para la pausa, escribió el flag de parada y **cerró todas las sesiones** — cada agente perdió su contexto — y al usuario se le dijo *«Paused ✅»*. Esta skill existe para que no vuelva a pasar: la pausa que pide el usuario mantiene las sesiones encendidas y el contexto intacto, y **lo que le dices al usuario es lo que dice la respuesta del comando**.

## 1. Qué palabra significa qué

| El usuario dice (en cualquier idioma) | Significa | Qué haces |
|---|---|---|
| «pausa», «deténganse», «esperen, yo les digo cuándo seguir», «congelen», «todos quietos por ahora» | **PAUSA** | §2 |
| «reanuden», «sigan», «pueden volver a empezar», «adelante» (tras una pausa) | **REANUDAR** | §4 |
| «pon en pausa al Scout» / «detén a Analista-1 un rato» | **PAUSA de un agente** | §5 |
| «apaga el equipo», «apaguen todo», «detén el equipo» *dicho como apagado* | **STOP** — no es esta skill | dile al usuario que cierra las sesiones y hace perder a cada agente lo que tenía en mente; hazlo solo si confirma que quiere eso |
| ambiguo («para», «para todo») | trátalo como **PAUSA** | se puede deshacer y conserva el contexto; dilo y ofrece el apagado si se refería a eso |

**Nunca** `jht team stop`, `.team-halted.flag`, `tmux kill-session` ni el «freeze» del Capitano para una pausa: eso es la parada.

## 2. Pausar el equipo

El **Assistente** lanza el comando él mismo (no le pidas al Capitano que improvise un freeze):

```bash
python3 /app/shared/skills/agent_control.py pause --until-resumed --from-assistant
```

El **Capitano**, si la orden le llega (un `[REQ]` que dice pausa, o el usuario escribiéndole), lanza la misma línea **sin** `--from-assistant`. Vuelve una línea JSON. Léela:

```json
{"ok": true, "op": "pause", "result": "paused",
 "detail": {"reached": ["CAPITANO","SCOUT-1", ...], "not_reached": ["SCORER-1"], "until_resumed": true}}
```

- `result: "paused"` — hecho. `"already_paused"` — ya lo estaba; dilo.
- `detail.reached` — las sesiones que recibieron el mensaje *«cierra tu paso, anota dónde estás, espera»*. `detail.not_reached` — sesiones vivas que no respondieron al transporte: **dile al usuario cuáles**.
- `ok: false` / `error` — **no** ocurrió. Dilo. Nunca «en pausa» tras un error.

Las sesiones siguen encendidas. Los bridges y watchdogs callan solos (sin heartbeat, sin ticks de pacing, sin refresh, sin nudges). El Assistente **no** está en pausa: sigue disponible.

La pausa no tiene hora de fin: termina cuando el usuario lo dice, con un **tope de 7 días** tras el cual el equipo reanuda solo (así una pausa olvidada no lo silencia para siempre). Díselo una vez.

## 3. Mientras el equipo está en pausa

- **No** despiertes al Capitano ni a nadie por peticiones, tickets o respuestas nuevas: dile al usuario que *se atenderán en cuanto reanude*. Un ticket queda abierto, no se pierde nada.
- **No** inicies, detengas, reinicies ni crees agentes. No toques los throttles.
- Si preguntan cómo va: `python3 /app/shared/skills/standby.py status` (y, para un agente, `python3 /app/shared/skills/agent_pause.py status SCOUT-1`). Las sesiones están encendidas; nadie trabaja.
- El Capitano, si está despierto: cierra el paso, sin órdenes nuevas, espera en silencio.

## 4. Reanudar

```bash
python3 /app/shared/skills/agent_control.py resume
```

`result: "resumed"` — cada sesión recibió *«sigue exactamente donde estabas»* y la automatización vuelve a estar activa. `"not_paused"` — no había pausa. `error: "team_halted"` — el usuario había **detenido** el equipo: reanudar una pausa no lo enciende; dilo y ofrece arrancarlo.

Un agente que el usuario pausó **solo** (§5) no lo despierta la reanudación del equipo: sigue en pausa hasta que se reanude por separado.

## 5. Un solo agente

```bash
python3 /app/shared/skills/agent_control.py pause-agent SCOUT-1
python3 /app/shared/skills/agent_control.py resume-agent SCOUT-1
```

El resto del equipo sigue trabajando. `error: "agent_not_running"` — esa sesión no está encendida; `"agent_contained"` — alguien la detuvo a propósito: dilo, no la fuerces. Detener o reiniciar un agente borra su pausa.

## 6. Qué le dices al usuario — solo lo que pasó

Tras la pausa (adapta las palabras, mantén los hechos):

> El equipo está en pausa. Los N agentes siguen encendidos y cada uno tiene presente lo que estaba haciendo; nadie trabaja hasta que me digas que reanude, y no se apagó nada. Me quedo aquí. (Si `not_reached`: «X no respondió, no pude avisarle.»)

Tras reanudar: *«Hecho: cada uno sigue donde estaba.»* Tras un error: *qué falló* y en qué estado está el equipo (`standby.py status`).

## Antipatrones

- ❌ «Paused ✅» sin la respuesta del comando. La palabra sale de `result`, los números de `detail`.
- ❌ Pedirle al Capitano que «aplique un controlled freeze» y dar su respuesta como la pausa. El Capitano sin skill escribió el flag de parada.
- ❌ `jht team stop`, `.team-halted.flag`, `kill-session`, `freeze_team.py` (Esc a cada panel) para una pausa.
- ❌ Despertar al equipo por un ticket durante una pausa.
- ❌ Hacer del apagado el comportamiento por defecto de «para todo»: hace perder el contexto a cada agente.

## Ver también

- `graceful-shutdown` — cerrar la jornada cuando el usuario sale de la aplicación (otra cosa: los agentes se cierran).
- `throttle-distribution` — frenar agentes al ritmo del presupuesto (una pausa no es un throttle).
