# Changelog

All notable changes to this project are documented in this file.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

> 289 commits and 10 days of intensive work since v0.1.12 — desktop launcher rewritten with one-click install on macOS (Colima via Homebrew/osascript) and Windows (WSL2 + Docker Desktop + Git in a single UAC flow), monitoring stack pivoted multiple times (Sentinel eliminated then reintroduced as event-driven watchdog, Bridge promoted to separate clock-only daemon), web team page redesigned with live inter-agent message animations and embedded terminal per agent, web platform restructured around the subscription model, complete pre-launch documentation suite (10 new docs), Kimi (Moonshot) provider support added, **pre-launch security hardening sprint** (31/34 fix, score 30% → 74%, audit suite in `docs/security/`).

### 🖥️ Desktop launcher

- **Setup wizard rewrite** — i18n (en/it/hu), language picker, new step flow, progress UI; "Install everything" button orchestrates the full one-click setup
- **🍎 macOS one-click install** — Homebrew auto-installed via official `.pkg` (no Terminal needed for the user), Xcode Command Line Tools installed first, Colima detected and installed via `brew install colima docker`, fall back to QEMU backend (with auto-installed `qemu`) when Colima can't start on Apple VZ
- **🪟 Windows one-click install** — WSL2 + Docker Desktop installed via single UAC prompt + reboot flow; Git installed via `winget`; checklist unifies all required deps; "Install everything" button moved out of the Docker card to an OS-level action
- **🔌 Embedded terminal for login** — backed by `@lydell/node-pty` (real Windows prebuilts), xterm + addons, clipboard bridge for right-click copy/paste, ephemeral container spawned via `compose run`, modal stays open on non-zero exit, per-session container cleanup
- **🚀 Smart boot** — home opens directly if setup is already done (no wizard re-run), runtime button reflects current OS, post-setup home with sidebar + dev-mode card
- **🔧 Provider modules** — new backend modules: `provider-install`, `provider-store`, `provider-auth`, `container-prep`, `deps`, `disk-space`
- **🐳 Docker installer module** — refined three-state status (`ok` / `needs-reboot` / `missing`), desktop path, bundled Docker logo, macOS download URL points to Colima guide; status check uses `colima status` on macOS
- **🍎 macOS code signing** — re-sign ad-hoc bundle with `--deep` to prevent Team ID mismatch at launch; re-sign moved from `afterPack` to `afterSign` so it survives notarization
- **🛠️ Setup IPC + dev mode** — new `dev:probe` / `dev:stop` IPC handlers to manage dev-mode from UI, "open terminal" buttons for Captain/Sentinel/agent sessions trigger native Terminal with `tmux attach`
- **🐳 Container hygiene** — runtime container always named `jht`, stale containers cleaned on start; auto-launch Docker Desktop on Windows if daemon is off; drop unused `GEMINI`/`GOOGLE` env vars
- **🐛 Fixes** — wrong-platform flash on darwin checklist (belt-and-suspenders hide), provider switch from home returns home (not wizard), `@lydell/node-pty-win32-arm64` declared as dependency, `dev-up.sh` stdout/stderr redirected to `.dev-logs/dev-up.log`, don't auto-open browser on `dev:launch`

### 📊 Monitoring & Bridge — non-linear architectural iteration

The 10-day arc was not a clean V1→V5 progression — it was a real-world exploration:

