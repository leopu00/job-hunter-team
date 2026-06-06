<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: bridge-pacing
description: Traducir un tick de calibración de 15 minutos `[BRIDGE PACING]` en ajustes de throttle por agente. El bridge mide la tasa real de consumo del equipo y te da un veredicto (SFORO / MARGINE / ALLINEATO) más la participación por agente + cadencia necesaria para elegir A QUIÉN ralentizar y CUÁNTO. Abre esta skill SOLO cuando llega una línea `[BRIDGE PACING]`; las órdenes rutinarias `[SENTINELLA]` usan un flujo diferente (`sentinel-orders`).
allowed-tools: Bash(python3 /app/shared/skills/throttle-config.py *), Bash(jht-tmux-send *)
---

# bridge-pacing — calibración de throttle basada en datos

El bridge ejecuta una ventana de medición cada 15 min (alineada a :00/:15/:30/:45 UTC). Al cierre de cada ventana escribe una línea en el panel del Captain que resume la tasa real del equipo y te dice en qué dirección sesgar el throttle. Esto **no** es una orden del Sentinel — es una señal de calibración sobre la que actúas con `throttle-config.py`.

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

## Fórmula de calibración (lo nuevo aquí)

Para obtener una reducción de tasa del `f%` en un agente con cadencia `c` checkpoint/min, la duración a poner en `throttle-config` es:

```
durata_sec = (f / 100) × 60 / c
```

La intuición: cada llamada a `jht-throttle` añade `durata_sec` de pausa. En 60s el agente la llama `c` veces → añade `c · durata` segundos de pausa por minuto → reducción fraccional de tasa `= c · durata / 60`. Resuelve para `durata`.

### Ejemplo resuelto — concentrar la reducción en un agente

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
```

Poner casi toda la reducción sobre `analista-1`:
- fracción sobre analista-1 ≈ 19% / 47% ≈ 40%
- `durata_sec = 0.40 × 60 / 0.6 = 40s`
- → `throttle-config.py set analista-1 40`

### Ejemplo resuelto — distribuir la reducción entre dos agentes

```
Tick: SFORO +4.35%/h → riduci 19%
analista-1: share 47%, cadenza 0.6/min
scout-1:    share 26%, cadenza c_scout
```

Peso combinado 47 + 26 = 73%. Distribuir el 19% proporcionalmente:
- fracción por agente ≈ 19% / 73% ≈ 26%
- analista-1: `0.26 × 60 / 0.6 = 26s`
- scout-1:    `0.26 × 60 / c_scout`
- → un `bulk-set` escribe atómicamente:

```bash
python3 /app/shared/skills/throttle-config.py bulk-set \
    analista-1=26 scout-1=<derivado de c_scout>
```

## Al liberar throttle (MARGINE)

Si el veredicto es `MARGINE −X%/h → puoi salire Y%`:
1. Elige el rol que quieres acelerar (prioridad: el cuello de botella actual — `pipeline-triage` si no estás seguro).
2. Reduce su throttle actual aproximadamente en `Y%` (o ponlo a cero si era un valor pequeño).
3. **No** pongas a cero a todos de una vez — oscilarías hacia un SFORO en el siguiente tick.

## Cadencia después de un cambio de configuración

- Después de cualquier cambio, espera **2-3 ticks** (≈30-45 min) antes de intervenir de nuevo.
- El pacing ya es tu síntesis — **no** añadas llamadas extra a `rate_budget live` entre medias (inflan el `velocity_smooth` del Sentinel).
- Si después de 3 ticks el veredicto sigue siendo SFORO, duplica las duraciones en los mismos agentes (lineal → geométrico); si sigue MARGINE, reduce a la mitad.

## Anti-patrones

- ❌ Leer solo `VERDETTO` e ignorar `share` / `cadenza`: recortas a ciegas en todos los agentes y golpeas a los roles baratos (Scorer, Analyst) antes que a los caros (Writer, Critic).
- ❌ Tratar un solo tick SFORO como un estado permanente: 1 tick es ruido, 2 ticks consecutivos son señal.
- ❌ Mezclar este flujo con los de `sentinel-orders`: un `[BRIDGE PACING]` y un `[URG] RALLENTARE` pueden llegar con minutos de diferencia. El `[URG]` siempre gana — aplícalo primero, el siguiente pacing re-medirá.
- ❌ Enviar números derivados del pacing vía tmux a agentes (`[INFO] sleep 40s`). Siempre ve a través de `throttle-config.py` — los agentes leen el archivo, no parsean tu cuerpo tmux.

## Ver también

- `sentinel-orders` — ticks rutinarios, niveles de throttle 0-4, emergencias.
- `bridge-mailbox` — drenar veredictos de pacing que te perdiste durante un turno largo (el bridge escribe en un JSONL incluso si el envío tmux en vivo falló).
- `throttle` — referencia CLI de `throttle-config.py` y el archivo de estado por agente.
- `pipeline-triage` — cuando MARGINE significa "generar uno más en el cuello de botella" en lugar de solo poner throttle a cero.
