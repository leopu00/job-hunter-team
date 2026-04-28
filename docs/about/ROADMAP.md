# 🗺️ ROADMAP — Job Hunter Team

> Last updated: 2026-04-27
>
> 📋 **For tactical, task-by-task detail → see [`BACKLOG.md`](../BACKLOG.md)**.
> This file is the strategic, visual summary — where we're going, not the day-to-day.

---

## 🎯 Vision

Job Hunter Team is an open-source application that runs **locally** in a Docker container, with multiple interfaces (web/desktop/CLI/TUI/Telegram). Non-technical users download the Electron launcher; technical users clone the repo and use the CLI. In both cases, the AI agent team works on the user's own machine, on their own data, with their own LLM subscription — not a managed cloud service.

**AI on the side of workers, not against them.**

```
                              👤 User
                                 │
                                 ▼
                       ┌──────────────────┐
                       │ 🐳 JHT Container │
                       │  (8 agents +     │
                       │   📡 Bridge)     │
                       └──────────────────┘
                                 │
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
         🖥️ Local PC     🏠 Dedicated PC    ☁️ Self-hosted VPS
         (today)          (Phase 2)          (Phase 3, ⭐ target)
```

> See [`docs/internal/INFRA.md`](../internal/INFRA.md) for the deployment diagram and [`docs/VISION.md`](VISION.md) for the design philosophy.

**Stack decisions:**

| Component | Technology | Rationale |
|---|---|---|
| Desktop app | **Electron launcher** | Installer + lifecycle manager only; operational GUI stays in the browser |
| Web dashboard | **Next.js 16 on Vercel** | CI/CD pipeline live |
| Container runtime | **Docker + Docker Compose** | Isolation, reproducibility |
| Structured data (cloud, opt-in) | **Supabase** | PostgreSQL + Google/GitHub auth |
| User files (cloud, opt-in) | **Google Drive** | CV, cover letters, generated PDFs |
| Cloud provisioning | **Multi-provider** | Hetzner first (cheapest, EU GDPR), then AWS + GCP |
| Primary language | **English** | Italian, Hungarian as additional |

---

## 📅 Development phases — at a glance

```
  Phase 1            Phase 2            Phase 3            Phase 4            Phase 5            Phase 6
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  🔨 ~85%             🔨 ~70%             ⏳ 0%             🔨 ~30%            🔨 ~70%            ⏳ 0%
  Web Platform       Desktop Launcher    Cloud Multi-      Full              Public            🚢 Pre-Launch
  consolidation      + first-run UX      Provider          i18n              Website            (NEW)
```

---

### 🔨 Phase 1 — Web Platform Consolidation (current sprint)

> _"The web app works end-to-end with real data."_

```
🟢 Status: IN PROGRESS — ~85%
━━━━━━━━━━━━━━━━━━━░░ 

✅ Next.js 16 app with 112 pages (App Router)
✅ Google + GitHub OAuth
✅ DB schema (migrations 001–007, 7 tables, RLS)
✅ Vercel CI/CD pipeline + jobhunterteam.ai live
✅ Dashboard wired to real Supabase data
✅ Positions, applications, settings pages live
✅ Cloud sync (tokens + ping + push endpoints, jht cloud CLI)
✅ Web E2E tests (75+ Playwright specs)
✅ Onboarding split-screen (profile mirror + assistant chat)
✅ CLI ↔ container coordination (jht team / container / sentinella)
⬜ db_supabase.py wrapper — push agent results to cloud
⬜ Weekly window monitoring calibration (today: 5h windows)
⬜ User-defined work hours ("team as employee" model)
⬜ Kimi €40 calibration (mass-market target)
⬜ Sentinel token consumption optimization
⬜ Documented test campaign matrix (provider × tier × persona)
```

