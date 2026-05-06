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

##### 💂 [JHT-SENTINELLA-OPTIMIZE] Reduce Sentinel token consumption — partially addressed by V6 (2026-05-01)

- **Problem:** Sentinel intervenes too often → eats too many tokens → with the €20 base tier nothing's left for the rest of the team. Bridge is excellent but Sentinel isn't truly "fallback only" yet.
- **Status update 2026-05-01:** bridge V6 ships with state machine (`DEFAULT 3min / GSPOT_FAST 2min / GSPOT_STABLE 5min / GSPOT_CALM 10min`), g-spot 80-105 %, Sentinella cooldown 15 min. Self-induced loop closed. Observed in production: projection mean **91 %** (target 92.5 %), Sentinella now wakes ~1× every 15 min during critical windows instead of every minute. Bridge state is exposed via atomic JSON file (`sentinel-bridge-state.json`) read by the web API → no more drift between Python logic and TS replica.
- **Residual tasks:**
  1. Raise the intervention threshold (today it reacts to small drifts) — partly done by V6
  2. Move more logic into the Bridge (deterministic, no LLM) — partly done; finish with V7 (see [JHT-BRIDGE-V7] below)
  3. Verify how much the 491→130 line refactor already reduced consumption (measure baseline vs post-refactor) — token-meter PoC now provides this measurement
  4. Target: Sentinel consumes <5% of total team tokens — current observed share ~3 % (44.7 kT / 1356 kT in 46 min)

##### 🌉 [JHT-BRIDGE-V7] Bridge V7 — token-based monitoring + per-agent throttle (NEW 2026-05-01)

- **Background:** session of 2026-05-01 reworked the bridge V5 → V6 (loop fix) and prototyped a token-based monitoring layer reading the local CLI logs (`~/.kimi/sessions/*/wire.jsonl`, `~/.claude/projects/*/*.jsonl`, `~/.codex/sessions/*/rollout-*.jsonl`). Full context and numbers in `docs/internal/2026-05-01-bridge-and-token-monitoring.md`.
- **Discovery:** the CLI subscription logs already contain weighted token counts per response, fresher than the provider /usage endpoint. Empirical calibration on Kimi K2 Plan: 1 % rate budget ≈ 30 kT weighted. Per-agent attribution works via `state.json.custom_title` regex (Kimi) or path naming (Claude / Codex).
- **Observed asymmetry:** in 46 min of work the Scout consumed 1083 kT vs 125 kT for the Capitano (7×). Today the throttle is global ("everyone +30s pause"); the right move is per-agent.
- **Tier 2 — quick wins (1-2 h, deferred to a quiet moment):**
  - Token-meter `WINDOW = since reset_at` instead of fixed 5 h (current cumulative ratio is inflated)
  - Promote token-meter to a persistent service (singleton + autorestart) alongside the bridge
  - Bridge state file V7 exposes `per_agent_rate` (kT/min, 60 s rolling)
- **Tier 3 — dedicated session (~1 day):**
  - `throttle-controller.py`: deterministic (no LLM), reads state every 30 s, computes `error = actual - target_per_agent`, emits `[THROTTLE @<agent> ±Ns]` to the Capitano
  - Capitano forwards to agents; agents honour the delta in their loop sleep
  - Initial allocation: Scout 60 % / Critico 15 % / Capitano 15 % / Sentinella 10 %; refit on 24 h of real data
  - Anti-oscillation: dead-band ±10 %, max ±3 s change per 60 s, integral term for slow drift
- **Expected gain:** projection stdev 20 % → ~5 %, in-target 68 % → ~95 %. Sentinella becomes interrupt-driven (only strategic decisions: freeze, switch provider, scheduled pauses).
- **Architectural payoff:** the same V6 / V7 architecture scales to weekly windows ([JHT-MONITORING-WEEKLY]) just by changing thresholds.

##### 🚀 [JHT-BRIDGE-V8] Auto-incentive — bridge accelerates underutilized teams (NEW 2026-05-02)

- **Background:** during the 2026-04-30/05-01 session, the team did NOT fully self-utilize the rate budget toward the end of the window. The user had to send 3 manual nudges (`controlla lo usage`, `non state sfruttando la FINESTRA AL MASSIMO`, `SPINGI AL MASSIMO SENZA SFORARE`) to push consumption from ~70% to ~84%.
- **Idea:** dual of the V6 cooldown. Today the bridge slows the team down; tomorrow it should also speed them up if it sees budget unused near reset.
- **Trigger:** `proj < 80% AND reset_window_remaining < 90min AND velocity < target × 0.7`
- **Action:** bridge sends `[BRIDGE NUDGE] proj 60%, reset in 1h — push harder` to the Capitano (1 message per cooldown_window, like the down-throttle direction).
- **Effort:** ~2 h after V7 is in place (reuses state machine + cooldown logic).
- **Effort guard:** must NOT loop — same cooldown discipline as V6 (15 min between nudges).

