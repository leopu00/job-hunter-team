# ⌨️ CLI Reference — `jht`

Systematic reference of every `jht` command. For onboarding flows see
[`QUICKSTART.md`](QUICKSTART.md) (Local) and [`VPS-SETUP.md`](VPS-SETUP.md)
(VPS). AI agents driving setup should follow
[`AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md), which references the
relevant commands inline.

## Two layers

JHT exposes the `jht` command on the host. The host wrapper
(`scripts/jht-wrapper.sh`, ~165 LOC) handles **lifecycle / TTY-bound**
commands directly; everything else is forwarded to the Node CLI **inside
the long-running `jht` container** via `docker exec`. The split is
deliberate — see [`docs/internal/ops/vps.md`](../internal/ops/vps.md):

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
start/stop`) — the native office polls and reflects the change within seconds.

**Avoid concurrent writes to `jht.config.json`**: the native office
uses atomic read-merge-write; the CLI's `jht config set` and
`jht setup` do last-write-wins. Don't save from the native office and a CLI
setup at the same time — finish one before starting the other. Once
setup is done, post-hoc edits to **different** config keys from
different surfaces are fine.

**Hard invariant — one team per user**: see [`docs/internal/architecture/onboarding-flow.md`](../internal/architecture/onboarding-flow.md).
You cannot run Local (CLI on this PC) **and** VPS (native office pointing at
Hetzner) at the same time — it splits the source of truth and breaks
cloud sync. Pick one location and stick to it for the session; switch
via wipe + re-pair, not concurrent runs.

---

## Lifecycle (host wrapper)

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
| `jht oauth-login` (legacy alias `claude-login`) | Host  | Reads `active_provider` and opens the matching subscription flow: Claude TUI, Codex device code, or Kimi TUI. |
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
| `jht cloud disable`           | Node  | Stop sync, revoke this device token on the server, then remove it locally. |
| `jht cloud realtime-listen`   | Node  | HTTP long-poll subscriber for `team_commands` (legacy, in cutover to team_state). Backing file: `cli/src/lib/team-commands-poller.js`. |
| `jht cloud team-state-listen` | Node  | Desired-state reconciler: polls `team_state`, applies `should_run`/`restart_token` via `jht team start\|stop\|restart`. Co-spawned by pid1 alongside `realtime-listen` during cutover. |

**Key flags:**
- `--url <url>` (most subcommands) — override the cloud base URL (self-hosted).
- `--name <name>` (login, pair) — name the token on the web dashboard.
- `--no-push` (login, enable) — skip the initial data push.
- `--force` (pair) — re-pair even if `cloud.json` already exists.
- `--local-only` (disable) — remove the local token without server revocation
  (offline recovery only; normally use the safer default).

## Config

| Command                              | Layer | What it does                                                            |
|--------------------------------------|-------|-------------------------------------------------------------------------|
| `jht config get [key]`               | Node  | Print one key (dot-notation) or the whole config when no key.           |
| `jht config set <key> <value>`       | Node  | Write a key (dot-notation; creates intermediate objects automatically). |
| `jht profile validate [file]`        | Node  | Validate the candidate profile against the canonical schema (defaults to `$JHT_HOME/profile/candidate_profile.yml`). The Scorer refuses to score without a valid profile, so this is the first thing to run when scores stop appearing. |

> ⚠️ `config set` bypasses the wizard's validation. For Telegram tokens,
> prefer the interactive wizard so `getMe` + chat_id long-poll run.

### Working hours

`jht working-hours <action>` (alias `jht wh`) — when the team is allowed to
work. The weekly budget is spread across these hours, so narrowing them
concentrates the same budget into fewer hours rather than saving it.

