# 🗺️ ROADMAP — Job Hunter Team

> Last updated: 2026-05-29
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

  🔨 ~88%             🔨 ~80%             🔨 ~50%            🔨 ~70%            🔨 ~70%            🔨 ~68%
  Web Platform       Desktop Launcher    Cloud Multi-      Full              Public            🚢 Pre-Launch
  consolidation      + first-run UX      Provider          i18n              Website            OSS
```

---

### 🔨 Phase 1 — Web Platform Consolidation (current sprint)

> _"The web app works end-to-end with real data."_

```
🟢 Status: IN PROGRESS — ~88%
━━━━━━━━━━━━━━━━━━━░░ 

✅ Next.js 16 app, ~76 page.tsx routes (App Router)
✅ Google + GitHub OAuth
✅ DB schema (migrations 001–011, RLS, onboarding-state)
✅ Vercel CI/CD pipeline + jobhunterteam.ai live
✅ Dashboard wired to real Supabase data (mock-data audit: solo `web/lib/dashboard-demo.ts` gated da env+query)
✅ Positions, applications, settings, map drilldown pages live
✅ Cloud sync — 9 route.ts in web/app/api/cloud-sync/ (tokens, ping, push, device-init/poll/confirm/register, team-commands), jht cloud CLI completo (enable/login/pair/status/push/disable/daemon)
✅ Web E2E tests — 76 Playwright specs in e2e/tests/
✅ Onboarding split-screen (profile mirror + assistant chat)
✅ CLI ↔ container coordination (jht team / container / sentinella)
✅ db_to_supabase.py wrapper — push agent results to cloud (shared/skills/db_to_supabase.py)
✅ Weekly window monitoring calibration — data layer DONE (compute_metrics.py espone weekly_usage, weekly_reset_at)
✅ User-defined work hours ("team as employee" model) — config + gate in pacing-bridge & notify-user (commit `13318e1d` + work-hours-aware target `f7b52e52`)
✅ Sentinel token optimization — 491→162 righe (-67%, target era 130) + 6 SKILL.md on-demand
✅ Bridge V7 — token-based monitoring (shared/skills/token-meter.py + throttle*.py)
✅ Bridge V8 — auto-incentive (.launcher/pacing-bridge.py, tick 15min)
✅ Kimi €40 calibration (sprint 17-18 maggio: Sentinella 3 fasi + scala continua, EMERGENZA -96%) — commit `d6c1c646`
✅ Weekly cap awareness post-fix 2026-05-22 (C-09 `9e7ece9f` Capitano + S-06 `86da0f03` Sentinella)
✅ Windows-native CLI — install.ps1 (389 righe) + jht-wrapper.ps1 (233 righe) shipped 2026-05-22
✅ Team strategy bugs sprint 2026-05-17/18 — 13 bug + 3 feature chiusi, vedi [BACKLOG](../../BACKLOG.md#-team-strategy-bugs-sprint-2026-05-1718-13-bug--3-feature-chiusi) e [`docs/sessions/2026-05-18-fix-effectiveness-review/`](../sessions/2026-05-18-fix-effectiveness-review/)
⬜ Documented test campaign matrix (provider × tier × persona) — BLOCKER pre-launch, 1/10 cella pubblicata
⬜ VPS comparison decision tree doc (PC locale vs PC dedicato vs VPS)
🟡 Local-PC-no-API mode — local-queries.ts esiste, switch logico pending in queries.ts
```

For full task list → [BACKLOG · Phase 1](../BACKLOG.md#1️⃣-phase-1--web-platform-consolidation-current-sprint)

---

### 🖥️ Phase 2 — Desktop Launcher

> _"Download, install, everything starts in the background, then you work from the browser."_

```
🟡 Status: IN PROGRESS — ~80%
━━━━━━━━━━━━━━━━░░░░ 

✅ Electron scaffolding + electron-builder
✅ First-run setup wizard (i18n en/it/hu, language picker, step-based UI)
✅ macOS one-click install (Homebrew → Colima via osascript, Xcode CLT, QEMU fallback)
✅ Windows one-click install (WSL2 + Docker Desktop + Git in single UAC + reboot)
✅ Embedded terminal for login (real pty, clipboard bridge)
✅ Smart boot (skip wizard if already configured)
✅ Cross-platform installers: .dmg / .exe / .AppImage / .deb
✅ Lazy install of Docker container (handles Node/Python deps inside)
✅ OAuth login flow — desktop/auth/ (browser-picker, callback-server PKCE, OS keychain, Guest+Signed-in coexistence) DONE 2026-05-13
✅ Encrypted cloud sync core — desktop/sync/crypto.js (AES-256-GCM + PBKDF2-SHA512 KDF v1)
✅ Cloud sync profile (candidate_profile.yml in payload push cifrato)
✅ VPS friendly wizard — location picker, SSH keypair gen, runInstall remoto, pairing token derivato dalla session, 3 lifecycle button (⏸️/📸/💀) DONE 2026-05-13
✅ Auto-pairing VPS↔account web — 4/4 path (CLI `jht cloud login` device flow OAuth + onboarding empty-state + auto-push + desktop install.sh --pairing-token) DONE 2026-05-19
⬜ `jht cloud restore` — bootstrap pull-automatico su container vuoto (CLI command da implementare)
⬜ Cloud sync theme/settings — oggi in localStorage, da migrare a `user_settings` DB table
⬜ Recovery passphrase BIP39 6-word (Argon2id KDF v2)
⬜ Friendly error handling (ECONNREFUSED/401/Tailscale → cards azionabili)
⬜ Embedded help/FAQ (context-sensitive "?" + offline FAQ)
⬜ Tray icon + native desktop notifications
⬜ Auto-update via electron-updater
⬜ Dedicated computer mode (SSH-based JHT su PC della rete locale, mDNS/Bonjour)
⏸️ Code signing (deferred post-beta — open source + community review = trust signal)
```

For full task list → [BACKLOG · Phase 2](../BACKLOG.md#2️⃣-phase-2--🖥️-desktop-launcher)

---

### ☁️ Phase 3 — Multi-Provider Cloud Provisioning

> _"Click a button, the team runs on a self-hosted VPS."_

```
🟡 Status: IN PROGRESS — ~50%
██████████░░░░░░░░░░ 

✅ Desktop → VPS bring-up via SSH (T1: SshExec helper + IPC routing, commit a118cecb)
✅ Company provider install via SSH (T2: install.sh + chown npm dirs, commit 87601d2a)
✅ Company provider login PTY through SSH (T3: terminal-login VPS-aware, commit 187dbefb)
✅ Telegram 3-bot tokens step via remote save (T4, commit fd1f7e6d)
✅ Dashboard 3-way routing + VpsSetupCompleteLanding (commit eccd1158)
✅ Cloud sync user onboarding state (migration 011, vps_setup + profile_configured)
✅ Auto-pairing VPS ↔ account web — 4 path coperti (CLI `jht cloud login` device flow + desktop --pairing-token + onboarding empty-state + auto-push)
✅ CV upload via web UI (web/app/api/profile/upload/route.ts, PDF+doc+docx+md, 10MB, salva in /jht_user/cv/)
✅ Hetzner lifecycle minimal — web/lib/hetzner.ts (listServers, snapshot, terminate); decisione lockata 2026-05-13: niente create-server automation in beta, utente paste IP manuale
⬜ Abstraction layer shared/cloud/ (CloudProvider interface — NON ESISTE, Hetzner sta in web/lib/ silos)
⬜ 🇪🇺 Hetzner Cloud full adapter (provisioning create-server, cloud-init)
⬜ Cloud UI inside the desktop wizard (provider choice, cost estimate, billing alerts)
⬜ Secure tunnel app ↔ cloud (today: raw SSH; planned: Tailscale o WireGuard — non cablato)
⬜ 🌩️ AWS EC2 adapter (ZERO codice)
⬜ ☁️ Google Cloud GCE adapter (ZERO codice)
⬜ PDF OCR skill in agents/_skills/ per auto-extract candidate_profile.yml dal CV uploadato
```

> 🌉 **Bridge to today**: power users can already bring up JHT on a self-hosted VPS through the desktop wizard (manual IP + SSH key, T1-T4 path). PHASE 3 generalises that one-VPS flow into a multi-provider, billing-aware one-click experience.

For full task list → [BACKLOG · Phase 3](../BACKLOG.md#3️⃣-phase-3--☁️-multi-provider-cloud-provisioning-future-post-10)

---

### 🌍 Phase 4 — Full Internationalization

> _"The platform speaks the user's language."_

```
🟡 Status: IN PROGRESS — ~70%
██████████████░░░░░░ 

✅ i18n module with en/it/hu support and fallback
✅ English as primary language (default) — DEFAULT_LOCALE='en' allineato 2026-05-06
✅ Desktop wizard language picker (en/it/hu)
✅ Language switcher in web dashboard — `web/app/components/LanguageSwitcher.tsx` (EN/IT/HU con flag SVG)
✅ Hungarian (`hu.json`) — community contribution
✅ **Localized agent prompts** (DONE 2026-05-19): baseline EN per tutti 9 ruoli (`analista`, `assistente`, `capitano`, `critico`, `dottore`, `mentor`, `scorer`, `scout`, `scrittore`, `sentinella`) + overlay IT 8/10 (mancano `critico.it.md`, `mentor.it.md`) + overlay HU 10/10. Hook risoluzione lingua deployed in `.launcher/start-agent.sh` (legge `~/.jht/i18n-prefs.json`, prova `<role>.<locale>.md`, fallback baseline EN). Safeguard runtime RULE-T14 in `agents/_team/team-rules.md`.
⚠️ Mismatch infra residuo: `web/app/api/i18n/route.ts:31` default `'it'` ≠ `shared/i18n/types.ts` `DEFAULT_LOCALE='en'`; `LOCALES` in types.ts non include `'hu'` pur essendo supportato in route.ts.
⚠️ `web/messages/it.json` mancante (presenti solo `en.json` + `hu.json`).
⬜ Per-language JSON files refactor (oggi `translations.ts` inline)
⬜ Overlay multi-lingua per `agents/_team/`, `agents/_manual/`, `agents/_skills/` (questi sono letti via `Read` tool, non copiati dal launcher → serve risoluzione diversa)
⬜ Overlay IT mancanti: `critico.it.md` + `mentor.it.md`
⬜ Spanish, German, French, Portuguese translations
⬜ Translator-facing documentation (how to add a new language)

> **Background — "language drift":** Anthropic docs documentano che con
> system prompt molto pesanti in lingua ≠ user, Claude può inferire la
> lingua della conversazione dal system prompt e non dalla query utente.
> Su JHT i 9 prompt agenti sommano migliaia di righe → safeguard via
> RULE-T14 (runtime) + baseline EN (post-2026-05-19) + overlay locali.
> Design doc: [`docs/internal/2026-05-06-agent-prompts-i18n.md`](../internal/2026-05-06-agent-prompts-i18n.md).
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
   agents/mentor spec)
