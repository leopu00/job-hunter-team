<!-- @translation: es, ai-translated 2026-07-28 -->
---
name: throttle-distribution
description: Decide A QUIÉN ralentizar y CUÁNTO cuando el consumo del equipo tiene que cambiar. Ábrela cuando llegue un aviso `[PACE-GUARD]` a tu panel, cuando la Sentinella ordene un nivel `Throttle: N`, o cuando una comprobación tuya diga que la ventana va fuera de ritmo. Cada uno de esos señales es un único número a nivel de equipo; el actuador es por agente, y elegir el reparto por agente es solo tuyo — ningún script mueve ya el throttle de los workers. También te dice cuándo lo correcto es no tocar nada.
allowed-tools: Bash(python3 *), Bash(jht-tmux-send *)
---

# throttle-distribution — quién ralentiza, y cuánto

Cada señal de pacing que recibes es un solo número para todo el equipo: *"35% demasiado rápido"*, *"Throttle: 2"*, *"aconsejado 780s"*. El actuador no es un solo número — es un valor por agente en `throttle.json`, y **eres el único que lo escribe**. Ningún script mueve ya el throttle de los workers por su cuenta.

El trabajo de esta skill es esa conversión, y tiene una sola regla dura: **un número a nivel de equipo no significa que todos reciban el mismo valor.** Un Scout puede ser el 52% del consumo mientras un Escritor parado es el 2%; el Analista y el Scorer son los dos roles que convierten un atraso en lo único que el usuario ve de verdad — una posición **con puntuación**. Nivelar gasta tu freno donde no hay nada que ganar y quita rendimiento donde más cuesta.

## Cuándo abrir esta skill

| Disparador | De dónde viene | Ve a |
|---|---|---|
| `[PACE-GUARD] … NON APPLICATO` en tu panel | el bridge: compara el consumo con la curva de la ventana en cada sample de usage, y solo te escribe cuando hay algo sobre lo que actuar | §1 |
| `[SENTINELLA] [URG] RALLENTARE — Throttle: N`, o cualquier señal de pacing que ella te reenvíe | ella recibe el tick `[BRIDGE PACING]` de 15 min (llega a **su** panel, no al tuyo), lo lee y decide si merece la pena despertarte | §3 — el "cuánto" está decidido, el reparto no. `bridge-pacing` descodifica sus números |
| `[HEARTBEAT]` que menciona weekly/consumo, o un pull tuyo de `rate-budget` / `agent-speed-table` | tú, por iniciativa propia | §2 |

> ⚠️ **No te hacen ping cada 15 minutos, y no debes esperarlo.** Mantenerte tranquilo es deliberado: si cada bridge de la oficina te reportara directamente, gastarías el presupuesto leyendo en vez de decidiendo, y lo quemarías mientras el usuario duerme. El tick de 15 min va a la Sentinella, que filtra y solo entonces te molesta. Así que **conduce sobre las condiciones que observas** — no te quedes esperando un tick que no va dirigido a ti. Si una línea de pacing sí te llega directa, o es un `[PACE-GUARD]` o es una escalada avisando de que la Sentinella dejó de responder (eso es un problema de liveness, no un veredicto de pacing — `agent-emergency`).

---

## 1. Leer el aviso `[PACE-GUARD]`

Una sola línea física, campos separados por ` | ` (aquí partida para poder leerla):

```
[@bridge -> @capitano] [PACE-GUARD] <VERDETTO> — CONSIGLIO, THROTTLE NON APPLICATO |
  usage=<U>% vs curva=<I>% (<±D>pt sul target <T>% al reset) | reset fra <M> min |
  throttle worker ORA <C>s → CONSIGLIATO <R>s (<±S> gradini) | worker: <a1, a2, ...> |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set <a1>=<R> <a2>=<R>
```

Anclajes estables por si tienes que reconocerla en un panel ruidoso: la etiqueta `[PACE-GUARD]`, las palabras `NON APPLICATO` y `CONSIGLIATO <R>s`.

