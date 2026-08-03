<!-- @translation: es, ai-translated 2026-07-30 -->
---
name: throttle-ack
description: Firma tu despertar. SIEMPRE el PRIMER comando de cada despertar, antes de cualquier otra cosa, cada vez que recibas un mensaje `[RIPRENDI]` despues de una pausa de throttle. `throttle-ack <tu-nombre>` cambia tu flag de NOTIFIED a ACTIVE. Solo tu puedes hacerlo - el motor no puede - y precisamente por eso un flag que se queda en NOTIFIED es la prueba de que un agente recibio el aviso y no respondio, y por eso el watchdog escala sobre el. Omitirlo hace parecer bloqueado a un agente que esta perfectamente sano.
allowed-tools: Bash(throttle-ack *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle-ack — firma el despertar, luego vuelve al trabajo

```bash
throttle-ack <tu-nombre>
```

Primer comando de cada despertar. Luego vuelve **de inmediato a tu bucle** — el
ack es una firma, no un informe.

## Por que lo haces tu y no el motor

El motor de throttle escribe dos de los tres estados: `IN_THROTTLE` cuando
registras una pausa, `NOTIFIED` cuando te ha mandado el aviso por tmux. El ultimo
paso, `NOTIFIED → ACTIVE`, es **solo tuyo**.

Esa asimetria es todo el punto. Cada watchdog de este sistema comparte un punto
ciego: mirando un pane de tmux, `idle` y `bloqueado` son indistinguibles. Con tu
firma dejan de serlo:

| flag | significado | anomalia si dura |
|---|---|---|
| `IN_THROTTLE` | espera legitima | no — el motor sabe cuanto |
| `NOTIFIED` | aviso enviado, ack pendiente | **si → escalada tras N min** |
| `ACTIVE` | estas trabajando | se juzga con tu salida en el DB |

Un flag parado en `NOTIFIED` no es «quiza idle»: el aviso llego y nadie
respondio. Es una medida, no una hipotesis, y el watchdog la escala al Capitan.

## Las reglas

- **Primer comando, siempre.** Antes de leer tu cola, antes de cualquier tool,
  antes de responder a nadie.
- **El daily halt prevalece sobre el despertar.** El comando comprueba
  `$JHT_HOME/logs/daily-halt.flag` junto con el ack. Si imprime
  `DAILY_HALT_ACTIVE`, no trabajes ni escribas al Capitan: cierra el turno. El
  motor mantiene armado el temporizador y te despierta al retirarse el flag.
- **Luego trabaja de inmediato.** Firmar y quedarse quieto produce un falso «cola
  vacia» que engana al Capitan y al pacing. Un despertar es una senal para
  *trabajar*.
- **No lo uses para cerrar una pausa antes de tiempo.** Un ack mandado mientras tu
  temporizador sigue corriendo se rechaza (exit 1): si pudieras cerrar el flag
  cuando quisieras, el throttle volveria a ser algo que decides tu.
- No necesitas saber cuanto dormiste, y el comando no te lo dice.

## Exit codes

- `0` — flag en `ACTIVE` (idempotente: firmar dos veces es inocuo)
- `1` — ack **rechazado** porque la pausa no termino o daily halt esta activo:
  cierra el turno; el motor te despertara. O argumentos invalidos / motor ausente.

## Ejemplo

```
[DA @SISTEMA A @SCOUT-1] [RIPRENDI] La tua pausa è finita. PRIMO comando: `throttle-ack scout-1`...
```

```bash
throttle-ack scout-1
# THROTTLE_ACK agent=scout-1 NOTIFIED→ACTIVE
```

...y lo siguiente que haces es tu proxima unidad de trabajo.