⬜ Subdomain setup (app, docs, api)
⬜ Launcher screenshots in docs (soft BLOCKER pre-launch)
⬜ Visual FAQ
⬜ Video tutorial series (multiple short walkthroughs, 2–5 min each)
⬜ SHA256 checksums on download page
```

For full task list → [BACKLOG · Phase 5](../BACKLOG.md#5️⃣-phase-5--🌐-public-website)

---

### 🚢 Phase 6 — Pre-Launch Public OSS

> _"Get JHT ready for Show HN, Product Hunt, Reddit, awesome-lists."_

```
🟡 Status: IN PROGRESS — ~68%
█████████████░░░░░░░ 

✅ 🔐 SECURITY.md — root file with responsible disclosure (audit in docs/security/)
✅ 🤝 CODE_OF_CONDUCT.md — Contributor Covenant 2.1
✅ 🛡️ Security review — 31/34 fix, score 30→74% (docs/security/, 7 file ~2336 righe); 3 gap residui: SSRF, resolve-system-bin, CSP prod
✅ 🧪 docs/guides/BETA.md created (con "Coverage we still need" matrix)
🟡 🐛 GitHub issue triage — templates (bug_report.md, feature_request.md) + .github/labels.yml (25 label) + docs/internal/triage.md SLA 48h/24h DONE; manca `gh label sync` live + project board
🟡 📰 Show HN draft — docs/launch/show-hn-draft.md (171 righe, 4 title variants, Plan B subreddits); manca screenshots/GIF embedded (dipende da demo)
🟡 🎬 30s demo storyboard — docs/launch/demo-storyboard.md (202 righe, 6-beat shot list, asciinema commands); mancano demo-profile.yml + assets/demo-fixtures/ + .cast/.gif
⬜ 🧊 Stabilize monitoring architecture (1-2 weeks freeze pre-launch)
⬜ 🧪 Beta tester recruitment (publish on r/cscareerquestions, friends list)
⬜ ⭐ Awesome lists submissions (awesome-ai-agents, awesome-claude, awesome-selfhosted)
⬜ 🎙️ Press kit (logos svg+png, 5+ screenshots, 3 description variants 30/100/300w) — assets/press-kit/ mancante
```

For full task list → [BACKLOG · Phase 6](../BACKLOG.md#6️⃣-phase-6--🚢-pre-launch-public-oss-new)

---

## 🌐 Cross-cutting features

These don't belong to a single phase — they ship progressively across multiple phases.

### 💬 Telegram 3-bot setup + per-agent future

> _"A bot per role today; a per-agent chat + team forum tomorrow."_

**Shipped (decisione 2026-05-13 rev2, commits `f23df913` → `579d91e6`):** onboarding wizard configures **three mandatory bots** — Assistente, Capitano, Mentor — with `tg-bridge` routing per role and `jht-telegram-send` skill on all three. Notifiche batch ogni N ready. Mentor sempre user-facing.

```
✅ Setup 3 bot obbligatori in onboarding (Assistente / Capitano / Mentor)
✅ tg-bridge multi-bot + routing per ruolo
✅ jht-telegram-send skill su 3 agenti
✅ Notifiche batch ogni N ready
```

Roadmap successivo — vero "team forum":

```
⬜ Per-agent chat 1:1 (Scout / Critic / Writer / Scorer / Sentinel)
⬜ Directed messages: `@scout find python jobs in EU`
⬜ "Team forum" channel — utente segue la conversazione tra agenti
⬜ Per-agent mute / subscription preferences
```

### 🔄 Cloud sync direction (decisione 2026-05-13)

**Direzione**: push-only `local → cloud`, sempre. Il container è la fonte di verità, Supabase è il mirror.

**Bootstrap automatico**: quando l'utente fa login con lo stesso account su un container nuovo/vuoto (es. nuova VPS, nuovo PC), l'app rileva il DB locale vuoto e fa un pull automatico — DB allineato, sync normale da lì in poi. Niente comandi manuali.

**Cosa si sincronizza**: posizioni + metadati (`jobs.db`), profilo utente (`candidate_profile.yml`), tema/settings dashboard. Memoria agenti runtime e CV binari restano locali.

→ Task di implementazione: `[JHT-CLOUD-RESTORE]`, `[JHT-CLOUD-SYNC-PROFILE]`, `[JHT-CLOUD-SYNC-THEME]` in `BACKLOG.md`.

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
✅ Add the per-agent distribution step to .launcher/start-agent.sh:
   reads agents/<role>/skills.list manifest + always-copies
   agents/<role>/_skills/, populates <agent_cwd>/.claude/skills/ and
   <agent_cwd>/.agents/skills/ via cp -R at each spawn
   (commit e220114c, "feat(skills): per-agent skill distribution via manifest")
✅ Drop the global Dockerfile symlink loop in favour of per-agent
   distribution at boot — the Dockerfile now only documents the
   architecture (lines 112-119), no more global farm of symlinks
   (same commit e220114c, provider-uniform: no .git/ needed)
✅ Move agents/_tools/jht-tmux-send into agents/_skills/tmux-send/ as a
   colocated artifact. Dockerfile gained a second `ln -sf` loop over
   `/app/agents/_skills/*/jht-*` so colocated `jht-*` scripts still land
   in `/usr/local/bin/`. References in sentinella.md, sentinel-orders,
   order-formats, anti-collision, web/api/team/messages updated.
   (`agents/_tools/` kept: still hosts jht-send + the throttle/notify
   wrappers, not all script families have moved yet.)
⬜ Move 1:1 Python scripts into their skill folders + create
   agents/_skills/_lib/ for shared deps (_db.py, compute_metrics.py,
   usage_record.py); update sys.path imports + the ~10 prompt files
   that reference /app/shared/skills/<x>.py absolute paths
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

### 🧙‍♂️ Mentor — career-coach agent (planned)

The most important agent we haven't built yet. Stands outside the operational pipeline, looks at career trajectory + market signals + user goals, gives strategic advice.

→ Spec in [`agents/mentor/mentor.md`](../../agents/mentor/mentor.md). See [`docs/VISION.md`](VISION.md) for the rationale.

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