| Campo | Qué te dice |
|---|---|
| `<VERDETTO>` | `AVANTI` (por encima de la curva) / `INDIETRO` (por debajo) / `IN-PARI` / `LOCKOUT-IMMINENTE` |
| `usage=<U>% vs curva=<I>%` | dónde estás frente a dónde dice la recta ideal `usage = objetivo × transcurrido / ventana` que deberías estar ahora |
| `<±D>pt` | la deriva en puntos de presupuesto. **Por debajo de ±6pt es ruido de medida** — es el propio escalón del guard |
| `sul target <T>% al reset` | el objetivo al que apunta la curva. Es el `<T>` que necesitas en §2 |
| `reset fra <M> min` | cuánta ventana queda. Es esto lo que convierte una deriva en una urgencia |
| `ORA <C>s → CONSIGLIATO <R>s` | el throttle actual de los workers y el **único valor de grupo** del guard, en segundos |
| `worker: …` | los workers vivos sobre los que se calculó el consejo. Los exentos del suelo ya están **excluidos** — no vuelvas a filtrar |

Dos variantes:
- en `LOCKOUT-IMMINENTE` aparece un campo extra **antes** del último: `il freno da solo non basta: valuta di ridurre il ROSTER (togli uno Scout, mai l'Analista o lo Scorer)`.
- si todos los workers vivos están exentos del suelo, el último campo pasa a ser `nessun worker su cui agire (tutti esenti dal floor): decidi tu`.

> ⚠️ **El valor aconsejado es un nivel, no un reparto — y el `bulk-set` al final de la línea es una sugerencia, no una orden.** El guard deriva ese número del worker **más frenado** y lo mueve un escalón por cada ~6 puntos de deriva, y luego se lo ofrece a todos los workers a la vez. Pegar ese comando *es* el nivelado. Lee la línea como *"más o menos esta tasa debe desaparecer"*, y luego decide *de quién* (§3) y *cuánto* (§4).

`LOCKOUT-IMMINENTE` (usage ≥95% **y** todavía por encima de la curva) es el único veredicto que no va del throttle: la ventana se está cerrando antes de tiempo, el freno ya está cerca del techo y la palanca que queda es el **roster** — mata un Scout. Nunca al Analista ni al Scorer: sin ellos no se puntúa nada y el usuario ve una pantalla vacía.

Si tu panel estaba ocupado, la línea también está en el buzón: `python3 /app/shared/skills/bridge_mailbox.py drain`, entradas con `kind:"pace-guard"`. Aplica solo la **última** — repetir consejos viejos es pelear contra tus propias calibraciones pasadas.

---

## 2. Cuánta tasa debe desaparecer

Si la señal fue una orden `Throttle: N` de la Sentinella, el "cuánto" ya está decidido — salta al §3. Si no, una línea:

```
vel_needed = (<T> − usage) / horas_hasta_reset          # la tasa que aterriza exactamente en el objetivo
f_team     = (vel_now − vel_needed) / vel_now × 100     # la parte de la tasa de equipo a quitar
```

`vel_now` es la tasa actual del equipo en puntos % de presupuesto por hora: tómala de `agent-speed-table.py` (`team.speed_pct_per_h`, §3) o de `rate-budget`. `f_team ≤ 0` significa que tienes margen → §5.

> 💡 **La misma deriva significa cosas distintas según cuánta ventana quede**, y eso es justo lo que el "un escalón cada 6 puntos" fijo del guard no puede ver. `+18pt` con 3 horas por delante es una corrección de 7%/h: un agente, un escalón más arriba. `+18pt` con 20 minutos por delante es una corrección de 54%/h, que ningún throttle puede entregar — eso es una decisión de roster, o un cierre anticipado aceptado. Divide siempre la deriva entre las horas restantes antes de decidir cuánto apretar.

---

## 3. QUIÉN paga — el reparto

El punto de esta skill. Tres entradas, en este orden.

**a. Quién está gastando.** El throttle devuelve presupuesto en proporción estricta a lo que un agente consume de verdad. Reducir a la mitad un agente que es el 2% de la tasa del equipo devuelve el 1%: una escritura de config, un escalón y un turno tuyo gastados para nada. Por eso la respuesta a "el equipo va un 35% demasiado rápido" nunca es "todos abajo un 35%".

Las cuotas por agente viven en el tick de 15 min, que llega a la Sentinella — así que haz tu propio pull:

```bash
python3 /app/shared/skills/agent-speed-table.py --since-min 60
```

Por agente devuelve `pct_per_h` (puntos de presupuesto por hora) y `team_share_pct`, más `throttle_options` (cuánto ahorraría una pausa/hora dada). Omite a quien esté por debajo de 0.20 %/h por la misma razón por la que deberías omitirlo tú: throttlearlo no cambia nada.

