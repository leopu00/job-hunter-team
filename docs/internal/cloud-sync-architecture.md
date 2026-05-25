# Cloud sync — architecture & status

> **Living doc.** Source of truth per la strategia cloud sync JHT. Unifica:
> incident RobertHalf 2026-05-19, decisione macro-events 2026-05-20, stato
> implementazione a oggi. Aggiornare a ogni shift architetturale.

## 🧭 TL;DR oggi (2026-05-22)

- **Modello scelto**: cloud Supabase = mirror **macro-event** del SQLite locale, non telemetria live. Container è source-of-truth.
- **Direzione flusso**: push-only locked dal 2026-05-13 ([project_cloud_sync_direction]). Confermato.
- **Granularità**: dal 2026-05-20 decisa la **decimazione** — niente più `sentinel_ticks` né `team_commands` in cloud; solo transizioni di status user-visible.
- **Local PC mode**: web bypassa Supabase, legge `jobs.db` direttamente via `web/lib/local-queries.ts`.
- **VPS live theater** (org-chart animato, popover Sentinella): canale dedicato app↔VPS — NON Supabase. PHASE 3 — `[JHT-CLOUD-06]`.

## 📐 Architecture

```
┌──────────────────────┐    push delta-only      ┌─────────────────┐
│  Container (SQLite)  │ ──────────────────────► │  Supabase mirror│
│  source-of-truth     │   only macro-events     │  read-only side │
└──────────────────────┘                          └─────────────────┘
         │                                                │
         │  local web dashboard                           │  cloud web
         │  (Local PC mode bypass)                        │  dashboard
         ▼                                                ▼
   web/lib/local-queries.ts                     web/lib/queries.ts
```

### Cosa va in cloud

| Tabella | Cadenza | Note |
|---|---|---|
| `positions` | ✅ event-driven su `status` transition | discovered → scored → ready → applied → rejected |
| `scores`, `applications`, `position_highlights` | ✅ event-coalesced con positions | push insieme alla transizione |
| `companies` | ✅ event-driven | nuova company o metadata user-visible cambiato |
| `candidate_profiles`, `user_onboarding_state`, `encrypted_user_blobs` | ✅ event-driven naturale | invariati |
| `pending_user_messages` (mig 010) | ✅ canale fallback notifiche | flow Telegram → DB → prompt injection |
| `sentinel_ticks` (mig 013) | ⛔ **da rimuovere** | ~720 row/h/utente, solo container ne ha bisogno (Bridge/Sentinella) |
| `team_commands` (mig 012) | ⛔ **da rimuovere** | chat inter-agente, non user-visible |

**Ordine di grandezza atteso post-decimazione**: write rate –90% circa.

## 📜 Incident history — RobertHalf redux (2026-05-19)

**Root cause**: row corrotta su VPS2 (`positions.id=101`, `location` di 4394 char di HTML scout-malparsed) ha innescato `HTTP 400 constraint violation` su ogni batch push. Daemon batch-or-nothing → retry loop → connection pool Supabase saturo (Nano tier) → middleware Next.js timeout → 504 GATEWAY_TIMEOUT user-facing per ~1h.

**Fix immediato applicato**:
- Truncate row VPS2 a placeholder (`UPDATE positions SET location='London (corrupted...)' WHERE id=101`)
- VPS2 sync disabilitato (conservato per analisi), VPS1 riabilitato
- Supabase Nano → Micro (incluso nel Pro plan, no extra cost): RAM 0.5GB→1GB, CPU dedicato

**Findings post-upgrade (`supabase__get_advisors`)**: 40+ raccomandazioni perf mai applicate. Dettaglio in `2026-05-20-supabase-perf-backlog.md`. Highlight:
- `auth_rls_initplan` × 24 — `auth.uid()` per row invece di `(select auth.uid())` una volta per query → amplificatore primario del 504-storm
- `unindexed_foreign_keys` × 9 — penalty su JOIN/cascade
- `unused_index` × 7 — write overhead inutile

**Decisione conseguente**: la frequenza+granularità del sync era il vero problema. → macro-events only.

## 🎯 Decisione strategica (2026-05-20)

