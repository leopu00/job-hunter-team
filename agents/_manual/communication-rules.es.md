<!-- @translation: es, ai-translated 2026-07-30 -->
# 💬 Reglas de comunicación entre agentes — lean, pull por defecto

Los agentes JHT se coordinan **pull-first**. Lo normal es *descubrir* el estado que necesitas, no
*pedirlo*. Un mensaje tmux es la **excepción**, reservada a lo que un compañero realmente no puede
encontrar por su cuenta.

> **Por qué lean.** Un protocolo push-heavy (broadcasts de estado, ACK de rutina, pings "¿sigues vivo?")
> quema tokens por ambos lados — quien envía escribe un turno, quien recibe despierta un turno para
> responder — y distrae a los agentes del trabajo real. Casi todo ese tráfico no lleva ninguna acción.
> Córtalo.

## 🪜 La jerarquía de coordinación — DB → capture-pane → mensaje

Usa siempre el **tier más barato que responda a tu pregunta**. Sube de tier solo cuando el de abajo
realmente no puede.

| Tier | Herramienta | Sirve para | Coste |
|---|---|---|---|
| **1. DB** | `db_query.py` (`next-for-*`, status, `last_checked`, flags) | **estado compartido** — qué hay en cola, qué está tomado, qué está hecho, puntuaciones, ciclo de vida | el más barato, determinista, sin races |
| **2. capture-pane** | `tmux capture-pane -p -S -N` sobre la sesión del compañero | **"¿qué está haciendo X ahora mismo?"** — si trabaja, si está bloqueado en un fetch, idle, atascado | barato (ningún turno en el compañero), pero es un **snapshot racy** — nunca te fíes de él como estado duradero |
| **3. mensaje tmux** | `jht-tmux-send` | **acción que el compañero no puede descubrir** + **eventos de seguridad** (ver barra abajo) | caro — un turno por cada lado; es la excepción |

**Regla general:** si la respuesta está en la DB, consulta la DB. Si necesitas saber qué está haciendo
un compañero *en este momento*, mira su pane — **no le mandes un mensaje para preguntárselo**. Manda
mensaje solo cuando ninguna de las dos cosas sirve.

## 🚧 El listón para un mensaje tmux (push)

Manda un mensaje **solo** si se cumple una de estas:

1. **Traspaso real** — el compañero tiene que *hacer* algo que no puede descubrir desde su propio bucle
   `next-for-X` ni desde la DB. Ejemplos: Writer → Critico para arrancar el bucle de review del CV;
   Capitano → worker para spawn / throttle / kill; Analista → Scout `FEEDBACK` que debe cambiar la
   *próxima* query.
2. **Evento de seguridad** — `LOCKED` / `403`, halt, kill, crash, una violación de rate inminente que el
   polling de la DB es demasiado lento para captar. Solo Sentinel → Capitano.
3. **De cara al usuario** — una petición del humano o una respuesta al humano (canal aparte; ver los
   manuales de rol).

### ✂️ Qué se CORTA (no enviar)

- **ACK vacíos** — "recibido, contexto actualizado", "ok, a la espera". Si el mensaje no requería
  ninguna acción y quien lo envió no *necesita* la confirmación para seguir, **no digas nada**. (Ver
  `ACK` abajo para el caso raro.)
- **Broadcasts de estado** — "@all check 10:14, colas vacías, todos en standby". Todo eso es observable:
  las colas están en la DB, la actividad en los panes. No se lo narres a todo el mundo. (Para
  observabilidad legible por humanos, escribe en el event-log estructurado, no en los panes de los
  compañeros.)
- **"¿Estás vivo? / ¿por dónde vas?"** — usa capture-pane (Tier 2). Nunca quemes el turno de un
  compañero para pedirle un estado que tendría que pararse a escribir.
- **Reconfirmaciones / órdenes repetidas** — si ya enviaste una orden, no la reenvíes en cada tick. El
  bridge / la mailbox la entrega una sola vez.

