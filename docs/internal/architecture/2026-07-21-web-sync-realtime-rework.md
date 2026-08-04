# ⚡ Web sync Realtime-first + backflow messaggi — design & decision record (2026-07-21)

> **Decision doc + postmortem.** Lavoro su `dev5` (commit `0f5b66ae…`), partito da un
> bug utente ("ho risposto in chat sul sito, al reload era sparito e nessuno ha mai
> risposto") e allargato — su richiesta esplicita dell'utente — a un ripensamento
> della sincronizzazione web con obiettivo **costi che non scalano col numero di
> utenti** + **UX fluida senza pulsanti né reload**.
>
> Aggiorna il living doc [`cloud-sync-architecture.md`](cloud-sync-architecture.md)
> (shift 2026-07-21) e concretizza la fase 3 di
> [`2026-06-20-data-sync-and-dashboard-split-design.md`](2026-06-20-data-sync-and-dashboard-split-design.md).

---

## 1. 🐛 L'incidente che ha innescato tutto (chat web)

**Sintomo** (2026-07-21, sito deployato, account P01): reply scritta nella
chat → visibile finché la pagina resta aperta → **sparita al reload**, nessuna
risposta mai arrivata dall'agente.

**Root cause — DOPPIA, entrambe architetturali:**

1. **Clobber dal full-push.** `pending_user_messages` viene full-pushata dalla VPS a
   ogni tick (~30-60s) con upsert cieco su `(user_id, legacy_id)`: i campi di
   proprietà dell'utente (`acknowledged_at`, `user_reply`, `user_reply_at`) venivano
   sovrascritti con i **NULL della SQLite locale**. La reply atterrava su Supabase e
   veniva cancellata entro un minuto. Controprova nei dati: l'account con VPS che
   pusha attivamente aveva **zero** ack/reply; l'account con VPS ferma dal 18/07 li
   conservava.
2. **Backflow inesistente.** L'agente legge le reply SOLO dalla SQLite locale
   (filtro `user_reply_at IS NOT NULL AND agent_seen_reply_at IS NULL` iniettato nel
   prompt). Il canale cloud→VPS per le reply era dichiarato "futuro" in
   `cloud.js` (commento al full-push) e **mai costruito**: anche senza clobber, la
   chat web era un guscio write-only.

## 2. 🔎 I tre bug del pulsante "Sync now" (UX "si sincronizza malissimo")

Sintomi utente: *"premo Sincronizza, non succede niente; dopo un po' si ferma anche
quando ha già sincronizzato; i dati cambiano solo se ricarico; nessuno mi avvisa."*

| # | Bug | Effetto |
|---|---|---|
| 1 | Il canale Realtime era sottoscritto **senza `setAuth(jwt)`** | Canale con role `anon` → la RLS blocca in silenzio ogni `postgres_changes` → il completamento non arrivava **mai** (gotcha già documentato nel vecchio `useTeamState` dal 23/05, non applicato qui) |
| 2 | Completamento confrontato con **l'orologio del browser** (`done >= requestedAt`) | Skew di clock qualsiasi → il refresh non scatta; ora si confronta solo l'avanzamento di `sync_completed_at` rispetto all'ultimo valore noto **dal server** (baseline alla richiesta), e `sync_requested_at` è timbrato **lato server** nella route |
| 3 | Timeout spinner **60s**, ma la VPS in deep-idle polla il rendezvous ogni **120s** | Lo spinner moriva quasi sempre prima della risposta legittima; il completamento tardivo aggiornava il timestamp ma **non faceva mai `router.refresh()`** → dati fermi fino al reload manuale |

Fix in `CloudRefreshButton`: setAuth prima della subscribe, baseline server-only,
timeout 180s (solo spinner: la subscription resta viva e il push in ritardo aggiorna
comunque), messaggio esplicito "la VPS non ha ancora risposto — i dati arriveranno
da soli".

## 3. 🧭 Decisione architetturale: Realtime-first, mai polling client

**Regola:** ogni canale live del **browser** passa da **Supabase Realtime
(websocket diretto browser↔Supabase)**. Mai `setInterval`+fetch verso Vercel.

**Perché** (numeri dal postmortem [2026-06-24](../postmortems/2026-06-24-vercel-cost-analysis-and-sync-fix.md)):
- Ogni chiamata alle route Vercel = 1 Function Invocation + ~2,8 Observability
  Events **fatturati**. A giugno: 600k eventi/giorno **a team fermo**, $23/mese di
  variabile con 1-2 utenti, proiezione ~$580/mese a 50 utenti. Il costo scala col
  **battito**, non col lavoro.
- Il websocket Realtime **non tocca Vercel**: 0 invocazioni, 0 Observability. Sul
  piano Supabase Pro sono inclusi **500 connessioni simultanee + 5M messaggi/mese**
  (oltre: $10/1000 conn di picco, $2,50/M messaggi). Un utente attivo (tab ~2h/
  giorno, team che lavora) genera ~4-5k messaggi/mese → **100 utenti ≈ 0,5M/mese,
  un decimo della quota inclusa**.
- A tab chiuso il socket cade da sé → **consumo zero** quando l'utente non guarda.

**Webhooks: valutati e scartati per la UI.** Un webhook (trigger/pg_net → endpoint)
non può raggiungere un browser aperto — che avrebbe comunque bisogno di un canale in
ascolto — e ogni webhook→Vercel è un'invocazione pagata. Restano l'opzione giusta,
in futuro, per fan-out server-side out-of-band (email, push notification, Telegram).

## 4. 📡 Il segnale "dati freschi" gratuito

La route `/api/cloud-sync/push` ora **timbra `team_state.sync_completed_at`** a ogni
push che porta dati dashboard (positions/scores/applications/companies/highlights/
transitions/tombstones — esclusi i messaggi, che hanno già i loro eventi per-riga, e
sentinel/profile). Costo: un UPDATE su una riga per push, zero infrastruttura nuova.

I browser aperti (già sottoscritti a `team_state` via websocket) lo usano così:
- avanzamento di `sync_completed_at` → **auto-refresh** della pagina con **throttle
  90s**, **solo a tab visibile** (a tab nascosto si rimanda al `visibilitychange`),
  con flash verde **"Dati aggiornati"**;
- ogni `router.refresh()` è una render SSR su Vercel → il throttle è ciò che tiene
  il costo a ~decine di invocazioni/giorno per utente attivo invece di migliaia.

Il rendezvous esplicito (bottone "Sync now") continua a funzionare sopra lo stesso
segnale; il daemon VPS vede `sync_requested_at > sync_completed_at` e pusha fresco.

## 5. 💬 Messaggi bidirezionali — catena completa

```
agente (VPS) ──full-push──► RPC merge (mig 057) ──► Supabase ──websocket──► drawer/chat
                                                       ▲                        │
utente (web) ──reply/ack── /api/pending-messages ──────┘                        ▼
VPS ◄──pull `pending_replies` (supabase-direct, 0 Vercel) ◄── pull-desired-state lane
  └─► SQLite locale ─► l'agente legge la reply nel prompt e risponde
```

- **mig 057 `upsert_pending_user_messages_merge`** (APPLICATA a prod, additiva):
  merge per-campo — campi agente (body/kind/delivered) vince il push; campi utente
  (ack/reply) `COALESCE` cloud-first; `agent_seen_reply_at` locale-first. Con
  **WHERE anti no-op**: il full-push a regime non riscrive righe identiche (niente
  churn di `updated_at`, niente eventi Realtime spurii, niente write amplification).
- **Lane `pending_replies`** in `/api/cloud-sync/pull-desired-state` con cursore
  dedicato `messages_since` sui timestamp delle azioni utente (`updated_at` è
  inutilizzabile come cursore: il full-push lo bumpa). Confronti fra date con
  `Date.parse`, mai lessicografici (`+00:00` vs `Z`, stessa trappola del cursore
  congelato del 15/07).
- **CLI** (`handlePullDesiredState`): lettura direct-Supabase
  (`readPendingReplyChanges`, RLS come utente, zero Vercel) con fallback GET Vercel;
  apply in SQLite con `COALESCE` non distruttivo e skip dei no-op.
- **UI live**: hook `usePendingMessagesLive` (INSERT/UPDATE della propria riga via
  websocket, riga intera nel payload → zero refetch) consumato dal drawer navbar
  (badge incluso) e da `/messages`; merge che non regredisce mai lo stato ottimistico
  locale (ack/reply appena fatti).

## 6. 🧹 Audit polling client (2026-07-21) — stato finale

| Componente/pagina | Prima | Dopo |
|---|---|---|
| `CloudRefreshButton` | Realtime rotto (anon) + niente refresh | websocket autenticato + auto-refresh throttled |
| `MessagesDrawer` / `/messages` | fetch a mount/visibility | + eventi live websocket (zero fetch) |
| `useTeamState.ts` (hook) | poll 15s — **codice morto**, zero consumer | **eliminato** |
| `/notifications` | poll 5s **anche su cloud**, senza gate | cloud: mount + visibility + azioni; locale: 5s |
| `CloudSyncStatusBanner` (su /positions) | render null su cloud ma **interval 30s attivo** | polling solo a contesto locale confermato |
| `/settings/cloud-sync` | 30s visible-only | 60s visible-only + refresh a visibility (unica pagina cloud con interval: mostra il "last sync" muoversi) |
| Pagine `/team/*` (capitano, assistente, analista, sentinella, scout, scorer, scrittore, critico) | — | già gated `if (isCloud) return` (sweep 21/06), polling solo in locale |
| `/cron`, `/channels`, `/backup`, … | — | desktop-only (redirect su cloud, guard centrale nel layout) |

Su **cloud** l'unico interval residuo è la pagina di stato `/settings/cloud-sync`
(60s, solo visibile, apertura sporadica) — scelta deliberata, non una dimenticanza.

## 7. 💰 Stima costi e scalabilità

Voce **variabile** (Vercel + Realtime), assumendo il pattern d'uso di giugno:

| Scenario | Architettura pre-rework | Post-rework |
|---|---|---|
| 2-4 utenti (oggi) | ~$23/mese (misurato a giugno) | pochi $/mese |
| 50 utenti | ~$580/mese (proiezione postmortem) | ~$25-60/mese |
| 200 utenti | ~$2.300/mese | ~$100-200/mese |

Colli di bottiglia REALI rimasti (fuori scope di questo lavoro, già tracciati):
1. **1 VPS per utente** — il costo lineare dominante (€/utente Hetzner + tetto burn
   ~70% weekly per box). Blocker go-live noto: consolidamento a daemon singolo.
2. **Compute Supabase** (Micro) — a centinaia di utenti va scalato di taglia
   (costo a gradini, non per chiamata).
3. **Connessioni Realtime** — 500 simultanee incluse ≈ centinaia di tab aperte
   insieme; non è il collo di bottiglia.

## 8. 🚦 Stato deploy

| Pezzo | Stato |
|---|---|
| mig 057 (RPC merge, con WHERE anti no-op) | ✅ **applicata a prod** (additiva; inerte finché il web non la chiama) |
| Web (push route RPC + fresh-signal, team-state stamp, pull lane, UI Realtime, audit polling) | 📦 su `dev5` → live con release master→**production** (gated utente) |
| CLI (backflow reply → SQLite) | 📦 su `dev5` → attivo al prossimo **redeploy container VPS** (gated utente) |

Ordine sicuro: qualsiasi. La RPC è compatibile col vecchio client (route vecchia
usa ancora l'upsert cieco finché non va live la nuova); il pull esteso è additivo
(campi nuovi ignorati dai client vecchi); la UI nuova degrada a fetch-on-visibility
se il websocket non c'è.

## 9. 🔔 Notifiche browser configurabili ([JHT-WEB-NOTIFICATIONS], stesso giorno)

Feature costruita sopra lo stesso stack Realtime (commit `304c02a8`+`f7b69f18`,
mig 058 applicata a prod). Solo web cloud, **niente service worker / Web Push**:
le notifiche vivono finché una tab del sito è aperta (requisito esplicito).

- **Storage**: `notification_prefs` (JSONB per-utente, RLS). Il browser legge e
  scrive **direttamente su Supabase** con la sessione — zero route Vercel.
  Cache localStorage per il runtime + riallineo cross-tab via evento `storage`.
- **Trigger**: `positions` aggiunta alla publication Realtime (senza REPLICA
  IDENTITY FULL: tabella larga, serve solo la riga NEW). Il motore client
  (`web/lib/web-notifications.ts`) valuta ogni INSERT/UPDATE della propria riga.
- **Regola** = trigger (posizione **valutata** / **nuova**) + condizioni in AND:
  score minimo, località (substring, OR), codici paese (OR), keyword su
  titolo+azienda (OR), work mode (remote/hybrid/onsite). `minCount > 1` =
  **digest**: una notifica raggruppata ogni N match. Dedupe per
  regola+posizione (localStorage, cap 800) contro i re-push.
- **Messaggi agenti**: notifica su INSERT di `pending_user_messages` (nome
  agente + preview); toggle dedicato + "solo a scheda non attiva".
- **UI**: `/settings/notifications` (editor completo, flusso permesso browser
  con guida per lo stato *denied*, preset rapidi, notifica di prova, 7 lingue),
  linkata dalla variante cloud di `/settings`. Runtime montato in navbar
  (`useWebNotifications`, componente invisibile).
- **Costo**: riusa il websocket già aperto (canale in più sulla stessa
  connessione); eventi `positions` = solo righe delta della propria utenza.
  Zero invocazioni Vercel in tutto il ciclo (lettura prefs, eventi, salvataggio).

## 🔗 Riferimenti

- `cloud-sync-architecture.md` — living doc (shift 2026-07-21 in testa)
- `../postmortems/2026-06-24-vercel-cost-analysis-and-sync-fix.md` — i numeri del costo
- `supabase/migrations/057_pending_messages_merge_upsert.sql` — definizione canonica RPC
- `web/app/api/cloud-sync/push/route.ts` · `web/app/api/cloud-sync/pull-desired-state/route.ts`
- `web/app/components/CloudRefreshButton.tsx` · `web/app/hooks/usePendingMessagesLive.ts`
- `cli/src/commands/cloud.js` (`handlePullDesiredState`) · `cli/src/lib/supabase-direct.js`

---

## ⚡ Aggiornamento 2026-07-29 — la catena non finiva in SQLite: adesso arriva al pane

> **Questo documento resta il record del 21/07 e non è stato riscritto.** Quello che
> descrive era vero quel giorno. Questa sezione dice cosa si è scoperto dopo e cosa è
> cambiato con `[JHT-CHAT-UNIFY]` (merge `feat-chat-unify`, mig **060**). Lo stato
> corrente vive in [`cloud-sync-architecture.md`](cloud-sync-architecture.md),
> § *Flusso chat unificata (end-to-end)*.

### Cosa era rimasto aperto

Il § 5 *"Messaggi bidirezionali — catena completa"* si chiudeva così:

> `└─► SQLite locale ─► l'agente legge la reply nel prompt e risponde`

Quel passo finale era **l'unico non costruito**. Il lavoro del 21/07 ha portato la
reply dal cloud fino alla **SQLite del box** — ed è esattamente ciò che ha
implementato, correttamente. Ma da lì in poi non c'era nessun meccanismo che
mettesse la reply **davanti** all'agente: dipendeva dal fatto che l'agente
chiamasse `jht-check-user-replies` **di sua iniziativa** ("in cima al loop", come
prescrive la skill). In campo questo voleva dire ore di attesa, o mai. La catena
era quindi completa fino a SQLite, non fino all'agente — e il § 5 andava letto
così, non come una consegna garantita.

Sono emersi in campo altri due tratti mancanti, che il 21/07 non erano ancora
visibili perché il sintomo era coperto dal primo:

1. **`jht-send` non risaliva al cloud.** La skill `chat-web` prescrive agli agenti
   di rispondere **solo** con `jht-send`, che scrive una riga in `chat.jsonl` e
   **non tocca né SQLite né Supabase**. Ogni risposta data secondo il protocollo
   era quindi invisibile sul web: è l'altra metà di "gli agenti non rispondono sul
   sito", indipendente dal clobber di mig 057.
2. **Il filtro `delivered_via='web'`** nello storico web nascondeva ogni risposta
   che `jht-notify-user` aveva marcato `'telegram'` — cioè, con Telegram
   configurato, quasi tutte. Quella colonna dice su quale **canale** è stata spinta
   la notifica, non se il messaggio appartiene alla conversazione.
3. **Il turno dell'agente restava in SQLite fino a "Sync now".** Corollario diretto
   del `[PUSH ON-DEMAND 2026-06-25]`: senza push periodico, la risposta scritta con
   `jht-notify-user` saliva solo quando l'utente premeva il pulsante.

### Cosa è cambiato

- **`pending_user_messages` non è più una coda a senso unico** (mig 060): ogni turno
  è una riga con un `author` (`'agent'` | `'user'`). Il composer web non è più
  costretto ad appendersi a un messaggio dell'agente ancora senza risposta — era il
  motivo per cui si spegneva con *"Nessun messaggio in attesa di risposta"*.
  `user_reply` resta dov'è e continua a funzionare: le conversazioni salvate non si
  riscrivono.
- **Il punto di unificazione fra gioco e web è `chat.jsonl` sul box**, non la UI.
  `pending_user_messages` ne diventa il mirror sincronizzabile, e **`chat_ts` (il
  `ts` unix della riga JSONL) è la chiave di dedup nei due versi**: l'ingest salta le
  righe il cui `ts` è già un `chat_ts` noto, il mirror scrive solo le righe con
  `chat_ts IS NULL`. Senza, il mirror riscriverebbe all'infinito quello che ha appena
  letto.
- **Il turno scritto dal web raggiunge il pane dell'agente.**
  `POST /api/pending-messages` crea il turno (`author='user'`,
  `legacy_id = -epoch_ms`) e timbra `team_state.chat_requested_at` — il gemello di
  `sync_requested_at` di mig 045, sulla **stessa riga** che il daemon legge già nel
  giro veloce per "Sync now", quindi a riposo **zero letture in più**. Il daemon
  importa il turno e lo consegna con `jht-tmux-send`, **stessa busta del gioco**
  (`[@utente -> @<agente>] [CHAT] …`). **Latenza attesa ~5s fino al pane**, più il
  busy-wait di `jht-tmux-send` se la TUI è occupata (fino a 90s, cap 120s); exit 4
  non consuma il messaggio, si ritenta.
- **Le risposte `jht-send` risalgono al cloud**: il passo `ingestChatJsonl` le importa
  in SQLite (guardia = `stat` del file, gratis) e la corsia le pusha — **~5s +
  roundtrip del push**, poi il browser le riceve sul websocket che ha già aperto.

### Cosa di questo documento resta valido

Tutto il resto. In particolare: la regola **Realtime-first / mai polling
browser→Vercel** (§ 3) è il vincolo sotto cui è stata progettata anche la corsia chat
— il campanello viaggia su una riga `team_state` che il daemon **già leggeva**, il
browser non polla nulla, e ogni passo della corsia ha una guardia **locale** davanti,
quindi a chat ferma non tocca né Supabase né Vercel. Restano validi il segnale
`sync_completed_at` (§ 4), la RPC merge di mig 057 (§ 5) — che mig 060 **estende**,
non sostituisce —, l'audit polling (§ 6), le stime di costo (§ 7) e le notifiche
browser (§ 9).

### Stato deploy (2026-07-29)

| Pezzo | Stato |
|---|---|
| mig **060** (`author`, `chat_ts`, policy INSERT, rendezvous chat, RPC estesa) | ⬜ **NON applicata a prod** — l'ultima applicata è la 059 (22/07) |
| Web (`POST /api/pending-messages`, storico senza filtro canale, push route) | 📦 in master → live con release master→**production** (gated utente) |
| CLI (`chat-sync.js` + corsia nel daemon) | 📦 in master → attivo al prossimo **redeploy container** (gated utente) |

**Degrado finché la mig 060 non è applicata** — dichiarato, senza rotture: la lettura
`team_state` del daemon prende 400 sulle colonne `chat_*` e **ritenta con le sole
colonne storiche** (corsia cloud→box semplicemente ferma); `POST /api/pending-messages`
fallisce con 500; il push dei turni dal box continua a funzionare perché la RPC di mig
057 ignora i campi in più; e sul box `handleChatSync` esce subito se la SQLite non ha
ancora la colonna `author`. Tabella completa in
[`cloud-sync-architecture.md`](cloud-sync-architecture.md).

### Riferimenti aggiunti

- `supabase/migrations/060_chat_unified.sql` — definizione canonica (schema + RPC estesa)
- `cli/src/lib/chat-sync.js` · `cli/src/commands/cloud.js` (`handleChatSync`, `readRendezvousState`)
- `web/app/api/pending-messages/route.ts` · `web/lib/messages-thread.ts`
- `game/scripts/backend/vps_backend.gd` (`_do_send_chat`, `_fetch_convo`) — il lato gioco della stessa conversazione
- `agents/_tools/jht-send` · `agents/_skills/chat-web/SKILL.md`
