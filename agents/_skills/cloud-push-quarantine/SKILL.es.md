---
name: cloud-push-quarantine
description: Inspecciona y recupera filas aisladas por el push cloud tras un rechazo del servidor, sin exponer su contenido. Úsala cuando sync-health indique push_quarantine.
allowed-tools: Bash(jht cloud quarantine *)
---

# cloud-push-quarantine — inspeccionar, reintentar, resolver

El push deja avanzar los datos válidos y conserva para la fila rechazada solo
metadatos seguros: tabla/tipo, identidad opaca, motivo saneado, intentos y
marcas de tiempo. Nunca solicites ni imprimas la fila de origen.

1. Inspecciona con `jht cloud quarantine list`. Comunica solo cantidad, tabla,
   identidad opaca, código del motivo, intentos y marcas de tiempo.
2. Corrige la causa local mediante el flujo propietario. No edites `jobs.db`
   manualmente ni añadas excepciones para una tabla o código de error.
3. Reintenta con `jht cloud quarantine retry <opaque-id>`. Usa el writer cloud
   canónico. Lee el resultado y repite list: el éxito cambia a `resolved`.
4. Usa `jht cloud quarantine resolve <opaque-id> --confirm` solo tras verificar
   que la fila local fue eliminada o sustituida intencionadamente y no necesita
   reintento. El historial de auditoría se conserva.

`retry all` solo se permite después de corregir una causa común y revisar todas
las tablas. Nunca copies cuerpos, títulos, rutas, user IDs, detalles del
servidor ni credenciales en chats, logs o el logbook.
