<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Lee un tick de calibración `[BRIDGE PACING]` de 15 minutos — la medición del bridge sobre la tasa real del equipo, con un veredicto (SFORO / MARGINE / ALLINEATO) más la participación y la cadencia por agente. El tick va dirigido a la SENTINELLA, no a ti: abre esta skill cuando ella te reenvíe esos números, o cuando vayas a leer un tick por iniciativa propia. No te quedes esperando a que llegue uno a tu panel — no va a llegar. Convertir el veredicto en valores de throttle por agente es `throttle-distribution`.
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — leer el tick de calibración de 15 min

El bridge ejecuta una ventana de medición cada 15 min (alineada a :00/:15/:30/:45 UTC). Al cierre de cada ventana escribe una línea que resume la tasa real del equipo — **en el panel de la Sentinella, no en el tuyo** (push→pull, 25/06/2026). A ti no te hacen ping cada cuarto de hora a propósito: ella lee el tick y solo te despierta cuando merece un turno tuyo. Así que usas este formato cuando **ella te reenvía los números**, o cuando vas a mirar un tick por iniciativa propia — nunca como algo que esperar.

## Forma del mensaje

```
[BRIDGE PACING] HH:MM UTC window=15m (effettivi Xm) samples=N |
  usage=U% reset_in=Rh reset_at=THH:MM UTC (proj=P% — INFO, secondario non-driver) |
  vel_team=V%/h | vel_target=T%/h (per chiudere a TGT% al reset) [schedule+ratio phase=ON] |
  ratio=K kT/% (team Σ kT / Δusage) |
  agenti: name=p%/h [kT/Xm → kT/h ÷ K = p%/h, share s%, cadenza c/min (n chk in Xm)] ; ... |
  VERDETTO: SFORO|MARGINE|ALLINEATO ...
```

`TGT` es el **objetivo dinámico** elegido por el bridge:
- Configuración 24/7 o sin horario → `TGT=92` (centro de banda, valor por defecto histórico)
- Configuración de horario laboral + proveedor con límite semanal (Codex/Claude) → `TGT` es el % necesario al reset para que el presupuesto semanal se distribuya exactamente entre las horas activas del usuario. Ejemplo: horario oficina 9-18 en Codex Pro → `TGT≈76`.
- Configuración de horario laboral + Kimi (sin límite semanal) → `TGT=92` (respaldo centro de banda).

La etiqueta `[schedule+ratio phase=ON]` entre paréntesis es la **fuente** del objetivo — `band_center` (sin horario laboral), `schedule+ratio` (con horario laboral completo), `schedule+band` (horario laboral + respaldo Kimi). Úsala para depurar objetivos inesperados.

## Campos que realmente usas

| Campo             | Qué te dice                                                                                          |
|-------------------|------------------------------------------------------------------------------------------------------|
| **`vel_team`**    | tasa medida del equipo, en puntos porcentuales de presupuesto por hora                               |
| **`vel_target`**  | tasa que aterrizaría en `TGT%` al reset (centro de la banda ±10pt alrededor de `TGT`)                |
| **`share s%`**    | peso por agente sobre la tasa total (Σ shares ≈ 100%) — te dice **A QUIÉN** ralentizar               |
| **`cadenza c/min`** | llamadas por minuto a `jht-throttle` por agente en la ventana — te dice **CUÁNTO** añadir a la config |
| **`VERDETTO`**    | resumen accionable; mapea directamente a la tabla de abajo                                            |

> ⚠️ **`proj` es solo INFO — NO actúes sobre él.** Es una extrapolación volátil de
> velocidad de ventana corta (ej. imprimió `proj=-8.66%` mientras el equipo estaba simplemente
> un poco por debajo del objetivo). El bucle de control es **`vel_team` vs `vel_target`** (ambos
> conscientes del semanal) + `weekly_remaining`. Ignora `proj` para decisiones de throttle/spawn.

## Veredicto → acción

| Veredicto                        | Significado                                                   | Acción                                                                                |
|----------------------------------|---------------------------------------------------------------|---------------------------------------------------------------------------------------|
| `SFORO +X%/h → riduci Y%`        | `vel_team` excede el objetivo por X puntos/h. Reducir Y% de la tasa. | **Aumentar** `throttle-config` para los agentes con **alta participación** (top 1-2)  |
| `MARGINE −X%/h → puoi salire Y%` | `vel_team` por debajo del objetivo. Tienes margen.            | **Poner a cero o reducir** el throttle en agentes throttleados (prioridad: rol cuello de botella) |
| `ALLINEATO Δ ±0.2%/h`            | dentro de tolerancia.                                         | no hacer nada, esperar al siguiente tick                                              |

> 💡 `X%/h` vs `Y%` son lo mismo en dos unidades. `Y = X / vel_team × 100`.

## Qué hacer con él

El veredicto te dice **si** moverte y a grandes rasgos **cuánto**. Convertir eso en valores dentro de `throttle.json` — qué agente ralentiza, cuántos escalones, y cuándo lo correcto es no hacer nada — le corresponde a **`throttle-distribution`**. Abre esa para actuar: es la que posee la aritmética, la escalera y las reglas de seguridad.

Dos cosas que llevarte contigo cuando vayas:

- **`share` responde a QUIÉN.** El throttle solo devuelve presupuesto en proporción a lo que un agente está gastando de verdad, así que un "recorta el 19%" a nivel de equipo nunca es "todos abajo un 19%".
- **`cadenza` responde a CUÁNTO.** Es la entrada de la fórmula de la duración: el mismo valor en la config recorta de forma muy distinta en un agente que llega a un checkpoint dos veces por hora y en uno que llega diez.

## Anti-patrones

- ❌ Leer solo `VERDETTO` e ignorar `share` / `cadenza`: recortas a ciegas en todos los agentes y golpeas a los roles baratos (Scorer, Analyst) antes que a los caros (Writer, Critic).
- ❌ Tratar un solo tick SFORO como un estado permanente: 1 tick es ruido, 2 ticks consecutivos son señal.
- ❌ Mezclar este flujo con los de `sentinel-orders`: un `[BRIDGE PACING]` y un `[URG] RALLENTARE` pueden llegar con minutos de diferencia. El `[URG]` siempre gana — aplícalo primero, el siguiente pacing re-medirá.
- ❌ Enviar números derivados del pacing vía tmux a agentes (`[INFO] sleep 40s`). Siempre ve a través de `throttle-config.py` — los agentes leen el archivo, no parsean tu cuerpo tmux.

## Ver también

- `throttle-distribution` — la actuación: quién ralentiza, cuánto, y cuándo no hacer nada.
- `sentinel-orders` — ticks rutinarios, niveles de throttle 0-4, emergencias.
- `bridge-mailbox` — drenar veredictos de pacing que te perdiste durante un turno largo (el bridge escribe en un JSONL incluso si el envío tmux en vivo falló).
- `throttle` — referencia CLI de `throttle-config.py` y el archivo de estado por agente.
- `pipeline-triage` — cuando MARGINE significa "generar uno más en el cuello de botella" en lugar de solo poner throttle a cero.
