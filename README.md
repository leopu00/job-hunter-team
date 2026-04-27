<p align="center">
  <img src="assets/banner.png" alt="Job Hunter Team — Your AI-Powered Job Search Team" width="100%" />
</p>

<h1 align="center">Job Hunter Team</h1>

<p align="center">
  <strong>Your AI agent team that hunts jobs for you.</strong><br/>
  Your AI team — from position discovery to tailored CVs and cover letters.
</p>

<p align="center">
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
  <a href="docs/STORY.md">Story</a> ·
  <a href="docs/PROVIDERS.md">Providers</a> ·
  <a href="docs/quickstart.md">Quickstart</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a> ·
  <a href="https://jobhunterteam.ai">Website</a>
</p>

---

Point the system at your profile, start the team, and only review applications that clear the quality bar. Each agent specializes in one task: Scout finds positions, Analyst evaluates them, Scorer ranks them, Writer prepares documents, and Critic reviews everything before submission.

The whole pipeline runs **locally in a container**, on your machine or your VPS — your profile, your data, your provider account. JHT never bills you: you only pay the LLM subscription of the provider you choose. **AI on the side of workers, not against them.**

I originally built JHT for my own job hunt. It worked. So I rebuilt it as open source, so anyone could use it.

> 📊 **From the original private build** — ~200 offers analyzed · ~20 tailored applications · **5 interview invites in 2 weeks**. Full background in [`docs/STORY.md`](docs/STORY.md).

## 🎬 Demo

> 🚧 **Coming soon** — a 30-second video walkthrough of the full pipeline.

## The Team

| | Agent | Role |
|---|-------|------|
| 👨‍✈️ | **Captain** | Coordinates the pipeline and handles anti-collision between agents |
| 💂 | **Sentinel** | Event-driven watcher — intervenes on the Captain when usage drifts toward the window limit |
| 🕵️ | **Scout** | Searches EU and remote job boards |
| 👨‍🔬 | **Analyst** | Verifies job descriptions, companies, and culture |
| 👨‍💻 | **Scorer** | Assigns a 0–100 score against your profile |
| 👨‍🏫 | **Writer** | Generates CVs and cover letters tailored to each position |
| 👨‍⚖️ | **Critic** | Blind review in 3 mandatory rounds before submission |
| 👨‍💼 | **Assistant** | Platform copilot — helps the user navigate every interface |
| 🧙‍♂️ | **Maestro** *(planned)* | Career coach — analyzes goals, gaps, market signals to keep your strategy aligned |

## Architecture

```
                                       👤 User
                       ┌─────────────────┼─────────────────┐
                       ▼                 ▼                 ▼
               🧙‍♂️ Maestro       👨‍💼 Assistant      👨‍✈️ Captain ◀··intervene·· 💂 Sentinel ◀──notify── 📡 Bridge
               (career coach)    (platform copilot)        │       (event-driven)         (usage clock)
                [planned]                                  │
                                                           ▼
                                       ┌──────┬──────┬──────┐
                                       ▼      ▼      ▼      ▼
                                  🕵️ Scout → 👨‍🔬 Analyst → 👨‍💻 Scorer → 👨‍🏫 Writer → 📤✅ Ready to submit
                                                                          ⇅
                                                                     👨‍⚖️ Critic
                                                                   (3 blind rounds)
```

The user has three entry points: **🧙‍♂️ Maestro** for career advice (planned), **👨‍💼 Assistant** as a copilot to navigate the platform, and **👨‍✈️ Captain** to drive the actual job-hunting pipeline. The Captain dispatches orders to the four pipeline agents (Scout, Analyst, Scorer, Writer) and tracks state. Data flows left-to-right: Scout finds positions, Analyst verifies them, Scorer ranks them, Writer produces CV + cover letter. Writer bounces with Critic through 3 blind review rounds; Critic isn't commanded by the Captain — it's a peer reviewer triggered only by Writer, by design, to keep the review independent. Once approved, Writer emits the application as "Ready to submit".

Token usage is governed by a two-component monitoring stack: **📡 Bridge** runs on a fixed clock, fetches usage samples from the provider, and notifies the **💂 Sentinel**; the Sentinel stays event-driven and intervenes on the Captain only when the projection drifts toward the window limit. See [`docs/MONITORING.md`](docs/MONITORING.md).

Each agent is an autonomous AI session running on one of three supported CLIs: **Claude Code** (configured via `CLAUDE.md`), **Codex**, or **Kimi** (both configured via `AGENTS.md`). A shared SQLite database keeps state in sync across the team.

See [`docs/INFRA.md`](docs/INFRA.md) for the full infrastructure diagram.

