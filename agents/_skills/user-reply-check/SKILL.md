---
name: user-reply-check
description: Read user replies that arrived via the web dashboard (fallback channel when Telegram was down/not configured). Run this at the top of every loop iteration. The tool returns the unseen replies for YOUR agent and marks them as seen so you don't process them twice. This is the "marker prompt-injection" half of the notify-user pattern (decision 2026-05-13).
allowed-tools: Bash(jht-check-user-replies *)
---

# user-reply-check — pick up user replies sent via the web dashboard

The user can answer your `notify-user` messages from two places:

1. **Telegram** — they reply on their phone; the `tg-bridge` injects the message into your tmux as `[@utente -> @<agente>] [TG] <body>`. You see it inline. **Nothing to do here.**
2. **Web dashboard** — when `delivered_via='web'` (Telegram was down/unconfigured), the user types the reply in the dashboard card. The text lands in `pending_user_messages.user_reply`. Telegram does NOT see it. **This is where this skill kicks in.**

Without `user-reply-check`, replies from the dashboard would sit silently in the DB forever.

## When to use it

- ✅ At the top of every loop iteration (Capitano: once per tick; Mentor: once per session wake-up; Assistente: between user-input cycles).
- ✅ Right after running `notify-user` if you posed a `kind=question` — likely the user already replied if some time has passed.
- ✅ When the user mentions "ti ho risposto sulla dashboard" but you didn't see anything via Telegram.

## When NOT to use it

- ❌ For Telegram inbound — `tg-bridge` handles it; you see `[TG] …` directly.
- ❌ As a polling loop with no work in between — it's a check, not a watcher. Each call is a cheap DB query, but you'll waste tokens reading "no replies" 100 times.

## Usage

```bash
# Standard call at top of loop (marks all returned replies as seen)
jht-check-user-replies --agent <your_agent_id>

# Without consuming (debug / before you're sure you want to ack them)
jht-check-user-replies --agent <your_agent_id> --peek

# Structured output for piping into your reasoning
jht-check-user-replies --agent <your_agent_id> --json
```

`<your_agent_id>` must match the `--agent` you used in `jht-notify-user`. Each agent has its own queue — replies for the Capitano never appear for the Mentor.

## Output

Empty output = nothing new for you. Process it as a silent no-op and continue your loop.

Non-empty output (human format):

```
[USER REPLY via WEB — id=42] Usa la versione breve del CV, grazie.
    ↳ in risposta a: "Per la candidatura gia' richiesta per Acme Senior FE, quale versione del CV preferisci?"
    ↳ kind=question created=2026-05-13 12:00:00 reply_at=2026-05-13 14:30:00
```

JSON format (`--json`):

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

## How to respond

The user opened the conversation on the **web dashboard**, not on Telegram. They expect your reply to appear there too. So:

1. Call `jht-notify-user --agent <your_id> --no-telegram "<reply>"`. The `--no-telegram` flag is important — it forces `delivered_via='web'` so the answer lands in the same channel the user is reading.
2. Optionally include `--position-id <N>` when the original message had one (same position, same context).
3. **Do NOT** also send the reply via `jht-telegram-send`. The user would receive a notification on their phone about a conversation they're having in their browser — confusing and noisy.

If the reply is a simple acknowledgment ("ok, ricevuto"), you can even skip the new message: `acknowledged_at` was already set when the user typed the reply, so the user knows you got it as soon as you mark `agent_seen_reply_at` (this skill does that automatically).

## Idempotency

Each call without `--peek` updates `agent_seen_reply_at = CURRENT_TIMESTAMP` for every returned row. The next call returns nothing (until a fresh reply arrives). If you crash between reading the output and acting on it, the reply IS marked seen — there's no automatic redelivery. Use `--peek` for diagnostic runs where you don't want to consume.

## Latency

The reply takes:
- **Local mode**: ~0 (dashboard writes SQLite directly via `/api/pending-messages/[id]/reply`).
- **Cloud mode (VPS)**: up to `--interval` seconds of the cloud-sync daemon. Default 30s. Don't expect sub-second turnaround on VPS.

If the user complains "I replied 10 seconds ago and you haven't acknowledged," check `jht cloud status` — they're probably on VPS waiting for the pull.

## Anti-patterns

- ❌ Polling in a tight loop (`while true; jht-check-user-replies; sleep 1`). Use the natural cadence of your existing agent loop.
- ❌ Calling with the wrong `--agent` value (e.g. the Capitano calling `--agent mentor`). You'd consume someone else's replies and the rightful owner would miss them.
- ❌ Ignoring the output. If a reply arrives, react to it — at minimum send `notify-user --no-telegram "Ricevuto, sto elaborando."` so the user knows the message landed.

## See also

- `notify-user` — the other half of the pair. Writes the message to `pending_user_messages`; this skill reads back the reply.
- `agents/_manual/db-schema.md` § `pending_user_messages` — schema, indici, ciclo di vita di una riga.
