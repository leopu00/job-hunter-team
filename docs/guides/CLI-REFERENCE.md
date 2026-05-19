# CLI Reference — `jht`

Systematic reference of every `jht` command. For onboarding flows see
[`quickstart.md`](quickstart.md) (Local) and [`VPS-SETUP.md`](VPS-SETUP.md)
(VPS). AI agents driving setup should follow
[`AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md), which references the
relevant commands inline.

## Two layers

JHT exposes the `jht` command on the host. The host wrapper
(`scripts/jht-wrapper.sh`, ~165 LOC) handles **lifecycle / TTY-bound**
commands directly; everything else is forwarded to the Node CLI **inside
the long-running `jht` container** via `docker exec`. The split is
deliberate — see [`docs/internal/vps.md`](../internal/vps.md):

| Layer            | Runs on   | Why                                                                |
|------------------|-----------|--------------------------------------------------------------------|
| Host wrapper     | Host bash | Needs to talk to the Docker daemon; doesn't make sense inside.     |
| Node CLI         | Container | Reads `~/.jht/jht.config.json`, talks to agents, manages DB.       |

For every command below, the "Layer" column tells you which surface
implements it. Running `jht <command>` on the host transparently routes
to the right layer.

## Coexistence with Desktop, Web, Telegram

The CLI is one of four clients of the same backend (the `jht` container
holding `jht.config.json`, `jobs.db`, and the agent tmux sessions). You
can use them simultaneously — that's the design:

| Surface          | Role                                   | Talks to the container via                |
|------------------|----------------------------------------|-------------------------------------------|
| Desktop launcher | Provisioning + lifecycle UI            | local Docker / SSH + `docker exec`        |
| **CLI (`jht`)**  | Dev + AI agents + power user           | host wrapper → `docker exec`              |
| Web dashboard    | User interaction (positions, team)     | Supabase realtime + sync API              |
| Telegram         | Mobile chat with the agents            | bridge process inside the container       |

**Safe to mix freely**: read-only ops (`jht status`, `jht logs`,
`jht positions list`, dashboard browsing) and team lifecycle (`jht team
start/stop`) — Desktop polls and reflects the change within seconds.

**Avoid concurrent writes to `jht.config.json`**: only the Desktop
wizard uses atomic read-merge-write; the CLI's `jht config set` and
`jht setup` do last-write-wins. Don't run the Desktop wizard and a CLI
setup at the same time — finish one before starting the other. Once
setup is done, post-hoc edits to **different** config keys from
different surfaces are fine.

**Hard invariant — one team per user**: see [`docs/internal/onboarding-flow.md`](../internal/onboarding-flow.md).
You cannot run Local (CLI on this PC) **and** VPS (Desktop pointing at
Hetzner) at the same time — it splits the source of truth and breaks
cloud sync. Pick one location and stick to it for the session; switch
via wipe + re-pair, not concurrent runs.

---

## Companycycle (host wrapper)

| Command                             | Layer | What it does                                                          |
|-------------------------------------|-------|-----------------------------------------------------------------------|
| `jht up` (alias `start-container`)  | Host  | `docker compose up -d` + chown bind mounts. Idempotent.               |
| `jht down` (alias `stop-container`) | Host  | `docker compose down`. Preserves volumes/bind mounts.                 |
| `jht restart`                       | Host  | `docker compose restart jht`. Same image, fresh PID 1.                |
| `jht recreate`                      | Host  | `docker compose down && up -d`. Use after image rebuild.              |
| `jht upgrade`                       | Host  | `docker compose pull && up -d`. Picks up new image tag.               |
| `jht shell`                         | Host  | `docker exec -it jht bash`. Drop into the container for debugging.    |
| `jht logs [docker-flags]`           | Host  | `docker logs <flags> jht`. Pass `-f` for follow, `--tail N` etc.      |

## Setup & onboarding

| Command                          | Layer | What it does                                                                            |
|----------------------------------|-------|-----------------------------------------------------------------------------------------|
| `jht setup [flags]`              | Both  | Host pre-flight (swap on low-RAM VPS, lang picker) → Node interactive wizard inside the container. |
| `jht oauth-login` (alias `claude-login`) | Host  | `docker exec -it jht claude`. Forces a separate TTY for the provider's device-flow OAuth — useful when the wizard's inline OAuth step hits TTY issues. |
| `jht doctor`                     | Node  | Surfaces Docker, Node, auth, DB checks. **Must** exit 0 before declaring setup done.    |
| `jht health`                     | Node  | Granular service health (Supabase pairing, provider creds, bridge).                     |

**Key `jht setup` flags** (for `--non-interactive` mode):

```
--provider <name>             claude | openai | kimi  (default: claude)
--auth-method <method>        api_key | subscription  (default: api_key)
--api-key <key>               plaintext key
--secret-mode <mode>          plaintext | env | file  (default: plaintext)
--secret-env <name>           env var name when secret-mode=env
--secret-file <path>          file path when secret-mode=file
--subscription-email <email>  required when auth-method=subscription
--subscription-token <token>  optional; OAuth CLI usually handles this
--model <model>               override default model
--skip-health                 skip the post-config health check
--reset                       wipe existing config and start over
--non-interactive             no prompts; every required value must be a flag
```

## Providers

| Command                       | Layer | What it does                                                       |
|-------------------------------|-------|--------------------------------------------------------------------|
| `jht providers list`          | Node  | List supported providers (claude, codex, kimi).                    |
| `jht providers current`       | Node  | Show the currently active provider + model.                        |
| `jht providers use <id>`      | Node  | Set `active_provider` in `jht.config.json`.                        |
| `jht providers update [id]`   | Node  | `npm install -g` (or `uv tool install` for Kimi) inside the container. Without `id`, updates the active one. |
| `jht providers check`         | Node  | Verify the provider's CLI is installed and reachable.              |

## Team

`jht team <action>` — manage the agent processes (tmux sessions inside
the container).

| Command                              | Layer | What it does                                                |
|--------------------------------------|-------|-------------------------------------------------------------|
| `jht team list`                      | Node  | List all known agents + current status.                     |
| `jht team status`                    | Node  | Compact one-line summary (running/stopped counts).          |
| `jht team start [agente]`            | Node  | Start one agent, or the whole team if no name.              |
| `jht team stop [agente]`             | Node  | Stop one agent. Pass `--all` (where supported) for full stop. |
| `jht team send <agente> <messaggio>` | Node  | Send a one-shot message to an agent's stdin.                |
| `jht team chat <agente>`             | Node  | Open an interactive chat with an agent's stdin/stdout.      |

> 💡 To reload an agent after editing `jht.config.json`:
> `jht team stop --all && jht team start`.

## Cloud sync

Supabase-backed sync of `positions`, `scores`, `applications`. See also
[`VPS-SETUP.md`](VPS-SETUP.md) §9 for pairing flows.

| Command                       | Layer | What it does                                                          |
|-------------------------------|-------|-----------------------------------------------------------------------|
| `jht cloud login [flags]`     | Node  | Browser device-flow pairing. Saves `~/.jht/cloud.json` (mode 0600).   |
| `jht cloud pair [flags]`      | Node  | Non-interactive pairing from a `.pairing-token` (used by `install.sh --pairing-token`). |
| `jht cloud enable --token <t>` | Node  | Alternative pairing — paste a `jht_sync_…` token manually.            |
| `jht cloud status`            | Node  | Show sync state + last push timestamp.                                |
| `jht cloud push [flags]`      | Node  | One-shot sync of local SQLite → cloud.                                |
| `jht cloud daemon [flags]`    | Node  | Long-running push loop (used by container's PID 1).                   |
| `jht cloud disable`           | Node  | Remove the token from this machine. Doesn't affect cloud side — revoke separately on the web. |
| `jht cloud realtime-listen`   | Node  | WebSocket subscriber for team commands sent from the web dashboard.   |

**Key flags:**
- `--url <url>` (most subcommands) — override the cloud base URL (self-hosted).
- `--name <name>` (login, pair) — name the token on the web dashboard.
- `--no-push` (login, enable) — skip the initial data push.
- `--force` (pair) — re-pair even if `cloud.json` already exists.

## Config

| Command                              | Layer | What it does                                                            |
|--------------------------------------|-------|-------------------------------------------------------------------------|
| `jht config get [key]`               | Node  | Print one key (dot-notation) or the whole config when no key.           |
| `jht config set <key> <value>`       | Node  | Write a key (dot-notation; creates intermediate objects automatically). |

> ⚠️ `config set` bypasses the wizard's validation. For Telegram tokens,
> prefer the interactive wizard so `getMe` + chat_id long-poll run.

## Status & observability

| Command                              | Layer | What it does                                                |
|--------------------------------------|-------|-------------------------------------------------------------|
| `jht status`                         | Both  | Wrapper: container name/state/image. Forwarded inside, also lists agent processes. |
| `jht agents`                         | Node  | Detailed agent process list with PIDs and tmux sessions.    |
| `jht logs [flags]`                   | Both  | Wrapper streams `docker logs`. Inside Node, `--agent <name>` filters per-agent. |
| `jht sentinella status`              | Node  | Sentinella module summary (last tick, throttle level).      |
| `jht sentinella tail`                | Node  | Live monitoring stream.                                     |
| `jht sentinella graph`               | Node  | ASCII graph of token usage over time.                       |
| `jht stats`                          | Node  | DB stats (positions found, applications, scores).           |
| `jht report`                         | Node  | Generate a Markdown report of recent activity.              |

## Data & lifecycle

| Command                              | Layer | What it does                                                  |
|--------------------------------------|-------|---------------------------------------------------------------|
| `jht backup create`                  | Node  | Snapshot of `~/.jht/` to a tar.gz.                            |
| `jht backup list`                    | Node  | List available backups.                                       |
| `jht backup restore <name>`          | Node  | Restore a backup. Stops the team first.                       |
| `jht reset creds`                    | Node  | Wipe provider credentials only.                               |
| `jht reset config`                   | Node  | Wipe `jht.config.json` only.                                  |
| `jht reset full`                     | Node  | Wipe both + jobs.db. Asks for confirmation.                   |
| `jht export <source>`                | Node  | Export positions / applications / DB to a portable format.    |
| `jht import <file>`                  | Node  | Import a previously-exported file.                            |
| `jht migrate`                        | Node  | Apply pending SQLite migrations.                              |
| `jht positions list`                 | Node  | List positions in the local DB.                               |
| `jht positions show <id>`            | Node  | Detail view of one position.                                  |
| `jht positions dashboard`            | Node  | TTY-friendly position dashboard.                              |

## Dashboard

| Command                              | Layer | What it does                                                  |
|--------------------------------------|-------|---------------------------------------------------------------|
| `jht dashboard [-p PORT] [--no-browser]` | Node  | Local: opens `http://localhost:3000`. VPS: prints the SSH tunnel command. |
| `jht upgrade [-c|-a]`                | Both  | Wrapper: refresh image. Node: `-c` check, `-a` apply self-update. |

## Cron tasks

`jht cron <action>` — schedule periodic jobs inside the container.

| Command                              | What it does                                                |
|--------------------------------------|-------------------------------------------------------------|
| `jht cron list`                      | List all scheduled tasks with their cron expression.        |
| `jht cron add <name>`                | Add a new task (interactive: prompt for cron expression).   |
| `jht cron remove <id>`               | Remove a task by ID.                                        |
| `jht cron run <id>`                  | Run a task immediately (out-of-band).                       |
| `jht cron status`                    | Show next-fire times for all tasks.                         |

Examples: `jht cron add cloud-push '*/15 * * * *'` for 15-min cloud sync.

## Advanced / internal

These exist for developers and power-users. Skip if you're onboarding.

| Command                              | What it does                                                |
|--------------------------------------|-------------------------------------------------------------|
| `jht container up\|down\|recreate\|status\|logs` | Same as the host-layer commands but with finer-grained subcommand structure. Lives in the Node CLI for environments where the wrapper isn't installed. |
| `jht cache [clear]`                  | Manage the cache directory.                                 |
| `jht context`                        | Manage `CLAUDE.md`/`AGENTS.md` context files per agent.     |
| `jht hooks [action]`                 | Manage event hooks (pre-submit, post-score, etc.).          |
| `jht webhooks [action]`              | Manage outbound webhooks.                                   |
| `jht notifications [action]`         | Manage notification channels (beyond Telegram).             |
| `jht plugins [action]`               | Plugin system (early stage).                                |
| `jht templates [action]`             | Manage CV / cover-letter templates.                         |
| `jht sessions`                       | List / kill agent sessions.                                 |
| `jht secrets [action]`               | Secret store integration (`secret-ref` style).              |
| `jht keyring [action]`               | OS keyring integration (macOS Keychain / Windows Credential Manager / libsecret). |
| `jht pid1`                           | Container entrypoint — bootstraps tmux, cloud daemon, agent supervisor. **Do not run on host.** |

---

## Common workflows

```bash
# Fresh setup (Local or VPS — same command)
jht up && jht setup

# Reload after editing jht.config.json
jht team stop --all && jht team start

# Switch provider
jht providers use codex && jht providers update codex
jht team stop --all && jht team start

# Daily check
jht status && jht doctor

# Push data to cloud now (instead of waiting for the daemon)
jht cloud push

# Full reset (asks confirmation)
jht reset full
```

## Where to find more

- `jht <command> --help` — every command supports `--help`.
- [`AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) — runbook for AI agents driving setup.
- [`docs/internal/vps.md`](../internal/vps.md) — design rationale for the host/container split.
- [`scripts/jht-wrapper.sh`](../../scripts/jht-wrapper.sh) — source of truth for the host layer.
- [`cli/src/program.js`](../../cli/src/program.js) — source of truth for the Node layer.