## 🔇 Producir es silencioso — el estado se lo lleva el Capitano

Un worker toca al Capitano **cero veces** para contar su avance. Ni por ítem, ni en los extremos: los
bookends `[START]` / `[DONE]` se **retiraron el 2026-07-27**. Medido en un equipo de primer arranque,
~1,5h de historial: **37 mensajes llegaron al Capitano, 30 (81%) puro estado** — 12 `DONE`, 8 `START`,
8 `INFO`, 2 `ACK` — frente a 3-6 que pedían realmente una decisión. Cada uno le cuesta un turno entero
y, con el reparto automático de modelos, él corre en **Opus** mientras Scout / Analista / Scorer corren
en **Sonnet**: un "hecho" del Scorer despierta al agente más caro de la flota para no hacer nada.

El lado pull ya existía y es claramente mejor:

```bash
python3 /app/shared/skills/db_query.py recent-activity --minutes 60
```

Una llamada devuelve los recuentos por agente más cada transición con timestamp, actor, posición y
motivo — `#22 checked→scored`, `#27 new→excluded — [DEAD_LINK]`. **Un `DONE` lleva menos información
que la fila que lo produjo.** (El mismo protocolo ya había matado la inundación por ítem: un Analista
despertó una noche al Capitano **25 veces**, un ping por posición. Ahora también han desaparecido los
dos bookends "educados".)

### ⚠️ Qué sigue siendo PUSH — la asimetría es el punto

`recent-activity` muestra **quién produce**, así que un agente que se ha parado **desaparece de la
lista** en lugar de destacar: desde el lado del Capitano tu silencio y tu trabajo son idénticos. Estos
tres deben seguir enviándose **de inmediato**, porque no dejan **rastro en la DB**:

| Señal | Cuándo |
|---|---|
| **BLOCKED** | has dejado de producir: herramienta rota tras la escalera `resilience`, `403` / `LOCKED`, fuentes realmente secas (`[SCOUT-ESAUSTO]`), un elemento en cola que no puedes procesar ni saltar |
| **Conflicto** | dos compañeros sobre el mismo registro / territorio y no lográis cerrarlo entre vosotros |
| **Petición de decisión** | un `REQ` que solo el Capitano puede responder (arbitraje de taxonomía, escalado, una decisión de cara al usuario) |

Todo lo demás — inicio, avance, fin — es pull. Siguen permitidos como antes, porque son *decisiones* y
no narración: un `FEEDBACK` a un Scout, un `URG` de seguridad. **Si te paras y no lo dices, nadie se
entera.**

## 🗄️ Tier 1 — coordinación vía DB (el valor por defecto)

Los traspasos del pipeline fluyen por la DB — **sin tmux**:

| Traspaso | Mecanismo |
|---|---|
| 🕵️ Scout → 👨‍🔬 Analista | El Analista consulta `next-for-analista`; ve las filas frescas con `status = new` |
| 👨‍🔬 Analista → 👨‍💻 Scorer | El Scorer consulta `next-for-scorer`; toma las filas con `status = checked` |
| 👨‍💻 Scorer → 👨‍🏫 Writer | El Writer consulta `next-for-scrittore` (`score DESC`); toma las filas con `status = scored` ≥ 50 |
| 👨‍🏫 Writer → 👤 Usuario | La posición llega a `status = ready` + `applications.critic_verdict = PASS`; aparece en el dashboard |

**Tomar un registro sin mandar mensajes** — los compañeros evitan la misma fila gracias a los locks de
[`anti-collision.md`](anti-collision.md): dedup pre-INSERT + partición circles/sources para el Scout;
watermark `last_checked` para Analista/Scorer; flip a `status = writing` para el Writer. **Gana la
primera escritura.** No anuncias "cojo el ID 42" — el claim *es* el lock; el compañero lo lee de la DB.

## 👀 Tier 2 — capture-pane (observa, no preguntes)

Para entender qué está haciendo un compañero **sin molestarlo**:

```bash
tmux capture-pane -t <PEER_SESSION> -p -S -40
```

Busca: el spinner / `esc to interrupt` (vivo, a mitad de turno), un prompt de shell pelado (idle /
posiblemente atascado), un fetch bloqueado. Esto sustituye por completo a los mensajes "¿estás vivo? /
¿cuál es tu estado?".

⚠️ **Es un snapshot, no el estado.** Puedes pillar un turno a medio renderizar. Úsalo para *liveness /
actividad*, **nunca** como fuente de verdad del estado compartido — eso es siempre la DB (Tier 1). El
veredicto sobre un compañero *posiblemente muerto* es del Dottore (`liveness-check`), no de una lectura
refleja.

## 📨 Tier 3 — sobre del mensaje y tipos

Sobre etiquetado de una sola línea:

```
[@from -> @to] [TYPE] payload
```

Conjunto de tipos reducido (usa el más estrecho que encaje):

| Tipo | Cuándo |
|---|---|
| `URG` | Seguridad / actúa ya: Capitano → worker (throttle / freeze / kill); Sentinel → Capitano (violación, crash, LOCKED) |
| `FEEDBACK` | Analista → Scout, patrones de rechazo (`[SENIORITY] · [STACK] · [GEO] · [LINGUA]`) que deben cambiar la próxima query |
| `REQ` / `RES` | Una petición síncrona genuina que espera respuesta (rara) — un traspaso real, no una pregunta de estado |
| `BLOCKED` | Worker → Capitano: has **dejado de producir** y eso no deja rastro en la DB (herramienta rota, `403`/`LOCKED`, fuentes secas, un elemento que no puedes procesar ni saltar). Desde 2026-07-27 es la única señal que separa un atasco del trabajo silencioso — `recent-activity` no puede mostrarlo, porque un agente parado desaparece de esa lista |

`ACK` — **solo** cuando quien envía necesita de verdad saber que la acción surtió efecto para seguir con
seguridad (p. ej. el Capitano debe confirmar que se aplicó un `FREEZE` antes de escalar). **No** es una
respuesta de rutina. Si una orden no necesita confirmación para ser segura, quien la recibe la aplica en
silencio. `INFO` / `REPORT` están deprecados para el tráfico entre pares: manda la narración al
event-log, no a los panes.

## 🛠️ Envío: `jht-tmux-send`

```bash
jht-tmux-send <PEER_SESSION> "[@me -> @peer] [URG] FREEZE"
```

⚠️ **Nunca `tmux send-keys` en crudo para mensajes entre agentes.** Las TUI de Codex/Kimi pierden el
carácter Enter cuando llega junto al cuerpo, causando deadlocks silenciosos. El wrapper maneja texto +
Enter de forma atómica. Es **busy-aware**: espera a que termine el turno del compañero y entonces
entrega (`exit 0`); `exit 4` = compañero vivo pero aún ocupado más allá del presupuesto → **reintenta
más tarde, no hagas spawn / no te pongas a razonar de nuevo**; `exit 3` = posiblemente muerto →
veredicto del Dottore, no un reflejo. Skill: `agents/_skills/tmux-send/jht-tmux-send`.

**Ante un envío fallido / ocupado:** encólalo (la `bridge_mailbox` que drena el Capitano), **no** abras
un turno de razonamiento nuevo para "pensar" en el fallo. El reintento es mecánico, no cognitivo.

## ⏰ Señales obligatorias por rol (todo lo demás es pull)

### 🕵️ Scout
- **Nunca te anuncies** al Capitano — ni `[START]`, ni `[DONE]`, nada por resultado. Los INSERT son el
  informe; él los lee de `recent-activity`. Push solo cuando estás **BLOCKED y ya no produces**
  (incluido `[SCOUT-ESAUSTO]`) o en conflicto con otro Scout.
- Recibe `FEEDBACK` de los Analistas → adapta la próxima query. **Sin ACK** salvo que el Analista haya
  hecho un `REQ`.

