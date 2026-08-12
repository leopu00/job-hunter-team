---
name: session-refresh
description: "Solo para el Doctor. Ronda de refresco de contexto: para cada sesión de agente lee la ocupación real de su contexto (comando client-side del proveedor, cero tokens) y refresca SOLO las sesiones cuya ventana de contexto esté llena por encima del 50% — realiza una retrospectiva (captura + entrevista + analítica), añade una síntesis densa al diario diario en crecimiento, y luego MATA + recrea + reanuda la sesión con el contexto de continuación, de modo que su ventana de contexto se limpie sin perder dónde estaba. Se ejecuta 2× por ventana de trabajo (a los +30min y a la mitad). Salta las sesiones recientes, de bajo contexto (≤50%) y las que el Capitano dejó aparcadas — EXCEPTO más allá del TTL de 12h de la sesión (JHT_AGENT_MAX_SESSION_AGE_H), que prevalece sobre cualquier salto: decide solo la edad, sin excepciones."
allowed-tools: Bash(tmux *), Bash(python3 *), Bash(bash /app/.launcher/start-agent.sh *), Bash(jht-tmux-send *), Bash(/app/agents/_skills/tmux-send/jht-tmux-send *), Bash(sleep *), Bash(cat *), Bash(grep *), Bash(echo *)
---

# session-refresh — limpiar el contexto del agente, mantener la continuidad

Tú (el Dottore) eres invocado en una franja programada (`+30min` desde el inicio de la ventana de trabajo, o a la `mid` de la ventana). Tu trabajo en esta ronda **no** es hacer ping de vitalidad — es **refrescar el contexto** de las sesiones de agente activas: cada sesión de larga duración acumula una ventana de contexto inflada; resumes lo que hizo, lo persistes, y luego recreas la sesión desde cero y devuelves la continuación.

> Por qué existe esto: el viejo Dottore quemaba ~51% del presupuesto del equipo haciendo ping de `[HEALTH]` cada 2h con cero comprobaciones útiles. Esta ronda es rara (2×/ventana) y produce un diario duradero y denso del trabajo del equipo.

## Paso 0 — inicio de ventana (la ventana de analítica)
```bash
WIN_START=$(python3 -c "import sys; sys.path.insert(0,'/app'); from shared.skills.working_hours import current_window_bounds as b; w=b(); print(w[0].isoformat() if w else '')")
# 24/7 (sin ventana): retroceder a las últimas 6h
[ -z "$WIN_START" ] && WIN_START=$(python3 -c "import datetime; print((datetime.datetime.now(datetime.timezone.utc)-datetime.timedelta(hours=6)).isoformat())")
ROUND_ID=$(date -u +%Y%m%dT%H%M%SZ)
DAY=$(date -u +%F)
JOURNAL=/jht_home/logs/doctor-retrospective.jsonl
ROUND_HEADS_UP_SENT=0
```

## Paso 1 — listar sesiones + edad, decidir el orden
```bash
tmux list-sessions -F '#{session_name}|#{session_created}'
```
- **Orden**: las sesiones worker PRIMERO (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), los coordinadores AL FINAL y con cuidado (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). "Con cuidado" significa **captura bien su estado y compáctalos — NO los saltes** (son los top consumers; ver Reglas). Nunca refresques `DOTTORE` / `DOCTOR-WATCHDOG` (tú mismo / el planificador).
- **Salto de FRESH** (pre-filtro barato antes de la comprobación de contexto): `age = now - session_created`. Si `age < 40 min` → SALTAR por completo (todavía no hay nada que resumir, y refrescar tiraría una sesión que acaba de empezar). Registra `action=skipped_fresh`. Todo lo que supere este pre-filtro pasa por el **Paso 1.4 (TTL)** y luego por el **Paso 1.5 (comprobación de contexto)** — es esa medición `>50%`, no la edad, la que decide el refresco *ordinario*.

