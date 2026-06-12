# ⌨️ tui — terminal UI

Terminal interface for Job Hunter Team: drives the team, streams agent activity,
and handles setup/auth from a TUI instead of the web dashboard.

- **Package:** `jht-tui` · **Stack:** Node.js · TypeScript

## Layout

```
src/
  tui.ts                 entry point
  tui-runtime.ts         main runtime loop
  tui-client.ts          backend client
  tui-command-handlers.ts / tui-event-handlers.ts   input & event routing
  tui-stream-assembler.ts  assembles streamed agent output
  tui-layout.ts / tui-theme.ts   rendering
  tui-setup.ts / tui-profile.ts / tui-tasks.ts   flows
  tui-tmux.ts            tmux session control
  auth/ · oauth/         login flows
  components/            reusable TUI widgets
```

## Run

```bash
npm run dev          # watch mode
npm run build && npm start
```

## See also

- Shared logic lives in [`shared/`](../shared/).
- CLI counterpart: [`cli/`](../cli/).
