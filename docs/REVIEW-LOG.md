# 📚 Review Log — JHT Documents

> ⚠️ **GENERATED FILE — DO NOT EDIT BY HAND.**
> Source of truth: [`review-log.json`](./review-log.json).
> Rigenera con: `python scripts/review-log.py sync`.

Indice di tutti i documenti markdown del repo, con stato di revisione personale.
Serve a tenere traccia di cosa hai già letto e cosa è cambiato dopo l'ultima lettura.

## 🧭 Come si usa

- **👀 Rev** = data in cui *tu* hai letto/validato il file. Vuota (`—`) se non l'hai mai letto.
- **🔄 Update** = data dell'ultimo commit che ha toccato il file (auto, da `git log`).
- **❗ Rivedi** = ✅ se `Rev` è `—` oppure `Rev < Update`. 🟢 se sei in pari.
- Marcare come letto oggi:    `python scripts/review-log.py mark <repo-relative-path>`
- Riallineare dopo nuovi file: `python scripts/review-log.py sync`
- Editare descrizione:         apri [`review-log.json`](./review-log.json) e modifica `description`, poi `sync`.

## 🗂️ Legenda emoji aree

- 🏠 root · 🐙 .github · 🤖 agenti · 📐 architettura/manuali · 🛠️ skill globali · 💂 skill Sentinella
- 📖 about · 📜 ADR · 🧭 guide · 🔒 security · 🛰️ internal · 🧪 sessions · 🗄️ supabase

---


## 🏠 Root

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [README.md](../README.md) | Entry point pubblico: prodotto, requisiti, installazione nativa e CLI, primo orientamento | — | 2026-08-04 | ✅ |
| [BACKLOG.md](../BACKLOG.md) | Roadmap completa con priorità e fasi 1-6, blocker pre-launch | — | 2026-08-07 | ✅ |
| [CHANGELOG.md](../CHANGELOG.md) | Changelog formato Keep-a-Changelog, cronologia rilasci | — | 2026-08-07 | ✅ |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Contributor Covenant 2.1, contatto `support@jobhunterteam.ai` | — | 2026-07-26 | ✅ |
| [SECURITY.md](../SECURITY.md) | Policy di disclosure, trust model corrente, copertura e stato hardening | — | 2026-08-04 | ✅ |


## 🐙 .github

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md) | Guida contributors EN, link CoC, workflow PR | — | 2026-08-04 | ✅ |
| [.github/ISSUE_TEMPLATE/bug_report.md](../.github/ISSUE_TEMPLATE/bug_report.md) | Template GitHub issue per bug | — | 2026-08-04 | ✅ |
| [.github/ISSUE_TEMPLATE/feature_request.md](../.github/ISSUE_TEMPLATE/feature_request.md) | Template GitHub issue per feature request | — | 2026-07-19 | ✅ |
| [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) | Template PR con summary + test plan | — | 2026-05-31 | ✅ |
| [.github/ISSUE_TEMPLATE/beta_feedback.md](../.github/ISSUE_TEMPLATE/beta_feedback.md) | Template GitHub issue per feedback riproducibile su una sessione JHT | — | 2026-08-04 | ✅ |


## 🤖 Agent prompts

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [agents/capitano/capitano.md](../agents/capitano/capitano.md) | 🎖️ Capitano — orchestrator del team, distribuisce ordini | — | 2026-08-04 | ✅ |
| [agents/sentinella/sentinella.md](../agents/sentinella/sentinella.md) | 💂 Sentinella — watchdog rate-limit, fallback del bridge | — | 2026-08-04 | ✅ |
| [agents/scout/scout.md](../agents/scout/scout.md) | 🔭 Scout — ricerca offerte (LinkedIn → ATS → niche → web) | — | 2026-08-04 | ✅ |
| [agents/analista/analista.md](../agents/analista/analista.md) | 🔍 Analista — filtra JD vs profilo, popola companies/highlights | — | 2026-08-04 | ✅ |
| [agents/scorer/scorer.md](../agents/scorer/scorer.md) | 🎯 Scorer — assegna score 0-100 alle posizioni filtrate | — | 2026-08-04 | ✅ |
| [agents/scrittore/scrittore.md](../agents/scrittore/scrittore.md) | ✍️ Scrittore — genera CV + cover letter per posizione | — | 2026-08-04 | ✅ |
| [agents/critico/critico.md](../agents/critico/critico.md) | 🧐 Critico — review qualità CV/cover prima dell'invio | — | 2026-08-04 | ✅ |
| [agents/assistente/assistente.md](../agents/assistente/assistente.md) | 🤝 Assistente — config profilo utente, supporto setup | — | 2026-08-04 | ✅ |
| [agents/capitano/missions/thermostat-test.md](../agents/capitano/missions/thermostat-test.md) | 🌡️ Missione opt-in test termostato senza Sentinella | — | 2026-05-05 | ✅ |
| [agents/dottore/dottore.md](../agents/dottore/dottore.md) | 👨‍⚕️ Dottore — health-check + manutenzione one-shot (~30 min, watchdog) | — | 2026-08-04 | ✅ |
| [agents/mantenitore/mantenitore.md](../agents/mantenitore/mantenitore.md) | 👷‍♂️ MANTENITORE — infra health + standardization — You are the Mantenitore (Maintainer) of the JHT team. | — | 2026-08-04 | ✅ |
| [agents/mentor/mentor.md](../agents/mentor/mentor.md) | 🧙‍♂️ MENTOR — career mentor — You are Mentor — career mentor to the user (the human owner of the profile, not an agent). | — | 2026-08-04 | ✅ |


## 📐 Team architecture & manuals

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [agents/_team/architettura.md](../agents/_team/architettura.md) | Architettura V5 4-tier (Bridge → Sentinella → Capitano → agenti) | — | 2026-07-03 | ✅ |
| [agents/_team/team-rules.md](../agents/_team/team-rules.md) | Regole condivise team (RULE-T*), inherited da tutti gli agenti | — | 2026-08-04 | ✅ |
| [agents/_manual/anti-collision.md](../agents/_manual/anti-collision.md) | Come evitare scritture concorrenti sul DB tra agenti | — | 2026-06-02 | ✅ |
| [agents/_manual/communication-rules.md](../agents/_manual/communication-rules.md) | Regole comunicazione inter-agent (jht-tmux-send, jht-send) | — | 2026-07-29 | ✅ |
| [agents/_manual/db-schema.md](../agents/_manual/db-schema.md) | Schema SQLite `~/.jht/jobs.db` (5 tabelle) | — | 2026-07-24 | ✅ |
| [agents/_manual/sessions.md](../agents/_manual/sessions.md) | Gestione sessioni team (start/stop/reset) | — | 2026-06-14 | ✅ |
| [agents/_team/role-taxonomy.md](../agents/_team/role-taxonomy.md) | 🗂️ role_family — emergent taxonomy MODEL (no hardcoded categories) — What role_family is. | — | 2026-06-21 | ✅ |


