---
name: telegram-send
description: Send a message to the user via Telegram (outbound). Use this on the Telegram bridge — the user is on their phone, NOT in front of the web dashboard. Wrapper `jht-telegram-send` resolves bot token + chat_id per-agent from config (`--from assistente|capitano|mentor`); never call the Bot API directly.
allowed-tools: Bash(jht-telegram-send *)
---

# telegram-send — outbound to the user via Telegram

The user reaches you primarily from their phone. They send PDFs, voice notes, plain messages to **your dedicated bot**. The bridge relays inbound traffic to your tmux. **Outbound** — your reply, a welcome message, a generated CV — goes through `jht-telegram-send`.

## 3 bot dedicati (decisione 2026-05-13 rev2)

Each user-facing agent has its **own Telegram bot**:
- 👨‍💼 Assistente → `--from assistente` (default)
- 👨‍✈️ Capitano → `--from capitano`
- 🧙‍♂️ Mentor → `--from mentor`

The wrapper picks token + chat_id from `channels.telegram.bots.<role>` in the config. If you omit `--from`, you can also set `JHT_TG_BOT_ROLE=<role>` in the agent env — the wrapper reads it as default.

## When to use it

- ✅ Initial welcome message after the wizard completes (boot prompt).
- ✅ Reply to a Telegram-originated chat (the inbound bridge prefixes it with `[@utente -> @assistente] [TG]`).
- ✅ Push a generated artifact (CV, cover letter) the user asked for.
- ✅ Onboarding nudges ("send me your CV, even a draft is fine").

**Do not** use it for:
- ❌ Inter-agent messages — use `tmux-send` instead.
- ❌ Replies to web chat (`[@utente -> @assistente] [CHAT]`) — use `jht-send`.
- ❌ Heavy attachments (>20 MB). Bot API ceiling; for big files use the dashboard or a relay (future).

## Usage

```bash
# Default = bot Assistente (oppure ruolo letto da JHT_TG_BOT_ROLE)
jht-telegram-send "<message body>"

# Routing esplicito per ruolo
jht-telegram-send --from capitano "Notifica: 10 nuove posizioni ready."
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana..."

# Override chat_id (raro — debug / multi-tenant futuro)
jht-telegram-send --chat-id 1401844094 "explicit override"
```

Resolution order (no need to memorise — the wrapper does it):
1. `$TELEGRAM_BOT_TOKEN` / `$TELEGRAM_CHAT_ID` env vars (override esplicito)
2. `$JHT_HOME/jht.config.json` → `channels.telegram.bots.<role>.{bot_token,chat_id}` (role = `--from` o `$JHT_TG_BOT_ROLE`, default `assistente`)
3. `$JHT_HOME/credentials/telegram_bot.json` (`.token`) — fallback legacy

If either is missing, the wrapper exits non-zero with a clear message. Don't try to recover — surface the error to the user in a `jht-send` reply on the web channel, or log it.

## Examples

```bash
# (Assistente) — Welcome on first boot (no profile yet)
jht-telegram-send "Ciao! Sono l'Assistente del Job Hunter Team. Mandami qui il tuo CV (PDF va benissimo) o raccontami in due righe cosa cerchi — parto da lì."

# (Assistente) — Reply to inbound TG
jht-telegram-send "Ricevuto, sto guardando il CV. Dammi 30s."

# (Capitano) — Notifica batch di posizioni ready
jht-telegram-send --from capitano "10 posizioni ready, top 3 per score: ..."

# (Mentor) — Nudge strategico settimanale
jht-telegram-send --from mentor --html "<b>Step di crescita</b> della settimana: ..."

# (Assistente) — Push artifact
jht-telegram-send --html "<b>CV per Acme — Senior FE</b> pronto.\nLo trovi in <code>~/Documents/Job Hunter Team/output/2026-05-12/acme-senior-fe/</code>."
```

## Escape sequences (`\n`, `\t`, `\r`)

The wrapper interprets `\n`, `\t`, `\r` in your message as **real newlines/tabs/CRs** before sending to Telegram. So you can write:

```bash
jht-telegram-send "Ciao!\n\nTi aiuto a configurare il profilo."
```

