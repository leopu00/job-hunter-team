<p align="center">
  <img src="assets/banner.png" alt="Job Hunter Team — Your AI-Powered Job Search Team" width="100%" />
</p>

<h1 align="center">Job Hunter Team</h1>

<p align="center">
  <strong>Your AI agent team that hunts jobs for you.</strong><br/>
  Your AI team — from position discovery to tailored CVs and cover letters.
</p>

<p align="center">
  <a href="https://github.com/leopu00/job-hunter-team/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/leopu00/job-hunter-team/ci.yml?branch=master&label=CI" alt="CI" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/leopu00/job-hunter-team/test.yml?branch=master&label=tests" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/stargazers"><img src="https://img.shields.io/github/stars/leopu00/job-hunter-team?style=social" alt="GitHub Stars" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/network/members"><img src="https://img.shields.io/github/forks/leopu00/job-hunter-team?style=social" alt="GitHub Forks" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/commits/master"><img src="https://img.shields.io/github/last-commit/leopu00/job-hunter-team" alt="Last Commit" /></a>
</p>

<p align="center">
  <a href="#-demo">Demo</a> ·
  <a href="#the-team">The Team</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#install">Install</a> ·
  <a href="docs/about/STORY.md">Story</a> ·
  <a href="docs/about/PROVIDERS.md">Providers</a> ·
  <a href="docs/guides/QUICKSTART.md">Quickstart</a> ·
  <a href="docs/about/ROADMAP.md">Roadmap</a> ·
  <a href="https://jobhunterteam.ai">Website</a>
</p>

---

