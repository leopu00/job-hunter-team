# 2026-05-20 — Decisione: sync macro-eventi + localhost no-API

> **Status: DECISIONE STRATEGICA PRESA.** Direzione confermata dall'utente
> 2026-05-20 dopo l'analisi dell'incident del 2026-05-19. Implementazione
> e sequencing (PoC-now vs attesa migration 017 RLS init plan) ancora da
> decidere a freddo.

## TL;DR

Cambiamo il modello di cloud sync da **"granular live-replay"** a
**"macro-event only"**. Il container resta source-of-truth via SQLite; il
cloud Supabase è un mirror di eventi che importano per l'utente, non un
canale di telemetria del team.

Per gli utenti che girano JHT in **Local PC mode**, il dashboard web non
passa per Supabase: legge `jobs.db` direttamente. Niente API → niente
superficie d'incident lato cloud per quel pubblico.

Questa decisione **affina** (non sostituisce) la direzione
[[project_cloud_sync_direction]] lockata 2026-05-13: push-only,
bootstrap automatico. Cambia COSA va in push, non la direzione del flusso.

## Contesto

Vedi:
- [[2026-05-19-sync-incident-roberthalf-redux]] — 504-storm causato da row
  corrotta + daemon push batch-or-nothing + RLS init plan O(N×K).
- [[2026-05-20-supabase-perf-backlog]] — 40+ findings advisor, primo audit
  serio post-pairing VPS.

Origine della discussione 2026-05-20: l'utente ha esplicitato che l'idea
originale di "sincronizzare ogni piccolo step per simulare il team in live
anche su web" era forse il modello sbagliato. Da qui la riformulazione.

## La decisione in 3 punti

### 1. 🪶 Cloud riceve solo macro-eventi

**Cosa NON va più in cloud:**

- ⛔ `sentinel_ticks` (migration 013) — ~720 row/h/utente di telemetria
  cadenzata, utile solo a livello container. Resta in SQLite per il
  Bridge/Sentinella; il dashboard cloud non ne ha bisogno.
- ⛔ `team_commands` (migration 012) — chat inter-agente. Non user-visible,
  non va replicato. **Eccezione**: il canale di fallback notifiche
  descritto in [[project_fallback_via_cloud_sync]] (scrivi DB → cloud sync
  → prompt injection) — quello specifico use-case va isolato e mantenuto,
  ma con uno schema dedicato (`pending_user_messages` esiste già,
  migration 010), non con il flush di tutta la tabella `team_commands`.

**Cosa resta in cloud ma con cadenza event-driven (no batch periodico):**

- ✅ `positions` — push **solo su transizione di status** rilevante:
  `discovered` → `scored` → `ready_to_apply` → `applied` → `rejected`.
  Non a ogni update di colonna secondaria.
- ✅ `scores`, `applications`, `position_highlights` — push quando legati
  a una transizione di `positions.status` (event coalescing).
- ✅ `companies` — push solo quando una nuova viene introdotta o cambia
  metadata user-visible.
- ✅ `candidate_profiles`, `user_onboarding_state`, `encrypted_user_blobs`
  — invariati, già event-driven per natura.

**Ordine di grandezza atteso**: write rate Supabase –90% circa rispetto a
oggi (stima basata sul ratio `sentinel_ticks + team_commands` vs eventi
macro).

### 2. 🏠 Local PC mode: web legge SQLite, niente API

Per gli utenti in modalità Local PC (vedi [[project_deployment_modes]]),
il dashboard web non chiama `/api/cloud-sync/*`. Legge direttamente
`jobs.db` via il path già implementato in `web/lib/local-queries.ts`.

**Vantaggi:**

- Zero round-trip su Supabase → zero contributo al carico cloud.
- Local-only users non pagano il costo di Pro Micro né dipendono
  dall'uptime di Vercel/Supabase per usare la loro dashboard.
- Coerente con la vision: "AI on the side of workers" → i dati restano
  veramente locali per chi sceglie quel deployment.

**Modalità di attivazione**: lo stesso flag `cloud.json: enabled`. Se
`false`, il container non spinge nulla e il web (se servito dallo stesso
host) bypassa Supabase per i query data. Auth/profile cloud restano se
l'utente ha fatto login (per portare con sé profilo+tema cross-device).

### 3. 🥇 VPS "live mode": canale separato (futuro)

Il pubblico VPS-only **vuole** il "team theater" live (org-chart animato,
popover Sentinella, messaggi inter-agente). Questo continua a esistere
ma **non passa per Supabase**: va su un canale dedicato app↔VPS, già
pianificato come [JHT-CLOUD-06] "Secure app ↔ cloud tunnel" e nelle
[project_vps_technical_decisions] (SSH tunnel via app, no Tailscale).

