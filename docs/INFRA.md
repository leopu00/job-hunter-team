# Infrastructure — Job Hunter Team

> High-level diagram. Source: [`infra.d2`](./infra.d2).

![JHT infrastructure](./infra.svg)

## At a glance

### 🐳 Docker container — the unit of deployment

Everything that matters runs inside a single container: the 7-agent team (Captain + Sentinel + the pipeline: Scout → Analyst → Scorer → Writer ⇄ Critic) and local storage (SQLite for structured data, files for CVs and output). Same image, same behavior, whether it runs on a personal PC or a cloud VPS.

### 🔀 Local vs Cloud — one team, one location

The user picks where the team runs. The choice is **exclusive**: only one container is active at a time — two teams running in parallel (one local, one on VPS) would fight over the same state and corrupt each other.

- **Local** — on their own PC. Dashboard served at `localhost:3000` by the container itself.
- **Cloud** — on a remote VPS. Dashboard served publicly at `jobhunterteam.ai`.

Independently of where the team runs, the **local storage can sync to Cloud Storage** — purely for backup / remote access to data (CVs, positions, applications), not to clone the team.

### ☁️ Cloud storage

Two services handle persistent state in the cloud:

- **Supabase** — PostgreSQL for structured data and auth.
- **Google Drive** — user files (CVs, cover letters, generated PDFs).

The cloud dashboard reads from Supabase + Drive directly, not from the VPS — the VPS only runs the agents.

### 👤 Clients

Two channels, with different reach today:

- **Browser** (web dashboard — `localhost:3000` or `jobhunterteam.ai`) — the user can address **any agent** individually. Talking to the Captain is the recommended default (it coordinates the pipeline), but the user can reach any team member directly if they want.
- **Telegram** — currently a bidirectional bridge to the **Captain only**. A future upgrade (see [`ROADMAP`](./ROADMAP.md#communication-channels)) will expose a Telegram group with all agents and directed messages, so the user can target a specific agent without spamming the others.

