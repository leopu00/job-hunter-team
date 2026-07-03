# 📋 BACKLOG — open tactical index

> **What this file is** (since the 2026-07-03 restructure): a slim, one-line-per-item index of the **open** tactical work, grouped by area. It intentionally contains no history:
>
> - **Strategy & themes** → [`docs/about/ROADMAP.md`](docs/about/ROADMAP.md) (incl. contributor missions **M1–M8**)
> - **Shipped work** → [`CHANGELOG.md`](CHANGELOG.md)
> - **Tech debt / minor fixes** → [`docs/internal/roadmap/MINOR-TRACKER.md`](docs/internal/roadmap/MINOR-TRACKER.md) · graphics polish → [`docs/internal/GRAPHICS-POLISH.md`](docs/internal/GRAPHICS-POLISH.md)
> - **Everything this file used to contain** (1487 lines — every tag, postmortem and done-entry, unchanged) → [`docs/internal/_archive/BACKLOG-2026-07-03-frozen.md`](docs/internal/_archive/BACKLOG-2026-07-03-frozen.md)
>
> Items graduate to **GitHub Issues** as they get picked up (missions M1–M8 first). A `[TAG]` referenced from code or docs that is *not* listed here is **closed** — its full story is in the frozen archive.
>
> Legend: 🔴 fix soon · 🟡 in progress / partial · ⬜ open · ⚪ parked idea · *(M#)* = feeds that contributor mission

## 🔴 Pacing & budget correctness

- 🔴 **[PACING-RESET-EDGE-FREEZE]** — false emergency freeze from `proj>200` at the reset edge: `proj = usage / window-fraction` blows up as `reset_in→0` and the Sentinel skill has no exception, so it froze 7 healthy agents (2026-06-26). Fix: suppress the `proj>200` trigger when `reset_in≈0` in `agents/sentinella/_skills/emergency-handling/` (×7 languages) + `shared/skills/compute_metrics.py` (same guard drives `suggested_throttle_s`).
- 🔴 **[PACING-DAILY-HALT-STANDBY-LEAK]** — the daily hard-stop silences the bridges but not the agents: workers wake from throttle timers, ping the Captain, the Captain replies → ~1–2%/night leak. Fix: workers and Captain honor `daily-halt.flag` on wake; bridge re-ESCs any session that talks during halt. Detail: `docs/internal/2026-07-02-daily-halt-standby-leak.md`.
- 🟡 **[PACING-PROJ-VOLATILE]** — bridge still gates some decisions on the volatile `proj` (g-spot wake, throttle ladder, coast). **Deliberately deferred** (live and working — do not touch casually); if reopened, move the gates to velocity-based signals. Analysis: `docs/internal/2026-06-20-proj-volatile-pacing-todo.md`.
- ⬜ **[JHT-KIMI-OPTIMIZE]** *(M4)* — Kimi €40 tier out of beta: in-window variance analysis (buffer 88→92%), external multi-week beta runs (two live now), 1-month steady-state stress test.
- ⬜ **[JHT-SENTINELLA-OPTIMIZE]** — reduce Sentinel/coordinator overhead. Resized 2026-07-02: coordinators ≈20% of budget (a secondary lever, equal on Kimi and Codex) — see `docs/internal/architecture/kimi-vs-codex-economics.md`.
- ⚪ **[B1-DETERMINISTIC-PACING]** — parked idea: deterministic pacing in the bridge with the LLM as supervisor-on-anomalies (hybrid), to kill bang-bang throttle thrash. Doc: `docs/internal/2026-06-30-B1-deterministic-pacing-idea.md`.

## 🌐 Web & cloud sync

- 🟡 **[JHT-INTERACTION-PLANES]** — the 2026-06-15 redesign (desktop cockpit + read-only web) is largely shipped (TELEGRAM-OPTIONAL, WEB-READONLY gating, DATA-SYNC, DASHBOARD-SPLIT, VPS-TUNNEL MVP, poll fold-in). Open residuals: **[JHT-DESKTOP-COCKPIT]** native terminal/tray/notifications polish · **[JHT-VPS-TUNNEL]** in-app remote terminal, upload over tunnel, tunnel status indicator · **[JHT-WEB-READONLY]** `pending-messages/{ack,reply}` + `profile-assistant/chat` lanes · **[JHT-DASHBOARD-SPLIT]** minor mixed-page buttons + set `NEXT_PUBLIC_JHT_DEPLOY=cloud` on Vercel (user action) · **[JHT-CLOUD-INTERACTIVE-RETIRE]** retire `team_commands` once the web feeder is gone. Design doc: `docs/internal/2026-06-15-interaction-planes-redesign-design.md`.
- ⬜ **[JHT-REALTIME-SCALE]** — event-driven sync is live and degrades gracefully; scale refinements for many users (reconnect-rate monitor, Realtime connection ceiling, thundering herd, unified auth, tunable parachute).
- ⬜ **[JHT-CLOUDSYNC-01]** — remaining P0 flow-correctness items; living doc: `docs/internal/architecture/cloud-sync-architecture.md` § Pending.
- ⬜ **[JHT-ONBOARDING-04]** — periodic agent-results push.
- 🟠 **[JHT-CASE-STUDIES-WEB]** — publish run #4 (Kimi weekly-distributed, data collected, processing pending) and re-run #5 (Claude Max with proper instrumentation); optional charts (team efficiency, Kimi burn sparkline, per-day timeline).
- ⬜ **[JHT-WEB-02-CHECKSUM]** — SHA256 checksums on the download page.
- ⬜ **[JHT-SETUP-LOCAL-FIRST]** — re-elevate Local PC to a first-class path; align execution-mode copy.

## 🖥️ Desktop launcher

- ⬜ **[JHT-DESKTOP-05]** — auto-update via electron-updater (code signing stays deferred by choice: open source + community review as the trust signal).
- ⬜ Tray icon + native desktop notifications.
- ⬜ **[JHT-DESKTOP-RECOVERY]** — recovery passphrase BIP39 6-word (Argon2id KDF v2).
- ⬜ Friendly error handling (ECONNREFUSED/401/tunnel-down → actionable cards).
- ⬜ Embedded help/FAQ (context-sensitive "?" + offline FAQ).
- ⬜ **[JHT-CLOUD-RESTORE]** — automatic bootstrap pull on an empty container after login.
- ⬜ **[JHT-CLOUD-SYNC-THEME]** — theme/settings from localStorage to a synced `user_settings` table.
- ⬜ **[JHT-DESKTOP-06]** — "dedicated computer" mode (JHT on a LAN PC via SSH/mDNS); unify with the VPS tunnel path.
- ⬜ **[JHT-DESKTOP-07]** — container serves `next start` instead of `next dev`.
- 🟡 **[PACK-INSTALLER-SIZE]** — desktop installers are 90–195 MB; slim the Electron bundle (the universal Windows exe is the worst offender).

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

- 🟡 **[INFRA-VERCEL-QUOTA]** — poll fold-in shipped (~75% idle reduction); residual: spending limit on Vercel (user action) until [JHT-CLOUD-INTERACTIVE-RETIRE] zeroes per-user pollers.
- 🟡 **[INFRA-SUPABASE-PERF]** — P0/P1/P2 advisor findings done; residual: connection-pool monitoring.
- 🟡 **[BUG-INSTALL-BRANCH-MASTER-DEFAULT]** — `install.sh` still fetches runtime files from `master` when installed from a dev branch (mostly fixed).
- 🟡 **[JHT-CLI-WIN-NATIVE]** — Windows-native CLI shipped; E2E validation pass remaining.
- 🟡 **[JHT-INSTALL-SPLIT]** — host/container split partially done.

## 📦 Docs & launch assets (maintainer)

- 🟡 **[JHT-LAUNCH-03]** — demo GIFs for the README (**blocker**: replaces the "coming soon" placeholder).
- 🟡 **[JHT-LAUNCH-08]** — `gh label sync` live + public project board.
- 🟡 **[JHT-LAUNCH-09]** — Show HN post ([`docs/launch/show-hn-draft.md`](docs/launch/show-hn-draft.md)), not published yet.
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
