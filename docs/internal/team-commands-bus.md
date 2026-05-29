# Team Commands Bus — web → VPS command channel

> ⚠️ **SUPERSEDED (2026-05-23)** — Il modello command-based descritto qui è
> stato sostituito dal refactor **`team_state` desired-state + event lanes**
> (migration 019–022). Il bus `team_commands` resta vivo in parallelo durante
> il cutover graduale (Step 5–6 in [`cloud-sync-architecture.md`](cloud-sync-architecture.md)).
> Nuovo design: 1 riga `team_state` per utente con desired (web → container)
> + observed (container → web), event log dedicati per chat (`user_to_agent_messages`)
> e feedback (`position_feedback`). Container: `cloud team-state-listen` reconciler.
> Browser: `useTeamState` hook con Supabase Realtime (~200ms latency).
>
> 📌 Questo doc resta come riferimento storico del modello legacy finché
> `team_commands` non viene rimosso (Step 6).

---

**Lockato 2026-05-14**. Bus per il bottone **Start** su `jobhunterteam.ai/team`
quando il team gira su una VPS remota (no localhost). L'utente clicca, il
container sulla VPS riceve il comando entro ~5s ed esegue `jht team <action>`.

> 🛣️ Path 2 (`onboarding-flow.md` §VPS). Non si applica al setup Local
> (container locale: `/api/team/start-all` resta il path attivo come fallback).

---

## 🎯 Perché esiste

Nel modello VPS il **launcher desktop** non avvia il team — il container
sulla VPS è già up h24 e auto-paired (vedi `vps.md`). Il bottone Start sulla
dashboard cloud deve quindi **raggiungere la VPS** senza richiedere:

- la macchina dell'utente accesa (no SSH-from-desktop),
- un tunnel/IP pubblico esposto della VPS (no webhook in entrata),
- un'auth interattiva web → VPS (no Supabase Realtime WS user JWT, che
  richiederebbe un `refresh_token` lato VPS che non sempre c'è).

Soluzione: **comando come riga DB** (Postgres su Supabase) + **polling HTTP
dalla VPS** verso il web con il `jht_sync_…` token già in `cloud.json`.

---

## 🧩 Architettura — flow end-to-end

```
┌──────────────────────────────────────────────────────────────────────┐
│  Web (jobhunterteam.ai/team) — Next.js                               │
│                                                                       │
│   <Start> click  →  POST /api/team/command  { action: "start" }       │
│                          │ requireAuth() (Supabase user cookie)       │
│                          ▼                                            │
│                     INSERT team_commands(user_id, action, ...)        │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼  (riga in DB con status='pending')
┌──────────────────────────────────────────────────────────────────────┐
│  Supabase Postgres — public.team_commands                             │
│                                                                       │
│   id | user_id | action | status   | requested_at | processed_at      │
│   ---+---------+--------+----------+--------------+-------------      │
│   …  | 51b…    | start  | pending  | 15:58:24     | NULL              │
│                                                                       │
│   RLS: own rows; admin client bypassa.                                │
└──────────────────────────────────────────────────────────────────────┘
                              ▲ polling 5s
                              │  GET  /api/cloud-sync/team-commands
                              │  PATCH /api/cloud-sync/team-commands/:id
                              │  Authorization: Bearer jht_sync_…
                              │
┌──────────────────────────────────────────────────────────────────────┐
│  VPS — container `jht`  (PID1 dispatcher)                             │
│                                                                       │
│   pid1.js  →  spawnLabeled('realtime', node jht.js cloud realtime-    │
│                              listen)   ← parte se cloud.json esiste   │
│                                                                       │
│   cloud realtime-listen  →  runRealtimeSubscriber() in cli/src/lib/   │
│      realtime-subscriber.js                                           │
│        loop:                                                          │
│          GET /api/cloud-sync/team-commands?status=pending             │
│          for each cmd:                                                │
│            PATCH /:id { status: 'running' }   ← claim atomico         │
│            spawn `node /app/cli/bin/jht.js team <action>`             │
│            PATCH /:id { status: 'done'|'error', error?, processed_at }│
│          sleep 5s   (backoff esponenziale 60s su errori HTTP)         │
└──────────────────────────────────────────────────────────────────────┘
```

Latenza misurata smoke-test 2026-05-14:

```
14T15:58:24  Web INSERT  → status=pending
14T15:58:28  Subscriber  → poll.found-pending (latency 4s)
14T15:58:29  Subscriber  → exec.start jht team start
14T15:59:14  Subscriber  → exec.exit code=0  (45s exec)
14T15:59:15  DB row     → status=done, processed_at, error=null
```

---

## 📁 File touchpoint

