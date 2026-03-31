# job-hunter-team

An open-source multi-agent AI framework that automates your job search — from finding positions to writing tailored CVs and cover letters.

Point it at your profile, let the team run, and review only the applications that pass the quality bar.

---

## Features

- **Scout agents** — continuously search job boards across EU and remote markets
- **Analyst agents** — verify job descriptions, check links, analyze company culture
- **Scorer agents** — rank positions 0-100 against your profile with configurable weights
- **Writer agents** — generate tailored CVs and cover letters per position
- **Critic agents** — blind review of every document (3 mandatory rounds before submission)
- **Captain agent** — coordinates the full pipeline, handles anti-collision, reports progress
- **Monitor agent** — tracks Claude API token usage in real-time, throttles the team before hitting rate limits
- **Anti-collision system** — distributed claim mechanism prevents duplicate work across agents
- **SQLite → PostgreSQL** — local-first by default, PostgreSQL-ready for multi-user deployments

---

## Prerequisites

- Python 3.10+
- [Claude CLI](https://claude.ai/download) — Claude Max subscription **or** Anthropic API key
- Node.js 18+ and npm (for the web app)
- tmux (Linux/macOS — for multi-agent orchestration)
- WSL2 with Ubuntu + tmux (Windows — for multi-agent orchestration)
- pandoc + typst (for PDF generation)

---

## Quick Start

### Linux / macOS

```bash
# 1. Clone the repo
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# 2. Run setup (creates .env, web/.env.local, virtualenv, npm install, database)
./setup.sh

# 3. Fill in your candidate profile
# Edit candidate_profile.yml — skills, experience, target roles

# 4. Fill in web credentials
# Edit web/.env.local — add your Supabase URL and anon key

# 5. Launch the agent team
./.launcher/start.sh

# 6. Launch the web app
cd web && npm run dev
# → http://localhost:3000
```

### Windows (PowerShell)

```powershell
# 1. Clone the repo
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# 2. Run setup
powershell -ExecutionPolicy Bypass -File setup.ps1

# 3. Fill in your candidate profile
# Edit candidate_profile.yml

# 4. Fill in web credentials
# Edit web\.env.local

# 5. Launch the web app
cd web; npm run dev
# → http://localhost:3000
```

> **Claude Max users:** no API key needed — the CLI uses your subscription automatically.
> **API key users:** add `ANTHROPIC_API_KEY` to `.env`.

### Alternative: Docker (hot reload)

```bash
cd web && docker compose up
# → http://localhost:3000
```

---

## Architecture

```
scout/ → analista/ → scorer/ → scrittore/ → critico/ → you click send
```

Each agent is a Claude Code session with a dedicated `CLAUDE.md` instruction file. The Captain (`alfa/`) coordinates the full pipeline via tmux and a shared SQLite database.

See [`shared/docs/architettura.md`](shared/docs/architettura.md) for the full flow diagram.

---

## Team

| Agent | Role | Model |
|-------|------|-------|
| `scout` | Finds job postings | Sonnet |
| `analista` | Verifies JDs and companies | Sonnet |
| `scorer` | Scores positions 0-100 | Sonnet |
| `scrittore` | Writes CV + cover letter | Opus |
| `critico` | Blind CV review | Sonnet |
| `capitano` | Coordinates pipeline | Opus |
| `monitor` | Tracks API usage | Haiku |
| `mentor` | Gap analysis | Sonnet |
| `archi-1/2` | Infrastructure | Opus |

---

## Contributing

Pull requests welcome. Please read [`shared/docs/add-agent.md`](shared/docs/add-agent.md) before adding new agents.

---

## License

MIT — see [LICENSE](LICENSE).