**b. Quién está produciendo.**

```bash
python3 /app/shared/skills/db_query.py stats
```

Lee `UNSCORED` (posiciones − puntuaciones) como la cola detrás del Analista/Scorer, y la cola del Escritor como demanda dirigida por el usuario. Un Scout que quema el 52% del presupuesto con `UNSCORED = 40` está comprando entrada que nadie puede consumir todavía — lo más barato del tablero para ralentizar. El mismo Scout con `UNSCORED = 0` alimenta toda la pipeline, y ralentizarlo impide al equipo producir nada en absoluto.

**c. La rejilla.**

| | **Produciendo** | **Parado / bloqueado** |
|---|---|---|
| **Share alto** | ralentízalo, pero **un escalón**, y vuelve a medir — se está pagando solo | **el primero a ralentizar, y fuerte** — y si ya está alto en la escalera y sigue quemando sin producir, la palanca es el KILL, no otro escalón |
| **Share bajo** | no lo toques: no ganas presupuesto y pierdes rendimiento | tampoco lo toques: ya no está gastando nada, frenarlo no devuelve nada |

Sobre la rejilla, la asimetría de roles: los últimos que ralentizas son los que convierten un atraso existente en una posición **con puntuación** (Analista, Scorer) — son la diferencia entre "50 posiciones encontradas" y algo sobre lo que el usuario pueda actuar. El primero es el que genera entrada nueva en bruto cuando la cola aguas abajo ya es profunda (Scout). Un Escritor con la cola vacía no es palanca en ninguna de las dos direcciones.

**Concentra en uno o dos agentes.** La escalera es gruesa — entre escalones hay del 20 al 60% — así que un recorte repartido entre cinco agentes cae dentro del ruido para cada uno, mientras que ese mismo recorte sobre el agente de mayor share es un cambio real y medible en la señal siguiente.

**Cuando frenes a dos, dales escalones distintos.** La escalera está en minutos primos (1, 2, 3, 5, 7, 11, 13, 17, 23, 31, 41, 53, 60) a propósito: dos workers pausando en el mismo valor se resincronizan por construcción, y sus checkpoints caen juntos en una ráfaga de peticiones simultáneas. `scout-1=660` + `analista-1=780` (11 y 13 min) chocan mucho menos que ambos a 780.

---

## 4. CUÁNTO sobre ese agente — y el comando

Necesitas la **cadencia** `c` del agente: cuántas veces por minuto llega a un checkpoint (llamada a `jht-throttle`). Cuéntala desde el log:

```bash
python3 - <<'PY'
import collections, json, os, pathlib, time
p = pathlib.Path(os.environ.get("JHT_HOME", "/jht_home")) / "logs/throttle-events.jsonl"
cut = time.time() - 3600
c = collections.Counter()
for line in p.read_text(encoding="utf-8").splitlines():
    try:
        e = json.loads(line)
    except ValueError:
        continue
    if e.get("event") in ("checkpoint", "start") and e.get("ts_unix", 0) >= cut:
        c[e.get("agent")] += 1
for a, n in c.most_common():
    print(f"{a}: {n} chk/h -> cadencia {n/60:.2f}/min")
PY
```

Luego, para recortar la tasa de ese agente en una fracción `f_a`, partiendo de su throttle actual `T_now`:

```
f_a   = f_team / share_a           # todo el recorte del equipo soportado por este agente solo
ΔT    = (60 / c) × f_a / (1 − f_a) # segundos a AÑADIR a su throttle actual
T_new = T_now + ΔT                 # luego eliges tú el escalón más cercano
```

`60/c` son los segundos-por-checkpoint actuales del agente. El `f/(1−f)` no es adorno: la pausa también empuja más lejos el siguiente checkpoint, así que la cadencia baja a medida que frenas. Una estimación lineal (`ΔT = f × 60/c`) promete un recorte que no entrega.

Escalones, en segundos: `60 120 180 300 420 660 780 1020 1380 1860 2460 3180 3600`. `throttle-config.py` engancha al más cercano cualquier valor que le pases, así que **elige tú el escalón** — si no, no sabrás qué pediste realmente. Verifica con `dump`, que imprime los valores efectivos.

