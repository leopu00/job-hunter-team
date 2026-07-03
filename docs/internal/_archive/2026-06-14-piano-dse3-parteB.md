# 🗺️ Piano dse3 — Parte B (PACING + REQUEST-TABLES + RECHECK)

Piano per la fetta assegnata nella divisione a 3 (14/06): **dse3 = pacing/lockout-resilience + infrastruttura request-tables + recheck-scadute**. Complementare a dev2 (sync + infra-cloud) e dev1 (analista workflow + tassonomia categoria). Stato: **bozza per cross-review a 3**, NON ancora implementato.

## Blocco 1 — A2: lockout-resilience (rallenta-non-congela)
Linea utente: **RALLENTARE, mai CONGELARE** (pausa totale = rischio non-risveglio = danno grave). Convergenza dse3+dev2+dev1.

1. **STATUS = LOCKED/ESAURITO** (dse3, radice): in `weekly_pace.py`, quando `weekly_remaining==0%` (o si rilevano 403 `access_terminated`), lo stato esposto diventa `LOCKED`, non più `SOTTOUTILIZZO` (oggi calcolato sull'arco-5h). → il Capitano smette di spawnare worker = **spenta la SORGENTE dei 403**, non solo il sintomo.
2. **POLLING usage = f(distanza-dal-reset)** (dev2): locked+lontano → rado (15–30min); vicino al reset → fitto (cogliere la ripartenza). `reset_at` come riferimento **dinamico**, non hard-coded.
3. **FAIL-SAFE** (dev1): il polling rallentato non va MAI a zero, **nemmeno se `reset_at` è ignoto/stale** → floor di slow-poll sempre attivo (es. ≥ ogni 15–30min) + check-cardine `weekly < 100%?` che non muore mai. Il risveglio non dipende dal solo timestamp del reset.
4. **STRATO-2 notifiche** a Sentinella/Capitano: a 100% → UN solo avviso `LOCKED fino a HH:MM` + heartbeat; niente spam, niente azzeramento.
5. **Estensione MONTHLY-QUOTA** (P5, dev2): stesso rallenta-non-congela per il tetto mensile, non solo weekly.
- **File:** `shared/skills/weekly_pace.py` (stato LOCKED), `.launcher/sentinel-bridge.py` + `.launcher/pacing-bridge.py` (cadenza polling, fail-safe, throttle notifiche).
- **NB:** il preventivo `vel_target = min(arco_5h, weekly_sost)` (weekly-bind) resta **priorità minore** — per A1 il lockout 5h-early è benigno; conta per il caso *giorni-prima*.

## Blocco 2 — Request-tables infra
Scheletro DB che fa agire gli analisti in base a tabelle di richiesta, sul modello provato `write_requested` / `geocode_requested`.

- **Nuove tabelle:** `recheck_requested`, `categorize_requested`, `salary_precise_requested`.
- **Schema comune (bozza):** `id`, `position_id`, `requested_by` (user|capitano|system), `requested_at`, `priority`, `status` (pending|in_progress|done), `result`/`notes`, `done_at`.
- **Helper condivisi:** `db_query.py next-for-<task>` (pesca per priorità+pending) + `db_update.py` mark in_progress/done.
- **Confine di responsabilità:** dse3 fornisce **schema + helper (infra)**; il **consumo lato prompt** è `analista.md` (dev1).
- **Migration:** nuova (verifico i numeri liberi su `supabase/migrations/` + `origin/master` prima di crearla).
- **⚠️ Open question per dev2 (sync):** le richieste *user-facing* (categorize / salary-precise dal web) devono fare round-trip **cloud → VPS**? Se sì, intercetta la lane sync di dev2 → da coordinare (le tabelle-richiesta potrebbero servire sync bidirezionale, non solo il push VPS→cloud).

## Blocco 3 — Recheck-scadute (B5 priorità-1)
Rendere SISTEMATICO il recheck di liveness delle posizioni scadute (oggi ad-hoc), priorità inizio-giornata.

- `recheck_liveness.py` (già fatto, tiered curl→browser→OPEN_UNVERIFIED) **cablato** al flusso `recheck_requested`.
- **Scheduler/populator** (mia infra) che riempie le code automaticamente:
  - `recheck_requested` per posizioni con `last_open_check` stale (> N giorni) → l'analista esegue `recheck_liveness` → aggiorna `is_open`/`status`;
  - `categorize_requested` per posizioni con `role_family IS NULL` (backlog non-categorizzato) → così la specializzazione di dev1 ha sempre lavoro in coda senza intervento manuale.
- Così il recheck-scadute è guidato dalle tabelle, non improvvisato; il Capitano può alzarne la priorità a inizio giornata (B5).
- **Sinergia col Blocco-2 di dev1** (metadati mandatori sui `new`): ogni nuova posizione prende `role_family` inline → `categorize_requested` è essenzialmente **backfill** degli esistenti + rete di sicurezza; il backlog si esaurisce e poi la coda resta per lo più vuota (comportamento voluto).
- NB metodo: su betaB non ho potuto confermare l'esecuzione `recheck_liveness` dai log (TUI Kimi non grep-abile); la verifica del metodo passa per betaA (dev2) — il cablaggio request-table rende comunque tracciabile il recheck (riga `done` + result).

## Dipendenze & sequencing
- **Blocco 2 schema** va allineato con dev1 (consuma le tabelle in `analista.md`) e dev2 (eventuale sync delle richieste user-facing).
- **Prerequisito globale (scoperta dev2):** il sync-fix del push-route (role_family/loc_*/work_mode) è critical-path per la dashboard; la mia produzione recheck/metadati è a valle. Caveat dev1: confermare che il daemon di sync stia PUSHANDO su betaA (la sync era ferma da fine maggio per last_actor).
- Ordine: (1) fix-piccoli A3 [dev2] → (2) cross-review dei 3 piani → (3) consolidamento → (4) validazione utente → (5) implementazione → (6) deploy sulle 2 VPS.

## File toccati (mia lane, zero overlap)
`shared/skills/weekly_pace.py`, `shared/skills/recheck_liveness.py`, `shared/skills/db_query.py` + `db_update.py` (estensioni request-tables), `.launcher/sentinel-bridge.py`, `.launcher/pacing-bridge.py`, nuova migration per le 3 tabelle. NON tocco: `analista.md` (dev1), push-route/start-agent.sh (dev2).
