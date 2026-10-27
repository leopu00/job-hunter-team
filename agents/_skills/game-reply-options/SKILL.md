---
name: game-reply-options
description: Offer 2-5 context-specific clickable reply buttons in the JHT game chat when they genuinely make the user's next decision easier. Use only for a small bounded choice; otherwise answer normally with jht-send. Never use these as a fixed onboarding tree.
allowed-tools: Bash(jht-reply-options *)
---

# Generated reply options in the game

When a user message admits a few clear next moves, close your turn with one
prompt and 2–5 replies generated for that exact context:

```bash
jht-reply-options --prompt 'Which part should we tackle first?' \
  'Review my target roles' 'Check my profile gaps' 'Show the best positions'
```

The game renders those choices as buttons while keeping free text available.
Clicking a button sends its text back as an ordinary user message.

Rules:

- Choices are optional, specific to the current conversation and never copied
  from the offline authored onboarding.
- Use 2–5 concise, mutually useful choices. Do not offer a fake choice whose
  outcome you cannot perform.
- `jht-reply-options` is the final reply for that turn. Do not follow it with
  `jht-send`, or the buttons would correctly disappear below the newer reply.
- For open-ended questions or a direct answer, use `jht-send` as usual.

## A `$` in the text: single quotes or stdin

Inside double quotes the shell reads `$1` and `$2` as its own arguments and replaces them with nothing **before the tool runs**: "Plus — $20/month; Pro — $200/month" reaches the user as "Plus — 0/month; Pro — 00/month", and nothing downstream can bring the digits back. Whenever the text has a `$` (prices, amounts), write it between single quotes, or pass it on stdin.

```bash
# Single quotes for the labels; the prompt from stdin: "-" reads it, the quoted delimiter keeps every $
jht-reply-options --prompt - 'Plus — $20/month' 'Pro — $100/month' <<'TXT'
Which plan do you want? Plus — $20/month; Pro — $100/month
TXT
```
