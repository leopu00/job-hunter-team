# 🔌 Daemon event-driven via Supabase Realtime — design

> Continuazione di [`2026-06-24-vps-daemon-supabase-direct-design.md`]
> ([JHT-DAEMON-SUPABASE-DIRECT]). Quel doc ha spostato le LETTURE del daemon da
> Vercel a Supabase diretto. Questo doc copre il passo successivo: **da polling a
> event-driven** (Realtime), per abbattere il carico DB e scalare a molti utenti.
> Cattura anche il ridisegno della sync fatto il 2026-06-25 (push on-demand, ecc.).

---

## 1. 📦 Cosa è GIÀ stato fatto (sync redesign 2026-06-25)

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

## 2. 💸 Il modello di costo VERO (correzione importante)

Errore da evitare: *"su Supabase le query sono gratis, quindi il numero non conta."*
**Falso.** Supabase Pro non fattura a query, MA dà un **server Postgres con CPU/RAM
FISSE**. Le query girano su quella CPU.

- **Poche query/utente** → tanta CPU libera → reggi **più utenti** sullo stesso compute.
- **Tante query** → saturi la CPU → devi pagare un **compute più grosso** (add-on).

⇒ La frequenza conta come **capacità/headroom di scaling**, non come bolletta
per-query. Ridurre il rate per-utente = scalare più lontano prima di upgradare.

---

## 3. 📊 Carico DB attuale del daemon (per utente/ora)

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

## 4. 🎯 Il piano: event-driven IBRIDO

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

## 5. ✅ Prerequisiti (stato 2026-06-25)

| Tabella | In `supabase_realtime` | Replica identity | Da fare |
|---|---|---|---|
| `team_state` | ✓ sì | `f` (FULL) | nulla (pronto) |
| `position_tickets` | ✗ no | `d` (default) | ADD a publication + `REPLICA IDENTITY FULL` |
| `positions` | ✗ no | `d` | nulla (resta a poll lento, vedi §4) |

RLS già attiva su tutte (Realtime consegna solo la riga dell'utente). Migrazione
necessaria: aggiungere `position_tickets` alla publication + replica identity full.

---

## 6. ⚠️ "Sicuro funziona?" — sì, con un paracadute

Il meccanismo è standard (lo usa già il browser, verificato su `team_state`). MA un
daemon con websocket persistente ha più parti in movimento di un poll:
- **Riconnessione:** la cade del socket la gestisce l'SDK (`@supabase/supabase-js`).
- **Rete di sicurezza OBBLIGATORIA:** un **poll lento (~5 min)** che rilegge tutte le
  corsie, così se il websocket muore in silenzio o perde un evento, il daemon
  recupera comunque. Senza questo, un socket morto = sync ferma.
- **Trasporto:** Realtime su WSS/443 → ok da una VPS.

Con il paracadute: robusto. Senza: fragile.

---

## 7. 🛠️ Tappe di implementazione (in ordine di impatto)

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

## 8. 🧹 Debito di design noto (backlog, NON ora)

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

## Riferimenti
- `docs/internal/2026-06-24-vps-daemon-supabase-direct-design.md` (fase letture-dirette)
- `docs/internal/2026-06-24-vercel-cost-analysis-and-sync-fix.md` (analisi costi)
- `supabase/migrations/047_team_state_replica_identity_full.sql`
- `web/app/components/CloudRefreshButton.tsx` (Realtime lato browser, già fatto)
