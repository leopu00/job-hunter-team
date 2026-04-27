# Quickstart

Get the team running in **about 10 minutes**, depending on the path you pick.

> 🧪 JHT is in beta. The installer and the desktop launcher are still maturing — if anything goes wrong, see [`docs/BETA.md`](BETA.md).

---

## ⚠️ Before you start

JHT runs ~**400M tokens/month** (8 agents working in parallel, around the clock). To make this affordable, **JHT runs on LLM subscriptions, not pay-per-use API keys** — see [`docs/PROVIDERS.md`](PROVIDERS.md) and [ADR-0004](adr/0004-subscription-only-no-api-keys.md).

You need an active subscription to **one** of:

| | Provider | Plan | Cost/mo | Status |
|---|---|---|---|---|
| 🟠 | **Claude** | Max x20 | ~€200 | ✅ Production-ready, best precision |
| 🔵 | **Codex** | Plus / Pro | ~€100 | 🔬 Supported, benchmark in progress |
| 🌙 | **Kimi** | Pro | ~€40 | 🎯 Mass-market target (calibration in progress) |

> ⚠️ **The subscription must be dedicated to JHT** — not the same account you use for personal/work AI tasks. A shared account drains the same weekly quota twice and the team will hit rate limits unexpectedly.

---

## 🛤️ Choose your path

Pick the path that fits how you work:

