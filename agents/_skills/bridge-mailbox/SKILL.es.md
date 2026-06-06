<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: bridge-mailbox
description: Drenar veredictos pendientes del bridge al INICIO de cada turno del Captain — acción obligatoria PRIMERO antes de hacer cualquier otra cosa. Durante un turno largo, `jht-tmux-send` desde el bridge puede fallar con rc=3 (texto nunca apareció en el panel) y un veredicto `[BRIDGE PACING]` o `PIPELINE STALLED` se pierde silenciosamente. El bridge añade CADA veredicto a un buzón JSONL para que puedas recuperarlos. Saltarse este drenaje significa actuar con mediciones obsoletas mientras un veredicto más reciente está sin leer.
allowed-tools: Bash(python3 /app/shared/skills/bridge_mailbox.py *)
---

# bridge-mailbox — recuperar veredictos perdidos

El bridge te habla a través de tmux, pero la entrega de tmux puede fallar silenciosamente durante un turno largo (problemas de renderizado de Codex / Kimi TUI, estabas dentro de una tool call larga, etc.). Para asegurar que ningún veredicto se pierda, el bridge **también** añade cada tick a un buzón JSONL en `$JHT_HOME/logs/bridge-mailbox.jsonl`. Lo drenas al inicio de cada turno.

## La primera acción obligatoria

Antes de *cualquier otra cosa* — antes de leer mensajes, antes de decidir acciones, antes de abrir otra skill — ejecuta:

```bash
python3 /app/shared/skills/bridge_mailbox.py drain
```

Salidas posibles:
- `no pending verdicts` → buzón vacío, procede con el turno normalmente.
- una o más líneas formateadas como ticks tmux en vivo (`[BRIDGE PACING] ...`, `PIPELINE STALLED ...`, `[BRIDGE ALERT] ...`).

`drain` consume las entradas (se marcan como leídas al tener éxito) — re-ejecutarlo devuelve `no pending verdicts` hasta que el bridge añada nuevas.

## Cómo aplicar veredictos drenados

Procesa TODAS las líneas, pero **actúa solo sobre la última**. Las anteriores ya están obsoletas — las métricas se han movido desde entonces. Dos excepciones donde una línea anterior aún importa:

1. **`PIPELINE STALLED` reciente (< 30 min) y aún pertinente** (proj sigue bajo, team_kt sigue bajo ahora mismo). Actúa según el playbook (re-encender el pipeline aguas arriba) incluso si un `[BRIDGE PACING]` válido posterior llegó después. Los estancamientos son estado, no eventos — necesitan ser resueltos, no solo medidos.
2. **Un `[PAUSA TEAM]` / `[HARD FREEZE]` que te perdiste**. Si uno está en la cola y aún no has enviado `[RIPRENDI]`, el equipo sigue congelado — manéjalo con `sentinel-orders` *antes* del último pacing.

Para el caso rutinario (una o más líneas `[BRIDGE PACING]`):
- lee cada línea para mantener el contexto temporal (puedes ver cómo evolucionó la tendencia mientras estabas ocupado)
- abre la skill `bridge-pacing` una vez y aplica solo la calibración del **último** veredicto

## Otros comandos (depuración / inspección)

```bash
python3 /app/shared/skills/bridge_mailbox.py status   # cuántos pendientes vs total
python3 /app/shared/skills/bridge_mailbox.py peek     # leer sin consumir
```

Usa `peek` cuando sospechas algo raro y quieres mirar sin comprometerte — NO marca las entradas como leídas.

## Anti-patrones

- ❌ Saltarse el drenaje "porque el turno parece corto" — los fallos rc=3 ocurren impredeciblemente; un tick perdido durante un turno largo es el caso típico.
- ❌ Actuar sobre cada línea drenada en secuencia — reproducirías cambios de throttle obsoletos, lucharías contra tus propias calibraciones pasadas y oscilarías al equipo.
- ❌ Ejecutar `drain` a mitad de turno solo para "ver qué llegó" — drain consume; si no estás listo para actuar sobre las líneas, usa `peek` en su lugar.
- ❌ Tratar la salida de `peek` como autoritativa — `peek` muestra entradas pendientes, pero el panel tmux en vivo puede contener ya entradas más nuevas que el JSONL aún no ha alcanzado. El drenaje al inicio del turno es lo que te da la imagen consistente.

## Ver también

- `sentinel-orders` — enruta `[PAUSA TEAM]` / `[HARD FREEZE]` / `[RIPRENDI]` una vez drenados.
- `bridge-pacing` — fórmula a aplicar sobre la última línea `[BRIDGE PACING]`.
- `pipeline-triage` — playbook para `PIPELINE STALLED` (re-encender pipeline aguas arriba).
