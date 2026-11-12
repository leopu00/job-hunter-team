# 📋 BACKLOG — open items

One line per item that was still open at the last review of this file (12/11/2026), grouped by area. The
full text of every item — notes, measurements, links, and the items already closed — is in
[`docs/internal/_archive/BACKLOG-2026-11-12-frozen.md`](docs/internal/_archive/BACKLOG-2026-11-12-frozen.md);
older history is in [`docs/internal/_archive/BACKLOG-2026-07-03-frozen.md`](docs/internal/_archive/BACKLOG-2026-07-03-frozen.md).

- **Strategy & themes** → [`docs/about/ROADMAP.md`](docs/about/ROADMAP.md)
- **Shipped work** → [`CHANGELOG.md`](CHANGELOG.md)
- **Minor fixes** → [`docs/internal/roadmap/MINOR-TRACKER.md`](docs/internal/roadmap/MINOR-TRACKER.md)

Legend: 🔴 fix soon · 🟡 in progress / partial · ⬜ open · ⚪ parked idea. A `[TAG]` cited from code or docs and
not listed here is closed: its story is in the archives above.

## 🔴 APERTO DOPO LA RELEASE v0.3.9 (14 Aug 2026)
- 🔴 **Il push si ferma più avanti: `http_422 acknowledgement_mismatch`** *(`#163`, misurato 14/08)*
- 🔴 Parità Windows V3 incompleta: handle/reparse/SID-ACL, `last-error` PS5.1, dispatch Attest/Cleanup V3, Python ≥3.9 + UTF-8
- 🔴 Delete POSIX a quarantena: verdi solo gli oracle unitari; integrazione shell/fake e retry end-to-end non completati.
- 🔴 Fault matrix 3OS e suite completa **non rieseguite** dopo gli ultimi cambi.
- ⚠️ **Il lavoro vive in commit locali senza remote** ⇒ rischio di perdita, non blocker tecnico.
- 🟡 T0–T5 di prodotto **non misurati** su nessuno dei 3 OS.
- 🟡 **`anon` ha `DELETE`/`INSERT`/`UPDATE`/`TRUNCATE` su `user_settings` a livello ACL**
- 🟡 **`#151` ha rimosso il retry Godot POSIX**: `run.sh` non ritenta più ⇒ macOS e Linux più sensibili ai flake del motore.
- 🟡 **La full pytest locale non è tutta verde**: 2199 pass + 33 errori Docker/PG non-ready + 5 fail branch-census.
- 🟡 **`game` WIP su `origin/game`**: lavoro valido ma **951 commit indietro** con **32 commit unici**
- 🟡 **«Sei sul box» oggi si prova con un header, e un header si falsifica** *(`#161`, aperta dalla review di `#158`)*
- 🔴 **`NEXT_PUBLIC_JHT_DEPLOY` ora decide anche *chi sei*, non solo cosa puoi scrivere.** Dopo `#154` l'autenticazione poggia su `isCloudDeploy()`
- ⬜ **La 0.3.9 non è mai stata provata da utente**: verifiche solo read-only. **Misurato 14/08**
- ⚠️ **Il criterio che sopravvive ai due ticket**: una difesa buona che la maggior parte del codice **non attraversa** non è una difesa.
- 🔴 **Un rifiuto di sicurezza trattato come un guasto transitorio** *(dimostrato 16/08 con prova eseguibile, dentro `#179`)*
- 🟡 Il ROI assume che l'origin del `contentRect` mappi sul crop: testato solo con `origin=0`, mai un frame reale con origin diverso.
- 🟡 L'oracle manifest-tamper non esegue il runner completo sul manifest alterato.
- ☠️ **Queste due non le sblocca una macchina: il codice non è in `master`.** Vivono in commit locali su un repo **senza remote**, quindi non è una verifica che manca

## 🔴 APERTO DOPO LA RELEASE v0.3.9 (18 Aug 2026) — rivisti con l'operatore
- ⬜ **[SCORING-WEIGHTS-NOT-CHANGEABLE]** Changing the scoring weights breaks the web UI.
- ⬜ **[PULL-7DAY-FLOOR]** The desired-state pull is capped **server-side to the last 7 days**, so an application that failed to sync when it happened **never comes back**
- ⬜ **[E2E-NEEDS-A-LIVE-ENVIRONMENT]** The three e2e testers have real platform profiles but **no team of agents actually working**
- 🔴 **[PACING-ROUTING-AND-DEAD-SESSION]** ⛔ **DO NOT IMPLEMENT WITHOUT THE OPERATOR PRESENT**