| | Path | Best for | Time |
|---|---|---|---|
| 🦞 | [AI agent drives JHT](#-path-1-let-your-ai-agent-do-it) | You already use Claude Code / OpenClaw / Codex / Cursor | < 5 min |
| 🖥️ | [Desktop launcher](#%EF%B8%8F-path-2-desktop-launcher-non-tech) | Non-technical users, GUI-only | ~10 min |
| 📦 | [One-liner installer](#-path-3-one-liner-installer-cli-users) | Comfortable with the terminal | ~10 min |
| 🛠️ | [From source](#%EF%B8%8F-path-4-from-source-contributors) | Contributors, hackers | ~15 min |

---

## 🦞 Path 1 — Let your AI agent do it

If you already use a personal AI assistant (Claude Code, OpenClaw, Codex, Cursor), just tell it:

> *"Set up Job Hunter Team for me. I have a [Claude Max x20 / Kimi Pro / Codex Pro] subscription. Walk me through what you need."*

…and it will figure out the rest. The `jht` CLI is intentionally designed to be driven by other AI agents — see [`docs/AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) for prompt examples and the full integration guide.

---

## 🖥️ Path 2 — Desktop launcher (non-tech)

The launcher handles everything through a graphical interface — no terminal required.

1. Download from [`/download`](https://jobhunterteam.ai/download) or GitHub Releases:
   - macOS: `.dmg`
   - Windows: `.exe`
   - Linux: `.AppImage` or `.deb`
2. Open the app and walk through the setup wizard:
   - Pick your language (en/it/hu)
   - **"Install everything"** button installs Docker (Colima on macOS / Docker Desktop on Windows / docker.io on Linux) + Git in a single guided flow
   - Pick your provider (🟠 Claude / 🔵 Codex / 🌙 Kimi) and sign in via embedded terminal
3. Click **Start** — the team boots in the background and your default browser opens on the dashboard.

> 💡 The desktop app is a **launcher**, not the interaction interface. After it starts the team, you talk to the agents through the **web dashboard**, **Telegram**, or the **CLI**. The launcher itself is just the on/off switch + setup wizard.

> ⚠️ On first launch macOS/Windows may warn about an "unverified app" — JHT is open source and you can build from source if you don't trust the binary. Code signing is intentionally deferred during beta (see BACKLOG `[JHT-DESKTOP-05]`). To bypass: right-click → Open on macOS, "Run anyway" on Windows.

---

## 📦 Path 3 — One-liner installer (CLI users)

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

The script:

1. Detects your OS (macOS / Linux apt+dnf+pacman / WSL2)
2. Installs the **Docker runtime** (Colima on macOS via Homebrew, `docker.io` on Linux/WSL2)
3. Pulls the JHT image from GHCR (`ghcr.io/leopu00/jht:latest`)
4. Creates a `jht` wrapper in `~/.local/bin` that does `docker run` with the standard bind-mount contract
5. Drops you into the interactive setup wizard

After install:

```bash
jht setup            # interactive wizard if you skipped it
jht doctor           # check prerequisites
jht providers add    # add your subscription (Claude / Codex / Kimi)
jht team start       # start the team
jht team status      # check it's running
```

You'll end up with two folders:

| Folder | Purpose | Who touches it |
|---|---|---|
| `~/.jht/` | Config, `jobs.db`, agents, credentials, sessions | Agents and CLI only |
| `~/Documents/Job Hunter Team/` | CVs to analyze, generated output (PDF/MD), attachments | You + the agents |

> 💡 To skip Docker (expert mode): `curl ... | bash -s -- --no-docker`. You'll need Node 22+, tmux, git, and the provider CLI installed manually.

---

## 🛠️ Path 4 — From source (contributors)

For contributors hacking on the repo. See [`.github/CONTRIBUTING.md`](../.github/CONTRIBUTING.md) for the full PR workflow and conventions.

```bash
# 1. Clone
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# 2. Spin up the dev container (recommended — same env as production)
docker compose up -d

# 3. Or work in host mode if you're iterating on the web UI
npm --prefix web run dev:host
```

For dev tasks specifically:

```bash
# Start the team using the local source
jht team start

# Open the web dashboard at http://localhost:3001 (host mode) or :3000 (container)
jht web open

# Tail logs
jht container logs -f
```

See [`docs/cli-install.md`](cli-install.md) for the full CLI reference.

---

## 🚀 After install — your first run

Whichever path you took:

1. **Set up your candidate profile.** The Assistant agent can do this for you in conversation:
   - Web: visit `/onboarding` and chat with the Assistant — it writes `candidate_profile.yml` for you
   - Or edit `~/Documents/Job Hunter Team/candidate_profile.yml` by hand (see `candidate_profile.yml.example`)
2. **Configure the team.** Pick the agents you want active, set the polling intervals, set your work hours.
3. **Click Start.** The Captain dispatches orders to Scout → Analyst → Scorer → Writer → Critic. Sentinel and Bridge keep the team within the subscription window.
4. **Review the output.** Applications marked "Ready to submit" land in `~/Documents/Job Hunter Team/applications/`. You decide what to send.

---

## 🤖 The team (8 agents + monitoring)

| | Agent | Role |
|---|---|---|
| 👨‍✈️ | **Captain** | Coordinates the pipeline, anti-collision |
| 💂 | **Sentinel** | Event-driven watcher, intervenes on the Captain when usage drifts |
| 🕵️ | **Scout** | Searches EU and remote job boards |
| 👨‍🔬 | **Analyst** | Verifies job descriptions, companies, culture |
| 👨‍💻 | **Scorer** | Assigns 0–100 score against your profile |
| 👨‍🏫 | **Writer** | Generates CVs and cover letters tailored to each position |
| 👨‍⚖️ | **Critic** | 3-round blind review before submission |
| 👨‍💼 | **Assistant** | Platform copilot — helps you navigate every interface |
| 🧙‍♂️ | **Maestro** *(planned)* | Career coach — analyzes goals/gaps/market signals |
| 📡 | **Bridge** *(infrastructure, not LLM)* | Polls provider usage on a fixed clock, notifies the Sentinel |

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

Full CLI reference: [`docs/cli-install.md`](cli-install.md).

---

## 🆘 Help & troubleshooting

- **Setup not finishing?** Run `jht doctor` — it tells you exactly what's missing
- **Team won't start?** `jht container status` then `jht container logs -f`
- **Hitting rate limits?** `jht sentinella status` shows the current usage projection — see [`docs/MONITORING-RESULTS.md`](MONITORING-RESULTS.md) for what the numbers mean
- **Bug or unclear behavior?** Open an issue with the labels suggested in `.github/ISSUE_TEMPLATE/bug_report.md`
- **Want to be a beta tester?** See [`docs/BETA.md`](BETA.md)

---

## 📚 Where to look next

- 📘 [`README.md`](../README.md) — project overview, story, manifesto
- 📋 [`docs/STORY.md`](STORY.md) — origin story (legacy team results)
- 💳 [`docs/PROVIDERS.md`](PROVIDERS.md) — which subscription to pick
- 🦞 [`docs/AI-AGENT-INTEGRATION.md`](AI-AGENT-INTEGRATION.md) — let your AI assistant drive JHT
- 🎯 [`docs/VISION.md`](VISION.md) — design philosophy, anti-goals, the Maestro
- 🧪 [`docs/BETA.md`](BETA.md) — join the beta program
- 📊 [`docs/MONITORING-RESULTS.md`](MONITORING-RESULTS.md) — Bridge/Sentinel test data
- 🗺️ [`docs/ROADMAP.md`](ROADMAP.md) — what's coming next
- 🛠️ [`docs/cli-install.md`](cli-install.md) — full CLI reference
- 🏗️ [`docs/INFRA.md`](INFRA.md) — infrastructure diagram
