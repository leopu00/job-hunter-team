---
name: session-refresh
description: "Solo para el Doctor. Ronda de refresco de contexto: para cada sesión de agente realiza una retrospectiva (edad + captura amplia + entrevista + analítica), añade una síntesis densa al diario diario en crecimiento, y luego MATA + recrea + reanuda la sesión con el contexto de continuación — de modo que la ventana de contexto del agente se limpie sin perder dónde estaba. Se ejecuta 2× por ventana de trabajo (a los +30min y a la mitad). Salta las sesiones recientes y nunca reinicia una sesión que el Capitano dejó aparcada deliberadamente."
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
```

## Paso 1 — listar sesiones + edad, decidir el orden
```bash
tmux list-sessions -F '#{session_name}|#{session_created}'
```
- **Orden**: las sesiones worker PRIMERO (`SCOUT-N · ANALISTA-N · SCORER-N · SCRITTORE-N · CRITICO-S*`), los coordinadores AL FINAL y con cuidado (`ASSISTENTE · MENTOR · SENTINELLA · CAPITANO`). "Con cuidado" significa **captura bien su estado y compáctalos — NO los saltes** (son los top consumers; ver Reglas). Nunca refresques `DOTTORE` / `DOCTOR-WATCHDOG` (tú mismo / el planificador).
- **Salto de FRESH**: `age = now - session_created`. Si `age < 40 min` → SALTAR por completo (todavía no hay nada que resumir, y refrescar tiraría una sesión que acaba de empezar). Registra `action=skipped_fresh`.

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
  "action": "recreated",         # recreated | skipped_parked | skipped_fresh
  "resume_msg_sent": False,
}
with open(journal, "a") as f:
    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
print("appended", session)
PY
```

## Paso 7 — recrear + reanudar (solo si NO es fresca y NO está aparcada)
Refresco atómico — ya capturaste el contexto en el Paso 2, así que matar es seguro:
```bash
ROLE=<role>; N=<instance>      # de la analítica; recrea el MISMO número (sin dado — el dado es solo para spawns NUEVOS)
tmux kill-session -t "$S"
bash /app/.launcher/start-agent.sh "$ROLE" "$N"
sleep 8
/app/agents/_skills/tmux-send/jht-tmux-send "$S" "[@dottore -> @${s_lower}] [RESUME] Contesto pre-refresh: stavi facendo <X>; avevi completato <Y> (analytics: produced=<...>); il prossimo passo era <Z>. Riprendi da li'. Coda: <next-for-role>."
```
Pon `resume_msg_sent=True` en la entrada del diario. Luego pasa a la siguiente sesión (ritmo ~15-20s entre agentes).

## Reglas
- **Un solo Doctor hace todas las sesiones en esta ronda** (orden del usuario: un único Doctor por ahora). Usa la captura basada en fichero + grep para no reventar nunca tu propia ventana de contexto.
- **CAPITANO y SENTINELLA son los TOP consumers de tokens** (su contexto está casi siempre inflado — la Sentinella tickea cada ~15min, el Capitano coordina continuamente). NO están exentos: **compáctalos cada ronda** (los últimos, después de los workers). **Compacta, no resetees** — el refresh con síntesis densa preserva la continuidad, un kill en seco la pierde.
- **CAPITANO**: es el coordinador con estado in-flight (asignaciones de workers, config de throttle activa, último orden de pacing, decisiones pendientes). En la entrevista (Step 5) captura explícitamente ese estado de coordinación y ponlo en el seed (Step 7) para que no pierda el hilo. Hazlo el ÚLTIMO; si está gestionando una EMERGENZA en vivo (orquestación visible en el pane justo ahora), deja que se estabilice primero, de lo contrario compáctalo.
- **SENTINELLA**: es **near-stateless** — su estado operativo vive en el bridge/config y en `sentinel-data.jsonl`, no en su chat. Esto la hace la **más segura y de mayor valor para compactar**: refréscala cada ronda, la última, con un seed mínimo: `[RESUME] sei la Sentinella; il tuo stato vive nel bridge + sentinel-data.jsonl — riprendi il monitoraggio del pacing dal prossimo tick.` El recreate por edad del `agent-watchdog` (más allá de `JHT_SENTINELLA_MAX_CTX_AGE_H`, default 24h) queda solo como **fallback** para cuando el Dottore no está corriendo; dado que ahora la compactas cada ronda no alcanzará esa edad, así que no hay race.
- **Nunca** hagas `tmux new-session` a mano — siempre `start-agent.sh` (ver `spawn-agent`).
- Registra cada acción en el diario (`recreated`/`skipped_parked`/`skipped_fresh`) — el diario es el rastro de auditoría y crece cada día.
