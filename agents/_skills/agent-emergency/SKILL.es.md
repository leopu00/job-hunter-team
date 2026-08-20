<!-- @translation: es, ai-translated 2026-07-30 -->
---
name: agent-emergency
description: "Capitano — gestiona un agente del que se sospecha que está ATASCADO EN UN BUCLE ACTIVO (vivo y generando turnos, pero repitiendo el mismo ciclo sin producir nada: ping-loop de ACK con otro agente, la misma acción/consulta que no lleva a ninguna parte). Cubre la grieta entre C-08 (muerto/silencioso → Dottore) y C-12 (quemando a cadencia 0.00/min → kill). Escalera graduada, primero el Dottore → kill+respawn limpio solo si persiste o quema presupuesto. Detección determinista (diff de capture-pane + 0 progreso en la DB), la decisión de escalado queda en manos del LLM."
allowed-tools: Bash(tmux *), Bash(jht-agent-contain *), Bash(jht-tmux-send *), Bash(/app/.launcher/spawn-doctor.sh *), Bash(bash /app/.launcher/start-agent.sh *), Bash(python3 /app/shared/skills/db_query.py *)
---

# agent-emergency — agente atascado en un bucle activo

## Por qué existe (la grieta entre C-08 y C-12)

Las señales existentes cubren dos casos:
- **C-08** — un agente **muerto / silencioso** (pane = bash, sin turnos) → diagnóstico del
  **Dottore**.
- **C-12** — un agente **quemando con `cadenza 0.00/min`, cero checkpoints** → candidato a kill.

Falta el tercero: **un agente que está VIVO y ACTIVO y REPITE el mismo ciclo sin producir nada**.
Genera turnos (así que NO está "muerto" y NO tiene `cadenza 0.00`), pero no avanza. Ejemplos reales:
- dos sesiones rebotándose **ACK** eternamente (ping-loop de coordinación);
- un worker repitiendo la **misma consulta / misma acción** sin efecto alguno;
- un agente reprocesando una y otra vez el mismo mensaje no entregado.

Antes era invisible → el Capitano nunca intervenía. Esta skill lo hace detectable y manejable.

## Cuándo usarla

**Ante una SOSPECHA**, no de forma generalizada ni en cada tick. Arranca este procedimiento cuando
notes una de estas pistas (normalmente mientras haces otra cosa): un agente que lleva un rato
"trabajando" pero cuya cola no se acorta / ninguna posición nueva cambia de estado; o ves el mismo
intercambio repetirse en el chat/pane.

## 1. Detección DETERMINISTA (nada de estimar a ojo)

Confirma el bucle con dos comprobaciones baratas — **ningún mensaje al agente** (no lo molestes,
esto es pull Tier-2):

```bash
# (a) REPETICIÓN — ¿el pane muestra el mismo intercambio/salida N veces?
#     Dos capturas espaciadas: si el contenido "nuevo" es idéntico → se está repitiendo.
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_1.txt
sleep 20
tmux capture-pane -t <SESSION> -p -S -60 > /tmp/ae_2.txt
diff /tmp/ae_1.txt /tmp/ae_2.txt        # diferencia de "trabajo real" escasa o nula = bucle sospechoso

# (b) 0 PROGRESO EN LA DB — ¿el agente está "activo" pero no mueve nada en la DB?
#     Si está disponible, el helper de observabilidad por agente (reutiliza
#     position_state_transitions): 0 transiciones recientes para este agente = sin salida.
python3 /app/shared/skills/db_query.py recent-activity   # by_agent: 0 para la sesión = sin salida
#     Fallback genérico: la cola aguas arriba del agente NO se acorta entre dos comprobaciones
#     (p. ej. next-for-analista sin cambios mientras ANALISTA-N "está trabajando").
```

**Veredicto BUCLE** = (a) repetición **Y** (b) 0 progreso, a lo largo de ≥ 2-3 observaciones. Si en
cambio el pane muestra `Working… / esc to interrupt` con contenido que sigue cambiando, es una
**tarea larga que está VIVA** (C-08 bis): eso NO es un bucle, déjala en paz.

