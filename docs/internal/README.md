# 📚 docs/internal — indice

Note di lavoro interne: design lock, spec evergreen, postmortem e investigazioni.
Organizzate per **categoria** in sotto-cartelle.

> Per i doc utente-facing vedi `docs/about/`, `docs/guides/`, `docs/security/`.

---

## 🗂️ Categorie

| Cartella | Contenuto |
|---|---|
| [`architecture/`](architecture/) | Spec & design di sistema (living docs + design lock) |
| [`postmortems/`](postmortems/) | Incidenti, diagnosi e investigazioni datate |
| [`experiments/`](experiments/) | Simulazioni, studi, playbook, case study |
| [`roadmap/`](roadmap/) | Piani tecnici, backlog, tracker |
| [`ops/`](ops/) | Infra, VPS, release, triage, credenziali |
| [`qa-reports/`](qa-reports/) | Report E2E/QA storici (run agenti) |
| [`_archive/`](_archive/) | Note superate, conservate per git-blame |

File di root: [`chronicles-canon.md`](chronicles-canon.md) (canon narrativo) · [`REVIEW-LOG.md`](REVIEW-LOG.md) (log review).

---

## 🏗️ architecture/

Design/architettura che riflette lo stato corrente. Aggiornati in place (living) o lock di design.

| File | Topic |
|---|---|
| [`cloud-sync-architecture.md`](architecture/cloud-sync-architecture.md) | Sync DB locale ↔ Supabase: cosa va in cloud, macro-event design |
| [`candidate-profile-cloud-sync-redesign-2026-06-05.md`](architecture/candidate-profile-cloud-sync-redesign-2026-06-05.md) | Redesign sync profilo candidato |
| [`file-bridge-on-demand-2026-06-07.md`](architecture/file-bridge-on-demand-2026-06-07.md) | Pull-on-demand file via Supabase Storage |
| [`context-watchdog-spec.md`](architecture/context-watchdog-spec.md) | Restart periodico agenti via Dottore (anti context saturation) |
| [`onboarding-flow.md`](architecture/onboarding-flow.md) | Sequenza canonica onboarding: location → sync → Telegram → provider |
| [`team-commands-bus.md`](architecture/team-commands-bus.md) | Channel comandi web → VPS via `team_commands` table |
| [`bot-telegram.md`](architecture/bot-telegram.md) | Design bot Telegram (3 bot obbligatori), ingest documenti, working hours |
| [`2026-05-25-work-hours-design.md`](architecture/2026-05-25-work-hours-design.md) | Design working hours team |
| [`2026-05-20-world-globe-feature.md`](architecture/2026-05-20-world-globe-feature.md) | Spec mappamondo dashboard (coordinate ufficio) |
| [`2026-05-19-dashboard-routing-cases.md`](architecture/2026-05-19-dashboard-routing-cases.md) | Casi routing dashboard Next.js |
| [`2026-05-01-bridge-and-token-monitoring.md`](architecture/2026-05-01-bridge-and-token-monitoring.md) | Brainstorming bridge + token monitoring |

## 📉 postmortems/

Note datate su incidenti specifici, diagnosi, snapshot. **Non aggiornate dopo la chiusura** — la decisione live finisce nelle spec di `architecture/`.