##### 📚 [JHT-LAUNCH-LOW-PROFILE] Public release strategy — low-profile founder model (NEW 2026-05-02)

- **Decision (2026-05-02):** repo will go public, but NOT immediately and NOT with high-profile founder posture. Target model: Bellard/Sysoev/Collet style (technical reputation, no media exposure).
- **Target outcomes:** 5-15k stars in 12-18 months, 130-150k€ remote job, no fame, privacy preserved. NOT 247k stars Steinberger style.
- **Timeline:** 6-8 weeks of prep before public launch.
- **What to do (sequencing):**
  - Week 1-2: VPS validate ([JHT-VPS-VALIDATE]) + repo cleanup + governance docs (LICENSE choice: AGPLv3 vs MIT, CONTRIBUTING aggressive, CoC).
  - Week 3: 1 long technical blog post (3000 words) on bridge V6 + token-meter — numbers and code, no personal storytelling. Test reception privately first.
  - Week 4-5: 5-10 invited beta testers (brother + friends + 3 strangers from focused forums). Iterate on feedback.
  - Week 6-7: press kit (no personal photo / video / voice — only product screenshots). Show HN draft with title testing.
  - Week 8: public release on chosen Tuesday/Wednesday 16:00 IT. Forums: HN once, lobste.rs, r/LocalLLaMA, awesome-llm-apps. NO Twitter/LinkedIn personal account, NO Reddit r/programming auto-promo.
- **Identity hygiene:**
  - Pseudonym: "Leone P." or "leopu" (no full name in public commits / READMEs)
  - No profile photos anywhere project-related
  - Project email via Fastmail/ProtonMail, not personal Gmail
  - Domain WHOIS protect
  - LLC anonymous (EE/MT, ~500€) for sponsor money + IP
  - No podcast appearances, no conference talks, only async written communication
- **Co-maintainer:** identify within 60 days post-launch (can be informal, just someone who triages issues — fratello / amico fidato).
- **Reasoning:** see `docs/internal/2026-05-01-bridge-and-token-monitoring.md` and conversation log of 2026-05-02. Founder profile mismatch with Steinberger model: target B confirmed (low fame + premium remote job).

##### 🧪 [JHT-TEST-CAMPAIGN] Fill coverage matrix (8/10 cells) ⬜ BLOCKER pre-launch

