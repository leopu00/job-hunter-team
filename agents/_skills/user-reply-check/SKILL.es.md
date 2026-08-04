<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: user-reply-check
description: Lee las respuestas del usuario que llegaron a traves del dashboard web (canal de respaldo cuando Telegram estaba caido/no configurado). Ejecutalo al inicio de cada iteracion del loop. La herramienta devuelve las respuestas no vistas para TU agente y las marca como vistas para que no las proceses dos veces. Esta es la mitad "marker prompt-injection" del patron notify-user (decision 2026-05-13).
allowed-tools: Bash(jht-check-user-replies *)
---

# user-reply-check — recoge las respuestas del usuario enviadas desde el dashboard web

El usuario puede responder a tus mensajes `notify-user` desde dos lugares:

1. **Telegram** — responde desde su telefono; el `tg-bridge` inyecta el mensaje en tu tmux como `[@utente -> @<agente>] [TG] <body>`. Lo ves inline. **Nada que hacer aqui.**
2. **Dashboard web** — cuando `delivered_via='web'` (Telegram estaba caido/no configurado), el usuario escribe la respuesta en la tarjeta del dashboard. El texto llega a `pending_user_messages.user_reply`. Telegram NO lo ve. **Aqui es donde entra esta skill.**

Sin `user-reply-check`, las respuestas del dashboard quedarian silenciosamente en la BD para siempre.

## Cuando usarla

- ✅ Al inicio de cada iteracion del loop (Capitano: una vez por tick; Mentor: una vez por despertar de sesion; Assistente: entre ciclos de input del usuario).
- ✅ Justo despues de ejecutar `notify-user` si planteaste una `kind=question` — es probable que el usuario ya haya respondido si ha pasado algo de tiempo.
- ✅ Cuando el usuario menciona "ti ho risposto sulla dashboard" pero no viste nada via Telegram.

## Cuando NO usarla

- ❌ Para mensajes entrantes de Telegram — `tg-bridge` los maneja; ves `[TG] …` directamente.
- ❌ Como loop de polling sin trabajo entre medio — es un check, no un watcher. Cada llamada es una consulta DB ligera, pero desperdiciaras tokens leyendo "sin respuestas" 100 veces.

## Uso

```bash
# Llamada estandar al inicio del loop (marca todas las respuestas devueltas como vistas)
jht-check-user-replies --agent <your_agent_id>

# Sin consumir (debug / antes de estar seguro de querer hacer ack)
jht-check-user-replies --agent <your_agent_id> --peek

# Salida estructurada para pasar a tu razonamiento
jht-check-user-replies --agent <your_agent_id> --json
```

`<your_agent_id>` debe coincidir con el `--agent` que usaste en `jht-notify-user`. Cada agente tiene su propia cola — las respuestas para el Capitano nunca aparecen para el Mentor.

## Salida

Salida vacia = nada nuevo para ti. Procesalo como un no-op silencioso y continua tu loop.

Salida no vacia (formato legible):

```
[USER REPLY via WEB — id=42] Usa la versione breve del CV, grazie.
    ↳ in risposta a: "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?"
    ↳ kind=question created=2026-05-13 12:00:00 reply_at=2026-05-13 14:30:00
```

Formato JSON (`--json`):

```json
[
  {
    "id": 42,
    "agent": "capitano",
    "body": "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?",
    "kind": "question",
    "related_position_id": 17,
    "user_reply": "Usa la versione breve del CV, grazie.",
    "user_reply_at": "2026-05-13 14:30:00",
    "created_at": "2026-05-13 12:00:00"
  }
]
```

## Como responder

El usuario abrio la conversacion en el **dashboard web**, no en Telegram. Espera que tu respuesta aparezca ahi tambien. Entonces:

1. Llama a `jht-notify-user --agent <your_id> --no-telegram "<reply>"`. El flag `--no-telegram` es importante — fuerza `delivered_via='web'` para que la respuesta llegue al mismo canal que el usuario esta leyendo.
2. Opcionalmente incluye `--position-id <N>` cuando el mensaje original tenia uno (misma posicion, mismo contexto).
3. **NO** envies la respuesta tambien via `jht-telegram-send`. El usuario recibiria una notificacion en su telefono sobre una conversacion que esta teniendo en su navegador — confuso y ruidoso.

Si la respuesta es un simple acuse de recibo ("ok, ricevuto"), puedes incluso omitir el nuevo mensaje: `acknowledged_at` ya fue establecido cuando el usuario escribio la respuesta, asi que el usuario sabe que la recibiste tan pronto como marcas `agent_seen_reply_at` (esta skill lo hace automaticamente).

## Idempotencia

Cada llamada sin `--peek` actualiza `agent_seen_reply_at = CURRENT_TIMESTAMP` para cada fila devuelta. La siguiente llamada no devuelve nada (hasta que llegue una nueva respuesta). Si crasheas entre leer la salida y actuar sobre ella, la respuesta SI esta marcada como vista — no hay reentrega automatica. Usa `--peek` para ejecuciones diagnosticas donde no quieras consumir.

## Latencia

La respuesta tarda:
- **Modo local**: ~0 (el dashboard escribe SQLite directamente via `/api/pending-messages/[id]/reply`).
- **Modo cloud (VPS)**: hasta `--interval` segundos del daemon cloud-sync. Por defecto 30s. No esperes tiempos sub-segundo en VPS.

Si el usuario se queja "respondi hace 10 segundos y no has confirmado," revisa `jht cloud status` — probablemente esta en VPS esperando el pull.

## Anti-patrones

- ❌ Polling en un loop ajustado (`while true; jht-check-user-replies; sleep 1`). Usa la cadencia natural de tu loop de agente existente.
- ❌ Llamar con el valor `--agent` incorrecto (ej. el Capitano llamando `--agent mentor`). Consumirias las respuestas de otro y el propietario legitimo las perderia.
- ❌ Ignorar la salida. Si llega una respuesta, reacciona — como minimo envia `notify-user --no-telegram "Ricevuto, sto elaborando."` para que el usuario sepa que el mensaje llego.

## Ver tambien

- `notify-user` — la otra mitad del par. Escribe el mensaje en `pending_user_messages`; esta skill lee la respuesta.
- `agents/_manual/db-schema.md` § `pending_user_messages` — schema, indices, ciclo de vida de una fila.
