# 🏗️ Infrastructure — Job Hunter Team

> 📐 **Current deployment and web-surface map.** It shows the unit of
> deployment, the deployment locations and the browser origins that are
> meaningful today. The older diagram showed the retired local dashboard and
> is intentionally not used as an operational reference.

## At a glance

### 🐳 Docker container — the unit of deployment

Everything operational runs inside a single container: the agent team and local storage (SQLite for structured data, files for CVs and output). Same image, same behavior, whether it runs on a personal PC, a dedicated home computer, or a self-hosted VPS.

The shipped container exposes **no HTTP port**. The native Godot application is
the control surface: it uses `docker exec` for a local team and SSH for a VPS.
The browser is a separate cloud surface, not a route into the runtime
container.

### 🌐 Web surfaces and local origins

Use this table to identify an origin before opening it or recording against it.
Every localhost entry is a development or recording process explicitly started
by a contributor; none is a product endpoint exposed by the runtime
container.

| Port / origin | State | Purpose | Public or shipped user surface? |
| --- | --- | --- | --- |
| `http://localhost:3000` | **Retired as a shipped surface** on 2026-07-23 | The old container-served local dashboard. Bare `npm run dev` can still make a developer's Next process choose its default port, and an older E2E default still names it; neither restores the product dashboard. | No |
| `http://localhost:3001` | Active when a contributor starts the local host development mode | Main local Next development origin, with the host process using the local container integration. | No — development only |
| `http://localhost:3002` | Active when a contributor starts the parallel local host development mode | A second local development origin using the same integration. | No — development only |
| `http://localhost:3003` | Active when a contributor starts cloud-mode development | Local Next development origin configured for the cloud deployment mode. | No — development only |
| `http://localhost:3005` | **Historical only** (2026-05-23) | An ad-hoc `next dev` host mentioned for `dev2` in the isolated simulation Compose file. That simulation container published no ports and was never a product dashboard. | No |
| `http://localhost:3008` | Active only for the controlled recording/E2E flow | The isolated cloud-mode origin paired with the recording auth-state and pre-take gates. It was introduced independently on 2026-08-04. | No — recording/development only |
| `https://jobhunterteam.ai` | Current production browser origin | The cloud site and authenticated, read-mostly dashboard. | Yes — the only shipped browser surface |

This is **not a migration from `:3005` to `:3008`**. `:3005` is an old
simulation-side development reference. `:3008` was created separately for
release recording and its origin-specific storage state. Browser storage is
origin-scoped, so recording state for `:3008` must not be reused for any other
localhost port.

### 🔀 Where the team runs — three modes, one location at a time

The user picks **one** location. The choice is **exclusive**: only one container is active at a time — two teams running in parallel (e.g. one local, one self-hosted on a VPS) would fight over the same state and corrupt each other.

The same Docker image runs in all three modes — only the host machine changes:

1. **🖥️ Local PC** — on the user's everyday machine. Available today. *Not recommended for daily-use machines* (~8 agents in parallel = high resource usage + the PC must stay on). Acceptable for very powerful desktops or for night-only runs.
2. **🏠 Dedicated computer** — a second PC at home (old laptop, mini-PC, spare desktop), plugged in and left on for weeks/months. Same setup as Local, just different hardware. Planned UX in PHASE 2 (LAN discovery + SSH-based setup).
3. **☁️ Self-hosted VPS** ⭐ **target setup** — a small server rented from a cloud provider (Hetzner ~€4.5/mo, AWS, GCP). Cheaper than buying a dedicated PC and rented only during the active job-hunt months. The team runs in the user's own VPS — there is no managed JHT service. Planned UX in PHASE 3 (one-click provisioning).

The local dashboard previously served at `localhost:3000` was removed on
2026-07-23 (`303a6ec60`), as recorded in the [0.3.0 changelog](../../../CHANGELOG.md).
Local and VPS interaction moved to the native application via `docker exec` or
SSH, respectively; the browser is cloud-only. A VPS therefore does not publish
the runtime dashboard on its network address.

### ☁️ Optional managed storage (read-only mirror)

Two managed services can hold a **read-only mirror** of the operational state:

