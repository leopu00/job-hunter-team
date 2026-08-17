# 🚀 Quickstart

Choose the supported path for your operating system and complete its checks in
order.
The native office and CLI are two clients of the same containerized team; you
do not need to install both.

---

## ⚠️ Before you start

JHT runs ~**400M tokens/month** (many agents working in parallel, around the clock). To make this affordable, **JHT runs on LLM subscriptions, not pay-per-use API keys** — see [`docs/about/PROVIDERS.md`](../about/PROVIDERS.md) and [ADR-0004](../adr/0004-subscription-only-no-api-keys.md).

You need an active subscription to **one** of:

|     | Provider   | Plan       | Cost/mo | Status                                                                                    |
| --- | ---------- | ---------- | ------- | ----------------------------------------------------------------------------------------- |
| 🟠  | **Claude** | Max x20    | ~€200   | ✅ Production-ready, best precision                                                       |
| 🔵  | **Codex**  | Plus / Pro | ~€100   | ✅ Proven — 1-month autonomous run (658 positions, weekly budget self-managed at 99–100%) |
| 🌙  | **Kimi**   | Pro        | ~€40    | 🧪 Beta — mass-market tier (75h + 10-day runs; multi-week observation ongoing)            |

> ⚠️ **The subscription must be dedicated to JHT** — not the same account you use for personal/work AI tasks. A shared account drains the same weekly quota twice and the team will hit rate limits unexpectedly.

For comfortable local use, keep about **8 GB of RAM available before starting
the team**. This is a measured recommendation, not a universal minimum: a
30-minute Windows run on a 12 GB machine retained more than 4 GB free with the
team and desktop active. No universal local disk minimum has been measured;
leave room for the Docker image and persistent data. The desktop releases
support Windows x64, Linux x64 and macOS (Intel: 11+; Apple silicon: 13+).

Before installing, use [Choose where to run Job Hunter Team](CHOOSE-WHERE-TO-RUN.md)
to compare a local PC, dedicated Linux PC on the LAN and VPS. The team itself
runs in Docker; the native office guides that runtime setup before activation.

---

## 🛤️ Choose your path

Pick the path that fits how you work:

|     | Path                                                      | Best for                                                |
| --- | --------------------------------------------------------- | ------------------------------------------------------- |
| 🖥️  | [Native app](#%EF%B8%8F-path-1-native-app)                | The complete visual office                              |
| 📦  | [CLI installer](#-path-2-cli-installer)                   | Terminal, automation, remote administration             |
| 🦞  | [AI agent drives JHT](#-path-3-let-your-ai-agent-do-it)   | You already use Claude Code / OpenClaw / Codex / Cursor |
| 🛠️  | [From source](#%EF%B8%8F-path-4-from-source-contributors) | Contributors                                            |

---

## 🖥️ Path 1 — Native app

The desktop application is the game-like Godot office. It exposes onboarding, provider login, runtime and VPS controls, profile, email, Telegram, cloud sync, agents and job data without an Electron or external-terminal wrapper.

Download the current release from
[GitHub Releases](https://github.com/leopu00/job-hunter-team/releases/latest):

| System      | Release asset                           | First launch                                                                                                                                                                                                                                                            |
| ----------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows x64 | `job-hunter-team-windows-x64-setup.exe` | Run the per-user installer. The optional standalone build is `job-hunter-team-windows-x64-portable.exe`. Both are unsigned, so Windows may show **Windows protected your PC**; use **More info → Run anyway** only for files from this release that match `SHA256SUMS`. |
| macOS       | `job-hunter-team.zip`                   | Unzip and open the app. The release is signed and notarized by Apple.                                                                                                                                                                                                   |
| Linux x64   | `job-hunter-team-linux-x64.tar.gz`      | Extract it, then run `./job-hunter-team.x86_64`. The archive preserves the executable bit.                                                                                                                                                                              |

The office is visible immediately. Select **Activate team** and complete all
four required gates: a local container or connected VPS runtime, provider login
in the embedded console with a plan selected, candidate profile, and working
hours. The office can launch the runtime installer; Windows users must complete
Docker Desktop's consent and first-run flow. Optional email, Telegram, account
sync and VPS setup live under **Settings**.

> The office is the interaction cockpit. The web dashboard reflects synced
> data; the CLI remains available for automation and recovery.

To run the office from source instead, use the contributor path below.

---

## 📦 Path 2 — CLI installer

Use this path for terminal-first setup, automation or remote administration.
It installs the runtime and `jht` command, not the native office.

**Recommended: download, inspect, and preview before running (macOS / Linux /
WSL2):**

```bash
curl -fsSL https://jobhunterteam.ai/install.sh -o install.sh
less install.sh
bash install.sh --dry-run
bash install.sh
```

The shorter form, after you have reviewed it, is:

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

**Windows (PowerShell, no WSL required):**

```powershell
iwr -useb https://jobhunterteam.ai/install.ps1 | iex
```

> ⚠️ Windows path requires **Docker Desktop** already installed and running. The PowerShell installer doesn't install Docker for you (Docker Desktop is an MSI with its own EULA flow — out of scope for an unattended script).

The installer:

1. Detects your OS (macOS / Linux apt+dnf+pacman / WSL2 / Windows PowerShell)
2. Installs the **Docker runtime** (macOS: Colima by default or your Docker Desktop via `--runtime`; reuses any Docker already running. `docker.io` on Linux/WSL2). On Windows: verifies Docker Desktop is running.
3. Downloads `docker-compose.yml`, the host wrapper and, on macOS/Linux, the host preflight helper.
4. Creates `~/.jht/host.env` and registers the wrapper directory on `PATH` when needed.

The wrapper handles container lifecycle on the host and forwards operational
commands to the Node CLI inside the long-running `jht` container. **No Node,
Python or tmux is required on the host, and the Docker socket is not exposed
inside the container.** See [`docs/internal/ops/vps.md`](../internal/ops/vps.md)
for the design rationale.

In an interactive terminal, the installer launches the setup wizard
automatically. If it cannot, or if you skipped onboarding, run:

```bash
jht setup          # starts the container, installs the provider CLI, logs in, starts the team
jht doctor         # verify configuration and dependencies
jht team status    # confirm the agents are running
```

Keep the wizard open when it reaches provider login. As instructed on screen,
open a second terminal and run `jht oauth-login`; complete the provider's
browser flow, then exit its terminal interface. The wizard detects the saved
credentials and runs `jht team start`. To switch provider later:
`jht providers use claude` (or `codex` / `kimi`), followed by
`jht providers update <id>` to install or update that CLI.

> 📖 Full command list — including the host wrapper (`up`/`down`/`upgrade`/`logs`/`shell`/…) vs the Node CLI split, all subcommands and flags: see [`CLI-REFERENCE.md`](CLI-REFERENCE.md).

The container runs `restart: unless-stopped`, so it survives host reboots. To stop everything: `jht down`. To upgrade: `jht upgrade`.

You'll end up with two folders:

| Folder                         | Purpose                                               | Who touches it      |
| ------------------------------ | ----------------------------------------------------- | ------------------- |
| `~/.jht/`                      | Config, `jobs.db`, agents, credentials, sessions      | Agents and CLI only |
| `~/Documents/Job Hunter Team/` | Generated CVs, reviews, attachments and final packets | You + the agents    |

> 💡 Expert mode: `bash install.sh --no-docker`. This removes the
> container boundary and requires Node 22+, tmux, git and the provider CLI on
> the host. Use it only on a dedicated machine or virtual machine.

---

## 🦞 Path 3 — Let your AI agent do it

If you already use a personal AI assistant (Claude Code, OpenClaw, Codex,
Cursor), tell it:

> _"Set up Job Hunter Team for me. I have a [Claude Max x20 / Kimi Pro /
> Codex Pro] subscription. Walk me through what you need."_

The `jht` CLI is designed for this use. Follow
[`AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) for the exact runbook and
the user-confirmation boundaries.

---

## 🛠️ Path 4 — From source (contributors)

For contributors hacking on the repo. Install Docker with Compose, Node 24,
Python 3.10 or newer and Godot 4.7, then follow
[`.github/CONTRIBUTING.md`](../../.github/CONTRIBUTING.md) for the full PR
workflow and conventions.

```bash
# 1. Clone
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# 2. Spin up the dev container with hot-reload of the local sources
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build

# 3. Configure the dev container
docker exec -it jht node /app/cli/bin/jht.js setup

# 4. Open the native office (requires Godot 4.7)
./game/tools/run.sh play

# Or work in host mode if you're iterating on the web UI
npm --prefix web run dev:host
```

> 💡 The two-file pattern (`docker-compose.yml` + `docker-compose.dev.yml`)
> keeps the production Compose file image-only (what CLI users get via
> `install.sh`). The development override rebuilds locally and bind-mounts
> `agents/`, `shared/` and `.launcher/`; the web app runs separately on the
> host. Plain `docker compose up -d` uses the published image without source
> bindings.

For dev tasks specifically:

```bash
# Start the team using the local source
docker exec -it jht node /app/cli/bin/jht.js team start

# Interaction happens in the desktop app (the game). For web-dev only,
# run the cloud app on the host: cd web && npm run dev:host (:3001)

# Tail logs
docker logs -f jht
```

See [`CLI-REFERENCE.md`](CLI-REFERENCE.md) for the full CLI reference.

---

## 🚀 First run in the native office

If you chose the native app:

1. **Open the Godot office.** The office and its agents are immediately
   explorable; setup never traps you in a blocking wizard.
2. **Talk to Assistant, Coordinator and Mentor.** Their first-run conversations
   are authored in the app and require neither an LLM nor network access. Use
   the suggested replies to prepare your profile, choose local/VPS runtime and
   provider, and set search preferences.
3. **Complete the native checklist.** Bring up the local container or connect a
   VPS, authorize Codex, Claude or Kimi in the embedded console and select its
   plan, fill the Profile page, and configure working hours. Provider links may
   open in your browser, but codes and terminal interaction remain wrapped
   inside the office.
4. **Activate the team.** Once all four gates — runtime, provider login and
   plan, profile, and working hours — are ready, the Coordinator starts the
   agents. Free-text chat then becomes available next to the authored replies.
5. **Review the output.** CVs marked "Ready to submit" land in
   `~/Documents/Job Hunter Team/cv/`; reviews, attachments and final packets
   use sibling folders. You decide what to send.

See the detailed [first-run contract](../../game/docs/FIRST-RUN.md) and the
[native VPS setup guide](VPS-SETUP-WIZARD.md).

If you chose the CLI, `jht setup` is the first-run flow: it selects the
provider, installs its official CLI, waits for subscription login, and starts
the team. Run `jht doctor` before considering setup complete. The cloud account,
Telegram and VPS paths are optional and documented separately.

---

## 🤖 The team (fixed core + dynamic worker pool)

|     | Agent                                  | Role                                                              |
| --- | -------------------------------------- | ----------------------------------------------------------------- |
| 👨‍✈️  | **Captain**                            | Coordinates the pipeline, anti-collision                          |
| 💂  | **Sentinel**                           | Event-driven watcher, intervenes on the Captain when usage drifts |
| 🕵️  | **Scout**                              | Searches EU and remote job boards                                 |
| 👨‍🔬  | **Analyst**                            | Verifies job descriptions, companies, culture                     |
| 👨‍💻  | **Scorer**                             | Assigns 0–100 score against your profile                          |
| 👨‍🏫  | **Writer**                             | Generates CVs and cover letters tailored to each position         |
| 👨‍⚖️  | **Critic**                             | 3-round blind review before submission                            |
| 👩‍💼  | **Assistant**                          | Platform copilot — helps you navigate every interface             |
| 🧙‍♂️  | **Mentor**                             | Career coach — analyzes goals/gaps/market signals                 |
| 🩺  | **Dottore** _(one-shot)_               | Agent-health — restarts stuck agents with fresh context           |
| 👷‍♂️  | **Mantenitore** _(one-shot)_           | Infra-health — container, deps, disk, mission-critical tools      |
| 📡  | **Bridge** _(infrastructure, not LLM)_ | Polls provider usage on a fixed clock, notifies the Sentinel      |

For the full architecture diagram → see the README.

---

## 🔄 Operational flow

```
🕵️ Scout → finds positions → DB (status: new)
👨‍🔬 Analyst → verifies → DB (status: checked / excluded)
👨‍💻 Scorer → scores 0-100 → DB (status: scored)
              └─ score < 40 → excluded
              └─ score >= 50 → notifies Writer
👨‍🏫 Writer → CV + cover letter → 3 rounds with 👨‍⚖️ Critic
              └─ critic_score >= 5 → status: ready
              └─ critic_score < 5  → status: excluded
👤 You → final review → submit application
```

---

## 🔧 Daily commands

```bash
# Team lifecycle
jht team start
jht team status
jht team stop

# Container lifecycle (when you're closer to the metal)
jht container up | down | recreate | logs | status

# Monitoring (Sentinel / Bridge)
jht sentinella status   # last sample summary
jht sentinella tail     # follow live JSONL
jht sentinella graph    # ASCII sparkline of recent usage

# Browse positions
jht positions list
jht positions show 42
jht positions dashboard

# Provider management
jht providers list
jht providers use claude    # switch active provider
jht providers update        # update CLI versions
```

Full CLI reference: [`docs/guides/CLI-INSTALL.md`](CLI-INSTALL.md).

---

## 🆘 Help & troubleshooting

- **Setup not finishing?** Run `jht doctor` — it tells you exactly what's missing
- **Team won't start?** Run `jht status`, then `jht logs -f`
- **Hitting rate limits?** `jht sentinella status` shows the current usage projection — see [`docs/about/MONITORING.md`](../about/MONITORING.md) for what the numbers mean
- **Found a bug or confusing step?** See [`BETA.md`](BETA.md) for testing and
  feedback channels.

---

## 📚 Where to look next

- 📘 [`README.md`](../../README.md) — project overview, story, manifesto
- 📋 [`docs/about/STORY.md`](../about/STORY.md) — origin story (legacy team results)
- 💳 [`docs/about/PROVIDERS.md`](../about/PROVIDERS.md) — which subscription to pick
- 🦞 [`docs/guides/AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) — let your AI assistant drive JHT
- 🎯 [`docs/about/VISION.md`](../about/VISION.md) — design philosophy, anti-goals, the Mentor
- 🧪 [`docs/guides/BETA.md`](BETA.md) — testing, feedback and case-study evidence
- 📊 [`docs/about/MONITORING.md`](../about/MONITORING.md) — Bridge/Sentinel test data
- 🗺️ [`docs/about/ROADMAP.md`](../about/ROADMAP.md) — what's coming next
- 🛠️ [`docs/guides/CLI-INSTALL.md`](CLI-INSTALL.md) — full CLI reference
- 🏗️ [`docs/internal/ops/INFRA.md`](../internal/ops/INFRA.md) — infrastructure diagram
