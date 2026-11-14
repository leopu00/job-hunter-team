# 🚀 Quickstart

Choose the supported path for your operating system and complete its checks in
order.
In 0.4.0 the team is driven from the `jht` CLI: **the desktop app is not in 0.4.0.**

---

## ⚠️ Before you start

JHT runs many agents in parallel, around the clock. In 0.4.0 you need:

|     | Provider   | How you pay | Status |
| --- | ---------- | ----------- | ------ |
| 🟢  | **GLM (Z.ai)** on the Pi harness | API key, per call | ✅ The only one offered in 0.4.0 — measured in short runs (~0.10 USD per scored position); `jht setup` asks for the key (typed hidden) |
| 🔵  | Codex (ChatGPT subscription or OpenAI key), Kimi, Claude | — | ⏳ Coming in a later release |

Details and the spending ceiling of an API key: [`docs/about/PROVIDERS.md`](../about/PROVIDERS.md).

> ⚠️ **The API key should be dedicated to JHT** — not the same account you use for personal/work AI tasks: the team runs around the clock, and its spending is easier to follow on an account of its own.

On a Mac you need Apple silicon (M1 and later; Intel Macs are not supported in
0.4) and macOS 15 or later, and **Homebrew must already be installed**: the
installer uses it to install Podman. A Mac with at least **16 GB of RAM** is
recommended. The Podman machine the installer creates uses 2 CPUs and 4 GiB of
memory, and a disk that grows up to 30 GiB. No minimum of free disk space has
been measured; leave room for the team's image and persistent data. Linux: CLI
only, experimental, on rootless Podman 5.0 or later.
Windows is a preview in 0.4.0, CLI only: tested on Windows 10, not on Windows 11.

Before installing, use [Choose where to run Job Hunter Team](CHOOSE-WHERE-TO-RUN.md)
to compare a local PC, dedicated Linux PC on the LAN and VPS. The team itself
runs in a container; the installer prepares that runtime.

---

## 🛤️ Choose your path

Pick the path that fits how you work:

