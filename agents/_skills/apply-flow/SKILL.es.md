<!-- @translation: es, ai-translated 2026-09-13 -->
---
name: apply-flow
description: Cómo el CLOSER ejecuta una candidatura autorizada con `apply_flow.py` — la máquina de estados con checkpoints (detect, fill, upload_cv, screening, review, submit), el recibo obligatorio sin el cual `applied` nunca se escribe, y qué hacer con cada resultado, `blocked_human` antes que nada. Úsala para cada posición tomada de la cola. Del CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/apply_flow.py *), Bash(python3 /app/shared/skills/application_answers.py *), Bash(python3 /app/shared/skills/db_query.py *), Bash(python3 /app/shared/skills/closer_notices.py *)
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
| `blocked_human` respuestas que faltan (`essential_facts_missing` con `missing`, `required_answer_missing` con `pending_question`) | 3 | no es un stop y no se preguntó nada: al flujo le faltan respuestas | deduce cada una de perfil, CV y oferta y guárdala (`application_answers.py save … --basis …`), luego relanza el flujo; solo sin ninguna base `application_answers.py ask --position-id $PID --key K` (prompt del CLOSER, CL-08). Una pregunta que hiciste retiene la posición hasta que el usuario responde, como mucho un día por pregunta |
| `email_channel` | 4 | el control de candidatura es un enlace `mailto:`, no un formulario; el checkpoint guarda `channel: email` y el `mailto_href` en bruto | ejecuta `email_application.py send` para esta posición como dice la skill `email-application-flow`: lee este checkpoint; nunca rellenes un formulario web ni escribas el email a mano |
| `error` | 2 | perfil o CV ilegible, argumentos erróneos | detente: `[BLOCKED]` al Capitano |

## `blocked_human` — qué significa y qué haces

El flujo se detiene ante cualquier cosa que no pueda hacer con certeza:

| `reason` (ejemplos) | Causa típica |
|---|---|
| `required_answer_missing` / `required_profile_field_missing` / `required_field_unanswered` | un campo obligatorio no tiene respuesta guardada; `pending_question` lo nombra (clave, etiqueta, tipo, opciones, scope). Al usuario no le llega nada hasta que ejecutes `ask`; una respuesta guardada reanuda el flujo desde el checkpoint |
| `essential_facts_missing` / `essential_facts_unavailable` | antes del primer run de una posición falta un dato que casi todo formulario pide (fecha de inicio, preaviso, permiso de trabajo, sponsorship, salario, traslado, teléfono); `missing` lista las claves. No se preguntó nada y nada queda retenido |
| `captcha` / `two_factor` | el sitio quiere verificar que hay una persona |
| `vacancy_closed` | la oferta ya no está abierta: una página sin formulario, botón Apply ni canal de email lo dice, o la URL redirigió a la lista de empleos, a la página de empleo o a la portada; no se rellenó ni se envió nada. Parada definitiva: una nueva ejecución no reabre la página hasta que el usuario vuelva a autorizar la posición. Se guarda una captura de la página junto al checkpoint (`stop_screenshot`) |
| `unknown_required_control` / `answer_type_unknown` / `answer_option_unknown` / `answer_not_accepted` | un campo que la receta no sabe rellenar con una respuesta guardada |
| `upload_rejected` / `resume_field_missing` / `cv_missing` | el CV no se puede adjuntar |
| `cv_pdf_layout_bad` | el PDF del CV no pasó el control visual (`pdf_layout_check.py`: texto apretado en una columna estrecha, una página casi vacía, más de 2 páginas, fuentes no incrustadas, cuerpo de texto demasiado pequeño): no se adjuntó ni se envió nada. El Escritor debe volver a generarlo; nunca lo adjuntes a mano. La vista previa de la página 1 se guarda junto al checkpoint: mírala |
| `cv_pdf_check_unavailable` | el PDF del CV no se pudo medir (poppler ausente en el contenedor, archivo ilegible): no se adjuntó ni se envió nada — un CV sin medir no es un pass. El remedio está en el contenedor, no en el Escritor: avisa al Capitano |
| `ats_unsupported` / `ats_conflict` / `ashby_dom_unrecognised` / `greenhouse_dom_unrecognised` / `ashby_form_missing` / `ashby_apply_ambiguous` / `greenhouse_form_missing` / `greenhouse_form_ambiguous` | todavía no hay receta para esta página, o el formulario no es el que la receta conoce |
| `greenhouse_redirect_untrusted` | durante el flujo la página de Greenhouse salió de sus tres hosts de confianza |
| `mailto_ambiguous` / `mailto_invalid` / `application_form_ambiguous` / `application_field_outside_form` / `submit_outside_form` | dos direcciones mailto de candidatura distintas, o el formulario de candidatura, sus campos o su botón de envío no están en un único formulario (newsletter, pie de página y formularios de demo nunca forman parte) |
| `form_error` / `field_invalid` / `submit_unavailable` | el formulario señala un error, se rechaza el formato de un campo, o el botón de envío falta o está deshabilitado |
| `url_refused` / `checkpoint_invalid` | la URL de la candidatura no pasó el control de direcciones públicas, o el checkpoint guardado es ilegible |
| `page_unavailable` / `browser_uncertainty` | la página o el navegador fallaron a mitad del flujo |
| `page_not_found` / `bot_protection` / `page_temporarily_unavailable` | la página de la oferta ya no existe (404/410 sin pruebas de oferta cerrada), un control anti-bot detuvo el navegador (tras un intento en un navegador visible), o el sitio no respondió tres veces en un día. Un único 5xx o timeout NO es una parada: el checkpoint dice `retry_later`, la cola devuelve la posición más tarde por sí sola y no se avisa a nadie. El checkpoint guarda `http_status` y `final_url` |
| `receipt_missing` / `receipt_incomplete` / `confirmation_ambiguous` | se hizo clic en enviar pero la confirmación no es segura |
| `receipt_screenshot_failed` | la confirmación era visible pero no se pudo guardar su captura |
| `submit_outcome_unknown` | una pasada anterior inició el envío y no dejó recibo |
| `applied_record_failed` | el recibo existe pero el estado no se pudo registrar — la candidatura casi seguro salió |
| `login_required` / `account_creation` | el sitio pide iniciar sesión o crear una cuenta antes de la candidatura: el CLOSER nunca inicia sesión ni crea cuentas |
| `generic_form_missing` / `generic_form_unrecognised` / `application_form_embedded` / `application_redirect_untrusted` | un sitio de empresa: no hay formulario de candidatura, hay uno que la receta genérica no logra identificar, está incrustado desde otro host (el detail lo nombra), o el botón de postularse lleva a un sitio sin receta |
| `cover_letter_required` / `pre_submit_screenshot_failed` | el formulario exige un archivo de carta de presentación · no se pudo capturar el formulario relleno antes del clic |