| Command                              | What it does                                                |
|--------------------------------------|-------------------------------------------------------------|
| `jht wh show`                        | Current schedule + total hours per week.                    |
| `jht wh set <preset>`                | Apply a preset: `office` (mon–fri 09:00–18:00) · `weekend` (sat–sun 09:00–18:00) · `daytime` (every day 09:00–18:00) · `night` (every day 22:00–07:00) · `24-7`. |
| `jht wh set-custom <days> <range>`   | Custom window, e.g. `jht wh set-custom mon-fri 09:00-18:00`; `--tz <iana>` overrides the timezone. |
| `jht wh clear`                       | Remove the schedule — the team runs 24/7.                   |
| `jht wh simulate`                    | Simulate the resulting pace target (needs the container running). |

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
| `jht positions list`                 | Node  | List positions in the local DB. `--json` for machine output.  |
| `jht positions show <id>`            | Node  | Detail view of one position. `--json` for machine output.     |
| `jht positions dashboard`            | Node  | TTY-friendly position dashboard. `--json` for machine output. |

### `--json` — machine-readable output

Every `jht positions` form accepts `--json`: same query, one line of JSON on
stdout instead of the aligned table, same exit code. Filters still apply.

```bash
jht positions list --json                    # array of position objects
jht positions list -s scored --min-score 70 --json
jht positions show 42 --json                 # one object, or null if absent
jht positions dashboard --json               # totals, by_status, top_scores, applications
```

Written for scripts and for the AI agents this CLI is meant to be driven by
(see [AI-AGENT-INTEGRATION.md](AI-AGENT-INTEGRATION.md)): parsing the human
table means regexes that break the next time a column width changes. The human
format is unchanged and stays the default — `--json` is a second exit, not a
replacement. `null` (not `{}`) means not found, so "absent" and "empty" stay
distinguishable.

The same flag exists one layer down on `db_query.py` — `positions`, `position`,
`companies`, `company`, `dashboard`, `stats`, `recent-activity` — which is what
agents inside the container call directly.

### Decision verbs

| Command | Layer | What it does |
|---------|-------|--------------|
| `jht positions exclude <id> --reason <r> [--note ...]` | Python | Drops a position out of the agent queues. Reversible. |
| `jht positions restore <id>` | Python | Undoes the exclusion, back to the exact previous status. |
| `jht positions request-cv <id> [--off]` | Python | Asks the team to write the CV for this position. |
| `jht ticket open <position_id> "<text>"` | Python | Opens a user→team ticket; lands in the Captain's queue. |
| `jht ticket list` · `count` · `show <id>` · `for-position <id>` | Python | Read the ticket queue (`count` prints only the number). |
| `jht ticket assign <id> <agent>` · `resolve <id> --response "..."` | Python | Team side of the flow. |
| `jht directives` | Python | The standing orders currently in force. |
| `jht directives add "<text>" [--kind order\|strategy\|formation\|note]` | Python | An order that survives the Captain's context refresh. |
| `jht directives list [--all]` · `edit <id> "<text>"` · `archive <id>` · `show <id>` | Python | Manage the board. |

`--reason` accepts `closed`, `not_interested`, `mismatch`, `already_applied`,
`company`, `conditions`, `other` — the same set the UI offers. `other` requires
`--note`, so an exclusion is still readable in a month.

Exit codes: `0` done · `1` refused for a domain reason (no such position,
`other` without a note) · `2` bad arguments. The position verbs print one JSON
line, so a script can check the outcome without reading prose.

## Dashboard

| Command                              | Layer | What it does                                                  |
|--------------------------------------|-------|---------------------------------------------------------------|
| `jht dashboard`                      | Node  | **Deprecated** (2026-07-23): the local web dashboard was retired — interaction lives in the desktop app; browser is cloud-only (`jobhunterteam.ai`). Prints a pointer and exits. |
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
| `jht tools [action]`                 | Audit the shared Python user-base the agents install into: `stats`, `list`, `outdated`, `dups`. |
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
- [`docs/internal/ops/vps.md`](../internal/ops/vps.md) — design rationale for the host/container split.
- [`scripts/jht-wrapper.sh`](../../scripts/jht-wrapper.sh) — source of truth for the host layer.
- [`cli/src/program.js`](../../cli/src/program.js) — source of truth for the Node layer.
