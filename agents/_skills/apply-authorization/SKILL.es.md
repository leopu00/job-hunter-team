<!-- @translation: es, ai-translated 2026-09-13 -->
---
name: apply-authorization
description: Las dos puertas entre el equipo y el buzón de un recruiter, y cómo leer sus rechazos. Una candidatura sale SOLO si el usuario dio su consentimiento general (`applications.auto_apply` en la config del usuario) Y marcó esa misma posición. Ambas fail-closed y comprobadas en el código por `apply_gate.py`. Úsala al arrancar y antes de cada posición para leer la cola del CLOSER, y siempre que tengas que explicar por qué una posición no salió. Del CLOSER; el Capitano lee la misma cola para decidir si lo spawnea.
allowed-tools: Bash(python3 /app/shared/skills/apply_gate.py *)
---

# apply-authorization — qué puede salir, y por qué el resto no

Una candidatura sale del box solo cuando se cumplen **dos** condiciones. Ausente,
roto o no reconocido cuenta como **no**, siempre.

| # | Condición | Dónde vive | Quién la pone |
|---|---|---|---|
| 1 | consentimiento general | `applications.auto_apply.enabled = true` en `$JHT_HOME/jht.config.json` | el usuario, al activar |
| 2 | autorización por posición | `positions.apply_requested = 1` con `apply_requested_at` y `apply_requested_by` = `user_web` / `user_local` | el usuario, en esa posición |

El flag del usuario **es** la autorización para enviar. No hay una segunda pregunta.

## La cola — un comando, leído por dos roles

```bash
python3 /app/shared/skills/apply_gate.py queue --json
```

Exit `0` solo cuando algo puede salir ahora; exit `1` en otro caso. El JSON:

| Campo | Significado |
|---|---|
| `ready` | `true` = al menos una posición se puede tomar ahora |
| `reason` | token estable, ver abajo |
| `mode` | `authorised` (envía) o `dry_run` (diagnóstico, rellena y se detiene antes del botón) |
| `max_per_day` / `sent_today` / `remaining_today` | las enviadas hoy por el CLOSER y el tope diario si el usuario puso uno (null = sin tope, nada se rechaza por el número) |
| `positions` | lo que puedes tomar, en orden de autorización: `position_id`, `url`, `cv_pdf_path` |
| `held` | posiciones autorizadas que NO se deben tomar ahora, cada una con su `reason` |

El CLOSER toma la primera entrada de `positions`. El Capitano spawnea el CLOSER
solo cuando el comando sale con `0`.

## Por qué la cola está cerrada (`reason`)

| Token | Significado | Qué hacer |
|---|---|---|
| `config_missing` / `config_unreadable` / `config_malformed` | la config del usuario no se puede leer | nada: no se puede establecer consentimiento |
| `consent_absent` / `consent_disabled` | el usuario no dio su consentimiento | nada. Nunca sugerir activarlo (RULE-T18) |
| `consent_mode_unknown` / `consent_cap_invalid` | el bloque existe pero un valor no se reconoce | nada: la puerta rechaza en vez de adivinar |
| `db_unavailable` / `queue_unreadable` | la base de datos local no se puede leer | `[BLOCKED]` al Capitano |
| `queue_empty` | ninguna posición autorizada se puede tomar | sal |
| `daily_cap_reached` | el usuario fijó `max_per_day` y el CLOSER ya envió esa cantidad hoy (nunca sin tope) | sal; la cola reabre mañana |

## Por qué una posición está retenida (`held[].reason`)

| Token | Significado |
|---|---|
| `already_submitted` | la candidatura ya salió (estado `applied`/`response`, o la fila application dice applied). El flag sigue encendido tras el envío: no es una nueva petición |
| `position_not_authorised` | el flag está apagado (el usuario lo revocó) |
| `authorisation_undated` | el flag no tiene timestamp |
| `authorisation_not_from_user` | el flag no lo puso un canal del usuario. Un flag puesto por un proceso no es una autorización |
| `url_missing` / `cv_pdf_missing` | no hay con qué rellenar el formulario |
| `checkpoint_blocked_human` | el flujo ya se detuvo en esta posición y preguntó al usuario. Vuelve solo cuando el usuario la autoriza de nuevo |
| `checkpoint_dry_run` | ya rellenada en modo diagnóstico |
| `checkpoint_unreadable` | el checkpoint del flujo no se puede leer: incertidumbre, así que no |

## Una posición, un veredicto

```bash
python3 /app/shared/skills/apply_gate.py position <ID> --json
```

`allowed: true` solo con `reason: apply_allowed`. Es la misma comprobación que
`apply_flow.py` hace al arrancar y otra vez justo antes del clic. No hace falta
lanzarla antes del flujo; úsala para explicar un rechazo.

## Reglas

- **Nunca escribas la autorización.** `apply_requested*` pertenece al usuario.
- **Nunca rodees un rechazo.** Una puerta cerrada es la respuesta, no un obstáculo.
- **Nunca pidas al usuario que autorice más.** El equipo está completo aun sin
  una sola candidatura (RULE-T18).
