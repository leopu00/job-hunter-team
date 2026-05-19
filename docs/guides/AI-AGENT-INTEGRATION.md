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

If `vps`: stop and switch to the VPS provisioning runbook in `docs/guides/VPS-SETUP.md`. The agent can drive that flow too, but it is a superset (SSH key, Hetzner API token, `install.sh --pairing-token`). For fully autonomous provisioning (agent creates the server itself via `hcloud`), see [§Advanced — Autonomous VPS provisioning](#advanced--autonomous-vps-provisioning-with-hcloud) below.

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

## Advanced — Autonomous VPS provisioning with `hcloud`

> ⚠️ **Opt-in, AI-agent-only path.** The Desktop wizard (Path 2) intentionally
> does **not** automate VPS creation — the user clicks through the Hetzner
> portal manually (locked decision 2026-05-13: smaller attack surface, no
> spending token in the app). This section is for the **personal AI agent**
> path only, where the user has already chosen to trust their agent with
> shell + spending.

When the agent is driving setup (the runbook above) and the user chose
`vps`, the only remaining manual step from `docs/guides/VPS-SETUP.md §1` is
"create the server on console.hetzner.com and paste the IP". The Hetzner
official CLI [`hcloud`](https://github.com/hetznercloud/cli) closes that gap.

### Pre-flight

1. **ASK USER**: confirm they want fully autonomous provisioning and that
   they understand the agent will create a billable resource on their
   behalf. **Quote the cost out loud** (default `cx22` ≈ €4.50/mo, `cpx22`
   ≈ €9.75/mo) and **wait for explicit confirmation**.
2. **ASK USER** for a Hetzner Cloud API token scoped to a single project
   (`console.hetzner.com → Security → API Tokens → Read & Write`).
3. Install `hcloud` on the agent's machine if missing:
   ```bash
   # macOS
   brew install hcloud
   # Windows
   scoop install hcloud   # or: choco install hcloud
   # Linux
   curl -fsSL https://github.com/hetznercloud/cli/releases/latest/download/hcloud-linux-amd64.tar.gz \
     | tar -xz -C /tmp && sudo mv /tmp/hcloud /usr/local/bin/
   ```
4. Configure context (token stays in `~/.config/hcloud/cli.toml`, mode 0600):
   ```bash
   hcloud context create jht   # paste token when prompted
   ```

### Provision

```bash
# 1. Upload the JHT SSH pubkey (generated in step 2 of the main runbook,
#    or via `ssh-keygen -t ed25519 -f ~/.ssh/jht_ed25519 -C "jht"`).
hcloud ssh-key create --name jht --public-key-from-file ~/.ssh/jht_ed25519.pub

# 2. Create the server. ALWAYS pin --type and --location; never let the
#    agent default-pick. Recommended baseline:
hcloud server create \
  --name jht \
  --type cpx22 \
  --image ubuntu-24.04 \
  --location hel1 \
  --ssh-key jht

# 3. Capture the IPv4 and wait for SSH to be reachable:
VPS_IP=$(hcloud server ip jht)
until ssh -o StrictHostKeyChecking=accept-new -o ConnectTimeout=3 \
          -i ~/.ssh/jht_ed25519 root@"$VPS_IP" true 2>/dev/null; do
  sleep 5
done
echo "VPS ready at $VPS_IP"
```

From here, **resume the existing flow** at `docs/guides/VPS-SETUP.md §3`
(swap) or §4 (`install.sh`). The agent should pass the `VPS_IP` and the
pairing token (if the user is on the Desktop path) or follow the bare
CLI runbook (if pure agent path).

### Cost guardrails the agent MUST enforce

- **Never** create more than one server per user. JHT is single-team
  (locked: `project_team_location_exclusive.md`). If `hcloud server list`
  shows an existing `jht` server, reuse it — don't spawn a duplicate.
- **Never** auto-upgrade `--type` (no `cpx32`/`cpx52` without an
  explicit user request). If the user reports memory pressure, surface
  the Hetzner price diff and **ASK USER** before resizing.
- **Never** leave a server running after the user says "I got hired"
  or "stop everything". Use the teardown below.

### Teardown — "I got hired"

```bash
# Snapshot first (preserves /home/jht state at ~€0.10/mo, restorable in 90s).
hcloud server create-image --type snapshot --description "jht-snapshot-$(date +%F)" jht

# Then delete the server. Hetzner does NOT bill for "powered off" servers
# being kept around — only `delete` stops billing.
hcloud server delete jht
```

Confirm with `hcloud server list` (must be empty) and report the snapshot
ID back to the user so they can restore via `hcloud server create --image <id>`.

### Other providers

The pattern (single binary, token-scoped CLI, no Desktop equivalent) ports
to other clouds the agent may encounter on the user's machine:

| Provider          | CLI         | Equivalent of `server create`           |
|-------------------|-------------|------------------------------------------|
| DigitalOcean      | `doctl`     | `doctl compute droplet create`           |
| AWS EC2           | `aws`       | `aws ec2 run-instances`                  |
| GCP Compute       | `gcloud`    | `gcloud compute instances create`        |
| OVHcloud          | `ovh-cli`   | (less mature; prefer manual portal step) |

For all of them: same cost-guardrail rules (one server, never auto-upgrade,
teardown on hire). JHT itself is provider-agnostic from `install.sh`
onward — the only thing the agent needs to deliver is `root@<IP>` reachable
over SSH with the JHT pubkey installed.

---

## Related

- [`docs/cli-install.md`](cli-install.md) — full CLI reference
- [`docs/quickstart.md`](quickstart.md) — the human-friendly version of this guide
- [`docs/PROVIDERS.md`](../about/PROVIDERS.md) — which subscription to pick
- [`docs/guides/VPS-SETUP.md`](VPS-SETUP.md) — VPS provisioning superset (SSH, Hetzner)
- [`docs/internal/onboarding-flow.md`](../internal/onboarding-flow.md) — design rationale for the 3 paths
