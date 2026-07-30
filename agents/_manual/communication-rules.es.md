<!-- @translation: es, ai-translated 2026-06-06 -->
# 💬 Reglas de comunicación entre agentes

Los agentes JHT se coordinan principalmente a través de la **base de datos**, no mediante tmux. La BD transporta el estado estable del pipeline; tmux está reservado para **señales en tiempo real** que no pueden esperar al siguiente ciclo de polling.

## 🗄️ Coordinación vía BD (el valor por defecto)

Los traspasos en el pipeline fluyen naturalmente a través de la BD — no se necesita notificación tmux:

| Traspaso | Mecanismo |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analyst | El Analyst consulta `next-for-analista` continuamente; ve las filas con `status = new` de inmediato |
| 👨‍🔬 Analyst → 👨‍💻 Scorer | El Scorer consulta `next-for-scorer`; toma las filas con `status = checked` |
| 👨‍💻 Scorer → 👨‍🏫 Writer | El Writer consulta `next-for-scrittore` ordenado por `score DESC`; toma las filas con `status = scored` ≥ 50 |
| 👨‍🏫 Writer → 👤 Usuario | La posición llega a `status = ready` + `applications.critic_verdict = PASS`; el dashboard del Captain la muestra |

**Regla general**: si el siguiente agente en el pipeline puede ver el nuevo estado ejecutando su consulta estándar `next-for-X`, **no envíes un mensaje tmux**. Enviar tmux en cada batch genera ruido y riesgo de mensajes perdidos en paneles ocupados.

## 📡 tmux es solo para señales en tiempo real

Envía un mensaje tmux solo cuando el destinatario necesita actuar *ahora* y no puede esperar al siguiente poll de la BD:

| Tipo | Cuándo usarlo | Tiempo real necesario porque… |
|---|---|---|
| `URG` | Captain → workers (FREEZE / throttle / kill) ante señal del Sentinel | La superación del rate-limit es inminente — el polling de la BD es demasiado lento |
| `URG` | Sentinel → Captain ante cambio de estado real (pico, violación, crash) | Ídem |
| `FEEDBACK` | Analyst → Scout sobre patrones de rechazo (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) | El Scout debe adaptar la **próxima** consulta, no después de un ciclo de polling |
| `REQ` / `RES` | Solicitud interactiva entre agentes (rara) | Se espera respuesta síncrona |
| `ACK` | Respuesta confirmando que un `URG` fue recibido y aplicado | El Captain necesita saber que el throttle/freeze surtió efecto |

## 📨 Sobre del mensaje

Todo mensaje entre agentes usa un sobre etiquetado de una sola línea:

```
[@from -> @to] [TYPE] payload
```

`TYPE` es uno de `URG · FEEDBACK · REQ · RES · ACK · INFO · REPORT` — pero en V5 solo los primeros 5 se usan de forma rutinaria (ver tabla anterior).

## 🛠️ Envío: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Nunca uses `tmux send-keys` directamente para mensajes entre agentes.** Las TUI de Codex y Kimi pierden el carácter Enter si llega en la misma llamada `send-keys` que el cuerpo del texto, causando deadlocks silenciosos. El wrapper maneja texto + Enter de forma atómica con una pausa de renderizado. Skill en `agents/_tools/jht-tmux-send`.

## 🔇 Producir es silencioso — el estado se lo lleva el Capitano

Un worker toca al Capitano **cero veces** para contar su avance. Ni por ítem, ni en los extremos: los
bookends `[START]` / `[DONE]` se **retiraron el 2026-07-27**. Medido en un equipo de primer arranque,
~1,5h de historial: **37 mensajes llegaron al Capitano, 30 (81%) puro estado** — 12 `DONE`, 8 `START`,
8 `INFO`, 2 `ACK` — frente a 3-6 que pedían realmente una decisión. Cada uno le cuesta un turno entero
y, con el reparto automático de modelos, él corre en **Opus** mientras Scout / Analista / Scorer corren
en **Sonnet**: un "hecho" del Scorer despierta al agente más caro de la flota para no hacer nada.