1. **Bridge V1 (clock-only)** — `sentinel-bridge.py` daemon, no LLM, just polls usage on a fixed clock and computes projections
2. **Sentinel temporarily eliminated** — Bridge talks to Captain directly; Sentinel LLM removed because it was burning too many tokens
3. **Sentinel reintroduced as LLM watchdog** — turns out a thin LLM layer is needed for nuanced decisions Bridge can't make deterministically
4. **Bridge V3** — active fetcher, Sentinel as fallback only
5. **Bridge V4** — Sentinel repositioned as filter between Bridge and Captain
6. **Bridge V5 (current)** — "Pasqua-style" activates above V4 stack
- **🚦 Bridge rule-set** — single rule 85–95% with L1/L2/L3 escalation, lazy WORKER fallback, throttle on absolute usage with target 95% and EMA reset on gap, singleton lock + kill-before-spawn in `start-agent.sh`, EMA 10-tick + burst filter on cumulative delta of last hour, invalidate last sample on provider change, notify only on throttle/host change (not on every status), tau-aware projection, watchdog degraded mode, default poll 5min
- **🌉 Bridge as separate role in launcher** — ordered startup (Captain → Sentinel → Bridge), first usage sample now comes from Bridge (removed pre-Bridge `sleep 20`)
- **🌉 Bridge API + UI** — `/api/bridge/{start,stop,status}` endpoints, popover in web team page with interval slider, live LED tied to real bridge state, start/stop from UI, countdown + animation synced with the real bridge clock
- **💂 Sentinel prompt refactor** — from 491 lines (inline) to 130 lines (orchestrator) + 6 on-demand skills:
  - `check_usage_http` / `check_usage_tui` (multi-source usage checks)
  - `decision_throttle` (rate-limit decision logic)
  - `emergency_handling` (rate-limit recovery)
  - `memory_state` (Sentinel state across ticks)
  - `order_formats` (orders to Captain)
  - `bridge_health` (Bridge maintenance from Sentinel)
- **🛡️ Other Sentinel skills** — `freeze_team`, `soft_pause_team` (graceful team pause), TUI worker fallback
- **⏰ Captain** — 1-spawn/tick mode, kick-off at boot, tick interval as float with 0.25 step, autonomous mode (no escalation needed for normal operation), new `rate-budget` skill for proactive budget checks, live `rate_budget` command for on-demand API fetch
- **📊 Monitoring G-spot** — target window raised from 85–95% to 90–95% (more aggressive utilization)
- **🐛 Fixes** — TUI parser was reading wrong modal (now reads the latest), handles `RATE_LIMIT` as a string; 3 concomitant bugs that caused rate-limit overshoot; `check_usage` dispatcher now multi-provider (no more hardcoded `claude`)

### 🌐 Web platform

- **💬 Live team page** — org-chart with multiple iterations: Sentinel removed then re-added with green LED on active agents, Bridge node added with inter-agent message animations, sender color dot, popover on click, stable LED, more breathing room (width 620 → 820 → 1080, larger gap), smaller LED dots (9px → 5px)
- **📊 UsageChart** — interactive (hover tooltip + range selector), time-based x-axis with 85–95% target band + 10/30min zoom, multi-source coloring with legend showing which agent did each check, `GAP_MS` 3min → 12min (no more visible line breaks), pan via drag, taller (220 → 360px), section margins + centered charts, mini-chart variant under org-chart
- **💬 Live event channel** — team message stream for inter-agent communication visible in UI
- **🖥️ Embedded terminal access** — "open terminal" buttons in Captain/Sentinella/AgentInteraction panels open native Terminal with `tmux attach`; `JHT_SHELL_VIA=docker:<container>` mode for `docker exec` from web; gate behind dev-mode toggle; SettingsMenu with dev-mode toggle + direct Team link (no dropdown)
- **👤 Profile UI** — `ProfilePageClient` removed (folded into the page), FAB redesigned as flex sibling, deep-links from missing-fields to edit sections, completion-only stats; Floating Assistant Button with chat panel wired to `/api/assistente/*`
- **🧭 Navbar** — nav links flow-centered with `mx-auto` (no more overlap), workspace-folder widget removed from header
- **🔌 Provider management** — `/providers` page can check CLI versions and trigger updates from the UI
- **🌍 Public site restructured for subscription model** — `LandingFooter` added to home, `/download` polished (back link, minimal CLI box, footer), privacy/terms/project rewritten for subscription pricing, deprecated public pages deleted, footer cleaned, admin pages moved under `(protected)` route group
- **🌍 i18n** — defaults switched to English, Hungarian (`hu.json`) diacritics fixed, subscription copy translated en/it/hu
- **🚦 Web/team bulk** — bulk action buttons relabeled (shorter: Start / Active / Stop), Stop-all preserves the Assistant agent
- **🐛 Fixes** — `next.config.ts` `turbopack.root` always set to cwd (avoids postcss leak), `web/AgentInteraction` stick-to-bottom is conditional with 1.5s refresh, Sentinella reachable via `/api/agents` and `/api/health`, role-id → session map updated to include Sentinella

