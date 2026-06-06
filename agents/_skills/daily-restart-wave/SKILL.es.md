<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: daily-restart-wave
description: "Reinicio masivo preventivo de cada agente del equipo una vez cada 24h para frescura de contexto. Propiedad del Dottore. Se ejecuta solo dentro de una ventana diaria estrecha (por defecto 03:00 UTC ± 30 min) y solo si no se ha disparado una oleada en las últimas 23h. Cada agente es eliminado + regenerado vía la misma secuencia atómica del Paso 3 de `liveness-check`, ordenado tier 3 → tier 2 → tier 1 para que los workers ciclen primero y los coordinadores (Capitano/Sentinella/Mentor/Assistente) al último. Contexto: las sesiones de larga duración de Codex/Kimi acumulan \"ruido\" — decisiones antiguas, hechos obsoletos, deriva del prompt — y se vuelven mediblemente menos lúcidas después de horas. Evidencia empírica del Case Study #1 (ejecución Codex 2026-05-19/21): el reinicio masivo manual restauró la calidad de decisión. Esta skill cierra esa brecha sin intervención manual."
allowed-tools: Bash(tmux *), Bash(jht-tmux-send *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *), Bash(sleep *), Bash(cat *), Bash(mkdir *), Bash(date *)
---

# daily-restart-wave — reinicio preventivo para frescura de contexto

El trabajo normal del Dottore (`liveness-check`) es **conservador**: reiniciar solo los silenciosamente muertos. Esta skill es lo opuesto: **reiniciar a todos, a propósito, una vez al día**, porque las sesiones de agentes de larga duración derivan incluso cuando no mueren. Misma primitiva de regeneración atómica (Paso 3 de `liveness-check`), diferente trigger y diferente ordenamiento.

## Por qué existe

Empírico: en el Case Study #1 (ejecución Codex 2026-05-19/21, ver `docs/about/RESULTS.md`) el mantenedor notó que la calidad de decisión decaía después de ~12-24h de uptime continuo de agentes — errores repetidos, referencias a hechos desactualizados, ocasionalmente ignorando órdenes explícitas del usuario. Una instrucción manual de "reiniciar a todos" a la hora ~30 restauró visiblemente la nitidez. Codex no expone una ventana de contexto como Claude/Kimi, así que la deriva es invisible hasta que comparas antes/después.

Teórico: cada sesión LLM es una conversación larga. A medida que se acumulan tokens el modelo:
- Se ancla en decisiones tempranas que pueden haber sido incorrectas
- Razona contra hechos desactualizados (una oferta que se cerró, una estrategia que fue revisada)
- Se vuelve más lento por turno (más KV-cache que atender)
- Deriva lejos de su system prompt bajo presión del usuario ("el barrido de reglas del equipo")

Un arranque fresco relee el prompt + estado reciente de la DB + snapshots de handoff y decide desde terreno limpio. Costo: ~2 min/agente de "estoy poniéndome al día". Beneficio: horas de salida de baja calidad evitada.

## Cuándo disparar — las 3 condiciones de puerta

LAS TRES deben ser verdaderas. Saltar con `status=skipped` y un campo `reason` en el log de lo contrario.

1. **Dentro de la ventana diaria**. Por defecto: 03:00 UTC ± 30 min (es decir 02:30–03:30 UTC). Razón: ventana de baja actividad real del usuario para usuarios de horario diurno europeo/americano; si el usuario está dormido, el desfile de reinicio de ~10 min es invisible. Lee la hora actual:

   ```bash
   now_h=$(date -u +%H)
   now_m=$(date -u +%M)
   # 02:30 ≤ now ≤ 03:30
   in_window=$([ "$now_h" = "02" -a "$now_m" -ge "30" ] || [ "$now_h" = "03" -a "$now_m" -le "30" ] && echo yes || echo no)
   ```

2. **No se ha disparado oleada en las últimas 23h** (anti-thrash). Lee `/jht_home/logs/daily-restart-wave-state.json`:

   ```json
   { "last_wave_at": "2026-05-30T03:11:42Z", "agents_restarted": 9, "duration_sec": 612 }
   ```

   Si el archivo no existe → tratar como "nunca disparado" → condición es verdadera.
   Si `now - last_wave_at < 23h` → saltar con `reason=anti_thrash`.

