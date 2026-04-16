# 🗺️ ROADMAP — Job Hunter Team

> Last updated: 2026-04-16

---

## 🎯 Vision

Job Hunter Team becomes a **desktop application** anyone can download — non-technical users included.
The user downloads an installer, runs it, and a desktop launcher prepares the environment, starts JHT in the background, and opens the local web GUI in the browser.
The main UI stays the web dashboard on `localhost`; the desktop app is just the zero-terminal entry point.

**Two execution modes (user's choice):**

```
  👤 Any user                                 ☁️ Cloud user
        │                                          │
        ▼                                          ▼
  ┌───────────┐                           ┌──────────────┐
  │ 🖥️ Desktop │                          │  ☁️ Remote   │
  │  App      │                           │     VM       │
  │ (local)   │                           │ AWS/GCP/     │
  │           │                           │ Hetzner      │
  └───────────┘                           └──────────────┘
        │                                          │
        └──────────────────────┬───────────────────┘
                               │
                               ▼
                      🌐 Web Dashboard
                   (remote monitoring)
                    Vercel + Supabase
```

> "Local" covers anything the user owns — personal laptop, spare desktop, a LAN-side box. The launcher treats them uniformly. If the user outgrows local, they migrate to Cloud.

**Stack decisions:**

| Component | Technology | Rationale |
|-----------|------------|-----------|
| Desktop app | **Lightweight Electron launcher** | Installer, tray, lifecycle manager; operational GUI stays in the browser |
| Web dashboard | **Next.js on Vercel** | CI/CD pipeline already in place |
| Structured data | **Supabase** | Already active, PostgreSQL, Google auth |
| User files (cloud) | **Google Drive** | CV, cover letters, generated PDFs |
| Cloud provisioning | **Multi-provider** | AWS + GCP + Hetzner with an abstraction layer |
| Primary language | **English** | International target, Italian as secondary |

---

## 📅 Development phases

```
  Phase 1             Phase 2             Phase 3             Phase 4             Phase 5
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🔨 IN PROGRESS      ⏳ NEXT             ⏳ NEXT              ⏳ NEXT             🔮 FUTURE
  Web Platform       Desktop Launcher     Cloud Multi-         Full               Public
  consolidation     + localhost GUI       Provider             i18n               Website
```

---

### 🔨 Phase 1 — Web Platform Consolidation (current sprint)

> _"The web app works end-to-end with real data."_

```
🟢 Status: IN PROGRESS
━━━━━━━━━━━━━━━━━━░░░ ~78%

✅ Next.js app with 120 pages (App Router)
✅ Google auth configured
✅ DB schema V2 (5 tables + RLS)
✅ Vercel CI/CD pipeline
✅ Dashboard wired to real Supabase data
✅ Positions and applications pages live
✅ User profile with cloud save
⬜ Vercel deploy (missing GitHub secrets)
⬜ API layer agents → Supabase (multi-tenant)
⬜ Web platform E2E tests
```

---

### 📦 Phase 2 — Desktop Launcher

> _"Download, install, everything starts in the background, then you work from the browser."_

```
🟡 Status: IN PROGRESS
━━━━━━━━━━━━━░░░░░░░ ~55%

✅ `desktop/` scaffolding + electron-builder
✅ Local launcher/orchestrator with browser opener and runtime manager
✅ Pre-built payload: web GUI already compiled, no user-side rebuild
✅ Installers: .dmg (macOS), .exe NSIS (Windows), .AppImage + .deb (Linux)
✅ Release workflow with GitHub Releases and native runners per OS
✅ Graphical setup wizard (language, profile, AI provider, credentials)
⬜ Wizard hardening (edge-cases, retry logic, better error messages)
⬜ Silent dependency bootstrap based on chosen provider
⬜ Tray icon + native desktop notifications
⬜ Full code signing (macOS + Windows)
⬜ Auto-update via electron-updater
```

---

### ☁️ Phase 3 — Multi-Provider Cloud Provisioning

> _"Click a button, the team runs on a cloud server."_

```
⚪ Status: ROADMAP
░░░░░░░░░░░░░░░░░░░░ 0%

⬜ Abstraction layer shared/cloud/ (CloudProvider interface)
⬜ AWS EC2 adapter (provisioning, security group, lifecycle)
⬜ Google Cloud GCE adapter (firewall, startup script)
⬜ Hetzner Cloud adapter (EU-only, low cost)
⬜ Cloud UI inside the desktop wizard (provider choice, cost estimate)
⬜ One-click deploy + monitoring + teardown
⬜ Secure tunnel app ↔ cloud (WireGuard / SSH tunnel)
⬜ Billing alerts (cost threshold notifications)
```

---

### 🌍 Phase 4 — Full Internationalization

> _"The platform speaks the user's language."_

```
⚪ Status: ROADMAP (it/en base already in shared/i18n/)
━━━░░░░░░░░░░░░░░░░░ ~15%

✅ i18n module with it/en support and fallback
✅ Translation keys for nav, common, status, time, notifications
⬜ English as primary language (default) for UI and docs
⬜ Refactor translations into per-language files (locales/*.json)
⬜ Language switcher in desktop app and web dashboard
⬜ i18n coverage for all new pages (wizard, cloud, etc.)
⬜ Expansion: Spanish, German, French, Portuguese
⬜ Guide for community translators
```

---

### 🌐 Phase 5 — Public Website and Distribution

> _"Landing page, download, onboarding for non-technical users."_

```
🟡 Status: IN PROGRESS
━━━━━━━━━━━━░░░░░░░░ ~55%

✅ Domain purchased: **jobhunterteam.ai** (Cloudflare)
✅ DNS configured: A record → Vercel (216.198.79.1), DNS only
✅ Domain connected to Vercel, SSL auto-generated
✅ Supabase Auth: Site URL and redirects updated to jobhunterteam.ai
✅ Public landing page
✅ Download page with OS auto-detection
⬜ Subdomain setup (app, docs, api)
⬜ Visual user documentation (guides, screenshots, FAQ)
⬜ Video tutorials (optional)
```

---

## 🔄 Local ↔ Cloud migration

```
 💻 Local                           🌐 Cloud
┌─────────────┐    ──export──►   ┌───────────┐
│   SQLite    │                  │ Supabase  │
│   + PDFs    │    ◄──import──   │ PostgreSQL│
└─────────────┘                  └───────────┘
```

| Direction | What migrates |
|-----------|---------------|
| 💻 → 🌐 | Profile, positions, scores, applications, PDFs |
| 🌐 → 💻 | Same data, pulled into SQLite + local folders |

> Cross-cutting feature, rolled out progressively across Phase 1 → Phase 3.

---

## 📡 Communication channels

Today the user reaches the team through two channels, with different coverage:

| Channel | Today | Recommended default |
|---------|-------|---------------------|
| **Web dashboard / TUI** | Can address **any agent** directly | Talk to the Captain; it coordinates the pipeline |
| **Telegram** | Wired to the **Captain only** | — |

### 🛣️ Planned evolution — Telegram group chat with directed messages

> _"A single Telegram group where the user can DM a specific agent without spamming the others."_

```
⚪ Status: ROADMAP
░░░░░░░░░░░░░░░░░░░░ 0%

⬜ Telegram group with all agents as members
⬜ Directed messages: `@scout find python jobs in EU` delivered only to Scout
⬜ Broadcast mode for Captain announcements
⬜ Per-agent mute / subscription preferences on the user side
⬜ Audit log of who received what (for debugging)
⬜ Backwards compatibility: plain messages still route to the Captain
```

Rationale: today Telegram is the "on the go" channel but limited to the Captain. Extending it to the full team — with directed messages to avoid noise — gives the user the same reach they already have on the web dashboard, without forcing them to be at their PC.

> Cross-cutting feature, not tied to a specific phase. Can ship independently once the Captain → per-agent routing layer is in place.

---

## 📦 Usage modes (detail)

### 🖥️ 1. Desktop App — For everyone

| | |
|---|---|
| 🎯 **Target** | Anyone — non-technical users included |
| 📥 **Install** | Download the launcher (.dmg/.exe/.AppImage/.deb), install, run |
| ⚙️ **Setup** | Graphical wizard: language → profile → AI provider → credentials |
| 🤖 **Runtime** | JHT runs in the background; the launcher handles start/stop/status |
| 💾 **Storage** | Local SQLite + optional sync with Supabase |
| 🌐 **GUI** | Browser at `http://localhost:3000`, opened automatically |
| 📡 **Monitoring** | Web dashboard from any browser (including mobile) |

### ☁️ 2. Cloud Remote — For zero-hardware users

| | |
|---|---|
| 🎯 **Target** | Power users, people who don't want to keep a PC running |
| ☁️ **Provider** | AWS, GCP, Hetzner (user's choice) |
| 💰 **Cost** | Pay-per-use: start → work → stop |
| 🤖 **Agents** | Run on the cloud VM |
| 📡 **Monitoring** | Web dashboard + desktop launcher |

---

## 🐳 Docker — Default everywhere

> _Isolates agents from the host filesystem. **Default in both the CLI and the DMG paths**. Users who know what they're doing can opt out with `--no-docker` (CLI) or `JHT_NO_DOCKER=1` (desktop)._

### Rationale

Today agents run natively on the user's OS with `--dangerously-skip-permissions`. That works for Leone and for anyone who trusts the tool, but it isn't an acceptable default for a public distribution where the user can't (and doesn't want to) verify what agents are doing on their filesystem.

Docker solves this by isolating agent processes in a container that sees **only** two bind-mounted folders: `~/.jht` (hidden — DB/config/agents) and `~/Documents/Job Hunter Team` (visible — CVs and output). The rest of the host filesystem is invisible.

### 📐 Install policy

Docker is the **default on both install paths**. The opt-out policy depends on the target user:

```
┌─ CLI one-liner (tech users) ─────────────────────────────┐
│                                                          │
│  Default:    Docker ON (Colima on Mac, docker.io on      │
│              Linux/WSL2)                                 │
│  Opt-out:    --no-docker → native install (expert)       │
│  Message:    "Native mode: agents have full filesystem   │
│               access. Use only on a PC/VM dedicated to   │
│               the team."                                 │
│                                                          │
└──────────────────────────────────────────────────────────┘

┌─ DMG installer (non-tech users) ─────────────────────────┐
│                                                          │
│  Default:    Docker ON — always installed and used       │
│  Flag:       (none — not exposed to the user)            │
│  Rationale:  a user who downloads a .dmg and installs    │
│              "everything" cannot evaluate the risks of   │
│              AI agents with root-like privileges. The    │
│              container is the only guarantee that any    │
│              damage stays contained.                     │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### 🎯 Usage profiles

| Profile | Environment | Docker default |
|---------|-------------|----------------|
| **Daily personal PC** | The Mac/Linux you use for everything | ⭐ **ON (recommended)** |
| **Dedicated workstation** | PC/VM used ONLY for the JHT team | ON (opt-out with `--no-docker`) |
| **Cloud server (AWS/Hetzner)** | Remote VM | ON (opt-out with `--no-docker`) |
| **Non-tech user (DMG)** | Home Mac/Windows, first experience | 🔒 **ON, not toggleable** |

### 🧰 Container runtime per platform

We don't use **Docker Desktop** because it requires EULA/GUI/manual interaction. We use scriptable alternatives:

| OS | Runtime | Why |
|----|---------|-----|
| 🍎 macOS | **Colima** (`brew install colima docker`) | FOSS Apache 2.0, no GUI, no EULA, 100% scriptable, same `docker` CLI |
| 🐧 Linux | **docker.io native** (`apt/dnf/pacman`) | Standard, zero friction |
| 🪟 Windows | **docker.io inside WSL2** (not Docker Desktop) | JHT already runs in WSL2, we skip the commercial Docker Desktop layer |

Colima on Mac is critical: Docker Desktop requires the user to open the app, accept EULA, and give admin password. Colima runs as a background daemon, exposes the same `docker` CLI, and **can be installed entirely via script**.

### 📋 Prerequisites already met

The `dev-4` path centralization refactor + the Docker rollout have already closed the groundwork:

```
✅ Persistent state in two folders only (JHT_HOME + JHT_USER_DIR)
✅ Paths configurable via env vars (override for bind-mounts)
✅ No side-effects on the host system (no writes to ~/.bashrc etc.)
✅ TUI / CLI auth / desktop launcher gated behind isContainer()
   (IS_CONTAINER=1 or /.dockerenv) — print paths/URLs instead of
   invoking open/xdg-open/explorer
```

### 🗺️ Docker implementation phases

```
Step 1: Minimal Dockerfile
━━━━━━━━━━━━━━━━━━━━━━━━━━
FROM node:20-alpine
RUN apk add tmux git bash
RUN npm install -g @anthropic-ai/claude-cli
COPY . /app
WORKDIR /app
ENV JHT_HOME=/jht_home
ENV JHT_USER_DIR=/jht_user
ENTRYPOINT ["node", "cli/bin/jht.js"]

Step 2: docker-compose.yml
━━━━━━━━━━━━━━━━━━━━━━━━━━
services:
  jht:
    build: .
    volumes:
      - ~/.jht:/jht_home
      - ~/Documents/Job Hunter Team:/jht_user
    environment:
      - ANTHROPIC_API_KEY
    ports:
      - "3000:3000"  # web dashboard
    stdin_open: true
    tty: true        # for the TUI

Step 3: `jht-docker` wrapper
━━━━━━━━━━━━━━━━━━━━━━━━━━━
bash script that runs:
  docker run --rm -it \
    -v ~/.jht:/jht_home \
    -v "$HOME/Documents/Job Hunter Team:/jht_user" \
    -e ANTHROPIC_API_KEY \
    ghcr.io/leopu00/jht:latest

Step 4: Pre-built image on GitHub Container Registry
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CI that on git tag:
  - docker build
  - docker push ghcr.io/leopu00/jht:v0.x.y
User: `docker pull ghcr.io/leopu00/jht:latest`

Step 5: scripts/install.sh — Docker default + --no-docker flag
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
scripts/install.sh installs Docker by default:

  curl -fsSL .../install.sh | bash                     # Docker (default)
  curl -fsSL .../install.sh | bash -s -- --no-docker   # native (expert)

Docker path:
  - macOS: brew install colima docker + colima start
  - Linux: apt/dnf/pacman install docker.io + systemctl enable
  - WSL:   apt install docker.io inside WSL2
  - docker pull ghcr.io/leopu00/jht:latest
  - generates ~/.local/bin/jht as a docker run wrapper with the
    shared MOUNTS/ENV/PORT contract

--no-docker path:
  - clone repo, build TUI/CLI, symlink jht as before
  - final message prints an explicit warning that agents have
    full filesystem access on the host

Step 6: DMG installer (Docker ON by default)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
The DMG (non-tech path) ALWAYS installs Colima+docker as part
of the process, without asking the user, without exposing the option.
When the .dmg opens:
  1. Extracts JHT.app into /Applications
  2. Runs a post-install script that installs Colima via brew
     (or a bundled pkg if brew is missing) and runs colima start
  3. First launch of JHT.app uses the container from the start

The non-tech user doesn't know Docker exists: they just see JHT
working. The container is the invisible safety net.
```

### 🎯 Status

```
✅ scripts/install.sh — Docker default + --no-docker opt-out
✅ Gating isContainer() in TUI / CLI auth / desktop runtime
✅ desktop/runtime.js — spawn ghcr.io/leopu00/jht:latest via docker run
✅ desktop/container.js — Colima bootstrap on Mac
⬜ Dockerfile + root docker-compose (handled by CORE container track)
⬜ CI workflow to publish the image to GHCR (CORE container track)
⬜ DMG installer that pre-installs Colima without asking the user
```

### ⚠️ Things NOT to do until Docker is in place

To keep the project "Docker-ready" without blocking development:

1. **No side-effects on the host** (global tool installs, writes to `~/.bashrc`, mods to `~/Library`, etc.)
2. **No hardcoded OS-specific commands without fallback** (e.g. `open ...` on macOS → gated behind platform check)
3. **No absolute paths outside `JHT_HOME`/`JHT_USER_DIR`** (e.g. `/usr/local/...`, `/etc/...`)
4. **No network ports other than 3000** (web dashboard), otherwise Docker port-forwarding gets complicated
5. **No writes inside `node_modules` at runtime** (read-only in the container)
