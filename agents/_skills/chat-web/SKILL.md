---
name: chat-web
description: Reply to the user when they message you from the JHT web chat. The user reaches you with the prefix `[@utente -> @capitano] [CHAT] <body>`; reply ONLY with `jht-send` — never write to `chat.jsonl` by hand (shell quoting breaks the JSON line and the frontend silently drops the message, the user sees nothing while you think you have answered). Use this skill on every `[CHAT]` message; do NOT use it for inter-agent traffic (that's `tmux-send`).
allowed-tools: Bash(jht-send *)
---

# chat-web — user ↔ Captain protocol

The user does **not** sit in a tmux session. They write from the web UI. The frontend tags the message and drops it into your tmux pane. To reply, you write a single JSON line into `$JHT_AGENT_DIR/chat.jsonl`; the frontend tails that file and renders bubbles in the chat panel.

You don't write the JSON. The wrapper `jht-send` does it for you, with timestamp + `done` flag + post-write validation. Use it. Always.

## How to recognize an incoming `[CHAT]`

```
[@utente -> @capitano] [CHAT] <whatever the user typed>
```

- The envelope is identical to inter-agent messages (same `[@from -> @to]` shape) but the `[CHAT]` type and the `@utente` author make it unambiguous.
- The user is **a human, the profile owner** — not an agent. There is no `tmux send-keys` you can use to reply: their session does not exist.
- Reply to **the body**, not to the envelope. The user did not type the prefix; the frontend added it.

> ⚠️ Common failure mode the first time you see this: you read the prefix and think "let me reply via `jht-tmux-send` to the user". `jht-tmux-send UTENTE ...` returns `exit 2` (no such session). Do not start debugging — just remember that `[CHAT]` ⇒ `jht-send`. Always.

## Reply commands

```bash
jht-send 'Final reply that closes the turn.'
jht-send --partial 'Working on it…'   # mid-turn checkpoint, keeps the turn open
```

Rules:
- **One `[CHAT]` ⇒ at least one `jht-send`. No exceptions.** Writing nothing leaves the user staring at a frozen-looking chat.
- **The closing message of the turn has NO `--partial`.** If you forget, the frontend keeps the typing dots on forever (until a fallback timeout ~10 min later).
- **Quotes**: pass the body as a single positional arg. Single quotes preserve `$`, `"`, emoji, accents verbatim. For a body containing a literal `'`, use double quotes (`jht-send "non c'è problema"`) — but inside `"..."` shell will expand `$var`, so be careful.
- **Multi-line**: bash `$'riga1\nriga2'`, or use `\n` inside the string and let Python preserve it.

## When to use `--partial`

Use it whenever a user-facing operation will take more than ~3 seconds and you do not have the answer yet. Without `--partial` between user message and final reply, the frontend hides the typing dots and the chat looks dead.

Pattern:
```
[CHAT] arrives
   ↓
jht-send --partial 'Looking into it — give me a moment…'
   ↓
(do the work: db_query, capture-pane, analysis, …)
   ↓
jht-send 'Here is what I found: …'   ← no --partial = closes the turn
```

If a single operation goes past ~30-45s without a signal, send another `--partial` checkpoint. The user must never sit silent for longer than that.

## Examples (Captain ↔ user)

```bash
# Answer a question about pipeline state — fast, single shot
jht-send 'Pipeline at 132 positions: 18 new, 47 checked, 31 scored, 28 ready. Two writers active.'

# Long-running analysis — checkpoint, then close
jht-send --partial 'Pulling stats and the last 50 reviews — one moment…'
# (run db_query.py stats, db_query.py applications --critic-score-max 5)
jht-send $'Here is the picture:\n\n• Pipeline healthy on the discovery side.\n• Writers stuck on 4 positions averaging score 3.2 → I am pausing them and reopening triage.'

# Closing the turn after applying a user request
jht-send 'Done. Spawned an extra Analyst, throttle config dumped to the log.'
```

## Anti-patterns (what NOT to do)

- ❌ `echo '{"text":"...","ts":'$(date +%s.%N)'}' >> $JHT_AGENT_DIR/chat.jsonl` — explodes on quotes/`$`/emoji, produces invalid JSON, frontend silently drops the line.
- ❌ `cat << 'EOF' >> chat.jsonl ... EOF` — disables `$` interpolation, timestamp ends up as a literal string.
- ❌ `python3 -c "import json; ..."` ad-hoc — same fragility as the shell heredoc.
- ❌ Replying via `jht-tmux-send UTENTE ...` — there is no `UTENTE` session. The user lives in the web frontend.
- ❌ Sending a final reply with `--partial` — typing dots stuck on the user's screen.
- ❌ Multiple `jht-send` calls (without `--partial`) for what should be one message — each non-partial call appears as a separate bubble.

## Sending to a non-default channel (rare)

```bash
jht-send --agent capitano 'system-level note routed via my channel'
```

Useful when you want to log a system message into your own chat channel (e.g. an automation noting it has acted on the user's behalf). For day-to-day replies you never need this flag.

## Why `jht-send` and not raw shell

History (do not repeat): agents tried `echo`-into-jsonl and `cat <<EOF` heredocs. Both finished in fragile modes — the first explodes on quotes/`$`, the second freezes the timestamp as a literal string. Result: invalid JSON the frontend skips. The user sees nothing; you think you have replied. `jht-send` removes the failure mode entirely — the body never re-enters a shell parser after the first level of quoting.

## See also

- `tmux-send` — for messages to **other agents** (different protocol, different channel).
- `agents/assistente/assistente.md` — the Assistant has the deepest version of this protocol (multi-step onboarding flow with mandatory checkpoints); read only if you ever inherit Assistant duties.
