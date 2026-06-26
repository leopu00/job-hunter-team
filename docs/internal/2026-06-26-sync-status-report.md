# 📋 Report stato Sync — event-driven daemon (2026-06-26)

> Verifica in codice dello stato reale del sync redesign rispetto al piano di
> design [`2026-06-25-daemon-event-driven-realtime-design.md`]. Analisi su `dev3`.
> Riferimenti: `cli/src/commands/cloud.js`, `cli/src/commands/pid1.js`,
> `cli/src/lib/`, `web/app/components/CloudRefreshButton.tsx`, `supabase/migrations/`.

---

## TL;DR

**Lo "Step 0" (redesign sync del 25/06) è fatto, mergiato e coerente in codice. Il
piano event-driven a 7 tappe è ancora a 0/7 — è solo design.** Il daemon gira ancora
al **baseline ~900 query/h/utente**: il sync-check a 5s **è tuttora attivo** (è
l'elefante, ~80% del carico), e il paracadute poll-lento **non esiste** (né serve
ancora, perché non c'è alcun websocket da cui cadere).

> ⚠️ Nota anti-allarme: i poller "ritirati" **non sono una regressione**. Sono
> congelati dietro l'escape-hatch `JHT_CLOUD_CONTROL_POLLERS=1` (default off); pid1
> di default avvia **solo** il `daemon` (con `reconcileOnce` fuso dentro).

---

## ⏩ Aggiornamento 2026-06-26 — piano event-driven COMPLETO su dev3 (7/7, dietro flag)

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

### 🧪 Esito test live su betaC (2026-06-26)
- Immagine `:latest` (build 26/06 14:34) verificata contenere il codice; **mig 048 applicata a prod** (`position_tickets` in publication + replica full).
- `JHT_REALTIME_SYNC=1` aggiunto al compose betaC (oltre a `JHT_SUPABASE_DIRECT=1` già presente).
- Canali `team-state` + `tickets` **SUBSCRIBED**, refresh_token valido (nessun errore auth).
- **Sync now end-to-end: 1,6s** (trigger `sync_requested_at` → evento websocket → push → ack `sync_completed_at`).
- 🐛 **BUG TROVATO E FIXATO live** (`90447acf4`): postgres_changes con RLS non consegnava nulla (canale SUBSCRIBED ma 0 eventi) perché il socket Realtime usava l'**anon key** invece dello **user-JWT** (l'auto-wiring del token in supabase-js è async e arrivava DOPO la subscribe). Fix: `client.realtime.setAuth(access_token)` forzato PRIMA delle subscribe.
- ⚠️ **L'immagine NON ha ancora il fix setAuth** (committato dopo la build): betaC gira col file **patchato a mano** (`docker cp`). Per renderlo permanente serve **merge dev3→master + rebuild :latest + redeploy**. Finché non si rifà l'immagine, NON fare `docker compose up -d` su betaC (perderebbe la patch).
- ⏳ Non ancora stress-testato: recupero a socket caduto (paracadute, validato per design) e dual-auth supabase-direct+realtime nel tempo (nessun errore finora).

**Nota sul lavoro parallelo:** la divisione in 3 (Part A/B/C) ha dato in pratica solo la
**mig 048** (consegnata duplicata da due branch, non costruita sulla fondazione). Il
cablaggio `cloud.js` di Part B (subscribe ticket) e tutta Part C sono stati completati
qui sulla fondazione. Mig 048 presa dalla versione `public.`-qualified.

**Carico stimato flag ON (idle):** heartbeat 20/h + paracadute (sync+ticket) 24/h +
desired-state 12/h ≈ **~56 q/h/utente** + 1 connessione websocket (vs ~900/h). ≈ -94%.

> ⚠️ Flag OFF di default: zero cambio sul fleet finché Leone non lo accende su betaC.

---

## ✅ Step 0 — redesign 2026-06-25 (FATTO, in master `fcabbb0a6`)

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

## ⬜️ Le 7 tappe event-driven — stato REALE: **0/7 implementate**

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

## 🎯 Risposte secche

- **Il sync-check 5s è ancora attivo?** → **Sì**, pienamente. È il meccanismo
  corrente del pulsante "Sync now" (720 query/h, ~80% del carico).
- **Il paracadute poll-lento è implementato?** → **No**, e correttamente: ha senso
  **solo dopo** aver aggiunto il Realtime (tappe 1-2). Finché il daemon è tutto-poll,
  il poll stesso è la sicurezza.
- **Carico attuale?** → **~900 query/h/utente** (baseline §3 del doc di design). Il
  taglio a ~30-50 (-95%) è il **premio** delle 7 tappe, **non ancora incassato**.

---

## ⚠️ Rischi / note aperte

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

## 🧭 Raccomandazione

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

## Riferimenti
- `docs/internal/2026-06-25-daemon-event-driven-realtime-design.md` (il piano a 7 tappe)
- `docs/internal/2026-06-24-vps-daemon-supabase-direct-design.md` (fase letture-dirette)
- `cli/src/commands/cloud.js` (loop daemon, corsie, `handleSyncRendezvous`/`handleTicketSync`/`handlePullDesiredState`)
- `cli/src/commands/pid1.js` (gating retire `JHT-CLOUD-INTERACTIVE-RETIRE`, righe 820-832)
- `web/app/components/CloudRefreshButton.tsx` (Realtime lato browser, già fatto)
- `supabase/migrations/047_team_state_replica_identity_full.sql`
