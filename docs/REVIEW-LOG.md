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
| [README.md](../README.md) | Entry point del repo: vision, install, panoramica team agenti, provider | — | 2026-04-30 | ✅ |
| [BACKLOG.md](../BACKLOG.md) | Roadmap completa con priorità e fasi 1-6, blocker pre-launch | — | 2026-05-06 | ✅ |
| [CHANGELOG.md](../CHANGELOG.md) | Changelog formato Keep-a-Changelog, cronologia rilasci | — | 2026-04-28 | ✅ |
| [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md) | Contributor Covenant 2.1, contatto `leopu00@gmail.com` | — | 2026-04-30 | ✅ |
| [SECURITY.md](../SECURITY.md) | Responsible disclosure + contatti security | — | 2026-04-30 | ✅ |


## 🐙 .github

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [.github/CONTRIBUTING.md](../.github/CONTRIBUTING.md) | Guida contributors EN, link CoC, workflow PR | — | 2026-04-30 | ✅ |
| [.github/ISSUE_TEMPLATE/bug_report.md](../.github/ISSUE_TEMPLATE/bug_report.md) | Template GitHub issue per bug | — | 2026-04-28 | ✅ |
| [.github/ISSUE_TEMPLATE/feature_request.md](../.github/ISSUE_TEMPLATE/feature_request.md) | Template GitHub issue per feature request | — | 2026-04-28 | ✅ |
| [.github/PULL_REQUEST_TEMPLATE.md](../.github/PULL_REQUEST_TEMPLATE.md) | Template PR con summary + test plan | — | 2026-04-28 | ✅ |


## 🤖 Agent prompts

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [agents/capitano/capitano.md](../agents/capitano/capitano.md) | 🎖️ Capitano — orchestrator del team, distribuisce ordini | — | 2026-05-05 | ✅ |
| [agents/sentinella/sentinella.md](../agents/sentinella/sentinella.md) | 💂 Sentinella — watchdog rate-limit, fallback del bridge | — | 2026-05-03 | ✅ |
| [agents/scout/scout.md](../agents/scout/scout.md) | 🔭 Scout — ricerca offerte (LinkedIn → ATS → niche → web) | — | 2026-05-03 | ✅ |
| [agents/analista/analista.md](../agents/analista/analista.md) | 🔍 Analista — filtra JD vs profilo, popola companies/highlights | — | 2026-05-03 | ✅ |
| [agents/scorer/scorer.md](../agents/scorer/scorer.md) | 🎯 Scorer — assegna score 0-100 alle posizioni filtrate | — | 2026-05-03 | ✅ |
| [agents/scrittore/scrittore.md](../agents/scrittore/scrittore.md) | ✍️ Scrittore — genera CV + cover letter per posizione | — | 2026-05-03 | ✅ |
| [agents/critico/critico.md](../agents/critico/critico.md) | 🧐 Critico — review qualità CV/cover prima dell'invio | — | 2026-05-03 | ✅ |
| [agents/assistente/assistente.md](../agents/assistente/assistente.md) | 🤝 Assistente — config profilo utente, supporto setup | — | 2026-05-02 | ✅ |
| [agents/maestro/maestro.md](../agents/maestro/maestro.md) | 🧙‍♂️ Maestro — career-coach pattern-detector (planned, voce Gandalf) | — | 2026-05-02 | ✅ |
| [agents/capitano/missions/thermostat-test.md](../agents/capitano/missions/thermostat-test.md) | 🌡️ Missione opt-in test termostato senza Sentinella | — | 2026-05-05 | ✅ |


## 📐 Team architecture & manuals

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [agents/_team/architettura.md](../agents/_team/architettura.md) | Architettura V5 4-tier (Bridge → Sentinella → Capitano → agenti) | — | 2026-04-30 | ✅ |
| [agents/_team/team-rules.md](../agents/_team/team-rules.md) | Regole condivise team (RULE-T*), inherited da tutti gli agenti | — | 2026-05-02 | ✅ |
| [agents/_manual/anti-collision.md](../agents/_manual/anti-collision.md) | Come evitare scritture concorrenti sul DB tra agenti | — | 2026-04-28 | ✅ |
| [agents/_manual/communication-rules.md](../agents/_manual/communication-rules.md) | Regole comunicazione inter-agent (jht-tmux-send, jht-send) | — | 2026-05-02 | ✅ |
| [agents/_manual/db-schema.md](../agents/_manual/db-schema.md) | Schema SQLite `~/.jht/jobs.db` (5 tabelle) | — | 2026-04-28 | ✅ |
| [agents/_manual/sessions.md](../agents/_manual/sessions.md) | Gestione sessioni team (start/stop/reset) | — | 2026-04-28 | ✅ |