### 🔧 CLI

- **`jht team` / `jht container` / `jht sentinella`** — full container coordination (proxy via `docker exec`, `docker compose` wrapper, JSONL reader + ASCII sparkline)
- **`jht providers`** — `list/current/use/update/check` with version detection and CLI alias normalization
- **`jht positions`** — `list/show/dashboard` reading from container's `db_query.py`
- **`cli/container`** — auto-launch Docker Desktop on Windows when daemon is off

### 🤖 Agents & runtime

- **🌙 Kimi (Moonshot) provider support** — multi-provider start-agent reads `active_provider` from config, Kimi tmux requires Ctrl-S after Enter for immediate submit, TUI parser handles Kimi RATE_LIMIT strings, dismiss `codex` auto-update prompt before launch
- **🐚 jht-tmux-send** — `verify-then-Enter` pattern + retry to avoid lost characters
- **🚀 Launcher** — readiness check via idle-diff, verify-then-Enter for kick-off
- **📁 Skills runtime data** — moved out of repo into `$JHT_HOME/data` (no more polluting the working directory)
- **🐳 Container** — unbundled CLIs (lighter image), Google → Moonshot provider swap

### 📚 Documentation

- **📘 README rewritten** end-to-end for pre-launch — story, providers, vision, monitoring stack, AI-agent integration. Manifesto: *"AI on the side of workers, not against them."* Track record callout (~200 offers · ~20 applications · 5 interview invites in 2 weeks). Local-first positioning. Demo placeholder. AI-agent CLI USP section.
- **📋 BACKLOG rewritten** in English with status refresh — 12 tasks flipped ⬜→✅ (CLOUDSYNC ping/push, ONBOARDING split-screen, FRONTEND 1-5, multi-provider, CLI ↔ container 5/5, JHT-QA-01 with 75+ Playwright specs); 5 known bugs removed (all fixed); restructured by area; added PHASE 6 (Pre-Launch) with 4 BLOCKERs (SECURITY, COC, demo video, security review) + new tasks (test campaign, VPS validate, monitoring weekly window, user work hours, Kimi optimize, Sentinel optimize).
- **🆕 10 new documents:**
  - `docs/STORY.md` — origin story (legacy team results, why open source)
  - `docs/PROVIDERS.md` — supported subscriptions matrix (🟠 Claude / 🔵 Codex / 🌙 Kimi)
  - `docs/AI-AGENT-INTEGRATION.md` — how Claude Code / 🦞 OpenClaw / Codex / Cursor can drive JHT
  - `docs/VISION.md` — gamification philosophy, agents as characters, anti-goals
  - `docs/MONITORING.md` — Bridge/Sentinel monitoring stack (architecture + test data)
  - `docs/RESULTS.md` — case studies + community template
  - `docs/BETA.md` — beta tester program
  - `docs/TEST-CAMPAIGN.md` — coverage matrix (provider × tier × persona × job-category) + status board
  - `docs/MAINTAINERS.md` — internal operations reference (Supabase, Vercel, OAuth, security)
  - `agents/maestro/maestro.md` — planned career-coach agent spec
- **📐 ADR-0004** added — subscription-only, no API keys (decision rationale)
- **📚 ROADMAP, INFRA, BETA, MONITORING** updated for consistency (8-agent team, 112 web pages, 📡 Bridge in monitoring stack)
- **🦞 OpenClaw integration** — emoji standardized across README + AI-AGENT-INTEGRATION.md

### 🔒 Security

