<!-- @translation: es, ai-translated 2026-06-06 -->
---
name: telegram-send
description: Envía un mensaje al usuario a través de Telegram (salida). Usa esto en el bridge de Telegram — el usuario está en su teléfono, NO frente al dashboard web. El wrapper `jht-telegram-send` resuelve bot token + chat_id por agente desde la configuración (`--from assistente|capitano|mentor`); nunca llames directamente a la API del Bot.
allowed-tools: Bash(jht-telegram-send *)
---

# telegram-send — mensajes salientes al usuario vía Telegram

El usuario te contacta principalmente desde su teléfono. Envía PDFs, notas de voz, mensajes de texto a **tu bot dedicado**. El bridge retransmite el tráfico entrante a tu tmux. **Saliente** — tu respuesta, un mensaje de bienvenida, un CV generado — pasa a través de `jht-telegram-send`.

## 3 bots dedicados (decisión 2026-05-13 rev2)

Cada agente orientado al usuario tiene su **propio bot de Telegram**:
- 👩‍💼 Assistente → `--from assistente` (por defecto)
- 👨‍✈️ Capitano → `--from capitano`
- 🧙‍♂️ Mentor → `--from mentor`

El wrapper obtiene token + chat_id de `channels.telegram.bots.<role>` en la configuración. Si omites `--from`, también puedes establecer `JHT_TG_BOT_ROLE=<role>` en el entorno del agente — el wrapper lo lee como valor por defecto.

## Cuándo usarlo

- ✅ Mensaje de bienvenida inicial tras completar el wizard (prompt de arranque).
- ✅ Respuesta a un chat originado en Telegram (el bridge entrante lo prefija con `[@utente -> @assistente] [TG]`).
- ✅ Envío de un artefacto generado (CV, carta de presentación) que el usuario pidió.
- ✅ Recordatorios de onboarding ("envíame tu CV, incluso un borrador está bien").

**No** lo uses para:
- ❌ Mensajes entre agentes — usa `tmux-send` en su lugar.
- ❌ Respuestas al chat web (`[@utente -> @assistente] [CHAT]`) — usa `jht-send`.
- ❌ Adjuntos pesados (>20 MB). Límite de la API Bot; para archivos grandes usa el dashboard o un relay (futuro).

## Uso

```bash
# Default = bot Assistente (oppure ruolo letto da JHT_TG_BOT_ROLE)
jht-telegram-send "<cuerpo del mensaje>"

# Routing esplicito per ruolo
jht-telegram-send --from capitano "Notifica: 10 nuove posizioni ready."
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana..."

# Override chat_id (raro — debug / multi-tenant futuro)
jht-telegram-send --chat-id 1401844094 "explicit override"
```

Orden de resolución (no necesitas memorizarlo — el wrapper lo hace por ti):
1. Variables de entorno `$TELEGRAM_BOT_TOKEN` / `$TELEGRAM_CHAT_ID` (override explícito)
2. `$JHT_HOME/jht.config.json` → `channels.telegram.bots.<role>.{bot_token,chat_id}` (role = `--from` o `$JHT_TG_BOT_ROLE`, por defecto `assistente`)
3. `$JHT_HOME/credentials/telegram_bot.json` (`.token`) — fallback legacy

Si falta alguno, el wrapper sale con código distinto de cero y un mensaje claro. No intentes recuperar — muestra el error al usuario en una respuesta `jht-send` por el canal web, o regístralo en el log.

## Ejemplos

```bash
# (Assistente) — Bienvenida en el primer arranque (sin perfil aún)
jht-telegram-send "Ciao! Sono l'Assistente del Job Hunter Team. Mandami qui il tuo CV (PDF va benissimo) o raccontami in due righe cosa cerchi — parto da lì."

# (Assistente) — Respuesta a un mensaje TG entrante
jht-telegram-send "Ricevuto, sto guardando il CV. Dammi 30s."

# (Capitano) — Notificación de batch de posiciones listas
jht-telegram-send --from capitano "10 posizioni ready, top 3 per score: ..."

# (Mentor) — Recordatorio estratégico semanal
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana: ..."

# (Assistente) — Envío de artefacto
jht-telegram-send --html "<b>CV per Acme — Senior FE</b> pronto.\nLo trovi in <code>~/Documents/Job Hunter Team/output/2026-05-12/acme-senior-fe/</code>."
```

## Secuencias de escape (`\n`, `\t`, `\r`)

El wrapper interpreta `\n`, `\t`, `\r` en tu mensaje como **saltos de línea/tabulaciones/retornos de carro reales** antes de enviar a Telegram. Así puedes escribir:

```bash
jht-telegram-send "Ciao!\n\nTi aiuto a configurare il profilo."
```

y el usuario recibe un salto de párrafo correcto — no el texto literal `\n\n`. Lo mismo aplica para `--html` (Telegram renderiza un salto de línea como interrupción de línea en el flujo HTML).

Si necesitas un backslash literal seguido de `n` (raro), pre-escápalo: `\\n` → el wrapper lo convierte en `\n` (ya que el primer `\\` se convierte en `\` solo en tu cadena de shell; dentro del wrapper no hay doble sustitución).

## Mensajes largos

La API Bot trunca a 4096 caracteres. El wrapper divide en `\n` / espacios y envía múltiples mensajes. El usuario recibe una secuencia — mantén un tono consistente entre los fragmentos.

## HTML / Markdown

Telegram soporta un subconjunto:
- HTML: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href="…">`. Escapa `<`, `>`, `&` en el texto del cuerpo.
- MarkdownV2 (`--markdown`): soportado pero las reglas de escape son engorrosas (`. ( ) ! _ * [ ]` todos necesitan backslash). Prefiere `--html`.

Si no estás seguro, envía **texto plano** (sin flag). El usuario recibe un mensaje perfectamente legible.

## Modos de error

| Salida | Causa | Qué hacer |
|--------|-------|-----------|
| 2 | Token ausente | El bot nunca fue configurado. Muestra el error en el canal web, pide al usuario que repita el setup. |
| 3 | chat_id ausente | Igual que arriba — el wizard no capturó el chat_id. |
| 4 | HTTP no-200 | Problema de red o caída de Telegram. Reintenta una vez después de 5s. Si sigue fallando, registra en log y continúa. |
| 5 | `ok: false` de la API Bot | Normalmente chat_id inválido o bot bloqueado por el usuario. No reintentar — guarda el cuerpo de la respuesta en tu directorio scratch y notifica por el canal web. |

## Sin teclado de respuesta — los comandos están en el menú ☰

No adjuntes teclados. El teclado persistente de 6 botones tapaba media conversación
en el teléfono del usuario, así que los tres bots de cara al usuario (assistente /
capitano / mentor) muestran sus comandos solo en el menú ☰ del bot
(`setMyCommands`, ver abajo). Envía mensajes simples:

```bash
jht-telegram-send --from assistente "Pipeline: 15 CV listos para aplicar, ..."
```

`--keyboard <role>` se sigue aceptando para no romper a los llamadores antiguos,
pero no adjunta nada: quita el teclado que un teléfono aún pueda mostrar. Cada bot
quita además el teclado antiguo una vez por sí mismo, en su primer mensaje.

Un comando elegido en el menú te llega como un mensaje normal (`/budget`,
`/top_cv`, …): respóndelo como respondías al texto del antiguo botón:

```text
Assistente — /budget · /budget_prev · /budget_week · /pipeline · /candles · /mappa · /mappa_it · /top_cv · /reset · /stato · /help
Capitano   — /pipeline · /budget · /team · /ready · /triage · /help
Mentor     — /digest · /patterns · /top · /salary · /help
```

## Menú de comandos slash (F-1.A, task #50)

El `tg-bridge.py` registra un conjunto `setMyCommands` por rol al arranque
(`/budget`, `/pipeline`, `/help`, …). Aparecen en el menú `/` fijo del
cliente Telegram — lo primero que un nuevo usuario ve. No necesitas hacer
nada: la configuración cli/rol es suficiente, el bridge gestiona
la llamada API. Lista por rol en `.launcher/tg-bridge.py::BOT_COMMANDS`.

## Anti-patrones

- ❌ `curl https://api.telegram.org/bot$TOKEN/sendMessage` a mano — bugs de quoting + URL-encoding, sin retry, sin chunking.
- ❌ Leer la configuración / credenciales y parsear JSON inline en tu shell — frágil, el wrapper ya lo hace correctamente.
- ❌ Enviar con `--from` un rol que no es el tuyo (ej. el Assistente que escribe en el bot del Capitano) — confunde al usuario, cada uno habla en su bot. La comunicación entre agentes va por `tmux-send`.
- ❌ Poner el chat_id en el cuerpo del mensaje ("for chat 123…") — hay exactamente **un** usuario por VPS, el wrapper lo sabe.

## Ver también

- `chat-web` — cuando el usuario está en el **dashboard web**, no en Telegram.
- `tmux-send` — cuando necesitas hablar con otro agente.
- `agents/<role>/<role>.md` — la guía de tu rol; la vía Telegram es tu interfaz "lado teléfono" hacia el usuario.