For full task list → [BACKLOG · Phase 1](../BACKLOG.md#1️⃣-phase-1--web-platform-consolidation-current-sprint)

---

### 🖥️ Phase 2 — Desktop Launcher

> _"Download, install, everything starts in the background, then you work from the browser."_

```
🟡 Status: IN PROGRESS — ~70%
━━━━━━━━━━━━━━░░░░░░ 

✅ Electron scaffolding + electron-builder
✅ First-run setup wizard (i18n en/it/hu, language picker, step-based UI)
✅ macOS one-click install (Homebrew → Colima via osascript, Xcode CLT, QEMU fallback)
✅ Windows one-click install (WSL2 + Docker Desktop + Git in single UAC + reboot)
✅ Embedded terminal for login (real pty, clipboard bridge)
✅ Smart boot (skip wizard if already configured)
✅ Cross-platform installers: .dmg / .exe / .AppImage / .deb
✅ Lazy install of Docker container (handles Node/Python deps inside)
⬜ Tray icon + native desktop notifications
⬜ Auto-update via electron-updater
⏸️ Code signing (deferred post-beta — open source + community review = trust signal)
```

For full task list → [BACKLOG · Phase 2](../BACKLOG.md#2️⃣-phase-2--🖥️-desktop-launcher)

---

### ☁️ Phase 3 — Multi-Provider Cloud Provisioning

> _"Click a button, the team runs on a self-hosted VPS."_

```
⚪ Status: ROADMAP — 0%
░░░░░░░░░░░░░░░░░░░░ 

⬜ Abstraction layer shared/cloud/ (CloudProvider interface)
⬜ 🇪🇺 Hetzner Cloud adapter ⭐ first (cheapest ~€4.5/mo, EU GDPR)
⬜ Cloud UI inside the desktop wizard (provider choice, cost estimate)
⬜ Secure tunnel app ↔ cloud (Tailscale or WireGuard)
⬜ 🌩️ AWS EC2 adapter
⬜ ☁️ Google Cloud GCE adapter
⬜ Billing alerts (cost threshold notifications)
```

> 🌉 **Bridge to today**: until this phase ships, users can run JHT on a VPS via the manual path (see [`JHT-VPS-VALIDATE`](../BACKLOG.md) → `docs/VPS-SETUP.md` once published). PHASE 3 turns that manual SSH dance into a one-click experience.

For full task list → [BACKLOG · Phase 3](../BACKLOG.md#3️⃣-phase-3--☁️-multi-provider-cloud-provisioning-future-post-10)

---

### 🌍 Phase 4 — Full Internationalization

> _"The platform speaks the user's language."_

```
🟡 Status: IN PROGRESS — ~30%
━━━━━━░░░░░░░░░░░░░░ 

✅ i18n module with it/en/hu support and fallback
✅ English as primary language (default)
✅ Desktop wizard language picker (en/it/hu)
✅ Hungarian (`hu.json`) — partial, community contribution
⬜ Per-language JSON files refactor (today translations.ts inline)
⬜ Language switcher in web dashboard (desktop already has one)
⬜ Fix DEFAULT_LOCALE mismatch (shared/i18n='it' vs desktop wizard='en')
⬜ Spanish, German, French, Portuguese translations
⬜ Translator-facing documentation
```

For full task list → [BACKLOG · Phase 4](../BACKLOG.md#4️⃣-phase-4--🌍-internationalization)

---

### 🌐 Phase 5 — Public Website and Distribution

> _"Landing page, download, onboarding for non-technical users."_

```
🟡 Status: IN PROGRESS — ~70%
━━━━━━━━━━━━━━░░░░░░ 

✅ Domain purchased: jobhunterteam.ai (Cloudflare)
✅ DNS + SSL via Vercel
✅ Supabase Auth: Site URL + redirects on jobhunterteam.ai
✅ Public landing page
✅ Download page with OS auto-detection (.dmg/.exe/.AppImage/.deb)
✅ install.sh served via short URL
✅ 9 new pre-launch docs (STORY, PROVIDERS, AI-AGENT-INTEGRATION,
   VISION, MONITORING, RESULTS, BETA, MAINTAINERS,
   agents/maestro spec)
⬜ Subdomain setup (app, docs, api)
⬜ Launcher screenshots in docs (soft BLOCKER pre-launch)
⬜ Visual FAQ
⬜ Video tutorial series (multiple short walkthroughs, 2–5 min each)
⬜ SHA256 checksums on download page
```

For full task list → [BACKLOG · Phase 5](../BACKLOG.md#5️⃣-phase-5--🌐-public-website)

---

### 🚢 Phase 6 — Pre-Launch Public OSS (NEW)

> _"Get JHT ready for Show HN, Product Hunt, Reddit, awesome-lists."_

```
🟡 Status: IN PROGRESS — ~25%
█████░░░░░░░░░░░░░░░ 

⬜ 🔐 SECURITY.md (BLOCKER) — root file with responsible disclosure (audit in docs/security/)
⬜ 🤝 CODE_OF_CONDUCT.md (BLOCKER) — Contributor Covenant
⬜ 🎬 30s demo video (BLOCKER) — README above the fold
✅ 🛡️ Security review — 31/34 fix, score 30→74%, see docs/security/ (3 gap residui: SSRF, resolve-system-bin, CSP prod)
⬜ 🧊 Stabilize monitoring architecture (1-2 weeks freeze pre-launch)
✅ 🧪 docs/BETA.md created
⬜ 🧪 Beta tester recruitment (publish on r/cscareerquestions, friends list)
⬜ ⭐ Awesome lists submissions (awesome-ai-agents, awesome-claude, awesome-selfhosted)
⬜ 🐛 GitHub issue triage workflow
⬜ 📰 Show HN post draft
⬜ 🎙️ Press kit (logos, screenshots, descriptions)
```

For full task list → [BACKLOG · Phase 6](../BACKLOG.md#6️⃣-phase-6--🚢-pre-launch-public-oss-new)

---

## 🌐 Cross-cutting features

These don't belong to a single phase — they ship progressively across multiple phases.

### 💬 Telegram per-agent + team forum

> _"A Telegram group where the user can DM a specific agent or follow the whole team's conversation."_

Today Telegram is wired to the **Captain only**. Planned: per-agent chats + a "team forum" channel where the user joins the full conversation.

```
⬜ Telegram group with all agents as members
⬜ Directed messages: `@scout find python jobs in EU`
⬜ Broadcast mode for Captain announcements
⬜ Per-agent mute / subscription preferences
⬜ Backwards compatibility: plain messages still route to Captain
```

### 🔄 Cloud sync direction (open architectural question)

Today the sync flows **local → cloud only** (see `docs/internal/INFRA.md` § Optional managed storage). If the user changes machine (new PC, lost laptop, migration to VPS), they need to seed the new container from the cloud at least once. Possible approaches under evaluation:

- A) Manual `jht cloud bootstrap` for one-time reverse seed
- B) Bidirectional sync with conflict resolution
- C) Container "freeze + export" workflow (no Supabase for the seed)

→ Will be filed as `[JHT-CLOUD-SEED-DIRECTION]` once decided.

### 🧙‍♂️ Maestro — career-coach agent (planned)

The most important agent we haven't built yet. Stands outside the operational pipeline, looks at career trajectory + market signals + user goals, gives strategic advice.

→ Spec in [`agents/maestro/maestro.md`](../../agents/maestro/maestro.md). See [`docs/VISION.md`](VISION.md) for the rationale.

### 🗄️ Database schema optimization (priority)

The current `jobs.db` schema is functional but **lossy**: state transitions, Critic rounds, and inter-agent feedback all evaporate after the fact, and `positions.notes` hides 5 structured analysis fields as plain text. Plan to address before the public-launch dashboard work:

```
⬜ position_events  — audit trail of every status change (timeline + replay)
⬜ application_reviews — persist all 3 Critic rounds, not just the final score
⬜ agent_messages — log inter-agent [FEEDBACK]/[REQ]/[RES] for pattern analysis
⬜ position_analysis — promote ESCLUSA-tag + 5-field analyst notes to columns
⬜ application_artifacts — consolidate cv/cl × md/pdf paths (single artifacts table)
⬜ Drop redundancies: positions.applied (BOOL) duplicates applications.applied_at;
                     applications.status overlaps positions.status
⬜ interview_log — replace single interview_round INT with full interview history
⬜ user_feedback — capture user reactions in Phase 5 ("tone off" / "good — applying")
⬜ captain_decisions — orchestration log (spawn +1 analyst, freeze, throttle, etc.)
```

→ Detailed analysis: [`agents/_manual/db-schema.md`](../../agents/_manual/db-schema.md). Highest-ROI single change is `position_events` — unlocks dashboard timeline + debug + analytics with one new table and zero changes to the existing flow.

---

## 🐳 Docker — what we built (compressed)

Docker is the **default** in both the CLI installer and the desktop launcher (since v0.1.9). The container isolates agent processes, exposing only two bind-mounted folders: `~/.jht` (config/DB) and `~/Documents/Job Hunter Team` (CVs/output).

| What | Status | Reference |
|---|---|---|
| `Dockerfile` + root `docker-compose.yml` | ✅ Shipped | v0.1.9 |
| GHCR image: `ghcr.io/leopu00/jht:latest` | ✅ Shipped | v0.1.9 |
| `install.sh` Docker-by-default + `--no-docker` opt-out | ✅ Shipped | v0.1.9 |
| Desktop launcher: lazy install of Colima/Docker | ✅ Shipped | v0.1.10–0.1.12 |
| Container runtime per OS | ✅ Shipped | Colima (macOS), docker.io (Linux/WSL2), Docker Desktop (Windows — installed via WSL2 wizard) |
| `isContainer()` gating in TUI/CLI/desktop | ✅ Shipped | v0.1.9 |

> Full implementation history → [`CHANGELOG.md`](../CHANGELOG.md). Architectural rationale (why container, why no host-side `--dangerously-skip-permissions`) → [`docs/adr/0001-colima-not-docker-desktop.md`](./adr/0001-colima-not-docker-desktop.md).

---

## 📦 Usage modes (compressed)

For deployment modes (🖥️ Local PC / 🏠 Dedicated computer / ☁️ Self-hosted VPS) and the trade-offs of each → see [`docs/internal/INFRA.md`](../internal/INFRA.md) § "Where the team runs".

For the supported LLM subscription tiers (🟠 Claude Max / 🔵 Codex / 🌙 Kimi) → see [`docs/PROVIDERS.md`](PROVIDERS.md).

---

## 📚 Related

- 📋 [`BACKLOG.md`](../BACKLOG.md) — tactical, task-by-task work plan
- 📝 [`CHANGELOG.md`](../CHANGELOG.md) — what's been shipped per release
- 🎯 [`docs/VISION.md`](VISION.md) — design philosophy
- 📐 [`docs/internal/INFRA.md`](../internal/INFRA.md) — deployment diagram
- 💳 [`docs/PROVIDERS.md`](PROVIDERS.md) — supported subscriptions
- 🧪 [`docs/guides/BETA.md`](../guides/BETA.md) — beta program + pre-launch coverage matrix
- 🦞 [`docs/AI-AGENT-INTEGRATION.md`](../guides/AI-AGENT-INTEGRATION.md) — let your AI assistant drive `jht`
- 🔒 [`docs/MAINTAINERS.md`](../internal/MAINTAINERS.md) — internal operations reference
- 📐 [`docs/adr/`](./adr/) — architectural decision records