| Data | File | Topic |
|---|---|---|
| 2026-06-11 | [`2026-06-11-overspawn-rootcause.md`](postmortems/2026-06-11-overspawn-rootcause.md) | Root cause over-spawn istanze |
| 2026-06-07 | [`2026-06-07-capitano-runaway-scaling-postmortem.md`](postmortems/2026-06-07-capitano-runaway-scaling-postmortem.md) | Runaway scaling Capitano (5 Scout / 4 Analisti) |
| 2026-06-04 | [`2026-06-04-scout-geo-concentration.md`](postmortems/2026-06-04-scout-geo-concentration.md) | Over-concentrazione geografica Scout |
| 2026-06-04 | [`P7-weekly-reset-non-rilevato-2026-06-04.md`](postmortems/P7-weekly-reset-non-rilevato-2026-06-04.md) | Weekly reset non rilevato (P7) |
| 2026-06-03 | [`2026-06-03-beta-vps-session-corrections.md`](postmortems/2026-06-03-beta-vps-session-corrections.md) | Correzioni sessione beta VPS |
| 2026-06-03 | [`DIAGNOSI-pacing-weekly-2026-06-03.md`](postmortems/DIAGNOSI-pacing-weekly-2026-06-03.md) | Diagnosi pacing weekly-blind |
| 2026-05-22 | [`2026-05-22-vercel-quota-exhaustion.md`](postmortems/2026-05-22-vercel-quota-exhaustion.md) | Vercel HTTP 402 / quota account |
| 2026-05-21 | [`2026-05-21-halt-weekly-incident.md`](postmortems/2026-05-21-halt-weekly-incident.md) | Halt VPS1 per saturazione weekly cap Codex |
| 2026-05-21 | [`2026-05-21-vps1-run-postmortem.md`](postmortems/2026-05-21-vps1-run-postmortem.md) | Postmortem consolidato VPS1 run 35h |
| 2026-05-21 | [`2026-05-21-vps-bootstrap-fixes-validated.md`](postmortems/2026-05-21-vps-bootstrap-fixes-validated.md) | Validazione fix bootstrap VPS |

## 🔬 experiments/

Simulazioni, studi comparativi, playbook e case study.

| Data | File | Topic |
|---|---|---|
| 2026-05-25 | [`2026-05-25-sim-5-office-geocoding-mario-rossi-report.md`](experiments/2026-05-25-sim-5-office-geocoding-mario-rossi-report.md) | Sim 5 — office geocoding (profilo Mario Rossi) |
| 2026-05-25 | [`2026-05-25-sim-4-office-geocoding-report.md`](experiments/2026-05-25-sim-4-office-geocoding-report.md) | Sim 4 — office geocoding |
| 2026-05-25 | [`2026-05-25-case-studies-page-handoff.md`](experiments/2026-05-25-case-studies-page-handoff.md) | Handoff pagina case studies |
| 2026-05-23 | [`2026-05-23-sim-1-location-enrichment-report.md`](experiments/2026-05-23-sim-1-location-enrichment-report.md) | Sim 1 — location enrichment |
| 2026-05-23 | [`2026-05-23-sim-2-location-enrichment-report.md`](experiments/2026-05-23-sim-2-location-enrichment-report.md) | Sim 2 — location enrichment |
| 2026-05-23 | [`2026-05-23-sim-3-location-enrichment-report.md`](experiments/2026-05-23-sim-3-location-enrichment-report.md) | Sim 3 — location enrichment |
| 2026-05-23 | [`2026-05-23-location-playbook.md`](experiments/2026-05-23-location-playbook.md) | Playbook arricchimento location |
| 2026-05-23 | [`2026-05-23-case-study-staging.md`](experiments/2026-05-23-case-study-staging.md) | Staging case study |
| 2026-05-06 | [`2026-05-06-agent-prompts-i18n.md`](experiments/2026-05-06-agent-prompts-i18n.md) | i18n prompt agenti |
| 2026-05-06 | [`2026-05-06-prompt-decomposition-skill-vs-manual.md`](experiments/2026-05-06-prompt-decomposition-skill-vs-manual.md) | Decomposizione prompt: skill vs manuale |
| 2026-05-03 | [`2026-05-03-rate-kimi-weights.md`](experiments/2026-05-03-rate-kimi-weights.md) | Pesi rate-budget Kimi |

## 🛣️ roadmap/

Piani tecnici, backlog, tracker. Aggiornati finché aperti.

