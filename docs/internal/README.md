# 📚 docs/internal — indice

Note di lavoro interne: design lock, spec evergreen, postmortem e investigazioni.
Organizzate per **categoria** in sotto-cartelle. Come scrivere una nuova nota: vedi
[Protocollo note interne](#-protocollo-note-interne) in fondo.

> Per i doc utente-facing vedi `docs/about/`, `docs/guides/`, `docs/security/`.

---

## 🗂️ Categorie

| Cartella | Contenuto |
|---|---|
| [`architecture/`](architecture/) | Spec & design di sistema (living docs + design lock) |
| [`postmortems/`](postmortems/) | Incidenti, diagnosi, investigazioni e osservazioni datate |
| [`experiments/`](experiments/) | Simulazioni, studi, playbook, case study |
| [`roadmap/`](roadmap/) | Piani tecnici, backlog, tracker, idee parcheggiate |
| [`ops/`](ops/) | Infra, VPS, release, triage, credenziali |
| [`prototypes/`](prototypes/) | Prototipi isolati e relativi design verificabili |
| [`assets/`](assets/) | Materiale grafico interno: TODO arte, diagrammi sorgente |
| [`_archive/`](_archive/) | Note superate, conservate per git-blame |

File di root: [`landing-image-prompts.md`](landing-image-prompts.md) (prompt immagini del sito + rifiniture aperte) ·
[`2026-07-25-audit-doc-code-drift.md`](2026-07-25-audit-doc-code-drift.md) (audit doc↔codice del ciclo native: cosa era slittato, cosa è stato riallineato, che debito resta e sotto quale tag cercarlo) ·
[`2026-08-07-setup-guide-content-contract.md`](2026-08-07-setup-guide-content-contract.md) (contratto P0 per struttura, copy EN, naming, screenshot e riuso della guida setup non pubblicata) ·
[`2026-08-07-LEGAL-COPY-DRAFT.md`](2026-08-07-LEGAL-COPY-DRAFT.md) (audit pre-release e prima bozza EN di Privacy e Termini, conservata come percorso decisionale) ·
[`2026-08-07-LEGAL-COPY-RELEASE.md`](2026-08-07-LEGAL-COPY-RELEASE.md) (fonte EN approvata dall'operatore per Privacy e Termini, contratto di implementazione e verifiche obbligatorie pre-pubblicazione).
Il log review è in [`../REVIEW-LOG.md`](../REVIEW-LOG.md).

> Il canone narrativo delle Cronache è **archiviato con la pagina** (tolta dal sito
> pubblico): vive in [`archive/chronicles-v1/`](../archive/chronicles-v1/) accanto
> alle storie. La sua tabella cast/stile resta il riferimento per `landing-image-prompts.md`.

---

## 🏗️ architecture/

Design/architettura che riflette lo stato corrente. Aggiornati in place (living) o lock di design.

| File | Topic |
|---|---|
| [`2026-08-12-execution-host-vocabulary-contract.md`](architecture/2026-08-12-execution-host-vocabulary-contract.md) | 🖥️ Contratto del luogo di esecuzione: PC locale e VPS come host supportati, cloud opzionale separato dal runtime e capacità da non promettere |
| [`2026-08-12-dialogue-i18n-contract.md`](architecture/2026-08-12-dialogue-i18n-contract.md) | 🌍 Contratto eseguibile dei dialoghi authored EN+6: parità degli ID, resolver runtime, contesto LLM canonico e gate contro residui inglesi |
| [`2026-08-03-local-vault-design.md`](architecture/2026-08-03-local-vault-design.md) | 🔐 Design del vault locale: envelope encryption, broker runtime e migrazione fail-closed; richiede ADR e dependency review prima dell'implementazione |
| [`provider-touchpoint-inventory.md`](architecture/provider-touchpoint-inventory.md) | 🧭 Machine-checked map of provider-specific seams and the role-scoped M5 Local Scorer boundary |
| [`2026-08-03-maintenance-evidence-log-design.md`](architecture/2026-08-03-maintenance-evidence-log-design.md) | 🔬 `maintenance_events` append-only: oggi i campi di manutenzione sono stato last-write-wins, quindi chi scrive il timestamp senza lavorare è indistinguibile da chi lavora — evidenza ri-derivabile (status + hash), aggancio unico in `db_update.py`, tasso di no-op come metrica |
| [`cloud-sync-architecture.md`](architecture/cloud-sync-architecture.md) | Sync DB locale ↔ Supabase: cosa va in cloud, macro-event design, chat unificata gioco↔web (mig 060) |
| [`2026-07-22-web-demo-mode-and-welcome.md`](architecture/2026-07-22-web-demo-mode-and-welcome.md) | 🎭 Demo mode cloud (4 personas × 56 posizioni × 7 lingue) + wizard `/welcome`: stato nei cookie, ramo demo in testa a `lib/queries.ts`, scritture no-op |
| [`2026-07-11-team-directives-bacheca.md`](architecture/2026-07-11-team-directives-bacheca.md) | 📋 Bacheca `team_directives`: ordini permanenti dell'utente che sopravvivono al context-refresh del Capitano — tabella + skill consegnate, integrazione prompt e mirror Supabase ancora aperti |
| [`2026-07-21-web-sync-realtime-rework.md`](architecture/2026-07-21-web-sync-realtime-rework.md) | ⚡ Sync web Realtime-first: niente polling dal browser, backflow delle reply cloud→VPS, notifiche configurabili — **+ addendum 29/07**: la catena non finiva in SQLite, ora arriva al pane dell'agente |
| [`2026-06-20-data-sync-and-dashboard-split-design.md`](architecture/2026-06-20-data-sync-and-dashboard-split-design.md) | 🔄 Sync on-access + "Sync now" (no polling), event-log push, corsia richieste async, split dashboard locale/cloud |
| [`daemon-sync-redesign.md`](architecture/daemon-sync-redesign.md) | 🔌 Daemon: letture Supabase dirette (Fase 1) + event-driven Realtime (7/7 dietro flag `JHT_REALTIME_SYNC`); niente Fase 3 |
| [`2026-06-15-interaction-planes-redesign-design.md`](architecture/2026-06-15-interaction-planes-redesign-design.md) | Piani di interazione: web cloud read-only, desktop cockpit (locale + tunnel SSH), Telegram opzionale |
| [`candidate-profile-cloud-sync-redesign.md`](architecture/candidate-profile-cloud-sync-redesign.md) | Redesign sync profilo candidato |
| [`file-bridge-on-demand.md`](architecture/file-bridge-on-demand.md) | Pull-on-demand file via Supabase Storage |
| [`context-watchdog-spec.md`](architecture/context-watchdog-spec.md) | Restart periodico agenti via Dottore (anti context saturation) |
| [`onboarding-flow.md`](architecture/onboarding-flow.md) | Sequenza canonica onboarding: location → sync → Telegram → provider |
| [`skill-distribution.md`](architecture/skill-distribution.md) | Isolamento skill per-agente: distribuzione launcher-driven (no walk-up), layout pool + punch list |
| [`bot-telegram.md`](architecture/bot-telegram.md) | Design bot Telegram (3 bot obbligatori), ingest documenti, working hours |
| [`bridges.md`](architecture/bridges.md) | Role-map dei 3 bridge (.launcher): sentinel / pacing / heartbeat |
| [`2026-06-15-lean-comms-redesign.md`](architecture/2026-06-15-lean-comms-redesign.md) | Comunicazione interna team push→pull: notify solo a hand-off/safety, coordinamento via DB + capture-pane |
| [`2026-06-25-bridge-to-sentinella-pull-model.md`](architecture/2026-06-25-bridge-to-sentinella-pull-model.md) | Pacing push→pull: il bridge notifica solo la Sentinella, il Capitano tira on-demand (premessa quantitativa ridimensionata 02/07) |
| [`2026-06-26-capitano-graceful-scaling-paced-consumption.md`](architecture/2026-06-26-capitano-graceful-scaling-paced-consumption.md) | Scaling graduale del Capitano (skill `scaling-calc`), throttle floor sui worker, day-spread + riserva serale |
| [`2026-06-28-weekly-pacing-redesign.md`](architecture/2026-06-28-weekly-pacing-redesign.md) | Weekly pacing: verdetto imperativo + valuta token (dev3) e debt-aware con `debt_pct` (dev6) — gated sul deploy |
| [`2026-06-29-status-weekly-aware.md`](architecture/2026-06-29-status-weekly-aware.md) | `status` = vincolo binding dei 2 assi (5h ∧ weekly) — prototipo, non deployato |
| [`2026-06-20-taxonomy-brain-driven-redesign.md`](architecture/2026-06-20-taxonomy-brain-driven-redesign.md) | Tassonomia brain-driven: analista promuove dai grappoli, Capitano arbitro (C-17), auto-pass rimosso — deployato |
| [`2026-05-25-work-hours-design.md`](architecture/2026-05-25-work-hours-design.md) | Design working hours team |
| [`2026-05-20-world-globe-feature.md`](architecture/2026-05-20-world-globe-feature.md) | Spec mappamondo dashboard (coordinate ufficio) |
| [`2026-05-19-dashboard-routing-cases.md`](architecture/2026-05-19-dashboard-routing-cases.md) | Casi routing dashboard Next.js |
| [`2026-06-13-maintainer-toolhealth-resilience-design.md`](architecture/2026-06-13-maintainer-toolhealth-resilience-design.md) | Mantenitore + tool-health + resilience (design unificato) |
| [`2026-06-13-fix-batch-recheck-pacing-design.md`](architecture/2026-06-13-fix-batch-recheck-pacing-design.md) | Fix-batch: recheck quality, scout-resume, pacing, totalQuota |
| [`analista-expansion-design.md`](architecture/analista-expansion-design.md) | Espansione ruolo Analista |
| [`dottore-redesign-design.md`](architecture/dottore-redesign-design.md) | Ridisegno ruolo Dottore (context-refresh) |
| [`usage-monitoring-redesign-design.md`](architecture/usage-monitoring-redesign-design.md) | Ridisegno monitoraggio usage (Sentinella ↔ Capitano) |
| [`kimi-vs-codex-economics.md`](architecture/kimi-vs-codex-economics.md) | 💰 Economia provider (living): coordinatori ~20% uguali · budget Kimi ~2× (non 17×) · €/token ≈ pari · vero limite = precisione |

## 📉 postmortems/

Note datate su incidenti specifici, diagnosi, investigazioni e osservazioni.
**Non aggiornate dopo la chiusura** (correzioni = banner datato in testa) — la decisione live finisce nelle spec di `architecture/`.

| Data | File | Topic |
|---|---|---|
| 2026-08-03 | [`2026-08-03-beta5-cold-enter-team-freeze.md`](postmortems/2026-08-03-beta5-cold-enter-team-freeze.md) | 🧊 Team fermo 5 giorni (-80% produzione) senza un allarme: un `Enter` a freddo non viene processato dalla TUI, la cura si autoesclude come `draft_user`, `stepcap` riporta `stalled: 0` per costruzione e il TTL kill+recreate maschera tutto |
| 2026-07-27 | [`2026-07-27-tailwind-layer-vs-extension-css.md`](postmortems/2026-07-27-tailwind-layer-vs-extension-css.md) | 🧩 Header/liste invisibili su desktop: le utility Tailwind v4 in `@layer` perdono contro il `.hidden` non-layerizzato iniettato dalle estensioni — fix proposto, non applicato |
| 2026-07-18 | [`2026-07-18-provider-vendor-enum-config-ready.md`](postmortems/2026-07-18-provider-vendor-enum-config-ready.md) | 🧨 Timebomb `config_ready`: `active_provider` scrive il nome-vendor, il watchdog conosceva i nomi-CLI → pipeline ferma ~44h in totale silenzio, seconda VPS armata e non detonata |
| 2026-07-15 | [`2026-07-15-cloud-sync-413-freeze.md`](postmortems/2026-07-15-cloud-sync-413-freeze.md) | 🔌 Cloud-sync fermo ~14h: cursore del pull congelato → churn di `updated_at` → push oltre il limite del body (HTTP 413), guasto auto-alimentato che nessun watchdog ha visto |
| 2026-07-02 | [`2026-07-02-kimi-codex-token-forensics.md`](postmortems/2026-07-02-kimi-codex-token-forensics.md) | Misura token Kimi vs Codex in 2 passate: coordinatori ~20% uguali, budget ~2,7×, €/token ≈ pari → living doc economia |
| 2026-07-02 | [`2026-07-02-daily-halt-standby-leak.md`](postmortems/2026-07-02-daily-halt-standby-leak.md) | Daily hard-stop su betaB: funziona ma lo standby perde ~1–2%/notte (risvegli da timer di throttle) — fix aperti |
| 2026-07-01 | [`2026-07-01-capitano-kimi-thinking-off-writer-gate.md`](postmortems/2026-07-01-capitano-kimi-thinking-off-writer-gate.md) | Capitano Kimi `--no-thinking` inverte C-10 e ordina 30 CV mai richiesti → Capitano thinking ON (deployato) |
| 2026-07-01 | [`2026-07-01-betaD-daily-hardstop-validated.md`](postmortems/2026-07-01-betaD-daily-hardstop-validated.md) | Prima attivazione live del daily hard-stop su betaD: catena completa validata end-to-end |
| 2026-07-01 | [`2026-07-01-cv-quality-findings-beta3.md`](postmortems/2026-07-01-cv-quality-findings-beta3.md) | 4 difetti CV/CL beta-3 (lingue ripetute, registro dev, sources ignorate, titolo CL) + Critico lasco — 5 fix gated |
| 2026-06-30 | [`2026-06-30-reset-always-full-date.md`](postmortems/2026-06-30-reset-always-full-date.md) | Classe di bug "HH:MM senza data" sul reset weekly: fonte di verità epoch + choke point `fmt_reset()` |
| 2026-06-28 | [`2026-06-28-betaD-vps-budget-burn-investigation.md`](postmortems/2026-06-28-betaD-vps-budget-burn-investigation.md) | 39% weekly in <24h su betaD: coordinatori always-on, agente-fantasma `resume` (bug attribuzione), Dottore scagionato |
| 2026-06-27 | [`2026-06-27-betaC-sentinel-bridge-crash.md`](postmortems/2026-06-27-betaC-sentinel-bridge-crash.md) | Sentinel-bridge morto ~8h senza supervisione → fix 4-layer (hardening, respawn watchdog, canary Mantenitore) |
| 2026-06-26 | [`2026-06-26-sentinella-capitano-relationship-live.md`](postmortems/2026-06-26-sentinella-capitano-relationship-live.md) | Rapporto "Sentinella consiglia / Capitano verifica e decide" validato live + fix throttle che non scalava |
| 2026-06-25 | [`2026-06-25-rollout-observation-betaB.md`](postmortems/2026-06-25-rollout-observation-betaB.md) | Rollout push→pull: il Capitano aspetta un tick che non arriverà mai e scavalca la Sentinella → gerarchia ribaltata |
| 2026-06-25 | [`2026-06-25-desktop-team-integration-findings.md`](postmortems/2026-06-25-desktop-team-integration-findings.md) | Desktop↔team: `isLocalRequest` vs port-map Docker, controllo via `docker exec`, CSRF Electron, channel-awareness agenti |
| 2026-06-24 | [`2026-06-24-betaB-kimi-fresh-weekly-monitor.md`](postmortems/2026-06-24-betaB-kimi-fresh-weekly-monitor.md) | Monitor live su account Kimi fresco: rabbit-hole Scout-6, kill/[RIPRENDI], fix batch≤5 + cap100 (diario a snapshot) |
| 2026-06-24 | [`2026-06-24-betaA-weekly-milestones.md`](postmortems/2026-06-24-betaA-weekly-milestones.md) | Milestone weekly Codex: 99% su ciclo corto (18/06) e 100% pieno a 10 minuti dalla chiusura (24/06) |
| 2026-06-24 | [`2026-06-24-vercel-cost-analysis-and-sync-fix.md`](postmortems/2026-06-24-vercel-cost-analysis-and-sync-fix.md) | Spesa Vercel guidata dal polling dei daemon (Observability 60%); mig 045; −45% dopo il ritiro poller v0.1.22 |
| 2026-06-22 | [`2026-06-22-kimi-weekly-frontload-investigation.md`](postmortems/2026-06-22-kimi-weekly-frontload-investigation.md) | Causa-radice front-load Kimi: seed fossile `weekly_unlimited` in `provider_capacity.py` bypassa il ramo weekly-aware |
| 2026-06-21 | [`2026-06-21-throttle-floor-5min-analysis.md`](postmortems/2026-06-21-throttle-floor-5min-analysis.md) | Analisi throttle-events: mille micro-freni <5min → floor 5min + ladder enforced nel codice |
| 2026-06-21 | [`2026-06-21-betaA-daily-actions-drop-finding.md`](postmortems/2026-06-21-betaA-daily-actions-drop-finding.md) | Azioni/giorno 70→30: il pacing spalma il weekly + saturazione scout — work-limited, non budget-limited |
| 2026-06-17 | [`2026-06-17-betaB-kimi-weekly-burn-finding.md`](postmortems/2026-06-17-betaB-kimi-weekly-burn-finding.md) | Weekly Kimi esaurito in 2,1 giorni: backfill storm dell'arretrato dopo il deploy RULE-12/13/14 |
| 2026-06-16 | [`2026-06-16-betaA-taxonomy-collapse-finding.md`](postmortems/2026-06-16-betaA-taxonomy-collapse-finding.md) | Collasso tassonomia a 1 categoria su betaA (diagnosi in parte superata dal redesign brain-driven del 20/06) |
| 2026-06-15 | [`2026-06-15-coordinator-burn-consumo-finding.md`](postmortems/2026-06-15-coordinator-burn-consumo-finding.md) | Coniato il "coordinator-burn": turno LLM per bridge-tick anche a no-op (quota poi ridimensionata il 02/07) |
| 2026-06-14 | [`2026-06-14-betaA-risveglio-dottore-mantenitore-observation.md`](postmortems/2026-06-14-betaA-risveglio-dottore-mantenitore-observation.md) | Osservazione risveglio betaA (Dottore + Mantenitore in azione) |
| 2026-06-14 | [`2026-06-14-betaB-team-panoramica.md`](postmortems/2026-06-14-betaB-team-panoramica.md) | Panoramica team betaB (Kimi) |
| 2026-06-14 | [`2026-06-14-weekly-bind-not-enforced-finding.md`](postmortems/2026-06-14-weekly-bind-not-enforced-finding.md) | Weekly-bind non enforced: pacing su arco-5h, mai weekly |
| 2026-06-14 | [`2026-06-14-burst-transient-dead-letter-finding.md`](postmortems/2026-06-14-burst-transient-dead-letter-finding.md) | burst_transient ridimensionato (NON dead-letter) |
| 2026-06-13 | [`2026-06-13-osservazione-no-intervento.md`](postmortems/2026-06-13-osservazione-no-intervento.md) | Regola ferrea: mai intervenire in team in osservazione |
| 2026-06-11 | [`2026-06-11-overspawn-rootcause.md`](postmortems/2026-06-11-overspawn-rootcause.md) | Root cause over-spawn istanze |
| 2026-06-07 | [`2026-06-07-capitano-runaway-scaling-postmortem.md`](postmortems/2026-06-07-capitano-runaway-scaling-postmortem.md) | Runaway scaling Capitano (5 Scout / 4 Analisti) |
| 2026-06-04 | [`2026-06-04-scout-geo-concentration.md`](postmortems/2026-06-04-scout-geo-concentration.md) | Over-concentrazione geografica Scout |
| 2026-06-04 | [`2026-06-04-p7-weekly-reset-non-rilevato.md`](postmortems/2026-06-04-p7-weekly-reset-non-rilevato.md) | Weekly reset non rilevato (P7) |
| 2026-06-03 | [`2026-06-03-beta-vps-session-corrections.md`](postmortems/2026-06-03-beta-vps-session-corrections.md) | Correzioni sessione beta VPS |
| 2026-06-03 | [`2026-06-03-diagnosi-pacing-weekly.md`](postmortems/2026-06-03-diagnosi-pacing-weekly.md) | Diagnosi pacing weekly-blind |
| 2026-05-22 | [`2026-05-22-vercel-quota-exhaustion.md`](postmortems/2026-05-22-vercel-quota-exhaustion.md) | Vercel HTTP 402 / quota account |
| 2026-05-21 | [`2026-05-21-halt-weekly-incident.md`](postmortems/2026-05-21-halt-weekly-incident.md) | Halt VPS1 per saturazione weekly cap Codex |
| 2026-05-21 | [`2026-05-21-vps1-run-postmortem.md`](postmortems/2026-05-21-vps1-run-postmortem.md) | Postmortem consolidato VPS1 run 35h |
| 2026-05-21 | [`2026-05-21-vps-bootstrap-fixes-validated.md`](postmortems/2026-05-21-vps-bootstrap-fixes-validated.md) | Validazione fix bootstrap VPS |

## 🔬 experiments/

Simulazioni, studi comparativi, playbook e case study.

| Data | File | Topic |
|---|---|---|
| 2026-08-03 | [`2026-08-03-m4-entry-tier-evidence-protocol.md`](experiments/2026-08-03-m4-entry-tier-evidence-protocol.md) | M4: strumenti e bundle versionato per varianza Kimi/costi PAYG-subscription; hash, provenance e boundary fixture/live senza sostituire gli input esterni |
| 2026-08-03 | [`2026-08-03-regia-video-campagna.md`](experiments/2026-08-03-regia-video-campagna.md) | Regia del video di campagna «The Night Shift»: una posizione che attraversa l'ufficio di notte, il puntatore come spettatore |
| 2026-06-13 | [`2026-06-13-kimi-quota-tiers-discovery.md`](experiments/2026-06-13-kimi-quota-tiers-discovery.md) | Kimi: i 3 tier di quota + il buco `totalQuota` |
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

Piani tecnici, backlog, tracker e idee parcheggiate. Aggiornati finché aperti.

| File | Topic |
|---|---|
| [`MINOR-TRACKER.md`](roadmap/MINOR-TRACKER.md) | Tracker mini-fix e debt non-blocker (CI/lint, cross-platform, TODO inline, note) |
| [`db-schema-optimization.md`](roadmap/db-schema-optimization.md) | Evoluzione schema jobs.db (position_events, critic rounds, captain_decisions) — alimenta la missione M7 |
| [`2026-08-17-ticket-team-api-boundary.md`](roadmap/2026-08-17-ticket-team-api-boundary.md) | `[JHT-TEAM-API-BOUNDARY]`: una API sola sul container e client sottili — la casistica era già collassata in `deploy-mode.ts`, il confine è caduto per sbaglio il 2026-07-23 |
| [`2026-08-17-fetta1-stato-e-ripresa.md`](roadmap/2026-08-17-fetta1-stato-e-ripresa.md) | `[JHT-TEAM-API-BOUNDARY]` fetta 1, punto di ripresa: server `node:http` in ESM puro nel container (zero dipendenze, zero build step), i due scostamenti dichiarati dall'ADR-0009 col loro piano di ritiro, e cosa è committato contro cosa resta |
| [`2026-08-17-ticket-container-runtime-podman.md`](roadmap/2026-08-17-ticket-container-runtime-podman.md) | `[JHT-RUNTIME-PODMAN]`: Podman al posto di Docker — l'attrito sta su Windows, 348 call site e zero indirezione, e il verdetto di ADR-0001 è orfano |
| [`2026-08-03-ticket-video-campagna-now-playable.md`](roadmap/2026-08-03-ticket-video-campagna-now-playable.md) | `[PROMO-VIDEO-NOW-PLAYABLE]`: video di campagna sospeso a lavoro quasi finito — dove sta il girato, i 3 fix già in master, cosa manca |
| [`2026-07-30-ticket-throttle-engine-external.md`](roadmap/2026-07-30-ticket-throttle-engine-external.md) | `[THROTTLE-ENGINE-EXTERNAL]`: il timer esce dal processo dell'agente — `until` assoluti su disco, ack firmato dall'agente |
| [`2026-07-30-ticket-mode-injection-hourly-prompt.md`](roadmap/2026-07-30-ticket-mode-injection-hourly-prompt.md) | `[MODE-INJECTION-HOURLY-PROMPT]`: la modalità corrente iniettata ogni ora nel prompt del Capitano, letta da disco a ogni chiamata |
| [`2026-07-30-db-audit-observations.md`](roadmap/2026-07-30-db-audit-observations.md) | Audit del DB: code senza limite, dedup URL, e cosa ne è seguito |
| [`2026-08-08-scout-coordination-observations.md`](roadmap/2026-08-08-scout-coordination-observations.md) | Perché C-21 non si vede all'opera: misure su cinque squadre (la divisione è scritta ma non vissuta, e l'ufficio non la legge) |
| [`2026-07-29-ticket-team-standby-zero-spend.md`](roadmap/2026-07-29-ticket-team-standby-zero-spend.md) | `[TEAM-STANDBY-ZERO-SPEND]`: nessuna leva attuale azzera il costo di un team acceso — fermare anche i ruoli core |
| [`2026-07-29-ticket-doctor-unblock-and-session-ttl.md`](roadmap/2026-07-29-ticket-doctor-unblock-and-session-ttl.md) | `[DOCTOR-UNBLOCK-AND-TTL]`: il Dottore deve sbloccare, sessioni con TTL 12h — dall'incidente delle undici ore ferme con quota abbondante |
| [`2026-07-28-ticket-stepcap-throttle-resume.md`](roadmap/2026-07-28-ticket-stepcap-throttle-resume.md) | `[STEPCAP-THROTTLE-RESUME]`: ripresa automatica degli agenti fermi sul cap di step (`stepcap-watchdog.py`, implementato; resta la verifica su container vero) |
| [`2026-07-28-ticket-provider-cli-autoupdate.md`](roadmap/2026-07-28-ticket-provider-cli-autoupdate.md) | `[PROVIDER-CLI-AUTOUPDATE]`: auto-aggiornamento della CLI del provider all'avvio — nessun componente aveva quel compito, modello indietro di una generazione per undici giorni |
| [`2026-07-28-burn-on-demand-gates.md`](roadmap/2026-07-28-burn-on-demand-gates.md) | Gli automatismi di spesa non cedono all'ordine dell'utente: cinque deroghe manuali per una notte di burn, il sistema non sa che l'utente ha deciso diversamente |
| [`2026-07-27-scorer-per-user-weights.md`](roadmap/2026-07-27-scorer-per-user-weights.md) | Pesi dello Scorer per-utente: default nel codice + override dal profilo, al posto della tabella hardcoded negli spec in 8 lingue |
| [`2026-06-30-B1-deterministic-pacing-idea.md`](roadmap/2026-06-30-B1-deterministic-pacing-idea.md) | Idea B1: pacing deterministico ATTUA + LLM SUPERVISIONA (parcheggiata; partire da shadow-log) |
| [`2026-06-25-pacing-future-ideas.md`](roadmap/2026-06-25-pacing-future-ideas.md) | Even-spread giornaliero (cap→target) + riserva budget per richieste utente (aperte) |
| [`2026-06-20-proj-volatile-pacing-todo.md`](roadmap/2026-06-20-proj-volatile-pacing-todo.md) | `[PACING-PROJ-VOLATILE]`: gate del bridge su `proj` volatile — deferred, non toccare a caldo |
| [`2026-06-06-idle-enrichment-roadmap.md`](roadmap/2026-06-06-idle-enrichment-roadmap.md) | Roadmap arricchimento durante idle |
| [`2026-06-05-pacing-migration-plan.md`](roadmap/2026-06-05-pacing-migration-plan.md) | Piano migrazione pacing |
| [`2026-05-23-position-classifier-llm-roadmap.md`](roadmap/2026-05-23-position-classifier-llm-roadmap.md) | Roadmap classificatore posizioni LLM |

## ⚙️ ops/

Infra, deploy, lifecycle, accessi.

| File | Topic |
|---|---|
| [`INFRA.md`](ops/INFRA.md) | Overview infra (canali utente↔team, network, storage) |
| [`vps.md`](ops/vps.md) | Design VPS: host/container split, providers, install UX, lifecycle |
| [`release.md`](ops/release.md) | Processo release (tag → CI → GitHub Release) |
| [`triage.md`](ops/triage.md) | Triage feedback / bug report (tabella `feedback_tickets`) |
| [`recording-profiles.md`](ops/recording-profiles.md) | Profili sintetici deterministici e gate di isolamento per registrazioni web e gioco |
| [`download-funnel.md`](ops/download-funnel.md) | Report aggregato dei click download: query 72 ore, accesso service-role e limiti anonimi fail-closed |
| [`access-and-credentials.md`](ops/access-and-credentials.md) | Accessi e credenziali |
| [`MAINTAINERS.md`](ops/MAINTAINERS.md) | Coordinamento maintainer: Supabase, Vercel, OAuth, code signing |

## 🧪 prototypes/

| File | Topic |
|---|---|
| [`2026-08-19-scout-api-worker-design.md`](prototypes/2026-08-19-scout-api-worker-design.md) | Scout API TypeScript proposal-only: confini invariati, contratti, guardrail, provider profile e seam futuri tmux/SQLite |

## 🎨 assets/

Materiale grafico interno (sorgenti SVG dei diagrammi, brief per la pipeline `gen-art`).

| File | Topic |
|---|---|
| [`TODO-ART.md`](assets/TODO-ART.md) | Cosa manca da disegnare: i sei ritratti `pensieroso` (Lotto 1, chiuso su dev6 il 29/07) e il Lotto 2 ancora aperto — formato, ancore, criteri di accettazione |

## 🗄️ _archive/

Note storiche superate o consolidate altrove. Conservate per git-blame e ricerca, non più aggiornate.

| File | Motivo archive |
|---|---|
| [`_archive/BACKLOG-2026-07-03-frozen.md`](_archive/BACKLOG-2026-07-03-frozen.md) | Snapshot integrale del BACKLOG pre-ristrutturazione (1487 righe): ogni [TAG] chiuso si risolve qui |
| [`_archive/2026-07-03-desktop-app-status-and-vision.md`](_archive/2026-07-03-desktop-app-status-and-vision.md) | Stato + visione dell'app Electron: la visione si è realizzata nell'ufficio Godot, `desktop/` è stato rimosso il 2026-07-19 |
| [`_archive/2026-07-03-desktop-app-state-and-roadmap.md`](_archive/2026-07-03-desktop-app-state-and-roadmap.md) | Gemello del precedente (snapshot del giorno del lancio): decisioni ancora valide, dettagli tecnici Electron superati |
| [`_archive/2026-06-14-piano-dse3-parteB.md`](_archive/2026-06-14-piano-dse3-parteB.md) | Piano dse3 Parte B — bozza mai implementata, superata |
| [`_archive/2026-05-20-supabase-perf-backlog.md`](_archive/2026-05-20-supabase-perf-backlog.md) | Backlog perf Supabase — P0-P2 applicati 2026-05-31, resta solo monitoring pool (nel BACKLOG index) |
| [`_archive/2026-06-29-coordinator-burn-kimi-vs-codex.md`](_archive/2026-06-29-coordinator-burn-kimi-vs-codex.md) | Snapshot congelato dell'indagine coordinator-burn; conclusioni quantitative superate dal living doc `architecture/kimi-vs-codex-economics.md` |
| [`_archive/2026-06-29-dottore-offhours-burn-finding.md`](_archive/2026-06-29-dottore-offhours-burn-finding.md) | Finding errato (il gate off-hours del Dottore esisteva già); tenuto come lezione metodologica |
| [`_archive/2026-06-15-sync-web-release-gate-finding.md`](_archive/2026-06-15-sync-web-release-gate-finding.md) | Gate release master→production superato dagli eventi (release effettuate fino a v0.1.22) |
| [`_archive/2026-05-18-beta-tester-onboarding.md`](_archive/2026-05-18-beta-tester-onboarding.md) | Piano prep beta kick-off 2026-05-18 (behind-the-scenes maintainer); user guide → `guides/BETA.md` |
| [`_archive/2026-05-01-bridge-and-token-monitoring.md`](_archive/2026-05-01-bridge-and-token-monitoring.md) | Brainstorming bridge V6 + token-monitoring; idee ora shipped (monitoring stack / work-hours / cloud-sync) |

---

## 📝 Protocollo note interne

Regole pratiche per scrivere e mantenere questi doc senza doversi studiare la struttura.

1. **Nuova nota → root, al volo.** Scrivi `YYYY-MM-DD-<slug>.md` direttamente in `docs/internal/`.
   Non serve scegliere subito la categoria né aggiornare l'indice.
2. **Smistamento periodico.** Quando in root si accumulano ~10 note (o a fine ciclo di lavoro) si
   smistano nelle sotto-cartelle con `git mv` e si aggiorna questo README.
3. **File datati = snapshot.** Dopo la chiusura non si riscrivono. Se una conclusione si rivela
   sbagliata o superata, si aggiunge un **banner datato in testa** che rimanda alla verità nuova
   (pattern già in uso, es. taxonomy-collapse, coordinator-burn).
4. **File senza data = living doc.** Spec/playbook aggiornati in place, in `architecture/` o `ops/`.
   Quando più snapshot convergono su una verità stabile, questa si consolida in un living doc
   (pattern `kimi-vs-codex-economics.md`); gli snapshot restano come fonte.
5. **Doc gemelli** (stesso tema, stessi giorni) → si unificano in un solo file: contenuto integrale
   per parti, ogni parte con la nota `origine:` (pattern `daemon-sync-redesign.md`,
   `2026-06-28-weekly-pacing-redesign.md`).
6. **Superati o errati** → `_archive/` con `git mv` + motivo nella tabella qui sopra. Mai cancellare:
   valgono come storia di come ci siamo arrivati.
7. **Riferimenti nel codice.** Se un doc è citato in commenti di codice (`.launcher/`, `cli/`,
   `agents/`, test, migration), aggiornare i path quando lo si sposta (`grep -rn` sul basename).
8. **L'indice è testato.** `tests/test_docs_internal_index.py` confronta i `.md` presenti sotto
   `docs/internal/` con i link di questo README e fallisce sui non indicizzati. La regola 1 resta
   valida: le note **in root** sono esenti (è lì che si scrive al volo), come lo sono i `README.md`
   delle sotto-cartelle. Tutto il resto va indicizzato — se un file è davvero solo di passaggio,
   la via giusta è cancellarlo o archiviarlo, non allargare l'esenzione. La root non è però un
   deposito illimitato: oltre 12 note non smistate il test fallisce lo stesso, che è la regola 2
   scritta in codice.