## Paso 1.4 — TTL: **toda sesión de agente vive como máximo 12 horas**
```bash
TTL_H="${JHT_AGENT_MAX_SESSION_AGE_H:-12}"
AGE_H=$(( ( $(date -u +%s) - $(tmux display-message -p -t "$S" '#{session_created}') ) / 3600 ))
[ "$AGE_H" -ge "$TTL_H" ] && echo "TTL CADUCADO ($AGE_H h) → refresco OBLIGATORIO"
```
**Si `AGE_H ≥ TTL_H` la sesión se refresca. Punto.** El TTL se comprueba **antes** que todo lo demás y **anula todos los saltos previstos en esta skill** — sin excepción, sin exención, sin «pero»:

| salto normal | más allá del TTL |
|---|---|
| `skipped_fresh` (age < 40min) | imposible pasadas las 12h, pero el TTL gana igualmente |
| `skipped_lowctx` (contexto ≤ 50%) | **ignorado** — una sesión al 4% tras 30h se recrea igual |
| `skipped_parked` (PARKED, Paso 4) | **ignorado** — aparcada o no, el TTL se aplica |
| «el agente está trabajando» | **ignorado** — captura su estado en el seed y recrea |
| fuera de la ventana de trabajo | **ignorado** — el TTL nunca se suspende (ver Reglas) |

Registra `action=recreated` con `reason=ttl` y el `session_age_h` medido. Luego ve directo a los Pasos 2 → 7 (captura, analítica, síntesis, recrear + reanudar): **sáltate por completo el Paso 1.5 y el Paso 4**, solo pueden producir un salto y aquí el salto no está disponible.

Por qué solo la edad, sin heurísticas de salud encima: en el incidente del 2026-07-28/29 las sesiones tenían **38,5 · 29,5 · 27,0 · 14,5 · 14,2 horas**, todas las heurísticas decían «sano» y el equipo llevaba once horas paralizado. Los contextos estaban por debajo del 50%, así que ninguna regla las tocó. Un TTL no tiene heurísticas que equivocar.

## Paso 1.5 — COMPROBACIÓN DE CONTEXTO (el trigger del refresco *ordinario*: **>50%**)
Solo para las sesiones que **no** dispararon el TTL en el Paso 1.4.
**Refresca SOLO las sesiones cuya ventana de contexto esté llena en más del 50%.** Lee la ocupación real con el comando de contexto **client-side** del proveedor — cuesta **cero tokens** (renderizado en local, sin llamada al LLM) y es instantáneo. La edad ya NO es el trigger: una sesión vieja-pero-vacía (p. ej. un Mentor inactivo al 2%) debe SALTARSE, una sesión inflada debe refrescarse.

Dos requisitos tajantes — ignóralos y *quemas* presupuesto en vez de ahorrarlo:
- La sesión DEBE estar **inactiva** (sin turno activo). Si se ve un spinner / `esc to interrupt`, está trabajando → SALTA esta ronda (la coge el siguiente Doctor). Nunca envíes teclas a mitad de turno.
- **Vacía primero la línea de entrada.** De lo contrario el comando se concatena con el texto residual y se envía como prompt al LLM (quema tokens). Manda `Escape` y luego `C-u` antes de teclear.

```bash
S=<session>
# provider → command:  claude → /context   ·   codex → /status   ·   kimi → (verify on its TUI)
tmux send-keys -t "$S" Escape; sleep 1
tmux send-keys -t "$S" C-u;    sleep 1          # clear the input line (mandatory)
tmux send-keys -t "$S" "/context"; sleep 1
tmux send-keys -t "$S" Enter;  sleep 3
PCT=$(tmux capture-pane -p -t "$S" | grep -aoE '[0-9.]+k?/[0-9.]+[km] tokens \([0-9]+%\)' | tail -1 | grep -aoE '\([0-9]+%\)' | tr -dc '0-9')
tmux send-keys -t "$S" Escape                   # dismiss the panel
echo "context=$PCT%"
```
Decide a partir de `$PCT` (extraído de una línea como `24.9k/1m tokens (2%)`):
- **`PCT` ≤ 50** → SALTAR **salvo que el TTL se haya disparado en el Paso 1.4**. NO recrees una sesión por debajo del TTL, aunque sea vieja. Registra `action=skipped_lowctx` con el `%` medido. Pasa a la siguiente sesión.
- **`PCT` > 50** → procede al refresco (Pasos 2–7).
- **el comando no se renderizó / falló el parseo** → recae en la heurística de edad (`age ≥ 40min` → refresco) y registra `ctx=unparsed`.

