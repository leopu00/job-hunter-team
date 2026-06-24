# 🏗️ Daemon VPS → Supabase diretto (ritiro del polling Vercel)

> Finding architetturale + piano di rifacimento del daemon di sync. Nasce
> dall'analisi costi Vercel del 2026-06-24 (vedi
> `2026-06-24-vercel-cost-analysis-and-sync-fix.md`): il costo variabile è
> dominato dagli **Observability Events** ($14 su ~$24), generati da un firehose
> di richieste che il daemon VPS spara verso Vercel.

## 1. 🔍 Il problema (dal codice)

Tre fatti verificati in `cli/`:

1. **Il daemon NON ha il client Supabase.** `cli/package.json` non dipende da
   `@supabase/*`. Ogni operazione passa per le route HTTP di Vercel
   (`fetch(${config.base_url}/api/...)`). Percorso: **VPS → Vercel → Supabase**, mai diretto.
2. **Il "realtime" è finto.** Il file era `realtime-subscriber.js`, rinominato
   `team-commands-poller.js`: **polla in HTTP**, non è un websocket. Nessun
   `@supabase/realtime-js`, nessun `.channel()`, nessun `postgres_changes` nel codice.
3. **Tutto è polling, 24/7, anche a vuoto.** Loop attivi sull'immagine corrente
   (`pid1.js` → `startDaemon/startRealtime/startFileBridge`):
   - Cloud daemon **ogni 60s**: `push` + `pull-desired-state` + reconcile su `/api/team-state`.
   - team-commands-poller ("realtime"): polla Vercel, adattivo (5/30/120s).
   - file-bridge-poller: polla Vercel, adattivo.

Ogni giro = **1 invocazione serverless Vercel = ~2,8 Observability Events fatturati**,
anche quando la risposta è "nessuna novità". Un solo utente fermo ≈ ~12k eventi/giorno
di puro battito a vuoto.

## 2. 💸 Perché è il modello sbagliato — Vercel vs Supabase Pro

| | **Vercel** | **Supabase Pro** |
|---|---|---|
| Fattura | **per invocazione** (+ ~2,8 observability events) | **forfait**: paghi il compute always-on ($25 base); **le query NON si pagano a chiamata** |
| 1 poll/60s | costa ogni volta | gratis (compute già pagato) |
| 50 utenti che pollano | costo **lineare** → esplode | **dentro il forfait** già pagato |
| Realtime/websocket | n/d | **incluso**: 500 conn. contemporanee + 5M messaggi/mese |

Org `nklkqpdtvokgbiuzngih` = piano **Pro**, progetto `smittwvohsnwwwisqdrh` (eu-central-1).
Limiti Pro rilevanti: 500 connessioni Realtime simultanee, 5M messaggi Realtime/mese,
250GB egress/mese, 100k MAU. A 50 utenti: 50 connessioni, egress in KB sulle letture →
**dentro il forfait, costo incrementale ≈ $0**.

👉 **Spostare il polling su Supabase non sposta il problema: cambia il modello da
"per-chiamata" a "forfait".** Anche un naïve poll a 60s su Supabase costa ~0.

## 3. 🔑 L'unlock (ce l'abbiamo già)

Al pairing, `cloud.js` salva in `cloud.json`:
`supabase_url` + `supabase_refresh_token` + `user_id`. Commento esplicito nel codice:
*"servono al subscriber WS per autenticarsi con Supabase direttamente (auth.setSession +
auto-refresh)"* — il subscriber non è mai stato scritto.