## 🛠️ Skill globali

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [agents/_skills/db-insert/SKILL.md](../agents/_skills/db-insert/SKILL.md) | INSERT su positions/companies/position_highlights | — | 2026-04-28 | ✅ |
| [agents/_skills/db-query/SKILL.md](../agents/_skills/db-query/SKILL.md) | SELECT helper read-only sul DB jobs | — | 2026-04-28 | ✅ |
| [agents/_skills/db-update/SKILL.md](../agents/_skills/db-update/SKILL.md) | UPDATE stato/score di righe esistenti | — | 2026-04-28 | ✅ |
| [agents/_skills/rate-budget/SKILL.md](../agents/_skills/rate-budget/SKILL.md) | Calcolo budget rate-limit per provider | — | 2026-04-28 | ✅ |
| [agents/_skills/tmux-send/SKILL.md](../agents/_skills/tmux-send/SKILL.md) | Invio messaggi inter-agent via tmux send-keys | — | 2026-04-28 | ✅ |
| [agents/_skills/throttle/SKILL.md](../agents/_skills/throttle/SKILL.md) | Throttle azioni agente per restare in budget | — | 2026-05-03 | ✅ |
| [agents/_skills/throttle/DESIGN-NOTES.md](../agents/_skills/throttle/DESIGN-NOTES.md) | Design throttle "blocco hard" — ⚠️ da rivedere prima rollout | — | 2026-05-03 | ✅ |


## 💂 Skill Sentinella

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [agents/sentinella/_skills/check-usage-http/SKILL.md](../agents/sentinella/_skills/check-usage-http/SKILL.md) | Check usage via endpoint HTTP provider | — | 2026-04-28 | ✅ |
| [agents/sentinella/_skills/check-usage-tui/SKILL.md](../agents/sentinella/_skills/check-usage-tui/SKILL.md) | Check usage via TUI/CLI provider | — | 2026-04-28 | ✅ |
| [agents/sentinella/_skills/decision-throttle/SKILL.md](../agents/sentinella/_skills/decision-throttle/SKILL.md) | Logica decisione throttle (STEADY/ATTENZIONE/EMERGENZA) | — | 2026-04-28 | ✅ |
| [agents/sentinella/_skills/emergency-handling/SKILL.md](../agents/sentinella/_skills/emergency-handling/SKILL.md) | Gestione emergenze rate (HARD FREEZE, PAUSA TEAM) | — | 2026-04-28 | ✅ |
| [agents/sentinella/_skills/memory-state/SKILL.md](../agents/sentinella/_skills/memory-state/SKILL.md) | Stato in memoria Sentinella tra tick | — | 2026-04-28 | ✅ |
| [agents/sentinella/_skills/order-formats/SKILL.md](../agents/sentinella/_skills/order-formats/SKILL.md) | Format ordini protocollo (MANTIENI/SCALA UP/RIENTRO) | — | 2026-04-28 | ✅ |


## 📖 docs/about

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/about/STORY.md](./about/STORY.md) | Origin story (legacy 200 offerte/5 colloqui in 2 settimane) | — | 2026-04-27 | ✅ |
| [docs/about/VISION.md](./about/VISION.md) | Vision long-term, Maestro 🧙‍♂️, "AI on the side of workers" | — | 2026-04-30 | ✅ |
| [docs/about/ROADMAP.md](./about/ROADMAP.md) | Roadmap pubblica per fasi (open source → desktop) | — | 2026-04-28 | ✅ |
| [docs/about/PROVIDERS.md](./about/PROVIDERS.md) | Matrice provider Claude/Codex/Kimi con costi e tier | — | 2026-04-27 | ✅ |
| [docs/about/MONITORING.md](./about/MONITORING.md) | Stack monitoring V5 (Bridge + Sentinella event-driven) | — | 2026-04-27 | ✅ |
| [docs/about/RESULTS.md](./about/RESULTS.md) | Risultati reali utenti beta (matrice persona × provider) | — | 2026-04-27 | ✅ |


## 📜 docs/adr (Architecture Decision Records)

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/adr/README.md](./adr/README.md) | Indice ADR + convenzione di scrittura | — | 2026-04-17 | ✅ |
| [docs/adr/0001-colima-not-docker-desktop.md](./adr/0001-colima-not-docker-desktop.md) | ADR-0001: Colima invece di Docker Desktop su macOS | — | 2026-04-16 | ✅ |
| [docs/adr/0002-three-supported-agent-clis.md](./adr/0002-three-supported-agent-clis.md) | ADR-0002: 3 CLI supportate (Claude Code, Codex, Kimi) | — | 2026-04-28 | ✅ |
| [docs/adr/0003-single-writer-team.md](./adr/0003-single-writer-team.md) | ADR-0003: single-writer pattern sul DB | — | 2026-04-27 | ✅ |
| [docs/adr/0004-subscription-only-no-api-keys.md](./adr/0004-subscription-only-no-api-keys.md) | ADR-0004: solo subscription, no API key | — | 2026-04-17 | ✅ |


