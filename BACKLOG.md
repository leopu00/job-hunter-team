# BACKLOG — Job Hunter Team

Last updated: 2026-04-27 (refresh after 16 days of intensive work + pre-launch docs)

---

## 🎯 PRODUCT VISION

Job Hunter Team is an open-source application that runs **locally** in a container, with multiple interfaces (web/desktop/CLI/TUI/Telegram). Non-technical users download the Electron launcher; technical users clone the repo and use the CLI. In both cases, the AI agent team works on their own machine, on their own data, with their own LLM subscription — not a managed cloud service.

**AI on the side of workers, not against them.**

> 🧪 **Currently in beta** — installer + monitoring (Kimi tier) still maturing. See [`docs/guides/BETA.md`](docs/guides/BETA.md).

**Execution modes:**

1. **🖥️ Local PC** — *available today*. Works but **not recommended for daily-use machines**: 8 agents in parallel eat resources and the PC must stay on. Acceptable for very powerful desktops or for night-only runs (with the inconvenience of always remembering to leave the PC awake).
2. **🏠 Dedicated computer** — *planned (PHASE 2)*. A second PC at home, plugged in and left on for weeks/months. Good fit if the user already has spare hardware.
3. **☁️ VPS / cloud rental** ⭐ **target setup** — *planned (PHASE 3)*. Cheaper than buying a dedicated PC, rented only during the job-hunt months. Always on, no impact on the user's daily machine.

**Stack decisions:**

- 🖥️ Desktop = **launcher only** (config, lifecycle, browser opener) — not the interaction interface
- 🌐 Web dashboard = Next.js 16 on Vercel (`jobhunterteam.ai`)
- 💾 Cloud data backend (read-only metadata sync, optional) = Supabase
- 🐳 Container runtime = Docker + Docker Compose
- ⌨️ CLI **driveable by AI agents** (Claude Code, 🦞 OpenClaw, Codex, Cursor) — USP
- 💬 **Telegram** — today talks to the Captain only; planned: per-agent chat + a "team forum" channel where the user can join the whole team's conversation
- 🧙‍♂️ **Maestro** career-coach agent (planned) — see [`docs/about/VISION.md`](docs/about/VISION.md)

---

## 📊 CURRENT STATE (2026-04-27)

**Estimated maturity: ~78%** *(subjective estimate based on completed roadmap items — not a measured metric)* (was ~67% on 04-11)

### 🏗️ Infrastructure completed

**🔐 Auth & Backend:**
- ✅ Supabase cloud active (region in `web/.env.local`, see compliance doc)
- ✅ PostgreSQL schema applied (migrations 001-007: cloud_sync_tokens + push idempotency)
- ✅ Google + GitHub OAuth working
- ✅ Domain `jobhunterteam.ai` live + Vercel SSL

**☁️ Cloud Sync:**
- ✅ `cloud_sync_tokens` schema + RLS + UI `/settings/cloud-sync`
- ✅ API endpoints `/api/cloud-sync/{tokens, ping, push}` (idempotent batch)
- ✅ CLI `jht cloud enable/status/disable/push` working

**🌐 Web platform:**
- ✅ Next.js 16 app — **112 pages** wired to Supabase
- ✅ CI/CD Vercel + GitHub Actions (8 workflows)

**🖥️ Desktop launcher:**
- ✅ Electron launcher + prebuilt payload (no `npm install` user-side)
- ✅ Cross-platform packaging (`.dmg`, `.exe`, `.AppImage`, `.deb`)
- ✅ Setup wizard: provider choice (Claude / Codex / Kimi) + cost-compare API vs subscription

**📦 Install:**
- ✅ One-liner: `curl https://jobhunterteam.ai/install.sh | bash`

### 🤖 Team & monitoring (post 04-11)

- ✅ **8-agent team** (Captain + Sentinel + Scout + Analyst + Scorer + Writer + Critic + Assistant) **+ 🧙‍♂️ Maestro (planned)**
- ✅ **📡 Bridge** as separate role (`sentinel-bridge.py` clock-only daemon)
- ✅ **Monitoring V5** (Bridge → Sentinel event-driven → Captain autonomous, multi-source)
- ✅ Sentinel refactor (491→130 lines + 6 on-demand skills: `check_usage_http/tui`, `decision_throttle`, `emergency_handling`, `memory_state`, `order_formats`)
- ✅ CLI `jht team` / `jht container` / `jht sentinella` proxy `docker exec`
- ✅ Web team page with org-chart, inter-agent message animations, live Bridge popover
- ✅ Multi-provider start-agent (`.launcher/start-agent.sh` reads `active_provider` from config)

### 📚 Pre-launch documentation (2026-04-27)

- ✅ README rewritten (story, providers, vision, monitoring, AI-agent integration)
- ✅ 8 new docs: STORY, PROVIDERS, AI-AGENT-INTEGRATION, VISION, MONITORING, RESULTS, BETA, `agents/maestro/maestro.md` spec

### 📝 Doc-review pass (2026-04-28) — in progress

Sprint to bring the entire docs corpus + agent prompts to V5 alignment + English where appropriate. Originally scoped at 38 files; ~25 closed in this session.