- **Problem:** today's test claims are anecdotal (single profile, single provider). Public users will ask "does it work for *my* setup?" — we need data.
- **Coverage tracker:** [`docs/guides/BETA.md` § Coverage we still need](docs/guides/BETA.md#coverage-we-still-need) — 10 cells (provider × persona), 1 done (maintainer), 9 open. Target: 8/10 filled before launch.
- **Pipeline:** beta tester applies via [`docs/guides/BETA.md`](docs/guides/BETA.md) → self-assigns to a cell → runs JHT 2+ weeks → submits results PR adding a row to [`docs/about/RESULTS.md`](docs/about/RESULTS.md) and updating cell status in BETA.
- **Why:** highest-leverage milestone to publish before public launch. The first HN/Reddit question will be "does it work for X?".
- **Priority:** 🔴 BLOCKER pre-launch

##### 📊 [JHT-FRONTEND-DASHBOARD-AUDIT] Audit residual mock data in dashboard

- **Problem:** dashboard queries Supabase ✅ (in production), but some widgets may still use mock data.
- **Task:** audit `web/app/(protected)/dashboard/` component by component, identify and wire residual mocks.

##### 🏗️ [JHT-INSTALL-SPLIT] Host/container split — wrapper bash + install.sh ridisegno ✅ partial DONE 2026-05-06

- **Why prerequisite of [JHT-VPS-VALIDATE]:** install.sh Docker-mode era architettonicamente rotto per VPS. Il wrapper effimero `docker run --rm <image> "$@"` infilava il CLI Node dentro un container che non vedeva il daemon Docker dell'host → `jht setup` ok, `jht team start` 💥. Anche se l'utente avesse risolto, `docker-compose.yml` non era baked nell'immagine e il path Docker non clonava il repo, quindi `jht container up` non aveva un compose da usare.
- **Design:** split in due ruoli del binario `jht`:
  - host-side: wrapper bash sottile (~165 righe) che fa `docker compose` + `docker exec`
  - container-side: il CLI Node attuale, raggiunto via `docker exec -it jht node /app/cli/bin/jht.js <args>`
- **Done 2026-05-06:**
  - Design doc completo: `docs/internal/2026-05-06-host-container-split.md`
  - `scripts/jht-wrapper.sh` (wrapper bash con auto-up, lifecycle, exec proxy)
  - `cli/src/utils/container-proxy.js` con branch IS_CONTAINER=1 (passthrough, retro-compat con il path "from source")
  - `docker-compose.yml` riscritto image-only + production-friendly (no `build:`, no bind sorgenti)
  - `docker-compose.dev.yml` nuovo override per dev workflow (build + bind hot-reload)
  - `scripts/install.sh` Docker-mode da 5 → 4 step: scarica wrapper + compose da raw.github invece di generare wrapper inline + docker pull eager
  - Aggiornati `docs/guides/quickstart.md`, `docs/guides/cli-install.md`
  - Validazione full-flow in WSL Ubuntu 22.04 con immagine GHCR del 27/4: `jht up` → `status` → `--help` → `team list` → `logs` → `down` tutto verde
- **Still open:** smoke test su VPS reale Hetzner — vedi [JHT-VPS-VALIDATE] sotto. Refactor cleanup di `cli/utils/container-proxy.js` (rimozione completa, oggi e' compat layer) deferito a post-launch — il passthrough basta per il design.

##### 🚀 [JHT-VPS-VALIDATE] Validate end-to-end setup on a real VPS ⬜ pre-launch — **tech-only / manual path**

- **Scope:** this task validates the **manual SSH + one-liner** path only (tier 🥉 tech-user). The friendly UX for non-tech users is a separate task: see [JHT-VPS-FRIENDLY] in PHASE 3.
- **Problem:** the VPS / cloud rental mode is our ⭐ target setup (see Vision), but we've never actually deployed JHT on a real VPS end-to-end. Today the recommended setup is unvalidated.
- **Prerequisite:** [JHT-INSTALL-SPLIT] (✅ done 2026-05-06) — il flow `curl install.sh | bash` ora funziona davvero per il path Docker (prima era rotto su `jht team start`).
- **Task:**
  1. Pick one provider (Hetzner CX22 €4.5/mo is the easiest start, CPX21 €5.5 if 2 GB are tight)
  2. Provision manually, run the install one-liner: `curl https://jobhunterteam.ai/install.sh | bash`
  3. `jht up` (lazy pull image + start container long-running)
  4. `jht setup` (configure profile + provider)
  5. `jht team start`
  6. Verify: container starts, agents come up, web dashboard reachable (via SSH tunnel or public IP), Telegram works, monitoring stays in window
  7. Document gotchas, edge cases, missing dependencies, in `docs/VPS-SETUP.md` (new doc)
- **Why:** until we've actually run this end-to-end on a real VPS (not WSL simulation), recommending VPS as the target setup is theoretical. Also: this validates that the install script + container + provider auth all work outside the maintainer's local PC.
- **Output:** working VPS deploy + `docs/VPS-SETUP.md` with step-by-step guide
- **Bonus:** adds 1 cell to the test campaign matrix (provider × tier × persona, but on VPS instead of local)
- **Design rationale:** see [`docs/internal/2026-05-04-vps-deployment-design.md`](docs/internal/2026-05-04-vps-deployment-design.md) — explains why the manual path stays as fallback for tech users while the desktop wizard becomes the default for non-tech. Implementation rationale: [`docs/internal/2026-05-06-host-container-split.md`](docs/internal/2026-05-06-host-container-split.md).

##### 🗺️ [JHT-VPS-COMPARISON-DOC] Honest decision tree: PC locale vs PC dedicato vs VPS

- **Problem:** today the user has no clear way to choose between the 3 execution modes. README hints but doesn't decide for them.
- **Task:** create `docs/guides/VPS-COMPARISON.md` with a decision tree:
  - "Hai un PC vecchio in casa?" → Mode 2 (PC dedicato)
  - "Vuoi pagare €5/mese e dimenticartene?" → Mode 3 (VPS), 30min setup guidato (Phase 3) o SSH manuale (oggi)
  - "Vuoi zero pensieri / setup?" → Mode 1 (PC locale, ma deve restare on)
- **Why:** without explicit positioning, non-tech users will try VPS, fail, and think JHT is broken. Honest framing > vague promises.
- **Linked:** [JHT-VPS-VALIDATE] (output `docs/VPS-SETUP.md`) feeds the "Mode 3 manual" branch; [JHT-VPS-FRIENDLY] feeds the "Mode 3 wizard" branch.

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
- ✅ **[JHT-DB-STATUS-CHECK]** *Done 2026-05-06.* CHECK su `positions.status` aggiunto in tutti e tre i punti di scrittura schema (`shared/skills/_db.py`, `web/lib/db.ts`, `tui/src/tui-profile.ts`). Enum allineato al doc canonico in `db-schema.md`: `('new','checked','scored','writing','ready','applied','response','excluded')` — non quello del backlog originale (`'written','interview','rejected','offer'`) che divergeva dal flow reale degli agenti. Migrazione retroattiva v2→v3 via `_migrate_v2_to_v3()` (CREATE+COPY+DROP+RENAME perché SQLite non supporta `ALTER TABLE ADD CHECK`); guard idempotente (cerca il marker preciso `CHECK(STATUSIN` per evitare falso-positivo su `last_checked`); user_version bumpato 2→3. **applications.status NON vincolato**: il doc canonico dice esplicitamente "il flag operativo è `applied` (BOOLEAN)" → CHECK sarebbe over-engineering. Smoke test: 8 status canonici accettati, 4 invalid (incluso `'Applied'` con maiuscola — la classe di bug principale) rigettati con `IntegrityError`. Idempotenza verificata.
- ✅ **[JHT-DB-FK-PRAGMA]** *Verificato 2026-05-06.* `PRAGMA foreign_keys = ON` è già su ogni `connect()`: `shared/skills/_db.py:34` (Python agents), `web/lib/db.ts:64` (read handle Next), `web/lib/db.ts:176` (`initDb`). Il client `cli/src/commands/cloud.js` apre in readonly tramite `node:sqlite` → FK constraints non si applicano in lettura, NA. Gli orphan position_id sono già bloccati al primo INSERT/UPDATE.
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
- 🟡 **[JHT-PY-TOOLS-CENTRALIZE]** Single shared Python user-base for ALL agent installs (RULE-T13). *Audit 2026-05-02:* `~/.jht/.local/lib/python3.11/site-packages/` was 412M with 5 concurrent PDF libraries (weasyprint, reportlab, fpdf, pymupdf, pdfminer/pdfplumber) installed by different writers in parallel; another ~70M of duplicated wheels in `agents/scrittore-1/.venv/` + `.venv_uv/`; system site-packages also dirty. Cause: passwordless sudo + `pip install` was the path of least resistance. *Done 2026-05-02:* sudoers tightened to a whitelist (`apt-get`, `apt`, `apt-cache`, `mkdir`, `chown`, `ln`) so `sudo pip` returns `command not allowed`; `ENV PYTHONUSERBASE=/jht_home/.local` baked into the image so `uv pip install --user` always lands in the shared magazzino; RULE-T13 added to `agents/_team/team-rules.md` and inherited by all 9 agent prompts. *Still open:* (a) one-shot migration when team is fully down — `rm -rf agents/scrittore-1/.venv*` + `find ~/.jht/.local -type d -name __pycache__ -exec rm -rf {} +` to recover ~90-100M; (b) `jht tools` subcommand mirroring `jht cache prune` — `list/outdated/dups` to make Python pkg state observable and let the Captain audit it weekly; (c) post-PDF-CONSOLIDATE, `pip uninstall` of the 4 unchosen PDF libraries (~70M).

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

#### 🚨 Launcher as primary tool — Phase 2 expansion (NEW 2026-05-04)

> Driven by VPS deployment design ([`docs/internal/2026-05-04-vps-deployment-design.md`](../docs/internal/2026-05-04-vps-deployment-design.md)). When VPS becomes the recommended setup for non-tech users, the desktop launcher stops being a "first-run wizard" and becomes the **primary daily tool**. These tasks close the gap between today's launcher (anonymous, single-PC, guest-mode-only) and what's needed for cross-device VPS operation.

##### 🔐 [JHT-DESKTOP-LOGIN] OAuth login flow in launcher

- **Why:** today the launcher is anonymous (no identity). VPS mode requires identity for cross-device recovery. Without login, user changing PC loses access to their VPS.
- **Task:**
  1. Login button in launcher → opens system browser to Supabase OAuth (Google/GitHub)
  2. Callback to `http://localhost:<random-port>/auth/callback` with PKCE flow
  3. Session token stored in OS keychain (macOS Keychain, Windows Credential Manager, Linux Secret Service)
  4. Two modes coexist: 🔓 **Guest** (today's behavior, local PC only) + 🔐 **Signed-in** (unlocks VPS, sync, multi-device)
- **Acceptance:** user clicks "Sign in", completes OAuth, session persists across launcher restarts, "Sign out" cleanly revokes.
- **Dependency:** must land before [JHT-VPS-FRIENDLY].

##### ☁️ [JHT-DESKTOP-SYNC] Encrypted cloud sync of config + VPS metadata

- **Why:** without cloud sync of essential metadata, cross-device recovery is impossible. But syncing master credentials (Hetzner token) is too risky — single point of failure if our cloud is breached.
- **Sync to cloud (Supabase, encrypted user-side with passphrase):**
  - Profile + preferences
  - VPS metadata: provider, IP, region, snapshot ID, tailnet name
  - Tailscale auth-key (encrypted blob)
- **NEVER sync to cloud (stays in OS keychain):**
  - Hetzner API token (master key — would let attacker spawn billed servers)
  - SSH keys (ephemeral anyway)
- **Encryption:** AES-256-GCM with key derived from user passphrase via Argon2id. Server stores ciphertext only — `jobhunterteam.ai` ops cannot decrypt.
- **Acceptance:** modify config on laptop A, install launcher + login on laptop B, config restored after passphrase entry. Server admin (us) cannot read VPS IP from raw DB.
- **Dependency:** [JHT-DESKTOP-LOGIN].

##### 🔑 [JHT-DESKTOP-RECOVERY] Recovery passphrase generation + decrypt flow

- **Why:** the encrypted cloud sync needs a passphrase that's NOT the OAuth password (which we don't have). This is the user's "vault key".
- **Task:**
  1. At first signed-in setup: launcher generates a 6-word recovery passphrase (BIP39 wordlist), shows it once with strong "save this in your password manager NOW" UX
  2. Passphrase derives encryption key via Argon2id (memory-hard, slow), key kept in memory only
  3. On new PC: prompt "Enter your recovery passphrase" after OAuth
  4. Wrong passphrase → no data leak, just retry
  5. "Lost passphrase" path: full reset (create new VPS, lose existing data) with explicit warning
- **Acceptance:** passphrase shown once at setup, encryption verified by round-trip test, recovery on new PC works in <60s end-to-end.
- **Dependency:** [JHT-DESKTOP-SYNC].

##### 🔄 [JHT-DESKTOP-RECLAIM] "I have an existing VPS, reconnect me" entry point

- **Why:** the recovery flow needs an entry point in the UI. Without it, user on new PC sees only "Create new VPS" and panics.
- **Task:**
  1. Launcher start screen on new PC: "🆕 Setup new team" / "🔄 Reconnect existing team" buttons
  2. "Reconnect" → OAuth → enter passphrase → restore config from cloud
  3. Detect mismatched state: cloud says VPS exists at IP X, but Hetzner API (with re-pasted token) says no such server → offer "Restore from snapshot" or "Create new"
  4. Detect orphan VPS: VPS exists on Hetzner but no cloud config → "Adopt existing server" flow
- **Acceptance:** all 3 scenarios (clean restore, missing VPS, orphan VPS) handled with clear UX.
- **Dependency:** [JHT-DESKTOP-RECOVERY].

##### 🩹 [JHT-DESKTOP-ERRORS] Friendly error handling (no stack traces)

- **Why:** today the launcher surfaces raw Node.js errors and stack traces to the user. Acceptable for tech users, fatal for non-tech (target audience for VPS mode).
- **Task:**
  1. Error boundary at top level: catch all uncaught exceptions, show user-friendly card
  2. Translate common failures to actionable messages:
     - `ECONNREFUSED` on Hetzner API → "Hetzner is unreachable. Check your internet connection."
     - 401 on Hetzner → "Your Hetzner API token is invalid. [Update token]"
     - Tailscale auth fail → "VPN connection failed. [Retry] [Help]"
  3. "Show technical details" expandable for those who want it
  4. Logs always written to `~/.jht/launcher.log` for support
- **Acceptance:** induce 5 common errors (network down, wrong token, VPS deleted manually, Tailscale down, disk full), all show friendly card + actionable button.

##### 📚 [JHT-DESKTOP-HELP] Embedded help/FAQ (no web round-trip for basic stuff)

- **Why:** non-tech user with broken VPS has no patience to open browser, find docs, scroll. Inline help is faster + works offline.
- **Task:**
  1. "?" button in each launcher screen → context-sensitive help panel
  2. FAQ embedded as markdown in app: "How do I get a Hetzner token?", "What does 'Pause team' do?", "I forgot my passphrase, what now?"
  3. Annotated screenshots of Hetzner panel + Tailscale (same images as [JHT-VPS-FRIENDLY] tutorial)
  4. Search bar across FAQ
  5. "Open full docs" link → goes to `jobhunterteam.ai/docs` for deeper stuff
- **Acceptance:** new user can complete VPS setup without ever opening external docs.

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

#### 🥇 [JHT-VPS-FRIENDLY] Desktop wizard for non-tech VPS deploy

- **Depends on:** [JHT-CLOUD-04] Hetzner adapter + [JHT-CLOUD-05] Cloud UI
- **Goal:** non-tech user provisions a VPS in <5 minutes without ever touching SSH or terminal.
- **UX:**
  1. Launcher: "Dove vuoi che giri il team? [Questo PC] [PC dedicato] [VPS cloud]"
  2. User picks VPS → wizard with inline tutorial (annotated screenshots of Hetzner panel: where to click, where to copy API token from, where to paste it)
  3. User pastes Hetzner API token → stored in OS keychain (NEVER in our cloud)
  4. Launcher provisions: ephemeral SSH key in-memory → server creation via Hetzner API → cloud-init runs `install.sh` → Tailscale tailnet established
  5. Ephemeral SSH key discarded; metadata saved in `~/.jht/vps.json`
  6. Dashboard subsequently talks to VPS via Tailscale mesh (no public ports)
- **Why this matters:** without this, the cheapest mode (€5/mo VPS) stays inaccessible to the actual target audience (non-tech users). With it, JHT becomes a 1-click deploy that respects local-first principles.
- **Security wins vs web-pairing alternative:**
  - Hetzner API token never leaves user's PC
  - SSH keys ephemeral (provision phase only)
  - No `jobhunterteam.ai` middleman — if our web infra is compromised, user VPSes are unaffected
- **Open design questions:**
  - Tailscale (zero-config, US company) vs WireGuard self-hosted (more aligned with local-first, more code)
  - Cross-PC migration: if user changes machine, how do they re-claim the VPS? (cloud sync of `vps.json` encrypted user-side? Hetzner API to re-inject SSH key?)
  - Auto-shutdown: button "I got hired, terminate VPS" with backup-first?
- **Design rationale:** [`docs/internal/2026-05-04-vps-deployment-design.md`](../docs/internal/2026-05-04-vps-deployment-design.md) — full brainstorm with comparative analysis of all 3 deployment paths (manual SSH / web pairing / desktop launcher).

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
- ✅ **Fix mismatch DEFAULT_LOCALE** (2026-05-06): `shared/i18n/types.ts` allineato a `'en'`, e con esso il fallback in `web/app/api/i18n/route.ts` (`loadPrefs()`) e i context default in `web/app/components/DashboardI18n.tsx`. Il fallback per chiavi mancanti in `t()` (riga 557, `TRANSLATIONS['it']`) resta `'it'` perché è secondary fallback per traduzioni assenti, non default-locale utente.
- ⬜ Language switcher in web dashboard (desktop launcher already has one)
- 🟡 **[JHT-I18N-AGENT-PROMPTS] Localizzazione prompt d'identità agenti** *(scaffolding done 2026-05-06)*. Anthropic doc avverte che system prompt eterogenei in lingua diversa da quella dell'utente causano "language drift" — Claude può rispondere nella lingua del prompt invece che dell'utente. Su JHT il rischio è reale: i 9 prompt agenti sommano migliaia di righe in italiano (es. `capitano.md` 647 righe) → un beta tester anglofono che scrive `find me python jobs` rischia risposta in italiano per inerzia del system prompt. **Convenzione scelta:** `agents/<role>/<role>.<locale>.md` siblings con fallback a `<role>.md` (= baseline = English, allineato a `DEFAULT_LOCALE`). Vedi design completo in [`docs/internal/2026-05-06-agent-prompts-i18n.md`](docs/internal/2026-05-06-agent-prompts-i18n.md). **Status 2026-05-06:** ✅ hook risoluzione lingua aggiunto a `.launcher/start-agent.sh` (legge `~/.jht/i18n-prefs.json`, prova `<role>.<locale>.md`, fallback `<role>.md`). ⬜ contenuti EN dei file identità in arrivo da branch parallela (oggi `<role>.md` è ancora in italiano → start-agent.sh continua a usare quello come fallback, no regressione). ⬜ overlay multi-lingua per `agents/_team/`, `agents/_manual/`, `agents/_skills/` (questi sono letti via `Read` tool dall'agente, non copiati dal launcher → serve risoluzione diversa, fuori scope di questa scaffolding).

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

### ✅ [BUG-TUI-BUILD] `tui/` build fail su master — RISOLTO 2026-05-06

- **File:** `tui/src/oauth/storage.ts:9` importava `../../../shared/credentials/passphrase.js`, ma `tui/tsconfig.json` aveva `rootDir: "src"` → `error TS6059: File '/app/shared/credentials/passphrase.ts' is not under 'rootDir' '/app/tui/src'`.
- **Introdotto da:** `6f35755d fix(credentials): no piu' fallback machine-derived (helper passphrase)` (2026-04-27).
- **Impatto:** dal 27 aprile `npm run build --prefix tui` falliva → `Dockerfile` step 13 → CI workflow `Docker — Build & push` rotto. Image `ghcr.io/leopu00/jht:latest` ferma al 19 aprile, chi la pullava avviava codice nuovo dentro un layer vecchio.
- **Fix applicato:** `tui/tsconfig.json` con `rootDir: ".."` + `include: ["src/**/*", "../shared/credentials/passphrase.ts"]` (file singolo invece del glob, per non tirare dentro `storage.ts` che dipende da `shared/paths.js` — non in scope per la TUI). `tui/package.json` `start` aggiornato a `node dist/tui/src/tui.js` per riflettere la nuova struttura di output (`dist/tui/src/` + `dist/shared/credentials/`).
- **Verifica locale:** `npm run build --prefix tui` ✅ verde, smoke-test runtime `import('./dist/shared/credentials/passphrase.js')` esporta `MissingPassphraseError` + `resolveJhtPassphrase`.
- **Da verificare in CI:** `gh run list -w "Docker — Build & push"` deve tornare verde al primo push, e l'image GHCR deve riprendere il publish weekly.

### 🟢 [BUG-DOCTOR-TMUX] `jht doctor` segnala "tmux: non trovato" anche con tmux installato

- **File:** `cli/src/commands/doctor.js:19`
- **Stato:** `cmdVersion(cmd)` usa `${cmd} --version` per tutti i binari, ma `tmux 3.3a` non riconosce `--version` (vuole `-V` maiuscolo) e ritorna usage + status 1. Risultato: doctor segnala "tmux: non trovato" anche su install validi (sia host con tmux apt-installato sia dentro al container JHT che ha `/usr/bin/tmux 3.3a` baked).
- **Scoperto durante:** spike host/container split del 2026-05-06.
- **Fix proposto:** mappa `cmd → version_flag` con default `--version` e override `tmux: -V`. Oppure, prima `command -v tmux >/dev/null` per esistenza, poi `tmux -V` se serve la versione.
- **Impatto:** UX confusing per chiunque usa `jht doctor` su un setup funzionante. Non blocca alcun flow operativo.

### ✅ [BUG-CSP-JSONLD-LANDING] JSON-LD landing senza nonce in produzione — FIXED 2026-05-06

- **File:** `web/app/components/landing/JsonLd.tsx` + `web/app/page.tsx` + nuovo `web/app/components/landing/LandingClient.tsx`
- **Era:** in dev funziona (CSP `'unsafe-inline'`). In prod CSP `script-src 'self' 'nonce-XXX' 'strict-dynamic'` bloccava i `<script type="application/ld+json">` senza nonce → niente rich snippet Google (SoftwareApplication + WebSite schema).
- **Causa:** `app/page.tsx` era `'use client'` (per `useSearchParams`/`useRouter`/`useState` del toggle `?login=true`) e importava `<JsonLd />` come figlio. `getNonce()` usa `next/headers` → server-only, non utilizzabile dentro a Client Component.
- **Fix applicato (split server/client):**
  1. `JsonLd.tsx` → `async` + `await getNonce()` + `nonce={nonce}` sui due `<script>` (stesso pattern di `BreadcrumbJsonLd.tsx`).
  2. Nuovo `LandingClient.tsx` `'use client'` → contiene `LandingI18nProvider` + `LoginPage` + `BackButton` + icone Google/GitHub + tutta la logica interattiva.
  3. `page.tsx` → Server Component `async` che legge `searchParams` (`login`, `error`), renderizza `<JsonLd />` + `<LandingClient wantsLogin authError />`.
- **Verifica:** type-check pulito sui file toccati. Da fare in prod: DevTools console = 0 violation CSP, JSON-LD presente nel DOM, Google Rich Results Test verde.
- **Storia:** introdotto dal commit CSP `cda78a17`; cleanup successivo aveva tolto `getNonce()` come quick fix per sbloccare il dev mode. Risolto definitivamente con questo split.

### 🔴 [BUG-TURBOPACK-SSRF-RESOLVE] `next build` fallisce su Turbopack — module resolution `shared/net/ssrf.js`

- **File:** `web/lib/ssrf.ts:12` (e `:10`, `:13`)
- **Errore (riproducibile su `master` e `dev-2`):**
  ```
  Module not found: Can't resolve '../../shared/net/ssrf.js'
  Import traces:
    ./web/lib/ssrf.ts → ./web/app/api/sessions/[id]/route.ts
    ./web/lib/ssrf.ts → ./web/app/api/webhooks/route.ts
  ```
- **Causa probabile:** Turbopack (default in Next 16.2.2) non risolve gli import con estensione `.js` che puntano a file `.ts` fuori dal package `web/` (qui `dev-2/shared/net/ssrf.ts`). Il modulo esiste fisicamente, ma il resolver non fa il fallback `.js → .ts`. Webpack legacy gestiva questa convenzione ESM-style, Turbopack richiede setup esplicito o estensione corretta.
- **Conseguenza:** `npm run build --prefix web` rotto → CI Vercel a rischio se non c'è una toolchain alternativa (verificare `vercel build` actual config). Fixato dal lato `next.config.ts` con `turbopack.resolveExtensions` o cambiando l'estensione da `.js` a `.ts` nei tre import.
- **Storia:** introdotto da commit `43594a50` *(feat(web/webhooks): route test-ping through SSRF-guarded fetch)* + `d55e822d` *(feat(shared/net): add SSRF dispatcher)*. Emerso durante smoke test del fix CSP JSON-LD (2026-05-06).
- **Fix proposto:**
  - 🥇 Tentativo 1 (zero rischio): cambiare `from "../../shared/net/ssrf.js"` → `from "../../shared/net/ssrf"` nei 3 punti di `web/lib/ssrf.ts` (l'estensione esplicita non è obbligatoria con TS path resolution).
  - 🥈 Tentativo 2: aggiungere a `web/next.config.ts` `turbopack: { resolveExtensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.json'] }` per forzare il fallback.
  - 🥉 Fallback: copiare `shared/net/ssrf.ts` come dipendenza locale di `web/` (rompe principio shared, sconsigliato).
- **Verifica:** `npm run build --prefix web` deve completare senza error.

### 🔴 [BUG-TURBOPACK-MONOREPO-RESOLVE] `next dev` resolver cerca `tailwindcss` dal monorepo root

- **File:** `web/next.config.ts` (config `outputFileTracingRoot` + Turbopack interaction) + ambient resolution
- **Errore (riproducibile in dev su Windows):**
  ```
  Error: Can't resolve 'tailwindcss' in 'C:\Users\leone.puglisi\repos\job-hunter-team\dev-2'
    resolve as module
      C:\...\dev-2\node_modules doesn't exist or is not a directory
      C:\...\repos\node_modules doesn't exist or is not a directory
      ... (path lookup risale fino a C:\)
  ```
- **Causa probabile:** `outputFileTracingRoot: MONOREPO_ROOT` in `next.config.ts` (riga ~9) imposta come root il parent di `web/`. Turbopack/PostCSS in dev usa quel root per la node-module resolution di tailwindcss invece di `web/node_modules/`. Il problema è specifico del setup monorepo Windows; Vercel CI parte già con cwd diverso e potrebbe non vederlo.
- **Conseguenza:** primo GET `/` dopo `npm run dev` blocca Turbopack su un loop di resolve falliti → CPU/IO saturati → server inutilizzabile per smoke locale. Vedi memoria `feedback_no_heavy_smoke_tests_stacking`.
- **Storia:** non chiaro quando introdotto; emerso 2026-05-06 durante runtime smoke del fix CSP JSON-LD.
- **Fix proposto:**
  - 🥇 Verificare che `outputFileTracingRoot` non venga propagato come module-resolution root in dev (è pensato solo per Vercel file tracing in build).
  - 🥈 Aggiungere `tailwindcss` esplicitamente in `web/next.config.ts` `experimental.externalDir` o forzare PostCSS config a usare `path.resolve(__dirname, 'node_modules/tailwindcss')`.
  - 🥉 Test cross-OS: il bug potrebbe non manifestarsi su Linux/macOS — verificare via CI prima di toccare config.
- **Verifica:** `cd web && npm run dev` + `curl localhost:3000/` deve rispondere 200 senza loop di resolve.

Operational info (Supabase access, Vercel env vars, OAuth setup, security review status, contact) lives in [`docs/internal/MAINTAINERS.md`](docs/internal/MAINTAINERS.md).