- **🛡️ Pre-launch hardening sprint** (sha `7a2cb6ae`) — 4 agenti Claude in parallelo (worktrees dev-1..dev-4), 31/34 fix in ~95min, security score **30% → 74%**, gap vs OpenClaw chiuso da -78 a -25 punti
- **Phase 1 (bloccanti pre-launch) 9/9 ✅** — C1-C5, H1, H2, H8, H9
- **Phase 2 (post-launch) 12/12 ✅** — H3-H6, M1-M8
- **Phase 3 (hardening) 10/13 🟡** — gap residui (blockers per public release): SSRF dispatcher generico, `resolve-system-bin` strict, CSP hash-based prod L1
- **🆕 Moduli nuovi:** `web/lib/{auth,csrf,error-response,fs-safety,local-token}.ts`, `shared/{credentials/passphrase,credentials/manager,logger/redact}.ts`, `cli/src/commands/keyring.js`
- **🔑 Innovazioni vs OpenClaw:** dual-channel auth (cookie HttpOnly + Bearer fallback), `jht keyring set/get/delete` CLI, PBKDF2 + salt random per file OAuth storage
- **🧹 Logger redaction** — pattern segreti (Bearer/PBKDF2/JWT/API key) hookato nel Logger
- **🐳 Docker base image** pinned a SHA256 + Dependabot Docker weekly
- **🪝 Pre-commit hooks** — gitleaks, detect-secrets (con baseline), actionlint, zizmor, npm-audit-prod
- **📚 7 nuovi documenti** in `docs/security/` (~2336 righe) — pre-launch review (27 finding), OpenClaw comparison file-per-file, implementation tradeoffs, threat model, checklist, post-fix snapshot

### 🧪 Testing

- E2E provider smoke test added
- 75+ Playwright specs already covered web platform end-to-end (auth, dashboard, profile, applications, security headers, accessibility, performance) — now formally tracked in BACKLOG

### 📦 Internal

- `0.1.13-dev` version bump
- `chore(container)`: unbundle CLIs, switch Google → Moonshot, add ADR-0004

---

## [0.1.12] — 2026-04-17

### 🐛 Fixed

- **Bundle**: the v0.1.11 DMG/EXE crashed on first launch with `Cannot find module './docker-installer'` because the `build.files` field in `desktop/package.json` is an explicit whitelist and the new modules (`disk-space.js`, `docker-installer/**`) were not included. Added them to the list; the new modules' `*.test.js` are explicitly excluded from the release bundle.

No other functional change vs v0.1.11: this is a pure install-time bugfix.

---

## [0.1.11] — 2026-04-17

Release focused on rewriting the desktop launcher experience based on the 2nd round of E2E tests on Windows ARM64 (see `e2e-runs/2026-04-17-windows-arm64-round2/`).

### 🖥️ Desktop launcher — wizard rewrite

- **Step-based UI** instead of a single scrollable page: four discrete steps — Welcome → Setup → Ready → Running — each with a single primary button. The technical log is no longer visible by default; it sits behind a "Technical details" disclosure in the Running step.
- **"Alpha · in testing" topbar** persistent across all steps, so the user always knows the product status.
- **Essential dependency checklist**: the Setup screen shows only Docker (the single mandatory dependency in container mode). Node/Git/Python are removed from the main surface.
- **Start blocked** until Docker is ready: the "Start Job Hunter Team" button only appears in the Ready step, and Ready is only reachable after the checklist is green.

### 🔧 Setup wizard — dependency management