## 2. Escalera graduada — primero el Dottore

### Peldaño 1 — ronda extraordinaria del Dottore (PRIMERA intervención)

Un refresco de contexto a menudo rompe el bucle **sin perder el estado**. Usa la skill
`spawn-doctor`:

```bash
bash /app/.launcher/spawn-doctor.sh
sleep 10
jht-tmux-send DOTTORE \
  "[@$MY_ID -> @dottore] [REQ] Ronda dirigida: <SESSION> parece atascada en un BUCLE activo (repite <qué>, 0 progreso en la DB durante N ticks). Diagnostícala y, si se confirma, refresca/repara la sesión. Responde con [RES]."
# Espera el [RES] del Dottore — nada de polling.
```

### Contención de seguridad — NO es un reinicio

Si la sesión debe permanecer apagada, nunca uses `tmux kill-session` directamente:

```bash
jht-agent-contain <SESSION> --by "$JHT_AGENT_NAME" --reason "<motivo de seguridad observado>"
```

El comando captura primero el panel, guarda el estado persistente `contained` y
solo entonces detiene la sesión exacta. Solo un release explícito lo revoca:

```bash
jht-agent-contain <SESSION> --release --by "$JHT_AGENT_NAME" --reason "<por qué ahora es seguro>"
```

### Peldaño 2 — Kill (+ respawn) — SOLO si hace falta

Killa **solo si**: el bucle **persiste después del Dottore**, *o* está **quemando presupuesto en
serio** (tasa alta + 0 salida durante ≥ N ticks y no hay tiempo para un diagnóstico).

⚠️ **SALVAGUARDA contra el doble spawn con el watchdog.** `agent-watchdog.sh` hace respawn
automático (≤30s) **solo de los 3 agentes core**: `ASSISTENTE`, `CAPITANO`, `MENTOR`. NO cubre a los
workers. Así que el respawn depende del objetivo:

- **Objetivo = agente CORE (ASSISTENTE / MENTOR)** → **SOLO kill**. El watchdog lo detecta y **lo
  vuelve a lanzar limpio por su cuenta** (`jht team start <role>`, idempotente, estado fresco). **NO**
  ejecutes tú además `start-agent.sh` → sería un doble spawn (la race que se reportó). El "backoff"
  es en la práctica el intervalo del watchdog (~30s). (El CAPITANO eres tú: nunca es el objetivo —
  no te matas a ti mismo.)
  ```bash
  tmux kill-session -t <SESSION>     # PARA aquí: el watchdog hace respawn limpio en menos de 30s
  ```
- **Objetivo = WORKER (Scout / Analista / Scorer / Scrittore / Critico)** → el watchdog NO los
  cubre, así que **el kill + backoff + respawn los haces tú** (sin race):
  ```bash
  tmux kill-session -t <SESSION>
  sleep 5                                                 # backoff: no recaigas de inmediato en el bucle
  bash /app/.launcher/start-agent.sh <role> <N>          # respawn LIMPIO (estado fresco)
  ```

El backoff + el respawn con estado fresco evitan que rearranque exactamente en el mismo ciclo; no
hacer respawn de los agentes core evita la race con el watchdog.

## Reglas

- **Primero el Dottore, el kill DESPUÉS.** Nunca killes a la primera sospecha: una tarea larga
  legítima parece "atascada" pero está viva (C-08 bis). El kill es el último recurso.
- **La detección y el kill son deterministas; el escalado es decisión tuya (LLM).** No te quedes
  mirando los panes en cada tick: aplica este procedimiento cuando una sospecha madura.
- **No molestes al otro agente para investigar.** Las comprobaciones son pull (capture-pane + DB),
  ningún mensaje al agente sospechoso (que solo añadiría otro turno al bucle).
- **Nunca killes las sesiones de servicio `*-WORKER-*`** si no sabes qué son — comprueba primero el
  rol.