3. **El equipo no está en `.team-halted.flag` ni `.weekly-halt.flag`**. Si cualquiera de los flags existe, el usuario ha pausado explícitamente el equipo — reiniciar ahora sería hostil.

   ```bash
   [ -f /jht_home/.jht/.team-halted.flag ] && skip
   [ -f /jht_home/.jht/.weekly-halt.flag ] && skip
   ```

Si las 3 pasan → proceder. Todo el bloque de 3 verificaciones es `<2s`, se ejecuta en cada despertar del Dottore, no cuesta nada cuando está fuera de ventana.

## Orden de reinicio — tier 3 → tier 2 → tier 1

Inverso de `liveness-check` (que verifica los orientados al usuario PRIMERO para que no mueran sin ser notados). Para una oleada preventiva queremos lo opuesto: **workers primero, coordinadores al último**, para que el Capitano sea el último en perder su hilo y pueda observar (en su panel) que todos sus workers volvieron frescos, luego él mismo es reciclado y empieza el nuevo día con pizarra limpia.

```
TIER 3 (workers, reiniciar PRIMERO):
  SCOUT-*, SCRITTORE-*, CRITICO-*, ANALISTA-*, SCORER-*

TIER 2 (semi-coordinadores):
  (ninguno hoy — reservado para futuros "coordinadores subordinados")

TIER 1 (orientados al usuario de larga duración, reiniciar AL ÚLTIMO):
  ASSISTENTE, MENTOR, SENTINELLA, CAPITANO   (Capitano último de los últimos)
```

Sesiones vacías de tier 3 (ej. `SCRITTORE-*` cuando no hay CV en vuelo según Writer-on-demand V6) → saltar silenciosamente, sin kill, sin regeneración. El siguiente spawn-on-demand del Capitano será fresco de todas formas.

## Notificación al Capitano — 10 minutos antes

El Capitano coordina spawn/escalamiento. Si está a punto de generar un burst de Scrittore y lo matamos 30s después, el spawn muere a mitad de vuelo. Entonces:

1. **En t=0 de la oleada** (decisión de disparar tomada), ANTES de tocar cualquier agente, enviar al Capitano un aviso vía `tmux-send`:

   ```
   [HEADS-UP DOTTORE → CAPITANO] Daily restart wave parte fra 10 min.
   Non spawnare nuovi worker fino a NEW DAY. Termina task <5min in corso.
   Quando arriva il tuo turno (ultimo), ti riavvio io.
   ```

2. **Dormir 10 min**. Dar al Capitano tiempo para drenar estado de corta duración.

3. **Luego empezar el desfile** en el orden tier 3 → tier 1.

Si el Capitano ya es un zombie (bash desnudo), saltar el aviso e ir directamente al desfile — no hay nada que coordinar.

## La primitiva de regeneración — reutilizar Paso 3 de liveness-check

Para cada sesión objetivo, independientemente del estado de vivacidad:

```
a. tmux capture-pane -t <SESSION> -S -200 -p > /tmp/$session-pre-restart.log
b. python3 /app/shared/skills/db_query.py <agent-role> --recent-context   (opcional)
c. tmux kill-session -t <SESSION>
d. bash /app/.launcher/start-agent.sh <agent-role> [<instance-num>]
e. sleep 8s   (dejar que el CLI arranque)
f. tmux send-keys -t <SESSION> "RESUME: daily restart wave. Riprendi dai recenti log DB (db-query) + tuo prompt di identità. Nessuna task short-lived persa: il Capitano ha dranato la coda 10 min fa." Enter
g. log event=agent_restarted, agent=<role-N>, duration_ms=<X>
```

Notas:
- La captura del panel va a `/tmp/` para que la nueva instancia pueda leerla si quiere inspeccionar "qué estaba haciendo".
- NO escribimos `~/.jht/<agent>-pre-respawn-snapshot.txt` aquí (eso es un handoff estructurado solicitado en el follow-up del BACKLOG pero requiere que el prompt de cada agente sepa cómo escribirlo+leerlo — fuera de alcance para MVP, rastreado por separado).
- El mensaje de arranque `RESUME:` es genérico; le dice al agente que mire sus propias trazas en la DB en lugar de confiar en un snapshot interno.