Con quel `refresh_token` (sessione derivata dal login Google dell'utente) il daemon si
autentica **come l'utente** e la **RLS** (`auth.uid() = user_id`) garantisce che tocchi
**solo i dati suoi**. Niente service-role, niente chiavi pericolose sulla VPS.

## 4. 🗺️ Piano a fasi

- **Fase 1 (SCELTA — ammazza il costo, basso rischio):** sposta le **letture ad alta
  frequenza** (ticket pull, `team_state`/sync-flag, desired-state) da Vercel → **Supabase
  diretto**. Anche come poll ~60s, su Supabase è ~gratis. Il **push resta su Vercel**.
- **Fase 2 (UX):** sostituisci le letture con un **websocket Supabase Realtime** (ticket +
  sync istantanei, zero polling). Richiede `@supabase/supabase-js` + le tabelle nella
  publication (team_state c'è già, mig 021; aggiungere `position_tickets`).
- **Fase 3 (opzionale):** sposta anche il **push** su Supabase diretto, event-driven (solo
  su modifica dei dati locali).

## 5. 🔧 Fase 1 — specifica

**Trasporto: REST puro, niente SDK.** Si usa `fetch` contro PostgREST + GoTrue (stile del
codice esistente, zero dipendenze nuove):
- **Auth (GoTrue):** `POST {supabase_url}/auth/v1/token?grant_type=refresh_token`
  con header `apikey: <anon>` e body `{refresh_token}` → `{access_token, refresh_token,
  expires_in}`. Cache dell'`access_token` in memoria; refresh quando manca <60s alla
  scadenza; **persisti il refresh_token ruotato** in `cloud.json`.
- **Read (PostgREST):** `GET {supabase_url}/rest/v1/<table>?...` con header
  `apikey: <anon>` + `Authorization: Bearer <access_token>`. La RLS filtra per utente; si
  può comunque mettere `user_id=eq.<uid>` esplicito.

**Letture spostate su Supabase diretto** (oggi via Vercel):
| Oggi (Vercel) | Diventa (Supabase diretto) |
|---|---|
| `GET /api/cloud-sync/tickets?since=` | `GET /rest/v1/position_tickets?status=eq.open&...` |
| `GET /api/team-state` (sync rendezvous) | `GET /rest/v1/team_state?select=sync_requested_at,sync_completed_at,...` |
| `pull-desired-state` (reconcile should_run, ecc.) | `GET /rest/v1/team_state?select=should_run,agents_enabled,restart_token,...` |

**Resta su Vercel (Fase 1):** il **push** (`/api/cloud-sync/push`, usa il service-role
lato route per i transform legacy_id→uuid / company upsert), il **ticket push** locale→cloud,
e l'**ack** `sync_completed_at` (1 write per evento sync reale — opzionale spostarlo).

**Reazioni invariate:** ticket nuovo → import in SQLite + prompt tmux (come `handleTicketSync`
PULL); `sync_requested_at` pending → `handlePush({})` (ancora Vercel) + ack.

**Anon key:** pubblica by-design. Letta da (in ordine): `process.env.JHT_SUPABASE_ANON_KEY`
→ `cloud.json.supabase_anon_key`. NON committata nel repo (come gli altri env). Fase 1.5:
il pairing desktop aggiunge `supabase_anon_key` a `cloud.json`; nel frattempo si passa via env
nel container.

**Cutover:** il nuovo lettore Supabase-diretto sostituisce le GET Vercel dei loop. I poller
Vercel ridondanti (team-commands "realtime", le GET del cloud daemon) si spengono. Dietro un
flag per rollout sicuro su una VPS prima del fleet.

## 6. ⚠️ Rischi / nodi aperti
- **Rotazione refresh_token**: GoTrue ruota il refresh_token a ogni uso → va persistito
  subito su `cloud.json`, altrimenti al riavvio il token è invalido. Se scade/revocato →
  re-pairing (flusso già esistente).
- **Realtime publication** (Fase 2): `position_tickets` va aggiunta alla publication.
- **Single-team claim**: la logica `active_device` su `team_state` va preservata nel passaggio.
- **Egress**: le letture sono KB; il peso resta il push (invariato, Fase 1 lo lascia su Vercel).
- **Test**: provare su UNA VPS (betaC) dietro flag prima del fleet; verificare RLS
  (il token legge/scrive solo le righe dell'utente).

## 7. 📊 Effetto-costo atteso
- Fase 1: le letture ad alta frequenza spariscono da Vercel → background Vercel verso ~0.
  Resta solo il push (1 call/evento) → Observability ben sotto la quota gratuita.
- Fase 2+3: background Vercel = 0; un utente ≈ costo variabile **~$0** (dentro il forfait
  Supabase Pro). Scala a centinaia di utenti senza crescita lineare del costo.
