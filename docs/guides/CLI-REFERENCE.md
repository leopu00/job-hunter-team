# ⌨️ CLI Reference — `jht`

Systematic reference of every `jht` command. For onboarding flows see
[`QUICKSTART.md`](QUICKSTART.md) (Local) and [`VPS-SETUP.md`](VPS-SETUP.md)
(VPS). AI agents driving setup should follow
[`AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md), which references the
relevant commands inline.

> ℹ️ **`jht --help` is not the full list.** Bare `jht`, `jht --help` and
> `jht -h` print a deliberately short "essential" help (5 commands) to keep a
> fresh install readable. The complete list of every registered subcommand is
> **`jht help`**. Per-command help (`jht cloud --help`, `jht burn on --help`)
> is unabridged.

## Two layers

JHT exposes the `jht` command on the host. The host wrapper
([`scripts/jht-wrapper.sh`](../../scripts/jht-wrapper.sh)) handles
**lifecycle / TTY-bound**
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
| Native office    | Provisioning + lifecycle UI            | local Docker / SSH + `docker exec`        |
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
| `jht providers update [id]`   | Node  | `npm install -g` (or `uv tool install` for Kimi) inside the container. Without `id`, updates **every** supported provider. |
| `jht providers autoupdate`    | Node  | Boot step: updates the CLI of the **active** provider only, then re-checks the model pin. Fail-safe — never fails the boot. Disable with `JHT_PROVIDER_AUTOUPDATE=0`. |
| `jht providers model-pin`     | Node  | Revisits the model the provider CLI pinned at login: picks among the aliases the config already lists (wider window), probes it, and only then writes it. `--dry-run` reports without writing; `JHT_MODEL_PIN=<alias>` freezes the choice. |
| `jht providers check`         | Node  | List providers with an update available (scriptable, exit 1 if any). |

## Team

`jht team <action>` — manage the agent processes (tmux sessions inside
the container).

| Command                              | Layer | What it does                                                |
|--------------------------------------|-------|-------------------------------------------------------------|
| `jht team list`                      | Node  | List all known agents + current status.                     |
| `jht team status`                    | Node  | Compact one-line summary (running/stopped counts).          |
| `jht team start [agente]`            | Node  | Start one agent, or the whole team if no name.              |
| `jht team stop [agente]`             | Node  | Stop one agent, or `-a/--all` to stop every agent.          |
| `jht team send <agente> <messaggio>` | Node  | Send a one-shot message to an agent's stdin.                |
| `jht team chat <agente>`             | Node  | Open an interactive chat with an agent's stdin/stdout.      |

> 💡 To reload an agent after editing `jht.config.json`:
> `jht team stop --all && jht team start`.

## Spending & pace

Two switches, opposite directions, same shape (`status` / `on` / `off`). They
are what you reach for **during** a budget problem, so they are here rather
than buried in "Advanced". Both write inside the container (the team home
belongs to the container user); `status` also works with the container down,
by reading the flag file directly.

| Command                              | Layer | What it does                                                |
|--------------------------------------|-------|-------------------------------------------------------------|
| `jht burn status` (alias `burn-intent`) | Node | Is the spending override active, and how long is left.      |
| `jht burn on [--hours N] [--reason "…"]` | Node | "The budget is not a constraint" — suspends the automatic brakes. Default 5h (one window), **hard cap 12h**. |
| `jht burn off [--reason "…"]`        | Node  | Revokes the override immediately; the automatic brakes come back. |
| `jht standby status`                 | Node  | Is standby active, and on what wake-up condition.            |
| `jht standby on --reason "…" (--until <iso> \| --wake-on-weekly [pct])` | Node | Zero-spend standby: stops the **core** roles too. An exit condition is **mandatory**. |
| `jht standby off [--reason "…"]`     | Node  | Leaves standby now: clears the flag, then `[RIPRENDI]` to everyone. |

**`jht burn`** — the automatic brakes (daily-halt, hour gate, `WORKER_FLOOR`,
the throttle ladder) act on numbers alone; without this command the only way to
say "spend, I mean it" was to dismantle them by hand, and one of them put
itself back. The override **expires** — there is no permanent form, because
every hand-made flag stayed on until someone remembered it.

What `burn` never suspends: `weekly-halt` (past it the provider stops
answering), `host_agent_cap` (a RAM ceiling — exceeding it *lowers* output),
SC-09 (one position per iteration), `freeze_team` (last net before lockout).

**`jht standby`** — with every worker throttled to 3600s and zero positions
produced, the weekly still climbed ~2 points/hour: the residual spend is the
core roles plus the three bridges, which no pacing lever touches. Standby
silences all of them without losing the alarm clock — the bridges keep
*reading* the quota (that costs no model turn) and the sentinel bridge wakes
the team when the exit condition is met. `--wake-on-weekly` (default 100 =
at the reset) is the usual one.

The exit condition is refused if absent, on purpose. And `halted` wins over
everything: with `.team-halted.flag` present, leaving standby does **not**
restart the team — the user's stop is not negotiable.

```bash
jht burn on --hours 3 --reason "shortlist due tomorrow"
jht standby on --wake-on-weekly --reason "weekly at 96%, wait for the reset"
```

## Cloud sync

Supabase-backed sync of `positions`, `scores`, `applications`. See also
[`VPS-SETUP.md`](VPS-SETUP.md) §9 for pairing flows.

All 19 subcommands, grouped by what you'd reach for them.

**Pairing & state**

| Command                       | Layer | What it does                                                          |
|-------------------------------|-------|-----------------------------------------------------------------------|
| `jht cloud login [flags]`     | Node  | Browser device-flow pairing. Saves `~/.jht/cloud.json` (mode 0600).   |
| `jht cloud pair [flags]`      | Node  | Non-interactive pairing from a `.pairing-token` (used by pid1 on first VPS boot, and by `install.sh --pairing-token`). |
| `jht cloud enable --token <t>` | Node  | Alternative pairing — paste a `jht_sync_…` token manually.            |
| `jht cloud status`            | Node  | Show sync state + last push timestamp.                                |
| `jht cloud preflight`         | Node  | Is there already an active team for this user? Exit **0** = free, **2** = taken. Run before provisioning a second machine — one team per user is a hard invariant. |
| `jht cloud disable`           | Node  | Stop sync, revoke this device token on the server, then remove it locally. |

**One-shot sync (each of these is also what the cron jobs call)**

| Command                          | Layer | What it does                                                       |
|----------------------------------|-------|--------------------------------------------------------------------|
| `jht cloud push [flags]`         | Node  | Local SQLite → cloud, one shot. `--dry-run` shows what would go.    |
| `jht cloud bootstrap-status`     | Node  | State of the automatic first-period push on a new account: remaining budget and next decision. |
| `jht cloud pull-desired-state`   | Node  | Cloud → local: brings back the user-driven flags (`write_requested`). `--full` ignores the cursor (7-day server-side lookback), `--limit <n>` caps rows per call (default 500, max 2000). |
| `jht cloud chat-sync`            | Node  | One lap of the chat lane: `chat.jsonl` ↔ SQLite, delivery to the agent pane, push to cloud. |
| `jht cloud sync-tickets`         | Node  | Ticket round-trip cloud ↔ VPS: pulls the user's tickets in, pushes the team's resolutions out. `--full` ignores the cursors (7-day lookback). |
| `jht cloud sync-directives`      | Node  | Board round-trip (`team_directives`) cloud ↔ VPS: pulls dashboard edits in, pushes local directives out. `--full` = 30-day lookback. |
| `jht cloud pull-profile`         | Node  | Downloads the profile into `candidate_profile.yml`, **only if absent**. `--force` overwrites a local profile. |
| `jht cloud restore`              | Node  | Rebuilds local SQLite from the cloud snapshot (positions/scores/applications). Destructive — `--confirm-restore` skips the prompt for CI/scripts. |

**Long-running (spawned by pid1, not by you)**

| Command                          | Layer | What it does                                                       |
|----------------------------------|-------|--------------------------------------------------------------------|
| `jht cloud daemon [flags]`       | Node  | Continuous push loop. `--interval <sec>` (env `JHT_CLOUD_PUSH_INTERVAL_SEC`). |
| `jht cloud realtime-listen`      | Node  | HTTP long-poll subscriber for `team_commands` (legacy, in cutover to team_state). Backing file: `cli/src/lib/team-commands-poller.js`. |
| `jht cloud team-state-listen`    | Node  | Desired-state reconciler: polls `team_state`, applies `should_run`/`restart_token` via `jht team start\|stop\|restart`. Co-spawned by pid1 alongside `realtime-listen` during cutover. |
| `jht cloud messages-listen`      | Node  | Poller for `user_to_agent_messages`: forwards web → tmux pane.      |
| `jht cloud file-bridge-listen`   | Node  | File-bridge poller: index + on-demand upload of CVs/attachments to the web. |

**Key flags:**
- `--url <url>` (most subcommands) — override the cloud base URL (self-hosted).
- `--name <name>` (login, pair) — name the token on the web dashboard.
- `--no-push` (login, enable) — skip the initial data push.
- `--force` (pair) — re-pair even if `cloud.json` already exists.
- `--db <path>` (push, pull-desired-state, sync-tickets, sync-directives,
  restore) — SQLite path, default `~/.jht/jobs.db`.
- `--silent` (the boot-time syncs) — minimal output.
- `--local-only` (disable) — remove the local token without server revocation
  (offline recovery only; normally use the safer default).

## Config

| Command                              | Layer | What it does                                                            |
|--------------------------------------|-------|-------------------------------------------------------------------------|
| `jht config get [key]`               | Node  | Print one key (dot-notation) or the whole config when no key.           |
| `jht config set <key> <value>`       | Node  | Write a key (dot-notation; creates intermediate objects automatically). |
| `jht profile validate [file]`        | Node  | Validate the candidate profile against the canonical schema (defaults to `$JHT_HOME/profile/candidate_profile.yml`). `--strict` treats legacy-key warnings as errors; `--json` prints `{ok, errors, warnings}`. The Scorer refuses to score without a valid profile, so this is the first thing to run when scores stop appearing. |

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
| `jht status`                         | Host  | Container name, state, start time and image. Use `jht team status` or `jht agents` for agent processes. |
| `jht agents`                         | Node  | Detailed agent process list with PIDs and tmux sessions.    |
| `jht logs [flags]`                   | Host  | Streams `docker logs`; accepts Docker log flags such as `-f` and `--tail N`. |
| `jht sentinella status`              | Node  | Sentinella module summary (last tick, throttle level).      |
| `jht sentinella tail [-n N] [-f]`    | Node  | Last N ticks (default 20); `-f/--follow` streams new ones.  |
| `jht sentinella graph [-n N]`        | Node  | ASCII sparkline of usage over the last N ticks (default 40). |
| `jht stats`                          | Node  | Aggregate stats (tasks, API, sessions). Reads the JSON stores — see the retired-store caveat below. |
| `jht report`                         | Node  | Textual project-status report. Same caveat as `jht stats`.  |

## Data & lifecycle

| Command                              | Layer | What it does                                                  |
|--------------------------------------|-------|---------------------------------------------------------------|
| `jht backup create`                  | Node  | Snapshot of `~/.jht/` to a tar.gz.                            |
| `jht backup list`                    | Node  | List available backups.                                       |
| `jht backup restore <name>`          | Node  | Restore a backup. Stops the team first.                       |
| `jht reset creds`                    | Node  | Wipe provider credentials only.                               |
| `jht reset config`                   | Node  | Wipe `jht.config.json` only.                                  |
| `jht reset full`                     | Node  | Wipe both + jobs.db. Asks for confirmation.                   |
| `jht export <source>`                | Node  | Export one JSON store. `<source>` is `sessions` \| `tasks` \| `config` \| `analytics` — **not** positions/applications/jobs.db. See below. |
| `jht import <file> -t <target>`      | Node  | Import a previously-exported file. `-t/--target` is **required**: `sessions` \| `tasks` \| `config`. |
| `jht migrate`                        | Node  | Apply pending config migrations.                              |
| `jht positions list`                 | Node  | List positions in the local DB. `--json` for machine output.  |
| `jht positions show <id>`            | Node  | Detail view of one position. `--json` for machine output.     |
| `jht positions dashboard`            | Node  | Pipeline summary (totals by status). `--json` for machine output. |

### `export` / `import` — what they actually move

Both work on the **JSON stores under `$JHT_HOME`**, one file at a time. They do
not touch `jobs.db`, so they are not the way to move positions, scores or
applications — for those, use `jht positions list --json` or `jht cloud push` /
`jht cloud restore`.

```bash
jht export config -o /tmp/cfg.json     # sources: sessions | tasks | config | analytics
jht export analytics --csv --from 2026-07-01 --to 2026-07-31
jht import /tmp/cfg.json -t config     # targets: sessions | tasks | config  (no analytics)
```

`-t/--target` is a **required** option on `import`: without it the command
exits immediately with `error: required option '-t, --target <target>' not
specified`. `--replace` swaps the whole store (default is a merge that skips
duplicates by id); `--dry-run` validates without writing.

> ⚠️ Three of the four sources — `sessions`, `tasks`, `analytics` — have had no
> writer since the text UI was removed (2026-07-25). Exporting them today gives
> you whatever was left behind, not current activity; the live picture is in
> `jht positions`, `jht agents`, `jht status`. The same caveat applies to
> `jht sessions`, `jht stats` and `jht report`, which read those files.

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
| `jht cron list [-a]`                 | List all jobs; `-a/--all` includes the disabled ones.       |
| `jht cron add <name> -s <schedule>`  | Add a job. `-s/--schedule` is **required**; also `-d/--description`, `-p/--payload <json>`, `--once` (delete after the first run). |
| `jht cron remove <id>`               | Remove a job by ID.                                         |
| `jht cron run <id> [-f]`             | Run a job now, out-of-band; `-f/--force` even if it isn't due. |
| `jht cron status`                    | State of the cron system.                                   |

`--schedule` accepts a cron expression, `every:30m` / `every:2h`, or
`at:2026-04-04T09:00`. Example: `jht cron add cloud-push -s '*/15 * * * *'`.

## Advanced / internal

These exist for developers and power-users. Skip if you're onboarding.

| Command                              | What it does                                                |
|--------------------------------------|-------------------------------------------------------------|
| `jht container up\|down\|recreate\|status\|logs` | Same as the host-layer commands but with finer-grained subcommand structure. Lives in the Node CLI for environments where the wrapper isn't installed. |
| `jht cache [action]`                 | Cache directory: `stats` (default), `prune`, `clear`.       |
| `jht tools [action]`                 | Audit the shared Python user-base the agents install into: `stats`, `list`, `outdated`, `dups`. |
| `jht notifications [action]` (alias `notif`) | Manage notification channels (beyond Telegram).     |
| `jht sessions`                       | List sessions with status and stats. Reads `sessions.json` — see the retired-store caveat above. |
| `jht secrets [action]`               | Encrypted secret store: `list`, `set`, `get`, `delete`.     |
| `jht keyring [action]`               | OS keyring integration for the `JHT_CREDENTIALS_KEY` passphrase (macOS Keychain / Windows Credential Manager / libsecret; needs `@napi-rs/keyring`). |
| `jht pid1`                           | Container entrypoint — bridges + watchdog, plus the cloud daemon once `cloud.json` appears. **Do not run on host.** |

### Registered but not wired up

These commands parse, print and exit successfully — but nothing downstream
consumes what they configure. They are listed so that a `jht help` reader
doesn't mistake them for working features; treat them as placeholders.

| Command                              | Why it does nothing yet                                     |
|--------------------------------------|-------------------------------------------------------------|
| `jht context [action]`               | Context engine — no consumer: the sources never reach the agents. (`status`, `sources`, `clear`) |
| `jht hooks [action]`                 | No executor: the hooks are never run. (`list`, `enable`, `disable`, `show`) |
| `jht webhooks [action]`              | No dispatcher: the events are never delivered. (`list`, `create`, `delete`, `test`) |
| `jht plugins [action]`               | No loader: the plugins are never loaded. (`list`, `enable`, `disable`) |
| `jht templates [action]`             | No renderer hooked to the pipeline. (`list`, `preview`)     |

---

## Common workflows

```bash
# Fresh setup (the wrapper starts the container automatically)
jht setup

# Reload after editing jht.config.json
jht team stop --all && jht team start

# Switch provider
jht providers use codex && jht providers update codex
jht team stop --all && jht team start

# Daily check
jht status && jht doctor

# Budget emergency: park the team until the weekly resets
jht standby on --wake-on-weekly --reason "weekly at 97%"

# The opposite: let it spend for one window
jht burn on --hours 5 --reason "interview on Friday"

# Push data to cloud now (instead of waiting for the daemon)
jht cloud push

# Full reset (asks confirmation)
jht reset full
```

## Where to find more

- `jht help` — every registered command, in one list. (`jht --help` on its own
  prints the short essential help; see the note at the top.)
- `jht <command> --help` — every command supports `--help`.
- [`AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) — runbook for AI agents driving setup.
- [`docs/internal/ops/vps.md`](../internal/ops/vps.md) — design rationale for the host/container split.
- [`scripts/jht-wrapper.sh`](../../scripts/jht-wrapper.sh) — source of truth for the host layer.
- [`cli/src/program.js`](../../cli/src/program.js) — source of truth for the Node layer.