## 🛠️ Skill globali

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [agents/_skills/db-insert/SKILL.md](../agents/_skills/db-insert/SKILL.md) | INSERT su positions/companies/position_highlights | — | 2026-07-03 | ✅ |
| [agents/_skills/db-query/SKILL.md](../agents/_skills/db-query/SKILL.md) | SELECT helper read-only sul DB jobs | — | 2026-08-03 | ✅ |
| [agents/_skills/db-update/SKILL.md](../agents/_skills/db-update/SKILL.md) | UPDATE stato/score di righe esistenti | — | 2026-08-03 | ✅ |
| [agents/_skills/rate-budget/SKILL.md](../agents/_skills/rate-budget/SKILL.md) | Calcolo budget rate-limit per provider | — | 2026-06-30 | ✅ |
| [agents/_skills/tmux-send/SKILL.md](../agents/_skills/tmux-send/SKILL.md) | Invio messaggi inter-agent via tmux send-keys | — | 2026-07-30 | ✅ |
| [agents/_skills/throttle/SKILL.md](../agents/_skills/throttle/SKILL.md) | Throttle azioni agente per restare in budget | — | 2026-07-30 | ✅ |
| [agents/_skills/throttle/DESIGN-NOTES.md](../agents/_skills/throttle/DESIGN-NOTES.md) | Design throttle "blocco hard" — ⚠️ da rivedere prima rollout | — | 2026-07-30 | ✅ |
| [agents/_skills/application-flow/SKILL.md](../agents/_skills/application-flow/SKILL.md) | Gates DB Scrittore (anti-rewriting + claim) + path $JHT_USER_DIR + housekeeping | — | 2026-07-11 | ✅ |
| [agents/_skills/bridge-mailbox/SKILL.md](../agents/_skills/bridge-mailbox/SKILL.md) | Drain mailbox bridge a inizio turno (recupera tick persi via tmux rc=3) | — | 2026-05-10 | ✅ |
| [agents/_skills/bridge-pacing/SKILL.md](../agents/_skills/bridge-pacing/SKILL.md) | Formula calibrazione throttle 15-min: durata = (f/100)·60/c con esempi | — | 2026-07-28 | ✅ |
| [agents/_skills/cache-prune/SKILL.md](../agents/_skills/cache-prune/SKILL.md) | Reclaim cache uv + codex sqlite ~24h (Dottore-only, manutenzione) | — | 2026-06-04 | ✅ |
| [agents/_skills/chat-web/SKILL.md](../agents/_skills/chat-web/SKILL.md) | Risposta utente da web UI via jht-send + --partial (Capitano + Assistente) | — | 2026-07-19 | ✅ |
| [agents/_skills/critic-loop/SKILL.md](../agents/_skills/critic-loop/SKILL.md) | 3 round Critico autonomi provider-aware (Scrittore-only) | — | 2026-07-13 | ✅ |
| [agents/_skills/cv-structure/SKILL.md](../agents/_skills/cv-structure/SKILL.md) | 6 sezioni CV canoniche, verbi action, tono per company type | — | 2026-07-01 | ✅ |
| [agents/_skills/liveness-check/SKILL.md](../agents/_skills/liveness-check/SKILL.md) | Diagnosi 10 pattern + respawn con contesto (zombie detection per Dottore) | — | 2026-06-04 | ✅ |
| [agents/_skills/onboarding-flow/SKILL.md](../agents/_skills/onboarding-flow/SKILL.md) | Protocollo conversazionale onboarding + checklist blocco/ricca + upload file | — | 2026-06-06 | ✅ |
| [agents/_skills/pipeline-triage/SKILL.md](../agents/_skills/pipeline-triage/SKILL.md) | Scaling data-driven via db_query stats — chi spawnare/spegnere | — | 2026-07-29 | ✅ |
| [agents/_skills/profile-summaries/SKILL.md](../agents/_skills/profile-summaries/SKILL.md) | I 4 MD discorsivi about/preferences/goals/strengths in prima persona | — | 2026-06-06 | ✅ |
| [agents/_skills/profile-yaml/SKILL.md](../agents/_skills/profile-yaml/SKILL.md) | Gestione candidate_profile.yml live + validazione + ready.flag | — | 2026-07-30 | ✅ |
| [agents/_skills/py-tools-audit/SKILL.md](../agents/_skills/py-tools-audit/SKILL.md) | Audit ~weekly pacchetti Python in 2 round Dottore con state file | — | 2026-06-04 | ✅ |
| [agents/_skills/sentinel-orders/SKILL.md](../agents/_skills/sentinel-orders/SKILL.md) | Tabella throttle 0-4 + tutti i tipi ordine Sentinella + warning timeout N+30 | — | 2026-07-28 | ✅ |
| [agents/_skills/spawn-agent/SKILL.md](../agents/_skills/spawn-agent/SKILL.md) | Spawn agente via start-agent.sh + kick-off + verifica boot (Capitano-only) | — | 2026-07-30 | ✅ |
| [agents/_skills/agent-emergency/SKILL.md](../agents/_skills/agent-emergency/SKILL.md) | Capitano — gestisce un agente sospettato BLOCCATO IN UN LOOP ATTIVO (vivo e che genera turni, ma ripete lo stesso… | — | 2026-07-30 | ✅ |
| [agents/_skills/blind-review/SKILL.md](../agents/_skills/blind-review/SKILL.md) | The Critic's full review protocol — receive PDF + JD, run a blind review (no profile access), produce a… | — | 2026-07-01 | ✅ |
| [agents/_skills/captain-diary/SKILL.md](../agents/_skills/captain-diary/SKILL.md) | Daily handoff diary for the Captain. | — | 2026-08-03 | ✅ |
| [agents/_skills/circles-and-sources/SKILL.md](../agents/_skills/circles-and-sources/SKILL.md) | Strategy map for what to search WHERE, derived entirely from the candidate profile. | — | 2026-06-05 | ✅ |
| [agents/_skills/cv-disk-audit/SKILL.md](../agents/_skills/cv-disk-audit/SKILL.md) | Healthcheck periodico (Dottore) per riconciliare CV su disk e cv_pdf_path nel DB. | — | 2026-05-17 | ✅ |
| [agents/_skills/daily-restart-wave/SKILL.md](../agents/_skills/daily-restart-wave/SKILL.md) | Pre-emptive mass-restart of every team agent once per 24h for context freshness. | — | 2026-06-04 | ✅ |
| [agents/_skills/email-monitor/SKILL.md](../agents/_skills/email-monitor/SKILL.md) | Day-start sourcing dalla casella email DEDICATA del team (l'utente vi inoltra i propri job alert). | — | 2026-07-30 | ✅ |
| [agents/_skills/expiration-tracking/SKILL.md](../agents/_skills/expiration-tracking/SKILL.md) | Estrae deadline dal JD (helper deadline_extract) e produce alert utente quando una candidatura READY sta per… | — | 2026-08-04 | ✅ |
| [agents/_skills/feedback-query/SKILL.md](../agents/_skills/feedback-query/SKILL.md) | Read user feedback (like/dislike/hide/star) for a given position from the cloud. | — | 2026-07-28 | ✅ |
| [agents/_skills/format-time/SKILL.md](../agents/_skills/format-time/SKILL.md) | Convert UTC timestamps to the user's timezone before showing them in chat, charts, Telegram, or any user-facing… | — | 2026-07-03 | ✅ |
| [agents/_skills/game-reply-options/SKILL.md](../agents/_skills/game-reply-options/SKILL.md) | Offer 2-5 context-specific clickable reply buttons in the JHT game chat when they genuinely make the user's next… | — | 2026-07-19 | ✅ |
| [agents/_skills/location-enrichment/SKILL.md](../agents/_skills/location-enrichment/SKILL.md) | Standardize positions.location free-text into structured loc_/work_/role_family columns BEFORE marking any… | — | 2026-07-30 | ✅ |
| [agents/_skills/logo-extraction/SKILL.md](../agents/_skills/logo-extraction/SKILL.md) | Extract the company logo for a company in the companies table and store it as a small base64 data-URI (max ~35KB,… | — | 2026-07-30 | ✅ |
| [agents/_skills/maintainer-sweep/SKILL.md](../agents/_skills/maintainer-sweep/SKILL.md) | Lo sweep di manutenzione INFRA del Mantenitore 👷‍♂️ (gemello del Dottore, scope infrastruttura non agenti). | — | 2026-07-30 | ✅ |
| [agents/_skills/mentor-output/SKILL.md](../agents/_skills/mentor-output/SKILL.md) | How the Mentor speaks once a pattern from mentor-patterns has crossed the threshold. | — | 2026-05-13 | ✅ |
| [agents/_skills/mentor-patterns/SKILL.md](../agents/_skills/mentor-patterns/SKILL.md) | The five patterns the Mentor hunts in the records to decide WHEN to speak. | — | 2026-07-28 | ✅ |
| [agents/_skills/notify-user/SKILL.md](../agents/_skills/notify-user/SKILL.md) | Notify the user with automatic fallback. | — | 2026-08-04 | ✅ |
| [agents/_skills/office-geocoding/SKILL.md](../agents/_skills/office-geocoding/SKILL.md) | Geocode the precise office building (lat/lon/address) for a position AFTER location-enrichment has populated… | — | 2026-08-03 | ✅ |
| [agents/_skills/parse-cv/SKILL.md](../agents/_skills/parse-cv/SKILL.md) | Pre-process a CV/profile file (PDF, DOCX, ODT, RTF) into plain text BEFORE feeding it to the LLM context. | — | 2026-05-18 | ✅ |
| [agents/_skills/position-insert/SKILL.md](../agents/_skills/position-insert/SKILL.md) | The 5-gate sequence the Scout runs for EACH candidate position before INSERTing into positions: dedup → link… | — | 2026-08-03 | ✅ |
| [agents/_skills/profile-schema/SKILL.md](../agents/_skills/profile-schema/SKILL.md) | Single source of truth dello SCHEMA del candidate_profile.yml — il formato canonico che TUTTO il team produce e… | — | 2026-07-30 | ✅ |
| [agents/_skills/recheck-liveness/SKILL.md](../agents/_skills/recheck-liveness/SKILL.md) | Verifica se un annuncio di lavoro è ANCORA APERTO senza falsi-aperti. | — | 2026-08-03 | ✅ |
| [agents/_skills/resilience/SKILL.md](../agents/_skills/resilience/SKILL.md) | Resilience — never give up silently on a broken tool — When a mission-critical tool fails, NEVER degrade silently or report "queue exhausted"/new=0. | — | 2026-08-03 | ✅ |
| [agents/_skills/salary-estimate/SKILL.md](../agents/_skills/salary-estimate/SKILL.md) | Stima salariale gerarchica per il Scorer (bug 27). | — | 2026-07-30 | ✅ |
| [agents/_skills/scaling-calc/SKILL.md](../agents/_skills/scaling-calc/SKILL.md) | 🎚️ scaling-calc — salire di marcia per gradini, non in 6ª — Calibrazione graduale del roster — misura il burn di 1 worker, calcola quanti worker e con quale throttle servono… | — | 2026-08-03 | ✅ |
| [agents/_skills/scout-coord/SKILL.md](../agents/_skills/scout-coord/SKILL.md) | Boot-time coordination protocol between multiple Scouts. | — | 2026-05-22 | ✅ |
| [agents/_skills/scout-web-access/SKILL.md](../agents/_skills/scout-web-access/SKILL.md) | Strato web-access cross-provider per gli Scout (F-2). | — | 2026-06-13 | ✅ |
| [agents/_skills/session-refresh/SKILL.md](../agents/_skills/session-refresh/SKILL.md) | Refresh sessione agente (solo Dottore): gate sul contesto misurato >50%, non sull'età della sessione | — | 2026-07-30 | ✅ |
| [agents/_skills/spawn-doctor/SKILL.md](../agents/_skills/spawn-doctor/SKILL.md) | Spawn a fresh DOTTORE on-demand when you (Capitano/Assistente/Sentinella/Mentor) need an immediate health-check… | — | 2026-05-18 | ✅ |
| [agents/_skills/telegram-send/SKILL.md](../agents/_skills/telegram-send/SKILL.md) | Send a message to the user via Telegram (outbound). | — | 2026-07-01 | ✅ |
| [agents/_skills/user-reply-check/SKILL.md](../agents/_skills/user-reply-check/SKILL.md) | Read user replies that arrived via the web dashboard (fallback channel when Telegram was down/not configured). | — | 2026-08-04 | ✅ |
| [agents/_skills/agent-unblock/SKILL.md](../agents/_skills/agent-unblock/SKILL.md) | Skill Dottore: fase UNBLOCK prima del refresh — riconosce e scioglie i quattro tipi di blocco del team (un blocco che sopravvive = round fallito) | — | 2026-07-29 | ✅ |
| [agents/_skills/chat-worker/SKILL.md](../agents/_skills/chat-worker/SKILL.md) | Skill worker: rispondere alla chat `[CHAT]` del gioco/desktop con un solo `jht-send`, senza aprire lavoro nuovo e senza prendere ordini da quel canale | — | 2026-07-29 | ✅ |
| [agents/_skills/first-run-burst/SKILL.md](../agents/_skills/first-run-burst/SKILL.md) | Skill Capitano: la prima mezz'ora di un utente nuovo — deroga a C-02 per la sola prima finestra, successo = posizioni SCORATE a schermo | — | 2026-07-28 | ✅ |
| [agents/_skills/graceful-shutdown/SKILL.md](../agents/_skills/graceful-shutdown/SKILL.md) | Skill Capitano: chiusura giornata su `[SHUTDOWN]` dell'utente — ogni agente registra dov'era, poi il flag che libera l'uscita dell'app | — | 2026-07-30 | ✅ |
| [agents/_skills/throttle-distribution/SKILL.md](../agents/_skills/throttle-distribution/SKILL.md) | Skill Capitano: convertire un segnale di pacing team-level nella ripartizione per-agente del throttle (un numero unico non significa stesso valore a tutti) | — | 2026-07-28 | ✅ |
| [agents/_skills/recheck-batch/SKILL.md](../agents/_skills/recheck-batch/SKILL.md) | Ricontrollo a lotti delle posizioni: quali sono dovute e in che ordine | — | 2026-07-30 | ✅ |
| [agents/_skills/team-modes/SKILL.md](../agents/_skills/team-modes/SKILL.md) | Le modalita' operative del team e cosa cambia in ciascuna | — | 2026-08-03 | ✅ |
| [agents/_skills/throttle-ack/SKILL.md](../agents/_skills/throttle-ack/SKILL.md) | L'agente firma la propria sveglia: un risveglio non firmato e' prova di stallo | — | 2026-08-03 | ✅ |
| [agents/_skills/throttle-set/SKILL.md](../agents/_skills/throttle-set/SKILL.md) | L'agente registra la pausa nel motore esterno, non nel proprio processo | — | 2026-07-30 | ✅ |


## 💂 Skill Sentinella

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [agents/sentinella/_skills/check-usage-http/SKILL.md](../agents/sentinella/_skills/check-usage-http/SKILL.md) | Check usage via endpoint HTTP provider | — | 2026-04-28 | ✅ |
| [agents/sentinella/_skills/check-usage-tui/SKILL.md](../agents/sentinella/_skills/check-usage-tui/SKILL.md) | Check usage via TUI/CLI provider | — | 2026-04-28 | ✅ |
| [agents/sentinella/_skills/decision-throttle/SKILL.md](../agents/sentinella/_skills/decision-throttle/SKILL.md) | Logica decisione throttle (STEADY/ATTENZIONE/EMERGENZA) | — | 2026-06-21 | ✅ |
| [agents/sentinella/_skills/emergency-handling/SKILL.md](../agents/sentinella/_skills/emergency-handling/SKILL.md) | Gestione emergenze rate (HARD FREEZE, PAUSA TEAM) | — | 2026-08-03 | ✅ |
| [agents/sentinella/_skills/memory-state/SKILL.md](../agents/sentinella/_skills/memory-state/SKILL.md) | Stato in memoria Sentinella tra tick | — | 2026-04-28 | ✅ |
| [agents/sentinella/_skills/order-formats/SKILL.md](../agents/sentinella/_skills/order-formats/SKILL.md) | Format ordini protocollo (MANTIENI/SCALA UP/RIENTRO) | — | 2026-05-22 | ✅ |


## 🎮 game (applicazione desktop)

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [game/PROMPT.md](../game/PROMPT.md) | PROMPT — Prototipo videogioco "JHT: The Office" (esperienza gamificata di Job Hunter Team) — Il progetto game/ è ora l'unica applicazione desktop di Job Hunter Team. | — | 2026-07-19 | ✅ |
| [game/README.md](../game/README.md) | Job Hunter Team — The Office — Godot 4.7 desktop application for Windows, macOS and Linux. | — | 2026-08-04 | ✅ |
| [game/assets/gen-art/LOG.md](../game/assets/gen-art/LOG.md) | 🎨 gen-art — log dell'Art Director (host.invalid:dev1-art) — Asset generati via Codex CLI (tmux codex-dev1), giudicati contro | — | 2026-08-04 | ✅ |
| [game/docs/ANALISI-GIOCHI.md](../game/docs/ANALISI-GIOCHI.md) | Analisi giochi di riferimento — appunti sessione con Leone (2026-07-07) — Analisi guidata, un gioco alla volta: cosa c'è / cosa non c'è / cosa ci piace / cosa non ci piace. | — | 2026-07-07 | ✅ |
| [game/docs/ASSETS.md](../game/docs/ASSETS.md) | Pipeline asset personaggi — Sprite in-world (SVG a layer componibili) | — | 2026-07-30 | ✅ |
| [game/docs/DATA-ADAPTER.md](../game/docs/DATA-ADAPTER.md) | Data adapter — contratto fra gioco e dati del team — Il gioco non conosce Supabase né la dashboard: parla solo con l'autoload | — | 2026-07-11 | ✅ |
| [game/docs/FIRST-RUN.md](../game/docs/FIRST-RUN.md) | First-run conversation contract — The office must be understandable before Docker or an LLM is available. | — | 2026-07-22 | ✅ |
| [game/docs/GDD.md](../game/docs/GDD.md) | JHT: The Office — current product design — The Godot application is the only desktop client for Job Hunter Team. | — | 2026-07-29 | ✅ |
| [game/docs/RESEARCH-DOSSIER.md](../game/docs/RESEARCH-DOSSIER.md) | Game Research Dossier — "The Box" (versione gamificata di Job Hunter Team) — Materiale di supporto per le sessioni che sviluppano game/ (branch work3-dev1). | — | 2026-07-07 | ✅ |
| [game/docs/ROADMAP.md](../game/docs/ROADMAP.md) | Native application roadmap — The Electron-to-Godot migration, live data views, embedded console and | — | 2026-07-19 | ✅ |
| [game/docs/SPRITES.md](../game/docs/SPRITES.md) | Sprite agenti — contratto spritesheet (v1, 2026-07-11) — Gli agenti in-world passano dagli SVG a parti (CharacterRig) a spritesheet | — | 2026-07-30 | ✅ |
| [game/assets/_attic/README.md](../game/assets/_attic/README.md) | Perche' questi asset sono archiviati invece che cancellati, e come rientrerebbero | — | 2026-08-03 | ✅ |
| [game/assets/icons/SOURCES.md](../game/assets/icons/SOURCES.md) | Provenienza ufficiale, condizioni d'uso e varianti Docker/Telegram immutate impiegate dalle icone della sidebar Godot | — | 2026-08-07 | ✅ |


## 📖 docs/about

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/about/STORY.md](./about/STORY.md) | Origin story (legacy 200 offerte/5 colloqui in 2 settimane) | — | 2026-08-04 | ✅ |
| [docs/about/VISION.md](./about/VISION.md) | Vision long-term, Maestro 🧙‍♂️, "AI on the side of workers | — | 2026-07-01 | ✅ |
| [docs/about/ROADMAP.md](./about/ROADMAP.md) | Roadmap pubblica: stato verificato, orizzonti e direzioni di prodotto | — | 2026-08-04 | ✅ |
| [docs/about/PROVIDERS.md](./about/PROVIDERS.md) | Matrice provider Claude/Codex/Kimi con costi e tier | — | 2026-07-03 | ✅ |
| [docs/about/MONITORING.md](./about/MONITORING.md) | Stack monitoring V5 (Bridge + Sentinella event-driven) | — | 2026-08-04 | ✅ |
| [docs/about/RESULTS.md](./about/RESULTS.md) | Risultati reali utenti beta (matrice persona × provider) | — | 2026-07-03 | ✅ |
| [docs/about/README.md](./about/README.md) | 🎯 docs/about — what JHT is, and whether it works — Public-facing documentation for anyone evaluating Job Hunter Team. | — | 2026-08-05 | ✅ |
| [docs/about/TUTORIAL-GAME-SCREENSHOTS.md](./about/TUTORIAL-GAME-SCREENSHOTS.md) | Provenance, privacy attestation, and hashes for the public game tutorial screenshots | — | 2026-08-05 | ✅ |


## 📜 docs/adr (Architecture Decision Records)

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/adr/README.md](./adr/README.md) | Indice ADR + convenzione di scrittura | — | 2026-06-20 | ✅ |
| [docs/adr/0001-colima-not-docker-desktop.md](./adr/0001-colima-not-docker-desktop.md) | ADR-0001: Colima invece di Docker Desktop su macOS | — | 2026-06-20 | ✅ |
| [docs/adr/0002-three-supported-agent-clis.md](./adr/0002-three-supported-agent-clis.md) | ADR-0002: 3 CLI supportate (Claude Code, Codex, Kimi) | — | 2026-04-28 | ✅ |
| [docs/adr/0003-single-writer-team.md](./adr/0003-single-writer-team.md) | ADR-0003: single-writer pattern sul DB | — | 2026-06-13 | ✅ |
| [docs/adr/0004-subscription-only-no-api-keys.md](./adr/0004-subscription-only-no-api-keys.md) | ADR-0004: solo subscription, no API key | — | 2026-04-17 | ✅ |
| [docs/adr/0005-provider-risk-and-mitigation.md](./adr/0005-provider-risk-and-mitigation.md) | 0005 — Provider risk and mitigation — JHT runs on third-party LLM subscriptions (Claude Max, Codex Plus/Pro, Kimi Pro) consumed by autonomous agents in… | — | 2026-07-03 | ✅ |
| [docs/adr/0006-user-choice-container-runtime-macos.md](./adr/0006-user-choice-container-runtime-macos.md) | 0006 — User chooses the container runtime on macOS (Colima or Docker Desktop) — ADR-0001 mandated Colima as the only container runtime on macOS, because | — | 2026-06-20 | ✅ |


## 🧭 docs/guides

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/guides/AI-AGENT-INTEGRATION.md](./guides/AI-AGENT-INTEGRATION.md) | Runbook sicuro per assistenti AI che installano, configurano e verificano la CLI | — | 2026-08-04 | ✅ |
| [docs/guides/BETA.md](./guides/BETA.md) | Canali pubblici per test, feedback ed evidenze riproducibili senza dati personali | — | 2026-08-04 | ✅ |
| [docs/guides/VPS-SETUP.md](./guides/VPS-SETUP.md) | Setup CLI manuale su VPS Linux esistente, senza credenziali o infrastruttura reale negli esempi | — | 2026-08-04 | ✅ |
| [docs/guides/CLI-INSTALL.md](./guides/CLI-INSTALL.md) | Installazione CLI: comportamento verificato di install.sh/install.ps1, file creati e limiti | — | 2026-08-05 | ✅ |
| [docs/guides/CLI-REFERENCE.md](./guides/CLI-REFERENCE.md) | ⌨️ CLI Reference — jht — Systematic reference of every jht command. | 2026-07-30 | 2026-08-04 | ✅ |
| [docs/guides/EMAIL-FORWARDING.md](./guides/EMAIL-FORWARDING.md) | 📧 Email Forwarding — feed the team your job alerts — Give the team a dedicated email address and auto-forward your job-alert | — | 2026-07-25 | ✅ |
| [docs/guides/FEEDBACK-TICKETING.md](./guides/FEEDBACK-TICKETING.md) | Runbook delle superfici correnti e dell'endpoint /api/feedback | — | 2026-08-05 | ✅ |
| [docs/guides/QUICKSTART.md](./guides/QUICKSTART.md) | Quickstart pubblico: requisiti, app nativa, CLI, setup da agente e sorgenti | — | 2026-08-05 | ✅ |
| [docs/guides/README.md](./guides/README.md) | 📘 docs/guides — user & operator guides — How to install, run, and operate Job Hunter Team. | — | 2026-08-04 | ✅ |
| [docs/guides/VPS-SETUP-WIZARD.md](./guides/VPS-SETUP-WIZARD.md) | VPS setup from the native office — This is the current non-terminal path for running Job Hunter Team on an | — | 2026-07-26 | ✅ |
| [docs/guides/ADDING-A-PROVIDER.md](./guides/ADDING-A-PROVIDER.md) | Guida contributor: gate ADR-0002, touchpoint runtime/provider, evidenza live richiesta e check anti-drift | — | 2026-08-03 | ✅ |
| [docs/guides/LOCAL-SCORER.md](./guides/LOCAL-SCORER.md) | Experimental role-scoped Local Scorer setup, quality harness, hardware evidence requirements, and explicit zero-cloud limits | 2026-08-03 | 2026-08-03 | 🟢 |
| [docs/guides/M4-EVIDENCE-BUNDLES.md](./guides/M4-EVIDENCE-BUNDLES.md) | Versioned M4 evidence-bundle operator guide: scrubbed export boundary, hashes, provenance classes, fixture/live fail-closed rules, and external-validation limits | — | 2026-08-03 | ✅ |
| [docs/guides/TUTORIALS.md](./guides/TUTORIALS.md) | Text-first game and web tutorials: prerequisites, ordered actions, expected results, and optional video alternatives | — | 2026-08-05 | ✅ |
| [docs/guides/TUTORIALS-LOCALIZATIONS.md](./guides/TUTORIALS-LOCALIZATIONS.md) | Localized source copy for the public text-first game and web tutorials in Italian, Spanish, French, German, Portuguese and Hungarian | — | 2026-08-05 | ✅ |


