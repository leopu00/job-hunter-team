<!-- @translation: es, ai-translated 2026-09-13 -->
---
name: email-application-flow
description: Cómo el CLOSER envía por email una candidatura autorizada con `email_application.py` cuando `apply_flow.py` responde `email_channel` (el control Apply es un enlace `mailto:`) — inspect, preflight, draft, send, status; el gate comprobado de nuevo justo antes del transporte; `send_started` antes del comando irreversible; el recibo sin el cual `applied` nunca se escribe. Úsala para cada posición cuyo flujo termina en `email_channel`. Del CLOSER.
allowed-tools: Bash(python3 /app/shared/skills/email_application.py *)
---

# email-application-flow — un email, un recibo, ningún reintento a ciegas

Úsala **solo** para una posición de la última cola cuyo `apply_flow.py` respondió
`email_channel` (exit 4). El flujo del navegador dejó el `mailto_href` en bruto en
su checkpoint; esta skill lo lee. Nunca abres un cliente de correo, nunca escribes
un email a mano, nunca copias la dirección a otro sitio.

```bash
python3 /app/shared/skills/email_application.py send --position-id "$PID" --json
```

`send` lo ejecuta todo en orden y se detiene en el primer problema. Los otros
comandos sirven para leer, no para rodear un stop:

| Comando | Qué hace |
|---|---|
| `inspect` | lee e interpreta el enlace mailto (To, CC, asunto, cuerpo) |
| `preflight` | inspect + gate + tope diario + transporte + CV + carta de presentación + datos obligatorios |
| `draft` | preflight + el borrador determinista; no sale nada |
| `send` | draft + de nuevo el gate + `send_started` + transporte + recibo + `applied` |
| `status` | el último intento y su estado, solo lectura |

`--dry-run` se detiene antes del transporte y no cambia nada en la candidatura.

## Qué garantiza el comando

- **El flag es la autorización.** El gate decide en el preflight y de nuevo justo
  antes del transporte. Un flag revocado o un tope alcanzado entretanto significa
  que no sale nada (`denied`).
- **Nada se inventa.** Los destinatarios salen solo del enlace. Nombre, email de
  contacto y cualquier dato que pida la oferta (disponibilidad, expectativa
  salarial) salen solo del perfil del candidato; si falta uno es
  `required_fact_missing`.
- **El CV se adjunta siempre**, tras comprobar tamaño, PDF y hash. La carta de
  presentación se adjunta solo si la oferta la pide; si no existe, se pide al
  Scrittore con la solicitud de escritura normal y el flujo se detiene.
- **Como mucho una carta.** `send_started` se registra antes de que el servidor
  reciba el mensaje. Después, un timeout o una respuesta poco clara es
  `send_outcome_unknown`: nunca se reintenta, ni siquiera en una nueva pasada.
- **`applied` solo tras la aceptación**, con `applied_via = agent_closer_email`,
  escrito por el propio comando después de guardar el recibo.

## Leer el resultado

Una línea JSON: `state`, `reason`, `detail`, más los datos.

| `state` | Exit | Significado | Qué haces |
|---|---|---|---|
| `sent` | 0 | aceptado por el servidor, recibo guardado, candidatura registrada | siguiente posición |
| `draft_ready` | 0 | dry run: borrador y adjuntos válidos, no salió nada | siguiente posición |
| `denied` | 1 | el gate rechazó (`flag_revoked`, `gate_mode_changed`, `daily_cap_reached`, `duplicate_attempt`) | siguiente posición; nunca reintentar |
| `blocked_human` | 1 | hace falta una persona; se avisó al usuario | siguiente posición; nunca reintentar |
| `send_outcome_unknown` | 3 | el email puede haber salido | siguiente posición; nunca reintentar |
| `receipt_incomplete` | 3 | aceptado, pero el recibo o el registro están incompletos; con algunos destinatarios rechazados la carta probablemente llegó | siguiente posición; nunca reintentar |
| `error` | 2 | base de datos, perfil o checkpoint ilegibles | stop: `[BLOCKED]` al Capitano |

⚠️ Estos exit codes **no** son los de `apply_flow.py` (allí `denied` es 1 y
`blocked_human` es 3). Decide por `state`, nunca por el número.

## Motivos de `blocked_human`

| `reason` | Causa típica |
|---|---|
| `transport_missing` | no hay transporte de email configurado, o el archivo del secreto falta o no es 0600 |
| `auth_failed` | el servidor de correo rechazó las credenciales |
| `sender_unverified` | la dirección remitente no es la cuenta autenticada ni un remitente verificado |
| `mailto_missing` | ningún checkpoint del navegador en `email_channel` para esta posición: ejecuta antes `apply_flow.py`; la página nunca se lee para buscar una dirección |
| `recipient_ambiguous` / `mailto_invalid` | cero o varios destinatarios, una cabecera prohibida, CR/LF en una cabecera; también local parts entre comillas y direcciones internacionales (IDN), no soportadas |
| `recipient_refused` | el servidor rechazó los destinatarios antes de que saliera nada: un nuevo intento, después de que el usuario actúe, no es un duplicado |
| `required_fact_missing` | la oferta pide un dato que el perfil no indica |
| `cv_missing` | ningún CV PDF legible para esta candidatura |
| `cover_letter_required` | la oferta pide una carta de presentación; se pidió al Scrittore |

Qué haces, siempre igual:

1. **Nada sobre esa posición.** El comando ya avisó al usuario una vez.
2. **No la reintentes.** La cola la retiene (`email_blocked_human`,
   `email_send_outcome_unknown`, ...) hasta que el usuario actúe.
3. **Pasa a la siguiente posición** de la cola.

## Nunca

- enviar un email de otra forma que no sea este comando;
- ejecutar `send` sobre una posición que no está en la última lectura de la cola;
- reintentar tras `send_started`, `send_outcome_unknown` o `receipt_incomplete`;
- escribir tú `applied`, `applied_via` o `apply_requested`;
- pegar la contraseña SMTP, o pedírsela al usuario en el chat.

## Comprobar después

```bash
python3 /app/shared/skills/email_application.py status --position-id "$PID" --json
```

`state: sent` con un `message_id` = el comando registró el envío por email.