Vedi sopra "Cosa va in cloud". Trade-off accettati:

| Cosa perdiamo | Mitigazione |
|---|---|
| Tick sentinella in tempo reale lato dashboard cloud | "Ultimo macro-event + heartbeat". Live theater su VPS+tunnel (PHASE 3) |
| Analytics storiche su tick/messaggi inter-agente | Restano sul container, pullabili on-demand per debug interno |
| `team_commands` non più replicate | Fallback notifiche resta via `pending_user_messages` (mig 010) |
| Local PC users senza dashboard cloud-side | Erano già `not recommended for daily-use` ([project_deployment_modes]). Privacy-first è feature, non bug |

## 🛠️ Stato implementazione

### ✅ Done

| Item | Commit | Data |
|---|---|---|
| Cap `positions.location` ≤ 200 char (PG CHECK) | `4dcc712f` mig 015 | 2026-05-19 |
| Push delta-only via `updated_at` cursor + halt-flag guard | `690534e0` | 2026-05-22 |
| Web fallback quando manca SQLite locale | `cc52acca` | 2026-05-22 |
| Supabase compute Nano → Micro | dashboard | 2026-05-19 |
| Rimozione `sentinel_ticks` dal push daemon | `f68a127d` | (storico, pre-2026-05-23) |
| **Refactor team_state desired-state + 3 event lanes** (mig 019) | `627e7ab5` | 2026-05-23 |
| **Fix RLS `location_geocode`** (cache poisoning) (mig 020) | `627e7ab5` | 2026-05-23 |
| **Realtime publication su 4 tabelle** (browser ~200ms) (mig 021) | `627e7ab5` | 2026-05-23 |
| **Touch `updated_at` via `clock_timestamp()`** (mig 022) | `d17e7c70` | 2026-05-23 |
| **Single-team enforcement runtime**: claim 409 + push 409 + PATCH 409 | `3427a304` | 2026-05-23 |
| **Hardening trigger team_state** (search_path + REVOKE EXECUTE) (mig 023) | `e6420371` | 2026-05-23 |
| **CLI cloud preflight + 409 killswitch + login UX warn** | `98118878` | 2026-05-23 |
| **Bottoni Start/Stop UI bulk usano `useTeamState`** | `39f1d778` | 2026-05-23 |
| **Bottone Start/Stop derivato da team_state** (no più activeCount) | `046a0109` | 2026-05-23 |
| **Optimistic update bottone + fix toast `[object Object]`** | `027b550b` | 2026-05-23 |
| **Polling fallback 5s su useTeamState** (Realtime safety net) | `9232c99a` | 2026-05-23 |
| **Realtime channel auth con JWT user** (`setAuth(jwt)`, fix postgres_changes silenti) | `22e334c8` | 2026-05-23 |
| **Rate limit 120→300 + polling team_state 5s→15s** | `19b6f816` | 2026-05-23 |
| **Polling pagina /team -73%** (~157→34 req/min) | `bde2fd94` | 2026-05-23 |
| **Rate limit per-session** (auth 600/min, anon 120/min) | `f306af19` | 2026-05-23 |
| **Fix /api/agents 404** (.vercelignore matchava web/app/api/agents/) | `8307bd3b` | 2026-05-23 |
| **Fix /api/tokens/* 500** (isLocalRequest → empty graceful su Vercel) | `02e3bcbb`+`8b506a75` | 2026-05-23 |
| **`/api/agents` legge da `team_state.is_running`** (era stuck su team_commands legacy) | `a7bde38e` | 2026-05-23 |
| **Gate centrale `.team-halted.flag`** (watchdog/spawner/pid1/jht-start rispettano user Stop) | `016b7b3d` | 2026-05-25 |

### ⬜ Pending (in ordine di priorità)

1. ~~**P0 — Refactor `team_commands` → `team_state` desired-state**~~ ✅ **DONE 2026-05-23** (mig 019/020/021/022/023, commit `627e7ab5...e6420371`). Single-team enforcement runtime completo (claim 409 + push 409 + PATCH 409 + reconciler retry + CLI preflight). `team_commands` ancora vivo in parallelo per cutover graduale → vedi Step 5/6.
2. **P0 — SQLite locale: replicare CHECK constraint di Postgres** (`location ≤ 200`, `title ≤ 500`, `company ≤ 300`). Migration `cli/migrations/006_positions_check_constraints.sql`. Lo scout vedrà errore subito, non a valle. *Origin: incident root cause.*
3. **P0 — RLS init plan fix** (24 policy con `auth.uid()` per row). Migration dedicata (non 017 che è geocoding). Ortogonale alla decimazione: senza, anche cloud "leggero" paga `O(N×K)` sotto carico.
4. **P0 — DELETE propagation con tombstone**. Il push è solo UPSERT: una riga cancellata in SQLite locale (`web/app/api/cloud-sync/push/route.ts:338`, `cli/src/commands/cloud.js:490-510`) **non viene mai comunicata a Supabase** e resta ghost in cloud per sempre. Componenti:
   - Colonna `deleted_at TIMESTAMPTZ` su tutte le tabelle sincronizzate (positions, applications, contacts, scores, position_highlights), default NULL
   - In SQLite locale: trigger che setta `deleted_at = now()` invece di hard delete (oppure tabella `_tombstones(table, legacy_id, deleted_at)` se non si vuole toccare lo schema esistente)
   - Push include le righe con `deleted_at IS NOT NULL` modificate dopo il cursore; lato Supabase un job ripulisce le righe `deleted_at < now() - 30d`
   - Dashboard prod filtra `WHERE deleted_at IS NULL` di default
   - *Origin: rischio residuo 2026-05-23 dopo single-team enforcement.*
5. **P0 — Riparare CI/Tests/Lint pre-esistenti** (falliscono da 2026-05-22): test smoke-finale con soglie sbagliate (41 vs ≥100 pagine), test ENOENT su file inesistenti (`web/(protected)/app/components/sidebar.tsx`), ESLint 100+ warning `any`. Non bloccanti per refactor ma falsano il signal di qualità.
6. **P1 — Subscriber on-demand 🅲**. Spawn/kill del `realtime-listen` agganciato a `team_state.is_running` (post-refactor #1). Team giù → polling giù → 0 carico Vercel/Supabase. Team su → polling vivo per UX chat. *Promosso da P2 dopo conferma visione web-first.* 🅱️ "alza interval 5s→60s" **archiviato** (incompatibile con latenza chat).
7. **P1 — Polling adattivo basato su user activity**. Container regola interval in base a `team_state.last_user_activity_at`: chat attiva (<2min) → 3s, dashboard idle (2-15min) → 30s, abbandonata → off. Auto-sostenibilità del costo polling.
8. **P1 — Feedback loop position (like/dislike): istruire agenti** (infra `position_feedback` ✅ done). Resta: progettare istruzioni per scout (skip simili a dislike) e scorer (boost simili a like). Letture su position_feedback da agenti container.
9. **P1 — Daemon push alert quando ≥3 fail consecutivi** ✅ implementato in `cli/src/commands/cloud.js handleDaemon` (WARN_AT=3, MAX_CONSECUTIVE_FAILS=5 → auto-shutdown). Vale anche per 409 not_active_device (vedi commit `98118878`).
10. **P1 — Killswitch su 401/403 ripetuti**. Oggi `cli/src/commands/cloud.js:672-675` logga il 401 da token revocato ma il daemon **continua loop infinito ogni ~30s**. Comportamento atteso: 3 risposte 401/403 consecutive → halt del daemon + notifica `pending_user_messages` ("Token revocato, riapri il pairing"). Distinto dal P1 #9 (5xx/409 generico): qui è auth, non transient. *Nota: 409 not_active_device già coperto, 401/403 no.*

**Edge case noto post-refactor 2026-05-25**: il `reconciler` legge solo `team_state.is_running` dal DB, non sa di tmux session locali. Scenario "DB stale vs container running" può accadere se:
   (a) utente clicca Stop, DB → `should_run=false` `is_running=false`
   (b) container muore prima di applicare lo stop (es. SIGKILL brutale)
   (c) container restart, pid1 vede `.team-halted.flag` assente (non era stato creato) → auto-start agenti
   (d) reconciler primo poll: vede `should_run=false && is_running=false` → noop, ma agenti girano
   Risultato: agenti operativi nonostante DB dice stopped. Workaround manuale: SQL `UPDATE team_state SET should_run=true` per nudge reconciler, poi click Stop. Fix proper richiede al reconciler verifica reale tmux al boot (tmux ls + parse). *Discovered nel test E2E 2026-05-25 con Leone*.
11. **P1 — Disaster recovery: `jht cloud restore` esplicito**. Oggi il bootstrap (`cli/src/commands/cloud.js:141`, `:710`) si attiva **solo** dentro `enable`/`login`. Se il SQLite locale muore (disco pieno, container corrotto, reset onboarding parziale) non c'è un comando "ricostruisci da cloud". Serve comando dedicato + conferma esplicita ("Sovrascriverai N righe locali con M righe cloud, procedo?") per evitare overwrite accidentale.
12. **P1 — `JHT-LOCAL-NO-API`**: `web/lib/queries.ts` switcha su `local-queries.ts` quando `cloud.json.enabled=false`. Verificare `MainChrome.tsx` + `dashboard/page.tsx`.
13. **P1 — Cutover team_commands→team_state**: Step 5 backlog. Switch UI bulk Start/Stop ✅ done. Resta: handleAction per singolo agente ancora su useTeamCommandPoller; switch incrementale + verifica E2E + Step 6 drop tabella.
12. **P2 — Scout RobertHalf parser fix**: con P0bis in place, il bug emerge alla prima esecuzione (field swap title↔location).
13. **P2 — Account Supabase mismatch warning UI**. Memoria `project_supabase_dual_accounts`: due account Google distinti = due pool isolati. Single-team enforcement opera per-account, non avvisa se l'utente è loggato col Google sbagliato rispetto al pairing-token del team. Aggiungere check: al boot del team, confronta `auth.user.email` del token con l'email salvata in `cloud.json` → se diverso, blocco push + notifica.
14. **P2 — Scout RobertHalf parser fix**: con CHECK SQLite in place (P0 #2), il bug emerge alla prima esecuzione (field swap title↔location).
15. **P2 — Account Supabase mismatch warning UI**. Memoria `project_supabase_dual_accounts`: due account Google distinti = due pool isolati. Aggiungere check: al boot del team, confronta `auth.user.email` del token con email salvata in `cloud.json` → se diverso, blocco push + notifica.
16. **P2 — Schema drift alert su fallback full-read**. `cli/src/commands/cloud.js:380-400` cade silenziosamente da delta-only a full-read quando manca `updated_at`. Resiliente ma maschera drift.
17. **P2 — Canary endpoint** per distinguere "Supabase saturo" da "Vercel slow".
18. **DESIGN CONSTRAINT — Web write su prod (concretizza con visione web-first)**. ✅ Già adottata strategia **C** (tabelle dedicate event log `user_to_agent_messages` + `position_feedback`) nel refactor. Resta da pianificare se domani aggiungeremo write su entità esistenti (es. `positions.status` dal mobile).
19. **PHASE 3 — VPS live theater channel** (`[JHT-CLOUD-06]`): WebSocket over SSH tunnel. Non passa per Supabase. **Strategico** post visione web-first: abilita chat sub-secondo senza prezzo polling. Browser ha già Realtime (~200ms via Supabase WS); WS over SSH serve solo se vogliamo bypassare Supabase del tutto per VPS↔web.

### 🎨 Web dashboard feature gap (Task #18, #19)

Scoperti durante test E2E refactor 2026-05-25. Dashboard cloud `jobhunterteam.ai/team` mancano 2 feature che funzionano solo su localhost:

20. **P1 — Animazioni pallini inter-agente su cloud (Task #18)**. Su localhost TeamOrgChart anima pallini che passano da un agente all'altro (polling `/api/team/messages` + `/api/team/queue`). Su cloud le animazioni non partono: i dati di comunicazione tmux interna del container non arrivano fino a Supabase. Design:
   - Nuova tabella `agent_messages` push-friendly (`from_agent`, `to_agent`, `kind`, `at`) OPPURE riuso esteso di `user_to_agent_messages`
   - Bridge container aggrega sample ogni 30s (cadenza macro-events post-2026-05-20)
   - Browser: `useAgentMessages` hook Realtime → TeamOrgChart subscriber
   - **Why**: vision web-first; il browser deve mostrare team "vivo" come localhost
21. **P1 — Rate Budget chart su cloud (Task #19)**. Il blocco "RATE BUDGET" (UsageChart, UsageTokensChart, AgentTokensChart, ThrottleChart, TokenTypesChart) è vuoto su cloud: `sentinel_ticks` rimosso dal push (`f68a127d` decimazione macro-events 2026-05-20) + endpoint `/api/tokens/*` dipendono da script Python locali. Su Vercel ritornano empty graceful (fix `02e3bcbb`/`8b506a75`) ma niente grafici. Design:
   - Re-introdurre push sentinel a cadenza bassa (1 sample / 2 min, non 30s pre-decimazione)
   - Nuova tabella `sentinel_summary` con bucket aggregati (volume gestibile vs incident RobertHalf)
   - Migrate `/api/tokens/by-agent` `/throttle` `/by-type` da Python → SQL query Supabase
   - `/api/sentinella/data` cloud branch legge da Supabase invece del file JSONL locale

### 💰 Risparmio token + 🎯 Feedback loop ricco (Task #20, #21)

Discovered 2026-05-25. Pattern: dare all'utente più controllo + segnali per orientare team senza accendere agenti. Stesso DNA del CV writer toggle.

22. **P1 — Geocoding location opt-in/out per posizione (Task #20)**. Sim dev2 (sim-1/2/3) mostra che geocoding precise sull'ufficio popola bene `/map` ma costa molto agli analisti. Servono 3 modes:
   - **ALL**: ogni position riceve geocoding (default off, costoso)
   - **NONE**: zero geocoding (default safe)
   - **SELECTIVE**: utente fa spunta per-position
   - Backend: `positions.geocode_requested BOOLEAN`, analista legge prima di partire
   - Pattern: stesso del "scrittore on/off per CV" (esistente)
   - Compatibile con feedback loop (#21): "scaduta/non interessante" → no geocode
23. **P1 — Feedback loop utente esteso (Task #21, estende #4)**. Vector vario per orientare scout/scorer:
   - **Sentimento qualitativo** (1 click): like, dislike, interesting, expired, out_of_budget, wrong_location
   - **Commento libero** (testo)
   - **Punteggio** 1-10 opzionale
   - **Direzionale**: more_like_this / less_like_this → scout cerca simili/evita
   - Schema: estende `position_feedback` (mig 019) con `comment`, `score`, `direction`
   - Capitano/Scout/Scorer leggono via Realtime + integrano nelle decisioni
   - **Why**: web-first vision → l'utente dà valore senza consumare token AI

## 🔗 Riferimenti

- [project_cloud_sync_direction] (memory) — push-only lockato 2026-05-13
- [project_team_location_exclusive] (memory) — un solo writer alla volta
- [project_fallback_via_cloud_sync] (memory) — notifiche via `pending_user_messages`
- `docs/internal/2026-05-20-supabase-perf-backlog.md` — 40+ findings advisor
- `docs/internal/2026-05-22-vercel-quota-exhaustion.md` — incident parallelo (push troppo aggressivo + dashboard polling)
- `BACKLOG.md` — entry `[JHT-CLOUDSYNC-01]`, `[JHT-CLOUD-06]`, `[JHT-LOCAL-NO-API]` (da creare)

## 📂 Storia / superseded by

Questo doc consolida e sostituisce:
- `2026-05-19-sync-incident-roberthalf-redux.md` (incident post-mortem completo)
- `2026-05-20-sync-macro-events-decision.md` (decision record granularità)

Per il dettaglio completo dell'incident (timeline minuto-per-minuto, diagnostic queries SQL, full advisor findings) consultare la git history di questi 2 file prima del commit di consolidamento.
