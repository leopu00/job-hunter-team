# Infrastructure — Job Hunter Team

> 📐 **High-level deployment diagram.** It shows the unit of deployment (the container), the deployment locations (local / dedicated / self-hosted VPS), and the optional sync to managed storage. Not every agent is drawn individually — the full team composition is documented in the [README](../../README.md) and in `agents/`.
>
> Source: [`infra.d2`](../assets/infra.d2).

![JHT infrastructure](../assets/infra.svg)

## At a glance

### 🐳 Docker container — the unit of deployment

Everything operational runs inside a single container: the agent team and local storage (SQLite for structured data, files for CVs and output). Same image, same behavior, whether it runs on a personal PC, a dedicated home computer, or a self-hosted VPS.

### 🔀 Where the team runs — three modes, one location at a time

The user picks **one** location. The choice is **exclusive**: only one container is active at a time — two teams running in parallel (e.g. one local, one self-hosted on a VPS) would fight over the same state and corrupt each other.

The same Docker image runs in all three modes — only the host machine changes:

1. **🖥️ Local PC** — on the user's everyday machine. Available today. *Not recommended for daily-use machines* (8 agents in parallel = high resource usage + the PC must stay on). Acceptable for very powerful desktops or for night-only runs.
2. **🏠 Dedicated computer** — a second PC at home (old laptop, mini-PC, spare desktop), plugged in and left on for weeks/months. Same setup as Local, just different hardware. Planned UX in PHASE 2 (LAN discovery + SSH-based setup).
3. **☁️ Self-hosted VPS** ⭐ **target setup** — a small server rented from a cloud provider (Hetzner ~€4.5/mo, AWS, GCP). Cheaper than buying a dedicated PC and rented only during the active job-hunt months. The team runs in the user's own VPS — there is no managed JHT service. Planned UX in PHASE 3 (one-click provisioning).

The dashboard is served by the container itself:
- Local / Dedicated → `localhost:3000`
- Self-hosted VPS → published on the VPS's public IP (or behind a tunnel, see [`JHT-CLOUD-06`](../BACKLOG.md))

### ☁️ Optional managed storage (read-only mirror)

Two managed services can hold a **read-only mirror** of the operational state:

- **Supabase** — PostgreSQL for structured metadata (positions, scores, applications) + auth
- **Google Drive** — user files (CVs, cover letters, generated PDFs)

This is **opt-in** — the user enables it explicitly via `jht cloud enable` (see [`docs/cli-install.md`](../guides/cli-install.md)). Nothing leaves the local machine until then. Once enabled, the local container periodically pushes a snapshot of the operational state to Supabase + Drive so the user can:
- Browse positions/applications from another device (phone, work laptop)
- Have a backup against local data loss
- Visit `jobhunterteam.ai` and see their own results in the web dashboard

> 📡 **No LLM calls happen on the managed storage side.** The agents always run inside the local container. Supabase and Drive are storage only.

> ⚠️ **Open question — reverse seed**: today the sync flows local → managed-storage only. If the user changes machine (new PC, lost laptop, migration to VPS), they need to seed the new container from the managed storage at least once. This is being designed — see memory `project_cloud_sync_direction_open` and the open task `[JHT-CLOUD-SEED-DIRECTION]` *(to be filed)*. For now, the workaround is a manual backup/restore of the Docker volume.

### 👤 Clients — how the user talks to the team

Three channels today, each with a different audience:

- **🌐 Browser** (web dashboard — `localhost:3000` for Local/Dedicated, public URL for self-hosted VPS) — the user can address **any agent** individually. Talking to the Captain is the recommended default (it coordinates the pipeline), but the user can reach any team member directly.
- **💬 Telegram** — currently a bidirectional bridge to the **Captain only**. Planned upgrade ([`docs/ROADMAP.md`](../about/ROADMAP.md)): per-agent chats + a "team forum" channel where the user can join the whole team's conversation.
- **⌨️ CLI + tmux** *(technical users)* — `jht team attach <agent>` to drop directly into the agent's tmux session and watch it work live (raw model output, tool calls, decisions). Useful for debugging, for understanding what the agents are actually doing, and for power users who prefer the terminal.

In addition, the `jht ...` CLI is intentionally driveable by other AI agents — see [`docs/AI-AGENT-INTEGRATION.md`](../guides/AI-AGENT-INTEGRATION.md). Your Claude Code / 🦞 OpenClaw / Codex / Cursor can configure and start JHT for you autonomously.

## Related

- 🎯 [`docs/VISION.md`](../about/VISION.md) — design philosophy, why local-first, why no SaaS
- 💳 [`docs/PROVIDERS.md`](../about/PROVIDERS.md) — supported subscriptions matrix
- 📊 [`docs/MONITORING.md`](../about/MONITORING.md) — Bridge/Sentinel monitoring stack (architecture + test data)
- 🔒 [`docs/MAINTAINERS.md`](MAINTAINERS.md) — internal operations reference
- 🗺️ [`docs/ROADMAP.md`](../about/ROADMAP.md) — what's coming next