El lado pull ya existía y es mejor:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Una llamada devuelve los recuentos por agente más cada transición con timestamp, actor, posición y
motivo — `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Un `DONE` lleva menos información
que la fila que lo produjo.**

### ⚠️ Qué sigue siendo PUSH — la asimetría es el punto

`recent-activity` muestra **quién produce**, así que un agente que se ha parado **desaparece de la
lista** en lugar de destacar: desde el lado del Capitano tu silencio y tu trabajo son idénticos. Estos
tres deben seguir enviándose **de inmediato**, porque no dejan **rastro en la DB**:

| Señal | Cuándo |
|---|---|
| **BLOQUEADO** | has dejado de producir: herramienta rota tras la escalera `resilience`, `403` / `LOCKED`, fuentes realmente secas (`[SCOUT-ESAUSTO]`), un elemento en cola que no puedes procesar ni saltar |
| **Conflicto** | dos compañeros sobre el mismo registro / territorio y no lográis cerrarlo entre vosotros |
| **Petición de decisión** | un `REQ` que solo el Capitano puede responder (arbitraje de taxonomía, escalado, una decisión de cara al usuario) |

Todo lo demás — inicio, avance, fin — es pull. **Si te paras y no lo dices, nadie se entera.**

## ⏰ Señales obligatorias por rol

Lo que cada rol DEBE enviar vía tmux (todo lo demás es vía BD):

### 🕵️ Scout
- Recibe `FEEDBACK` de los Analysts → adapta las consultas; responde `ACK`

### 👨‍🔬 Analyst
- Envía `FEEDBACK` a un Scout cuando:
  - 3 exclusiones consecutivas de la misma fuente con la misma etiqueta, O
  - Tasa de exclusión >60% en un solo batch de un Scout

### 👨‍💻 Scorer
- *(sin tmux — los traspasos del pipeline son vía BD; las estadísticas de distribución de puntuaciones aparecen en el dashboard del Captain)*

### 👨‍🏫 Writer
- Recibe `URG FREEZE` del Captain → termina el round Critic actual (nunca abandonar una revisión a mitad), luego `ACK` y suspender hasta que el throttle vuelva a T0/T1

### 💂 Sentinel
- Edge-triggered: solo habla cuando el estado cambia realmente (pico de uso, violación de proyección, crash de agente). Envía `URG` al Captain con la acción propuesta (throttle / freeze / kill). Nunca envía directamente a los workers — el Captain es la puerta de enlace.

### 👨‍✈️ Captain
- Envía órdenes `URG` a los workers (FREEZE, nivel de throttle, kill) ante señal del Sentinel
- Envía `REQ` para coordinación interactiva (raro)
- Reenvía el feedback del usuario de la Fase 5 al rol correspondiente
- Lee el estado del pipeline desde la BD, no desde los paneles de los workers — nunca cuestiona a un agente conectándose a su tmux

## 📥 Leer mensajes de pares

No necesitas revisar tmux antes de *cada* acción — la mayor parte de la coordinación fluye a través de la BD. En su lugar:

- **Entre unidades de trabajo** (después de terminar una posición, antes de tomar la siguiente), haz un rápido `tmux capture-pane -p -S -20` en tu propia sesión.
- **Prioriza `URG` y `FEEDBACK`**: actúa sobre ellos antes de tomar trabajo nuevo.
- Un mensaje entrante mientras estás en medio de una tarea ya estará en tu contexto (el wrapper lo escribe en tu panel); no necesitas hacer polling, solo nótalo antes de iniciar la siguiente iteración.

## ⏸️ Throttle: pausas rastreadas

Cada vez que quieras ralentizar tu loop para respetar el presupuesto de rate
(enfriamiento después de un batch, freeze post-`URG`, "esperar al upstream", …),
**usa la skill `throttle`, nunca un simple `sleep`**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Cada llamada agrega un evento a `$JHT_HOME/logs/throttle-events.jsonl`,
para que el Captain y el dashboard puedan ver quién está en pausa y por cuánto
tiempo. El simple `sleep` solo está permitido para esperas muy cortas (≤ 5 s)
entre reintentos, donde el logging sería ruido.

Captain: cuando ordenes a un worker que ralentice, nombra la skill explícitamente,
ej. `[URG] Throttle: jht-throttle 180 --agent scout-1 --reason "rate budget"`.
No digas "sleep 3 minutes" — eso evita el logging.

Ver: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Relacionado

- 🛡️ [`anti-collision.md`](anti-collision.md) — mecanismos de lock (claim antes de trabajar)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — panorámica del pipeline (quién alimenta a quién)