- **Docker status with three values**: `ok` (ready), `needs-reboot` (binary present but `docker ps` doesn't respond — typically the user installed Docker Desktop without rebooting), `missing` (not installed).
- **Guided manual install flow**: when Docker is missing, a "Download installer" button opens the official `docker.com/products/docker-desktop/` page in the default browser. The user installs it, reboots if needed, returns to the launcher and clicks "I installed, recheck" / "I rebooted, recheck".
- **Pre-install preview**: before installing, the Docker card shows the estimated install size and free disk space (via `powershell Get-PSDrive` on Windows, `fs.statfs`/`df` on Unix — zero extra npm dependencies).
- New `desktop/docker-installer/` module with `manifest` (per-OS strategy), `check` (three-value status), `download-url` (official URL per OS). Policy respected: macOS strategy is Colima via Homebrew (NOT Docker Desktop); Linux is `get.docker.com`; only Windows uses Docker Desktop.

### 🔌 IPC

- New channel `setup:get-docker-status` → `{platform, arch, strategy, check, disk}`.
- New channel `setup:open-docker-download-page` → opens the official Docker URL in the browser.
- Exposed to the renderer as `window.setupApi`.

### 📝 Notes

- **F4** (Windows installer closes on first attempt, round 1): not addressed in this release, still open.
- The previous `launcher:open-external` with HTTP whitelist remains for general use; the new `setup:open-docker-download-page` is a dedicated endpoint that does not expose arbitrary URLs.

---

## [0.1.10] — 2026-04-16

Release focused on friction points that emerged from manual E2E tests on Windows ARM64 and macOS (see `e2e-runs/2026-04-16-windows-arm64-parallels/` and `e2e-runs/2026-04-16-macos-dev-machine/`).

### 🖥️ Desktop launcher

- New **in-app dependency checklist** that detects Docker, Node (≥20), Git and Python with per-OS install hints; Start is blocked until mandatory dependencies are OK — fixes the UX gap found during testing (the app didn't signal anything if Docker was missing).
- **Thin launcher**: removed `extraResources: app-payload` from electron-builder; the payload (web app) is downloaded into `userData/app-payload` on first Start via git sparse-checkout and is updatable from the UI. `JHT Desktop.app` size cut from ~300 MB to a much lighter footprint; no more re-download of the installer for every web app update.
- New "How to install" button per missing dependency, opens the official docs in browser.
- `launcher:open-external` IPC handler with http/https allowlist.

### 🍎 macOS code signing & notarization

- electron-builder config with `hardenedRuntime: true`, `notarize: true`, `desktop/build/entitlements.mac.plist` (minimal set: JIT, unsigned-executable-memory, network.client).
- Release workflow imports cert from `MACOS_CERTIFICATE` + `MACOS_CERTIFICATE_PWD`, passes `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` to `@electron/notarize`.
- Post-build verification with `codesign -dv --verbose=4` and `spctl --assess` — the mac job fails if Gatekeeper rejects the DMG.
- Fallback to **unsigned** build when secrets are missing (warning, build doesn't fail → other OSes still publish).
- Maintainer playbook in `docs/release.md` with all steps: CSR → `.p12` → base64, App-Specific Password, Team ID, certificate rotation.

### 🚢 Release pipeline

- New `scripts/check-release-version.sh` as **first CI job**: verifies that git tag (`vX.Y.Z`), root `package.json` and `desktop/package.json` are at the same version. Blocks release with non-zero exit on mismatch — fixes the bug seen in v0.1.8 (tag `v0.1.8` with assets named `0.1.7` because `desktop/package.json` was not bumped).
- Pre-release checklist for the maintainer in `docs/release.md`.

### 🪟 Windows

- **Native ARM64 build**: `desktop/package.json` now produces both `job-hunter-team-<ver>-windows-x64.exe` and `job-hunter-team-<ver>-windows-arm64.exe`. Previously only x64 → on Windows ARM (Surface, Snapdragon, Apple Silicon VMs) it ran in emulation.

### ⬇️ Download page

- `/download` detects user OS and architecture **server-side via User-Agent** (`Windows NT ... ARM64` / `aarch64`, `Mac OS X` → default arm64, `Linux`).
- Shows a single primary CTA with a direct link to the correct asset of the **latest release** (fetched via `api.github.com/repos/.../releases/latest` with `revalidate: 300`).
- Collapsible "Other options" for the rest of OS/arch combinations.
- **No more redirects to GitHub Releases** — the user stays on `jobhunterteam.ai`.
- `/api/download` API reorganized around the "variant" concept (id + arch), backward-compatible with the `platforms` field.

### 📦 CLI install

- `scripts/install.sh --dry-run` prints every command that would be executed without touching the system (useful for debug and pairing).
- `setup.ps1` aligned with `install.sh` on dependency checks (minimal parity, not a full rewrite).
- New `docs/cli-install.md` with AS-IS description of the script and a "tested environments" section.

### ⚠️ Known issues (not resolved in this release)

- **F4**: Windows installer closes silently after the 2nd screen on the **first** double-click (works on the second attempt). Root cause not identified — needs to be reproduced on a fresh VM watching Event Viewer and `%TEMP%\nsis*.log`. Documented in `e2e-runs/2026-04-16-windows-arm64-parallels/README.md`.

---

## [0.1.9] — 2026-04-11

### 🔐 Auth

- Added **GitHub OAuth** login as a second provider alongside Google, targeting developers and OSS contributors.
- Whitelisted `avatars.githubusercontent.com` in `next/image` and the CSP `img-src` to avoid the dashboard crash on first GitHub login.

### ☁️ Cloud Sync (opt-in)

- New `cloud_sync_tokens` table (migration 006) with per-user RLS, SHA-256 token hash, soft-delete via `revoked_at`.
- API CRUD `/api/cloud-sync/tokens` (GET list, POST create, DELETE revoke) — the plaintext token is returned only once at creation time.
- `/settings/cloud-sync` page to generate, copy, and revoke tokens; each token has a human-readable name to identify the device (e.g. "MacBook Leone", "Linux cron").
- `/api/cloud-sync/ping` endpoint for Bearer token verification (uses service-role admin client to bypass RLS), updates `last_used_at` on every check.
- CLI commands `jht cloud enable/status/disable` — `enable` validates the token against `/api/cloud-sync/ping` and persists it in `~/.jht/cloud.json` (chmod 0600); `--url` supports self-hosted and local development.
- New helper `web/lib/supabase/admin.ts` for service-role client used only server-side.
- Migration 007: `UNIQUE (user_id, legacy_id)` constraint on `positions` to allow atomic upsert of rows synced from local SQLite.
- `POST /api/cloud-sync/push` endpoint accepting batches of `positions/scores/applications`: idempotent positions upsert via `legacy_id`, build of the legacy_id → UUID mapping, upsert of scores and applications with the new UUIDs as FKs. `status` and `critic_verdict` normalization against Supabase enums.
- CLI command `jht cloud push` reads SQLite via the built-in `node:sqlite` (requires Node 22.5+, zero native deps), supports `--db <path>` and `--dry-run`, gracefully handles missing database/tables.
- New helper `web/lib/cloud-sync/auth.ts` with `verifyBearerToken` shared between ping and push.
- Operational note: the env var `SUPABASE_SERVICE_ROLE_KEY` must be configured on Vercel (Production + Preview) for the cloud-sync endpoints to work in prod.

### 🐳 Docker Runtime (default-on)

- New root `Dockerfile` + `docker-compose.yml` for the JHT container runtime, published as `ghcr.io/leopu00/jht:latest` (multi-arch amd64+arm64).
- New GitHub Actions workflow for automatic build and push to GHCR.
- Node runtime bumped to **Node 22 LTS** for compatibility with the built-in `node:sqlite` used by cloud-sync.
- Automatic bootstrap of `shared/` modules and TUI build inside the container, `dashboard` wired as PID 1.
- `isContainer()` gate (env `IS_CONTAINER=1` or `/.dockerenv`) at all `open/xdg-open/explorer` call sites: instead of launching the browser from the container, the CLI prints path/URL.
- Bind mount contract: `~/.jht → /jht_home`, `~/Documents/Job Hunter Team → /jht_user`.

### 📦 Installer

- `install.sh` rewritten **Docker-by-default**: installs the runtime (Colima on macOS, docker.io on Linux/WSL2), pulls the GHCR image, creates a `jht` wrapper in `~/.local/bin` that does `docker run` with the standard contract.
- Opt-out with `curl ... | bash -s -- --no-docker` for native mode (expert mode).
- `install.sh` now served as a **Vercel static asset**: `curl -fsSL https://jobhunterteam.ai/install.sh | bash`.
- Wrapper compatible with bash 3.2 (macOS system bash).
- Fix `--help` line range and `set -e` leak.
- `cancel-wizard` hint updated to `jht setup`.

### 🖥️ Desktop Launcher

- Electron launcher now spawns `docker run ghcr.io/leopu00/jht:latest dashboard --no-browser` instead of native `next dev`.
- Automatic Colima bootstrap on macOS at first launch.
- `JHT_NO_DOCKER=1` for fallback in native mode (debug/development).

### 🐛 Fixed

- **Vercel build**: `next.config.ts` now explicitly sets `outputFileTracingRoot` and `turbopack.root` to the monorepo root, with `outputFileTracingExcludes` to skip `cli/`, `desktop/`, `tui/`, `agents/`, `e2e/`, `scripts/`, etc. This solves the 250 MB unzipped Serverless Function limit, which otherwise included the entire monorepo.
- **Assistente page**: removed orphan JSX block `{workspace && (...)}` left over from the refactor that removed the `workspace` state (build broken with `Cannot find name 'workspace'`).
- **Download banner**: removed the yellow "asset pending" banner from the `/download` page (obsolete after desktop packages were released).
- **Post-merge path refactor fix**: consistency on paths centralized on `JHT_HOME`.

---

## [0.1.8] — 2026-04-10

### 🐛 Fixed

- Added `overrides` for `@swc/helpers` in `package.json` to resolve dependency conflicts during `npm ci` in the release workflow.

---

## [0.1.7] — 2026-04-10

### 🌐 Web app

- Removed (again) from the homepage the deprecated landing that had returned during the `0.1.6` recovery, keeping the simplified version intended for live.
- Realigned the homepage to the section set actually supported in production.

### 🚢 Release & deploy

- Fixed the Vercel verification flow in CI, which now checks the linked Git project even without local `.vercel` metadata.
- Blocked publication of release tags that don't point to the current `production` HEAD.
- Added a dedicated workflow to create the release tag directly from `production` HEAD.

---

## [0.1.6] — 2026-04-09

### 🌐 Web app

- Reintroduced the full i18n layer with `it` / `en` / `hu` support, more robust fallbacks and correct language persistence across API, landing and dashboard.
- Realigned landing, `/project` page, download and app chrome with metadata and content consistent with the current release.
- Restored translated messages, layout and loading state in the main protected and public pages.

### 📺 TUI

- New setup wizard with clean vertical flow, fixed file picker and restored select navigation.
- Added multi-provider auth system with OpenAI OAuth PKCE, API key support and encrypted credential storage.
- Refined wizard integration with provider, authentication method and workspace bootstrap.

### 🖥️ Desktop, tests & tooling

- Updated standalone desktop payload and runtime preparation for local packaging.
- Fixed tests and runtime scripts tied to the desktop launcher and setup documentation.
- Versions and visible metadata aligned to `0.1.6` across all tracked packages in the monorepo.

---

## [0.1.5] — 2026-04-09

### 🎨 UI simplifications

- Web landing simplified, redundant sections removed, dev CSP fixed.
- Hero and download page polished; download platform ordering finalized.
- Auth: aligned public login redirects and `app_url` for deployed environments.

### 📺 TUI setup

- macOS workspace picker improved.
- Setup banner alignment fixed.
- Workspace config aligned with web side.

### 📝 Internal

- `chore(release)`: `0.1.5` metadata prepared.
- Restored `FloatingChat` type aliases for the test suite.

---

## [0.1.4] — 2026-04-08

### 🌐 Web access & setup

- Web login reorganized with cloud-first access and immediate fallback to local workspace.
- Added `NEXT_PUBLIC_APP_URL` to correctly compose the OAuth redirect in deployed environments.
- Ignored Supabase temp files and dev server local logs.

### 📺 TUI

- New guided profile flow with validations, checkpoints and initial setup banner.
- Cleaned-up team view with horizontal layout, fixed ASCII banner and `/workspace` command.
- Improved prompts, examples and redraw of the profile wizard.

### 🌍 Public site

- Landing simplified and made more readable in hero and CTA sections.
- Widespread cleanup of marketing pages and significant content reduction on the stats page.

---

## [0.1.3] — 2026-04-08

### 🪟 Desktop Windows

- Lightened the web payload included in the desktop installer, copying only production assets and dependencies.
- Removed cache and sourcemaps from the packaged payload to reduce size and install time on Windows.
- Confirmed the `nsis` build locally with a noticeably smaller Windows installer.

---

## [0.1.2] — 2026-04-08

### 📦 Desktop release

- Added the metadata required by `electron-builder` for the Linux `.deb` package.
- Confirmed Windows `.exe` and macOS `.dmg` packaging in the release workflow.
- Prepared the cross-platform desktop release publishable via GitHub Actions.

---

## [0.1.1] — 2026-04-08

### 📦 Desktop release

- Aligned all `package.json` and `package-lock.json` versions to `0.1.1`.
- Confirmed Electron desktop packaging for macOS, Windows and Linux.
- GitHub Release workflow ready to publish real `.dmg`, `.exe`, `.AppImage` and `.deb` installers.
- Download page and API read the actual assets of the latest release instead of assuming legacy archives.

---

## [0.1.0] — 2026-04-04

### 🤖 Multi-agent pipeline

- Scout, Analyst, Scorer, Writer, Critic, Sentinel, Captain.
- Agent runner with tool loop, abort and error handling.
- Shared SQLite database with anti-collision between agents.

### ⌨️ CLI `jht`

- Interactive setup wizard with `@clack/prompts`.
- `jht team start/stop` with `JHT-` session prefix for TUI compatibility.
- `jht status`, `jht config show`, `jht cron list`.
- `jht export/import` (JSON/CSV, dry-run, merge/replace).
- `jht health` (7 modules with semaphores).
- `jht backup/restore` with manifest and retention.
- `jht migrate` (config versioning with dry-run).
- `jht logs`, `jht providers`, `jht stats`.
- `jht plugins`, `jht agents`.

### 📺 TUI (Terminal UI)

- Multi-agent navigation with `@mariozechner/pi-tui`.
- Chat panel with streaming, tool messages, thinking blocks.
- Real-time counter of active tmux sessions.
- Single Ctrl+C to exit.

### 🌐 Web Dashboard (50+ pages)

- Pipeline: agents, sessions, applications, analytics.
- Infrastructure: health, retry/circuit-breaker, rate-limiter, queue, events SSE.
- Configuration: settings, credentials, plugins, tools, templates, providers, memory.
- System: overview, gateway, channels, notifications, cron, daemon, deploy.
- Data import/export, backup, migrations, i18n it/en.

### 🧱 Shared modules

- `config/` — Zod schema, centralized I/O.
- `llm/` — factory for Claude, OpenAI, MiniMax.
- `sessions/` — registry with JSON persistence.
- `hooks/` — source precedence, frontmatter loader.
- `events/` — typed pub/sub event bus.
- `plugins/` — discovery, lifecycle, toggle.
- `context-engine/` — LLM context collection and prioritization.
- `rate-limiter/`, `retry/` — 3-state circuit breaker.
- `queue/` — dead-letter, exponential backoff retry + jitter.
- `templates/` — variables, sections with character budget.
- `notifications/` — multi-channel adapter registry.
- `analytics/` — token usage, p95 latency, provider costs.
- `credentials/` — AES-256-GCM, OAuth.
- `memory/` — SOUL/IDENTITY/MEMORY.
- `history/`, `tasks/`, `validators/`, `migrations/`, `backup/`, `cache/`, `i18n/`.

### 🧪 Testing

- 736+ test cases across 168 files (vitest).
- Unit, integration, E2E CLI and web tests (Playwright).

### 🛠️ CI/CD

- GitHub Actions: lint, type-check, vitest matrix, build, Vercel deploy.
- Security: npm audit, gitleaks, Semgrep SAST.
- Dependabot for npm and GitHub Actions.
- PR template, issue templates, CONTRIBUTING.md.