## 🔴 APERTO DOPO LA RELEASE v0.3.9 (19 Aug 2026) — rivisti con l'operatore
- 🔴 **[BURN-RELEASES-THE-WRONG-BRAKE]** ⛔ **DO NOT IMPLEMENT WITHOUT ASKING FIRST**
- 🔴 **[JHT-INSTALL-IS-NOT-A-SKILL]** ⛔ **DO NOT IMPLEMENT WITHOUT ASKING FIRST.** Operator, 19 Aug
- 🔴 **[SOFT-DELETE-RESURRECTED-BY-LEGACY-ID-REUSE]** ⛔ **DO NOT IMPLEMENT WITHOUT ASKING FIRST.** **27% of applications are invisible on the web**
- 🔴 **[CONTAINMENT-IS-UNDONE-IN-ONE-SECOND, AND-IN-SILENCE]** ⛔ **DO NOT IMPLEMENT WITHOUT ASKING FIRST.** **An agent cannot switch another agent off.** From the watchdog journal
- 🟡 **[NO-ESCALATION-PATH-WHEN-A-TEAM-HITS-A-SYSTEM-FAULT]** ⛔ **DO NOT IMPLEMENT WITHOUT ASKING FIRST.** Priority **low** by the operator's own words
- 🔴 **[UPDATED-AT-OVERWRITTEN-BY-THE-PUSH]** ⛔ **DO NOT IMPLEMENT WITHOUT ASKING FIRST.** **The "Updated" column shows when the sync touched the row, not when the data changed.*…**

## 🔁 Repository hygiene
- 🟡 **[PRETTIER-GATE-COVERS-ITS-OWN-FOLDER]**
- 🟡 **[GODOT-UID-NOT-COVERED]**
- 🔴 **[CROSS-BOUNDARY-CONTRACT-FREEZE]**

## 🔴 Pacing & budget correctness
- 🔴 **[MODE-DEADLINE-UNREACHABLE-AND-ERASED]**
- 🟡 **[PACING-ROLE-FLOORS]**
- 🟡 **[PACING-PROJ-VOLATILE]**
- ⬜ **[JHT-KIMI-OPTIMIZE]** *(M4)*
- ⬜ **[SOURCE-YIELD-MEMORY]**
- ⬜ **[SCORE-FEEDBACK-LOOP]**
- ⬜ **[JHT-SENTINELLA-OPTIMIZE]**
- ⚪ **[B1-DETERMINISTIC-PACING]**

## 🌐 Web & cloud sync
- 🟡 **[WEB-SQLITE-SCHEMA-AUTHORITY]**
- 🟡 **[APPLIED-STATE-NEVER-COMES-HOME]**
- 🟡 **[TEAM-PAGES-STILL-SPEAK-EMOJI]**
- 🔴 **[POSITIONS-TABLE-MISALIGNED]**
- 🟡 **[JHT-INTERACTION-PLANES]**
- 🟡 **[JHT-WEB-LOCAL-ROUTES-ORPHANED]**
- ⬜ **[JHT-REALTIME-SCALE]**
- ⬜ **[JHT-CLOUDSYNC-01]**
- 🟡 **[JHT-WEB-DEMO]**
- 🟠 **[JHT-CASE-STUDIES-WEB]**

## 🖥️ Applicazione desktop e ufficio nativo
- ⬜ **[JHT-DESKTOP-TAURI]**
- ⬜ **[JHT-TEAM-API-BOUNDARY]**
- 🟡 **[WINDOWS-UPDATER-ASKS-FOR-PHANTOM-ASSETS]**
- ⬜ Tray icon + notifiche native dal gioco.
- ⬜ **[JHT-DESKTOP-RECOVERY]**
- ⬜ Friendly error handling (ECONNREFUSED/401/tunnel-down → actionable cards).
- ⬜ Embedded help/FAQ (context-sensitive "?" + offline FAQ).
- ⬜ **[JHT-CLOUD-SYNC-THEME]**
- ⬜ **[JHT-DESKTOP-06]**
- 🟡 **[PACK-INSTALLER-SIZE]**
- 🟡 **[JHT-DESKTOP-LINKEDIN-SANDBOX]**
- ⚪ **[JHT-DESKTOP-API-TEAM-RETURN]** *(parked)*
- ⬜ **[JHT-DESKTOP-KIMI-WINDOWS]**
- ⬜ **[JHT-DESKTOP-MAC-PODMAN-PKG]**
- ⬜ **[JHT-DESKTOP-MAC-UNINSTALL]**
- ⚪ **[JHT-WINDOWS-SHIM-PWSH]** *(nota, non è un difetto)*
- ⬜ **[JHT-DESKTOP-MAIL-ALLOWLIST]**

