---
name: telegram-send
description: Send a message to the user via Telegram (outbound). Use this on the Telegram bridge — the user is on their phone, NOT in front of the web dashboard. Wrapper `jht-telegram-send` resolves bot token + chat_id from config; never call the Bot API directly.
allowed-tools: Bash(jht-telegram-send *)
---

# telegram-send — outbound to the user via Telegram

The user reaches you (the Assistente) primarily from their phone. They send PDFs, voice notes, plain messages to the bot. The bot relays inbound traffic to your tmux. **Outbound** — your reply, a welcome message, a generated CV — goes through `jht-telegram-send`.

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
jht-telegram-send "<message body>"
jht-telegram-send --html "<b>Welcome</b> — send me your CV when ready."
jht-telegram-send --chat-id 1401844094 "explicit override (rare)"
```

Resolution order (no need to memorise — the wrapper does it):
1. `$TELEGRAM_BOT_TOKEN` / `$TELEGRAM_CHAT_ID` env vars
2. `$JHT_HOME/credentials/telegram_bot.json` (`.token`)
3. `$JHT_HOME/jht.config.json` → `channels.telegram.{bot_token,chat_id}`

If either is missing, the wrapper exits non-zero with a clear message. Don't try to recover — surface the error to the user in a `jht-send` reply on the web channel, or log it.

## Examples (Assistente ↔ user)

```bash
# Welcome on first boot (no profile yet)
jht-telegram-send "Ciao! Sono l'Assistente del Job Hunter Team. Mandami qui il tuo CV (PDF va benissimo) o raccontami in due righe cosa cerchi — parto da lì."

# Reply to an inbound TG message
jht-telegram-send "Ricevuto, sto guardando il CV. Dammi 30s."

# Push artifact
jht-telegram-send --html "<b>CV per Acme — Senior FE</b> pronto.\nLo trovi in <code>~/Documents/Job Hunter Team/output/2026-05-12/acme-senior-fe/</code>."
```

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

## Anti-patterns

- ❌ `curl https://api.telegram.org/bot$TOKEN/sendMessage` by hand — quoting + URL-encoding bugs, no retry, no chunking.
- ❌ Reading `~/.jht/credentials/telegram_bot.json` and parsing JSON inline in your shell — fragile, the wrapper already does it correctly.
- ❌ Putting the chat_id in the message body ("for chat 123…") — there is exactly **one** user per VPS, the wrapper knows it.

## See also

- `chat-web` — when the user is on the **web dashboard**, not Telegram.
- `tmux-send` — when you need to talk to another agent.
- `agents/assistente/assistente.md` — your role guide; the Telegram path is your "phone-side" interface to the same user.