Possibile transport: WebSocket over SSH tunnel, o ricicliamo il
container `team-commands-bus` (vedi `docs/internal/team-commands-bus.md`).
Il dettaglio è PHASE 3 — qui basta riconoscere che Supabase **non** è
quel canale.

## Trade-off accettati

| Cosa perdiamo | Mitigazione |
|---|---|
| Dashboard cloud non mostra più tick sentinella in tempo reale | Diventa "ultimo evento macro + heartbeat". Per il live theater serve VPS+tunnel (PHASE 3). |
| Analytics storiche su tick/messaggi inter-agente fanno solo dal container | Acceptable: quelle analytics servono al team di sviluppo per debug, non all'utente finale. Si possono pullare on-demand. |
| `team_commands` non più replicate in cloud | Il fallback notifiche resta via `pending_user_messages`, schema dedicato già esistente (mig 010). |
| Local PC users senza dashboard cloud-side | Erano già il caso "non recommended for daily-use" ([project_deployment_modes]); il loro UX premia la privacy/offline-first. |

## Prerequisiti / dipendenze

1. **Migration 017 RLS init plan fix** ([[2026-05-20-supabase-perf-backlog]]
   P0) — va comunque applicata. La decimazione del write rate aiuta, ma
   il fix RLS è ortogonale: senza, anche il cloud "leggero" pagherebbe
   `O(N×K)` sotto carico. Non è un blocker per la decisione, ma va prima
   o insieme.
2. **Constraint SQLite locali** ([[2026-05-19-sync-incident-roberthalf-redux]]
   P0: replicare `CHECK (LENGTH(location) <= 200)` etc. in SQLite). A
   prescindere dalla decimazione, una row corrotta non deve poter entrare
   nel DB locale.
3. **Decisione fallback notifiche**: confermare che `pending_user_messages`
   è il canale unico (no flush `team_commands` in cloud). Verificare con
   [[project_fallback_via_cloud_sync]] e il flow Telegram→dashboard.

## Sequencing — aperto

Due opzioni discusse, **nessuna scelta ancora**:

**A. PoC subito** — rimuovere `sentinel_ticks` + `team_commands` dal push
in `shared/skills/db_to_supabase.py`, vedere cosa si rompe lato web
dashboard (probabili: team page org-chart animato, Sentinella popover).
Pro: misura immediata del risparmio + scoperta dei consumer hidden. Contro:
rompe UX cloud-dashboard prima che il VPS live channel sia pronto.

**B. Aspettare migration 017 + ri-misurare** — applicare il fix RLS init
plan, far girare 1 settimana con VPS attiva e misurare il nuovo write rate
+ costo per query. Se il fix RLS è sufficiente, la decimazione macro-event
diventa meno urgente (resta strategicamente giusta ma non hot-path).

Sospeso a [[project_session_2026_05_20]] (vedere conversazione successiva).

## Impatti su backlog / memory

**Backlog**:
- [JHT-CLOUDSYNC-01] — refactor `db_to_supabase.py` da batch periodic a
  event-driven su transizione status. **Espandere lo scope**: non solo
  "completion 60%", ma riprogettare il flusso.
- [JHT-CLOUD-06] (PHASE 3) — diventa più importante: senza tunnel
  diretto app↔VPS, il pubblico VPS-only perde il live theater.
- Nuovo: **[JHT-LOCAL-NO-API]** — esplicitare che in Local PC mode il web
  non chiama Supabase per data query. Path tecnico: `web/lib/queries.ts`
  switcha su `local-queries.ts` se `enabled=false`. Verificare che
  `MainChrome.tsx` e `dashboard/page.tsx` lo gestiscano.

**Memory**:
- `project_cloud_sync_direction.md` (locked 2026-05-13) → da aggiornare con
  la sezione "granularità: solo macro-eventi" e link a questo doc.
- Eventualmente nuova memory `project_sync_macro_events.md` se la sezione
  espande oltre 5-6 righe.

## Memory rilevante

- [[project_cloud_sync_direction]] — direzione push-only locked 2026-05-13
  (questa decisione la affina, non la sostituisce)
- [[project_team_location_exclusive]] — un solo writer alla volta, niente
  bidirezionale (rinforza la scelta event-driven)
- [[project_fallback_via_cloud_sync]] — canale notifiche utente via DB →
  da mantenere, isolato in `pending_user_messages`
- [[project_deployment_modes]] — VPS > Dedicated PC > Local; Local mode
  beneficia direttamente del no-API
- [[2026-05-19-sync-incident-roberthalf-redux]] — origin del ripensamento
- [[2026-05-20-supabase-perf-backlog]] — prerequisito tecnico (migration 017)
