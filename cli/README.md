# ⌨️ cli — the `jht` command-line interface

The `jht` CLI is the primary control surface for Job Hunter Team. The same surface
is used by humans, by the native Godot app, and by AI agents driving JHT
(see [`docs/guides/AI-AGENT-INTEGRATION.md`](../docs/guides/AI-AGENT-INTEGRATION.md)).

- **Package:** `jht-cli` · **Bin:** `jht` → [`bin/jht.js`](bin/jht.js)
- **Stack:** Node.js · Commander

## Layout

```
bin/            entry point (jht.js)
src/
  program.js    Commander program wiring
  commands/     one file per command (~40): setup, team, providers,
                cloud, doctor, sentinella, positions, profile, cron, …
  auth/         OAuth / provider login flows
  lib/          shared helpers (e.g. file-bridge-poller.js)
  utils/        misc utilities
  jht-paths.js  canonical paths resolver
wizard/         interactive setup wizard
```

## Run

```bash
npm start            # from cli/  →  runs bin/jht.js
jht team start       # once installed on PATH
jht --help           # short "essential" help (5 commands)
jht help             # list all commands
```

`jht`, `jht --help` and `jht -h` deliberately print a shortened help so a fresh
install isn't buried under 40+ subcommands; `program.js` swaps
`helpInformation` for the `ESSENTIAL_HELP` constant. The full list stays one
keystroke away as `jht help`.

## See also

- Full command reference: [`docs/guides/CLI-REFERENCE.md`](../docs/guides/CLI-REFERENCE.md)
- AI-agent integration: [`docs/guides/AI-AGENT-INTEGRATION.md`](../docs/guides/AI-AGENT-INTEGRATION.md)
- Shared logic lives in [`shared/`](../shared/).
