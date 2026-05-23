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

### ⬜ Pending (in ordine di priorità)

1. **P0 — Refactor `team_commands` → `team_state` desired-state + event lanes**. Cambio di paradigma da command log a desired-state reconciler (Kubernetes-style), motivato dalla visione web-first di Leone (2026-05-23): chat agenti già attiva, like/dislike position, feedback web in roadmap immediata. Accorpa **3 voci del backlog** (ex-#1 rimozione `team_commands`, ex-#4 single-team enforcement, status inference sparsa). Componenti:
   - **`team_state`** (1 riga per `user_id`): `should_run BOOLEAN`, `agents_enabled JSONB`, `restart_token UUID`, `active_device_id UUID`, `last_heartbeat_at`, `is_running BOOLEAN`, `last_user_activity_at` (per polling adattivo). Web scrive desired, container scrive observed.
   - **`user_to_agent_messages`** (event log): chat utente → agente. `user_id`, `agent`, `message`, `sent_at`, `replied_at`. Bidirezionale con `pending_user_messages` esistente per le risposte.
   - **`position_feedback`** (event log): like/dislike + segnali (vedi #5). Separato da `positions.status` per evitare conflitto con [#14 design constraint web write].
   - `web/app/api/cloud-sync/push/route.ts` rifiuta con `409 Conflict` se `token.device_id != team_state.active_device_id` (single-team enforcement gratis dentro `team_state`).
   - `/api/status` (oggi deduce active da `team_commands`, vedi commit `ae3f2852`) → SELECT su `team_state.is_running`.
   - Drop `team_commands` solo dopo cutover testato. RLS nuova per le 3 tabelle.
   - *Tradeoff documentati*: audit dei comandi web perso (sezione `_history` opzionale se serve), restart via `restart_token` (hack ma funziona). Vedi conversation 2026-05-23 in `conversations/`.
2. **P0 — SQLite locale: replicare CHECK constraint di Postgres** (`location ≤ 200`, `title ≤ 500`, `company ≤ 300`). Migration `cli/migrations/006_positions_check_constraints.sql`. Lo scout vedrà errore subito, non a valle. *Origin: incident root cause.*
3. **P0 — RLS init plan fix** (24 policy con `auth.uid()` per row). Migration dedicata (non 017 che è geocoding). Ortogonale alla decimazione: senza, anche cloud "leggero" paga `O(N×K)` sotto carico.
4. **P0 — DELETE propagation con tombstone**. Il push è solo UPSERT: una riga cancellata in SQLite locale (`web/app/api/cloud-sync/push/route.ts:338`, `cli/src/commands/cloud.js:490-510`) **non viene mai comunicata a Supabase** e resta ghost in cloud per sempre. Componenti:
   - Colonna `deleted_at TIMESTAMPTZ` su tutte le tabelle sincronizzate (positions, applications, contacts, scores, position_highlights), default NULL
   - In SQLite locale: trigger che setta `deleted_at = now()` invece di hard delete (oppure tabella `_tombstones(table, legacy_id, deleted_at)` se non si vuole toccare lo schema esistente)
   - Push include le righe con `deleted_at IS NOT NULL` modificate dopo il cursore; lato Supabase un job ripulisce le righe `deleted_at < now() - 30d`
   - Dashboard prod filtra `WHERE deleted_at IS NULL` di default
   - *Origin: rischio residuo 2026-05-23 dopo single-team enforcement.*
5. **P1 — Subscriber on-demand 🅲**. Spawn/kill del `realtime-listen` agganciato a `team_state.is_running` (post-refactor #1). Team giù → polling giù → 0 carico Vercel/Supabase. Team su → polling vivo per UX chat. *Promosso da P2 dopo conferma visione web-first.* 🅱️ "alza interval 5s→60s" **archiviato** (incompatibile con latenza chat).
6. **P1 — Polling adattivo basato su user activity**. Container regola interval in base a `team_state.last_user_activity_at`: chat attiva (<2min) → 3s, dashboard idle (2-15min) → 30s, abbandonata → off. Auto-sostenibilità del costo polling.
7. **P1 — Feedback loop position (like/dislike): design + istruire agenti**. Decidere modello dati (`position_feedback` event log separato vs mutazione `positions.status`); progettare istruzioni per scout (skip simili a dislike) e scorer (boost simili a like). Verificare interazione con [#13 web write su prod] perché è una scrittura web verso un'entità che il Mac possiede. *Origin: visione 2026-05-23.*
8. **P1 — Daemon push alert quando ≥3 fail consecutivi**: log `legacy_id` sospetto + notifica Telegram + auto-shutdown se >5 fail. Evita loop silenzioso saturante.
9. **P1 — Killswitch su 401/403 ripetuti**. Oggi `cli/src/commands/cloud.js:672-675` logga il 401 da token revocato ma il daemon **continua loop infinito ogni ~30s**. Comportamento atteso: 3 risposte 401/403 consecutive → halt del daemon + notifica `pending_user_messages` ("Token revocato, riapri il pairing"). Distinto dal P1 #8 (errori 5xx/payload): qui è auth, non transient.
10. **P1 — Disaster recovery: `jht cloud restore` esplicito**. Oggi il bootstrap (`cli/src/commands/cloud.js:141`, `:710`) si attiva **solo** dentro `enable`/`login`. Se il SQLite locale muore (disco pieno, container corrotto, reset onboarding parziale) non c'è un comando "ricostruisci da cloud". Serve comando dedicato + conferma esplicita ("Sovrascriverai N righe locali con M righe cloud, procedo?") per evitare overwrite accidentale.
11. **P1 — `JHT-LOCAL-NO-API`**: `web/lib/queries.ts` switcha su `local-queries.ts` quando `cloud.json.enabled=false`. Verificare `MainChrome.tsx` + `dashboard/page.tsx`.
12. **P2 — Scout RobertHalf parser fix**: con P0bis in place, il bug emerge alla prima esecuzione (field swap title↔location).
13. **P2 — Account Supabase mismatch warning UI**. Memoria `project_supabase_dual_accounts`: due account Google distinti = due pool isolati. Single-team enforcement opera per-account, non avvisa se l'utente è loggato col Google sbagliato rispetto al pairing-token del team. Aggiungere check: al boot del team, confronta `auth.user.email` del token con l'email salvata in `cloud.json` → se diverso, blocco push + notifica.
14. **P2 — Schema drift alert su fallback full-read**. `cli/src/commands/cloud.js:380-400` cade silenziosamente da delta-only a full-read quando manca `updated_at`. Resiliente ma maschera la drift: quando una migration cloud aggiunge/rinomina colonne senza migration locale, i costi Supabase risalgono senza avviso. Loggare warning + counter Telegram quando il fallback si attiva > 2 volte/h.
15. **P2 — Canary endpoint** per distinguere "Supabase saturo" da "Vercel slow".
16. **DESIGN CONSTRAINT — Web write su prod (concretizza con visione web-first)**. Non è più "ipotetico futuro": chat (#1), feedback (#7) e altri scriveranno direttamente su Supabase dal browser bypassando il single-team enforcement (il browser non è un team device → al prossimo push del Mac, la scrittura web viene sovrascritta). Soluzioni da scegliere prima di abilitare le voci web-write:
   - **A** Pull pre-push lato Mac (riconcilia desired da cloud prima di pushare)
   - **B** Promote del browser a "device virtuale" con suo `active_device_id` rotativo
   - **C** Tabelle dedicate al web (event log come `user_to_agent_messages`, `position_feedback`) che il Mac legge ma non sovrascrive — *preferito per pulizia*
17. **PHASE 3 — VPS live theater channel** (`[JHT-CLOUD-06]`): WebSocket over SSH tunnel o `team-commands-bus` (vedi `team-commands-bus.md`). Non passa per Supabase. **Strategico** post visione web-first: abilita chat sub-secondo senza prezzo polling.

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
