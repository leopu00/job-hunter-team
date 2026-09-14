<!-- @translation: es, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Cómo el CLOSER ejecuta una candidatura autorizada con `apply_flow.py` — la máquina de estados con checkpoints (detect, fill, upload_cv, screening, review, submit), el recibo obligatorio sin el cual `applied` nunca se escribe, y qué hacer con cada resultado, `blocked_human` antes que nada. Úsala para cada posición tomada de la cola. Del CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *)
---

# apply-flow — una candidatura, un recibo, ningún reintento a ciegas

```bash
python3 /app/shared/skills/apply_flow.py \
  --position-id "$PID" \
  --url "$URL" \
  --profile "$JHT_HOME/profile/candidate_profile.yml" \
  --cv "$CV"
```

`PID`, `URL` y `CV` vienen de la última lectura de `apply_gate.py queue` (skill
`apply-authorization`), nunca de la memoria.

## La máquina de estados

```
detect → fill → upload_cv → screening → review → submit → applied
                                                        ↘ blocked_human
```

- Cada paso completado se guarda en un checkpoint (`$JHT_HOME/.cache/apply-flow/<id>.json`).
  Tras un crash el flujo retoma donde estaba: el rellenado se repite, el clic no.
- `submit_started` se guarda **antes** del clic. Si un proceso muere después de esa
  línea, el resultado es desconocido, y un resultado desconocido nunca se vuelve a
  clicar: el flujo busca una confirmación en la página y, sin ella, se bloquea con
  `submit_outcome_unknown`.
- La puerta se comprueba al arrancar **y** justo antes del clic. Un flag revocado
  mientras se rellenaba el formulario detiene el envío.
- Hoy dos recetas completas: **Ashby** y **Greenhouse** (solo sus tres hosts públicos, `job-boards.greenhouse.io`, `job-boards.eu.greenhouse.io`, `boards.greenhouse.io`, por HTTPS; la página se vuelve a comprobar tras cada paso). Cualquier otra plataforma se bloquea para una persona.

## El recibo

`applied` se escribe solo cuando el flujo tiene **ambos**:

1. una captura de pantalla de la página de confirmación, y
2. una URL o un texto de confirmación.

Después es el propio flujo quien registra la candidatura con `applied_via = agent_closer`,
y relee la fila para comprobar que la escritura ocurrió. Nadie más escribe ese
estado: ni tú, ni el Capitano.

## Leer el resultado

Una línea JSON en stdout: `status`, `state`, `reason`, `receipt`.

| `status` | Exit | Significado | Qué haces |
|---|---|---|---|
| `applied` | 0 | enviada, recibo guardado, estado registrado | siguiente posición |
| `dry_run` | 0 | `mode: dry_run`: rellenada, detenida antes del botón, nada enviado | siguiente posición |
| `denied` | 1 | la puerta rechazó (consentimiento apagado, flag revocado, ya enviada) | siguiente posición; nunca reintentar |
| `blocked_human` | 3 | hace falta una persona; el usuario ya fue avisado | siguiente posición; nunca reintentar |
| `blocked_human` esperando respuestas (`essential_facts_missing`, `required_answer_missing`, `required_profile_field_missing`, `required_field_unanswered`) | 3 | no es un stop definitivo: al usuario se le preguntó una vez, la cola retiene la posición (`essential_answers_pending` / `checkpoint_blocked_human`) hasta que las respuestas están en `jobs.db` | siguiente posición; con el `[BRIDGE INFO]` que dice que el usuario respondió, relee la cola: la posición vuelve a estar en `positions` |
| `email_channel` | 4 | el control de candidatura es un enlace `mailto:`, no un formulario; el checkpoint guarda `channel: email` y el `mailto_href` en bruto | ejecuta `email_application.py send` para esta posición como dice la skill `email-application-flow`: lee este checkpoint; nunca rellenes un formulario web ni escribas el email a mano |
| `error` | 2 | perfil o CV ilegible, argumentos erróneos | detente: `[BLOCKED]` al Capitano |

## `blocked_human` — qué significa y qué haces

El flujo se detiene ante cualquier cosa que no pueda hacer con certeza:

| `reason` (ejemplos) | Causa típica |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | un campo obligatorio no tiene respuesta guardada — se le preguntó una vez al usuario (primero por Telegram, también en el dashboard); la respuesta se guarda en `jobs.db` y el flujo se reanuda desde el checkpoint |
| `essential_facts_missing` / `essential_facts_unavailable` | antes del primer run de una posición falta un dato que casi todo formulario pide (fecha de inicio, preaviso, permiso de trabajo, sponsorship, salario, traslado, teléfono); cada uno se preguntó una vez y nada queda retenido: la posición vuelve a ejecutarse cuando existan las respuestas |
| `captcha` / `two_factor` | el sitio quiere verificar que hay una persona |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | un campo que la receta no sabe rellenar con una respuesta guardada |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | el CV no se puede adjuntar |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` | todavía no hay receta para esta página, o el formulario no es el que la receta conoce |
| `greenhouse_redirect_untrusted` | durante el flujo la página de Greenhouse salió de sus tres hosts de confianza |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | dos direcciones mailto de candidatura distintas, o el formulario de candidatura, sus campos o su botón de envío no están en un único formulario (newsletter, pie de página y formularios de demo nunca forman parte) |
| `form_error` / `field_invalid` / `submit_unavailable` | el formulario señala un error, se rechaza el formato de un campo, o el botón de envío falta o está deshabilitado |
| `url_refused` / `checkpoint_invalid` | la URL de la candidatura no pasó el control de direcciones públicas, o el checkpoint guardado es ilegible |
| `page_unavailable` / `browser_uncertainty` | la página o el navegador fallaron a mitad del flujo |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | se hizo clic en enviar pero la confirmación no es segura |
| `receipt_screenshot_failed` | la confirmación era visible pero no se pudo guardar su captura |
| `submit_outcome_unknown` | una pasada anterior inició el envío y no dejó recibo |
| `applied_record_failed` | el recibo existe pero el estado no se pudo registrar — la candidatura casi seguro salió |

Qué haces, siempre igual:

1. **Nada con esa posición.** El flujo ya escribió el checkpoint y avisó al
   usuario con `jht-notify-user`. No lo avises otra vez.
2. **No la reintentes.** Ni ahora, ni «una vez más dentro de unos minutos». La cola
   la retiene (`checkpoint_blocked_human`) hasta que el usuario la autorice de nuevo.
3. **Pasa a la siguiente posición** de la cola.

Reintentar una posición bloqueada es el intento a ciegas que este diseño existe
para impedir: en un captcha quema la cuenta del usuario, en un resultado
desconocido envía una segunda carta al mismo recruiter.

## Comprobar una candidatura después

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` y un `applied_at` no vacío = el flujo la registró.