## 🧭 docs/guides

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/guides/quickstart.md](./guides/quickstart.md) | Guida quickstart utente (3 path: desktop, repo, one-liner) | — | 2026-04-27 | ✅ |
| [docs/guides/cli-install.md](./guides/cli-install.md) | Spec dell'installer one-liner `install.sh` (AS-IS) | — | 2026-04-27 | ✅ |
| [docs/guides/AI-AGENT-INTEGRATION.md](./guides/AI-AGENT-INTEGRATION.md) | Integrazione AI CLI esterne (Claude Code, OpenClaw, Cursor) | — | 2026-04-27 | ✅ |
| [docs/guides/BETA.md](./guides/BETA.md) | Onboarding beta tester + matrice coverage 10 celle | — | 2026-04-27 | ✅ |
| [docs/guides/feedback-ticketing.md](./guides/feedback-ticketing.md) | Runbook pagina /feedback + API `/api/feedback` | — | 2026-04-27 | ✅ |


## 🛰️ docs/internal

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/internal/MAINTAINERS.md](./internal/MAINTAINERS.md) | 🔒 Riferimento maintainer (Supabase, Vercel, OAuth, secret) | — | 2026-04-27 | ✅ |
| [docs/internal/INFRA.md](./internal/INFRA.md) | Diagramma deployment (container + storage + sync opzionale) | — | 2026-04-27 | ✅ |
| [docs/internal/release.md](./internal/release.md) | Procedura cut-release (tag vX.Y.Z + GH workflow) | — | 2026-04-27 | ✅ |
| [docs/internal/2026-05-01-bridge-and-token-monitoring.md](./internal/2026-05-01-bridge-and-token-monitoring.md) | Analisi bridge V6 + token-meter, roadmap V7 | — | 2026-05-02 | ✅ |
| [docs/internal/2026-05-01-team-session-report.md](./internal/2026-05-01-team-session-report.md) | Report sessione team 30 apr/1 mag UTC | — | 2026-05-02 | ✅ |
| [docs/internal/2026-05-03-rate-kimi-weights.md](./internal/2026-05-03-rate-kimi-weights.md) | Calibrazione empirica pesi rate Kimi K2 | — | 2026-05-03 | ✅ |
| [docs/internal/2026-05-04-vps-deployment-design.md](./internal/2026-05-04-vps-deployment-design.md) | Design deploy VPS (3 path: SSH manuale / web pairing / launcher) | — | 2026-05-04 | ✅ |
| [docs/internal/TODO-bridge-v7.md](./internal/TODO-bridge-v7.md) | 📌 Punch list bridge V7 + token monitor (entry point) | — | 2026-05-02 | ✅ |


## 🔒 docs/security

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/security/README.md](./security/README.md) | Indice security review pre-launch | — | 2026-04-28 | ✅ |
| [docs/security/01-pre-launch-review.md](./security/01-pre-launch-review.md) | Review pre-launch (33/35 task chiusi) | — | 2026-04-30 | ✅ |
| [docs/security/02-openclaw-comparison.md](./security/02-openclaw-comparison.md) | Confronto sicurezza con OpenClaw | — | 2026-04-30 | ✅ |
| [docs/security/03-implementation-tradeoffs.md](./security/03-implementation-tradeoffs.md) | Tradeoff implementativi delle mitigation | — | 2026-04-30 | ✅ |
| [docs/security/04-threat-model.md](./security/04-threat-model.md) | Threat model completo del progetto | — | 2026-04-30 | ✅ |
| [docs/security/05-checklist.md](./security/05-checklist.md) | Checklist sicurezza pre-public-release | — | 2026-04-30 | ✅ |
| [docs/security/06-post-fix-comparison.md](./security/06-post-fix-comparison.md) | Snapshot post-fix (score 30% → 74%) | — | 2026-04-30 | ✅ |


## 🧪 docs/sessions

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [docs/sessions/long-session-2026-05-04/README.md](./sessions/long-session-2026-05-04/README.md) | Report sessione 10h+ con 2 finestre Claude back-to-back | — | 2026-05-04 | ✅ |


## 🗄️ supabase

| 📄 File | 📝 Descrizione | 👀 Rev | 🔄 Update | ❗ Rivedi |
|---|---|---|---|---|
| [supabase/README.md](../supabase/README.md) | Schema multi-tenant Postgres + RLS (BYO backend) | — | 2026-04-28 | ✅ |


---

## 🔧 Manutenzione del file

- File generato da [`scripts/review-log.py`](../scripts/review-log.py).
- Source of truth: [`review-log.json`](./review-log.json) — qui editi descrizioni e date di revisione.
- `sync` aggiorna automaticamente `🔄 Update` (da `git log`) e `❗ Rivedi`, e aggiunge file nuovi (descrizione vuota).
- `mark <path>` setta `last_review` a oggi nel JSON e rigenera l'MD.