**¿Sin cadencia disponible?** Mueve exactamente **un escalón** y vuelve a medir en la señal siguiente. La escalera es lo bastante gruesa como para que un escalón sea siempre un paso significativo y acotado, y eso es claramente mejor que adivinar un número que no puedes comprobar.

### Ejemplo resuelto — repartir en vez de nivelar

```
[PACE-GUARD] AVANTI — CONSIGLIO, THROTTLE NON APPLICATO | usage=58% vs curva=40% (+18pt sul target 100% al reset) |
  reset fra 180 min | throttle worker ORA 300s → CONSIGLIATO 780s (+3 gradini) |
  worker: scout-1, analista-1, scorer-1, scrittore-1 |
  decidi tu e applica: python3 /app/shared/skills/throttle-config.py bulk-set scout-1=780 analista-1=780 scorer-1=780 scrittore-1=780
```

`agent-speed-table.py --since-min 60` dice: equipo `speed_pct_per_h = 21.4`, y

| agente | `pct_per_h` | `team_share_pct` | cadencia |
|---|---|---|---|
| scout-1 | 11.2 | 52% | 0.15/min |
| analista-1 | 6.0 | 28% | 0.12/min |
| scorer-1 | 3.0 | 14% | 0.10/min |
| scrittore-1 | 0.4 | 2% | 0.01/min |

**Cuánto:** `vel_needed = (100 − 58) / 3.0 = 14.0 %/h` → `f_team = (21.4 − 14.0) / 21.4 = 35%`, es decir **deben desaparecer 7.4 %/h**.

**Quién:** `db_query.py stats` dice `UNSCORED = 40` — tres horas de trabajo de scoring ya en el banco, así que más sourcing vale poco ahora. El Scout solo gasta más que toda la corrección.

**Cuánto sobre él:**
- `f_a = f_team / share_a = 35% / 52% ≈ 0.66` (lo mismo que `7.4 / 11.2`)
- `ΔT = (60 / 0.15) × 0.66/0.34 = 776s` → `T_new = 300 + 776 = 1076` → escalón más cercano **1020s (17 min)**
- efecto: tasa × `60/(60 + 0.15×720)` = 0.36 → **−7.2 %/h**, aterrizando en 14.2 %/h ≈ objetivo

```bash
python3 /app/shared/skills/throttle-config.py set scout-1 1020
python3 /app/shared/skills/throttle-config.py dump   # confirma los valores efectivos
```

Analista, Scorer y Escritor se quedan como están: los dos primeros son los que convierten esas 40 posiciones en puntuaciones, y el Escritor devolvería 0.4 %/h incluso parándolo del todo.

Ahora el nivelado que habría producido el `bulk-set` ya listo — todos a 780s: −6.1 del Scout, **−2.9 del Analista, −1.3 del Scorer**, −0.03 del Escritor = −10.3 %/h. El equipo aterriza en 11.0 %/h y llega al **91% en el reset en vez de al 100** — nueve puntos del presupuesto pagado por el usuario tirados — y llega con el rendimiento de scoring a la mitad. Misma señal, mismas herramientas, resultado opuesto.

### Dos agentes

