<!-- @translation: es, ai-translated 2026-07-30 -->
---
name: throttle
description: Registra tu pausa y CIERRA TU TURNO. El tiempo ya no es tuyo - un motor fuera de tu proceso posee el temporizador y te despierta por tmux cuando expira. Usa SIEMPRE esto en lugar de `sleep` cuando quieras bajar tu ritmo de iteracion. Una llamada, `throttle <tu-nombre>`, retorno inmediato; no sabes cuanto esperas y no debes intentar saberlo. Al despertar, tu PRIMER comando es siempre `throttle-ack <tu-nombre>`. `sleep` para pausas de throttle esta PROHIBIDO, y tambien lo esta mandar esta llamada a background con `&` / `nohup` / una tarea en background.
allowed-tools: Bash(throttle *), Bash(throttle-ack *), Bash(jht-throttle *), Bash(jht-throttle-check *), Bash(jht-throttle-wait *), Bash(python3 /app/shared/skills/throttle_engine.py *)
---

# throttle — registra la pausa, luego detente

```bash
throttle <tu-nombre> [--reason "..."]
```

Retorna de inmediato. Luego **cierra tu turno**: ninguna otra tarea, ningun otro
comando.

## Por que funciona asi

Hasta el 2026-07-30 el throttle era un contrato que debias cumplir tu solo:
`jht-throttle` bloqueaba *tu propio proceso* con un bucle de sleep, y si ese
proceso moria tenias que darte cuenta y volver a bloquearte. Cada fallo observado
en produccion nacio de ese diseno. El peor: un Analista lanzo
`jht-throttle … &` dentro de un comando compuesto que el timeout de la tool call
mato a los 60s. El hijo desacoplado murio con su padre, el agente cerro el turno
convencido de que la pausa corria — y **nadie volvio a despertarlo**. 2h15m de
parada, con el watchdog reportando la sesion como `idle` = sana.

Ahora el temporizador pertenece a un motor que **no es hijo de tu shell**:

```
TU                           MOTOR (daemon, fuera de tu proceso)
 |                              |
 |-- throttle <me> ------------>|  lee la duracion que calibro el Capitan
 |                              |  te marca el flag IN_THROTTLE
 |   (cierras el turno          |  arma el temporizador EN DISCO
 |    y no haces NADA)          |
 |                              |
 |<-- [RIPRENDI] por tmux ------|  temporizador vencido -> flag = NOTIFIED
 |                              |
 |-- throttle-ack <me> -------->|  TU cambias NOTIFIED -> ACTIVE
 |   (primer acto al despertar) |
```

Un reinicio del daemon no pierde nada: el vencimiento es una marca de tiempo
absoluta en disco, asi que no hay temporizador en memoria que rearmar.

## Las reglas

- **Nunca pasas un numero y nunca ves uno.** La duracion vive en
  `$JHT_HOME/config/throttle.json`, es del Capitan, y el motor la lee *cuando arma
  el temporizador* — asi una recalibracion muerde en tu **siguiente** ciclo sin
  que nadie tenga que avisarte. No cablees `throttle 600` en tu bucle.
- **CIERRA EL TURNO despues de la llamada.** La llamada retorna en milisegundos
  precisamente para que ningun timeout de tool call pueda matarla. Si sigues
  trabajando despues, estas corriendo sin pausa alguna — que es exactamente lo
  que el throttle existe para evitar.
- **NUNCA** la mandes a background (`&`, `nohup`, `disown`, una tarea en
  background). No hay nada que mandar a background: no duerme.
- **NUNCA** uses `sleep N` crudo para una pausa de throttle. `sleep` solo sirve
  para esperas muy breves entre reintentos (≤ 5 s), donde loguear seria ruido.
- **Al despertar, `throttle-ack <tu-nombre>` es tu primer comando** — mira la
  skill `throttle-ack`. Si lo omites tu flag se queda en `NOTIFIED`, que el
  watchdog lee como prueba de que estas bloqueado, y escala al Capitan por un
  agente que esta perfectamente bien.
- `--reason` es opcional pero util: una etiqueta corta (`"post-batch"`,
  `"esperando al critico"`) hace legible `logs/throttle-engine.jsonl` despues.

## Ejemplos

```bash
# Scout, al terminar una posicion:
throttle scout-1 --reason "post-batch"
# ... y el turno termina aqui.

# Escritor esperando al Critico:
throttle scrittore-1 --reason "waiting critic review"
```

## Exit codes

- `0` — temporizador armado, o duracion 0 (sin pausa: el core interactivo esta en
  0 a proposito, para seguir reactivo en el chat del usuario — sigue)
- `1` — argumentos invalidos, o motor ausente

## Comandos obsoletos

`jht-throttle`, `jht-throttle-check` y `jht-throttle-wait` siguen funcionando:
hoy son shims delgados sobre el motor, mantenidos para los prompts que aun no han
migrado. Prefiere `throttle` + `throttle-ack`. Si te encuentras calculando
timeouts para una tool call (`timeout: N+30`), estas en el camino viejo — ya no
hace falta.

## Nota para el Capitan

Para cambiar un ritmo, edita la config — nunca mandes un numero por tmux:

```bash
throttle-set scout-1 660                       # un agente
throttle-set scout-1=660 analista-1=300        # varios, 1 escritura atomica
throttle-set --dump                            # los valores efectivos ahora
```

El cambio muerde en el siguiente ciclo de cada agente, por si solo. Usa tmux solo
para decirle a un agente que llame la skill **mas o menos seguido** en su bucle,
nunca para dictar una duracion.