and the user receives a proper paragraph break — not the literal `\n\n` text. Same applies to `--html` (Telegram renders a newline as a line break in the HTML stream).

If you need a literal backslash followed by `n` (rare), pre-escape it: `\\n` → wrapper turns it into `\n` (since the first `\\` becomes `\` only in your shell string; inside the wrapper there's no double-substitution).

## Long messages

The Bot API truncates at 4096 chars. The wrapper splits on `\n` / spaces and sends multiple messages. The user receives a sequence — keep tone consistent across chunks.

## HTML / Markdown

Telegram supports a subset:
- HTML: `<b>`, `<i>`, `<u>`, `<s>`, `<code>`, `<pre>`, `<a href="…">`. Escape `<`, `>`, `&` in body text.
- MarkdownV2 (`--markdown`): supported but escaping rules are painful (`. ( ) ! _ * [ ]` all need backslash). Prefer `--html`.

If you're unsure, send **plain text** (no flag). The user gets a perfectly readable message.

## Failure modes

| Exit | Cause | What to do |
|------|-------|------------|
| 2 | Token missing | The bot was never configured. Surface error on web channel, ask the user to re-run setup. |
| 3 | chat_id missing | Same as above — the wizard didn't capture the chat_id. |
| 4 | HTTP non-200 | Network blip or Telegram outage. Retry once after 5s. If still failing, log and move on. |
| 5 | `ok: false` from Bot API | Usually invalid chat_id or bot blocked by user. Don't retry — capture the response body in your scratch dir and notify on web channel. |

## Reply keyboard persistente (F-1.B, task #50)

The 3 user-facing bots (assistente / capitano / mentor) can attach a
2-col persistent reply keyboard with `--keyboard <role>`. The keyboard
stays visible in the user's Telegram client across messages until you
explicitly remove it (we don't, by design — keep it always there so
non-tech users see the affordance).

```bash
# Assistente — 📊 Budget · 📈 Pipeline · 🗺️ Mappa · ⭐ Top CV · 📅 Reset · ❓ Help
jht-telegram-send --from assistente --keyboard assistente "Pipeline: 15 CV pronti per apply, ..."

# Capitano — 📈 Pipeline · 📊 Budget · 👥 Team · ⭐ Ready · 🛠 Triage · ❓ Help
jht-telegram-send --from capitano --keyboard capitano "..."

# Mentor — 📋 Digest · 🔁 Patterns · ⭐ Top · 💰 Salary · ❓ Help
jht-telegram-send --from mentor --keyboard mentor "..."
```

When the user taps a button, the bot receives the button text as a
normal text message (e.g. tap `📊 Budget` → tmux gets `📊 Budget` as
TG message body). The agent treats it equivalently to a slash command
(e.g. `/budget`) and produces the chart / status.

Keyboard appears only on the **last** chunked message of a long send
so 4096+ char outputs don't flicker the keyboard mid-thread.

## Slash commands menu (F-1.A, task #50)

The `tg-bridge.py` registers a per-role `setMyCommands` set at boot
(`/budget`, `/pipeline`, `/help`, …). They appear in the Telegram
client's `/` sticky menu — first thing a new user sees. You don't need
to do anything: cli/role configuration is enough, the bridge handles
the API call. List per role in `.launcher/tg-bridge.py::BOT_COMMANDS`.

## Anti-patterns

- ❌ `curl https://api.telegram.org/bot$TOKEN/sendMessage` by hand — quoting + URL-encoding bugs, no retry, no chunking.
- ❌ Reading config / credentials and parsing JSON inline in your shell — fragile, the wrapper already does it correctly.
- ❌ Mandare con `--from` un ruolo che non è il tuo (es. l'Assistente che scrive sul bot del Capitano) — confonde l'utente, ognuno parla sul suo bot. Cross-agent comms vanno via `tmux-send`.
- ❌ Putting the chat_id in the message body ("for chat 123…") — there is exactly **one** user per VPS, the wrapper knows it.

## See also

- `chat-web` — when the user is on the **web dashboard**, not Telegram.
- `tmux-send` — when you need to talk to another agent.
- `agents/<role>/<role>.md` — your role guide; the Telegram path is your "phone-side" interface to the user.