## Install

> 🧪 **Beta — installer maturing.** The team and the agents work end-to-end. The desktop installer and the onboarding wizard are still rounding off rough edges — if you hit a snag, see [`docs/BETA.md`](docs/BETA.md) and join the beta program.

**Before you start** — JHT runs ~**400M tokens/month** (many agents working in parallel, around the clock). To make this affordable, JHT runs on **LLM subscriptions, not pay-per-use API keys** — the same usage on the API would cost $1,000–$2,500/mo. See [`docs/PROVIDERS.md`](docs/PROVIDERS.md) and [ADR-0004](docs/adr/0004-subscription-only-no-api-keys.md) for the full reasoning.

> ⚠️ **The subscription must be dedicated to the team** — not the same account you use for personal/work AI tasks. A shared account drains the same weekly quota twice and the team will hit rate limits unexpectedly.

Three subscriptions cover the ~400M tokens/month requirement:

| | Provider | Plan | Cost/mo | Status |
|---|---|---|---|---|
| 🟠 | **Claude** | Max x20 | ~€200 | ✅ Production-ready, best precision |
| 🔵 | **Codex** | Plus / Pro | ~€100 | 🔬 Supported, benchmark in progress |
| 🌙 | **Kimi** | Pro | ~€40 | 🎯 Target mass-market tier (optimizing) |

---

**One-liner (macOS / Linux / WSL)** — agents run in an isolated container by default:

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

**Desktop launcher** — `.dmg` / `.exe` / `.AppImage` / `.deb` from [`/download`](https://jobhunterteam.ai/download) or GitHub Releases.

Expert mode, contributor setup, and the full walkthrough are in [`docs/quickstart.md`](docs/quickstart.md).

## Interfaces

| | Interface | Launch | Stack |
|---|---|---|---|
| 🌐 | **Web Dashboard** | `cd web && npm run dev:host` | Next.js · React · Tailwind · Supabase |
| 🖥️ | **Desktop Launcher** | open `JHT Desktop` | Electron · electron-builder *(launcher only — interaction happens in browser/Telegram/CLI)* |
| ⌨️ | **CLI** | `jht team start` | Node.js · Commander *(also designed to be driven by AI agents — see [`docs/AI-AGENT-INTEGRATION.md`](docs/AI-AGENT-INTEGRATION.md))* |
| 📺 | **TUI** | `jht tui` | `@mariozechner/pi-tui` · chalk |
| 💬 | **Telegram** | bidirectional bot bridge | grammy |

## 🤖 AI agents can drive JHT

JHT's CLI is intentionally designed to be driven by other AI assistants — not just by humans. If you already use **Claude Code**, **🦞 OpenClaw**, **Codex** or **Cursor**, just tell it:

> *"Set up JHT and start the team for me."*

…and it will figure out the rest. No manual configuration, no Docker commands, no reading 5 pages of docs. The same `jht` CLI surface is used by humans, by AI agents, and by the Desktop launcher.

See [`docs/AI-AGENT-INTEGRATION.md`](docs/AI-AGENT-INTEGRATION.md) for example prompts and the full integration guide.

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

- ✅ **Done** — 8-agent team (Captain + Sentinel + 4-stage pipeline + Critic + Assistant), monitored by 📡 Bridge; CLI (33 commands) + TUI + web dashboard (112 pages wired to real Supabase data); desktop installers (`.dmg` / `.exe` / `.AppImage` / `.deb`); i18n base (it/en); 180+ test files; subscription tested end-to-end on Claude Max x20 for weeks
- 🔨 **In progress** — Kimi €40 calibration (target mass-market tier) · Desktop installer onboarding polish · Sentinel token-consumption optimization
- ⏭️ **Next** — 🧙‍♂️ Maestro agent (career coach) · Weekly-window monitoring · User-defined work hours · Code signing + auto-update for desktop · Full i18n coverage (ES/DE/FR/PT)

Full roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Contributing

PRs and issues welcome. See [`CONTRIBUTING.md`](.github/CONTRIBUTING.md) for the dev setup, PR flow, commit conventions, and agent-specific guides.

- 🧪 **Beta tester?** See [`docs/BETA.md`](docs/BETA.md) — we want real job-seekers to break things and tell us how
- 🔐 **Found a security issue?** Email `leopu00@gmail.com` for responsible disclosure. Internal pre-launch audit + hardening sprint results live in [`docs/security/`](docs/security/) (root `SECURITY.md` coming with the next release)
- 🤝 **Code of conduct**: [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) *(coming with the next release)*

## License

MIT — see [LICENSE](LICENSE).