### 👨‍🔬 Analista
- **Nunca te anuncies** al Capitano — ni `[START]`, ni `[DONE]`, nada por posición. El flip a `checked`
  es el informe. Push solo cuando estás **BLOCKED y ya no produces**, o para un `REQ` de arbitraje de
  taxonomía.
- Manda `FEEDBACK` a un Scout solo ante un patrón real: 3 exclusiones consecutivas con la misma etiqueta
  desde una misma fuente, O > 60 % de tasa de exclusión en un batch de un Scout. Si no, silencio (el
  traspaso lo lleva la DB).

### 👨‍💻 Scorer
- **Nunca te anuncies** al Capitano — ni `[START]`, ni `[DONE]`, nada por puntuación. Cada puntuación es
  una fila de la DB que él saca de `recent-activity`. Push solo cuando estás **BLOCKED y ya no
  produces**. El traspaso del pipeline es vía DB; los insights salen en dashboard / event-log.

### 👨‍🏫 Writer
- **Nunca te anuncies** al Capitano — ni `[START]` al tomar un trabajo de CV, ni `[DONE]` cuando llega a
  `ready`: la transición `writing → ready` está en la DB. Push solo cuando estás **BLOCKED y ya no
  produces** (bucle del Critico atascado, faltan datos de perfil).
- Ante `URG FREEZE` del Capitano: termina el round Critic actual (nunca abandonar una review a mitad),
  luego frena. Solo aquí va el `ACK` — es el caso raro de confirmar-para-proceder.

### 💂 Sentinel
- Edge-triggered, **solo dentro del horario de trabajo**. Habla **solo** ante un cambio de estado real
  (pico, violación, crash, `LOCKED`). Un mensaje por edge — nunca lo reemitas. Nunca hace broadcast a
  los workers (el Capitano es la puerta). Estado estable → silencio.

### 👨‍✈️ Capitano
- `URG` a los workers (throttle / freeze / kill / spawn) ante señal del Sentinel o necesidad observada
  del pipeline.
- Lee el estado del pipeline desde la **DB**, la actividad de los agentes desde **capture-pane** — nunca
  narra estado a los pares, nunca reenvía órdenes ya dadas.

## 📥 Leer mensajes de pares

No escaneas tmux antes de cada acción — la mayor parte de la coordinación está en la DB.
- **Entre unidades de trabajo** (después de una posición, antes de tomar la siguiente): un rápido
  `tmux capture-pane -p -S -20` sobre **tu propia** sesión para notar un `URG` / `FEEDBACK` entrante.
- Prioriza `URG` / `FEEDBACK`; actúa antes de tomar trabajo nuevo.
- Un mensaje que llega a mitad de tarea ya está en tu contexto (el wrapper lo escribió en tu pane) —
  basta con notarlo antes de la siguiente iteración.

## ⏸️ Throttle: pausas rastreadas

Para ralentizar tu bucle (cooldown, post-`URG`, esperar al upstream), usa la skill `throttle`, **nunca
un simple `sleep`**:

```bash
jht-throttle <seconds> --agent <your-name> [--reason "..."]
```

Cada llamada se registra en `$JHT_HOME/logs/throttle-events.jsonl`, para que el Capitano y el dashboard
vean quién pausa y cuánto. El `sleep` pelado solo para esperas de reintento ≤ 5 s. Capitano: nombra la
skill explícitamente en la orden (`[URG] jht-throttle 180 --agent scout-1 --reason "rate budget"`),
nunca "sleep 3 minutos".

Ver: [`../_skills/throttle/SKILL.md`](../_skills/throttle/SKILL.md).

## 🔗 Relacionado

- 🛡️ [`anti-collision.md`](anti-collision.md) — locks claim-before-work (cómo coordinarse vía DB)
- 🧭 [`../_team/architettura.md`](../_team/architettura.md) — panorámica del pipeline (quién alimenta a quién)