Job hunting is a second job you do on top of your job: scanning boards every day, qualifying listings, tailoring every single application. JHT hands that grind to a team of AI agents that runs around the clock — Scout finds positions, Analyst verifies them, Scorer ranks them against your profile, Writer prepares tailored documents, Critic blind-reviews everything — orchestrated by a **Captain** (see [The Team](#the-team)). You only review applications that clear the quality bar.

The whole pipeline runs **locally in a container**, on your machine or your VPS — your profile, your data, your provider account. **AI on the side of workers, not against them.**

> 💳 JHT itself is **free (MIT) and never bills you** — it runs on a **dedicated LLM subscription (~€40–200/mo)**. Full cost breakdown, and why subscriptions instead of API keys, in [Install](#install). Making it run on **local models (€0)** is an open mission: [M5](https://github.com/leopu00/job-hunter-team/issues/93).

I originally built JHT for my own job hunt. It worked. So I rebuilt it as open source, so anyone could use it.

> 📊 **From the original private build** — ~200 offers analyzed · ~20 tailored applications · **5 interview invites within a few weeks**. Full background in [`docs/about/STORY.md`](docs/about/STORY.md).

> 📈 **From the public stack (June 2026)** — a Codex-powered team ran **one month unattended**: **658 positions found · 520 scored · 307 strong matches (score ≥70)**, closing its weekly budget at **99–100% for four straight weeks** with zero human interventions. Data in [`docs/about/RESULTS.md`](docs/about/RESULTS.md), live on [jobhunterteam.ai/case-studies](https://jobhunterteam.ai/case-studies).

## 🎬 Demo

The best demo is real data: [jobhunterteam.ai/case-studies](https://jobhunterteam.ai/case-studies) renders the live dashboards of the beta runs — including the month-long autonomous Codex run (658 positions found, 520 scored, weekly budget self-managed at 99–100%).

> Numbers are self-reported snapshots of the team's event log, committed in [`web/data/case-studies/`](web/data/case-studies/). Methodology: [`docs/about/RESULTS.md`](docs/about/RESULTS.md).

*The live case-studies dashboard — real, anonymized field data:*

<p align="center">
  <a href="https://jobhunterteam.ai/case-studies"><img src="assets/screenshots/overview.png" alt="Case studies — what the team delivers, by provider" width="100%" /></a>
</p>

*Where the team hunts (month-long Codex run, 658 positions across Europe) and how well it matches:*

<p align="center">
  <a href="https://jobhunterteam.ai/case-studies/beta-2"><img src="assets/screenshots/beta2-map.png" alt="Geographic distribution and match quality of the month-long run" width="100%" /></a>
</p>

*The team managing its own weekly AI budget, day by day, for a full month — no human in the loop:*

<p align="center">
  <a href="https://jobhunterteam.ai/case-studies/beta-2"><img src="assets/screenshots/beta2-budget.png" alt="Positions by category and self-managed weekly budget over time" width="100%" /></a>
</p>

Animated GIFs of the dashboard and onboarding are in the works.

## The Team

The team has **no fixed headcount**: a stable core of always-on agents plus a **dynamic worker pool** the Captain scales from 1 to N per role based on flow rate and budget.

**Why a team instead of one clever prompt?** Three practical reasons: each role keeps its own small context (a model that just read 50 job ads reasons measurably worse about CV tone); blind review only works if the Critic genuinely hasn't seen the Writer's reasoning; and the Captain can throttle or scale each role independently to keep a month of 24/7 operation inside a fixed subscription budget.

**Always-on core**

| | Agent | Role |
|---|-------|------|
| 👨‍✈️ | **Captain** | Coordinates the pipeline and handles anti-collision between agents |
| 💂 | **Sentinel** | Event-driven watcher — intervenes on the Captain when usage drifts toward the window limit |
| 👩‍💼 | **Assistant** | Platform copilot — helps the user navigate every interface |
| 🧙‍♂️ | **Mentor** | Career coach — analyzes goals, gaps, market signals to keep your strategy aligned |

**Dynamic worker pool** — the Captain spins up 1..N of each, scaling with load:

| | Agent | Role |
|---|-------|------|
| 🕵️ | **Scout** | Searches EU and remote job boards |
| 👨‍🔬 | **Analyst** | Verifies job descriptions, companies, and culture |
| 👨‍💻 | **Scorer** | Assigns a 0–100 score against your profile |
| 👨‍🏫 | **Writer** | Generates CVs and cover letters tailored to each position |
| 👨‍⚖️ | **Critic** | Blind review in 3 mandatory rounds — spawned fresh per round |

**Scheduled one-shot** — self-spawn on a daily slot, run a sweep, then self-destruct:

| | Agent | Role |
|---|-------|------|
| 🩺 | **Dottore** | Agent health — detects stuck agents and restarts them with fresh context |
| 👷‍♂️ | **Mantenitore** | Infra health — container, VPS, dependencies, disk/RAM, mission-critical tools |

> 📡 The **Bridge** (usage clock) is a process, not an AI agent — see Architecture below.

## Architecture

```
                                       👤 User
                       ┌─────────────────┼─────────────────┐
                       ▼                 ▼                 ▼
               🧙‍♂️ Mentor       👩‍💼 Assistant      👨‍✈️ Captain ◀··intervene·· 💂 Sentinel ◀──notify── 📡 Bridge
               (career coach)    (platform copilot)        │       (event-driven)         (usage clock)
                                                           │      🩺 Dottore ····agent-health··· ▲
                                                           │      👷‍♂️ Mantenitore ··infra-health·· │
                                                           │      (one-shot, daily sweep)         │
                                                           ▼
                                       ┌──────┬──────┬──────┐
                                       ▼      ▼      ▼      ▼
                                  🕵️ Scout → 👨‍🔬 Analyst → 👨‍💻 Scorer → 👨‍🏫 Writer → 📤✅ Ready to submit
                                                                          ⇅
                                                                     👨‍⚖️ Critic
                                                                   (3 blind rounds)
```

The user has three entry points: **🧙‍♂️ Mentor** for career advice, **👩‍💼 Assistant** as a copilot to navigate the platform, and **👨‍✈️ Captain** to drive the actual job-hunting pipeline. The Captain dispatches orders to the dynamic worker pool (Scout, Analyst, Scorer, Writer — 1..N instances each, scaled to load) and tracks state. Data flows left-to-right: Scout finds positions, Analyst verifies them, Scorer ranks them, Writer produces CV + cover letter. Writer bounces with Critic through 3 blind review rounds; Critic isn't commanded by the Captain — it's a peer reviewer triggered only by Writer, by design, to keep the review independent. Once approved, Writer emits the application as "Ready to submit".

Token usage is governed by a two-component monitoring stack: **📡 Bridge** runs on a fixed clock, fetches usage samples from the provider, and notifies the **💂 Sentinel**; the Sentinel stays event-driven and intervenes on the Captain only when the projection drifts toward the window limit. See [`docs/about/MONITORING.md`](docs/about/MONITORING.md).

Each agent is an autonomous AI session running on one of three supported CLIs: **Claude Code** (configured via `CLAUDE.md`), **Codex**, or **Kimi** (both configured via `AGENTS.md`). A shared SQLite database keeps state in sync across the team.

See [`docs/internal/ops/INFRA.md`](docs/internal/ops/INFRA.md) for the full infrastructure diagram.

## Install

> 🧪 **Beta — CLI-first.** The team and the agents work end-to-end; the supported entry points today are the CLI one-liner below and the [AI-agent path](#-ai-agents-can-drive-jht). The desktop app is **not part of the beta yet** — it works up to a point and is under active development ([`desktop/STATUS.md`](desktop/STATUS.md)). If you hit a snag, see [`docs/guides/BETA.md`](docs/guides/BETA.md) and join the beta program.

**Before you start** — JHT runs ~**400M tokens/month** (many agents working in parallel, around the clock). To make this affordable, JHT runs on **LLM subscriptions, not pay-per-use API keys** — the same usage on the API would cost $1,000–$2,500/mo. See [`docs/about/PROVIDERS.md`](docs/about/PROVIDERS.md) and [ADR-0004](docs/adr/0004-subscription-only-no-api-keys.md) for the full reasoning.

> ⚠️ **The subscription must be dedicated to the team** — not the same account you use for personal/work AI tasks. A shared account drains the same weekly quota twice and the team will hit rate limits unexpectedly.

Three subscriptions cover the ~400M tokens/month requirement:

| | Provider | Plan | Cost/mo | Status |
|---|---|---|---|---|
| 🟠 | **Claude** | Max x20 | ~€200 | ✅ Production-ready, best precision |
| 🔵 | **Codex** | Plus / Pro | ~€100 | ✅ Proven — 1-month autonomous run (658 positions, weekly budget self-managed at 99–100%) |
| 🌙 | **Kimi** | Pro | ~€40 | 🧪 Beta — mass-market tier (75h + 10-day runs; two multi-week teams in observation) |

---

**Recommended: inspect first, then run** (macOS / Linux / WSL) — the installer is versioned in this repo ([`web/public/install.sh`](web/public/install.sh)) and previews every action before touching anything:

```bash
curl -fsSL https://jobhunterteam.ai/install.sh -o install.sh
less install.sh              # read what it does
bash install.sh --dry-run    # preview every action — no changes to your system
bash install.sh
```

Or, if you've read it and trust it, the one-liner: `curl -fsSL https://jobhunterteam.ai/install.sh | bash`

> 🔍 **What it touches:** exactly two files on the host — `~/.jht/runtime/docker-compose.yml` and the `~/.local/bin/jht` wrapper. Everything else (Node, Python, tmux, agents) runs inside an isolated container; only `~/.jht` and `~/Documents/Job Hunter Team` are mounted. The rest of your filesystem is invisible to it.

**Desktop app** — in development, not part of the beta. Unsupported preview builds land on [GitHub Releases](https://github.com/leopu00/job-hunter-team/releases) for contributors, but the website's download page is intentionally disabled until the app is ready. State, gaps and roadmap in [`desktop/STATUS.md`](desktop/STATUS.md).

Expert mode, contributor setup, and the full walkthrough are in [`docs/guides/QUICKSTART.md`](docs/guides/QUICKSTART.md).

## Interfaces

| | Interface | Launch | Stack |
|---|---|---|---|
| 🌐 | **Web Dashboard** | `cd web && npm run dev:host` | Next.js · React · Tailwind · Supabase |
| 🖥️ | **Desktop App** *(in development)* | build from source — [`desktop/STATUS.md`](desktop/STATUS.md) | Electron · electron-builder *(interaction cockpit — start/stop, chat, file upload; not yet publicly released)* |
| ⌨️ | **CLI** | `jht team start` | Node.js · Commander *(full reference: [`docs/guides/CLI-REFERENCE.md`](docs/guides/CLI-REFERENCE.md). Also designed to be driven by AI agents — see [`docs/guides/AI-AGENT-INTEGRATION.md`](docs/guides/AI-AGENT-INTEGRATION.md))* |
| 💬 | **Telegram** | 3 bots — Assistant · Captain · Mentor | Python bot bridge *(field-validated — the recommended channel for teams on a VPS or dedicated PC)* |

## 🤖 AI agents can drive JHT

JHT's CLI is intentionally designed to be driven by other AI assistants — not just by humans. If you already use **Claude Code**, **🦞 OpenClaw**, **Codex** or **Cursor**, just tell it:

> *"Set up JHT and start the team for me."*

…and it will figure out the rest. No manual configuration, no Docker commands, no reading 5 pages of docs. The same `jht` CLI surface is used by humans, by AI agents, and by the Desktop app.

See [`docs/guides/AI-AGENT-INTEGRATION.md`](docs/guides/AI-AGENT-INTEGRATION.md) for example prompts and the full integration guide.

## Stack

| Layer | Tech |
|---|---|
| 🤖 **Agents** | Claude Code · Codex · Kimi · tmux · SQLite |
| 🛡️ **Monitoring** | 📡 Bridge · 💂 Sentinel · custom Python skills (`shared/skills/`) |
| ⚙️ **Backend** | Node.js · TypeScript · Zod · Python *(monitoring + LLM providers + skills)* |
| 🐳 **Container** | Docker · Docker Compose |
| 🌐 **Frontend** | Next.js 16 · React 19 · Tailwind CSS 4 |
| 💾 **Data** | Supabase (PostgreSQL) · SQLite (`better-sqlite3`) · Google Drive *(user files)* |
| 🔐 **Auth** | Google OAuth · GitHub OAuth · AES-256 credentials |
| 🧠 **LLM** | Anthropic · OpenAI · Moonshot (Kimi) |
| 🐚 **Scripts** | Bash *(setup, install, dev tooling)* |
| 🛠️ **CI/CD** | GitHub Actions · Vercel · electron-builder |

## Status

- ✅ **Done** — agent team (always-on core: Captain · Sentinel · Assistant · Mentor + dynamic worker pool: Scout · Analyst · Scorer · Writer · Critic + one-shot: Dottore · Mantenitore), monitored by 📡 Bridge; CLI + TUI + web dashboard (54 pages + 142 API routes wired to real Supabase data); full UI i18n in 7 languages (en/it/hu/es/de/fr/pt — agent-prompt translations still catching up in places); 240 test files — 200 active (869 vitest + 425 pytest, green in CI) + 40 legacy parked in [`tests/js/tasks/_disabled/`](tests/js/tasks/_disabled/) after a dashboard refactor (tracked debt, issue #102); tested end-to-end on Claude Max x20, Kimi €40 (75h + 10-day beta), and Codex ~€100 (**1-month autonomous run**)
- 🔨 **In progress** — Desktop app toward public beta (installers build for macOS/Windows/Linux and onboarding runs end-to-end, but dashboard parity, agent lifecycle controls and cross-platform QA are open — [`desktop/STATUS.md`](desktop/STATUS.md)) · Kimi tier hardening (two multi-week beta teams in observation)
- ⏭️ **Next** — Demo GIFs + launch assets · desktop auto-update + tray/notifications · contributor missions M1–M5 (see the roadmap)

Full roadmap: [`docs/about/ROADMAP.md`](docs/about/ROADMAP.md).

## Repository layout

| Path | What | Docs |
|---|---|---|
| ⌨️ [`cli/`](cli/) | `jht` CLI (Commander) — primary control surface | [README](cli/README.md) · [CLI reference](docs/guides/CLI-REFERENCE.md) |
| 🌐 [`web/`](web/) | Dashboard (Next.js · React · Tailwind) | [README](web/README.md) |
| 🖥️ [`desktop/`](desktop/) | Desktop app (Electron) | [README](desktop/README.md) |
| ⌨️ [`tui/`](tui/) | Terminal UI | [README](tui/README.md) |
| 🧩 [`shared/`](shared/) | Shared core lib (config · LLM · monitoring · auth) | [README](shared/README.md) |
| 🤖 [`agents/`](agents/) | Agent prompts & skills (×7 languages) | [team rules](agents/_team/team-rules.md) |
| 🐚 [`scripts/`](scripts/) | Setup, install, dev & release tooling | [README](scripts/README.md) |
| 🧪 [`e2e/`](e2e/) | End-to-end tests (Playwright) | [README](e2e/README.md) |
| 🗄️ [`supabase/`](supabase/) | DB migrations & SQL | [README](supabase/README.md) |
| 📚 [`docs/`](docs/) | All project documentation | [docs index](docs/README.md) |

## Contributing

PRs and issues welcome. See [`CONTRIBUTING.md`](.github/CONTRIBUTING.md) for the dev setup, PR flow, commit conventions, and agent-specific guides.

- 🙌 **Where you can help** — the [contributor missions](docs/about/ROADMAP.md#-where-you-can-help--contributor-missions) (M1–M5, with M6–M8 on the horizon) are the bigger directions we'd love a hand with; each breaks into `good first issue` entry-points. The **desktop app** is the highest-impact area right now — the ranked list is in [`desktop/STATUS.md`](desktop/STATUS.md)
- 🌿 **How development flows** — JHT is built by a solo maintainer orchestrating AI agents on several parallel `devN` branches (the same multi-agent approach the product itself uses), each merged into `master` when its slice is done; external contributions come in as `feat/`/`fix/` branches → PR
- 🧪 **Beta tester?** See [`docs/guides/BETA.md`](docs/guides/BETA.md) — we want real job-seekers to break things and tell us how
- 🔐 **Found a security issue?** See [`SECURITY.md`](SECURITY.md) for responsible disclosure — please don't open a public issue. Internal pre-launch audit + hardening sprint results live in [`docs/security/`](docs/security/)
- 🤝 **Code of conduct**: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — Contributor Covenant 2.1

## License

MIT — see [LICENSE](LICENSE).