|     | Path                                                      | Best for                                                |
| --- | --------------------------------------------------------- | ------------------------------------------------------- |
| 🖥️  | [Native app](#%EF%B8%8F-path-1-native-app)                | Not in 0.4.0                                            |
| 📦  | [CLI installer](#-path-2-cli-installer)                   | Terminal, automation, remote administration             |
| 🦞  | [AI agent drives JHT](#-path-3-let-your-ai-agent-do-it)   | You already use Claude Code / OpenClaw / Codex / Cursor |
| 🛠️  | [From source](#%EF%B8%8F-path-4-from-source-contributors) | Contributors                                            |

---

## 🖥️ Path 1 — Native app

**The desktop app is not in 0.4.0**: there is no app to download in this
release. Use the CLI installer (Path 2) on macOS, Linux or Windows.

---

## 📦 Path 2 — CLI installer

Use this path for terminal-first setup, automation or remote administration.
It installs the runtime and the `jht` command.

**Recommended: download, inspect, and preview before running (macOS / Linux):**

```bash
curl -fsSL https://jobhunterteam.ai/install.sh -o install.sh
less install.sh
bash install.sh --runtime podman --dry-run
bash install.sh --runtime podman
```

The shorter form, after you have reviewed it, is:

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash -s -- --runtime podman
```

**Windows (PowerShell; WSL must be enabled):** Windows is a preview in 0.4.0, CLI only: tested on Windows 10, not on Windows 11.

Requirements on Windows: WSL enabled, and **winget** (the Windows Package Manager, which comes with "App Installer"): the installer gets Podman through it. Windows 11 has it; on Windows 10 install "App Installer" from the Microsoft Store (<https://apps.microsoft.com/detail/9nblggh4nns1>, or the official link <https://aka.ms/getwinget>). Without winget, and without a Podman already installed, the installer stops at once, before it writes anything, and says so: install App Installer, open a new PowerShell window and run the same command again.

```powershell
$f = Join-Path $env:TEMP ("jht-install-{0}.ps1" -f [guid]::NewGuid().ToString('N'))
iwr -useb https://jobhunterteam.ai/install.ps1 -OutFile $f
$published = (iwr -useb https://raw.githubusercontent.com/leopu00/job-hunter-team/master/desktop/src-tauri/installer-windows.sha256).Content.Trim()
if ((Get-FileHash $f -Algorithm SHA256).Hash -eq $published) { powershell -NoProfile -ExecutionPolicy Bypass -File $f } else { Remove-Item $f; Write-Error 'SHA-256 does not match: stop, do not run it' }
```

The published SHA-256 of the installer is the one in
[`desktop/src-tauri/installer-windows.sha256`](https://raw.githubusercontent.com/leopu00/job-hunter-team/master/desktop/src-tauri/installer-windows.sha256);
the command compares it with the SHA-256 of the file you downloaded and runs the
file only when they are equal. **If they differ, stop**: do not run the file
(the command deletes it), and tell us. Do not pipe the download into `iex` or
compile it in memory: in our tests Microsoft Defender has blocked that scheme
as malicious content, whatever the script was. `-ExecutionPolicy Bypass` applies to that one
PowerShell process only, because Windows clients refuse scripts by default; it
does not change Defender.

The installer:

1. Detects your OS (macOS, or Linux with apt, dnf or pacman)
2. Installs the **container runtime**, Podman, the only one since 0.4: on macOS, Podman and its Compose provider through Homebrew (which must already be installed) and a dedicated rootless `jht-podman` machine with 2 CPUs, 4 GiB of memory and a disk of up to 30 GiB; on Linux, rootless Podman 5.0 or later and podman-compose for your user, with `sudo` that asks for no password for what is missing. It never installs Docker or Colima.
3. Downloads `docker-compose.yml`, the host wrapper and the host preflight helper.
4. Creates `~/.jht/host.env` and registers the wrapper directory on `PATH` when needed.

The wrapper handles container lifecycle on the host and forwards operational
commands to the Node CLI inside the long-running `jht` container. **No Node,
Python or tmux is required on the host, and the Docker socket is not exposed
inside the container.** See [`docs/internal/ops/vps.md`](../internal/ops/vps.md)
for the design rationale.

In an interactive terminal, the installer launches the setup wizard
automatically. If it cannot, or if you skipped onboarding, run:

```bash
jht setup          # asks for your GLM API key (typed hidden), checks it, starts the team
jht doctor         # verify configuration and dependencies
jht team status    # confirm the agents are running
```

The wizard asks for the GLM API key, checks it with Z.ai, keeps it in a private
folder of the container (the configuration holds only where it is) and runs
`jht team start`. There is no sign-in step. Without questions:
`jht setup --non-interactive --provider glm --api-key-stdin < key.txt`.

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

**macOS and Podman.** The commands above run the installer with `--runtime podman`
(Podman is also what the installer does without the flag).
Homebrew must already be installed: without it the installer stops before
installing anything and says how to get it (https://brew.sh, then a new
Terminal window and the installer again). `--runtime=colima`,
`--runtime=docker` and `--runtime=docker-desktop` are refused.

**Coming from Docker (0.3.x, Colima, Docker Desktop or Docker Engine).** The
installer sees the team on Docker, stops before changing anything and says so.
Your data stays: `~/.jht` (configuration, database, profile) and
`~/Documents/Job Hunter Team` (CVs, outputs) are folders of your computer. What
stays behind in Docker's volumes has to be given again: the API key, the mail
password, the Telegram tokens. To move: `jht uninstall --confirm` (it keeps the
two folders), run the installer again, then `jht setup` with your API key. On a
0.3.x install the old `jht` command has no `uninstall`: the message then gives,
as the first step, the uninstall of this version's command (downloaded once,
run, then deleted). The
message is in Italian or English (the language of your earlier setup, or of
the system). The Colima virtual machine stays on the disk, stopped, after the
uninstall: if JHT created it and you use it for nothing else, the message names
its profile and the command that removes it (`colima delete -p <profile>`).

From a reviewed checkout of the repository, the same install is:

```bash
bash scripts/install.sh --runtime=podman
```

---

## 🦞 Path 3 — Let your AI agent do it

If you already use a personal AI assistant (Claude Code, OpenClaw, Codex,
Cursor), tell it:

> _"Set up Job Hunter Team for me. I have a GLM (Z.ai) API key for it.
> Walk me through what you need."_

The `jht` CLI is designed for this use. Follow
[`AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) for the exact runbook and
the user-confirmation boundaries.

---

## 🛠️ Path 4 — From source (contributors)

For contributors hacking on the repo. Install Docker with Compose, Node 24,
Python 3.10 or newer, and Rust with the Tauri 2 prerequisites for your system
for the desktop app, then follow
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

# 4. Run the desktop app from source (see desktop/README.md); shared/
#    dependencies first, as the release workflow installs them
npm --prefix shared ci --ignore-scripts
npm --prefix desktop ci
npm --prefix desktop run tauri:dev

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

# Interaction happens in the desktop app (desktop/). For web-dev only,
# run the cloud app on the host: cd web && npm run dev:host (:3001)

# Tail logs
docker logs -f jht
```

See [`CLI-REFERENCE.md`](CLI-REFERENCE.md) for the full CLI reference.

---

## 🚀 First run

`jht setup` is the first-run flow: it takes the GLM (Z.ai) API key (typed
hidden, or from a file or the standard input), checks it with the provider and
starts the team. Run `jht doctor` before considering setup complete. The cloud
account, Telegram and VPS paths are optional and documented separately. On a
team that runs on this computer, CVs and the other documents land in
`~/Documents/Job Hunter Team/`. You decide what to send.

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
jht providers use codex     # set the active provider
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
- 💳 [`docs/about/PROVIDERS.md`](../about/PROVIDERS.md) — Codex subscription or GLM/Kimi API key
- 🦞 [`docs/guides/AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) — let your AI assistant drive JHT
- 🎯 [`docs/about/VISION.md`](../about/VISION.md) — design philosophy, anti-goals, the Mentor
- 🧪 [`docs/guides/BETA.md`](BETA.md) — testing, feedback and case-study evidence
- 📊 [`docs/about/MONITORING.md`](../about/MONITORING.md) — Bridge/Sentinel test data
- 🗺️ [`docs/about/ROADMAP.md`](../about/ROADMAP.md) — what's coming next
- 🛠️ [`docs/guides/CLI-INSTALL.md`](CLI-INSTALL.md) — full CLI reference
- 🏗️ [`docs/internal/ops/INFRA.md`](../internal/ops/INFRA.md) — infrastructure diagram
