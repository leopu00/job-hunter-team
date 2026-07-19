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
