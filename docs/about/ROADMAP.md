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
✅ Fix DEFAULT_LOCALE mismatch — shared/i18n + web fallbacks allineati a 'en' (2026-05-06)
⬜ Spanish, German, French, Portuguese translations
⬜ Translator-facing documentation
⬜ **Localize agent prompts & runtime docs**: all files agents read at
   runtime — agent identity prompts (`agents/<role>/<role>.md`), the
   operational manual (`agents/_manual/`), the team architecture
   (`agents/_team/architettura.md`), and the skill markdown bodies
   (`agents/_skills/<name>/SKILL.md` + `agents/<role>/_skills/`) —
   must exist in every supported language. When the user picks a
   language at onboarding, the launcher should pin the team to the
   matching prompt set so the Captain, Sentinel, Writer, etc. all
   speak that language end-to-end (orders, feedback, chat replies).
   Implies: per-language directory layout (e.g. `<role>.it.md` /
   `<role>.en.md` or a `prompts/<lang>/` overlay), a startup hook
   in `start-agent.sh` that picks the right file, language tag in
   `jht.config.json`, and translator workflow for the prompt corpus.
   Today everything is Italian — keep that as the baseline, plan the
   English/Hungarian/Spanish/etc. corpus as a follow-up sprint.
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

### 🛠️ Skill discovery — launcher-distributed isolation (priority)

#### Empirical findings (2026-04-28)

Tested per-agent skill isolation across the 3 supported providers using a 3-cwd scaffold (`aldo` · `giovanni` · `giacomo`) on `~/Desktop/skill-isolation-test/`. Each subdir held one private skill (`china-time` · `translate-chinese` · `text-to-emoji`); the parent held one supposedly-shared skill (`shared-greeting`).

| Provider | Version | Per-cwd isolation | Walk-up to parent | Stop condition |
|---|---|---|---|---|
| **Claude Code** | 2.1.112 | ✅ confirmed | ✅ unconditional | filesystem root |
| **Codex** | 0.125.0 | ✅ confirmed | ⚠️ only if `.git/` exists in an ancestor | git repo root |
| **Kimi** | k2.5 | ✅ confirmed | ⚠️ same pattern as Codex (without `.git/` in test, parent skill not loaded) | git repo root (assumed) |

Codex's behaviour matches its [official documentation](https://developers.openai.com/codex/skills): *"Codex walks up the directory tree from your current working directory to the repo root"* — repo root defined as a `.git/` ancestor; without it, "Codex only checks the current directory".

#### The blocker for naive walk-up: container has no `.git/`

The repo's `.dockerignore` excludes `**/.git`, so `COPY . .` in the Dockerfile produces an `/app/` without a `.git/` directory. Inside the runtime container:

- ✅ Claude Code would walk up freely and see `/app/.claude/skills/` from any agent's cwd
- ❌ **Codex and Kimi would NOT walk up** (no `.git/` to anchor "repo root") → they'd see only the agent's own `<role>/.agents/skills/` and never the shared pool

Re-introducing `.git/` into the container just to enable walk-up would inflate the image, leak history, and add provider-specific magic.

#### Decision: launcher-distributed symlinks, provider-agnostic

The launcher (`.launcher/start-agent.sh` or a bootstrap step) populates each agent's `.claude/skills/` *and* `.agents/skills/` with symlinks to the right subset of skills, drawn from a single canonical pool.

**Target layout (current):**

```
/app/agents/_skills/                                  ← global pool (linked to every agent)
   _lib/                                                 ← shared Python deps (used by multiple skills)
   db-query/SKILL.md     + db_query.py                   (script colocation: future commit)
   db-update/SKILL.md
   db-insert/SKILL.md
   rate-budget/SKILL.md
   tmux-send/SKILL.md

/app/agents/sentinella/_skills/                       ← Sentinel-private pool
   decision-throttle/SKILL.md
   emergency-handling/SKILL.md
   check-usage-http/SKILL.md
   check-usage-tui/SKILL.md
   memory-state/SKILL.md
   order-formats/SKILL.md

/app/agents/<role>/_skills/                           ← future per-role privates

/app/agents/<role>/.claude/skills/                    ← populated at boot via symlink
/app/agents/<role>/.agents/skills/                       (Codex + Kimi mirror)
```

At team setup, for each role the launcher creates symlinks under `agents/<role>/.claude/skills/` and `agents/<role>/.agents/skills/` pointing to:

1. Every entry under `agents/_skills/` (excluding `_lib/`)
2. Every entry under `agents/<role>/_skills/` (if the dir exists)

Each Claude / Codex / Kimi instance launched from `cwd = /app/agents/<role>/` then sees exactly its allowed set in its **immediate** `.claude/skills/` (or `.agents/skills/`) — no parent walk-up needed, identical behaviour across all 3 providers.

#### Why this is better than walk-up