**✅ Completed:**
- All ADRs + `docs/adr/README.md`
- `.github/CONTRIBUTING.md` + 3 issue/PR templates (English)
- `agents/_team/architettura.md` (V5 rewrite, 4-tier model, English)
- `agents/_manual/` × 4 (anti-collision · communication-rules · db-schema · sessions, all English V5)
- 3 deleted as obsolete: `ottimizzazioni-team.md` · `add-agent.md` · `migration-audit-src.md`
- `agents/_skills/` × 5 SKILL.md (db-query · db-update · db-insert NEW · rate-budget · tmux-send) — global pool
- `agents/sentinella/_skills/` × 6 SKILL.md (Agent Skills format with frontmatter, V5 paths)
- `supabase/README.md` (English, hybrid model clarified)
- `docs/security/` × 7 (README + 6 detailed files: 01-pre-launch-review, 02-openclaw-comparison, 03-implementation-tradeoffs, 04-threat-model, 05-checklist, 06-post-fix-comparison) — full English translation
- ⚠️ `web/C:/Users/.../CLAUDE.md` phantom dir cleaned + guard added in `cli/src/jht-paths.js`
- Agent prompts (9) — V5-alignment pass: orphan separators stripped, raw `tmux send-keys` for inter-agent comms migrated to `jht-tmux-send` (scout · analista · scorer · scrittore · assistente), capitano CHAT WEB switched to `jht-send`, stale `MENTOR` row dropped (Maestro is still planned), GPT-4o → GPT-5.5. Italian content kept in place (full i18n is Phase 4).

**⏳ Remaining:**

```
(no doc-review items left; agent-prompt full i18n is tracked in PHASE 4)
```

