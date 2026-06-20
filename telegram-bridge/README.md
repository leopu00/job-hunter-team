# 💬 telegram-bridge — bidirectional Telegram bridge

Bidirectional Telegram bridge for Job Hunter Team: relays messages between the
user and the team (orders in, notifications/deliverables out) and ingests
documents (e.g. CVs) sent to the bot.

- **Package:** `@jht/telegram-bridge` · **Stack:** TypeScript · grammy

## Layout

```
src/
  bot.ts        grammy bot setup
  bridge.ts     bidirectional relay logic
  commands.ts   command handlers
  send.ts       outbound messaging
  token.ts      bot token resolution
```

## Run

```bash
npm run dev          # watch mode
npm start            # production
```

## See also

- Telegram design (3 bots, ingest, working hours): [`docs/internal/architecture/bot-telegram.md`](../docs/internal/architecture/bot-telegram.md)
- Terminology / interaction roadmap: web-first is primary, Telegram secondary.