- ✅ **Provider-uniform** — works the same on Claude / Codex / Kimi regardless of `.git/`
- ✅ **Container-light** — no need to ship `.git/` in the image
- ✅ **Explicit** — what each agent sees is determined by the symlink set, not by filesystem-search heuristics
- ✅ **Extensible** — adding a `scout-only` skill is a one-line entry under `agents/scout/_skills/`; per-role and shared pools coexist cleanly
- ✅ **Multi-role groups** — future need for "shared between Captain and Assistant only"? Add `agents/_skills-cap-asst/` (or similar manifest) and update the distributor's role→pool mapping

#### Implementation punch list

```
✅ Move .skills-source/* -> agents/_skills/* (global skills relocated)
✅ Convert agents/sentinella/skills/*.md (plain markdown) into
   agents/sentinella/_skills/<name>/SKILL.md (folder + frontmatter:
   name, description, allowed-tools) — Agent Skills format
✅ Promote db-insert to a SKILL.md wrapper under agents/_skills/db-insert/
✅ Update Dockerfile symlink loop to source from agents/_skills/ instead
   of .skills-source/ (kept global flat for now)
⬜ Move agents/_tools/jht-tmux-send into agents/_skills/tmux-send/ as a
   colocated artifact (and drop _tools/ if jht-send is not used)
⬜ Move 1:1 Python scripts into their skill folders + create
   agents/_skills/_lib/ for shared deps (_db.py, compute_metrics.py,
   usage_record.py); update sys.path imports + the ~10 prompt files
   that reference /app/shared/skills/<x>.py absolute paths
⬜ Add the symlink-distribution step to .launcher/start-agent.sh:
   for each role, populate <agent_cwd>/.claude/skills/ and
   <agent_cwd>/.agents/skills/ with links to global + role-private
⬜ Drop the global Dockerfile symlink loop once start-agent.sh handles
   per-agent distribution at boot (provider-uniform: no .git/ needed)
⬜ Update CONTRIBUTING + agents/_team/architettura.md (Skills section)
   to describe the new layout and how to add a skill (drop into
   agents/_skills/ for shared, into agents/<role>/_skills/ for private)
⬜ Add a smoke test: launch each role's tmux session, capture-pane,
   verify the agent reports exactly its expected skill set
⬜ Full-team integration test inside the container: spin up the actual
   JHT team (Captain + Scout + Analyst + Scorer + Writer + Critic +
   Sentinel + Assistant), drive a real run end-to-end, and verify each
   agent INVOKES the right skills (not just sees them) — i.e. that
   db-query / db-update / db-insert / rate-budget / tmux-send actually
   get called from the agent prompts as expected, and that Sentinella's
   private skills (decision-throttle, emergency-handling, etc.) are
   loaded only by Sentinella. Capture pane logs + DB diffs for evidence.
```

#### Reproducible test scaffold

The 3-cwd test on `~/Desktop/skill-isolation-test/` (with `CLAUDE.md` + `AGENTS.md` per agent and one private skill each) is preserved for future regression checks against new provider versions or new providers (e.g. OpenCode when added — see ADR-0002). To re-run for any provider, swap the launch command in the tmux step:

- Claude Code: `claude.exe --dangerously-skip-permissions`
- Codex: `cmd.exe /c codex --yolo` (Windows-host; in WSL needs Windows interop)
- Kimi: `kimi.exe --yolo`

Each session is sent the same prompt (*"list all skills you currently have available"*), and panes are captured with `tmux capture-pane -t <session> -p`. The expected outcome with the launcher-distribution model: every agent reports `_global/* + <its role>/*` and nothing else.

### 🧙‍♂️ Maestro — career-coach agent (planned)

The most important agent we haven't built yet. Stands outside the operational pipeline, looks at career trajectory + market signals + user goals, gives strategic advice.

→ Spec in [`agents/maestro/maestro.md`](../../agents/maestro/maestro.md). See [`docs/VISION.md`](VISION.md) for the rationale.

### 🗄️ Database schema optimization (priority)

The current `jobs.db` schema is functional but **lossy**: state transitions, Critic rounds, and inter-agent feedback all evaporate after the fact, and `positions.notes` hides 5 structured analysis fields as plain text. Plan to address before the public-launch dashboard work:

```
⬜ positions.claimed_by + claimed_at — explicit per-record lock so agents can
   batch-claim atomically (UPDATE … LIMIT 5) instead of running CHECK/CLAIM/
   NOTIFY × N rounds via tmux. Stale-claim handling left to the agent's
   judgement (no hardcoded TTL — production agents run for months without
   dying; the rare orphan reclaim must verify peer is actually dead first).
⬜ Real-time agent activity for the UI dashboard — first pass via VIEW/JOIN on
   existing tables (positions.claimed_by, applications.written_by, scores.scored_by);
   dedicated agent_activity table only if the view proves insufficient.
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

**Anti-collision mechanism — descriptive, not unified.** The 5 agent roles do genuinely different work and use different lock strategies (Scout pre-INSERT URL dedup · Analyst/Scorer `last_checked` watermark · Writer `status = writing` flip). Forcing one common pattern adds friction for marginal gain. The new `claimed_by/at` columns sit alongside the existing role-specific mechanisms, primarily to enable the batch-claim shortcut and the UI activity view.

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
