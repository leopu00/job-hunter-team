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
- 🟡 **[JHT-WEB-LOCAL-ROUTES-ORPHANED]** — **36 dead API routes removed on 2026-07-25** (149 → 113; the ones that shell into the container went 28 → 17). Every removed route had zero callers anywhere outside `archive/`: feeds for the retired local dashboard and the archived team-v1 page, VPS lifecycle buttons now living in the native app, the profile-assistant lane, bridge start/stop, `team/start-all` and `team/stop-all` (the CLI carries the only implementation now). `/api/canary` was kept on purpose — a documented `curl`-by-hand diagnostic. **Second pass, 2026-07-25:** the three control pages — `/team/{assistente,capitano,sentinella}` — removed with their 16 routes and the `ProfileAssistantFab`. The trigger was measurable: on cloud those pages showed a status badge stuck on *connecting* forever (the fetch never starts, `if (isCloud) return`), i.e. they read as broken rather than as unavailable; the same functions have been native in the game for a month. Totals: **149 → 97 routes**, shell routes **28 → 4**. **Open residual:** the 4 remaining shell routes (`team/status`, `team/send`, `agents`, `agents/[id]`) serve `AgentInteraction` and the live sections inside the five role pages. Those pages also carry genuinely useful descriptive content on cloud, so cutting them means surgery inside 400–1000-line files — deliberately not done in the same pass. Two sub-decisions left: (a) do the role pages keep a live section at all on cloud, and (b) if yes, they must degrade *out loud* — only `Scout` and `Scorer` say `noRealtime` today, `analista`/`critico`/`scrittore` leave a silent gap. Plus **11 routes exercised only by Playwright specs** (`/api/{about,health,stats,agents,agents/metrics,agents/[id],onboarding,resume,search,telegram,workspace}`) — their fate is tied to [JHT-E2E-STALE].
- ⬜ **[JHT-REALTIME-SCALE]** — event-driven sync is live and degrades gracefully; scale refinements for many users (reconnect-rate monitor, Realtime connection ceiling, thundering herd, unified auth, tunable parachute).
- ⬜ **[JHT-CLOUDSYNC-01]** — remaining P0 flow-correctness items; living doc: `docs/internal/architecture/cloud-sync-architecture.md` § Pending.
- ⬜ **[JHT-ONBOARDING-04]** — periodic agent-results push.
- 🟡 **[JHT-WEB-DEMO]** — demo mode + `/welcome` shipped 2026-07-22/23 ([design record](docs/internal/architecture/2026-07-22-web-demo-mode-and-welcome.md)). **Covered on 2026-07-25:** 42 tests across `tests/js/tasks/demo-{seeds,queries,feedback-cookie}.test.ts` (seed contract, the queries that feed every page, the retractable verdict in the cookie) plus `e2e/tests/8{0,1}-*.spec.ts` for the demo API and the auth closure. **Open:** the protected-area specs need a Supabase test session (see `e2e/README.md` § Sessione) · **company dossier: done 2026-07-25** — the card now appears in demo. The dossier is *derived* deterministically from what the seed already carries (`web/lib/demo/seeds/companies.ts`): sector, size, HQ (the position's own city, so it never contradicts the map), Glassdoor rating, and an Analyst verdict aligned to the score shown next to it. No logo — an invented company does not have one, and the card renders it optionally — and no prose, so nothing new to translate across 7 locales. If `culture_notes`/`red_flags` are ever wanted, they belong in the i18n overlays like the Scorer's notes.
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
- 🔴 **[JHT-HEADLESS-FROM-GAME]** — *lavorare tutta la notte senza grafica, deciso dalla finestra.* Il gioco è una **finestra sul team**, non il team: gli agenti vivono nel container e non hanno bisogno di essere guardati per lavorare. Oggi però manca la scelta corrispondente — l'uscita esegue `team stop --all` + `docker stop jht` (vedi `shutdown_commands`), quindi **chiudere la finestra spegne tutto**, e le due opzioni del dialogo di uscita (forzata / ordinata) spengono entrambe. Chi vuole lasciare il computer a lavorare la notte deve tenere aperto un gioco che disegna a pieno ritmo (→ `[JHT-GAME-IDLE-COST]`, 37% di CPU e 75 °C misurati). Serve una **terza via all'uscita**: *«esci dalla finestra, il team continua»* — con il modo di riattaccarsi dopo (riapri il gioco e ritrovi l'ufficio al punto in cui è arrivato) e un segno visibile che il team sta lavorando senza di te. La strada tecnica esiste già ed è collaudata (la CLI fa esattamente questo): il lavoro è renderla **una scelta comprensibile dentro il gioco**, non un comando da terminale. Principio guida dell'intera voce: *la grafica si accende per vedere i risultati, non per assistere al lavoro.*
- 🔴 **[JHT-GAME-IDLE-COST]** — il gioco è il processo che consuma PIÙ CPU della macchina, più di tutti gli agenti insieme: misurato sul ThinkPad T440s la notte del 26/07 con team al lavoro → `job-hunter-team 37,3%` contro `Kimi Code ~8% ×5`, CPU a **75 °C** con load 1,3 su 4 core. Non è un problema di prestazioni (niente rallenta) ma di **costo a riposo**: questa è un'applicazione fatta per restare aperta mentre guardi il team lavorare, anche di notte, e continua a disegnare a pieno ritmo con la finestra in secondo piano o minimizzata. Il gioco il focus lo conosce già (lo scrive nel log: `finestra ha perso il focus`) e non ne fa nulla. Rimedio: abbassare gli fps quando la finestra perde il focus e ridurli ancora da minimizzata; chi guarda in primo piano non deve accorgersi di niente. Complementare a `[JHT-PIXEL-MODE]`, che agisce sulle draw call e non sul ritmo di disegno.
- 🟡 **[PACK-INSTALLER-SIZE]** — misurare e ottimizzare gli export Godot sui tre sistemi. Il container è già stato dimezzato (7.2 → 3.2 GB, 2026-07-24); resta da misurare il peso degli export sui tre sistemi.

> `[JHT-DESKTOP-07]` ("container serves `next start` instead of `next dev`") è stato **chiuso per superamento** il 2026-07-23: il container non avvia più Next.js in nessuna modalità.

> `[JHT-PIXEL-MODE]` (modalità grafica pixelata: render interno a bassa risoluzione + upscale nearest) è stato **chiuso per implementazione** il 2026-07-25, prima ancora di essere archiviato come esperimento: `Game.render_scale` disegna il mondo in un SubViewport ridotto, la calibrazione sceglie il gradino e l'utente può forzarlo da Impostazioni → Grafica. Il risparmio è reale ma parziale — il grosso delle draw call resta nei mobili (308) e negli agenti (254), non nella scenografia (85 su 822). Resta da misurare su hardware diverso dal T440s.

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

- ⬜ `LOCALES` drift — API default `'it'` vs `DEFAULT_LOCALE='en'`. Half of this
  item closed itself on 2026-07-25: the third list, `shared/i18n/types.ts`
  (which omitted `'hu'`), went with the unreachable `shared/` scaffolding. The
  surviving lists are `web/app/api/i18n/route.ts` and the catalogs under
  `shared/locales/`, which the bash/Python helpers read.
- ⬜ `mantenitore` agent overlays (6 languages) + translator-facing guide + native-speaker review pass.

## 🛠️ Infra & CLI

- 🔴 **[JHT-CLI-AGENT-PARITY]** — **the CLI reads and commands, but cannot decide.** The project's stated design rule lives in `docs/guides/AI-AGENT-INTEGRATION.md`: *"If a feature requires opening the web dashboard or the Desktop app to be configured after install, that's a bug — one CLI surface for humans, AI agents and the Desktop launcher."* Measured against the game's `BackendBus` verbs on **2026-07-25**, it is not being met.

  | | 🎮 game | 🔧 CLI |
  |---|---|---|
  | read — positions, state, stats, logs, graphs | ✅ | ✅ `positions list/show`, `stats`, `status`, `logs`, `sentinella graph` |
  | command — start/stop the team, talk to an agent, providers, hours | ✅ | ✅ `team start/stop/send/chat`, `providers`, `working-hours`, `cron` |
  | **decide** — judge a position, exclude it, request a CV, open a ticket, post a standing directive, save the profile, fetch a produced artifact | ✅ | ❌ **nothing** |

  `jht positions` describes itself in code as *"Query DB posizioni (proxy a db_query.py)"* — read-only by construction. The missing verbs are exactly the ones that carry a **user judgement**, which is what the human does in the office and an agent currently cannot do at all.

  The capability is already there, one layer down: `shared/skills/{ticket,team_directives,write_request,feedback_query}.py`. What is missing is the `jht` verb in front — wrapping, not design.

  **The bigger blocker is not the verbs, it is the output format.** Only **3 of 37** command modules support `--json`/`--format` (`container`, `profile`, `tools`). An agent reading `jht positions list` gets an ASCII table meant for a human eye and has to parse it with brittle regexes — while `db_query.py` underneath already knows how to emit JSON and the flag simply is not exposed. Work, in order: (1) `--json` across the read commands; (2) the decision verbs; (3) a CI parity check that fails when the game gains a verb the CLI lacks, so this cannot drift again.

  **Done 2026-07-25 — all three steps.** (1) `--json` on the seven `db_query.py` read commands, surfaced on `jht positions list/show/dashboard`. (2) Decision verbs: `jht positions exclude/restore/request-cv`, `jht ticket open/list/count/show/for-position/assign/resolve`, `jht directives add/list/edit/archive/show`. Two skills had to be written or extended, because the verb existed *only* inside a web route and was therefore browser-only: `shared/skills/user_exclude.py` (new) and `ticket.py open`. (3) `tests/test_cli_game_parity.py` classifies every public `BackendBus` verb as covered / known-gap / not-applicable and **fails on an unclassified one** — verified by injecting a fake verb and watching it name it.

  **Residual, still open:** like/dislike/star feedback (lives only in Supabase `position_feedback`, needs the cloud lane, not SQLite), `fetch_artifact`, `upload_user_document`, and read/write of the coordinator settings. Each is listed in `KNOWN_GAPS` inside the parity test, so the list cannot quietly rot. Also open: `user_exclude.py` and the TS route now hold **two implementations of the same rules** — one test compares their reason sets, nothing compares their behaviour.

- 🟡 **[INFRA-VERCEL-QUOTA]** — poll fold-in shipped (~75% idle reduction); residual: spending limit on Vercel (user action). The **file-bridge poller was re-enabled by default on the VPS (2026-07-11)** to serve on-demand CV/attachment downloads from the web (position-page "Download PDF" + profile CV preview): ~130 req/h per user at idle (index/purge at 5min, pending-poll ≤30s). Sustainable for beta — the structural fix is **[JHT-FILEBRIDGE-REALTIME]**.
- ⬜ **[JHT-FILEBRIDGE-REALTIME]** — take the file-bridge off HTTP long-polling onto push/Realtime (Supabase Realtime subscription on `file_bridge_requests`, or fold into the event-driven [JHT-REALTIME-SCALE] channel) so idle cost → ~0 as users scale. Today the VPS poller polls `/api/cloud-sync/file-bridge` (~130 req/h/user idle); re-enabled 2026-07-11 in `cli/src/commands/pid1.js` (split out of the `JHT_CLOUD_CONTROL_POLLERS` gate).
- 🟡 **[INFRA-SUPABASE-PERF]** — P0/P1/P2 advisor findings done; residual: connection-pool monitoring.
- 🟡 **[BUG-INSTALL-BRANCH-MASTER-DEFAULT]** — `install.sh` still fetches runtime files from `master` when installed from a dev branch (mostly fixed).
- 🟡 **[JHT-CLI-WIN-NATIVE]** — Windows-native CLI shipped; E2E validation pass remaining.
- 🟡 **[JHT-INSTALL-SPLIT]** — host/container split partially done.
- 🔴 **[JHT-E2E-STALE]** — the 78 Playwright specs in `e2e/` run in no workflow. **Measured on 2026-07-25** against a local server: **770 passed · 574 skipped · 0 failed**. The skips are the specs skipping themselves, and the root cause is older than the July drift: **the suite never had an authentication story** — `01-auth.spec.ts` still carries its original `TODO: richiede storageState`, so every spec touching the protected area skips as soon as the deployment behaves like production. A green run therefore certifies the *public* pages and almost nothing else. Plan, in order: (1) **the wiring is done (2026-07-25)** — `playwright.config.ts` picks up `auth-state.json` automatically and announces at startup whether the protected area will run; what is missing is only the **dedicated Supabase test account** (maintainer decision: option A of the 2026-07-25 review — a test user on the production project, isolated by RLS) and the CI secret; (2) prune the specs written for surfaces that no longer exist (retired local dashboard, `/onboarding`, pruned API routes); (3) put the public-surface subset in CI against a preview deployment. New specs must **skip loudly** — see `80-welcome-wizard.spec.ts` for the pattern.

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
