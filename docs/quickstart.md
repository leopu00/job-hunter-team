# Quickstart — Job Hunter Team

Get the system running in 5 minutes.

## Recommended path: one-liner installer

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
```

The script:

1. Detects your OS (macOS, Linux apt/dnf/pacman, WSL)
2. Installs Node 20+, tmux, git, Claude CLI if missing
3. Clones the repo into `~/.jht/src`
4. Builds TUI + CLI
5. Creates a `jht` symlink in `~/.local/bin`
6. Launches the interactive setup wizard

At the end you'll have two folders:

| Folder | Purpose | Who touches it |
|--------|---------|----------------|
| `~/.jht/` | Config, `jobs.db` database, agents, credentials | Agents and CLI only |
| `~/Documents/Job Hunter Team/` | CVs to analyze, generated output (PDF/MD) | You + the agents |

## Alternative path: desktop launcher (non-tech)

Download the launcher from the `/download` page or GitHub Releases:

- macOS: `.dmg`
- Windows: `.exe`
- Linux: `.AppImage` or `.deb`

The launcher installs everything through a graphical interface, no terminal needed.

## Source setup (for contributors)

This section is for local development, hacking on the repo, and PRs.

### Prerequisites

- **Node.js 20+** and npm
- **tmux**
- **git**
- **Claude CLI** (`npm install -g @anthropic-ai/claude-cli`)

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/leopu00/job-hunter-team.git
cd job-hunter-team

# 2. Build TUI and CLI
npm --prefix tui install && npm --prefix tui run build
npm --prefix cli install

# 3. Launch the wizard (creates ~/.jht and ~/Documents/Job Hunter Team)
node cli/bin/jht.js
```

The wizard asks for an AI provider and API key. The candidate profile is filled later via the TUI (Profile view) or the web dashboard.

## Team structure

The system uses parallel AI agents, each with a specific role:

| Agent | Role | tmux session |
|-------|------|--------------|
| Captain | Pipeline coordinator, anti-collision | `CAPITANO` |
| Scout | Searches job boards | `SCOUT-1`, `SCOUT-2` |
| Analyst | Verifies JDs and companies | `ANALYST-1`, `ANALYST-2` |
| Scorer | Scores 0–100 | `SCORER-1` |
| Writer | Writes CVs and cover letters | `WRITER-1` |
| Critic | Blind review of CVs | `CRITIC` |
| Sentinel | Monitors tokens, rate limits, costs, team health | `SENTINEL` |

## Operational flow

```
Scout → finds positions → DB (status: new)
Analyst → verifies JD → DB (status: checked / excluded)
Scorer → scores 0-100 → DB (status: scored)
  └─ score < 40 → excluded
  └─ score >= 50 → notifies Writer
Writer → CV + CL → 3 rounds with Critic
  └─ critic_score >= 5 → status: ready (ready to send)
  └─ critic_score < 5  → status: excluded
User → final review → submits application
```

## Starting agents manually

Each agent runs in a separate tmux session:

```bash
# Start Scout-1
tmux new-session -d -s SCOUT-1 -c scout/
tmux send-keys -t SCOUT-1 "claude --dangerously-skip-permissions" Enter

# Start Analyst-1
tmux new-session -d -s ANALYST-1 -c analista/
tmux send-keys -t ANALYST-1 "claude --dangerously-skip-permissions" Enter
```

## Useful DB commands

```bash
# Overview dashboard
python3 shared/skills/db_query.py dashboard

# Positions by status
python3 shared/skills/db_query.py positions --status new
python3 shared/skills/db_query.py positions --min-score 50

# Position detail
python3 shared/skills/db_query.py position 42

# Stats
python3 shared/skills/db_query.py stats
```

## Full documentation

- [DB schema](../shared/docs/db-schema.md)
- [Agent anti-collision](../shared/docs/anti-collisione.md)
- [Communication rules](../shared/docs/regole-comunicazione.md)
- [Adding an agent](../shared/docs/add-agent.md)
