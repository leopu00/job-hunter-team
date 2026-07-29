# 🔌 Daemon sync — da polling Vercel a Supabase diretto + event-driven

Documento consolidato del redesign del sync daemon↔cloud (tre note datate 24–26/06, qui integrate senza modifiche al contenuto). Arco: analisi del modello di costo (ogni lettura passava VPS→Vercel→Supabase, fatturata per-invocazione) → Fase 1 letture dirette su Supabase (in master, `getDirectReader`, flag `JHT_SUPABASE_DIRECT=1`) → piano event-driven via Supabase Realtime (7/7 tappe implementate dietro flag `JHT_REALTIME_SYNC=1`, default OFF, validato live su betaC).

**Stato:** Fase 1 e piano event-driven implementati; decisione 2026-06-27: **niente Fase 3** (il push on-demand resta su Vercel, non è un costo di scala). Ticket: `[JHT-DAEMON-SUPABASE-DIRECT]`, `[JHT-REALTIME-SCALE]`. Contesto costi: [`../postmortems/2026-06-24-vercel-cost-analysis-and-sync-fix.md`](../postmortems/2026-06-24-vercel-cost-analysis-and-sync-fix.md).

---

> **Parte 1 — letture dirette su Supabase (design Fase 1)** · origine: `2026-06-24-vps-daemon-supabase-direct-design.md` — contenuto integrale, non riscritto.

## 🏗️ Daemon VPS → Supabase diretto (ritiro del polling Vercel)

> Finding architetturale + piano di rifacimento del daemon di sync. Nasce
> dall'analisi costi Vercel del 2026-06-24 (vedi
> `2026-06-24-vercel-cost-analysis-and-sync-fix.md`): il costo variabile è
> dominato dagli **Observability Events** ($14 su ~$24), generati da un firehose
> di richieste che il daemon VPS spara verso Vercel.

### 1. 🔍 Il problema (dal codice)

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

### 2. 💸 Perché è il modello sbagliato — Vercel vs Supabase Pro

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

### 3. 🔑 L'unlock (ce l'abbiamo già)

Al pairing, `cloud.js` salva in `cloud.json`:
`supabase_url` + `supabase_refresh_token` + `user_id`. Commento esplicito nel codice:
*"servono al subscriber WS per autenticarsi con Supabase direttamente (auth.setSession +
auto-refresh)"* — il subscriber non è mai stato scritto.