| File | Topic |
|---|---|
| [`2026-06-06-idle-enrichment-roadmap.md`](roadmap/2026-06-06-idle-enrichment-roadmap.md) | Roadmap arricchimento durante idle |
| [`2026-05-23-position-classifier-llm-roadmap.md`](roadmap/2026-05-23-position-classifier-llm-roadmap.md) | Roadmap classificatore posizioni LLM |
| [`2026-05-20-supabase-perf-backlog.md`](roadmap/2026-05-20-supabase-perf-backlog.md) | Backlog performance Supabase |
| [`pacing-migration-plan-2026-06-05.md`](roadmap/pacing-migration-plan-2026-06-05.md) | Piano migrazione pacing |
| [`PII-sanitization-plan-2026-06-04.md`](roadmap/PII-sanitization-plan-2026-06-04.md) | Piano sanitizzazione PII storia repo |
| [`MINOR-TRACKER.md`](roadmap/MINOR-TRACKER.md) | Tracker mini-fix (Prettier, debt, Windows dev) |

## ⚙️ ops/

Infra, deploy, lifecycle, accessi.

| File | Topic |
|---|---|
| [`INFRA.md`](ops/INFRA.md) | Overview infra (canali utente↔team, network, storage) |
| [`vps.md`](ops/vps.md) | Design VPS: host/container split, providers, install UX, lifecycle |
| [`release.md`](ops/release.md) | Processo release (tag → CI → GitHub Release) |
| [`triage.md`](ops/triage.md) | Triage feedback / bug report (tabella `feedback_tickets`) |
| [`access-and-credentials.md`](ops/access-and-credentials.md) | Accessi e credenziali |
| [`MAINTAINERS.md`](ops/MAINTAINERS.md) | Coordinamento maintainer: Supabase, Vercel, OAuth, code signing |

## 🧪 qa-reports/

Report E2E/QA storici prodotti dagli agenti di test (marzo 2026). Formato `.txt`.

| File | Topic |
|---|---|
| [`e2e-edge-cases-report.txt`](qa-reports/e2e-edge-cases-report.txt) | E2E edge cases & robustezza |
| [`qa-onboarding-report.txt`](qa-reports/qa-onboarding-report.txt) | QA onboarding |
| [`test-pipeline-e2e-nondev.txt`](qa-reports/test-pipeline-e2e-nondev.txt) | Pipeline E2E profilo non-dev |
| [`test-profili-non-dev.txt`](qa-reports/test-profili-non-dev.txt) | Test 3 profili non-dev |
| [`test-report-fresh-setup.txt`](qa-reports/test-report-fresh-setup.txt) | Fresh setup + multi-profilo |

## 🗄️ _archive/

Note storiche superate o consolidate altrove. Conservate per git-blame e ricerca, non più aggiornate.

| File | Motivo archive |
|---|---|
| [`_archive/2026-05-06-launch-infra-costs.md`](_archive/2026-05-06-launch-infra-costs.md) | Stima costi pre-launch superata |
| [`_archive/2026-05-17-team-strategy-bugs.md`](_archive/2026-05-17-team-strategy-bugs.md) | Bug strategy team, fix applicati |
| [`_archive/2026-05-18-beta-tester-onboarding.md`](_archive/2026-05-18-beta-tester-onboarding.md) | Piano prep beta kick-off 2026-05-18 (behind-the-scenes maintainer); user guide → `guides/BETA.md` |
| [`_archive/2026-05-20-tour-persistence.md`](_archive/2026-05-20-tour-persistence.md) | Persistenza tour onboarding, implementata |
| [`_archive/2026-05-20-vps-bootstrap-bugs.md`](_archive/2026-05-20-vps-bootstrap-bugs.md) | Bug bootstrap VPS, fix validati in `postmortems/2026-05-21-vps-bootstrap-fixes-validated.md` |
| [`_archive/TODO-bridge-v7.md`](_archive/TODO-bridge-v7.md) | TODO bridge v7, completato |

---

## 📝 Convenzioni

- **File datati** (`YYYY-MM-DD-<slug>.md`) = snapshot temporale. Non riscrivere la storia dopo la chiusura.
- **File no-date** (`<topic>.md`) = spec/playbook live. Aggiornare in place.
- Quando una nota datata diventa spec evergreen, **rinominare** droppando la data e spostarla in `architecture/`.
- File obsoleti → `_archive/` con `git mv` per preservare history.
- Nuovi file: scegliere la sotto-cartella per categoria (vedi tabella sopra).
