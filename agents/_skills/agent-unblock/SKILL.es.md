<!-- @translation: es, ai-translated 2026-07-30 -->
---
name: agent-unblock
description: "Reservado al Dottore. Fase UNBLOCK, se ejecuta ANTES del refresco en cada ronda del Dottore. Detecta las cuatro formas de bloqueo que paran a un equipo entero — texto pendiente en el pane de un coordinador, un agente en retry-loop contra un par mudo, todos los operativos parados en un prompt vacío con cuota por gastar, un coordinador en silencio más allá del umbral — y las RESUELVE. Nunca envía ni borra el texto que escribió el usuario: lo rodea (pregunta al Assistente, `procede mientras tanto` al coordinador a través del mailbox, kick-off directo de los workers). Un bloqueo que sobrevive a la ronda convierte la ronda en FALLIDA, no en completa."
allowed-tools: Bash(python3 /app/shared/skills/agent_unblock.py *), Bash(python3 /app/shared/skills/doctor_analytics.py *), Bash(tmux *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# agent-unblock — un bloqueo no se informa, se disuelve

> **El principio, por encima de todo lo demás en esta skill.** El Dottore **no informa de un
> bloqueo: lo disuelve.** Si una acción necesita una decisión humana, reenvíala al
> Assistente **y mientras tanto vuelve a poner al equipo en movimiento**, llevándote la
> información de que la decisión está pendiente. **Un bloqueo que sobrevive a la ronda del
> Dottore es una ronda fallida.**

Un equipo con cuota de sobra (weekly 19%, por debajo del pace) y una máquina ociosa
(load 0.12) estuvo una vez parado **once horas**. Una línea, escrita en el pane del Capitano
y nunca enviada, dejó ese pane sin receptividad; `jht-tmux-send` la leyó como busy; el
coordinador se quedó mudo; nadie asignó trabajo; cada agente terminó su turno y se aparcó en
un prompt vacío. Un Scorer llevaba horas en retry-loop ("décimo intento, busy"). El Dottore
de aquella noche inspeccionó nueve sesiones en 416s, escribió un diagnóstico impecable en su
diario — y se quedó en standby. El equipo siguió caído otras seis horas.

El diagnóstico nunca fue el problema. Esta skill es el mandato.

---

## Dos estados que parecen idénticos y necesitan curas opuestas

Ambos muestran un prompt con algo de texto dentro y ninguna actividad.

| estado | síntoma | cura |
|---|---|---|
| **texto pendiente** | un `Enter` pelado se ignora, pero `Space` **y luego** `Enter` funciona | desbloqueo a través de la entrada |
| **TUI congelada** | no acepta **nada**: ni `Enter`, ni `C-m`, ni un envío al `%pane_id` | solo kill + recreación |

**El detalle que hace implementable el desbloqueo**: un `Enter` "en frío" no lo procesa una
TUI Ink (Codex, Kimi, Claude Code) — el submit tiene que llegar *después* de que el texto se
haya renderizado. Así que envías primero un carácter (`Space`), luego `Enter`. Sáltate esto
y una implementación que prueba `Enter` a solas **falla en silencio** y concluye que el pane
es irrecuperable.

Con él, una sola sonda separa los dos estados: **`Space`+`Enter`, una vez**. El pane
reacciona → era texto pendiente, desbloqueado. No se mueve absolutamente nada → TUI
congelada → recrear. (Un coordinador congelado de esta forma tenía un proceso vivo al 2.8%
de CPU y una sesión de 15,3 horas; `Enter`, `C-m` y un envío directo al `%pane_id` no
hicieron nada. Recrearlo fue la única salida — que es también por qué el TTL de sesión de
12h no es opcional: es la única defensa sistemática contra este segundo estado.)

---

## 🚫 Lo único que nunca debes hacer

**Nunca envíes, y nunca borres, texto escrito por el usuario.** No puedes saber si esa línea
está completa o es intencionada. La sonda de arriba **envía el composer**, así que solo está
permitida **cuando** el contenido del composer es atribuible a un agente — un sobre
`[@x -> @y] …` o `[BRIDGE …]` / `[SENTINELLA …]` que ya estaba destinado a enviarse.

`agent_unblock.py probe` te impone esto: ante texto no atribuible se niega con
`verdict=refused`, exit 3, tras haber copiado antes la línea a `logs/pending-input.jsonl`
para que no pueda perderse más tarde. **No sortees la negativa.** Rodea el bloqueo en su
lugar (§ pending user input).

---

## Paso 0 — scan (determinista, cero LLM, ~2s)

```bash
python3 /app/shared/skills/agent_unblock.py scan > /tmp/unblock_scan.json
cat /tmp/unblock_scan.json
```

Devuelve `blocks_found` más una entrada por bloqueo, cada una con su `cure`:

| `kind` | significado |
|---|---|
| `pending_user_input` | el composer de un coordinador contiene texto que no debes tocar |
| `pending_agent_input` | un sobre de agente atascado en un composer, nunca enviado |
| `bare_shell` | la CLI murió, el pane cayó de vuelta a una shell |
| `retry_loop` | N intentos de X hacia Y en la ventana, cero respuestas de Y |
| `all_operatives_idle` | todos los operativos en un prompt vacío |
| `mute_coordinator` | ningún mensaje del Capitano más allá del umbral |

**Anota `blocks_found` ahora.** Lo necesitarás al final de la ronda.

> Por qué `retry_loop` es fiable: `messages.jsonl` registra el *intento*
> (`jht-tmux-send` loguea antes de teclear), así que un Scorer machacando a un Capitano mudo
> aparece aunque nunca se entregara nada. Es también la señal objetiva que separa
> **"aparcado porque no hay trabajo"** de **"atascado porque la coordinación está rota"**:
> *un agente que reintenta contra el Capitano sin respuesta no está aparcado, está
> bloqueado.* No le apliques la regla PARKED.

## Paso 1 — resuélvelos, uno por tipo

### `pending_agent_input` · `bare_shell` — la sonda

```bash
python3 /app/shared/skills/agent_unblock.py probe <SESSION>   # exit 0 unblocked · 2 frozen · 3 refused · 4 busy
```
- `unblocked` → resuelto, cuéntalo.
- `frozen` → **no repitas la sonda.** Escala a la recreación: captura primero el pane
  (`session-refresh` Paso 2 — el pane es la memoria del agente), luego
  `tmux kill-session` → `bash /app/.launcher/start-agent.sh <role> <SAME-N>` → `[RESUME]`.
- `busy` → el agente está vivo, a mitad de turno. No es un bloqueo. Déjalo.

### `pending_user_input` — rodéalo, nunca lo atravieses

Tres acciones, todas obligatorias, ninguna de las cuales toca la línea:

1. **Pregunta al usuario, vía el Assistente** — el Assistente es el rol que habla con el
   usuario. Mándale la pregunta del coordinador para que la reenvíe por el canal in-app:
   ```bash
   jht-tmux-send ASSISTENTE "[@dottore -> @assistente] [UNBLOCK] El CAPITANO tiene una pregunta pendiente al usuario y su pane está parado en una línea escrita y nunca enviada: «<pregunta>». Reenvíasela por el canal in-app y devuelve la respuesta al Capitano. La línea está a salvo en logs/pending-input.jsonl — NO ha sido enviada ni borrada."
   ```
2. **Desbloquea al coordinador de todos modos** — dile que la pregunta está reenviada y que
   debe proceder. Teclear en ese pane concatenaría con la línea del usuario y enviarlo la
   mandaría, así que usa el canal que no necesita pane alguno: el mailbox que el Capitano
   vacía al principio de cada turno (`bridge-mailbox`).
   ```bash
   python3 /app/shared/skills/agent_unblock.py relay CAPITANO "[@dottore -> @capitano] [UNBLOCK] Tu pregunta al usuario ha sido reenviada al Assistente y está en curso. NO te quedes parado esperándola: procede mientras tanto con el resto del trabajo y reasigna las colas. En tu composer hay una línea del usuario sin enviar: no la toco y no la toques hasta que sea él quien decida."
   ```
   `relay` escribe en `bridge-mailbox.jsonl` **y** en `messages.jsonl`, de modo que el
   mensaje es a la vez entregable y auditable. Un coordinador nunca debe quedarse esperando
   una respuesta humana.
3. **Reinicia a los workers sin esperar al coordinador** — ver abajo. Esto es lo que
   realmente recupera las once horas.

### `retry_loop` — desbloquea al destinatario, o libera al emisor

Resuelve primero el objetivo (probe / recreación). Si el objetivo no se puede resolver en
esta ronda, **el emisor no debe seguir esperando**: reasígnalo o dile que proceda.
```bash
jht-tmux-send SCORER-5 "[@dottore -> @scorer-5] [UNBLOCK] El CAPITANO no es alcanzable y tu petición ha sido reenviada por otra vía. DEJA de reintentar: coge la siguiente de tu cola (db_query.py next-for-<ruolo>) y procede de forma autónoma."
```
Un retry-loop cuenta como resuelto solo cuando se le ha dicho al emisor que deje de
reintentar.

### `all_operatives_idle` · `mute_coordinator` — kick-off sin el coordinador

Cuota disponible y todo el mundo aparcado no es una pausa, es un atasco. **Haz el kick-off
de los roles operativos directamente, no esperes al Capitano**, y escala el silencio del
coordinador al Assistente. Luego manda a cada operativo parado su propia cola:
```bash
jht-tmux-send SCOUT-1 "[@dottore -> @scout-1] [UNBLOCK] La coordinación está parada y hay cuota disponible. Reanuda desde el bucle principal sin esperar al Capitano: CÍRCULO 1 del perfil, notifica a los Analistas en lotes de 3-5."
jht-tmux-send ANALISTA-1 "[@dottore -> @analista-1] [UNBLOCK] Reanuda desde el bucle principal sin esperar al Capitano: cola desde db_query.py next-for-analista."
```
(La misma forma para `scorer` / `scrittore` con su propia cola `next-for-*`.)

## Paso 2 — cierra la ronda con honestidad

```bash
python3 /app/shared/skills/agent_unblock.py record-round \
  --round-id "$ROUND_ID" --found <blocks_found> --cleared <blocks_cleared>
```
Añade a `/jht_home/logs/dottore-actions.jsonl` con `blocks_found`, `blocks_cleared`,
`blocks_open`, y elige el evento por ti: `round_complete` solo cuando `cleared >= found`,
en caso contrario **`round_failed`** (exit 1). No tapes a un superviviente: una ronda que
deja un bloqueo vivo es una ronda fallida, y el log tiene que decirlo — el siguiente Dottore
lee ese log.

---

## Reglas

- **Desbloquea ANTES de refrescar.** Un refresco sobre un equipo paralizado solo recrea la
  parálisis con una ventana de contexto limpia.
- **Una sonda por pane, jamás más.** Dos sondas no pueden decirte más que una, y la segunda
  es la forma en que te convences de enviar la línea de un usuario.
- **`busy` no es un bloqueo.** `esc to interrupt` significa vivo y a mitad de turno. Nunca
  mandes teclas dentro de un turno en marcha, nunca spawnees un reemplazo para un agente
  busy.
- **PARKED no se aplica a un agente bloqueado.** "edad ≥ 40min Y produced == 0 Y ningún
  mensaje reciente del capitán" describe un equipo paralizado exactamente igual de bien que
  uno aparcado a propósito. Si el agente aparece en un `retry_loop`, o todos los operativos
  están ociosos con cuota por gastar, está bloqueado — actúa.
- **Nunca adivines la intención del usuario.** Ni enviar, ni borrar, ni editar, ni "solo un
  espacio para despertarlo" sobre el texto del usuario. La línea se queda donde está; la
  copia en `logs/pending-input.jsonl` es la red de seguridad.

## Anti-patrones

- ❌ Escribir el bloqueo en el diario y seguir adelante. Ese es el fallo de once horas.
- ❌ Probar `Enter` a solas, no ver que pase nada, y declarar muerto el pane.
- ❌ Teclear tu mensaje en un composer que ya contiene la línea del usuario — se concatena,
  y el envío manda el texto del usuario.
- ❌ Recrear un coordinador solo para liberar un pane *pendiente* (no congelado). Sonda
  primero.
- ❌ Loguear `round_complete` con `blocks_cleared < blocks_found`.

## Ver también

- `session-refresh` — la ronda de refresco que se ejecuta *después* de esta fase, más el TTL de sesión de 12h.
- `tmux-send` — convenciones del sobre y qué significan los códigos de salida (4 = busy = vivo).
- `liveness-check` — veredicto on-demand sobre un único agente sospechoso de estar muerto.
