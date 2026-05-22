# 📚 docs/internal — indice

Note di lavoro interne: design lock, spec evergreen, postmortem e investigazioni.

> Per i doc utente-facing vedi `docs/about/`, `docs/guides/`, `docs/security/`.

---

## 🧭 Spec evergreen

Documenti di design/architettura che riflettono lo stato corrente del sistema. Vengono aggiornati in place.

| File | Topic |
|---|---|
| [`INFRA.md`](INFRA.md) | Overview infra (canali utente↔team, network, storage) |
| [`MAINTAINERS.md`](MAINTAINERS.md) | Coordinamento maintainer: Supabase, Vercel, OAuth, code signing, security review |
| [`bot-telegram.md`](bot-telegram.md) | Design bot Telegram (3 bot obbligatori), ingest documenti, working hours |
| [`cloud-sync-architecture.md`](cloud-sync-architecture.md) | Sync DB locale ↔ Supabase: cosa va in cloud, macro-event design |
| [`context-watchdog-spec.md`](context-watchdog-spec.md) | Restart periodico agenti via Dottore (anti context saturation) |
| [`onboarding-flow.md`](onboarding-flow.md) | Sequenza canonica onboarding: location → sync → Telegram → provider |
| [`release.md`](release.md) | Processo release (tag → CI → GitHub Release) |
| [`team-commands-bus.md`](team-commands-bus.md) | Channel comandi web → VPS via `team_commands` table |
| [`triage.md`](triage.md) | Triage feedback / bug report (tabella `feedback_tickets`) |
| [`vps.md`](vps.md) | Design VPS: host/container split, providers, install UX, lifecycle |

## 🔬 Investigazioni & postmortem

Note datate su incidenti specifici, ricerche puntuali, snapshot di stato. **Non aggiornate dopo la chiusura** — la decisione live finisce nelle spec sopra.

| Data | File | Topic |
|---|---|---|
| 2026-05-22 | [`2026-05-22-vercel-quota-exhaustion.md`](2026-05-22-vercel-quota-exhaustion.md) | Vercel HTTP 402 / quota account |
| 2026-05-21 | [`2026-05-21-halt-weekly-incident.md`](2026-05-21-halt-weekly-incident.md) | Halt VPS1 per saturazione weekly cap Codex |
| 2026-05-21 | [`2026-05-21-vps1-run-postmortem.md`](2026-05-21-vps1-run-postmortem.md) | Postmortem consolidato VPS1 run 35h (idle gaps + output analysis + kimi-vs-codex) |
| 2026-05-21 | [`2026-05-21-vps-bootstrap-fixes-validated.md`](2026-05-21-vps-bootstrap-fixes-validated.md) | Validazione fix bootstrap VPS |
| 2026-05-20 | [`2026-05-20-supabase-perf-backlog.md`](2026-05-20-supabase-perf-backlog.md) | Backlog performance Supabase |
| 2026-05-20 | [`2026-05-20-world-globe-feature.md`](2026-05-20-world-globe-feature.md) | Spec mappamondo dashboard (coordinate ufficio) |
| 2026-05-19 | [`2026-05-19-dashboard-routing-cases.md`](2026-05-19-dashboard-routing-cases.md) | Casi routing dashboard Next.js |
| 2026-05-06 | [`2026-05-06-agent-prompts-i18n.md`](2026-05-06-agent-prompts-i18n.md) | i18n prompt agenti (`agents/<role>/<role>.md`) |
| 2026-05-06 | [`2026-05-06-prompt-decomposition-skill-vs-manual.md`](2026-05-06-prompt-decomposition-skill-vs-manual.md) | Decomposizione prompt: skill vs prompt manuale |
| 2026-05-03 | [`2026-05-03-rate-kimi-weights.md`](2026-05-03-rate-kimi-weights.md) | Pesi rate-budget Kimi |
| 2026-05-01 | [`2026-05-01-bridge-and-token-monitoring.md`](2026-05-01-bridge-and-token-monitoring.md) | Brainstorming bridge + token monitoring |

## 🗄️ Archive

Note storiche superate o consolidate in altri file. Conservate per git-blame e ricerca, non più aggiornate.

| File | Motivo archive |
|---|---|
| [`_archive/2026-05-06-launch-infra-costs.md`](_archive/2026-05-06-launch-infra-costs.md) | Stima costi pre-launch superata |
| [`_archive/2026-05-17-team-strategy-bugs.md`](_archive/2026-05-17-team-strategy-bugs.md) | Bug strategy team, fix applicati |
| [`_archive/2026-05-20-tour-persistence.md`](_archive/2026-05-20-tour-persistence.md) | Persistenza tour onboarding, implementata |
| [`_archive/2026-05-20-vps-bootstrap-bugs.md`](_archive/2026-05-20-vps-bootstrap-bugs.md) | Bug bootstrap VPS, fix validati in `2026-05-21-vps-bootstrap-fixes-validated.md` |
| [`_archive/TODO-bridge-v7.md`](_archive/TODO-bridge-v7.md) | TODO bridge v7, completato |

---

## 📝 Convenzioni

- **File datati** (`YYYY-MM-DD-<slug>.md`) = snapshot temporale. Non riscrivere la storia dopo la chiusura.
- **File no-date** (`<topic>.md`) = spec/playbook live. Aggiornare in place.
- Quando una nota datata diventa spec evergreen, **rinominare** droppando la data (es. `2026-05-20-agent-context-saturation.md` → `context-watchdog-spec.md`).
- File obsoleti → `_archive/` con `git mv` per preservare history.