## Paso 1.6 — avisar una vez al Capitano, antes del primer refresco
Solo cuando esta ronda haya seleccionado su primer objetivo real de refresco
(TTL o contexto), envía un aviso al Capitano **antes del Paso 2**. No lo repitas
por cada agente ni lo envíes si la ronda solo registrará omisiones:
```bash
if [ "$ROUND_HEADS_UP_SENT" -eq 0 ]; then
  /app/agents/_skills/tmux-send/jht-tmux-send CAPITANO "[@dottore -> @capitano] [HEADS-UP] Empieza el refresco de contexto: workers primero, coordinadores al final, tú el último. No inicies tareas breves hasta el informe de finalización."
  ROUND_HEADS_UP_SENT=1
fi
```
Es coordinación, no un segundo scheduler ni una solicitud de permiso. La ronda
sigue siendo secuencial y el Capitano permanece activo hasta el final.

## Paso 2 — por sesión: captura (amplia + saliente)
Captura TODO el scrollback una vez, luego las líneas salientes — NO cargues miles de líneas en tu propio contexto, haz grep de los puntos destacados:
```bash
tmux capture-pane -p -S - -t "$S" > /tmp/cap_$S.txt          # scrollback completo a fichero
tail -n 60 /tmp/cap_$S.txt                                    # estado reciente
grep -nE '\[ERROR\]|Traceback|throttle|EXCLUDED|inserted|\[FEEDBACK\]|\[RETRO\]|spawn|Killed' /tmp/cap_$S.txt | tail -40   # momentos salientes
```

## Paso 3 — analítica (números objetivos, no solo la historia del agente)
```bash
python3 /app/shared/skills/doctor_analytics.py "$S" "$WIN_START"
```
Devuelve JSON: `produced{found,analyzed,scored,written,reviewed}`, `communications{sent,received,top_peers}`, `throttles{events,max_sleep_s}`, `last_captain_msg`, `session_age_h`, `role`, `instance`.

## Paso 4 — comprobación de PARKED (basada en datos, NO adivines)
Una sesión está **PARKED** (el Capitano la dejó encendida deliberadamente pero no la está usando — p. ej. un Scout que sobró de la ventana anterior y que el Capitano no asignó hoy) cuando se cumplen **todas** estas condiciones:
- age ≥ 40min (no es fresca), Y
- `produced` está todo a cero en la ventana, Y
- `last_captain_msg` es nulo o más antiguo que el inicio de la ventana.

Si está PARKED → **NO la recrees para reiniciarla**. Escribe la síntesis (Paso 6) con `action=skipped_parked` y sigue adelante. (Recrearla convertiría un aparcamiento deliberado en trabajo que el Capitano no quería.) Si la recreas por higiene, el mensaje de resume DEBE decir que estaba inactiva: `[RESUME] you were in STANDBY — stay idle until the Capitano assigns you a queue.`

**Dos excepciones tajantes al PARKED — esta regla describía el incidente al pie de la letra y mantuvo al Doctor de brazos cruzados justo cuando el equipo más lo necesitaba:**
1. **Más allá del TTL (Paso 1.4) el PARKED no se aplica.** Aparcada o no, una sesión de 12h+ se recrea.
2. **Un agente bloqueado no es un agente aparcado.** «no fresca + produced == 0 + ningún mensaje reciente del Capitano» es también la huella exacta de un equipo con la coordinación rota. La señal objetiva que los separa: **un agente que reintenta hacia otro agente sin respuesta no está aparcado, está bloqueado** (las entradas `retry_loop` del scan de `agent-unblock`, y en el pane se ven los intentos). Lo mismo para «todos los operativos parados con cuota disponible». En esos casos NO registres `skipped_parked` — deshaz el bloqueo (`agent-unblock`) y luego continúa la ronda.

