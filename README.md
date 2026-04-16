<p align="center">
  <img src="assets/banner.png" alt="Job Hunter Team — Your AI-Powered Job Search Team" width="100%" />
</p>

<h1 align="center">Job Hunter Team</h1>

<p align="center">
  <strong>Your AI agent team that hunts jobs for you.</strong><br/>
  7 autonomous agents — from position discovery to tailored CVs and cover letters.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/stargazers"><img src="https://img.shields.io/github/stars/leopu00/job-hunter-team?style=social" alt="GitHub Stars" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/network/members"><img src="https://img.shields.io/github/forks/leopu00/job-hunter-team?style=social" alt="GitHub Forks" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/commits/master"><img src="https://img.shields.io/github/last-commit/leopu00/job-hunter-team" alt="Last Commit" /></a>
</p>

<p align="center">
  <a href="#the-team">The Team</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#install">Install</a> ·
  <a href="docs/quickstart.md">Quickstart</a> ·
  <a href="docs/ROADMAP.md">Roadmap</a> ·
  <a href="https://jobhunterteam.ai">Website</a>
</p>

---

Point the system at your profile, start the team, and only review applications that clear the quality bar. Each agent specializes in one task: Scout finds positions, Analyst evaluates them, Scorer ranks them, Writer prepares documents, and Critic reviews everything before submission.

## The Team

| | Agent | Role |
|---|-------|------|
| 👨‍✈️ | **Captain** | Coordinates the pipeline and handles anti-collision between agents |
| 💂 | **Sentinel** | Monitors tokens, rate limits, API costs, and team health |
| 🕵️ | **Scout** | Searches EU and remote job boards |
| 👨‍🔬 | **Analyst** | Verifies job descriptions, companies, and culture |
| 👨‍💻 | **Scorer** | Assigns a 0–100 score against your profile |
| 👨‍🏫 | **Writer** | Generates CVs and cover letters tailored to each position |
| 👨‍⚖️ | **Critic** | Blind review in 3 mandatory rounds before submission |

## Architecture

```
                           👤 User
                              ⇅
                       👨‍✈️ Captain  ─── monitored by ───▶  💂 Sentinel
                      (orders pipeline agents)           (tokens · costs · health)
                     ╱    │     │    ╲
                    ▼     ▼     ▼     ▼
          🕵️ Scout → 👨‍🔬 Analyst → 👨‍💻 Scorer → 👨‍🏫 Writer → ✅ Ready for submission
                                                  ⇅
                                             👨‍⚖️ Critic
                                          (3 blind rounds)
```

Talking to the Captain is the recommended default — via the web dashboard, TUI, or Telegram — and the Captain dispatches orders to the four pipeline agents (Scout, Analyst, Scorer, Writer) and tracks state. From the web dashboard and TUI the user can also address any specific agent directly, if they want to; Telegram today is wired only to the Captain. Data flows left-to-right: Scout finds positions, Analyst verifies them, Scorer ranks them, Writer produces CV + cover letter. Writer then bounces with Critic through 3 blind review rounds; Critic isn't commanded by the Captain — it's a peer reviewer triggered only by Writer, by design, to keep the review independent. Once approved, Writer emits the application as "Ready for submission". Sentinel watches everything — tokens, costs, rate limits, team health — but stays off the data path. Each agent is an autonomous AI session running on one of three supported CLIs: **Claude Code** (configured via `CLAUDE.md`), **Codex**, or **Kimi** (both configured via `AGENTS.md`). A shared SQLite database keeps state in sync across the team.

See [`docs/INFRA.md`](docs/INFRA.md) for the full infrastructure diagram.

## Install

> 🚧 **Work in progress.** The installer and the desktop launcher are still under active development — expect rough edges. Contributors can run from source (see the quickstart link below).

**One-liner (macOS / Linux / WSL)** — agents run in an isolated container by default:

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

**Desktop launcher** — `.dmg` / `.exe` / `.AppImage` / `.deb` from [`/download`](https://jobhunterteam.ai/download) or GitHub Releases.

Expert mode, contributor setup, and the full walkthrough are in [`docs/quickstart.md`](docs/quickstart.md).

## Interfaces

| Interface | Launch | Stack |
|-----------|--------|-------|
| **Web Dashboard** | `cd web && npm run dev` | Next.js · React · Tailwind · Supabase |
| **Desktop Launcher** | `JHT Desktop` | Electron · electron-builder · browser on `localhost` |
| **CLI** | `jht team start` | Node.js · Commander |
| **TUI** | `jht tui` | `pi-tui` · chalk |
| **Telegram** | Bidirectional bot bridge | Grammy |

## Stack

| Layer | Tech |
|-------|------|
| **Agents** | Claude Code · Codex · Kimi · tmux · SQLite |
| **Backend** | Node.js · TypeScript · Zod |
| **Frontend** | Next.js · Tailwind CSS |
| **Data** | Supabase (PostgreSQL) · Google Drive (user files) |
| **Auth** | Google OAuth · GitHub OAuth · AES-256 credentials |
| **LLM** | Claude · OpenAI · Minimax |
| **CI/CD** | GitHub Actions · Vercel |

## Status

- ✅ **Done** — 7-agent pipeline, CLI (29 commands) + TUI + web dashboard (120 pages wired to real Supabase data), desktop installers (`.dmg` / `.exe` / `.AppImage` / `.deb`), i18n base (it/en), 2500+ tests
- 🔨 **In progress** — Web Platform polish (multi-tenant API, migrating remaining mocks) · Desktop launcher onboarding wizard hardening
- ⏭️ **Next** — Code signing + auto-update for desktop · Multi-provider cloud (AWS/GCP/Hetzner) · Full i18n coverage (ES/DE/FR/PT)

Full roadmap: [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Contributing

PRs and issues welcome. See [`CONTRIBUTING.md`](.github/CONTRIBUTING.md) for the dev setup, PR flow, commit conventions, and agent-specific guides.

## License

MIT — see [LICENSE](LICENSE).
