<p align="center">
  <img src="assets/banner.png" alt="Job Hunter Team — Your AI-Powered Job Search Team" width="100%" />
</p>

<h1 align="center">Job Hunter Team</h1>

<p align="center">
  <strong>Your AI agent team that hunts jobs for you.</strong><br/>
  From position discovery to tailored CVs and cover letters.
</p>

<p align="center">
  <a href="https://github.com/leopu00/job-hunter-team/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/leopu00/job-hunter-team/ci.yml?branch=master&label=CI" alt="CI" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/actions/workflows/test.yml"><img src="https://img.shields.io/github/actions/workflow/status/leopu00/job-hunter-team/test.yml?branch=master&label=tests" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/stargazers"><img src="https://img.shields.io/github/stars/leopu00/job-hunter-team?style=social" alt="GitHub Stars" /></a>
  <a href="https://github.com/leopu00/job-hunter-team/commits/master"><img src="https://img.shields.io/github/last-commit/leopu00/job-hunter-team" alt="Last Commit" /></a>
</p>

<p align="center">
  <a href="#demo">Demo</a> ·
  <a href="#the-team">The Team</a> ·
  <a href="#install">Install</a> ·
  <a href="docs/about/STORY.md">Story</a> ·
  <a href="docs/about/RESULTS.md">Results</a> ·
  <a href="docs/guides/QUICKSTART.md">Quickstart</a> ·
  <a href="docs/about/ROADMAP.md">Roadmap</a> ·
  <a href="https://jobhunterteam.ai">Website</a>
</p>

---

Job hunting is a second job on top of your job: scanning boards daily, qualifying listings, tailoring every application. JHT hands that grind to a team of AI agents running around the clock — Scout finds positions, Analyst verifies them, Scorer ranks them against your profile, Writer prepares tailored documents, Critic blind-reviews everything — orchestrated by a **Captain**. You only review applications that clear the quality bar.

