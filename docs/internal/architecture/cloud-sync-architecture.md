# ☁️ Cloud sync — architecture & status

> **Living doc.** Source of truth per la strategia cloud sync JHT. Unifica:
> incident RobertHalf 2026-05-19, decisione macro-events 2026-05-20,
> refactor team_state 2026-05-23 (bidirezionalità a desired-state) + writer-on-demand
> 2026-05-29, stato implementazione a oggi. Aggiornare a ogni shift architetturale.
>
> 🌱 **Shift 2026-07-28 — il push del PRIMO PERIODO di vita di un account**
> (`[CLOUDSYNC-PUSH-ONLY-WHEN-WATCHED]`). Il push on-demand
> (`[PUSH ON-DEMAND 2026-06-25]`) resta **la regola** e non cambia di una riga:
> nessun push su timer, `sync_requested_at` → rendezvous → push → ack è l'unico
> percorso che l'utente vede, e a regime il ragionamento sulla quota vale ancora.
> Ma un box appena creato ha il DB **vuoto per definizione**: il push che fa
> `jht cloud login` porta zero righe, e finché nessuno apre la dashboard il cloud
> resta vuoto anche mentre il team lavora. Misurato 2026-07-27: **25 posizioni e
> un profilo completo sul box, 0 righe su Supabase ~50 minuti dopo il pairing**.
> Ne soffrono notifiche, digest, un secondo dispositivo e chiunque ispezioni
> l'account direttamente — incluso un beta tester nuovo.
> **Rimedio**: `cli/src/lib/bootstrap-push.js` + `maybeBootstrapPush()` nel
> daemon. Push a bassa frequenza (1 ogni 15 min, il primo immediato) finché
> `~/.jht/state/first-run.json` non dichiara `phase: steady`, e **solo se il DB
> locale è cambiato** dall'ultimo push riuscito (firma per-tabella `{n, max}`,
> confronti di sola uguaglianza — mai un ordinamento fra formati di data, che è
> il passo falso del freeze 2026-07-15). Tre garanzie di terminazione
> **indipendenti**: fase `steady` · budget di 24 push persistito (un daemon che
> riparte non lo ricarica) · finestra di 6h dal primo push; più uscita immediata
> su 401/403 e interruttore `JHT_CLOUD_BOOTSTRAP_PUSH=0`. Chiuso, lo stato resta
> su disco: per quell'installazione non si spinge più senza browser, **mai**.
> Costo massimo per-account, una tantum: **24 tentativi ≈ 48 POST** su
> `/api/cloud-sync/push` e ≤24 `UPDATE team_state.sync_completed_at` (li timbra
> la route, non il client) — poi **0/h per sempre**. Il push è `handlePush`
> invariato: stesso chunking anti-413, stesso `safeCursor`, nessun nuovo
> percorso di assemblaggio del payload. Ispezionabile con
> `jht cloud bootstrap-status` (sola lettura).
>
> ⚡ **Shift 2026-07-21 — Realtime-first per il browser + backflow messaggi** (dev5,
> commit `0f5b66ae…19982d37`). Tre decisioni:
> **(1) Il canale live browser↔dati è Supabase Realtime (websocket diretto), MAI
> polling su Vercel.** Ogni fetch/poll dal browser passa dalle function Vercel e
> si paga per invocazione + Observability (~2,8 eventi/chiamata: è la voce che ha
> fatturato $14/mese di soli 11,7M eventi a giugno con 1-2 utenti). Il websocket
> Realtime va diretto browser↔Supabase: **0 invocazioni Vercel**, incluso nel Pro
> plan (500 connessioni concorrenti + 5M messaggi/mese), costa solo quando succede
> qualcosa e nulla a tab chiuso. **Webhook valutati e scartati per questo uso**: un
> webhook (pg_net/trigger → endpoint) serve per fan-out server-side (email, push
> notification) — non può raggiungere un browser aperto, che avrebbe comunque
> bisogno di un canale in ascolto; e ogni webhook→Vercel è un'invocazione pagata.
> Restano l'opzione giusta per notifiche out-of-band future, non per la UI live.
> **(2) Segnale "dati freschi" gratuito**: la route di push timbra
> `team_state.sync_completed_at` a ogni push che porta dati dashboard → i browser
> sottoscritti auto-aggiornano (throttle 90s, solo tab visibile, flash "Dati
> aggiornati") senza pulsante né reload. Il pulsante "Sync now" resta per il
> refresh esplicito; fix dei suoi 3 bug (setAuth mancante → RLS silenziava gli
> eventi; confronto con l'orologio del BROWSER; timeout 60s < poll deep-idle 120s
> della VPS). `sync_requested_at` ora timbrato server-side.
> **(3) Messaggi bidirezionali riparati**: il full-push VPS sovrascriveva
> reply/ack web con i NULL locali (mig 057 = merge RPC per-campo + skip no-op) e
> non esisteva il ritorno cloud→VPS (ora: lane `pending_replies` in
> `pull-desired-state` + apply in SQLite locale via supabase-direct, zero Vercel).
> Chat drawer + /messages ricevono INSERT/UPDATE live via `usePendingMessagesLive`.
> **Deploy**: web = release production (gated utente); CLI = redeploy container
> VPS (gated utente). La mig 057 è GIÀ applicata a prod (additiva, RPC).
>
> 🔄 **Shift 2026-06-20** — direzione target rivista in [`2026-06-20-data-sync-and-dashboard-split-design.md`](2026-06-20-data-sync-and-dashboard-split-design.md): **sync dati on-access + pulsante "Sync now", niente polling continuo** (unico poller = la VPS, adattivo); **`position_transitions` da aggiungere al push** (mig 044 esiste, mai cablata → event-log fossile); **corsia richieste async** (ticket+azioni-posizione) mantenuta sul cloud e **pullata** dalla VPS; **bus real-time di controllo** (`team_state`/reconciler, chat poller, `team_commands`) candidato a ritiro. Le sezioni "desired-state bidirezionale" qui sotto descrivono lo stato *attuale*, in parte superato da quel design.
>
> 🔀 **Shift 2026-06-15 (interaction planes)** — l'interazione (start/stop, chat, upload, config) è **desktop-first** (locale via browser→`localhost`, VPS via tunnel SSH); il **web è sola lettura** (data plane). La "vision web-first" citata più sotto (es. *"il browser deve mostrare team vivo come localhost"*) è **superata**: il path cloud interattivo (`team_state`/reconciler, chat poller, `team_commands`) è in ritiro. Vedi [`2026-06-15-interaction-planes-redesign-design.md`](2026-06-15-interaction-planes-redesign-design.md).

## 🧭 TL;DR oggi (2026-05-31)

- **Modello scelto**: cloud Supabase = mirror **macro-event** del SQLite locale, non telemetria live. Container è source-of-truth dei *risultati* (positions/scores/applications).
- **Bidirezionalità a "desired-state" (Kubernetes-style)**: per le **intenzioni utente** che entrano dal web (start/stop team, scrivi CV, like/dislike, chat) il flusso è **cloud → container**. La vecchia formula "push-only" del 2026-05-13 è **superata** dal refactor 2026-05-23 (mig 019-023) e dal writer-on-demand 2026-05-29 (mig 024).
- **Recovery offline (2026-05-31)**: il loop writer-on-demand funziona anche quando l'utente clicca via web col container fermo. Endpoint `/api/cloud-sync/pull-desired-state` + `jht cloud pull-desired-state` wired al boot del team scaricano i flag desired-state da Supabase a SQLite locale; la route `/api/positions/[id]/write-request` ha path cloud-only quando SQLite non c'è.
- **Granularità**: dal 2026-05-20 decimazione su `sentinel_ticks` (rimosso dal push); `team_commands` mantenuto in parallelo durante cutover verso `team_state`.
- **Subscriber container**: oggi sono **2 long-poller HTTP** (no WebSocket Realtime), perché `cloud.json` ha solo `jht_sync_` token, non il refresh-token Supabase necessario per autenticare il WS user. Browser invece usa Realtime full.
- **Local PC mode**: web bypassa Supabase, legge `jobs.db` direttamente via `web/lib/local-queries.ts`.
- **VPS live theater** (org-chart animato, popover Sentinella): canale dedicato app↔VPS — NON Supabase. PHASE 3 — `[JHT-CLOUD-06]`.

## 📐 Architecture

```
┌─────────────────────────┐                                  ┌──────────────────────┐
│   Container (SQLite)    │  ⬆ push delta-only (macro-evt) │   Supabase mirror    │
│   source-of-truth       │ ─────────────────────────────► │   read by web        │
│   per RISULTATI         │                                  │                      │
└─────────────────────────┘                                  └──────────────────────┘
        ▲                                                            ▲
        │  ⬇ 2 long-pollers HTTP (no WS)                            │  POST/PATCH
        │     (a) team-state-reconciler.js   → /api/team-state      │  da browser
        │     (b) realtime-subscriber.js     → /api/cloud-sync/    │
        │                                       team-commands       │
        │                                                            │
        │      desired-state lanes                                   │
        │      ┌──────────────────────────────────────────────┐     │
        └──────┤ team_state   user_to_agent_messages          ├─────┘
               │ team_commands position_feedback              │
               │ positions.write_requested                    │
               │ pending_user_messages (agent→user fallback)  │
               └──────────────────────────────────────────────┘
        ▼                                                            ▼
   web/lib/local-queries.ts                                 web/lib/queries.ts
   (Local PC mode bypass)                                    (cloud dashboard)
```

### Cosa va in cloud (⬆ container→cloud)

| Tabella | Cadenza | Note |
|---|---|---|
| `positions` (+ `write_requested`, `write_requested_at`) | Delta-only ogni ~30s via `updated_at` cursor | mig 024 aggiunge flag writer-on-demand al push |
| `scores`, `applications`, `position_highlights` | Event-coalesced con positions | push insieme alla transizione |
| `companies` | Event-driven | nuova company o metadata user-visible cambiato |
| `candidate_profiles` (+ tabelle profilo normalizzate, `candidate_blocks`, `candidate_contacts`) | Event-driven | **modello a 3 livelli** dal 2026-06-06 — push completo (no scarto) + `pull-profile` cloud→locale. Vedi `candidate-profile-cloud-sync-redesign.md` |
| `user_onboarding_state`, `encrypted_user_blobs` | Event-driven | invariati |
| `pending_user_messages` (mig 010) | Full-push (volume piccolo) | canale fallback notifiche agent→user |
| `sentinel_ticks` (mig 013) | ⛔ **rimosso dal push** (`f68a127d`) | ~720 row/h/utente, solo container ne ha bisogno |
| `team_commands` (mig 012) | ⛔ scrittura container disattivata | resta vivo per il subscriber legacy, vedi sotto |

Due path implementativi equivalenti propagano i delta:
- **CLI daemon** `cli/src/commands/cloud.js` → POST `/api/cloud-sync/push`
- **Web-triggered** `/api/local/sync` (legge SQLite, upsert Supabase) — usato quando il push parte da azione UI

### Cosa arriva dal cloud (⬇ web→container)

| Lane | Tabella cloud | Reader container | Trigger UI |
|---|---|---|---|
| **Start/stop/restart team** | `team_state` (mig 019) | `cli/src/lib/team-state-reconciler.js:251` long-poll 5s su `/api/team-state` | bottoni Start/Stop dashboard |
| **Comandi legacy bus** | `team_commands` (mig 012) | `cli/src/lib/realtime-subscriber.js:264` long-poll 5s su `/api/cloud-sync/team-commands?status=pending` | residuo cutover — handleAction single-agent ancora qui |
| **Writer-on-demand** | `positions.write_requested` (mig 024) | Capitano via `shared/skills/db_query.py:344` query `next-for-scrittore` → SQLite **locale** | bottone "Scrivi CV" dashboard + Telegram `/cv` |
| **Chat utente→agente** | `user_to_agent_messages` (mig 019) | `cli/src/lib/user-messages-poller.js` long-poll 5s su `/api/messages?status=pending`, claim atomico PATCH delivered, forward `jht-tmux-send` | POST `/api/messages` |
| **Like/dislike position** | `position_feedback` (mig 019) | `shared/skills/feedback_query.py check <legacy_id>` (Scorer step 5 multiplier; Scout signal opzionale) | POST `/api/positions/{id}/feedback` |
| **Agent→user fallback** | `pending_user_messages` (mig 010) | bidirezionale: scritto dal container, letto da browser via Realtime | notifiche utente |

**Nota architetturale sulla nomenclatura**: `realtime-subscriber.js` è **fuorviante** — il file dichiara esplicitamente (riga 10-18) di NON usare WebSocket Realtime. Fa long-poll HTTP perché `cloud.json` non conserva il refresh-token Supabase. Il nome è ereditato dall'intent originale, da rinominare in `team-commands-poller.js` quando si chiude il cutover #13.

**Ordine di grandezza atteso post-decimazione**: write rate –90% circa.

### Flusso writer-on-demand (end-to-end)

```
User click "Scrivi CV" su dashboard
   ↓
POST /api/positions/{legacyId}/write-request
   ↓  (web/app/api/positions/[legacyId]/write-request/route.ts)
   ├── UPDATE SQLite locale: positions.write_requested=1, write_requested_at=NOW()
   └── best-effort PATCH Supabase positions (non bloccante)
   ↓
Push daemon (CLI o /api/local/sync, ~30s) propaga delta a Supabase per UI cross-device
   ↓
Capitano (su CONTAINER): query SQLite locale "next-for-scrittore"
   ↓  (shared/skills/db_query.py:344, filtra write_requested=1)
   ↓  ORDER BY write_requested_at ASC (FIFO)
   ↓
Spawn SCRITTORE on-demand (lazy, RULE C-10 V6, no boot upfront)
```

**Telegram `/cv` shortcut**: bypassa cloud completamente.
```
User: /cv 42
   ↓  tg-bridge.py gira NEL container
   ↓
python3 shared/skills/write_request.py 42 --mode on
   ↓
UPDATE SQLite locale diretto → Capitano pickup → Scrittore
   ↓
(push daemon propaga in cloud DOPO, come feedback UX cross-device)
```

**Gap critico (chiuso 2026-05-31)**: prima, se l'utente cliccava "Scrivi CV" via web quando il container era fermo, il PATCH best-effort scriveva `write_requested=true` su Supabase, ma **non esisteva pull cloud→SQLite** al riavvio → flag ghost in cloud. Adesso chiuso da `GET /api/cloud-sync/pull-desired-state` + `jht cloud pull-desired-state` (wire al boot di `startActionContainer` + tick periodico nel `cloud daemon`). Vedi Stato implementazione → Done.

## 📜 Incident history — RobertHalf redux (2026-05-19)

**Root cause**: row corrotta su VPS2 (`positions.id=101`, `location` di 4394 char di HTML scout-malparsed) ha innescato `HTTP 400 constraint violation` su ogni batch push. Daemon batch-or-nothing → retry loop → connection pool Supabase saturo (Nano tier) → middleware Next.js timeout → 504 GATEWAY_TIMEOUT user-facing per ~1h.

**Fix immediato applicato**:
- Truncate row VPS2 a placeholder (`UPDATE positions SET location='London (corrupted...)' WHERE id=101`)
- VPS2 sync disabilitato (conservato per analisi), VPS1 riabilitato
- Supabase Nano → Micro (incluso nel Pro plan, no extra cost): RAM 0.5GB→1GB, CPU dedicato

**Findings post-upgrade (`supabase__get_advisors`)**: 40+ raccomandazioni perf mai applicate. Dettaglio in `docs/internal/_archive/2026-05-20-supabase-perf-backlog.md` (P0-P2 applicati, archiviato). Highlight:
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

## 🔁 Shift architetturale 2026-05-23 — da push-only a desired-state

Il 13/05 il modello era genuinamente push-only: una sola direzione, container → cloud, e il browser leggeva. Quando l'utente cliccava Start/Stop, il flusso non c'era nemmeno (richiesto SSH/CLI).

Il refactor `team_state` (mig 019-023, commit `627e7ab5…e6420371`) ha introdotto **canali ufficiali web→container** mantenendo l'astrazione "desired vs observed":
- Browser PATCH `team_state.should_run=true` → reconciler container vede divergenza → `jht team start` → aggiorna `team_state.is_running=true` → browser vede lo stato confermato (Realtime ~200ms)
- Stesso pattern per `restart_token`, `agents_enabled`

Il writer-on-demand (mig 024, 2026-05-29) ha esteso lo stesso pattern alle **decisioni per-posizione**: `positions.write_requested` è desired-state, il Capitano è il reconciler che lo osserva e agisce.

Entrambe le event lane sono ora osservate (commit `4774c190` + `093027c1`, 2026-05-31): `user_to_agent_messages` via poller container-side, `position_feedback` via skill on-demand interrogata dallo Scorer ad ogni scoring (e dallo Scout come signal opzionale). Loop user→agenti bidirezionale chiuso per le 4 lane principali (start/stop, write-request, chat, feedback).

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
| **Writer-on-demand cloud-side** (mig 024 + `/api/positions/{id}/write-request` + push daemon) | `ac90fc94…a7558a75` | 2026-05-29 |
| **Capitano lazy-spawn Scrittore on-demand** (RULE C-10 V6) | `a9596002` | 2026-05-29 |
| **Telegram `/cv` handler + `write_request.py` skill** | `5cef55fc` | 2026-05-29 |
| **Pull desired-state endpoint** `/api/cloud-sync/pull-desired-state` (Bearer auth, rate 30/min, lookback 7gg) | `af3302bd` | 2026-05-31 |
| **CLI `jht cloud pull-desired-state` + wire al boot di `startActionContainer`** (cursor `.cloud-pull-cursor.json`, best-effort 15s timeout) | `1a918531` | 2026-05-31 |
| **Route write-request supporta cloud-mode senza SQLite locale** (path A local-primary / path B cloud-only con embedded validate) | `0ada62ea` | 2026-05-31 |
| **Pull desired-state ad ogni tick del daemon** (multi-device live, isolato dal counter consecutiveFails del push) | `968ef913` | 2026-05-31 |
| **Killswitch dedicato 401/403** (threshold 3, halt + notifica `pending_user_messages` agent='cloud-sync') | `07d0109a` | 2026-05-31 |
| **Tombstone propagation end-to-end** (Supabase mig 025 + SQLite V7 + CLI push + web receive) | `6499b3db` | 2026-05-31 |
| **Profilo: modello a 3 livelli** (mig 033–035: tabelle normalizzate + `candidate_blocks` + `candidate_contacts`) + push completo no-scarto | `e52d31b2…76a150dc` | 2026-06-06 |
| **`pull-profile` (hydration profilo cloud→locale)**: endpoint + `jht cloud pull-profile` only-if-absent + boot hook (PC nuovo / container ricreato) | `cabee35f` | 2026-06-06 |

### ⬜ Pending (in ordine di priorità)

> Le voci ✅ DONE non sono ripetute qui — sono nella tabella **Done** sopra. Lista sotto = solo aperto.

#### P0 — correttezza

1. **P0 — Riparare CI/Tests/Lint pre-esistenti** (falliscono da 2026-05-22): test smoke-finale con soglie sbagliate (41 vs ≥100 pagine), test ENOENT su file inesistenti (`web/(protected)/app/components/sidebar.tsx`), ESLint 100+ warning `any`. Non bloccanti per refactor ma falsano il signal di qualità.

#### P1 — Loop feedback agenti (chiude la bidirezionalità incompleta)

2. ✅ **P1 — Reader container per `user_to_agent_messages`** *(DONE 2026-05-31, commit `4774c190`)*. `cli/src/lib/user-messages-poller.js` long-poll 5s su `/api/messages?status=pending&limit=50`, sort FIFO, claim atomico via PATCH `status=delivered`, forward tmux via `jht-tmux-send`. Mapping agent→session: ruolo base lowercase + uppercase (`scout-1` → `SCOUT`), whitelist 9 agenti utente-facing. tmux fail → PATCH `expired`. Rispetta `.team-halted.flag` + `.weekly-halt.flag`. Killswitch 401/403 dopo 3 fail consecutivi. Wire in `pid1.js`: spawn al boot + watcher cloud.json + respawn 5s + kill su shutdown. **Limiti noti**: (a) niente "Capitano in CC" routing — il forward è 1:1 al target; se serve CC va aggiunto un campo `payload.cc` nel POST + ciclo extra nel poller; (b) `replied_at` non viene mai settato (richiede che l'agente PATCH-i la propria risposta, fuori scope MVP).

3. ✅ **P1 — Reader agenti per `position_feedback`** *(DONE 2026-05-31, commit `093027c1`)*. Skill `shared/skills/feedback_query.py check <legacy_id>` + `agents/_skills/feedback-query/SKILL.md`. **Scorer**: Step 5 obbligatorio post-score-base con multiplier (like ×1.10, star ×1.15, dislike ×0.85, hide → excluded), cap 100. **Scout**: skill esposta come signal opzionale (skip per-posizione gia' coperto da SC-05 dedup). Fallback neutro su cloud-disabled. **Out of scope MVP** (tracciato come follow-up): aggregato `recent` company-level per Scout (richiede endpoint dedicato + push delta) e Capitano routing su feedback ricorrenti.

4. 🟢 **P1 — Subscriber on-demand** *(scope-reduced 2026-05-31)*. Kill/spawn duro di `team-state-reconciler` e `realtime-subscriber` agganciato a `is_running` NON è fattibile: sono i poller che ricevono il `should_run=true` dal browser. Per `user-messages-poller` il problema è coperto dal polling adattivo (#5). Follow-up: tier `deep-idle` (60s+) per `team-state-reconciler` quando team is_running=false stabilmente.

5. ✅ **P1 — Polling adattivo** *(DONE 2026-05-31, commit `acc293de`, scope-reduced)*. `user-messages-poller` 3 tier: `active` 5s, `idle` 30s, `deep-idle` 120s. Proxy onesto su "ultima consegna riuscita" invece di `team_state.last_user_activity_at` (che richiederebbe heartbeat browser-side). Riduce carico Vercel ~90% in caso idle h24. Follow-up: estendere lo stesso pattern a `team-state-reconciler` (tier 5s/15s/30s) e implementare il heartbeat browser-side come second-stage.

#### P1 — Hardening + UX

6. ✅ **P1 — Disaster recovery: `jht cloud restore` esplicito** *(DONE 2026-05-31, commit `10c57c8f`)*. Comando CLI + endpoint `/api/cloud-sync/full-dump` per ricostruire SQLite locale dallo snapshot cloud. Scope MVP: positions/scores/applications (companies + position_highlights ricostruiti dall'Analista). Conferma `@clack/prompts` interattiva; `--confirm-restore` per CI. Reset cursor push a "now" per evitare ri-push.

7. ✅ **P1 — `JHT-LOCAL-NO-API`** *(DONE 2026-05-31, commit `193d06fd`)*. Helper `isLocalOnlyMode()` in `web/lib/workspace.ts` legge `~/.jht/cloud.json` + `workspaceHasDb()`. Skip Supabase in `layout.tsx`/`dashboard/page.tsx`/`map/page.tsx`/`positions/page.tsx` quando localOnly=true. `queries.ts` gia' a posto via pattern `ws()`.

8. **P1 — Cutover `team_commands`→`team_state` finale + rename `realtime-subscriber.js`**. UI bulk Start/Stop ✅ done. Resta:
   - `handleAction` per singolo agente ancora su `useTeamCommandPoller` → migrare a `team_state.agents_enabled`
   - Verifica E2E + drop `team_commands` (Step 6) + rimozione `realtime-subscriber.js` (o suo restyle come reader generico di `user_to_agent_messages`)
   - Il nome `realtime-subscriber.js` è ingannevole (vedi nota architetturale sopra), rinominare in `team-commands-poller.js` finché vive

#### P1 — Follow-up tombstone (post commit `6499b3db`)

9. **P1 — Filtro `deleted_at IS NULL` sulle query dashboard**. ~30 SELECT su positions/scores/applications in `web/lib/queries.ts` (e ~10 in `web/lib/local-queries.ts`, ma localmente è hard-delete → low priority). Rischio basso oggi: finché il flusso tombstone non gira massicciamente in prod, nessuna riga ha `deleted_at != NULL`. PR dedicato con test di non-regressione.

10. **P1 — Cron Supabase hard-delete soft-deleted >30d**. Cleanup periodico righe `WHERE deleted_at < now() - interval '30 days'` su positions/scores/applications. pg_cron extension già disponibile.

#### P2

11. **P2 — Scout RobertHalf parser fix**: con SQLite CHECK constraints in place (commit `3602d42e`), il bug emerge alla prima esecuzione (field swap title↔location).

12. **P2 — Account Supabase mismatch warning UI**. Memoria `project_supabase_dual_accounts`: due account Google distinti = due pool isolati. Single-team enforcement opera per-account, non avvisa se l'utente è loggato col Google sbagliato rispetto al pairing-token del team. Aggiungere check: al boot del team, confronta `auth.user.email` del token con l'email salvata in `cloud.json` → se diverso, blocco push + notifica.

13. **P2 — Schema drift alert su fallback full-read**. `cli/src/commands/cloud.js:380-400` cade silenziosamente da delta-only a full-read quando manca `updated_at`. Resiliente ma maschera drift.

14. **P2 — Canary endpoint** per distinguere "Supabase saturo" da "Vercel slow".

**Edge case noto post-refactor 2026-05-25**: il `reconciler` legge solo `team_state.is_running` dal DB, non sa di tmux session locali. Scenario "DB stale vs container running" può accadere se:
   (a) utente clicca Stop, DB → `should_run=false` `is_running=false`
   (b) container muore prima di applicare lo stop (es. SIGKILL brutale)
   (c) container restart, pid1 vede `.team-halted.flag` assente (non era stato creato) → auto-start agenti
   (d) reconciler primo poll: vede `should_run=false && is_running=false` → noop, ma agenti girano
   Risultato: agenti operativi nonostante DB dice stopped. Workaround manuale: SQL `UPDATE team_state SET should_run=true` per nudge reconciler, poi click Stop. Fix proper richiede al reconciler verifica reale tmux al boot (tmux ls + parse). *Discovered nel test E2E 2026-05-25 con Leone*. **Stessa famiglia del pull-at-boot già done (commit `1a918531`): serve estendere la riconciliazione boot-time anche al gap "tmux reale vs DB observed", non solo "desired vs observed" cloud.**

### 🎨 Web dashboard feature gap (Task #18, #19)

Scoperti durante test E2E refactor 2026-05-25. Dashboard cloud `jobhunterteam.ai/team` mancano 2 feature che funzionano solo su localhost:

17. **P1 — Animazioni pallini inter-agente su cloud (Task #18)**. Su localhost TeamOrgChart anima pallini che passano da un agente all'altro (polling `/api/team/messages` + `/api/team/queue`). Su cloud le animazioni non partono: i dati di comunicazione tmux interna del container non arrivano fino a Supabase. Design:
   - Nuova tabella `agent_messages` push-friendly (`from_agent`, `to_agent`, `kind`, `at`) OPPURE riuso esteso di `user_to_agent_messages`
   - Bridge container aggrega sample ogni 30s (cadenza macro-events post-2026-05-20)
   - Browser: `useAgentMessages` hook Realtime → TeamOrgChart subscriber
   - **Why**: vision web-first; il browser deve mostrare team "vivo" come localhost

18. **P1 — Rate Budget chart su cloud (Task #19)**. Il blocco "RATE BUDGET" (UsageChart, UsageTokensChart, AgentTokensChart, ThrottleChart, TokenTypesChart) è vuoto su cloud: `sentinel_ticks` rimosso dal push (`f68a127d` decimazione macro-events 2026-05-20) + endpoint `/api/tokens/*` dipendono da script Python locali. Su Vercel ritornano empty graceful (fix `02e3bcbb`/`8b506a75`) ma niente grafici. Design:
   - Re-introdurre push sentinel a cadenza bassa (1 sample / 2 min, non 30s pre-decimazione)
   - Nuova tabella `sentinel_summary` con bucket aggregati (volume gestibile vs incident RobertHalf)
   - Migrate `/api/tokens/by-agent` `/throttle` `/by-type` da Python → SQL query Supabase
   - `/api/sentinella/data` cloud branch legge da Supabase invece del file JSONL locale

### 💰 Risparmio token + 🎯 Feedback loop ricco (Task #20, #21)

Discovered 2026-05-25. Pattern: dare all'utente più controllo + segnali per orientare team senza accendere agenti. Stesso DNA del CV writer toggle.

19. **P1 — Geocoding location opt-in/out per posizione (Task #20)**. Sim dev2 (sim-1/2/3) mostra che geocoding precise sull'ufficio popola bene `/map` ma costa molto agli analisti. Servono 3 modes:
   - **ALL**: ogni position riceve geocoding (default off, costoso)
   - **NONE**: zero geocoding (default safe)
   - **SELECTIVE**: utente fa spunta per-position
   - Backend: `positions.geocode_requested BOOLEAN`, analista legge prima di partire
   - Pattern: stesso del writer-on-demand (esistente) — replica esatta su altra dimensione costosa
   - Compatibile con feedback loop (#20): "scaduta/non interessante" → no geocode

20. **P1 — Feedback loop utente esteso (Task #21, estende #6)**. Vector vario per orientare scout/scorer:
   - **Sentimento qualitativo** (1 click): like, dislike, interesting, expired, out_of_budget, wrong_location
   - **Commento libero** (testo)
   - **Punteggio** 1-10 opzionale
   - **Direzionale**: more_like_this / less_like_this → scout cerca simili/evita
   - Schema: estende `position_feedback` (mig 019) con `comment`, `score`, `direction`
   - Capitano/Scout/Scorer leggono via Realtime + integrano nelle decisioni
   - **Why**: web-first vision → l'utente dà valore senza consumare token AI

21. **DESIGN CONSTRAINT — Web write su prod (concretizza con visione web-first)**. ✅ Già adottata strategia **C** (tabelle dedicate event log `user_to_agent_messages` + `position_feedback`) nel refactor + estesa a flag per-row (`write_requested`). Resta da pianificare se domani aggiungeremo write su entità esistenti (es. `positions.status` dal mobile).

22. **PHASE 3 — VPS live theater channel** (`[JHT-CLOUD-06]`): WebSocket over SSH tunnel. Non passa per Supabase. **Strategico** post visione web-first: abilita chat sub-secondo senza prezzo polling. Browser ha già Realtime (~200ms via Supabase WS); WS over SSH serve solo se vogliamo bypassare Supabase del tutto per VPS↔web.

## 🔗 Riferimenti

- [project_cloud_sync_direction] (memory) — push-only **superato** dal refactor 2026-05-23, vedi shift architetturale sopra
- [project_team_location_exclusive] (memory) — un solo writer alla volta
- [project_fallback_via_cloud_sync] (memory) — notifiche via `pending_user_messages`
- [project_writer_on_demand_arch] (memory) — JHT-WRITER-ON-DEMAND 2026-05-29
- `docs/internal/_archive/2026-05-20-supabase-perf-backlog.md` — 40+ findings advisor (applicati, archiviato)
- `docs/internal/postmortems/2026-05-22-vercel-quota-exhaustion.md` — incident parallelo (push troppo aggressivo + dashboard polling)
- `BACKLOG.md` — entry `[JHT-CLOUDSYNC-01]`, `[JHT-CLOUD-06]`, `[JHT-LOCAL-NO-API]`, `[JHT-WRITER-ON-DEMAND]`

## 📂 Storia / superseded by

Questo doc consolida e sostituisce:
- `2026-05-19-sync-incident-roberthalf-redux.md` (incident post-mortem completo)
- `2026-05-20-sync-macro-events-decision.md` (decision record granularità)

Per il dettaglio completo dell'incident (timeline minuto-per-minuto, diagnostic queries SQL, full advisor findings) consultare la git history di questi 2 file prima del commit di consolidamento.
