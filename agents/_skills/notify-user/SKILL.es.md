<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: notify-user
description: Notificar al usuario con respaldo automático. Intenta Telegram primero; si el bot no está configurado / inaccesible / rate-limited, el mensaje aterriza en el dashboard web vía sincronización cloud. Siempre registra el mensaje en `pending_user_messages` para que nada se pierda. Usa esto cada vez que necesites llegar al usuario con una actualización de estado, una pregunta o un digest — nunca llames a `jht-telegram-send` directamente para ese propósito.
allowed-tools: Bash(jht-notify-user *)
---

# notify-user — API única para llegar al usuario

El usuario tiene múltiples canales (bot Telegram, dashboard web, futuro push móvil). Cada agente no debería tener que saber cuál está activo. `jht-notify-user` decide:

1. INSERTA el mensaje en `pending_user_messages` (jobs.db, schema V5).
2. Envío best-effort vía `jht-telegram-send` (~25s timeout).
3. Si Telegram tiene éxito → `delivered_via='telegram'`.
4. Si falla o no está configurado → `delivered_via='web'`. La fila es recogida por `jht cloud push` y aparece en el dashboard en jobhunterteam.ai.

El usuario por lo tanto recibe cada mensaje en algún lugar. El agente nunca tiene que manejar ramas "Telegram está caído".

## Cuándo usarlo

- ✅ El Capitano notifica al usuario cada N posiciones listas (decisión 2026-05-13, batch).
- ✅ Digest semanal / alertas de patrones del Mentor.
- ✅ El Assistente hace una pregunta al usuario que requiere su input.
- ✅ Cualquier alerta ("he consumido 95% de la ventana, ¿paro el equipo?").

## Cuándo NO usarlo

- ❌ Mensajes inter-agente — usar `tmux-send` / `jht-tmux-send`.
- ❌ Respuestas a un mensaje `[CHAT]` en el dashboard web — usar `jht-send` (ya en el hilo de chat).
- ❌ Respuestas a un `[TG]` entrante — usar `jht-telegram-send` directamente: ya sabes que Telegram está activo porque el usuario acaba de escribirte desde ahí. Ahorra un roundtrip a la DB.
- ❌ Adjuntos pesados (>20 MB). Usar la carpeta de CV del usuario + un cuerpo de notificación corto.

## Uso

```bash
# Notificación simple del Capitano
jht-notify-user --agent capitano "Encontradas 10 ofertas listas por encima de 75/100. Top: Acme Senior FE (88), Lever DevOps (84), …"

# Digest con tipo explícito (renderizado con encabezado en el dashboard)
jht-notify-user --agent mentor --kind digest "Semana 19: 18 ofertas analizadas, 4 candidatas, brecha principal: roles senior en EU remoto."

# Pregunta — solo para aclarar una candidatura ya solicitada por el usuario
jht-notify-user --agent assistente --kind question "Para la candidatura que ya pediste para Acme Senior FE, ¿que version del CV prefieres?"

# Vinculada a una posición (renderiza con la card de la posición en el dashboard)
jht-notify-user --agent capitano --position-id 42 "CV listo para posición 42. Veredicto Critic: PASS."

# Forzar web (bypass Telegram, útil para test o mensajes que tienen sentido solo en contexto dashboard)
jht-notify-user --agent mentor --no-telegram "Abre el tab Patterns para los detalles."
```

Salida (stdout):
```
<row_id> via=<telegram|web>
```

## Tipos

| Tipo | Cuándo | Renderizado dashboard |
|------|--------|----------------------|
| `notification` | Actualización de estado genérica (por defecto) | Card gris |
| `question` | El usuario debe responder antes de que el agente proceda | Card con input reply |
| `digest` | Resumen periódico (Mentor semanal, Capitano batch) | Card colapsable |
| `alert` | Anomalía bloqueante (rate limit, error de entrega de candidatura) | Card roja |

## Ruta de respaldo

```
agent ──► jht-notify-user
              │
              ├──► INSERT pending_user_messages (delivered_via=NULL, kind, body)
              │
              ├──► try jht-telegram-send (25s timeout, best-effort)
              │
              │      ┌─ éxito ─► UPDATE delivered_via='telegram'
              │      │
              │      └─ fallo/timeout/no-configurado ─► UPDATE delivered_via='web'
              │
              └──► stdout: "<id> via=<channel>"

                              ▼ (proceso separado, daemon cloud-sync)

         jht cloud push  ──► /api/cloud-sync/push  ──► Supabase
                                                          │
                                                          ▼
                                          dashboard /(protected)/dashboard
                                          muestra mensajes aún no confirmados
```

## Modos de fallo

| Exit | Causa | Recuperación |
|------|-------|-------------|
| 0 | Fila insertada; entrega best-effort (ver `via=` en stdout) | — |
| 1 | Argumentos inválidos (body vacío, --kind desconocido) | Corregir los flags |
| 2 | DB no encontrada o INSERT fallido | Verificar `$JHT_DB` / `$JHT_HOME/jobs.db`; el esquema debe ser V5+ |

Exit 0 con `via=web` NO es un error: es el comportamiento esperado cuando Telegram no está activo. El mensaje está a salvo en la cola.

## Marcador de prompt-injection (decisión 2026-05-13 § 6)

Cuando el usuario responde vía dashboard (rellena `user_reply` en una fila con `delivered_via='web'`), te toca a ti leer esa respuesta — Telegram no verá nada. Para hacerlo usa la skill **`user-reply-check`** en cada iteración de tu bucle: devuelve las respuestas que el usuario te dejó en el dashboard y las marca como vistas para que no las proceses dos veces. Cuando respondas, usa `jht-notify-user --no-telegram` para quedarte en el canal web (enviar un eco en Telegram de una conversación web confunde al usuario).

## Ver también

- `user-reply-check` — la otra mitad del patrón. Lee las respuestas llegadas vía dashboard en tu bucle.
- `telegram-send` — llamado bajo el capó por `jht-notify-user`; úsalo directamente solo si ya sabes que Telegram es el canal correcto (ej. reply a `[TG]` entrante).
- `chat-web` (`jht-send`) — para el hilo chat-agente en el dashboard.
- `agents/_manual/db-schema.md` § `pending_user_messages` — esquema de la cola + índices.