## 🤖 Team & agents
- 🟡 **[JHT-LOCAL-MODELS-M5]** *(M5 / issue #93)*
- ⬜ **[JHT-RENAME-COORDINATOR]**
- 🆕 **[JHT-CLOSER]**
- ⬜ **[JHT-WELCOME-CAPTAIN-MENTOR-FLAG]**
- ⬜ **[CAPITANO-SPAWN-MODES]**
- ⬜ **[JHT-CAPITANO-PROMPT-DRIFT]**
- 🆕 **[GEOCODE-NEW-VPS]**
- ⬜ **[JHT-TOKEN-MONITOR-WRITER-CRITIC]**
- ⬜ **[JHT-MENTOR-SKILLS]** *(M6)*
- ⬜ **[JHT-AGENT-PROMPTS-V2]**
- ⬜ Skill distribution punch list

## 🗄️ DB & filesystem hygiene
- ⬜ **[JHT-DB-RENAME]**
- ⬜ **[JHT-DB-CLEANUP]**
- ⬜ **[JHT-HOME-REFACTOR]**
- ⚪ Schema evolution ideas (position_events, critic rounds, captain_decisions…) *(M7)* → [`docs/internal/roadmap/db-schema-optimization.md`]

## 🌍 i18n residuals
- ⬜ `LOCALES` drift
- ⬜ `mantenitore` agent overlays (6 languages) + translator-facing guide + native-speaker review pass.

## 🛠️ Infra & CLI
- 🟡 **[JHT-BROKER-LOGIN-SANDBOX]**
- ⬜ **[JHT-RUNTIME-PODMAN]**
- 🟡 **[JHT-CLI-AGENT-PARITY]**
- 🟡 **[INFRA-VERCEL-QUOTA]**
- ⬜ **[JHT-FILEBRIDGE-REALTIME]**
- 🟡 **[INFRA-SUPABASE-PERF]**
- 🟡 **[JHT-CLI-WIN-NATIVE]**
- 🟡 **[JHT-INSTALL-SPLIT]**
- 🟡 **[JHT-E2E-STALE]**
- ⬜ **[JHT-NPM-AUDIT-TOOLING]**

## 📦 Docs & launch assets (maintainer)
- 🟡 **[JHT-LAUNCH-03]**
- 🟡 **[JHT-LAUNCH-08]**
- 🟡 **[JHT-LAUNCH-09]**
- ⬜ **[JHT-LAUNCH-05]** monitoring freeze window · **[JHT-LAUNCH-06]** awesome-lists submissions · **[JHT-LAUNCH-07]** beta recruitment · **[JHT-LAUNCH-10]** press kit.
- ⬜ **[JHT-TEST-CAMPAIGN]**
- ⬜ Phase-5 leftovers

## 🆕 Aperti dal 2026-08-10 (dal registro operativo)
- 🟡 **[SCORE-DIMENSIONS-EXCEED-THEIR-CAP]**
- 🔴 **[DB-PATH-FALLS-BACK-INSTEAD-OF-STOPPING]**
- 🔴 **[TWO-FLAKY-TESTS-ARE-NORMALISING-RED]**
- 🟡 **[ANALYTICS-CONSENT-MAY-BE-STRICTER-THAN-REQUIRED]**
- ⬜ **[NO-GUARANTEE-THE-BEST-CV-IS-THE-ONE-DELIVERED]**
- ⬜ **[LOCAL-FIRST-JUDGEMENT-ON-POSITIONS]**
- ⬜ **[AGENT-AVATARS-SHOULD-BE-COLOURLESS]**
- 🔴 **[WIN-USERDIR-SURVIVES-REINSTALL]**
- 🔴 **[WIN-INTERACT-ACTION-UNDECLARED]**
- 🔴 **[WIN-TOUR-DRAWS-OVER-SETUP]**
- ⬜ **[WIN-CLOSER-EMAIL-NEEDS-THE-BROKER]** *(dichiarato il 2026-10-09, decisione di prodotto: residuo, non riaperto)*
- ⬜ **[WIN-LOCAL-SCORER-UNREACHABLE]** *(dichiarato il 2026-10-09, non riaperto)*
- ⬜ **[WIN-RENDERER-SILENTLY-REVERTED]**

## 💡 Parked ideas
- ⚪ **[JHT-POSITIONS-SWIPE-TRIAGE]** *(M1)*
- ⚪ **[JHT-MANAGED-INBOX]**
- ⚪ **[JHT-LOCAL-VAULT]** *(M3)*
- ⚪ **[JHT-COST-VALIDATION-PAYG-VS-SUB]** *(M8)*
- ⚪ Idle enrichment & LLM-driven position classifier → files in [`docs/internal/roadmap/`](docs/internal/roadmap/).