## 🛰️ docs/internal

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/internal/README.md](./internal/README.md) | 📚 docs/internal — indice — Note di lavoro interne: design lock, spec evergreen, postmortem e investigazioni. | — | 2026-08-07 | ✅ |
| [docs/internal/architecture/2026-05-19-dashboard-routing-cases.md](./internal/architecture/2026-05-19-dashboard-routing-cases.md) | 🧭 Dashboard routing — casistica completa — File: web/app/(protected)/dashboard/page.tsx | — | 2026-06-13 | ✅ |
| [docs/internal/architecture/2026-05-20-world-globe-feature.md](./internal/architecture/2026-05-20-world-globe-feature.md) | 🌍 Mappamondo interattivo dashboard — design doc — Stato: design lockato, implementazione non ancora iniziata | — | 2026-06-13 | ✅ |
| [docs/internal/architecture/2026-05-25-work-hours-design.md](./internal/architecture/2026-05-25-work-hours-design.md) | 🗓️ Work hours UI — design + monitoring settimanale — Sessione di design 2026-05-25. | — | 2026-06-13 | ✅ |
| [docs/internal/architecture/2026-06-13-fix-batch-recheck-pacing-design.md](./internal/architecture/2026-06-13-fix-batch-recheck-pacing-design.md) | 🔧 Fix-batch 2026-06-13 — recheck quality · scout-resume · pacing · non_producing · totalQuota — Stato: approvato dall'utente ("implementa tutto"), distribuito a 3. | — | 2026-06-14 | ✅ |
| [docs/internal/architecture/2026-06-13-maintainer-toolhealth-resilience-design.md](./internal/architecture/2026-06-13-maintainer-toolhealth-resilience-design.md) | 👷‍♂️ Mantenitore 👷‍♂️ + Tool-Health + Resilience — Design unificato — Data: 2026-06-13 · Autori: dev1, dev2, dev3 (panel) · Stato: approvato dall'utente, in implementazione | — | 2026-06-25 | ✅ |
| [docs/internal/architecture/2026-06-15-interaction-planes-redesign-design.md](./internal/architecture/2026-06-15-interaction-planes-redesign-design.md) | Interaction Planes — Redesign (2026-06-15) — Design / decision doc. | — | 2026-08-03 | ✅ |
| [docs/internal/architecture/2026-06-15-lean-comms-redesign.md](./internal/architecture/2026-06-15-lean-comms-redesign.md) | 📡 Lean-comms redesign — pull-default, push solo per l'importante — Data: 2026-06-15 · Owner spec: dev1 · Implementazione: dev1 + dev2 + dev3 (insieme, | — | 2026-07-03 | ✅ |
| [docs/internal/architecture/2026-06-20-data-sync-and-dashboard-split-design.md](./internal/architecture/2026-06-20-data-sync-and-dashboard-split-design.md) | 🔄 Data sync + dashboard split — design (2026-06-20) — Design / decision doc. | — | 2026-07-25 | ✅ |
| [docs/internal/architecture/2026-06-20-taxonomy-brain-driven-redesign.md](./internal/architecture/2026-06-20-taxonomy-brain-driven-redesign.md) | 🧠 Tassonomia role_family resa BRAIN-DRIVEN — recon, redesign, deploy — Data: 2026-06-20 · Stato: ✅ IMPLEMENTATO + DEPLOYATO + betaA RESETTATO · | — | 2026-07-03 | ✅ |
| [docs/internal/architecture/2026-06-25-bridge-to-sentinella-pull-model.md](./internal/architecture/2026-06-25-bridge-to-sentinella-pull-model.md) | 🔀 Pacing: bridge → Sentinella unica, Capitano pull-on-demand — Data: 2026-06-25 · Branch: dev2 · Stato: progettato + implementato (gated: merge utente → redeploy) | — | 2026-07-03 | ✅ |
| [docs/internal/architecture/2026-06-26-capitano-graceful-scaling-paced-consumption.md](./internal/architecture/2026-06-26-capitano-graceful-scaling-paced-consumption.md) | 🎚️ Scaling graduale del Capitano + consumo spalmato sulla giornata (design 2026-06-26) — Movente (osservato dal vivo su betaB/Kimi, 2026-06-26): quando il team va ON, il | — | 2026-07-03 | ✅ |
| [docs/internal/architecture/2026-06-28-weekly-pacing-redesign.md](./internal/architecture/2026-06-28-weekly-pacing-redesign.md) | 📐 Weekly pacing redesign — verdetto imperativo, valuta token, debt-aware (2026-06-28) — Due doc gemelli scritti lo stesso giorno sulla stessa causa-radice: vel_weekly è rumoroso perché il contatore provider è… | — | 2026-08-04 | ✅ |
| [docs/internal/architecture/2026-06-29-status-weekly-aware.md](./internal/architecture/2026-06-29-status-weekly-aware.md) | 🧭 Status bi-dimensionale (5h ∧ weekly) — pacing weekly-aware — Data: 2026-06-29 · Branch: dev2 · Stato: prototipo committato, NON deployato | — | 2026-07-03 | ✅ |
| [docs/internal/architecture/2026-07-21-web-sync-realtime-rework.md](./internal/architecture/2026-07-21-web-sync-realtime-rework.md) | ⚡ Web sync Realtime-first + backflow messaggi — design & decision record (2026-07-21) — Decision doc + postmortem. | — | 2026-08-04 | ✅ |
| [docs/internal/architecture/2026-07-22-web-demo-mode-and-welcome.md](./internal/architecture/2026-07-22-web-demo-mode-and-welcome.md) | 🎭 Demo mode + wizard /welcome — design & decision record (2026-07-22 → 07-23) — Design lock. | — | 2026-07-25 | ✅ |
| [docs/internal/architecture/analista-expansion-design.md](./internal/architecture/analista-expansion-design.md) | 🔬 Design-doc — Espansione ruolo ANALISTA — Stato: DRAFT — schema da lockare PRIMA di codare (design-doc-first, ordine lead dev3). | — | 2026-06-14 | ✅ |
| [docs/internal/architecture/bot-telegram.md](./internal/architecture/bot-telegram.md) | 💬 JHT bot Telegram — design, scelta canale, ingest documenti — Doc consolidato il 2026-05-13 unificando | — | 2026-07-29 | ✅ |
| [docs/internal/architecture/bridges.md](./internal/architecture/bridges.md) | I tre bridge deterministici (role-map) — Mappa autorevole dei bridge Python deterministici (no-LLM) che girano setsid | — | 2026-07-30 | ✅ |
| [docs/internal/architecture/candidate-profile-cloud-sync-redesign.md](./internal/architecture/candidate-profile-cloud-sync-redesign.md) | 🧬 Candidate profile — cloud sync redesign — Design doc — da validare prima di implementare. | — | 2026-07-03 | ✅ |
| [docs/internal/architecture/cloud-sync-architecture.md](./internal/architecture/cloud-sync-architecture.md) | ☁️ Cloud sync — architecture & status — Living doc. | — | 2026-07-30 | ✅ |
| [docs/internal/architecture/context-watchdog-spec.md](./internal/architecture/context-watchdog-spec.md) | 🩺 Agent context saturation + reboot periodico via Dottore — Status: MVP SHIPPED 2026-05-31 (daily-restart-wave) — PoC validato 2026-05-20. | — | 2026-06-13 | ✅ |
| [docs/internal/architecture/daemon-sync-redesign.md](./internal/architecture/daemon-sync-redesign.md) | 🔌 Daemon sync — da polling Vercel a Supabase diretto + event-driven — Documento consolidato del redesign del sync daemon↔cloud (tre note datate 24–26/06, qui integrate senza modifiche al contenuto). | — | 2026-07-30 | ✅ |
| [docs/internal/architecture/dottore-redesign-design.md](./internal/architecture/dottore-redesign-design.md) | 🩺 Design-doc — Ridisegno ruolo DOTTORE (context-refresh) — Stato: DRAFT — schema/flow da lockare prima di codare (design-doc-first). | — | 2026-06-14 | ✅ |
| [docs/internal/architecture/file-bridge-on-demand.md](./internal/architecture/file-bridge-on-demand.md) | 📎 File bridge on-demand — architettura & stato — Living doc. | — | 2026-08-07 | ✅ |
| [docs/internal/architecture/kimi-vs-codex-economics.md](./internal/architecture/kimi-vs-codex-economics.md) | 💰 Economia Kimi vs Codex — budget · coordinatori · prezzo (living doc) — Living doc (non datato): riflette lo stato corrente dell'analisi economica dei | — | 2026-07-03 | ✅ |
| [docs/internal/architecture/onboarding-flow.md](./internal/architecture/onboarding-flow.md) | 🚪 Onboarding flow JHT — Stato: design lock — sequenza ufficiale di onboarding utente. | — | 2026-07-26 | ✅ |
| [docs/internal/architecture/skill-distribution.md](./internal/architecture/skill-distribution.md) | 🛠️ Skill distribution — launcher-distributed isolation — Moved verbatim from docs/about/ROADMAP.md in the 2026-07-03 docs restructure (the ROADMAP keeps only the strategic view). | — | 2026-07-03 | ✅ |
| [docs/internal/architecture/usage-monitoring-redesign-design.md](./internal/architecture/usage-monitoring-redesign-design.md) | 📡 Design-doc — Ridisegno monitoraggio usage (Sentinella ↔ Capitano) — Stato: DRAFT (visione utente 2026-06-13). | — | 2026-06-14 | ✅ |
| [docs/internal/experiments/2026-05-03-rate-kimi-weights.md](./internal/experiments/2026-05-03-rate-kimi-weights.md) | ⚖️ 2026-05-03 — Pesi rate-limit Kimi K2: analisi empirica e calibrazione — Il rate budget Kimi K2 e' guidato da input_tokens + output_tokens, | — | 2026-06-13 | ✅ |
| [docs/internal/experiments/2026-05-06-agent-prompts-i18n.md](./internal/experiments/2026-05-06-agent-prompts-i18n.md) | 🌍 Agent prompts i18n — policy lockata 2026-05-13 — Convenzione + infrastruttura di startup per la risoluzione multi-lingua dei file d'identità agenti (agents/<role /<role .md). | — | 2026-06-13 | ✅ |
| [docs/internal/experiments/2026-05-06-prompt-decomposition-skill-vs-manual.md](./internal/experiments/2026-05-06-prompt-decomposition-skill-vs-manual.md) | 🧩 Prompt decomposition — CLAUDE.md vs Skill vs Manual — 📅 2026-05-06 — analisi originata dal refactor di agents/capitano/capitano.md (564 righe, ~14k token). | — | 2026-06-13 | ✅ |
| [docs/internal/experiments/2026-05-23-case-study-staging.md](./internal/experiments/2026-05-23-case-study-staging.md) | 📋 Case Study Staging — Run VPS1 (Codex) + Run Kimi K2 — Purpose: documento di consolidamento per promuovere a docs/about/RESULTS.md come Case Study 2 e 3. | — | 2026-06-13 | ✅ |
| [docs/internal/experiments/2026-05-23-location-playbook.md](./internal/experiments/2026-05-23-location-playbook.md) | 📍 Location enrichment — playbook per gli analisti — Stato: bozza per simulazione | — | 2026-06-13 | ✅ |
| [docs/internal/experiments/2026-05-23-sim-1-location-enrichment-report.md](./internal/experiments/2026-05-23-sim-1-location-enrichment-report.md) | 🧪 Simulazione 1 — location enrichment con Capitano + 3 analisti — Container: jht-sim-d2 (isolato, ~/.jht-sim-d2/) | — | 2026-06-13 | ✅ |
| [docs/internal/experiments/2026-05-23-sim-2-location-enrichment-report.md](./internal/experiments/2026-05-23-sim-2-location-enrichment-report.md) | 🧪 Simulazione 2 — location enrichment con i fix applicati — Container: jht-sim-d2 (resettato dopo sim 1, stesso dataset 206 record vergini) | — | 2026-06-13 | ✅ |
| [docs/internal/experiments/2026-05-23-sim-3-location-enrichment-report.md](./internal/experiments/2026-05-23-sim-3-location-enrichment-report.md) | 🧪 Simulazione 3 — location enrichment su profilo Python Developer — Container: jht-sim-d2 (reset totale via sim-reset.sh) | — | 2026-06-13 | ✅ |
| [docs/internal/experiments/2026-05-25-case-studies-page-handoff.md](./internal/experiments/2026-05-25-case-studies-page-handoff.md) | 🤝 Case studies page — sessione 2026-05-23 → 2026-05-25 handoff — Stato di /case-studies dopo ~3 giorni di lavoro intenso. | — | 2026-07-03 | ✅ |
| [docs/internal/experiments/2026-05-25-sim-4-office-geocoding-report.md](./internal/experiments/2026-05-25-sim-4-office-geocoding-report.md) | 🧪 Simulazione 4 — office geocoding precise + 6 analisti — Data: 2026-05-25 (avvio 22:45 del 2026-05-24, chiusura ~01:50 del 2026-05-25) | — | 2026-06-13 | ✅ |
| [docs/internal/experiments/2026-05-25-sim-5-office-geocoding-mario-rossi-report.md](./internal/experiments/2026-05-25-sim-5-office-geocoding-mario-rossi-report.md) | 🧪 Simulazione 5 — office geocoding su owner (Marton / Tech Writer) — Container: jht-sim-d2 (reset totale, candidate_profile.yml ripristinato su Marton Kovacs) | — | 2026-06-13 | ✅ |
| [docs/internal/experiments/2026-06-13-kimi-quota-tiers-discovery.md](./internal/experiments/2026-06-13-kimi-quota-tiers-discovery.md) | 🔍 Kimi Code — i tre tier di quota e il buco totalQuota (scoperta 2026-06-13) — Contesto: deploy del team su VPS betaB (Kimi, 203.0.113.20) con l'immagine | — | 2026-06-14 | ✅ |
| [docs/internal/landing-image-prompts.md](./internal/landing-image-prompts.md) | 🎨 Prompt immagini — Sito pubblico — Raccolta dei prompt per tutte le immagini del sito pubblico (landing + pagine | — | 2026-07-25 | ✅ |
| [docs/internal/ops/INFRA.md](./internal/ops/INFRA.md) | 🏗️ Infrastructure — Job Hunter Team — 📐 High-level deployment diagram. | — | 2026-08-04 | ✅ |
| [docs/internal/ops/MAINTAINERS.md](./internal/ops/MAINTAINERS.md) | 👥 Maintainers Reference — 🔒 Internal information for project maintainers. | — | 2026-08-07 | ✅ |
| [docs/internal/ops/access-and-credentials.md](./internal/ops/access-and-credentials.md) | 🔐 Access & Credentials — guida consolidata — Last updated: 2026-05-26. | — | 2026-08-03 | ✅ |
| [docs/internal/ops/release.md](./internal/ops/release.md) | 🚢 Release — Cutting a release means pushing a vX.Y.Z tag that points at the production HEAD. | — | 2026-08-05 | ✅ |
| [docs/internal/ops/triage.md](./internal/ops/triage.md) | 🐛 Issue triage workflow — Internal contract for how we handle incoming issues post-launch. | — | 2026-08-05 | ✅ |
| [docs/internal/ops/vps.md](./internal/ops/vps.md) | ☁️ JHT su VPS — design, providers, install UX — Doc consolidato il 2026-05-13 unificando | — | 2026-08-05 | ✅ |
| [docs/internal/postmortems/2026-05-21-halt-weekly-incident.md](./internal/postmortems/2026-05-21-halt-weekly-incident.md) | 🛑 HALT-WEEKLY incident — 2026-05-21 — Manovra di emergenza sulla VPS1 (203.0.113.20, Hetzner CPX22) per evitare la saturazione del weekly cap Codex ProLite… | — | 2026-06-13 | ✅ |
| [docs/internal/postmortems/2026-05-21-vps-bootstrap-fixes-validated.md](./internal/postmortems/2026-05-21-vps-bootstrap-fixes-validated.md) | ✅ 2026-05-21 — VPS bootstrap bugs FIXED & VALIDATED su VPS fresh — I 3 bug bloccanti dello startup VPS documentati il 2026-05-20 (docs/internal/_archive/2026-05-20-vps-bootstrap-bugs.md) sono… | — | 2026-06-13 | ✅ |
| [docs/internal/postmortems/2026-05-21-vps1-run-postmortem.md](./internal/postmortems/2026-05-21-vps1-run-postmortem.md) | 📉 2026-05-21 — VPS1 first run (35h) postmortem — Consolida 3 inchieste sullo stesso run VPS1 (2026-05-19 20:29 → 2026-05-21 07:20 UTC, ≈ 35h) | — | 2026-06-13 | ✅ |
| [docs/internal/postmortems/2026-05-22-vercel-quota-exhaustion.md](./internal/postmortems/2026-05-22-vercel-quota-exhaustion.md) | 💸 Vercel quota exhaustion — jobhunterteam.ai down (HTTP 402) — Snapshot: 2026-05-22 mattina. | — | 2026-06-13 | ✅ |
| [docs/internal/postmortems/2026-06-03-beta-vps-session-corrections.md](./internal/postmortems/2026-06-03-beta-vps-session-corrections.md) | 🔧 Correzioni — sessione beta tester VPS (2026-06-03) — Findings raccolti durante il primo avvio del team su VPS Hetzner di un beta | — | 2026-06-13 | ✅ |
| [docs/internal/postmortems/2026-06-03-diagnosi-pacing-weekly.md](./internal/postmortems/2026-06-03-diagnosi-pacing-weekly.md) | 🔬 DIAGNOSI COLLABORATIVA — pacing weekly (2026-06-03/04) — CASO CHIUSO — Diagnosi condivisa multi-agente (master + dev1 + dev2 + dev3). | — | 2026-06-13 | ✅ |
| [docs/internal/postmortems/2026-06-04-p7-weekly-reset-non-rilevato.md](./internal/postmortems/2026-06-04-p7-weekly-reset-non-rilevato.md) | ⏰ P7 — Reset settimanale non rilevato dagli agenti (2026-06-04) — Finding emerso dopo la chiusura della diagnosi P1-P6 | — | 2026-06-13 | ✅ |
| [docs/internal/postmortems/2026-06-04-scout-geo-concentration.md](./internal/postmortems/2026-06-04-scout-geo-concentration.md) | 🌍 Scout geo-concentration — over-concentrazione su una città (2026-06-04) — Analisi su run beta live (profilo finance, target EU, provider Codex). | — | 2026-06-13 | ✅ |
| [docs/internal/postmortems/2026-06-07-capitano-runaway-scaling-postmortem.md](./internal/postmortems/2026-06-07-capitano-runaway-scaling-postmortem.md) | 📈 Capitano runaway-scaling — postmortem 2026-06-07 — Sulla VPS beta di betaA (203.0.113.10, ubuntu-2gb-hil-1-betaC, profilo betaA@example.com) il Capitano ha scalato il team a 14… | — | 2026-06-13 | ✅ |
| [docs/internal/postmortems/2026-06-11-overspawn-rootcause.md](./internal/postmortems/2026-06-11-overspawn-rootcause.md) | 🔍 Incident & Root-Cause — Overspawn + saturazione weekly Codex (VPS betaC) — VPS: 203.0.113.10 (ubuntu-2gb-hil-1-betaC, Hetzner Hillsboro, 2 GB) | — | 2026-06-13 | ✅ |
| [docs/internal/postmortems/2026-06-13-osservazione-no-intervento.md](./internal/postmortems/2026-06-13-osservazione-no-intervento.md) | 🛑 REGOLA FERREA — Mai intervenire in un team in osservazione/simulazione — 2026-06-13. | — | 2026-06-14 | ✅ |
| [docs/internal/postmortems/2026-06-14-betaA-risveglio-dottore-mantenitore-observation.md](./internal/postmortems/2026-06-14-betaA-risveglio-dottore-mantenitore-observation.md) | 👀 Osservazione — Risveglio betaA 2026-06-14 (Dottore + Mantenitore in azione) — Tipo: osservazione read-only (regola ferrea: si annota, non si corregge a caldo). | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-14-betaB-team-panoramica.md](./internal/postmortems/2026-06-14-betaB-team-panoramica.md) | 📊 Panoramica — team betaB (Kimi), 13–14 giugno 2026 — Retrospettiva dell'osservazione in sola lettura del team betaB (VPS 203.0.113.20, modello Kimi K2.7) dopo il deploy del fix-batch. | — | 2026-06-14 | ✅ |
| [docs/internal/postmortems/2026-06-14-burst-transient-dead-letter-finding.md](./internal/postmortems/2026-06-14-burst-transient-dead-letter-finding.md) | 🔬 burst_transient (P3) — finding RIDIMENSIONATO: scatta tardi, NON è un dead-letter (backlog prio BASSA) — Data: 2026-06-14 · Trovato osservando: betaB (Kimi) post-deploy fix-batch · Owner fetta: shared/skills/weekly_pace.py (dev3) ·… | — | 2026-06-14 | ✅ |
| [docs/internal/postmortems/2026-06-14-weekly-bind-not-enforced-finding.md](./internal/postmortems/2026-06-14-weekly-bind-not-enforced-finding.md) | 🔬 Weekly-bind non enforced: il pacing target è l'arco-5h, mai il weekly (backlog, PRIO ALTA) — Data: 2026-06-14 (notte) · Trovato osservando: betaB (Kimi) post-fix, pipeline piena · Confermato design: dev1 · Lane fix:… | — | 2026-06-14 | ✅ |
| [docs/internal/postmortems/2026-06-15-coordinator-burn-consumo-finding.md](./internal/postmortems/2026-06-15-coordinator-burn-consumo-finding.md) | 🔥 Coordinator-burn — perché il consumo settimanale sale anche a settimana appena resettata — Data: 2026-06-15 · Lane: dev1 (osservazione read-only) · VPS: betaB (Kimi, domanda | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-16-betaA-taxonomy-collapse-finding.md](./internal/postmortems/2026-06-16-betaA-taxonomy-collapse-finding.md) | 🕳️ Tassonomia emergente — collasso a 1 categoria su betaA (finding) — ⚠️ AGGIORNAMENTO 2026-06-20 — leggere PRIMA ../architecture/2026-06-20-taxonomy-brain-driven-redesign.md. | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-17-betaB-kimi-weekly-burn-finding.md](./internal/postmortems/2026-06-17-betaB-kimi-weekly-burn-finding.md) | 🔥 betaB/Kimi — weekly esaurito in 2 giorni: backfill storm post-deploy (finding) — Data: 2026-06-17 · VPS: betaB (203.0.113.20, provider kimi, user_id <redacted ) · | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-21-betaA-daily-actions-drop-finding.md](./internal/postmortems/2026-06-21-betaA-daily-actions-drop-finding.md) | 📉 betaA/Codex — perché le azioni medie/giorno sono scese (finding) — Data: 2026-06-21 · VPS: Codex 203.0.113.10 (utente betaA, beta-1) · | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-21-throttle-floor-5min-analysis.md](./internal/postmortems/2026-06-21-throttle-floor-5min-analysis.md) | Throttle floor a 5min + ladder — analisi storica e modifica (2026-06-21) — Stato: implementato su dev1 (codice + guida agenti). | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-22-kimi-weekly-frontload-investigation.md](./internal/postmortems/2026-06-22-kimi-weekly-frontload-investigation.md) | Indagine multi-agente (15 agenti, dibattito a round con avvocato del diavolo + giudice, consenso 0.93). | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-24-betaA-weekly-milestones.md](./internal/postmortems/2026-06-24-betaA-weekly-milestones.md) | 🏆 betaA/Codex — chiusura del weekly al 99% e poi al 100% (milestone, 18–24/06) — Stessa osservazione in due atti, sola lettura, comportamento da preservare: il team Codex chiude il cap settimanale al massimo… | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-24-betaB-kimi-fresh-weekly-monitor.md](./internal/postmortems/2026-06-24-betaB-kimi-fresh-weekly-monitor.md) | 👁️ betaB/Kimi — monitor weekly su account fresco (live observation) — Avvio: 2026-06-24 ~19:45 CEST · VPS: betaB (203.0.113.20, provider kimi, | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-24-vercel-cost-analysis-and-sync-fix.md](./internal/postmortems/2026-06-24-vercel-cost-analysis-and-sync-fix.md) | 📊 Analisi costi Vercel + fix schema sync_requested_at (2026-06-24) — Sessione del 2026-06-24. | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-25-desktop-team-integration-findings.md](./internal/postmortems/2026-06-25-desktop-team-integration-findings.md) | 🖥️ Desktop ↔ Team — scoperte e decisioni (sessione 2026-06-24/25) — Documento delle scoperte fatte testando dal vivo l'app desktop con il team in | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-25-rollout-observation-betaB.md](./internal/postmortems/2026-06-25-rollout-observation-betaB.md) | 🔭 Osservazione rollout betaB/Kimi — push→pull + daily guardrail (2026-06-25 sera) — Data: 2026-06-25, shift notturno (19:30 Roma start) · VPS: betaB/Kimi (203.0.113.20) | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-26-sentinella-capitano-relationship-live.md](./internal/postmortems/2026-06-26-sentinella-capitano-relationship-live.md) | 🛰️🧭 Rapporto Sentinella ↔ Capitano — osservazione dal vivo (2026-06-26) — VPS: betaA/Codex (203.0.113.10) · Finestra: mattina, ciclo pulito (apertura 06:00 UTC) | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-27-betaC-sentinel-bridge-crash.md](./internal/postmortems/2026-06-27-betaC-sentinel-bridge-crash.md) | 🔴 betaC — sentinel-bridge morto dalle 08:00, nessun auto-recovery — Data: 2026-06-27 ~16:00 UTC | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-06-28-betaD-vps-budget-burn-investigation.md](./internal/postmortems/2026-06-28-betaD-vps-budget-burn-investigation.md) | 🔥 Indagine consumo budget — VPS betaD (Kimi) — 2026-06-28 — Tipo: osservazione + finding per il codice (nessun intervento a runtime — regola "sola lettura sulle simulazioni"). | — | 2026-08-04 | ✅ |
| [docs/internal/postmortems/2026-06-30-reset-always-full-date.md](./internal/postmortems/2026-06-30-reset-always-full-date.md) | 🗓️ Reset sempre con DATA completa — mai un orario orfano — Data: 2026-06-30 · Branch: dev2 · Stato: committato, NON deployato | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-07-01-betaD-daily-hardstop-validated.md](./internal/postmortems/2026-07-01-betaD-daily-hardstop-validated.md) | Daily hard-stop ( 2) — validato end-to-end sul team di betaD (beta-3) — Data: 2026-07-01 · VPS: beta-3 host.invalid (203.0.113.40, betaD — luxury | — | 2026-08-04 | ✅ |
| [docs/internal/postmortems/2026-07-01-capitano-kimi-thinking-off-writer-gate.md](./internal/postmortems/2026-07-01-capitano-kimi-thinking-off-writer-gate.md) | 🚨 Il Capitano Kimi a thinking-OFF viola il gate writer-on-demand (beta-3, 2026-07-01) — 📎 Verità consolidata (economia + decisione thinking-flag) nel living doc | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-07-01-cv-quality-findings-beta3.md](./internal/postmortems/2026-07-01-cv-quality-findings-beta3.md) | 📄 Qualità CV — 4 difetti trovati sui 30 CV di beta-3 (2026-07-01) — Contesto: i 30 CV+CL prodotti (a torto) dal team beta-3 — profilo betaD, Luxury Hospitality (vedi… | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-07-02-daily-halt-standby-leak.md](./internal/postmortems/2026-07-02-daily-halt-standby-leak.md) | Daily hard-stop — prima accensione live + falla dello standby (betaB/Kimi, 2026-07-02) — Prima volta che il daily hard-stop ([BRIDGE ALERT] ⛔ DAILY-CAP SFORATO in | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-07-02-kimi-codex-token-forensics.md](./internal/postmortems/2026-07-02-kimi-codex-token-forensics.md) | 📊 Kimi vs Codex — misura del consumo token (2026-07-02) — Due misure eseguite nella stessa giornata: la prima (token-meter euristico, full-history) ribalta le stime della linea… | — | 2026-07-03 | ✅ |
| [docs/internal/postmortems/2026-07-15-cloud-sync-413-freeze.md](./internal/postmortems/2026-07-15-cloud-sync-413-freeze.md) | 🔌 Cloud-sync congelato (cursor + push 413) — postmortem 2026-07-15 — Su una VPS di produzione a nodo singolo, la dashboard web è rimasta ferma per ~14 ore senza che nessuno se ne accorgesse: il… | — | 2026-07-15 | ✅ |
| [docs/internal/postmortems/2026-07-18-provider-vendor-enum-config-ready.md](./internal/postmortems/2026-07-18-provider-vendor-enum-config-ready.md) | 🧨 Timebomb config_ready: nome-vendor vs nome-CLI del provider — postmortem 2026-07-18 — Una VPS di produzione (team su Anthropic/Claude) è rimasta con la pipeline morta per ~44 ore senza che nessuno se ne… | — | 2026-07-18 | ✅ |
| [docs/internal/roadmap/2026-05-23-position-classifier-llm-roadmap.md](./internal/roadmap/2026-05-23-position-classifier-llm-roadmap.md) | 🏷️ Roadmap: classificatore posizioni → LLM-driven (no hardcoded taxonomy) — Owner: team backend / data | — | 2026-06-13 | ✅ |
| [docs/internal/roadmap/2026-06-05-pacing-migration-plan.md](./internal/roadmap/2026-06-05-pacing-migration-plan.md) | ⏱️ Piano di migrazione pacing — completare il passaggio al modello weekly-aware — Stato: Phase 0 + Phase 1 IMPLEMENTATE · 2026-06-05 (su master, da validare con simulazione su VPS nuova prima di considerarle… | — | 2026-06-13 | ✅ |
| [docs/internal/roadmap/2026-06-06-idle-enrichment-roadmap.md](./internal/roadmap/2026-06-06-idle-enrichment-roadmap.md) | 🧠 Idle Enrichment — usare il tempo morto del team per arricchire il DB — Stato: 💡 idea / roadmap (non implementato) | — | 2026-06-13 | ✅ |
| [docs/internal/roadmap/2026-06-20-proj-volatile-pacing-todo.md](./internal/roadmap/2026-06-20-proj-volatile-pacing-todo.md) | 📐 proj volatile nel pacing — da rifinire (TODO, NON ancora toccato) — Data: 2026-06-20 · Stato: 🟡 DEFERRED di proposito (sistema delicato, esperimenti live in | — | 2026-07-03 | ✅ |
| [docs/internal/roadmap/2026-06-25-pacing-future-ideas.md](./internal/roadmap/2026-06-25-pacing-future-ideas.md) | 💭 Pacing — idee di sofisticazione (questioni APERTE, future) — Data: 2026-06-25 · Stato: discusse, NON implementate — parcheggiate per dopo. | — | 2026-07-03 | ✅ |
| [docs/internal/roadmap/2026-06-30-B1-deterministic-pacing-idea.md](./internal/roadmap/2026-06-30-B1-deterministic-pacing-idea.md) | 🅱️ B1 — Pacing deterministico nel bridge (IDEA futura, NON decisa) — Data: 2026-06-30 · Stato: 💭 parcheggiata — possibile implementazione futura, non schedulata, non validata. | — | 2026-07-03 | ✅ |
| [docs/internal/roadmap/MINOR-TRACKER.md](./internal/roadmap/MINOR-TRACKER.md) | 🪛 Minor tracker — note, debt, fix piccoli — File di tracciamento per cose da fare/migliorare/controllare che NON sono blocker pre-launch. | — | 2026-07-25 | ✅ |
| [docs/internal/roadmap/db-schema-optimization.md](./internal/roadmap/db-schema-optimization.md) | 🗄️ Database schema optimization — plan (idea, not scheduled) — Moved from docs/about/ROADMAP.md in the 2026-07-03 docs restructure. | — | 2026-07-03 | ✅ |
| [docs/internal/2026-07-25-audit-doc-code-drift.md](./internal/2026-07-25-audit-doc-code-drift.md) | Audit doc↔codice del ciclo native (500 commit): cosa era slittato, cosa è stato riallineato, debito residuo per tag | — | 2026-07-25 | ✅ |
| [docs/internal/architecture/2026-07-11-team-directives-bacheca.md](./internal/architecture/2026-07-11-team-directives-bacheca.md) | 📋 Bacheca del team — direttive permanenti dell'utente (2026-07-11) — Stato: fondamenta su dev4 (tabella + skill). | 2026-07-15 | 2026-08-04 | ✅ |
| [docs/internal/assets/TODO-ART.md](./internal/assets/TODO-ART.md) | Lotti di asset ancora da disegnare per la pipeline gen-art: PNG 1120x1520 con alpha, ogni volto derivato dalla sua ancora | — | 2026-07-29 | ✅ |
| [docs/internal/postmortems/2026-07-27-tailwind-layer-vs-extension-css.md](./internal/postmortems/2026-07-27-tailwind-layer-vs-extension-css.md) | Postmortem 27/07: UI invisibile su Chrome — le estensioni iniettano CSS fuori da `@layer` e battono le utility Tailwind v4 | — | 2026-07-27 | ✅ |
| [docs/internal/roadmap/2026-07-27-scorer-per-user-weights.md](./internal/roadmap/2026-07-27-scorer-per-user-weights.md) | Roadmap (TODO): pesi dello Scorer per-utente — default nel codice + override dal profilo, oggi hardcoded nello spec in 8 lingue | — | 2026-07-27 | ✅ |
| [docs/internal/roadmap/2026-07-28-burn-on-demand-gates.md](./internal/roadmap/2026-07-28-burn-on-demand-gates.md) | Roadmap: gli automatismi di spesa non cedono all'ordine esplicito dell'utente — origine del comando `jht burn` | — | 2026-07-28 | ✅ |
| [docs/internal/roadmap/2026-07-28-ticket-provider-cli-autoupdate.md](./internal/roadmap/2026-07-28-ticket-provider-cli-autoupdate.md) | Ticket `[PROVIDER-CLI-AUTOUPDATE]`: aggiornare la CLI del provider all'avvio — nessun componente aveva quel compito, il modello era una generazione indietro | — | 2026-07-28 | ✅ |
| [docs/internal/roadmap/2026-07-28-ticket-stepcap-throttle-resume.md](./internal/roadmap/2026-07-28-ticket-stepcap-throttle-resume.md) | Ticket `[STEPCAP-THROTTLE-RESUME]` (implementato 28/07): watchdog che riprende gli agenti fermi sul cap di step | — | 2026-07-29 | ✅ |
| [docs/internal/roadmap/2026-07-29-ticket-doctor-unblock-and-session-ttl.md](./internal/roadmap/2026-07-29-ticket-doctor-unblock-and-session-ttl.md) | Ticket `[DOCTOR-UNBLOCK-AND-TTL]`: il Dottore deve sbloccare, e le sessioni serve abbiano un TTL di 12h — dall'incidente delle undici ore ferme | — | 2026-07-30 | ✅ |
| [docs/internal/roadmap/2026-07-29-ticket-team-standby-zero-spend.md](./internal/roadmap/2026-07-29-ticket-team-standby-zero-spend.md) | Ticket `[TEAM-STANDBY-ZERO-SPEND]`: standby che ferma anche i ruoli core — origine del comando `jht standby` | — | 2026-07-29 | ✅ |
| [docs/internal/experiments/2026-08-03-regia-video-campagna.md](./internal/experiments/2026-08-03-regia-video-campagna.md) | Trattamento della campagna video, costruito attorno al gioco | — | 2026-08-03 | ✅ |
| [docs/internal/postmortems/2026-08-03-beta5-cold-enter-team-freeze.md](./internal/postmortems/2026-08-03-beta5-cold-enter-team-freeze.md) | beta5: un Enter a freddo congela il team — analisi e rimedio | — | 2026-08-03 | ✅ |
| [docs/internal/roadmap/2026-07-30-db-audit-observations.md](./internal/roadmap/2026-07-30-db-audit-observations.md) | Osservazioni dall'audit del DB: cosa e' emerso e cosa resta da decidere | — | 2026-07-30 | ✅ |
| [docs/internal/roadmap/2026-07-30-ticket-mode-injection-hourly-prompt.md](./internal/roadmap/2026-07-30-ticket-mode-injection-hourly-prompt.md) | [MODE-INJECTION-HOURLY-PROMPT]: la modalita' operativa nel messaggio orario del Capitano | — | 2026-07-30 | ✅ |
| [docs/internal/roadmap/2026-07-30-ticket-throttle-engine-external.md](./internal/roadmap/2026-07-30-ticket-throttle-engine-external.md) | [THROTTLE-ENGINE-EXTERNAL]: il throttle esce dal dominio degli agenti | — | 2026-07-30 | ✅ |
| [docs/internal/architecture/2026-08-03-maintenance-evidence-log-design.md](./internal/architecture/2026-08-03-maintenance-evidence-log-design.md) | Design di maintenance_events: storico append-only dei controlli, esiti e protezione dalle chiusure inconclusive | — | 2026-08-03 | ✅ |
| [docs/internal/roadmap/2026-08-03-ticket-video-campagna-now-playable.md](./internal/roadmap/2026-08-03-ticket-video-campagna-now-playable.md) | [PROMO-VIDEO-NOW-PLAYABLE]: stato sospeso, asset esterni, fix salvati e passi per completare i due montaggi | — | 2026-08-03 | ✅ |
| [docs/internal/experiments/2026-08-03-m4-entry-tier-evidence-protocol.md](./internal/experiments/2026-08-03-m4-entry-tier-evidence-protocol.md) | Missione M4: protocollo riproducibile per varianza Kimi 88→92 e confronto parametrico PAYG/subscription, con gap dati live | — | 2026-08-03 | ✅ |
| [docs/internal/architecture/2026-08-03-local-vault-design.md](./internal/architecture/2026-08-03-local-vault-design.md) | [JHT-LOCAL-VAULT]: envelope encryption, broker runtime, migrazione senza plaintext persistente e decisioni ADR prima della crypto | — | 2026-08-03 | ✅ |
| [docs/internal/architecture/provider-touchpoint-inventory.md](./internal/architecture/provider-touchpoint-inventory.md) | Machine-checked inventory of provider-specific seams and the narrow M5 Local Scorer architecture boundary | 2026-08-03 | 2026-08-03 | 🟢 |
| [docs/internal/ops/recording-profiles.md](./internal/ops/recording-profiles.md) | Procedura interna per generare e verificare profili sintetici deterministici destinati alle registrazioni web e gioco | — | 2026-08-04 | ✅ |
| [docs/internal/2026-08-07-setup-guide-content-contract.md](./internal/2026-08-07-setup-guide-content-contract.md) | Contratto P0 della guida setup non pubblicata: naming, copy EN, fasi e requisiti screenshot per tre OS, local-web e censimento riuso | 2026-08-07 | 2026-08-07 | 🟢 |
| [docs/internal/2026-08-07-setup-guide-web-scaffolding.md](./internal/2026-08-07-setup-guide-web-scaffolding.md) | Handoff web della guida setup non pubblicata: route noindex, contratto canonico, registro schermate, test e stato traduzioni | 2026-08-07 | 2026-08-07 | 🟢 |
| [docs/internal/2026-08-07-web-compliance-audit.md](./internal/2026-08-07-web-compliance-audit.md) | Audit tecnico di conformità del sito web: consenso analytics, accesso a privacy e termini, inventario dei dati e decisioni aperte su export e cancellazione | — | 2026-08-07 | ✅ |
| [docs/internal/2026-08-07-LEGAL-COPY-DRAFT.md](./internal/2026-08-07-LEGAL-COPY-DRAFT.md) | Audit pre-release e bozze EN versionate di Privacy e Termini, con flussi reali, copy condiviso web/desktop e decisioni legali esplicitamente aperte | — | 2026-08-07 | ✅ |
| [docs/internal/2026-08-07-LEGAL-COPY-RELEASE.md](./internal/2026-08-07-LEGAL-COPY-RELEASE.md) | Fonte EN di pubblicazione per Privacy e Termini v2026-08-07.1: titolare individuale, età 16, Google/cloud, analytics opt-in, CARTO, feedback privato, export e cancellazione cloud immediata | — | 2026-08-07 | ✅ |
| [docs/internal/ops/download-funnel.md](./internal/ops/download-funnel.md) | Query operativa delle ultime 72 ore per i click download aggregati e vincoli di accesso service-role al contatore anonimo | 2026-08-07 | 2026-08-07 | 🟢 |


## 🔒 docs/security

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/security/README.md](./security/README.md) | Indice security review pre-launch | — | 2026-07-25 | ✅ |
| [docs/security/01-pre-launch-review.md](./security/01-pre-launch-review.md) | Review pre-launch (33/35 task chiusi) | — | 2026-07-03 | ✅ |
| [docs/security/02-openclaw-comparison.md](./security/02-openclaw-comparison.md) | Confronto sicurezza con OpenClaw | — | 2026-04-30 | ✅ |
| [docs/security/03-implementation-tradeoffs.md](./security/03-implementation-tradeoffs.md) | Tradeoff implementativi delle mitigation | — | 2026-04-30 | ✅ |
| [docs/security/04-threat-model.md](./security/04-threat-model.md) | Threat model completo del progetto | — | 2026-08-04 | ✅ |
| [docs/security/05-checklist.md](./security/05-checklist.md) | Checklist sicurezza pre-public-release | — | 2026-07-30 | ✅ |
| [docs/security/06-post-fix-comparison.md](./security/06-post-fix-comparison.md) | Snapshot post-fix (score 30% → 74%) | — | 2026-07-30 | ✅ |


## 🧪 docs/sessions

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/sessions/README.md](./sessions/README.md) | 📊 Session reports — JHT team experimentation — Indice cronologico dei report HTML interattivi prodotti durante le | — | 2026-07-03 | ✅ |
| [docs/sessions/2026-04-25-experimentation-overview-to-2026-05-09/README.md](./sessions/2026-04-25-experimentation-overview-to-2026-05-09/README.md) | 🧪 Sperimentazione JHT — panoramica 15 giorni (2026-04-25 → 2026-05-09) — Report HTML "meta" che aggrega 15 giorni di sperimentazione del team | — | 2026-06-13 | ✅ |
| [docs/sessions/2026-05-08-codex-10h/README.md](./sessions/2026-05-08-codex-10h/README.md) | 🔵 Codex monitoring — 10h snapshot (2026-05-08 mattina) — Primo report HTML interattivo prodotto dopo che il team JHT e' stato | — | 2026-06-13 | ✅ |
| [docs/sessions/2026-05-08-codex-12h-pm/README.md](./sessions/2026-05-08-codex-12h-pm/README.md) | 🔵 Codex monitoring — 12h snapshot (2026-05-08 PM) — Report HTML 12h del pomeriggio del 8 maggio. | — | 2026-06-13 | ✅ |
| [docs/sessions/2026-05-09-codex-12h-am/README.md](./sessions/2026-05-09-codex-12h-am/README.md) | 🔵 Codex monitoring — 12h snapshot (2026-05-09 AM) — Report 12h del mattino del 9 maggio. | — | 2026-06-13 | ✅ |
| [docs/sessions/2026-05-17-budget-windows/README.md](./sessions/2026-05-17-budget-windows/README.md) | 💰 2026-05-17 — Budget windows Kimi: 2 finestre consecutive, entrambe in target — Sessione operativa: il team Job Hunter Team ha lavorato per 2 finestre Kimi | — | 2026-07-25 | ✅ |
| [docs/sessions/2026-05-17-pipeline-snapshot/README.md](./sessions/2026-05-17-pipeline-snapshot/README.md) | 📈 2026-05-17 — Pipeline snapshot charts (Capitano on-demand) — Seconda sessione di grafici on-demand del Capitano (post chiusura finestra | — | 2026-07-25 | ✅ |
| [docs/sessions/2026-05-17-team-dashboard/README.md](./sessions/2026-05-17-team-dashboard/README.md) | 🖥️ 2026-05-17 — Team dashboard & 5-window timeline (Capitano on-demand v3) — Terza sessione di grafici on-demand del Capitano (post-reset finestra Kimi | — | 2026-07-25 | ✅ |
| [docs/sessions/2026-05-17-vps-health/README.md](./sessions/2026-05-17-vps-health/README.md) | 🩺 2026-05-17 — Health audit VPS + container (snapshot 14:09 UTC) — Audit operativo richiesto durante la sessione test e2e Path 2. | — | 2026-07-25 | ✅ |
| [docs/sessions/2026-05-17-vps-path2-e2e/README.md](./sessions/2026-05-17-vps-path2-e2e/README.md) | 🚀 Test E2E setup VPS Path 2 (2026-05-15 → 2026-05-17) — Sessione di validazione end-to-end del Path 2 (Desktop + VPS remota Hetzner) | — | 2026-07-25 | ✅ |
| [docs/sessions/2026-05-18-capitano-zombie-night/README.md](./sessions/2026-05-18-capitano-zombie-night/README.md) | 🌙 Post-mortem — Capitano zombie night (17-18 maggio 2026) — Sintesi in 1 riga: il Capitano è morto nella notte (kimi CLI crashato dentro al pane tmux), e nessun automatismo l'ha… | — | 2026-05-18 | ✅ |
| [docs/sessions/2026-05-18-fix-effectiveness-review/README.md](./sessions/2026-05-18-fix-effectiveness-review/README.md) | 📊 Review effectiveness fix — 18 maggio 2026 — Sintesi in 1 riga: i fix delle ultime 48h sono un successo netto — EMERGENZA Sentinella −96%, URG −71%, FREEZE −82%; | — | 2026-07-25 | ✅ |
| [docs/sessions/2026-05-18-sentinella-severity-analysis/README.md](./sessions/2026-05-18-sentinella-severity-analysis/README.md) | 🚨 Sentinella — analisi "troppo severa?" (post Bug 24) — Data: 2026-05-18 16:50 CEST | — | 2026-05-23 | ✅ |
| [docs/sessions/2026-05-18-supabase-disk-io-investigation/README.md](./sessions/2026-05-18-supabase-disk-io-investigation/README.md) | 🔥 Supabase Disk IO Budget — investigazione e piano fix — Trigger: email Supabase Team "Your project is depleting its Disk IO Budget" (project ref smittwvohsnwwwisqdrh) | — | 2026-05-23 | ✅ |
| [docs/sessions/2026-05-18-weekly-budget-analysis/README.md](./sessions/2026-05-18-weekly-budget-analysis/README.md) | 📊 Analisi consumo weekly Kimi — 18 maggio 2026 — Sintesi in 1 riga: 1% di una finestra Kimi (5h) ≈ 0.20% del weekly budget. | — | 2026-07-25 | ✅ |
| [docs/sessions/2026-07-27-first-run-night-observations.md](./sessions/2026-07-27-first-run-night-observations.md) | Note di sessione: primo run notturno di un team nuovo su VPS, solo misure sul campo (il thrash viene dal numero di agenti, non dalla loro velocità) | — | 2026-07-28 | ✅ |
| [docs/sessions/2026-07-28-burn-test-scout-step-cap-stall.md](./sessions/2026-07-28-burn-test-scout-step-cap-stall.md) | Note di sessione: test di spinta con `jht burn` attivo — lo Scout fermo sul cap di step e nessun componente incaricato di riprenderlo | — | 2026-07-29 | ✅ |


## 🗄️ supabase

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [supabase/README.md](../supabase/README.md) | Schema multi-tenant Postgres + RLS (BYO backend) | — | 2026-08-07 | ✅ |


## ❓ Altri

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [assets/README.md](../assets/README.md) | 🖼️ assets — repo-level static assets — Shared static assets used in repo-level docs and the project landing. | — | 2026-07-19 | ✅ |
| [cli/README.md](../cli/README.md) | ⌨️ cli — the jht command-line interface — The jht CLI is the primary control surface for Job Hunter Team. | 2026-07-30 | 2026-07-30 | 🟢 |
| [docs/README.md](./README.md) | 📚 Documentation — Job Hunter Team — Top-level index of the documentation. | — | 2026-08-04 | ✅ |
| [docs/launch/demo-storyboard.md](./launch/demo-storyboard.md) | Tombstone dello storyboard CLI obsoleto, ritirato e conservato in archivio | — | 2026-08-04 | ✅ |
| [e2e/README.md](../e2e/README.md) | 🧪 e2e — end-to-end tests (Playwright) — Browser-driven end-to-end tests for the Job Hunter Team web dashboard. | — | 2026-08-05 | ✅ |
| [scripts/README.md](../scripts/README.md) | 🐚 scripts — setup, install & dev tooling — Bash/PowerShell scripts for installing, developing, releasing, and simulating | — | 2026-08-03 | ✅ |
| [scripts/case-study-extract/README.md](../scripts/case-study-extract/README.md) | Case study VPS extraction toolkit — Read-only dump of an entire JHT VPS run for offline analysis. | — | 2026-07-03 | ✅ |
| [shared/README.md](../shared/README.md) | 🧩 shared — shared core library — Cross-cutting logic shared across the CLI, TUI, agents, and monitoring stack. | — | 2026-07-25 | ✅ |
| [web/README.md](../web/README.md) | 🌐 web — dashboard (Next.js) — The Job Hunter Team web dashboard: positions, scoring, map/globe, team telemetry, | — | 2026-07-25 | ✅ |
| [assets/promo/2026-07-presentation/SCALETTA.md](../assets/promo/2026-07-presentation/SCALETTA.md) | Diario del video 03/08 ritirato: banner demo e CTA Beta non pubblicabili | — | 2026-08-04 | ✅ |
| [docs/CHARACTER-VARIANTS.md](./CHARACTER-VARIANTS.md) | Cast delle varianti personaggio per reparto: profilo, desk e vista di ogni postazione, con il linguaggio visivo del sito | — | 2026-07-25 | ✅ |
| [e2e/tests/quarantine/README.md](../e2e/tests/quarantine/README.md) | Le 75 spec E2E in quarantena: escluse da ogni run via `testIgnore`, conservate per le asserzioni recuperabili | — | 2026-07-26 | ✅ |
| [tests/fixtures/e2e_linux_cv.md](../tests/fixtures/e2e_linux_cv.md) | Synthetic candidate CV consumed by the Linux onboarding E2E: no real personal data, only the profile fields the first-run checklist has to parse | — | 2026-08-04 | ✅ |
| [promo-2026-08-vertical-ad/animatic/incoming/designer/DESIGN_SPEC.md](../promo-2026-08-vertical-ad/animatic/incoming/designer/DESIGN_SPEC.md) | Specifica tipografica e motion del pack overlay 9:16 per l'animatic pubblicitario: safe area, palette JHT, font, CTA e uso editoriale | — | 2026-08-05 | ✅ |
| [docs/assets/icons/SOURCES.md](./assets/icons/SOURCES.md) | Provenienza ufficiale, condizioni d'uso e integrità degli SVG Docker e Telegram impiegati nel diagramma infrastrutturale | — | 2026-08-07 | ✅ |
| [web/public/brand/README.md](../web/public/brand/README.md) | Provenienza, integrità e vincoli d'uso degli asset social ufficiali nel footer pubblico, con Instagram attivo e TikTok mantenuto non pubblicato | — | 2026-08-07 | ✅ |
| [scripts/release-keys/README.md](../scripts/release-keys/README.md) | Contratto di custodia e rotazione delle chiavi pubbliche per i manifest release Windows firmati | — | 2026-08-07 | ✅ |


---

## 🔧 Manutenzione del file

- File generato da [`scripts/review-log.py`](../scripts/review-log.py).
- Source of truth: [`review-log.json`](./review-log.json) — qui editi descrizioni e date di revisione.
- `sync` aggiorna automaticamente `🔄 Update` (da `git log`) e `❗ Rivedi`, e aggiunge file nuovi (descrizione vuota).
- `mark <path>` setta `last_review` a oggi nel JSON e rigenera l'MD.