Cuando un solo agente no puede soportar todo el recorte (o soportarlo mataría de hambre a la pipeline), reparte por share y mantén los escalones distintos:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set scout-1=660 analista-1=780
```

`bulk-set` es una única escritura atómica — prefiérela a dos `set`.

---

## 5. Soltar el freno (`INDIETRO` / `MARGINE`)

Infragastar también es una decisión de reparto — *a quién* le sueltas el freno decide qué compra el presupuesto extra.

1. Suelta **primero al rol cuello de botella** (`pipeline-triage` si no sabes cuál es). Soltar un Scout cuando la cola de scoring ya va por 40 compra más atraso, no más resultados.
2. Los workers nunca bajan de **5 min**, así que "poner el throttle a cero" no existe para ellos. Cuando el cuello de botella vuelve al suelo, la palanca para gastar más es **un worker más**, por etapas según C-02 — no una pausa más corta.
3. **Nunca sueltes a todos a la vez**: oscilas directo a un exceso en la señal siguiente.

---

## 6. Cuándo NO actuar

Una intervención cuesta un turno tuyo más 15-45 min a ciegas. Gástalo solo cuando la señal se lo merezca.

- `IN-PARI`, o `|deriva| ≤ 6pt` → **nada**. Esa banda es ruido de medida.
- **Una señal es ruido, dos consecutivas son una tendencia.** Un exceso aislado justo después de un spawn es el coste de arranque del worker nuevo.
- Tras cualquier cambio, **espera 2-3 señales (≈30-45 min)**. Un throttle solo hace efecto en el checkpoint *siguiente* del agente, así que un cambio hecho ahora apenas se ve en la medición siguiente. No apiles correcciones que aún no puedes ver.
- No añadas sondas `rate_budget live` solo para verificar un aviso recién llegado — las llamadas extra inflan el `velocity_smooth` de la Sentinella y le inducen órdenes equivocadas.
- **En los últimos ~15 min antes del reset, un usage alto es la diana acertada, no un exceso.** El 97% en el reset es centro pleno; frenar ahí solo garantiza dejar presupuesto sin gastar.
- Si tras 3 señales los mismos agentes siguen excediéndose, duplica sus duraciones (lineal → geométrico); si siguen infragastando, divídelas por dos.
- Un `[URG]` de la Sentinella gana a un `[PACE-GUARD]`: aplícalo primero, el aviso siguiente vuelve a medir.

---

## 7. Redes de seguridad — no son tu palanca

Existen por un incidente medido (la noche del 2026-07-15, una quema descontrolada ocurrida con ambas desactivadas) y **no forman parte de la decisión de pacing**:

- **El suelo de 5 min de los workers.** Scout, Analista, Scorer, Escritor, Crítico nunca corren por debajo de 300s, escribas lo que escribas. `set scout-1 60` sobre un worker es efectivamente 300s — `dump` muestra la verdad. No leas un valor enganchado al suelo como un cambio que hiciste tú.
- **El hard-stop diario.** Es lo último entre el equipo y un lockout que deja al usuario sin respuestas durante horas. Nunca lo desactivas para gastar más; si necesitas gastar más, la palanca es el paralelismo (§5).
- La exención por agente del suelo existe para un solo caso: una medida acotada en el tiempo de lo que produce **un único** worker sin pausas. Deliberadamente no es un interruptor global — **un agente cada vez, nunca todo el equipo**, y nunca como forma de ir más rápido.

---

## Anti-patrones

- ❌ Pegar el `bulk-set` con el que termina la línea `[PACE-GUARD]`. Ese número viene del worker más frenado y se ofrece a todos: aplicado en todas partes nivela al equipo con su miembro más lento y golpea a los roles que producen el resultado del usuario. El comando te ahorra teclear una vez que has decidido los valores — no los decide.
- ❌ Ralentizar a un agente parado para "ayudar". Un agente que no consume no devuelve nada cuando lo frenas — gastaste una escritura y un turno por cero puntos.
- ❌ Recortar sobre todos los agentes porque el veredicto era a nivel de equipo: golpeas a los roles baratos, que de todos modos no devolvían nada, antes que al caro.
- ❌ Tratar una señal aislada como estado permanente, o apilar una segunda corrección antes de que la primera sea medible.
- ❌ Frenar en `AVANTI` cuando la tasa ya volvió a su sitio — la deriva se está cerrando sola y cierras la ventana por debajo del objetivo.
- ❌ Perseguir el pacing con el throttle en `LOCKOUT-IMMINENTE`: ahí el freno está casi saturado y solo el roster mueve el resultado.
- ❌ Empujar números de throttle a los agentes vía tmux (`[INFO] sleep 40s`). Pasa siempre por `throttle-config.py` — los agentes leen el archivo de config, no parsean tu cuerpo de tmux. El tmux solo sirve para decirle a un agente que haga checkpoint *más o menos a menudo*, que es otro eje.

## Véase también

- `sentinel-orders` — las órdenes filtradas de la Sentinella, incluido `Throttle: N`, freeze y reanudación. Esa skill descodifica la orden; esta decide el reparto.
- `bridge-pacing` — cómo leer los números del tick de 15 min cuando ella te los reenvía.
- `throttle` — la referencia CLI de `throttle-config.py` y el archivo de estado por agente.
- `pipeline-triage` — qué rol es el cuello de botella, y cuándo la respuesta es "spawnea uno más" en lugar de "suelta un freno".
- `scaling-calc` — plan de roster + throttle cuando la respuesta es más workers, no una pausa distinta.
- `agent-emergency` — un quemador con cadencia ~0 que sigue consumiendo sin producir: ahí la palanca es el KILL, no otro escalón.