Qué haces con cualquier otro motivo (las respuestas que faltan están arriba):

1. **Nada con esa posición.** El flujo ya escribió el checkpoint y avisó al
   usuario con `jht-notify-user`. No lo avises otra vez.
2. **No la reintentes.** Ni ahora, ni «una vez más dentro de unos minutos». La cola
   la retiene (`checkpoint_blocked_human`) hasta que el usuario la autorice de nuevo.
3. **Pasa a la siguiente posición** de la cola.

Reintentar una posición bloqueada es el intento a ciegas que este diseño existe
para impedir: en un captcha quema la cuenta del usuario, en un resultado
desconocido envía una segunda carta al mismo recruiter.

## Sitios de empresa — la receta genérica

Cuando no se reconoce ningún ATS y la página no es un canal `mailto:`, el flujo
usa `apply_generic.py` en el sitio de la empresa: encuentra el ÚNICO formulario
de candidatura (una subida de CV, o nombre y email con un botón de postularse —
también detrás de un botón de postularse o en una página enlazada del mismo
sitio), rellena los campos por sus etiquetas (perfil para nombre, email,
teléfono, enlaces; respuestas guardadas para las preguntas) y nunca toca un
formulario de newsletter, contacto, búsqueda o inicio de sesión. El formulario
relleno se captura antes del clic; sin una confirmación reconocible (texto o
URL) el resultado es `submit_outcome_unknown`, nunca un segundo clic. Un botón
que lleva a un ATS conocido pasa la posición a esa receta.

**Un resumen por ronda.** Las paradas que dependen del sitio (`ats_unsupported`,
`ats_conflict`, `linkedin_easy_apply`, `application_form_embedded`, `page_not_found`, `bot_protection`, `page_temporarily_unavailable`) no se
notifican una a una: esperan el resumen que envías en el STEP 6 con
`python3 /app/shared/skills/closer_notices.py flush`. Cada aviso llega al usuario
en el idioma de su perfil.

## Comprobar una candidatura después

```bash
python3 /app/shared/skills/db_query.py application "$PID"
```

`applied_via: agent_closer` y un `applied_at` no vacío = el flujo la registró.