See also the **launcher-distributed skill discovery** punch list in [`docs/about/ROADMAP.md`](docs/about/ROADMAP.md#%EF%B8%8F-skill-discovery--launcher-distributed-isolation-priority) for the follow-up work after the markdown moves landed (Python script colocation, distributor in `start-agent.sh`, drop the global Dockerfile loop, full-team integration test).

### 🧪 Real-world tests (preliminary, undocumented)

> ⚠️ **Test results so far are anecdotal** — based on the maintainer's own job-hunting sessions on a single profile. No formal test campaign yet. **See [JHT-TEST-CAMPAIGN] in PHASE 1** — running a documented coverage matrix (provider × tier × persona) is a critical pre-launch milestone. Coverage tracker: [`docs/guides/BETA.md` § Coverage we still need](docs/guides/BETA.md#coverage-we-still-need).

- ✅ Claude Max x20 — pipeline tested for weeks, ±5% usage projection precision
- 🟡 Kimi €40 — works, ±10–15% oscillation, calibration in progress (mass-market target)
- ❌ Claude Pro €20 — not viable (single agent burns the window)
- 🔬 Codex Plus/Pro €100 — supported by runtime, benchmark in progress

For full provider matrix → see [`docs/about/PROVIDERS.md`](docs/about/PROVIDERS.md).

---

## 🚀 ROADMAP — From Open Source to Desktop Product

### 1️⃣ PHASE 1 — Web Platform Consolidation (current sprint)

#### 🔴 HIGH PRIORITY

##### ☁️ [JHT-CLOUDSYNC-01] Cloud Sync — completion (60% done)

- ✅ `cloud_sync_tokens` schema + RLS (migration 006)
- ✅ API CRUD `/api/cloud-sync/tokens` (GET/POST/DELETE, soft-delete)
- ✅ UI `/settings/cloud-sync` (plaintext token shown only once)
- ✅ Endpoint `/api/cloud-sync/ping` (Bearer validation + `last_used_at`)
- ✅ CLI `jht cloud enable/status/disable` (token in `~/.jht/cloud.json` chmod 0600)
- ✅ Endpoint `/api/cloud-sync/push` (idempotent upsert via `(user_id, legacy_id)`, mapping → UUID)
- ✅ CLI `jht cloud push` (one-shot manual, built-in `node:sqlite`, `--dry-run`)
- ⬜ **Periodic sync loop** (daemon/cron, diff SQLite → cloud every N min)
- ⬜ **Google Drive integration** (`drive.file` scope, CV/cover letter upload)
- ⬜ **"Enable cloud sync" toggle** in desktop launcher + CLI wizard
- ⬜ **Self-hosted Supabase docs** (BYO backend for technical users)

##### 📅 [JHT-MONITORING-WEEKLY] Weekly window calibration

- **Problem:** monitoring is currently calibrated on 5h windows, but Anthropic's real reset is weekly. Two days of intensive use can burn through the weekly cap even if every 5h window stays under 95%.
- **Tasks:**
  1. Rewrite projection in `compute_metrics.py` with weekly base
  2. Sentinel UI shows weekly usage + breakdown per 5h window
  3. Target 95% weekly instead of 95% per window
  4. Test on a full weekly session with Claude Max + Kimi

##### ⏰ [JHT-MONITORING-WORKHOURS] User-defined work hours

- **Problem:** team runs 24/7 once started — wasting tokens during unproductive hours and burning the weekly budget.
- **Tasks:**
  1. UI in `/team` to define hour slots (e.g., 09:00–13:00 + 14:00–18:00 weekday)
  2. Captain respects the slots: idle outside, active inside
  3. Sentinel aligns usage projection to actual slots (no 24/7 projection)
  4. "Team as employee" model — works on user-defined office hours

##### 🌙 [JHT-KIMI-OPTIMIZE] Kimi €40 mass-market calibration

- **Problem:** Kimi projection oscillation is ±10–15% (vs Claude ±5%). Current target is 85% (15% safety buffer = wasted capacity).
- **Tasks:**
  1. Analyze Kimi response-size distribution
  2. Adapt projection model for higher variance
  3. Final target: 90%+ with <10% oscillation (= Claude equivalent)
  4. Stress test: 1 month of real job-hunting
- **Benefit:** if it holds → JHT becomes accessible to anyone for €40/month (vs €200 Claude Max). "Mass-market jackpot" — see `docs/about/PROVIDERS.md` and `docs/about/MONITORING.md`.

##### 💂 [JHT-SENTINELLA-OPTIMIZE] Reduce Sentinel token consumption

- **Problem:** Sentinel intervenes too often → eats too many tokens → with the €20 base tier nothing's left for the rest of the team. Bridge is excellent but Sentinel isn't truly "fallback only" yet.
- **Tasks:**
  1. Raise the intervention threshold (today it reacts to small drifts)
  2. Move more logic into the Bridge (deterministic, no LLM)
  3. Verify how much the 491→130 line refactor already reduced consumption (measure baseline vs post-refactor)
  4. Target: Sentinel consumes <5% of total team tokens

##### 🧪 [JHT-TEST-CAMPAIGN] Fill coverage matrix (8/10 cells) ⬜ BLOCKER pre-launch

- **Problem:** today's test claims are anecdotal (single profile, single provider). Public users will ask "does it work for *my* setup?" — we need data.
- **Coverage tracker:** [`docs/guides/BETA.md` § Coverage we still need](docs/guides/BETA.md#coverage-we-still-need) — 10 cells (provider × persona), 1 done (maintainer), 9 open. Target: 8/10 filled before launch.
- **Pipeline:** beta tester applies via [`docs/guides/BETA.md`](docs/guides/BETA.md) → self-assigns to a cell → runs JHT 2+ weeks → submits results PR adding a row to [`docs/about/RESULTS.md`](docs/about/RESULTS.md) and updating cell status in BETA.
- **Why:** highest-leverage milestone to publish before public launch. The first HN/Reddit question will be "does it work for X?".
- **Priority:** 🔴 BLOCKER pre-launch

##### 📊 [JHT-FRONTEND-DASHBOARD-AUDIT] Audit residual mock data in dashboard

- **Problem:** dashboard queries Supabase ✅ (in production), but some widgets may still use mock data.
- **Task:** audit `web/app/(protected)/dashboard/` component by component, identify and wire residual mocks.

##### 🚀 [JHT-VPS-VALIDATE] Validate end-to-end setup on a real VPS ⬜ pre-launch

- **Problem:** the VPS / cloud rental mode is our ⭐ target setup (see Vision), but we've never actually deployed JHT on a real VPS end-to-end. Today the recommended setup is unvalidated.
- **Task:**
  1. Pick one provider (Hetzner CX22 €4.5/mo is the easiest start)
  2. Provision manually, run the install one-liner: `curl https://jobhunterteam.ai/install.sh | bash`
  3. Configure provider subscription + start the team
  4. Verify: container starts, agents come up, web dashboard reachable (via SSH tunnel or public IP), Telegram works, monitoring stays in window
  5. Document gotchas, edge cases, missing dependencies, in `docs/VPS-SETUP.md` (new doc)
- **Why:** until we've actually run this end-to-end, recommending VPS as the target setup is theoretical. Also: this validates that the install script + container + provider auth all work outside the maintainer's local PC.
- **Output:** working VPS deploy + `docs/VPS-SETUP.md` with step-by-step guide
- **Bonus:** adds 1 cell to the test campaign matrix (provider × tier × persona, but on VPS instead of local)

#### 🟡 MEDIUM PRIORITY

##### 🐍 [JHT-BACKEND-01] `db_supabase.py` — push agent results to cloud

- **Context:** Scout, Analyst, Scorer, Writer write only to local SQLite. Results aren't visible from the phone.
- **Task:** create `shared/skills/db_supabase.py` wrapper with the same functions as `db_insert.py` / `db_update.py` / `db_query.py`, multi-tenant via `user_id`.
- Linked to JHT-ONBOARDING-04.

##### 📤 [JHT-ONBOARDING-04] Periodic agent results push

- **Dependency:** JHT-BACKEND-01
- Batch push after each agent run (positions, scores, applications) to Supabase.
- Write-only: cloud is read-only mirror.

##### 🧪 [JHT-QA-01] Web E2E (Playwright) ✅ DONE — 75+ specs in `e2e/tests/`

- ✅ Auth, dashboard, profile, applications, positions, full-flow, missing pages, data consistency
- ✅ Onboarding flow, i18n, screenshot reports, regression smoke, content guard
- ✅ Security headers, accessibility ARIA, SEO meta, performance (TTFB, payload)
- ✅ Mobile nav, responsive, PWA i18n, theme
- ✅ FAQ, pricing, privacy, demo page, changelog, sitemap
- ⬜ **Maintenance:** keep specs green as features evolve. CI workflow already runs them on push.

##### 🦞 [JHT-AI-AGENT-EXAMPLES] Example prompts for OpenClaw / Cursor ⬜

- **Context:** `docs/guides/AI-AGENT-INTEGRATION.md` mentions 🦞 OpenClaw, Claude Code, Codex, Cursor — but no `examples/` directory exists yet.
- **Task:** create `examples/ai-agent-prompts/` directory with tested prompts for each agent CLI (4 subdirs: `claude-code/`, `openclaw/`, `codex/`, `cursor/`).

##### 🔐 [JHT-WEB-02-CHECKSUM] SHA256 checksum on download page

- **Why MEDIUM (was LOW):** trust signal pre-launch — paranoid users (rightly) verify checksums before installing
- **Task:** add SHA256 under each download button on `/download` page

##### ❓ [JHT-DOCS-FAQ] FAQ "why not LangChain/AutoGen/CrewAI?"

- **Why MEDIUM (was LOW):** first question on HN/Reddit. Missing explicit positioning blocks credibility.
- **Task:** FAQ section in README or new `docs/FAQ.md`. Cover: positioning vs LangChain/AutoGen/CrewAI, why subscription not API, why local-first not SaaS, what "AI on the side of workers" means.

##### 🧙‍♂️ [JHT-MAESTRO-SKILLS] Add Maestro-specific skills if testing reveals the need

- **Context:** `agents/maestro/maestro.md` was rewritten as a real prompt (Gandalf-the-grey voice, pattern-detection focus). For now the Maestro relies only on the global `db-query` skill — no Maestro-specific skills under `agents/maestro/_skills/`.
- **When to revisit:** during the first round of real-world testing of the Maestro. If pattern-detection logic becomes repetitive in the prompt or hard to reason about in plain English, peel it out into Agent-Skills format.
- **Candidate skills (do NOT pre-create):** `pattern-skill-gaps`, `pattern-exclusions`, `pattern-near-fits`, `pattern-feedback`, `pattern-reviews`, `weekly-digest`, `market-research`. Each maps 1-1 with a section already in the prompt.
- **Acceptance:** add a skill only when a test session shows the prompt is failing to apply the pattern correctly because the procedure is too vague to execute consistently.

##### 🔗 [JHT-SKILLS-SYMLINK-TEST] Test if symlinks work for skill discovery on Linux containers

- **Context:** the new launcher copies skills with `cp -R` from `agents/_skills/` into each agent's runtime workspace (`.claude/skills/` + `.agents/skills/`). Copies are explicit and reliable but cost a few hundred KB of duplicated bytes per spawn and force a launcher pass on every skill update.
- **Task:** in a controlled run, swap `cp -R` for `ln -sfn` in `start-agent.sh` and verify Claude Code, Codex, and Kimi all still discover the skill (i.e. a skill folder reachable via a symlinked dir is read the same way as a real dir). The Anthropic docs do not explicitly confirm symlink behaviour — empirical test only.
- **Acceptance:** if symlinks work for all three CLIs in the JHT container, switch the launcher over and document the choice in `agents/_skills/README.md`.
- **Caveat:** keep the copy-based path as a fallback for Windows/WSL setups where symlink permissions are inconsistent.

##### 📚 [JHT-SKILLS-CODEX-KIMI-DISCOVERY] Verify skill-discovery convention in Codex / Kimi docs

- **Context:** the launcher populates both `.claude/skills/` (Claude Code convention) and `.agents/skills/` (assumed for Codex/Kimi) in each agent's workspace. The `.agents/skills/` path is the project's existing convention but it has not been independently confirmed against the Codex CLI docs and the Kimi (Moonshot) `kimi-cli` docs.
- **Task:** check the official documentation for both CLIs, confirm or correct the path used, and if the convention diverges across CLIs make sure the launcher writes whatever each CLI expects.
- **Acceptance:** path assumptions in `start-agent.sh` cite the relevant doc URL.

##### 🤖 [JHT-AGENT-PROMPTS-V2] Deep validation of the 9 agent prompts (section by section)

- **Context:** the V5-alignment pass on 2026-04-30 (`de7774bd`) was a global sweep — drop V4 leftovers, migrate to `jht-tmux-send`, refresh the TEAM table. After that, two prompts were rewritten in depth: Maestro as Gandalf-the-grey (`b61c3e70`) and Critico translated to English with `jht-tmux-send` wired (`47ac5c17`). Sentinella is already mostly EN-clean. The remaining six prompts still carry Italian sections, mixed formatting, and ad-hoc rules that should reference the new `agents/_team/team-rules.md` baseline.
- **Method:** one agent at a time, one section at a time. Show the raw section, propose the edit, leave protocol tokens verbatim (`STEADY`, `ATTENZIONE`, `EMERGENZA`, `MANTIENI`, `SCALA UP`, `RALLENTARE`, `ACCELERARE`, `RECOVERY TRACKING`, `PUSH G-SPOT`, `RIENTRO`, `RESET SESSIONE`, `PAUSA TEAM`, `HARD FREEZE`, `RIPRENDI`) — they are parsed by the Captain by pattern. Validate AVAILABLE TOOLS against `skills.list`. Wire the team-rules header line at the top of each RULES section.
- **Order (least → most central):** ① Sentinella · ② Assistente · ③ Scout · ④ Analista · ⑤ Scorer · ⑥ Scrittore · ⑦ Capitano (heaviest, 647 lines, last for cross-coherence check).
- **Linked task:** [JHT-DB-ANALISTA-FIX] (the Analista review must also fix REGOLA-08 to populate `companies` + `position_highlights`).

##### 🗄️ [JHT-DB-CLEANUP] Schema hygiene + path/naming cleanup of `~/.jht`

Found while mapping the runtime filesystem of the JHT container. Schema is sane; agents are instructed inconsistently and naming has drifted. Subtasks:

- **[JHT-DB-RENAME]** Rename `~/.jht/jobs.db` → `~/.jht/db/jht.db`. Move `~/.jht/data/scout_coordination.db` next to it (or absorb — see SCOUT-COORD). Update `.launcher/config.sh:14`, `shared/skills/_db.py` resolver, `check_links.py`, `scout_coord.py`, `rate_sentinel.py`, `agents/_team/team-rules.md`, `agents/_manual/db-schema.md`, plus comments/docstrings in `db_*.py`. Migration: move existing file at boot if not present at the new path.
- **[JHT-DB-ANALISTA-FIX]** Currently `agents/analista/analista.md` REGOLA-08 says "MAI toccare `companies`, `scores`, `applications`". Result: `companies` table has 0 rows out of 105 positions analyzed — duplicate company names as text in `positions.company`. Skill `agents/_skills/db-insert/SKILL.md` correctly says "Analyst for companies and highlights" but the prompt contradicts it. Fix prompt: Analista IS the agent that INSERTs into `companies` (anagrafica) and `position_highlights` (red flags + perks notabili) on first encounter; on subsequent encounters UPDATEs. Coordinate with [JHT-AGENT-PROMPTS-V2] step ④.
- **[JHT-DB-STATUS-CHECK]** Add CHECK constraints on `positions.status` and `applications.status`. Today they are open `TEXT` — agents can write "OK", "Done", anything. Canonical enum: `positions.status IN ('new','checked','excluded','scored','written','applied','interview','rejected','offer')`; `applications.status IN ('draft','reviewed','sent','responded','rejected','interview','offer','withdrawn')`. Migration via ALTER + CHECK. Fail-fast at insert/update time instead of silent data drift weeks later.
- **[JHT-DB-FK-PRAGMA]** Verify `PRAGMA foreign_keys = ON` is executed by `shared/skills/_db.py` on every `connect()`. SQLite default is OFF — without it, FK constraints declared in CREATE TABLE are dichiarate but not enforced; orphaned `position_id` values can be inserted silently.
- **[JHT-DB-TIMESTAMPS]** Add uniform `created_at`/`updated_at` to all 5 tables with `DEFAULT CURRENT_TIMESTAMP` and an `AFTER UPDATE` trigger on `updated_at`. Keep domain `*_at` fields (`scored_at`, `applied_at`, …) for event semantics. Helps audit ("which row changed last").
- **[JHT-DB-SCOUT-COORD]** Consolidate `~/.jht/data/scout_coordination.db` (20K, separate file) into the main DB as a table. Verify if it is separate for real reasons (lock contention, isolation) or by accident; if it can rejoin → migration + UPDATE skills that read it. If it cannot → document why in `db-schema.md`.

##### 📁 [JHT-HOME-REFACTOR] Clean up `~/.jht` runtime filesystem

`~/.jht` (= `/jht_home` in the container) has accumulated chaos: deliverables in 7 different paths, leftover dirs, per-agent Python venvs, drifted config files. Top-level audit on 2026-05-01: 73 MB in `agents/`, deliverables in `agents/scrittore-1/cv_output`, `agents/scrittore-1/output`, `agents/scrittore-2/cvs`, `agents/scrittore-2/output`, `agents/scrittore-3/output`, `~/.jht/output/scrittore-3/`, plus the user-facing `~/Documents/Job Hunter Team/cv/`. The user does not know where to look. Subtasks:

- ✅ **[JHT-HOME-OUTPUT-UNIFY]** *Done 2026-05-02 (commits `de615c82` + follow-up).* CV/PDF deliverables → `$JHT_USER_DIR/cv/`, Critico reviews → `$JHT_USER_DIR/critiche/`, Cover letters → `$JHT_USER_DIR/allegati/`, per-position packets → `$JHT_USER_DIR/output/<scrittore>/`. Prompts updated (Scrittore REGOLA-13, Critico RULE-05, team-wide RULE-T11). Launcher now creates `critiche/` too. Migrated 156 legacy files (55 CV + 90 critiche + 11 per-position dirs) via one-shot `scripts/migrate-deliverables-to-user-dir.sh` (idempotent, no-overwrite). Residual scratch left in `~/.jht/agents/scrittore-1/cv_output/` (jd_*.txt) — will be removed when [JHT-HOME-PDF-CONSOLIDATE] retires the per-company PDF scripts.
- 🔜 **[JHT-HOME-PDF-CONSOLIDATE]** ⬅ next-up after OUTPUT-UNIFY. `agents/scrittore-1/` ships 4 Python scripts: `generate_cv_pdf.py`, `generate_cv_pdf_qualio.py`, `generate_cv_pdf_satelligence.py`, `md_to_pdf.py` — one per company. Anti-pattern. Consolidate in 1 parametrized skill under `/app/shared/skills/cv-pdf-gen/` (or `agents/_skills/cv-pdf-gen/`) with a `--company` flag. Cleanup `.venv/` and `.venv_uv/` after consolidation if unused. Retiring this also lets us drop the leftover `cv_output/` scratch dir (still ~70 MB of `.venv*` + 7 jd_*.txt left from the OUTPUT-UNIFY migration).
- **[JHT-HOME-FONTS-SHARED]** `agents/scrittore-1/fonts/` is private. Other Scrittori do not have it. Move to `/app/shared/fonts/` (read-only, baked into image) or `~/.jht/shared/fonts/` if user-modifiable. Update path in PDF generators.
- **[JHT-HOME-IDENTITY-CLEANUP]** `agents/capitano/` has both `CLAUDE.md` (Apr 26, old claude provider) and `AGENTS.md` (Apr 30, current kimi provider). On provider switch the inactive file becomes stale and may confuse readers. `start-agent.sh` should remove the other-provider file when writing its own.
- **[JHT-HOME-CONFIG-GROUP]** 5 config files at the top of `~/.jht/`: `jht.config.json`, `preferences.json`, `cloud.json`, `i18n-prefs.json`, `.claude.json`. Move the first 4 into `~/.jht/config/` (leave `.claude.json` alone — the claude CLI looks for it at `$HOME`). Update readers in `cli/`, `web/`, `tui/`, agents.
- **[JHT-HOME-LEFTOVERS]** Cleanup empty leftover dirs. `~/.jht/credentials/` (empty since Apr 10), `~/.jht/.config/` (only matplotlib settings). Remove from launcher if no longer created by anyone, or document their purpose.
- 🟡 **[JHT-HOME-CACHE-PRUNE]** Recurring cache hygiene under `~/.jht/.cache/` + `~/.jht/.codex/logs_2.sqlite`. *Audit 2026-05-02:* `.cache/` was 1.3 GB — `ms-playwright/` 928M (cause: no `PLAYWRIGHT_BROWSERS_PATH`, full Chromium downloaded but never used) + `uv/` 364M (no prune) + tiny matplotlib/claude-cli. Codex SQLite logs were 223M (108K rows, 71% TRACE — Codex's internal 10-day retention only runs when the CLI is active, so idle installs accumulate). *Already done 2026-05-02:* one-shot `rm chromium-1208/` + `uv cache prune` recovered 928M (commits `794e87f9`, `2efb4cce`); Dockerfile now pins `PLAYWRIGHT_BROWSERS_PATH=/opt/playwright` and pre-installs only `--only-shell chromium`; `jht cache prune` extended to also DELETE+VACUUM `~/.jht/.codex/logs_2.sqlite` when >50 MB AND mtime-idle >1h, with the Captain instructed to run it ~daily. *Still open:* (a) after the next image rebuild, manually `rm -rf ~/.jht/.cache/ms-playwright/{chromium_headless_shell-1208,ffmpeg-1011}` (~326M leftover from before the Dockerfile fix); (b) watch `.cache/claude-cli-nodejs/` — currently 1.9M but grows linearly with the number of distinct agent cwds spawned over the system's lifetime; (c) decide whether to extend `cache prune` to also handle `npm cache verify` (331M in `.npm/_cacache`).

#### 🟢 LOW PRIORITY

##### 🐳 [JHT-DESKTOP-07] Container `next start` instead of `next dev`

- **File:** `cli/src/commands/dashboard.js`
- **Benefit:** −350MB RAM, no useless watcher, no on-demand compile on first page hit.
- **Task:** Dockerfile `RUN npm --prefix web run build`; in `dashboard.js` if `isContainer()` spawn `next start -p 3000 -H 0.0.0.0`. Keep `next dev` behind `--dev` flag.

---

### 2️⃣ PHASE 2 — 🖥️ Desktop Launcher

#### 🖥️ [JHT-DESKTOP-01-04] Scaffolding + Wizard + Lifecycle + Payload — STATUS

- ✅ Electron scaffolding (`desktop/`)
- ✅ First-run setup wizard (language, profile, provider, credentials)
- ✅ Lifecycle manager (start/stop/status/log + browser auto-open on localhost)
- ✅ Prebuilt payload (no `npm install` or `next build` on user PC)
- ✅ Lazy install of Docker container (handles Node/Python deps inside the container)
- ⬜ **Tray icon** with team status (green/yellow/red) — *nice-to-have*
- ⬜ **Native desktop notifications** (position found, application ready, error) — *medium value, low effort*
- ⬜ **Bundled Node.js** in payload — *may be obsolete now that Docker handles runtime; verify before scheduling*
- ⬜ **Embedded Python** or system-detected — *same: likely obsolete via Docker, verify*
- ⬜ Initial install progress bar

#### 📦 [JHT-DESKTOP-05] Cross-platform installer + auto-update

- ✅ Build `.dmg` / `.exe` NSIS / `.AppImage` / `.deb` via electron-builder
- ✅ Release via GitHub Releases
- ⬜ **Auto-update** via `electron-updater`
- ⏸️ **Code signing** macOS + Windows — **deferred (post-beta)**. Costs (~€99/yr macOS, ~€200-400/yr Win EV cert) are not justified during beta. Our trust signal in beta is **open source transparency + community review** — users can inspect the code or build from source. We'll document the OS warning workaround in `docs/guides/quickstart.md` (right-click → Open on macOS, "Run anyway" on Windows) and explain the positioning honestly. Schedule code signing once the project graduates from beta.

#### 🏠 [JHT-DESKTOP-06] "Dedicated computer" mode

- SSH-based JHT setup on another PC on local network
- Automatic discovery via mDNS/Bonjour or manual IP
- Dashboard shows remote team in real time
- **Why this matters:** many users have a second PC sitting unused (old laptop, mini-PC, spare desktop) — JHT doesn't need a powerful machine, just one that stays plugged in. Cheaper than VPS for users who already own the hardware.

---

### 3️⃣ PHASE 3 — ☁️ Multi-Provider Cloud Provisioning (future, post-1.0)

> 🌉 **Bridge to today**: until this phase ships, users running on a VPS use the manual path documented in `docs/VPS-SETUP.md` (output of [JHT-VPS-VALIDATE] in PHASE 1). PHASE 3 turns that manual SSH dance into a one-click experience inside the desktop launcher.

**Implementation order**: 01 (abstraction) → 04 (🇪🇺 Hetzner first — cheapest, EU GDPR, simplest API) → 05 (UI) → 06 (tunnel) → 02/03 (AWS/GCP last — bigger surface, more docs).

#### 🏗️ [JHT-CLOUD-01] Provisioning abstraction layer

- `shared/cloud/` with `CloudProvider` interface (provision/deploy/status/destroy/ssh)
- All adapters below implement this interface

#### 🇪🇺 [JHT-CLOUD-04] Hetzner Cloud adapter ⭐ first adapter

- Hetzner API for server provisioning, EU-only GDPR option (~€4-5/month CX22)
- **Why first**: cheapest, simplest API, EU compliance out of the box, target user base

#### 🎛️ [JHT-CLOUD-05] Cloud UI in desktop app

- **Depends on**: at least 1 adapter (CLOUD-04)
- "Choose where the team runs", cloud credentials input, real-time cost estimate, one-click deploy/teardown, billing alerts

#### 🔒 [JHT-CLOUD-06] Secure app ↔ cloud tunnel

- Local dashboard shows remote team data
- **Easier alternatives to consider**: Tailscale (zero-config mesh VPN, free tier) or WireGuard (lightweight) — likely better than rolling our own SSH tunnel

#### 🌩️ [JHT-CLOUD-02] AWS EC2 adapter

- EC2 t3.small provisioning + security group + user data script
- **Why later**: bigger surface, more docs, less price-competitive than Hetzner for small instances

#### ☁️ [JHT-CLOUD-03] Google Cloud (GCE) adapter

- Compute Engine + firewall rules + startup script
- **Why last**: same reasoning as AWS, smaller user overlap with our target audience

---

### 4️⃣ PHASE 4 — 🌍 Internationalization

#### 🌍 [JHT-I18N-01] English as primary language ✅ COMPLETED

- ✅ README + 8 new docs all in English
- ✅ Web app i18n supports en/it
- ✅ Desktop wizard language picker (en/it, default en, shown once at onboarding)

#### 🌍 [JHT-I18N-02] Infrastructure for additional languages — partial

- ✅ Per-language JSON files in `web/messages/` (today: `en.json`, `hu.json` — Hungarian already partially translated)
- ⬜ Refactor `shared/i18n/translations.ts` to load per-language files (today inline)
- ⬜ **Fix mismatch**: `shared/i18n/types.ts` has `DEFAULT_LOCALE = 'it'` but desktop wizard defaults to `'en'` — align both to `en` per memory `feedback_lang_picker_default_english`
- ⬜ Language switcher in web dashboard (desktop launcher already has one)

#### 🌍 [JHT-I18N-03] Future language expansion

- ✅ Hungarian (`hu.json`) — partial, community contribution
- ⬜ Priority next: Spanish, German, French, Portuguese
- ⬜ Translator-facing documentation for community contributions (how to add a new language)

---

### 5️⃣ PHASE 5 — 🌐 Public Website

#### 🌐 [JHT-WEB-01] Landing page ✅ COMPLETED

- Live on `jobhunterteam.ai`

#### ⬇️ [JHT-WEB-02] Download page ✅ PARTIAL

- ✅ OS detection
- ✅ OS-correct main button + alternatives
- ⬜ SHA256 checksum — tracked as [JHT-WEB-02-CHECKSUM] in PHASE 1 MEDIUM

#### 📚 [JHT-WEB-03] User documentation ✅ PARTIAL

- ✅ Quickstart + Story + Providers + AI-Agent Integration + Vision + Beta + Results + Monitoring (8 docs)
- ⬜ **Launcher screenshots** — *soft BLOCKER pre-launch, improves quickstart credibility*
- ⬜ **Visual FAQ** — common error states, install warnings, what each agent does
- ⬜ **Video tutorial series** — multiple short walkthroughs (2-5 min each), NOT one long video. Examples:
  - "Install JHT in 5 minutes"
  - "Configure your profile with the Assistant"
  - "Read your first results dashboard"
  - "Adjust the team's working hours"
  - "Switch provider (Claude → Kimi)"
  - *Distinct scope from [JHT-LAUNCH-03] which is a 30s pipeline demo for HN/launch*

#### 🌐 [JHT-WEB-04] Domain + DNS ✅ COMPLETED

- `jobhunterteam.ai` live, Supabase Auth configured, redirect URL ok

---

### 6️⃣ PHASE 6 — 🚢 Pre-Launch Public OSS (NEW)

Goal: get JHT ready for Show HN, Product Hunt, Reddit, awesome-lists.

> **Cross-reference**: 🧪 [JHT-TEST-CAMPAIGN] in PHASE 1 is also a launch BLOCKER (coverage matrix in [`docs/guides/BETA.md`](docs/guides/BETA.md#coverage-we-still-need)). Treat it as part of this phase mentally.

**🚦 Suggested execution order** (BLOCKERs first, then rest in parallel):

1. ✅ SECURITY.md + CODE_OF_CONDUCT.md (done — root, EN, Contributor Covenant 2.1)
2. ✅ Security review (done — 33/35 task chiusi, see `docs/security/`)
3. Test campaign matrix (parallel with reviews — slowest cell determines launch date)
4. Demo video (after monitoring is frozen)
5. Beta tester recruitment + Show HN draft + Press kit + Awesome lists submissions

---

#### 🔐 [JHT-LAUNCH-01] SECURITY.md ✅ DONE

- ✅ Responsible disclosure + contact email (`leopu00@gmail.com`)
- ✅ Standard GitHub `SECURITY.md` format at root, EN, condensed from `docs/security/04-threat-model.md`

#### 🤝 [JHT-LAUNCH-02] CODE_OF_CONDUCT.md ✅ DONE

- ✅ Contributor Covenant 2.1 standard at root, contact `leopu00@gmail.com`
- ✅ `.github/CONTRIBUTING.md` updated to link the new CoC

#### 🎬 [JHT-LAUNCH-03] 30s demo video ⬜ BLOCKER

- Asciinema or screencast full pipeline
- Embed in README above the fold

#### 🛡️ [JHT-LAUNCH-04] Security review (gitleaks + audit) ✅

- **Done 2026-04-27** — hardening sprint dev-1..dev-4 in parallelo, 33/35 task chiusi in `master` (sha `7a2cb6ae`), security score 30% → 74%.
- **Output:** `docs/security/` (7 file, ~2336 righe) — pre-launch review, OpenClaw comparison, threat model, checklist, post-fix snapshot.
- **Phase 1 bloccanti pre-launch:** 9/9 ✅ (C1-C5, H1, H2, H8, H9). **Phase 2 post-launch:** 12/12 ✅. **Phase 3 hardening:** 10/13 🟡.
- **Gap residui (continuous hardening, non blocker):** suite `tests/security/` regression + comando `jht doctor security`. Tutti i blocker per il public release sono chiusi: SSRF dispatcher (4 commit, integrato a webhooks + gateway), L1 CSP nonce-based (cda78a17), `resolve-system-bin` deferito con razionale.
- **Tooling integrato:** detect-secrets, actionlint, zizmor, npm-audit-prod (pre-commit hooks), Dependabot Docker weekly, Docker base image pinned a SHA256.

#### 🧊 [JHT-LAUNCH-05] Stabilize monitoring architecture

- **Why:** V3→V4→V5 in 2 weeks = churn. Before launch we need 1-2 weeks of freeze, otherwise we'll show up on HN with users opening issues on V5 while we're already on V6.
- **Task:** freeze monitoring, fix only critical bugs, no refactor before launch.

#### 🧪 [JHT-LAUNCH-07] Beta tester recruitment

- ✅ `docs/guides/BETA.md` created
- ⬜ Publish on 1-2 communities (r/cscareerquestions, r/ItalyJobs, friends list)
- Feeds the coverage matrix in [`docs/guides/BETA.md`](docs/guides/BETA.md#coverage-we-still-need) ([JHT-TEST-CAMPAIGN] in PHASE 1)

#### ⭐ [JHT-LAUNCH-06] Awesome lists submissions

- PRs to `awesome-ai-agents`, `awesome-claude`, `awesome-selfhosted`
- Create JHT entry with repo link + 1-line description

#### 🐛 [JHT-LAUNCH-08] GitHub issue triage workflow ⬜

- **Why:** the first week post-launch will bring a wave of issues — install problems, edge cases, "doesn't work for me" reports. Without a triage workflow we drown.
- **Task:**
  1. Issue templates already exist (`.github/ISSUE_TEMPLATE/{bug_report,feature_request}.md`) — verify they ask the right questions
  2. Define labels: `installer`, `monitoring`, `provider:claude`, `provider:kimi`, `provider:codex`, `desktop`, `web`, `cli`, `docs`, `triage`, `wontfix`
  3. Set up GitHub project board (kanban: triage → confirmed → in-progress → done)
  4. Document SLA expectations in `CONTRIBUTING.md` ("we aim to triage within 48h, no fix SLA in beta")

#### 📰 [JHT-LAUNCH-09] Show HN post draft ⬜

- **Title** (60 char max): test multiple variants
- **Body**: lead with the manifesto + numbers (200/20/5) + screenshots/GIF + link to STORY.md
- **Tone**: dev-to-dev, not marketing
- **Timing**: Tuesday-Wednesday morning UTC (best HN engagement window)
- **Plan B**: if HN doesn't pick up → fall back to r/LocalLLaMA + r/ClaudeAI + r/selfhosted

#### 🎙️ [JHT-LAUNCH-10] Press kit ⬜

- **Assets:**
  - Logo (svg + png in 3 sizes)
  - 5+ screenshots (orgchart, dashboard, web team page, terminal, profile)
  - 30s demo video (from LAUNCH-03)
  - 1-paragraph description (3 length variants: 30 words / 100 words / 300 words)
  - Project facts sheet (license, language, lines of code, contributor count)
- **Location:** `/press` page on `jobhunterteam.ai` + `assets/press-kit/` in repo

---

## 🔧 CLI ↔ CONTAINER COORDINATION ✅ COMPLETED (post 04-22)

All 5 tasks from 04-22 have been implemented:

- ✅ `jht team stop|start|status` — container proxy via `docker exec` + `tmux` (`cli/src/commands/team.js`)
- ✅ `jht container up|down|recreate|logs|status` — `docker compose` wrapper (`cli/src/commands/container.js`)
- ✅ `jht sentinella status|tail|graph` — JSONL reader + sparkline (`cli/src/commands/sentinella.js`)
- ✅ `jht web open|restart|logs` — integrated in `dashboard.js`
- ✅ Host ↔ container consistency — single source of truth in container, host acts as proxy

---

## 🐛 KNOWN BUGS

No open bugs at the time of this writing. Historical fixes are tracked in git log + commit messages (see `git log --grep "fix(" --since="2026-04-01"` for recent fixes), and in [`CHANGELOG.md`](CHANGELOG.md) once entries are migrated there.

---

## 📞 Maintainer reference

Operational info (Supabase access, Vercel env vars, OAuth setup, security review status, contact) lives in [`docs/internal/MAINTAINERS.md`](docs/internal/MAINTAINERS.md).
