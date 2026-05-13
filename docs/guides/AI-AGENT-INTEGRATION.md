# AI Agent Integration

## Your AI assistant can run JHT for you

JHT exposes a complete `jht` CLI that is *intentionally* designed to be driven by other AI agents, not just by humans. If you already use a personal AI assistant (Claude Code, 🦞 OpenClaw, Codex, Cursor, …), just point it at this repo:

> *"Set up Job Hunter Team from https://github.com/leopu00/job-hunter-team for a [your role] profile. I have a [your subscription]. Walk me through what you need."*

It will read the docs, install the CLI, run `jht doctor`, fix any issues, and start the team.

This is one of JHT's primary design decisions:

- 🤖 **AI-native users are JHT's early adopters** — same people comfortable delegating setup to an AI get the most out of an autonomous agent team
- ⏱️ **Setup time → seconds**, not 5 pages of docs
- 🔧 **One CLI surface** for humans, AI agents, and the Desktop launcher

## What the AI agent should NOT do automatically

- 🛑 **Never push API keys or subscription tokens to git.** All secrets go in `.env` (gitignored).
- 🛑 **Never auto-submit applications.** JHT produces "Ready for submission" packages — the human decides what to send.
- 🛑 **Never overwrite the user's `candidate_profile.yml`** without confirmation — that file is the user's identity in the system.

## CLI completeness — the rule

If a feature requires opening the web dashboard or the Desktop app to be configured *after install*, that's a bug. The CLI must be self-sufficient for day-to-day operation. File an issue if you find an exception.

## Setup runbook (Path 3 — no Desktop app)

> **Audience**: an AI agent (Claude Code / OpenClaw / Codex / Cursor) running on the user's machine. Treat this as an executable script: each step is a concrete CLI invocation. Stop and ask the user only at the points marked **ASK USER**.
>
> See `docs/internal/onboarding-flow.md` for the design rationale (Path 1 / 2 / 3 split, lock decisions).

### 0 — Prerequisites check

```bash
# Docker or Colima must be present and running. Refuse to proceed otherwise.
docker info >/dev/null 2>&1 || { echo "Docker non in esecuzione"; exit 1; }

# Node 22.5+ (per node:sqlite usato da `jht cloud push`).
node --version
```

If Docker is missing: instruct the user to install Docker Desktop (macOS / Windows) or Colima (`brew install colima && colima start`). **Do not** try to `brew install docker` automatically — it leaves the user with the `docker` binary but no daemon.

### 1 — Install the CLI

```bash
curl -fsSL https://jobhunterteam.ai/install.sh | bash
# Adds `~/.local/bin/jht` (host wrapper) + pulls the runtime container image.
```

After install: `export PATH="$HOME/.local/bin:$PATH"` if not already on PATH.

### 2 — **ASK USER**: location

```
Local PC   → tutto sul Mac/Win/Linux dell'utente, niente costi cloud
VPS Hetzner → €5–10/mese, sempre on, indipendente dal PC
```

Persist the choice:

```bash
mkdir -p ~/.jht
echo "JHT_HOST_TYPE=local" > ~/.jht/host.env   # or 'vps'
```

If `vps`: stop and switch to the VPS provisioning runbook in `docs/guides/VPS-SETUP.md`. The agent can drive that flow too, but it is a superset (SSH key, Hetzner API token, `install.sh --pairing-token`).

### 3 — **ASK USER**: cloud sync (opt-in for Local, mandatory for VPS)

For **Local**: ask whether to enable cloud sync. If yes, run the device-flow pairing — it opens a browser for the user to confirm:

```bash
jht cloud login
# Output: "Apri https://jobhunterteam.ai/cli-link e digita ABCD-1234"
# After the user confirms, the CLI saves ~/.jht/cloud.json (mode 0600).
```

For **VPS**: cloud sync is structurally required. The recommended path is the desktop pairing-token (see `docs/internal/vps.md` § "Identità unificata"). If the agent is driving without the desktop, fall back to `jht cloud login` from inside the VPS shell.

### 4 — **ASK USER**: 3 Telegram bot tokens (mandatory)

```
Assistente   — direct chat with the user
Capitano     — escalations and team-wide updates
Mentor       — learning loop / weekly review
```

Walk the user through https://t.me/BotFather (one `/newbot` per role). When the user pastes the 3 tokens:

```bash
jht config set channels.telegram.bots.assistente.bot_token <token>
jht config set channels.telegram.bots.capitano.bot_token   <token>
jht config set channels.telegram.bots.mentor.bot_token     <token>
```

(`shared/config/schema.ts` § `TelegramBotsSchema` validates the shape; missing or empty tokens fail fast.)

### 5 — Provider AI login (interactive, terminal-bound)

```bash
jht setup
# Opens the wizard. The user picks Claude / Codex / Kimi and completes
# the provider's interactive OAuth/login. The token is saved on the
# host you chose in step 2 (Local: this machine; VPS: the VPS shell).
```

The agent **must not** try to script this — provider login flows expect a real TTY and will reject piped input.

### 6 — First team start

```bash
jht team start
jht status                # confirm `mode: running`
jht logs --follow         # optional: stream agent activity
```

Open the dashboard:

```bash
jht dashboard             # Local: opens http://localhost:3000
                          # VPS:   prints the SSH tunnel command
```

### 7 — Verification (the agent should do this before reporting "done")

```bash
jht doctor                # must exit 0; surfaces auth + Docker + DB checks
jht cloud status          # if sync was enabled, must show `abilitato`
```

If `jht doctor` flags an issue, fix it with the suggested remediation before handing back to the user. Never declare setup complete on a failing `doctor`.

---

## Related

- [`docs/cli-install.md`](cli-install.md) — full CLI reference
- [`docs/quickstart.md`](quickstart.md) — the human-friendly version of this guide
- [`docs/PROVIDERS.md`](../about/PROVIDERS.md) — which subscription to pick
- [`docs/guides/VPS-SETUP.md`](VPS-SETUP.md) — VPS provisioning superset (SSH, Hetzner)
- [`docs/internal/onboarding-flow.md`](../internal/onboarding-flow.md) — design rationale for the 3 paths