- **Supabase** — PostgreSQL for structured metadata (positions, scores, applications) + auth
- **Google Drive** — user files (CVs, cover letters, generated PDFs)

This is **opt-in for Local PC**, **mandatory for VPS** (the VPS uses cloud storage as the only way to recover state if it dies). When enabled, the local container periodically pushes a snapshot of operational state to Supabase + Drive so the user can:
- Browse positions/applications from another device (phone, work laptop)
- Have a backup against local data loss
- Visit `jobhunterteam.ai` and see their own results in the web dashboard
- Migrate to a new machine without losing data (see "Bootstrap" below)

> 📡 **No LLM calls happen on the managed storage side.** The agents always run inside the local container. Supabase and Drive are storage only.

> 🔄 **Sync model (updated 2026-08-04):** the container remains the source of
> truth for results (positions, scores and applications) and mirrors deltas to
> Supabase. In the opposite direction, the cloud accepts only narrow,
> user-scoped request lanes: chat, persistent team directives, per-position CV
> requests and bounded feedback/actions. The mobile emergency control is
> stop-only. The web surface cannot expose shell access, arbitrary commands,
> team start/restart or general configuration; those stay in the native
> application.
>
> **Bootstrap automatico**: quando l'utente fa login con lo stesso account su un **container nuovo/vuoto** (es. nuova VPS appena installata, o nuovo PC dopo perdita del vecchio), l'app rileva che il DB locale è vuoto e fa un **pull automatico** dal cloud — DB locale allineato, da lì in poi sync normale. Niente comandi manuali, niente backup/restore Docker volume.
>
> **Cosa si sincronizza**: posizioni + metadati (`jobs.db`), profilo utente (`candidate_profile.yml`), tema/settings dashboard, flag user-driven (`write_requested`, futuro `geocode_requested`), tombstones di righe cancellate. Memoria agenti runtime (tmux, skill state) e CV binari → restano locali. Living doc completa: [`docs/internal/architecture/cloud-sync-architecture.md`](../architecture/cloud-sync-architecture.md).

### 👤 Clients — how the user talks to the team

Three channels today, each with a different audience:

- **🌐 Browser** ([`jobhunterteam.ai`](https://jobhunterteam.ai)) — the
  production browser surface is cloud-only. With cloud sync enabled, it is
  read-mostly and offers the bounded request lanes described above; it cannot
  control the local or VPS runtime directly.
- **💬 Telegram** — **3-bot bidirectional bridge** (decisione 2026-05-13 rev2): Assistente (orchestrator user-facing), Capitano (status + decisioni operative), Mentor (career coach always-on). Tutti e tre obbligatori nell'onboarding wizard, routing per ruolo via `tg-bridge` + skill `jht-telegram-send` distribuita. Roadmap futura ([`docs/about/ROADMAP.md`](../../about/ROADMAP.md)): per-agent 1:1 chat (Scout/Critic/Writer/Scorer/Sentinel) + "team forum" channel.
- **⌨️ CLI + tmux** *(technical users)* — `jht team attach <agent>` to drop directly into the agent's tmux session and watch it work live (raw model output, tool calls, decisions). Useful for debugging, for understanding what the agents are actually doing, and for power users who prefer the terminal.

In addition, the `jht ...` CLI is intentionally driveable by other AI agents — see [`docs/guides/AI-AGENT-INTEGRATION.md`](../../guides/AI-AGENT-INTEGRATION.md). Your Claude Code / 🦞 OpenClaw / Codex / Cursor can configure and start JHT for you autonomously.

## Related

- 🎯 [`docs/about/VISION.md`](../../about/VISION.md) — design philosophy, why local-first, why no SaaS
- 💳 [`docs/about/PROVIDERS.md`](../../about/PROVIDERS.md) — supported subscriptions matrix
- 📊 [`docs/about/MONITORING.md`](../../about/MONITORING.md) — Bridge/Sentinel monitoring stack (architecture + test data)
- 🔒 [`docs/internal/ops/MAINTAINERS.md`](MAINTAINERS.md) — internal operations reference
- 🗺️ [`docs/about/ROADMAP.md`](../../about/ROADMAP.md) — what's coming next