Everything runs **locally in a container** — your machine or your VPS, your profile, your data, your provider account. JHT itself is **free (MIT)**; it runs on a **dedicated LLM subscription (~€40–200/mo)** — breakdown in [Install](#install), local-model support (€0) is open mission [M5](https://github.com/leopu00/job-hunter-team/issues/93).

I built JHT for my own job hunt — ~200 offers analyzed, ~20 tailored applications, **5 interview invites in a few weeks** ([story](docs/about/STORY.md)). Then I rebuilt it as open source. On the public stack, a Codex team ran **one month unattended**: 658 positions found, 520 scored, 307 strong matches, weekly budget self-managed at 99–100% ([results](docs/about/RESULTS.md)).

## Demo

Live dashboards with real, anonymized field data: [jobhunterteam.ai/case-studies](https://jobhunterteam.ai/case-studies).

<p align="center">
  <a href="https://jobhunterteam.ai/case-studies"><img src="assets/screenshots/overview.png" alt="Case studies — what the team delivers, by provider" width="100%" /></a>
</p>

<p align="center">
  <a href="https://jobhunterteam.ai/case-studies/beta-2"><img src="assets/screenshots/beta2-map.png" alt="Where the month-long run hunted, and how well it matched" width="100%" /></a>
</p>

<p align="center">
  <a href="https://jobhunterteam.ai/case-studies/beta-2"><img src="assets/screenshots/beta2-budget.png" alt="The team managing its own weekly AI budget for a month" width="100%" /></a>
</p>

> Numbers are self-reported snapshots of the team's event log, committed in [`web/data/case-studies/`](web/data/case-studies/). Methodology: [`docs/about/RESULTS.md`](docs/about/RESULTS.md).

## The Team

**Always-on core** — 👨‍✈️ **Captain** (orchestration & anti-collision) · 💂 **Sentinel** (event-driven budget watchdog) · 👩‍💼 **Assistant** (platform copilot) · 🧙‍♂️ **Mentor** (career coach)

**Worker pool, scaled 1..N by the Captain** — 🕵️ **Scout** (finds positions) · 👨‍🔬 **Analyst** (verifies them) · 👨‍💻 **Scorer** (0–100 against your profile) · 👨‍🏫 **Writer** (CVs & cover letters) · 👨‍⚖️ **Critic** (3 blind review rounds)

**Daily one-shots** — 🩺 **Dottore** (agent health) · 👷‍♂️ **Mantenitore** (infra health) · plus 📡 **Bridge**, the usage clock (a process, not an agent)

**Why a team instead of one clever prompt?** Each role keeps its own small context (a model that just read 50 job ads reasons measurably worse about CV tone); blind review only works if the Critic genuinely hasn't seen the Writer's reasoning; and the Captain can throttle or scale each role independently to keep 24/7 operation inside a fixed subscription budget.

```
                                       👤 User
                       ┌─────────────────┼─────────────────┐
                       ▼                 ▼                 ▼
               🧙‍♂️ Mentor       👩‍💼 Assistant      👨‍✈️ Captain ◀··intervene·· 💂 Sentinel ◀──notify── 📡 Bridge
                                                           │
                                                           ▼
                                  🕵️ Scout → 👨‍🔬 Analyst → 👨‍💻 Scorer → 👨‍🏫 Writer → 📤✅ Ready to submit
                                                                          ⇅
                                                                     👨‍⚖️ Critic (3 blind rounds)
```

Each agent is an autonomous AI session on one of the supported CLIs (Claude Code, Codex, Kimi); a shared SQLite database keeps state in sync. Monitoring details: [`docs/about/MONITORING.md`](docs/about/MONITORING.md).

## Install

> 🧪 **Beta.** The native desktop application is now the Godot office in [`game/`](game/); the CLI remains available for automation and remote administration. Hit a snag? [`docs/guides/BETA.md`](docs/guides/BETA.md).

**What it costs** — the team burns ~400M tokens/month, so it needs a flat-rate subscription **dedicated to the team** (a shared account hits rate limits): the same usage on pay-per-use APIs would be $1,000–2,500/mo. Reasoning: [ADR-0004](docs/adr/0004-subscription-only-no-api-keys.md) · details: [`docs/about/PROVIDERS.md`](docs/about/PROVIDERS.md).

| Provider | Plan | Cost/mo | Status |
|---|---|---|---|
| **Claude** | Max x20 | ~€200 | Production-ready, best precision |
| **Codex** | Plus / Pro | ~€100 | Proven — 1-month autonomous run |
| **Kimi** | Pro | ~€40 | Beta — in observation |

**Recommended: inspect first, then run** (macOS / Linux / WSL) — the installer is [versioned in this repo](web/public/install.sh) and previews every action:

```bash
curl -fsSL https://jobhunterteam.ai/install.sh -o install.sh
less install.sh              # read what it does
bash install.sh --dry-run    # preview every action — no changes to your system
bash install.sh
```

Or the one-liner, if you've read it and trust it: `curl -fsSL https://jobhunterteam.ai/install.sh | bash`

> It touches exactly two files on the host — `~/.jht/runtime/docker-compose.yml` and the `~/.local/bin/jht` wrapper. Everything else runs inside an isolated container; only `~/.jht` and `~/Documents/Job Hunter Team` are mounted.

Full walkthrough, expert mode and contributor setup: [`docs/guides/QUICKSTART.md`](docs/guides/QUICKSTART.md).

## Interfaces

**Native desktop app** (the Godot office in [`game/`](game/)) · **CLI** (`jht team start` — [reference](docs/guides/CLI-REFERENCE.md)) · **Cloud dashboard** (Next.js) · **Telegram**

## AI agents can drive JHT

The `jht` CLI is designed to be driven by AI assistants, not just humans. Already use **Claude Code**, **🦞 OpenClaw**, **Codex** or **Cursor**? Tell it *"Set up JHT and start the team for me"* — it figures out the rest. Guide: [`docs/guides/AI-AGENT-INTEGRATION.md`](docs/guides/AI-AGENT-INTEGRATION.md).

## Stack & status

**Stack** — Godot 4.7 (native desktop app and office) · Node.js/TypeScript + Python (agents, monitoring, skills) · Next.js 16 + Supabase (cloud dashboard) · Docker · SQLite · GitHub Actions + Vercel.

**Status** — team, CLI, web dashboard and native Godot application are tested across all three providers; onboarding, operations and settings now live in the office. Full picture: [`docs/about/ROADMAP.md`](docs/about/ROADMAP.md).

Monorepo: [`game/`](game/) · [`cli/`](cli/) · [`web/`](web/) · [`shared/`](shared/) · [`agents/`](agents/) · [`scripts/`](scripts/) · [`e2e/`](e2e/) · [`supabase/`](supabase/) · [`docs/`](docs/) — index in [`docs/README.md`](docs/README.md).

## Contributing

JHT is built by a solo maintainer orchestrating AI agents on parallel `devN` branches — external contributions come in as `feat/`/`fix/` branches → PR ([`CONTRIBUTING.md`](.github/CONTRIBUTING.md)).

- Start here: [`good first issue`](https://github.com/leopu00/job-hunter-team/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22) · bigger directions: [contributor missions M1–M5](docs/about/ROADMAP.md#-where-you-can-help--contributor-missions)
- Beta tester? [`docs/guides/BETA.md`](docs/guides/BETA.md) — we want real job-seekers to break things
- Security issue? [`SECURITY.md`](SECURITY.md) — responsible disclosure, please no public issue

## License

MIT — see [LICENSE](LICENSE).