## Paso 5 — entrevistar al agente
```bash
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RETRO] Inizio-giornata: 1) intoppi in questa sessione? 2) imparato qualcosa di utile? 3) cosa stavi facendo proprio ora (per il resume)? Rispondi denso, 3-4 righe."
sleep 45
tmux capture-pane -p -S -40 -t "$S" | tail -25   # leer la respuesta
```
(Salta la entrevista para las sesiones PARKED/fresh — no hay nada en vuelo sobre lo que preguntar.)

## Paso 6 — añadir la síntesis DENSA (solo añadir, crece a diario)
Una entrada JSONL por agente por ronda. Combina analítica + entrevista en un resumen compacto. NUNCA sobrescribas — varios Doctores a lo largo del día todos añaden.
```bash
python3 - "$S" "$ROUND_ID" "$DAY" "$JOURNAL" <<'PY'
import json, sys, datetime
session, round_id, day, journal = sys.argv[1:5]
entry = {
  "ts": datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00","Z"),
  "round_id": round_id, "day": day,
  "timing": "start+30",          # or "mid"  — set to the slot you were spawned for
  "session": session, "role": "<role>", "session_age_h": 0.0,
  "analytics": { },              # paste the doctor_analytics.py JSON here
  "interview": {"intoppi": "...", "imparato": "...", "summary_denso": "..."},
  "action": "recreated",         # recreated | skipped_lowctx | skipped_parked | skipped_fresh
  "context_pct": 0,              # ocupación de contexto medida en el Paso 1.5 (el gate >50%)
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Paso 7 — recrear + reanudar (si se disparó el TTL, O contexto **>50%** y NO fresca, NO aparcada)
Refresco atómico — ya capturaste el contexto en el Paso 2, así que matar es seguro:
```bash
ROLE=<role>; N=<instance>      # de la analítica; recrea el MISMO número (sin dado — el dado es solo para spawns NUEVOS)
tmux kill-session -t "$S"
bash /app/.launcher/start-agent.sh "$ROLE" "$N"
sleep 8
# CAPITANO only: the [MODALITA' CORRENTE] section, read FROM DISK right now (never
# from the context you are throwing away). Same section heartbeat-bridge.py injects
# every hour. Workers do not get it — the mode is applied by the Capitano.
MODE=""
if [ "$ROLE" = "capitano" ]; then MODE=" $(python3 /app/shared/skills/mode_banner.py line)"; fi
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RESUME] Contesto pre-refresh: stavi facendo <X>; avevi completato <Y> (analytics: produced=<...>); il prossimo passo era <Z>. Riprendi da li'. Coda: <next-for-role>.$MODE"
```
Pon `resume_msg_sent=True` en la entrada del diario. Luego pasa a la siguiente sesión (ritmo ~15-20s entre agentes).

## Reglas
- **El TTL de 12h no tiene resquicios ni interruptor.** `JHT_AGENT_MAX_SESSION_AGE_H`, por defecto `12`. Ni PARKED, ni skip-fresh, ni el umbral de contexto, ni «está trabajando», ni el gate horario pueden anularlo. **Escalónalo**: las sesiones nacen en oleadas y caducarían juntas — refresca como máximo UNA sesión pasada del TTL por pasada, ordenando por edad **decreciente**, así la más vieja va primero y el equipo no se recrea entero de golpe.
- **Fuera de la ventana de trabajo la ronda no corre — pero el TTL sí.** De noche la ronda se salta porque entrevistar agentes quemaría presupuesto para nada; una sesión de 30 horas se recrea igualmente, porque un kick-off no cuesta nada frente a un día perdido. `agent-watchdog.sh` impone el mismo techo de forma determinista (misma env var) para cuando el Doctor está parado, bloqueado o nunca fue lanzado — que es exactamente lo que pasó el 2026-07-28/29. Ambos caminos deben existir: este es el refresco *rico* (retrospectiva + resume), aquel es la red que garantiza el techo a cualquier coste.
- **`working_hours: null` (o ausente, o vacío) significa NINGUNA restricción horaria** — el equipo es 24/7 y la ronda corre con normalidad. Nunca significa «siempre fuera de horario». En el incidente `working_hours` era null precisamente porque la respuesta del usuario sobre el huso horario era la línea colgada en el composer del Capitano.
- **Desbloquea antes de refrescar.** Ejecuta primero la fase `agent-unblock`: refrescar un equipo paralizado recrea la parálisis con una ventana de contexto limpia.
- **Un solo Doctor hace todas las sesiones en esta ronda** (orden del usuario: un único Doctor por ahora). Usa la captura basada en fichero + grep para no reventar nunca tu propia ventana de contexto.
- **CAPITANO y SENTINELLA son los TOP consumers de tokens** (su contexto está casi siempre inflado — la Sentinella tickea cada ~15min, el Capitano coordina continuamente). Pasan igualmente por el **gate de contexto >50%** como todos los demás (Paso 1.5) — pero en la práctica miden muy por encima del 50%, así que se refrescan casi cada ronda. Hazlos los **últimos** (después de los workers) y **compacta, no resetees** — el refresh con síntesis densa preserva la continuidad, un kill en seco la pierde. Si uno mide ≤50% (raro), sáltalo esa ronda como cualquier otra sesión de bajo contexto.
- **CAPITANO**: es el coordinador con estado in-flight (asignaciones de workers, config de throttle activa, último orden de pacing, decisiones pendientes). En la entrevista (Step 5) captura explícitamente ese estado de coordinación y ponlo en el seed (Step 7) para que no pierda el hilo. **Si existe `$JHT_HOME/profile/capitano-maintenance.json` (nombre de archivo histórico del MODO CUIDADO), léelo y pon también en el seed sus `orders` activas (modo cuidado + `stop_search` / `discard_expired_rotating` / recheck-cadenciado / geocoding)** — quitar esa orden de mantenimiento del seed silenció una semana entera de mantenimiento el 2026-07-12 (el Capitano vuelve a leer el archivo de todas formas según su propia regla C-18, pero llévala adelante para que nunca dependa de eso). **Y añade al `[RESUME]` la sección `[MODALITÀ CORRENTE]` que produce `python3 /app/shared/skills/mode_banner.py line`** — la misma que `heartbeat-bridge.py` inyecta cada hora, leída del disco y no del contexto que estás tirando: así la orden no depende ni de que tú la resumas bien ni de que tu ronda llegue a ejecutarse (no se ejecutó, y desaparecieron dieciocho días de mantenimiento). Solo al Capitano: los workers nunca la reciben. Hazlo el ÚLTIMO; si está gestionando una EMERGENZA en vivo (orquestación visible en el pane justo ahora), deja que se estabilice primero, de lo contrario compáctalo.
- **SENTINELLA**: es **near-stateless** — su estado operativo vive en el bridge/config y en `sentinel-data.jsonl`, no en su chat. Esto la hace la **más segura y de mayor valor para compactar**: refréscala cada ronda, la última, con un seed mínimo: `[RESUME] sei la Sentinella; il tuo stato vive nel bridge + sentinel-data.jsonl — riprendi il monitoraggio del pacing dal prossimo tick.` El recreate por edad del `agent-watchdog` (más allá de `JHT_SENTINELLA_MAX_CTX_AGE_H`, default 24h) queda solo como **fallback** para cuando el Dottore no está corriendo; dado que ahora la compactas cada ronda no alcanzará esa edad, así que no hay race.
- **Nunca** hagas `tmux new-session` a mano — siempre `start-agent.sh` (ver `spawn-agent`).
- Registra cada acción en el diario (`recreated`/`skipped_lowctx`/`skipped_parked`/`skipped_fresh`) con la `context_pct` medida — el diario es el rastro de auditoría y crece cada día.