Con quel `refresh_token` (sessione derivata dal login Google dell'utente) il daemon si
autentica **come l'utente** e la **RLS** (`auth.uid() = user_id`) garantisce che tocchi
**solo i dati suoi**. Niente service-role, niente chiavi pericolose sulla VPS.

### 4. 🗺️ Piano a fasi

- **Fase 1 (SCELTA — ammazza il costo, basso rischio):** sposta le **letture ad alta
  frequenza** (ticket pull, `team_state`/sync-flag, desired-state) da Vercel → **Supabase
  diretto**. Anche come poll ~60s, su Supabase è ~gratis. Il **push resta su Vercel**.
- **Fase 2 (UX):** sostituisci le letture con un **websocket Supabase Realtime** (ticket +
  sync istantanei, zero polling). Richiede `@supabase/supabase-js` + le tabelle nella
  publication (team_state c'è già, mig 021; aggiungere `position_tickets`).
- **Fase 3 (opzionale):** sposta anche il **push** su Supabase diretto, event-driven (solo
  su modifica dei dati locali).

### 5. 🔧 Fase 1 — specifica

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

### 6. ⚠️ Rischi / nodi aperti
- **Rotazione refresh_token**: GoTrue ruota il refresh_token a ogni uso → va persistito
  subito su `cloud.json`, altrimenti al riavvio il token è invalido. Se scade/revocato →
  re-pairing (flusso già esistente).
- **Realtime publication** (Fase 2): `position_tickets` va aggiunta alla publication.
- **Single-team claim**: la logica `active_device` su `team_state` va preservata nel passaggio.
- **Egress**: le letture sono KB; il peso resta il push (invariato, Fase 1 lo lascia su Vercel).
- **Test**: provare su UNA VPS (betaC) dietro flag prima del fleet; verificare RLS
  (il token legge/scrive solo le righe dell'utente).

### 7. 📊 Effetto-costo atteso
- Fase 1: le letture ad alta frequenza spariscono da Vercel → background Vercel verso ~0.
  Resta solo il push (1 call/evento) → Observability ben sotto la quota gratuita.
- Fase 2+3: background Vercel = 0; un utente ≈ costo variabile **~$0** (dentro il forfait
  Supabase Pro). Scala a centinaia di utenti senza crescita lineare del costo.

---

> **Parte 2 — event-driven via Supabase Realtime (piano 7 tappe)** · origine: `2026-06-25-daemon-event-driven-realtime-design.md` — contenuto integrale, non riscritto.

## 🔌 Daemon event-driven via Supabase Realtime — design

> Continuazione di [`2026-06-24-vps-daemon-supabase-direct-design.md`]
> ([JHT-DAEMON-SUPABASE-DIRECT]). Quel doc ha spostato le LETTURE del daemon da
> Vercel a Supabase diretto. Questo doc copre il passo successivo: **da polling a
> event-driven** (Realtime), per abbattere il carico DB e scalare a molti utenti.
> Cattura anche il ridisegno della sync fatto il 2026-06-25 (push on-demand, ecc.).

---

### 1. 📦 Cosa è GIÀ stato fatto (sync redesign 2026-06-25)

Modello nuovo: **il team lavora in locale, il cloud è una fotografia che si
aggiorna SOLO quando l'utente preme "Sync now".**

- **Push on-demand** (`cli/src/commands/cloud.js`): niente più `handlePush` ogni
  60s. Il push dati VPS→cloud parte SOLO da `handleSyncRendezvous` quando vede
  `team_state.sync_requested_at`. Rimosso il killswitch sul push periodico.
- **Cadenza a due velocità nel loop**: sync-check ogni **~5s** (`JHT_SYNC_CHECK_SEC`),
  letture pesanti (desired-state, ticket) + heartbeat ogni **60s**.
- **Web** (`web/app/components/CloudRefreshButton.tsx`): niente auto-sync
  all'apertura → solo il pulsante; mostra "Aggiornato: X fa" (`sync_completed_at`);
  il completamento arriva via **Supabase Realtime** (websocket), NIENTE polling.
- **DB**: `team_state` → `REPLICA IDENTITY FULL` (mig 047) per Realtime+RLS affidabile.
- **Ritiri** correlati: `should_run` reconcile (controllo team = solo desktop),
  poller team-commands + file-bridge.

Flusso "Sync now" attuale: click → PATCH `sync_requested_at` (1 call Vercel) → la
VPS al sync-check (~5s) lo vede → push → `sync_completed_at` → Realtime spinge al
browser → refresh. Vercel toccata solo sul click.

---

### 2. 💸 Il modello di costo VERO (correzione importante)

Errore da evitare: *"su Supabase le query sono gratis, quindi il numero non conta."*
**Falso.** Supabase Pro non fattura a query, MA dà un **server Postgres con CPU/RAM
FISSE**. Le query girano su quella CPU.

- **Poche query/utente** → tanta CPU libera → reggi **più utenti** sullo stesso compute.
- **Tante query** → saturi la CPU → devi pagare un **compute più grosso** (add-on).

⇒ La frequenza conta come **capacità/headroom di scaling**, non come bolletta
per-query. Ridurre il rate per-utente = scalare più lontano prima di upgradare.

---

### 3. 📊 Carico DB attuale del daemon (per utente/ora)

| Corsia | Frequenza | Query/ora/utente | Cambia spesso la tabella? |
|---|---|---|---|
| 🔴 **sync-check** (`team_state`) | ogni 5s | **720** (80%!) | no (solo sul click utente) |
| desired-state (`positions` OR-filter) | ogni 60s | 60 | sì (ogni push tocca tante righe) |
| ticket (`position_tickets`) | ogni 60s | 60 | raro (crea/risolvi) |
| heartbeat (`team_state` PATCH) | ogni 60s | 60 | — (è una scrittura) |
| **Totale** | | **~900/ora/utente** | |

A 50 utenti ≈ 45k/ora ≈ 12 query/sec (banale ORA); a 500-1000 utenti inizia a
contare. **L'elefante è il sync-check** (720), non i ticket (60).

---

### 4. 🎯 Il piano: event-driven IBRIDO

Regola: **Realtime conviene per le tabelle che cambiano DI RADO**; per quelle che
cambiano SPESSO è meglio un poll lento (il Realtime echeggia ogni scrittura e
`postgres_changes` non filtra per colonna).

| # | Corsia | Azione | Effetto |
|---|---|---|---|
| 1 | **sync-flag** (`team_state`) | → **Realtime** sul daemon | 720/h → ~0 (il grosso) |
| 2 | **ticket** (`position_tickets`) | → **Realtime** | 60/h → ~0 |
| 3 | **desired-state** (`positions`) | → **poll lento ~5 min** (NON realtime) | 60/h → 12/h |
| 4 | **heartbeat** | → **presence** del websocket (la connessione = "VPS online") | 60/h → 0 |

**Perché NO Realtime su `positions`:** in on-demand cambia comunque (ogni push
aggiorna molte righe) → il daemon riceverebbe l'**eco di ogni propria scrittura**,
da filtrare a mano, + `REPLICA IDENTITY FULL` su tabella da ~500 righe = WAL extra.
La richiesta "scrivimi il CV" non è urgente (il CV ci mette minuti) → un poll a 5
min è più pulito ed economico del Realtime per quella corsia.

**Risultato:** da ~900 a **~30-50 query/ora/utente** (~95% in meno) → molto più
headroom di scaling.

---

### 5. ✅ Prerequisiti (stato 2026-06-25)

| Tabella | In `supabase_realtime` | Replica identity | Da fare |
|---|---|---|---|
| `team_state` | ✓ sì | `f` (FULL) | nulla (pronto) |
| `position_tickets` | ✗ no | `d` (default) | ADD a publication + `REPLICA IDENTITY FULL` |
| `positions` | ✗ no | `d` | nulla (resta a poll lento, vedi §4) |

RLS già attiva su tutte (Realtime consegna solo la riga dell'utente). Migrazione
necessaria: aggiungere `position_tickets` alla publication + replica identity full.

---

### 6. ⚠️ "Sicuro funziona?" — sì, con un paracadute

Il meccanismo è standard (lo usa già il browser, verificato su `team_state`). MA un
daemon con websocket persistente ha più parti in movimento di un poll:
- **Riconnessione:** la cade del socket la gestisce l'SDK (`@supabase/supabase-js`).
- **Rete di sicurezza OBBLIGATORIA:** un **poll lento (~5 min)** che rilegge tutte le
  corsie, così se il websocket muore in silenzio o perde un evento, il daemon
  recupera comunque. Senza questo, un socket morto = sync ferma.
- **Trasporto:** Realtime su WSS/443 → ok da una VPS.

Con il paracadute: robusto. Senza: fragile.

---

### 7. 🛠️ Tappe di implementazione (in ordine di impatto)

1. **Dep + modulo Realtime** nel cli: `@supabase/supabase-js` (finora solo `fetch`
   per le REST; il Realtime richiede l'SDK). Auth col `refresh_token` già in
   cloud.json (`auth.setSession`). Modulo `cli/src/lib/cloud-realtime.js` con
   subscribe + riconnessione.
2. **sync-flag → Realtime**: il daemon si iscrive a `team_state`; su
   `sync_requested_at` pendente → push + ack. Toglie il sync-check a 5s.
3. **ticket → Realtime**: migrazione (publication + replica full) + subscribe a
   `position_tickets`.
4. **desired-state → poll ~5 min** (semplice cambio di cadenza, niente Realtime).
5. **heartbeat → presence**: deriva "VPS online" dalla connessione Realtime invece
   della scrittura ogni 60s. (Richiede di cambiare anche come la dashboard legge
   l'online status → valutare; in alternativa heartbeat poll lento ~3 min.)
6. **Paracadute**: poll lento ~5 min su tutte le corsie (recupero eventi persi).
7. **Test su betaC** dietro flag prima del fleet; verificare reattività + recupero
   a socket caduto. Deploy = utente.

---

### 8. 🧹 Debito di design noto (backlog, NON ora)

Le richieste-posizione (`write_requested`/`recheck_requested`/`user_excluded`/
`geocode`) sono **flag sparsi su `positions`**, non una tabella-inbox dedicata.
Per trovarle si filtra `positions` (OR sui `*_requested_at`). Inelegante, ma:
- ritorna solo il cambiato; lo scan è su ~500 righe/utente = microsecondi;
- i flag servono ANCHE al display per-posizione sulla dashboard;
- il Capitano (writer-on-demand, mig 024) OSSERVA `write_requested` per spawnare lo
  Scrittore → unificarli nella corsia ticket toccherebbe l'AGENTE AI + web + daemon
  + dashboard + migrazione dati. Refactor trasversale, guadagno di costo ~0.

**Verdetto:** igiene di design per il futuro, non un problema attuale. La corsia
dedicata esiste già concettualmente = `position_tickets`. Se un giorno si scala a
decine di migliaia di posizioni/utente, unificare tutte le richieste-posizione in
quella corsia. Per ora: backlog.

---

### Riferimenti
- `docs/internal/2026-06-24-vps-daemon-supabase-direct-design.md` (fase letture-dirette)
- `docs/internal/2026-06-24-vercel-cost-analysis-and-sync-fix.md` (analisi costi)
- `supabase/migrations/047_team_state_replica_identity_full.sql`
- `web/app/components/CloudRefreshButton.tsx` (Realtime lato browser, già fatto)

---

> **Parte 3 — stato di attuazione e validazione live** · origine: `2026-06-26-sync-status-report.md` — contenuto integrale, non riscritto.

## 📋 Report stato Sync — event-driven daemon (2026-06-26)

> Verifica in codice dello stato reale del sync redesign rispetto al piano di
> design [`2026-06-25-daemon-event-driven-realtime-design.md`]. Analisi su `dev3`.
> Riferimenti: `cli/src/commands/cloud.js`, `cli/src/commands/pid1.js`,
> `cli/src/lib/`, `web/app/components/CloudRefreshButton.tsx`, `supabase/migrations/`.

---

### TL;DR

**Lo "Step 0" (redesign sync del 25/06) è fatto, mergiato e coerente in codice. Il
piano event-driven a 7 tappe è ancora a 0/7 — è solo design.** Il daemon gira ancora
al **baseline ~900 query/h/utente**: il sync-check a 5s **è tuttora attivo** (è
l'elefante, ~80% del carico), e il paracadute poll-lento **non esiste** (né serve
ancora, perché non c'è alcun websocket da cui cadere).

> ⚠️ Nota anti-allarme: i poller "ritirati" **non sono una regressione**. Sono
> congelati dietro l'escape-hatch `JHT_CLOUD_CONTROL_POLLERS=1` (default off); pid1
> di default avvia **solo** il `daemon` (con `reconcileOnce` fuso dentro).

---

### ⏩ Aggiornamento 2026-06-26 — piano event-driven COMPLETO su dev3 (7/7, dietro flag)

Tutte e 7 le tappe sono implementate su `dev3`, dietro il flag
**`JHT_REALTIME_SYNC=1` (default OFF → comportamento odierno invariato)**.

| # | Tappa | Stato | Dove |
|---|---|---|---|
| 1 | dep `@supabase/supabase-js` + `cli/src/lib/cloud-realtime.js` | ✅ | `createRealtimeSync`: auth via `refresh_token` come supabase-direct, `subscribe`/`trackPresence`/`close`, riconnessione SDK |
| 2 | sync-flag → Realtime | ✅ | `runRealtimeLoop`: subscribe `team_state` UPDATE → push. Flag ON ⇒ niente sync-check 5s |
| 3 | ticket → Realtime + mig 048 | ✅ | subscribe `position_tickets` `*` → `handleTicketSync`; **mig 048** (publication + REPLICA IDENTITY FULL) |
| 4 | desired-state → poll ~5min | ✅ | `JHT_DESIRED_STATE_SEC` (default 300) nel loop lento |
| 5 | heartbeat → poll ~3min | ✅ | `JHT_HEARTBEAT_SEC` (default 180) — **sotto la soglia stale 5min** della dashboard (`team-state/claim/route.ts` `HEARTBEAT_STALE_MS`). Presence vera **DEFERRED** (richiede di cambiare come il web legge l'online) |
| 6 | paracadute poll-lento | ✅ | ogni ~5min (`JHT_PARACHUTE_SEC`) ri-legge sync + ticket → recupero se il socket muore. Gira anche se il setup Realtime fallisce (degrada a poll puro) |
| 7 | test su betaC dietro flag | ✅ | **VALIDATO 2026-06-26**: `JHT_REALTIME_SYNC=1` su betaC, canali `team_state`+`position_tickets` SUBSCRIBED, heartbeat 70s (online), "Sync now" end-to-end via websocket in **1,6s** (`sync_ok=true`). Vedi sotto |

#### 🧪 Esito test live su betaC (2026-06-26)
- Immagine `:latest` (build 26/06 14:34) verificata contenere il codice; **mig 048 applicata a prod** (`position_tickets` in publication + replica full).
- `JHT_REALTIME_SYNC=1` aggiunto al compose betaC (oltre a `JHT_SUPABASE_DIRECT=1` già presente).
- Canali `team-state` + `tickets` **SUBSCRIBED**, refresh_token valido (nessun errore auth).
- **Sync now end-to-end: 1,6s** (trigger `sync_requested_at` → evento websocket → push → ack `sync_completed_at`).
- 🐛 **BUG TROVATO E FIXATO live** (`90447acf4`): postgres_changes con RLS non consegnava nulla (canale SUBSCRIBED ma 0 eventi) perché il socket Realtime usava l'**anon key** invece dello **user-JWT** (l'auto-wiring del token in supabase-js è async e arrivava DOPO la subscribe). Fix: `client.realtime.setAuth(access_token)` forzato PRIMA delle subscribe.
- ✅ **PERMANENTE (2026-06-26 15:18)**: dopo merge dev3→master, rebuild `:latest` (`280e46c0072a`, fix setAuth nativo) → `docker compose pull` + `up -d` su betaC (verificato che l'immagine contenga il fix prima di ricreare). Niente più patch a mano. Ri-validato: Sync now **2,0s**, heartbeat 80s (online).
- ⏳ Non ancora stress-testato: recupero a socket caduto (paracadute, validato per design) e dual-auth supabase-direct+realtime nel tempo (nessun errore finora).

#### 🔮 Lavoro futuro — robustezza & scaling Realtime (`[JHT-REALTIME-SCALE]`)
NON urgente ora (1 VPS attivo, margine enorme). Da affrontare crescendo a molti clienti — il design **degrada con grazia** (col Realtime totalmente giù il floor è il solo paracadute ≈ ~56 q/h/utente = -94% vs il vecchio, nessun dato perso), quindi sono ottimizzazioni di scala, non blocchi:
- **Monitor del rate di riconnessione** per-VPS (contare `CHANNEL_ERROR`/`SUBSCRIBED` nei log + alert se il socket cade spesso) → accorgersene prima dai log, non dai clienti.
- **Tetto connessioni Realtime Supabase** (~500 concorrenti su Pro): è il **muro di scala vero**, più dei singoli drop → pianificare bump del tier / sharding man mano che gli utenti crescono.
- **Thundering herd**: a un riavvio del server Realtime tutti gli N socket cadono+riconnettono insieme (auth refresh + re-subscribe ×N) → valutare jitter/backoff extra oltre a quello dell'SDK.
- **Unificare l'auth**: REST diretto + websocket usano lo STESSO `refresh_token` → 2 sessioni che ruotano in parallelo; a scala + riconnessioni frequenti può dare race di rotazione token (0 finora). Fix pulito = una sola sessione auth condivisa.
- **Paracadute come leva**: se il Realtime fosse inaffidabile su larga scala, abbassare `JHT_PARACHUTE_SEC` (5min→2-3min) per recupero più stretto.

#### 💸 Decisione: posizione Vercel — NON inseguire lo "zero Vercel" (2026-06-27)
**Verificato live su betaC:** in idle il daemon fa **0 chiamate a Vercel in 6 min** (letture/heartbeat su Supabase diretto, eventi via websocket). Il **polling sempre-attivo** — che scalava col n° di utenti ed era il vero driver di costo — è **eliminato**.

**Cosa resta su Vercel (e va bene così):**
- **Push dati** (`handlePush` → `${base_url}/api/cloud-sync/push`, `cloud.js:989`): **on-demand** (solo su "Sync now"), + push risoluzione ticket (`/api/cloud-sync/tickets`). User-driven, bounded.
- **Push dei turni di chat** (`pushChatRows` → stessa route, aggiunto 2026-07-29 con `[JHT-CHAT-UNIFY]`): parte **solo quando un turno si muove** — la guardia è locale (`cloud_synced_at IS NULL`), quindi a chat ferma non parte mai e l'idle resta a 0 chiamate. Passa da Vercel e non da Supabase diretto perché la policy di INSERT dell'utente ammette solo i **propri** turni, non quelli dell'agente. User-driven, bounded: una manciata di righe piccole per messaggio scambiato, non un battito.
- **Sito/dashboard** `jobhunterteam.ai` (Next.js su Vercel): hosting web inerente, consuma **solo quando un utente naviga** (read-only). Non si toglie spostando il push.
- Auth/login + bootstrap/restore: rari.

**Decisione: si tiene il push su Vercel, NON si fa la "Fase 3" (push diretto a Supabase).** Motivi:
1. Il progetto Vercel serve comunque (ci gira il sito) → daemon 100% vs ~99% Vercel-free non cambia se paghi/usi Vercel.
2. Il push è on-demand (pochi click/giorno/utente) → **non è un costo di scala**; il driver di scala (polling) è già morto.
3. Spostare il push = refactor vero e rischioso (upsert su molte tabelle dal VPS: positions/scores/applications/companies/highlights, RLS, mapping `legacy_id`, conflitti) per **guadagno ~zero** (bolletta già al canone base $20, polling già eliminato).

**Regola:** l'obiettivo non era "zero Vercel" (impossibile finché c'è il sito + inutile), era **"Vercel non scala col daemon sempre-attivo"** → CENTRATO. Se un domani il costo Vercel crescesse con gli utenti, sarà il **traffico del sito**, non il push → leva giusta = ottimizzare l'app Next (caching/ISR, render statico, alleggerire le API di lettura), NON azzerare il push del daemon.

**Nota sul lavoro parallelo:** la divisione in 3 (Part A/B/C) ha dato in pratica solo la
**mig 048** (consegnata duplicata da due branch, non costruita sulla fondazione). Il
cablaggio `cloud.js` di Part B (subscribe ticket) e tutta Part C sono stati completati
qui sulla fondazione. Mig 048 presa dalla versione `public.`-qualified.

**Carico stimato flag ON (idle):** heartbeat 20/h + paracadute (sync+ticket) 24/h +
desired-state 12/h ≈ **~56 q/h/utente** + 1 connessione websocket (vs ~900/h). ≈ -94%.

> ⚠️ Flag OFF di default: zero cambio sul fleet finché Leone non lo accende su betaC.

---

### ✅ Step 0 — redesign 2026-06-25 (FATTO, in master `fcabbb0a6`)

| Pezzo | Stato | Evidenza in codice |
|---|---|---|
| Push on-demand (no push per-tick) | ✅ | `cloud.js:1931` loop, push solo da `handleSyncRendezvous` |
| Cadenza a 2 velocità (5s + 60s) | ✅ | `cloud.js:1940-2011` |
| Web "Sync now" via Realtime WS, no polling | ✅ | `CloudRefreshButton.tsx:258` `supabase.channel` + `postgres_changes` |
| `team_state` REPLICA IDENTITY FULL | ✅ | mig **047** |
| Reconcile team-state **fuso** nel daemon | ✅ | `pid1.js:854`, `reconcileOnce` a 60s |
| Poller team-commands/file-bridge/user-messages **ritirati** (congelati) | ✅ | `pid1.js:820-832`, gate `controlPollers` |
| Letture dirette Supabase (no Vercel) | ✅ (Fase 1) | `getDirectReader` cablato in pull-desired-state/ticket/rendezvous (`cloud.js:1359/1649/1789`), con fallback Vercel |

---

### ⬜️ Le 7 tappe event-driven — stato REALE: **0/7 implementate**

| # | Tappa | Stato | Verifica in codice |
|---|---|---|---|
| 1 | Dep `@supabase/supabase-js` + `cli/src/lib/cloud-realtime.js` | ❌ **non iniziata** | nessuna dep supabase nel `cli/package.json`; **il file `cloud-realtime.js` non esiste** |
| 2 | sync-flag → Realtime (togliere sync-check 5s) | ❌ | `handleSyncRendezvous` ancora ogni ~5s (`JHT_SYNC_CHECK_SEC \|\| '5'`, `cloud.js:1940`) |
| 3 | ticket → Realtime + migrazione publication+replica full | ❌ | `handleTicketSync` ancora poll 60s; **nessuna mig 048**, `position_tickets` NON in `supabase_realtime` (mig 021 aggiunse solo `team_state`) |
| 4 | desired-state → poll ~5 min | ❌ | ancora 60s (`doHeavy`, `cloud.js:1957`) |
| 5 | heartbeat → presence | ❌ | ancora `reconcileOnce` (PATCH) a 60s (`cloud.js:1994`) |
| 6 | Paracadute poll-lento | ⚠️ **N/A** | non esiste, e non serve ora: senza websocket non c'è nulla da cui recuperare. Oggi il poll 60s **è** già la rete |
| 7 | Test su betaC dietro flag | ❌ | nessuno scaffold di flag/test |

---

### 🎯 Risposte secche

- **Il sync-check 5s è ancora attivo?** → **Sì**, pienamente. È il meccanismo
  corrente del pulsante "Sync now" (720 query/h, ~80% del carico).
- **Il paracadute poll-lento è implementato?** → **No**, e correttamente: ha senso
  **solo dopo** aver aggiunto il Realtime (tappe 1-2). Finché il daemon è tutto-poll,
  il poll stesso è la sicurezza.
- **Carico attuale?** → **~900 query/h/utente** (baseline §3 del doc di design). Il
  taglio a ~30-50 (-95%) è il **premio** delle 7 tappe, **non ancora incassato**.

---

### ⚠️ Rischi / note aperte

1. **Nessuna regressione trovata.** Loop daemon coerente: sleep interrompibile, guard
   `HALT-WEEKLY`, error-handling best-effort per corsia, retire ben gated.
2. **Il guadagno di scaling è tutto ancora sul tavolo.** Oggi non è un problema (pochi
   utenti, daemon spesso idle → `sentinel_ticks` 0/24h sul cloud), ma il sync-check 5s
   × N utenti è esattamente il collo di bottiglia a 500-1000 utenti.
3. **Primo passo bloccante = tappa 1** (dep SDK + modulo). Senza `@supabase/supabase-js`
   nel cli, le tappe 2-3-5 non possono partire. Il web ha già `@supabase/realtime-js`;
   il cli no.
4. **Prerequisito tappa 3 mancante:** migrazione **048** per mettere `position_tickets`
   nella publication `supabase_realtime` + `REPLICA IDENTITY FULL` (analoga alla 047).
5. **Debito minore:** i poller congelati sono codice morto-a-runtime (riattivabile via
   env `JHT_CLOUD_CONTROL_POLLERS=1`). Quando il modello tunnel sarà lockato, candidati
   a rimozione vera.

---

### 🧭 Raccomandazione

Il redesign on-demand ha già dato il grosso del valore *funzionale* (Vercel toccata
solo al click, costi sotto controllo). Le 7 tappe sono **ottimizzazione di scaling**,
non urgenti finché si è sotto le decine di utenti.

Quando si parte, l'ordine giusto è quello del doc di design:

1. **Tappa 1** — dep `@supabase/supabase-js` + scaffold `cloud-realtime.js`
   (subscribe + riconnessione), dietro flag, senza toccare il loop attuale.
2. **Tappa 2** — sync-flag → Realtime: da sola uccide ~l'80% del carico (il
   sync-check 5s).
3. **Tappa 7** — test su betaC dietro flag (reattività + recupero a socket caduto).
4. Solo dopo: ticket (mig 048 + Realtime), desired-state (poll 5 min), heartbeat
   (presence), e il paracadute poll-lento.

---

### Riferimenti
- `docs/internal/2026-06-25-daemon-event-driven-realtime-design.md` (il piano a 7 tappe)
- `docs/internal/2026-06-24-vps-daemon-supabase-direct-design.md` (fase letture-dirette)
- `cli/src/commands/cloud.js` (loop daemon, corsie, `handleSyncRendezvous`/`handleTicketSync`/`handlePullDesiredState`)
- `cli/src/commands/pid1.js` (gating retire `JHT-CLOUD-INTERACTIVE-RETIRE`, righe 820-832)
- `web/app/components/CloudRefreshButton.tsx` (Realtime lato browser, già fatto)
- `supabase/migrations/047_team_state_replica_identity_full.sql`
