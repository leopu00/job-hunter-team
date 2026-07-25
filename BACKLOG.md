# 📋 BACKLOG — open tactical index

> **What this file is** (since the 2026-07-03 restructure): a slim, one-line-per-item index of the **open** tactical work, grouped by area. It intentionally contains no history:
>
> - **Strategy & themes** → [`docs/about/ROADMAP.md`](docs/about/ROADMAP.md) (incl. contributor missions **M1–M10**)
> - **Shipped work** → [`CHANGELOG.md`](CHANGELOG.md)
> - **Tech debt / minor fixes** → [`docs/internal/roadmap/MINOR-TRACKER.md`](docs/internal/roadmap/MINOR-TRACKER.md) · graphics polish → [`docs/internal/landing-image-prompts.md`](docs/internal/landing-image-prompts.md)
> - **Everything this file used to contain** (1487 lines — every tag, postmortem and done-entry, unchanged) → [`docs/internal/_archive/BACKLOG-2026-07-03-frozen.md`](docs/internal/_archive/BACKLOG-2026-07-03-frozen.md)
>
> Items graduate to **GitHub Issues** as they get picked up (missions M1–M10 first). A `[TAG]` referenced from code or docs that is *not* listed here is **closed** — its full story is in the frozen archive.
>
> Legend: 🔴 fix soon · 🟡 in progress / partial · ⬜ open · ⚪ parked idea · *(M#)* = feeds that contributor mission

## 🔴 Pacing & budget correctness

- 🔴 **[PACING-RESET-EDGE-FREEZE]** — false emergency freeze from `proj>200` at the reset edge: `proj = usage / window-fraction` blows up as `reset_in→0` and the Sentinel skill has no exception, so it froze 7 healthy agents (2026-06-26). Fix: suppress the `proj>200` trigger when `reset_in≈0` in `agents/sentinella/_skills/emergency-handling/` (×7 languages) + `shared/skills/compute_metrics.py` (same guard drives `suggested_throttle_s`).
- 🔴 **[PACING-DAILY-HALT-STANDBY-LEAK]** — the daily hard-stop silences the bridges but not the agents: workers wake from throttle timers, ping the Captain, the Captain replies → ~1–2%/night leak. Fix: workers and Captain honor `daily-halt.flag` on wake; bridge re-ESCs any session that talks during halt. Detail: `docs/internal/postmortems/2026-07-02-daily-halt-standby-leak.md`.
- 🟡 **[PACING-PROJ-VOLATILE]** — bridge still gates some decisions on the volatile `proj` (g-spot wake, throttle ladder, coast). **Deliberately deferred** (live and working — do not touch casually); if reopened, move the gates to velocity-based signals. Analysis: `docs/internal/roadmap/2026-06-20-proj-volatile-pacing-todo.md`.
- ⬜ **[JHT-KIMI-OPTIMIZE]** *(M4)* — Kimi €40 tier out of beta: in-window variance analysis (buffer 88→92%), external multi-week beta runs (two live now), 1-month steady-state stress test.
- ⬜ **[JHT-SENTINELLA-OPTIMIZE]** — reduce Sentinel/coordinator overhead. Resized 2026-07-02: coordinators ≈20% of budget (a secondary lever, equal on Kimi and Codex) — see `docs/internal/architecture/kimi-vs-codex-economics.md`.
- ⚪ **[B1-DETERMINISTIC-PACING]** — parked idea: deterministic pacing in the bridge with the LLM as supervisor-on-anomalies (hybrid), to kill bang-bang throttle thrash. Doc: `docs/internal/roadmap/2026-06-30-B1-deterministic-pacing-idea.md`.

## 🌐 Web & cloud sync

- 🟡 **[JHT-INTERACTION-PLANES]** — the 2026-06-15 redesign is shipped and then some: the native migration (2026-07-19) and the retirement of the local `:3000` dashboard (2026-07-23) closed the "two dashboards" ambiguity outright. Open residuals: **[JHT-DESKTOP-COCKPIT]** native tray/notifications polish · **[JHT-VPS-TUNNEL]** in-app remote terminal, upload over tunnel, tunnel status indicator · **[JHT-CLOUD-INTERACTIVE-RETIRE]** retire `team_commands` once the web feeder is gone. Closed since: `pending-messages/{ack,reply}` (implemented, demo-aware), and `NEXT_PUBLIC_JHT_DEPLOY` on Vercel (a server-side fallback now infers `cloud` from the `VERCEL` env var, so a missing variable no longer degrades to local behaviour). Design doc: `docs/internal/architecture/2026-06-15-interaction-planes-redesign-design.md`.
- 🟡 **[JHT-WEB-LOCAL-ROUTES-ORPHANED]** — **36 dead API routes removed on 2026-07-25** (149 → 113; the ones that shell into the container went 28 → 17). Every removed route had zero callers anywhere outside `archive/`: feeds for the retired local dashboard and the archived team-v1 page, VPS lifecycle buttons now living in the native app, the profile-assistant lane, bridge start/stop, `team/start-all` and `team/stop-all` (the CLI carries the only implementation now). `/api/canary` was kept on purpose — a documented `curl`-by-hand diagnostic. **Open residual:** the 17 remaining shell routes are all called by the `(protected)/team/*` pages, which belong to the local plane and degrade to empty on cloud (`useIsCloud()` in `AgentInteraction`). Decide whether those pages stay as a dev-only surface or go with their routes. Plus **11 routes exercised only by Playwright specs** (`/api/{about,health,stats,agents,agents/metrics,agents/[id],onboarding,resume,search,telegram,workspace}`) — their fate is tied to [JHT-E2E-STALE].
- ⬜ **[JHT-REALTIME-SCALE]** — event-driven sync is live and degrades gracefully; scale refinements for many users (reconnect-rate monitor, Realtime connection ceiling, thundering herd, unified auth, tunable parachute).
- ⬜ **[JHT-CLOUDSYNC-01]** — remaining P0 flow-correctness items; living doc: `docs/internal/architecture/cloud-sync-architecture.md` § Pending.
- ⬜ **[JHT-ONBOARDING-04]** — periodic agent-results push.
- 🟡 **[JHT-WEB-DEMO]** — demo mode + `/welcome` shipped 2026-07-22/23 ([design record](docs/internal/architecture/2026-07-22-web-demo-mode-and-welcome.md)). Open: no e2e spec covers `/welcome` or the demo branch (`JHT_WEB_DEMO_PERSONA` exists to make them testable), and nothing checks that the 4 seeds still carry every field the pages read — a new field silently renders a hole in the demo.
- 🟠 **[JHT-CASE-STUDIES-WEB]** — publish the Kimi weekly-distributed run (data collected, processing pending) and the Claude Max re-run (with proper instrumentation); optional charts (team efficiency, Kimi burn sparkline, per-day timeline).
- ⬜ **[JHT-WEB-02-CHECKSUM]** — SHA256 checksums for the release artifacts. Reframed 2026-07-25: `/download` no longer resolves GitHub assets (it hands out the CLI one-liner), so the checksums belong to the release notes / GitHub Release body, not to the page.
- ⬜ **[JHT-SETUP-LOCAL-FIRST]** — re-elevate Local PC to a first-class path; align execution-mode copy.

## 🖥️ Applicazione nativa Godot

- ⬜ Auto-update firmato per gli export Godot.
- ⬜ Tray icon + notifiche native dal gioco.
- ⬜ **[JHT-DESKTOP-RECOVERY]** — recovery passphrase BIP39 6-word (Argon2id KDF v2).
- ⬜ Friendly error handling (ECONNREFUSED/401/tunnel-down → actionable cards).
- ⬜ Embedded help/FAQ (context-sensitive "?" + offline FAQ).
- ⬜ **[JHT-CLOUD-RESTORE]** — automatic bootstrap pull on an empty container after login.
- ⬜ **[JHT-CLOUD-SYNC-THEME]** — theme/settings from localStorage to a synced `user_settings` table.
- ⬜ **[JHT-DESKTOP-06]** — "dedicated computer" mode (JHT on a LAN PC via SSH/mDNS); unify with the VPS tunnel path.
- 🟡 **[PACK-INSTALLER-SIZE]** — misurare e ottimizzare gli export Godot sui tre sistemi. Il container è già stato dimezzato (7.2 → 3.2 GB, 2026-07-24); resta da misurare il peso degli export sui tre sistemi.

> `[JHT-DESKTOP-07]` ("container serves `next start` instead of `next dev`") è stato **chiuso per superamento** il 2026-07-23: il container non avvia più Next.js in nessuna modalità.

## 🤖 Team & agents

- ⬜ **[JHT-RENAME-COORDINATOR]** — rename Capitano → Coordinatore everywhere (prompts ×7 languages, tmux session names, launcher, CLI labels, web routes/i18n). Done so far: public `/agents` page only. Needs a dedicated session with a compat alias so live teams don't break.
- ⬜ **[CAPITANO-SPAWN-MODES]** — let the Captain pick a spawn *mode* (e.g. batch-of-Scouts phase, then Analysts) instead of only "+1 per role"; with the 5-min throttle floor, parallelism is the budget lever.
- ⬜ **[JHT-CAPITANO-PROMPT-DRIFT]** — agent-prompt translations lag the EN base (C-14/C-17, RULE-13/14/15, SC-08, C-09b, C-05b across de/es/fr/hu/pt). Deferred to one end-of-cycle mass translation pass; EN-locale teams unaffected.
- 🆕 **[GEOCODE-NEW-VPS]** — fresh VPS doesn't populate `office_lat/lon` (case-study map empty) — investigate.
- ⬜ **[JHT-DOCTOR-DAILY-RESTART]** / **[JHT-TOKEN-MONITOR-WRITER-CRITIC]** — post-MVP residuals (restart coverage; Writer+Critic metered as one unit).
- ⬜ **[JHT-MENTOR-SKILLS]** *(M6)* — add Mentor-specific skills as testing reveals needs.
- ⬜ **[JHT-AGENT-PROMPTS-V2]** — deep section-by-section validation of the agent prompts.
- ⬜ **[JHT-ACCESS-CREDENTIALS-GAPS]** *(M3)* — access & credentials doc-vs-code gaps.
- ⬜ Skill distribution punch list — Python script colocation, `_lib/` for shared deps, smoke + full-team integration tests → [`docs/internal/architecture/skill-distribution.md`](docs/internal/architecture/skill-distribution.md); includes **[JHT-SKILLS-SYMLINK-TEST]** and **[JHT-SKILLS-CODEX-KIMI-DISCOVERY]**.

## 🗄️ DB & filesystem hygiene

- ⬜ **[JHT-DB-RENAME]** — `~/.jht/jobs.db` → `~/.jht/db/jht.db` (+ move `scout_coordination.db` next to it; boot migration).
- ⬜ **[JHT-DB-SCOUT-COORD]** — consolidate `scout_coordination.db` into the main DB, or document why it must stay separate.
- ⬜ **[JHT-DB-CLEANUP]** — schema hygiene + `~/.jht` path/naming cleanup.
- ⬜ **[JHT-HOME-REFACTOR]** — `~/.jht` runtime filesystem: shared fonts (**FONTS-SHARED**), stale provider identity files (**IDENTITY-CLEANUP**), config grouping (**CONFIG-GROUP**), leftover dirs (**LEFTOVERS**).
- ⚪ Schema evolution ideas (position_events, critic rounds, captain_decisions…) *(M7)* → [`docs/internal/roadmap/db-schema-optimization.md`](docs/internal/roadmap/db-schema-optimization.md).

## 🌍 i18n residuals

- ⬜ `LOCALES` drift — `shared/i18n/types.ts` omits `'hu'`; API default `'it'` vs `DEFAULT_LOCALE='en'`.
- ⬜ `mantenitore` agent overlays (6 languages) + translator-facing guide + native-speaker review pass.

## 🛠️ Infra & CLI

- 🟡 **[INFRA-VERCEL-QUOTA]** — poll fold-in shipped (~75% idle reduction); residual: spending limit on Vercel (user action). The **file-bridge poller was re-enabled by default on the VPS (2026-07-11)** to serve on-demand CV/attachment downloads from the web (position-page "Download PDF" + profile CV preview): ~130 req/h per user at idle (index/purge at 5min, pending-poll ≤30s). Sustainable for beta — the structural fix is **[JHT-FILEBRIDGE-REALTIME]**.
- ⬜ **[JHT-FILEBRIDGE-REALTIME]** — take the file-bridge off HTTP long-polling onto push/Realtime (Supabase Realtime subscription on `file_bridge_requests`, or fold into the event-driven [JHT-REALTIME-SCALE] channel) so idle cost → ~0 as users scale. Today the VPS poller polls `/api/cloud-sync/file-bridge` (~130 req/h/user idle); re-enabled 2026-07-11 in `cli/src/commands/pid1.js` (split out of the `JHT_CLOUD_CONTROL_POLLERS` gate).
- 🟡 **[INFRA-SUPABASE-PERF]** — P0/P1/P2 advisor findings done; residual: connection-pool monitoring.
- 🟡 **[BUG-INSTALL-BRANCH-MASTER-DEFAULT]** — `install.sh` still fetches runtime files from `master` when installed from a dev branch (mostly fixed).
- 🟡 **[JHT-CLI-WIN-NATIVE]** — Windows-native CLI shipped; E2E validation pass remaining.
- 🟡 **[JHT-INSTALL-SPLIT]** — host/container split partially done.
- 🔴 **[JHT-E2E-STALE]** — the 78 Playwright specs in `e2e/` run in no workflow and have not been touched since 2026-07-03: they know nothing about `/welcome`, demo mode, `/swipe`, the messenger drawer or the reworked position page. Either wire them into CI against a preview deployment, or prune them to the set that is actually maintained — a suite nobody runs is worse than no suite, because it reads as coverage. (The Python suite went into CI on 2026-07-24; vitest and the Godot self-tests were already there.)

## 📦 Docs & launch assets (maintainer)

- 🟡 **[JHT-LAUNCH-03]** — demo GIFs for the README (**blocker**: replaces the "coming soon" placeholder).
- 🟡 **[JHT-LAUNCH-08]** — `gh label sync` live + public project board.
- 🟡 **[JHT-LAUNCH-09]** — Show HN post, not published yet (draft kept in the private `prima-release/` launch folder, outside this repo).
- ⬜ **[JHT-LAUNCH-05]** monitoring freeze window · **[JHT-LAUNCH-06]** awesome-lists submissions · **[JHT-LAUNCH-07]** beta recruitment · **[JHT-LAUNCH-10]** press kit.
- ⬜ **[JHT-TEST-CAMPAIGN]** — publish the remaining documented runs (see the matrix in [`docs/guides/BETA.md`](docs/guides/BETA.md)).
- ⬜ **[JHT-VPS-COMPARISON-DOC]** — honest decision tree: local PC vs dedicated PC vs VPS.
- ⬜ **[JHT-DOCS-FAQ]** — FAQ ("why not LangChain/AutoGen/CrewAI?") · **[JHT-AI-AGENT-EXAMPLES]** — example prompts for AI assistants driving `jht`.
- ⬜ Phase-5 leftovers — subdomains (app/docs/api), launcher screenshots, visual FAQ, short video tutorials.

## 💡 Parked ideas

- ⚪ **[JHT-POSITIONS-SWIPE-TRIAGE]** *(M1)* — swipe-style rapid triage of positions; backend action exists (`user-exclude` + async request lane), the card UX is the work.
- ⚪ **[JHT-MANAGED-INBOX]** — team email inbox auto-provisioned by us · **[JHT-EMAIL-OAUTH]** — Gmail via OAuth instead of app-password.
- ⚪ **[JHT-LOCAL-VAULT]** *(M3)* — master password → encrypted vault for local secrets.
- ⚪ **[JHT-COST-VALIDATION-PAYG-VS-SUB]** *(M8)* — €40 of pay-per-use Kimi tokens vs the €40 subscription, measured.
- ⚪ Idle enrichment & LLM-driven position classifier → files in [`docs/internal/roadmap/`](docs/internal/roadmap/).