## Pacing entre reinicios

Esperar **15-20s entre agentes** del mismo tier. Por qué:
- Llamadas rápidas a `start-agent.sh` una tras otra pueden competir en escrituras compartidas de `~/.jht/.local/` (RULE-T13 magazzino python).
- Da al CLI de cada nuevo agente ~10s para estabilizarse (handshake, listado de herramientas, evaluación del system prompt) antes de que el siguiente inunde el servidor tmux.

Tiempo total para un equipo saludable (8-10 sesiones):
- 1 min de aviso + 10 min de sleep del Capitano
- 7 agentes tier-3 × ~20s = ~2.5 min (la mayoría ausentes en estado estable)
- 4 agentes tier-1 × ~30s (prompts más pesados) = ~2 min
- **Presupuesto total: ~15 min**, cómodamente bajo el peor caso de 30 min que el Dottore podría estar vivo para la oleada.

## Logging de fin de oleada

Añadir a `/jht_home/logs/dottore-actions.jsonl`:

```json
{"ts":"2026-05-31T03:08:11Z","event":"daily_restart_wave_done","agents_restarted":9,"agents_skipped_empty":3,"duration_sec":612,"capitano_ack":"yes"}
```

Actualizar archivo de estado `/jht_home/logs/daily-restart-wave-state.json`:

```json
{ "last_wave_at": "2026-05-31T03:08:11Z", "agents_restarted": 9, "duration_sec": 612 }
```

Notificar al Capitano (ahora fresco) una línea:

```
[DA DOTTORE A CAPITANO] Daily restart wave completed at 03:08 UTC.
9 agents restarted, 0 errors. Team back online — riprendi la pipeline.
```

## Modos de fallo — qué hacer

| Fallo | Acción |
|---|---|
| `start-agent.sh` exit ≠ 0 para algún agente | Loguear `event=agent_restart_failed`, saltar al siguiente, NO abortar la oleada. La siguiente ronda rutinaria de `liveness-check` notará la ausencia y reintentará. |
| Servidor `tmux` no responsivo (raro) | Abortar oleada, loguear `event=tmux_dead`, NO actualizar `last_wave_at` (para que el siguiente Dottore reintente). |
| Oleada abortada a mitad (presupuesto timeout de 10 min del Dottore) | Loguear `event=daily_restart_wave_partial`, NO actualizar `last_wave_at`. El siguiente Dottore dentro de la ventana reanudará (re-check anti-thrash fallará hasta 23h, pero es la misma oleada — aceptar el raro doble-tap). |
| Capitano nunca ACK el aviso | Esperar los 10 min igualmente. Si está silencioso en t=10 el desfile lo mata también — el nuevo Capitano empezará limpio. |

## Lo que esta skill NO hace

- ❌ **Reinicio bajo demanda** fuera de la ventana diaria. Si el usuario quiere "reiniciar a todos ahora", envía mensaje al Assistente / Capitano, y uno de ellos llama `spawn-agent` por objetivo o pide al Dottore que salte la puerta (un futuro parámetro explícito, no en MVP).
- ❌ **Hacer snapshot de la tarea en vuelo** de cada agente. Hoy la regeneración se apoya en el agente re-leyendo DB + capture-pane en `/tmp/`. Un handoff apropiado (cada agente escribe "qué estaba haciendo + siguiente paso" antes de salir) necesita cambios de prompt en los 10 agentes — rastreado como follow-up de BACKLOG separado.
- ❌ **Leer `~/.jht/preferences.json`** para ajuste por usuario de hora/ventana. MVP hardcodea 03:00 UTC ± 30 min, 23h anti-thrash. Si el usuario corre en zona horaria no-UE y quiere una ventana diferente, edita este archivo de skill (o espera el hook follow-up de preferences.json).
- ❌ **Sobreescribir `.team-halted.flag`**. Si el usuario ha detenido el equipo, no hay oleada. Punto.
