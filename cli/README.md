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

## Read an existing VPS team

`jht existing-team` uses a one-shot native companion and the same account,
SSH pin, runtime validation and read-only queries as the desktop core. It
currently requires an existing local desktop profile and its approved runtime
candidate; it does not provision a VPS or create a team.

Build the `jht-existing-team` native binary with the desktop build process.
Install it beside `cli/bin/jht.js`, or set an explicit absolute development path:

```bash
export JHT_EXISTING_TEAM_COMPANION=/absolute/path/to/jht-existing-team
jht existing-team connect --profile <local-profile-id> --team <expected-team-id>
jht existing-team list --profile <local-profile-id> --limit 5
jht existing-team detail <position-id> --profile <local-profile-id>
jht existing-team list --profile <local-profile-id> --query <text>
jht existing-team facets --profile <local-profile-id>
jht existing-team stats --profile <local-profile-id>
```

Commands return JSON and a nonzero exit code on failure. A verified connection
can report `readiness: false` when ASSISTENTE is not running; reading positions
does not start agents or invoke a provider. Reconnecting revalidates the same
selected runtime and does not replace another selection. This preview requires
a companion built for the client platform; distribution packaging is separate.

## See also

- Full command reference: [`docs/guides/CLI-REFERENCE.md`](../docs/guides/CLI-REFERENCE.md)
- AI-agent integration: [`docs/guides/AI-AGENT-INTEGRATION.md`](../docs/guides/AI-AGENT-INTEGRATION.md)
- Shared logic lives in [`shared/`](../shared/).