| Layer | File | Cosa fa |
|---|---|---|
| Schema | `supabase/migrations/012_team_commands.sql` | Tabella + RLS + check vincoli + indice pending. La publication `supabase_realtime` è ADD'ata anche se attualmente non la usiamo (resta abilitata per un eventuale switch a WS futuro senza migration aggiuntiva). |
| Web — insert | `web/app/api/team/command/route.ts` | `POST` con `requireAuth`; body `{ action: start\|stop\|restart, payload? }`; ritorna `{ ok, command: { id, status, requested_at } }`. |
| Web — pull (VPS) | `web/app/api/cloud-sync/team-commands/route.ts` | `GET ?status=pending&limit=20` con `verifyBearerToken(jht_sync_)`. Admin client bypassa RLS e filtra per `user_id` del token. |
| Web — patch (VPS) | `web/app/api/cloud-sync/team-commands/[id]/route.ts` | `PATCH` per claim atomico (`status='pending'` precondition) e mark done/error. |
| Web — UI | `web/app/(protected)/team/page.tsx` | `dispatchTeamCommand('start')` → fetch /api/team/command, fallback a `/api/team/start-all` per local-mode. |
| CLI subscriber | `cli/src/lib/realtime-subscriber.js` | Long-running polling loop. Heartbeat 5min, SIGTERM clean shutdown, backoff esponenziale. |
| CLI subcommand | `cli/src/commands/cloud.js` | Registra `jht cloud realtime-listen` + (legacy) salva `supabase_url/refresh_token` in `cloud.json` durante `pair` per uso futuro. |
| PID1 | `cli/src/commands/pid1.js` | Co-spawn subscriber accanto a `cloud daemon` quando `JHT_HOST_TYPE=vps` + `cloud.json` esistente. Auto-restart in 5s su crash. Watch su `cloud.json` per hot-start dopo pairing. |

---

## 🔐 Auth model

| Operazione | Auth |
|---|---|
| Web `POST /api/team/command` | Supabase user JWT (cookie set dal flusso `signIn`). RLS user-owns-row su INSERT. |
| VPS `GET /api/cloud-sync/team-commands` | `Bearer jht_sync_…` (cloud_sync_tokens sha256 lookup) → admin client bypassa RLS. |
| VPS `PATCH /api/cloud-sync/team-commands/:id` | Stesso. Match `user_id` server-side. |

**Niente service-role su VPS.** Tutto va attraverso un cloud_sync_token
revocabile (gestione su `/settings/cloud-sync`). Stesso pattern del daemon push.

---

## ⚙️ Lifecycle subscriber

```
boot pid1
  └─ readHostType() → "vps"
  └─ if cloud.json exists:
        startDaemon()        (cloud push 30s)
        startRealtime()       ← subscriber polling 5s

cloud.json watcher (fs.watch dirname):
  cloud.json appare → startDaemon() + startRealtime()
  cloud.json sparisce → stopDaemon (kill SIGTERM)

subscriber crash → respawn dopo 5s (auto-restart)
SIGTERM da `docker stop` → forward a tutti i figli, exit 0
```

---

## 🛠️ Fault modes + recovery

| Sintomo | Causa probabile | Fix |
|---|---|---|
| Click Start → "Starting..." infinito | Utente non loggato (Guest mode) → 401 da `/api/team/command` | Re-login. |
| Subscriber log `startup.missing-credentials` | `cloud.json` esiste ma manca `token` o `base_url` | `jht cloud pair --force` (sul VPS, in container). |
| Subscriber log `poll.failed HTTP 401` | Token revocato lato web (`/settings/cloud-sync`) | Re-pair (rigenera token). |
| Comando rimane `pending` per >30s | Subscriber non gira: `JHT_HOST_TYPE` non `vps` oppure `cloud.json` mancante | Controlla `host.env` (perms 644, contenuto `JHT_HOST_TYPE=vps`) + `ls /jht_home/cloud.json`. |
| Status `error` con `exit code 1` | `jht team start` ha fallito (es. `jobs.db` non esiste) | Bootstrap profilo: assicurati che `jht cloud pair` sia avvenuto e che il DB sia inizializzato. |
| Doppio exec dello stesso comando | Due subscriber attivi (race su pairing) | Atomic claim previene: la PATCH `status='running'` ha `WHERE status='pending'` come precondition, secondo subscriber riceve 404. |

---

## 🧪 Smoke test manuale

```sql
-- 1. Inserisci comando come admin (simula click Start)
INSERT INTO team_commands (user_id, action)
VALUES ('<user-uuid>', 'start')
RETURNING id;
```

```bash
# 2. Sul VPS, verifica che il subscriber lo prenda entro 5s
ssh root@<vps-ip> 'docker logs --tail 20 jht 2>&1 | grep team-subscriber'

# Expected output:
# [team-subscriber] poll.found-pending {"count":1}
# [team-subscriber] command.received {"id":"...","action":"start"}
# [team-subscriber] exec.start ...
# [team-subscriber] exec.exit {"code":0}
# [team-subscriber] command.processed {"ok":true}
```

```sql
-- 3. Verifica row aggiornata
SELECT status, processed_at, error FROM team_commands WHERE id = '<id>';
-- status: 'done' | 'error'
```

---

## 🔄 Cosa NON è ancora coperto (TODO)

- **Local mode**: in `local` location il subscriber non gira (pid1 spawn solo
  in VPS mode). Per coerenza UX bisognerebbe runare un subscriber identico
  in modalità "local", che fa `docker exec jht jht team start` dal Mac/PC.
  Per ora local usa il path legacy `/api/team/start-all` (tmux locale).

- **UI feedback real-time**: dopo l'INSERT il bottone resta in `Starting...`
  finché il polling lato web (3s) rifresca `/api/team/status`. Si potrebbe
  subscribe a Realtime su `team_commands` lato browser per spegnere lo
  spinner appena `status='done'`.

- **Cleanup vecchi comandi**: comandi processati >7gg non servono. Cron
  notturno da aggiungere (per la beta volume basso, manuale via SQL ok).

- **Switch a Supabase Realtime WS**: la publication `supabase_realtime` è
  già abilitata. Quando arriva un meccanismo robusto per autenticare il
  subscriber Supabase (probabilmente `auth.admin.signInWithUserId` quando
  disponibile, o storage del `refresh_token` post-pair), si potrà
  switchare a WS con 1s di latenza invece dei 5s del polling.
