# 🔄 Data sync + dashboard split — design (2026-06-20)

> **Design / decision doc.** Concretizza il piano **Dati** del redesign `interaction-planes`
> (2026-06-15) e ne **rivede una decisione aperta**: il web cloud **non è puramente
> read-only**, mantiene una **corsia stretta di richieste async** (ticket + azioni-posizione)
> che la VPS *pulla*. Definisce inoltre come funziona davvero la **sincronizzazione dati**
> (sync all'accesso + pulsante manuale, **niente polling continuo**) e la **separazione
> netta delle due dashboard** (locale dentro l'app desktop · web cloud nel browser).
>
> **Status: PROPOSTA — approvata dall'utente 2026-06-20.** Implementazione a fasi, su `dev4`.
> **Nessun deploy sui team in osservazione** (Codex in pace, Kimi da osservare) finché non lo decide l'utente.
>
> Raffina: `2026-06-15-interaction-planes-redesign-design.md` (§ "Decisioni aperte" #5).
> Si appoggia a: `cloud-sync-architecture.md` (living doc del meccanismo push/pull).
>
> 🪦 **SUPERATO in parte 2026-07-19/23 (migrazione nativa `32225cb7` + ritiro `:3000` `303a6ec6`):**
> la "dashboard locale dentro l'app desktop" **non è più una view web wrappata** —
> non esiste `desktop/main.js`, non esiste una `BrowserWindow` Electron, e il
> container non serve più Next.js né espone porte. Le stesse viste sono
> **native nell'ufficio Godot** (`game/`), alimentate via `docker exec` (locale)
> o SSH (VPS); il browser vede **solo** il cloud. Restano validi e implementati:
> lo split duro `local`/`cloud` deciso a build (`NEXT_PUBLIC_JHT_DEPLOY`), la
> corsia richieste async, e il principio "una istanza = una modalità sola".
> Il meccanismo di sync descritto qui (on-access + pulsante, niente polling) è
> stato a sua volta superato dal Realtime-first del 2026-07-21, vedi
> [`2026-07-21-web-sync-realtime-rework.md`](2026-07-21-web-sync-realtime-rework.md).

---

## TL;DR

Tre piani netti, **una sola codebase** (la stessa app Next.js, modalità decisa a runtime/deploy):

| Piano | Direzione | Dove vive | Cosa contiene |
|---|---|---|---|
| 📊 **Dati** | one-way `team → cloud → utente` | web cloud (Supabase) **+** locale (SQLite) | positions, scores, applications, **event-log attività**, map, profilo (vista) — **sola lettura** |
| 🎫 **Richieste** | one-way async `utente → cloud → team` | web cloud (tabelle dedicate Supabase) | ticket testo libero, like/dislike, escludi, "scrivimi il CV", geocode, recheck |
| 🎛️ **Interazione** | two-way real-time `utente ↔ team` | **solo app desktop** (locale o VPS via tunnel SSH) | chat agenti, upload, start/stop, config, modifica profilo |

Due idee guida:

1. **La dashboard locale vive DENTRO l'app desktop** (una finestra che carica la view locale) → l'utente **non apre mai più `localhost:3000` in un browser normale**. Sul browser "nudo" si vede **solo** la dashboard cloud (Supabase, read-only + corsia richieste). Questo elimina l'ambiguità "quali dati vedo / dove scrivo" alla radice: una data istanza in esecuzione è **una modalità sola, sempre**.
2. **La sincronizzazione dati non è più continua.** All'accesso parte **una** sync; mentre navighi **niente polling**; se vuoi dati freschi premi **"Sync now"** → un flag su Supabase fa pushare la VPS. L'**unico** processo che fa polling continuo è la **VPS** (uno per utente, a cadenza adattiva), non i client web (che scalano male con il numero di utenti).

---

## Perché ora (il problema)

1. **Confusione dato locale vs cloud.** Oggi la stessa dashboard è raggiungibile sia su `localhost:3000` (browser, dati locali) sia su Vercel (browser, dati Supabase). Per l'utente sono indistinguibili → "quali dati sto guardando? le scritture dove vanno?". Le scritture (ticket, messaggi) peggiorano l'ambiguità.
2. **Spreco di "azioni" sul cloud.** Storicamente il sync era troppo aggressivo (push frequente VPS→cloud + polling client) → ha saturato Supabase (incident RobertHalf, 2026-05-19). Decimato a maggio, ma **resta polling client** (banner sync 30s, org-chart 5–10s, analista 8s, sentinella 30s) che **scala male**: moltiplicato per N utenti = troppe azioni.
3. **Event-log fossile (bug osservato 2026-06-20).** Il feed "Attività recente" legge `position_transitions`; la tabella cloud **esiste** (mig 044) ma **nessuno la popola** → mostra l'ultimo backfill manuale ("6 giorni fa") mentre il team ha lavorato un'ora fa. È la prova concreta del gap di sync sull'event-log.

---

## Il modello

### Piano 📊 Dati — sync on-access + pulsante, zero polling

```
   BROWSER (cloud)                 SUPABASE                      VPS / container
 ┌──────────────┐               ┌──────────────┐              ┌──────────────────┐
 │ apri dashbd  │──bump flag───►│ sync_request │◄──long-poll──│ request-puller   │
 │  o "Sync now"│   (1 write)   │  _at = now() │   (adattivo) │  vede flag→push  │
 │              │               │              │              │        │         │
 │  refetch ◄───│◄──read data───│  positions,  │◄──push delta─│  (idempotente)   │
 │  (1 volta)   │               │  scores, …,  │   one-way    │                  │
 │              │               │  transitions │              └──────────────────┘
 └──────────────┘               └──────────────┘
   NIENTE polling continuo        mirror read-only            unico poller continuo = VPS
```

Regole:

- **All'accesso** (mount della dashboard cloud, utente loggato): un **singolo** write `sync_requested_at = now()` su una tabella di rendezvous → la VPS lo vede e fa un push fresco → la dashboard fa **un** refetch quando vede `sync_completed_at` aggiornato (attesa **limitata**, es. ~10s poi stop; nessun loop infinito).
- **Mentre navighi:** nessuna sync, nessun polling. La vista resta ferma finché non premi "Sync now".
- **Pulsante "Sync now"** (visibile sul cloud, non solo desktop): stesso meccanismo del bump on-access, on-demand.
- **Lato VPS:** un solo poller a **cadenza adattiva** (5s attivo / 30s idle / 120s deep-idle) osserva il flag e la corsia richieste. Il push resta **delta-only + idempotente**. Niente più push "ogni 30s a prescindere": la VPS pusha **quando c'è una richiesta di sync** (on-access/bottone) o un cambiamento significativo debounced + un heartbeat lento di sicurezza.
- **Costo a scala:** N utenti che aprono la dashboard = N bump (1 write ciascuno) + N push VPS (uno per utente, debounced). Ordini di grandezza sotto il polling 5s × N client di oggi.

**Event-log nel piano dati.** `position_state_transitions` (jobs.db) → `position_transitions` (Supabase, mig 044) entra nel push delta come le altre tabelle, con la UNIQUE `(user_id, position_legacy_id, ts, by_agent, to_state)` che rende il push **idempotente** (ri-push non duplica). Chiude il bug dell'event-log fossile.

### Piano 🎫 Richieste — async, pull-based

L'utente, **anche dal browser cloud**, scrive richieste in **tabelle dedicate** Supabase; la VPS le **pulla**, le elabora, scrive i risultati nel piano dati, e l'utente li rivede al sync successivo. Async e pull-based ⇒ niente comandi real-time, niente saturazione.

| Richiesta | Tabella / campo cloud | Stato oggi |
|---|---|---|
| Ticket testo libero (es. "trovane di simili", "questa è scaduta") | `position_tickets` (mig 043) | tabella + route web ✅ · **pull VPS ⛔** · **consumo Capitano ⛔** |
| Like / dislike / commento / score / direzione | `position_feedback` (mig 019) | ✅ end-to-end (Scorer legge on-demand) |
| Escludi posizione (reversibile) | `positions.user_excluded_*` (mig 041) | route ✅ · pull VPS da verificare |
| "Scrivimi il CV" | `positions.write_requested` (mig 024) | ✅ (pull-desired-state) |
| Geocode on-demand | `positions.geocode_requested` | ✅ (pull-desired-state) |
| Recheck on-demand | `positions.recheck_requested` (mig 042) | ✅ (pull-desired-state) |

**Gap da chiudere** per completare la corsia:
1. **Pull VPS di `position_tickets`** dal cloud → SQLite locale (oggi `pull-desired-state` tira i flag `*_requested` ma **non** i ticket testo libero). Mig 043 lo dichiara esplicitamente un follow-up.
2. **Cablare il Capitano** a consumare i ticket (`ticket.py list-open` → assign → l'agente risolve con `response_text`). Lo script CLI esiste, ma il prompt del Capitano non lo invoca nel loop.
3. La risposta del team (`response_text`, dati aggiornati) torna all'utente via il piano dati (push) → visibile in pagina.

### Piano 🎛️ Interazione — solo desktop

Tutto il resto (chat agenti real-time, upload documenti, start/stop team, config/credenziali, **modifica** profilo) vive **solo** nell'app desktop:

- **Locale:** la dashboard è una finestra dell'app desktop puntata alla view locale; le scritture vanno a SQLite, il team è su `localhost`.
- **VPS:** stessa finestra puntata alla **porta di un tunnel SSH** → si interagisce con il team remoto *come fosse locale* (vedi `[JHT-VPS-TUNNEL]`).

Principio (già in BACKLOG): **read-only sul web ⟺ l'azione esiste sul desktop.** Niente comando team / chat / config dal browser cloud.

> **Profilo:** sul web al massimo in **vista**; la **modifica** è solo desktop → così si evita del tutto un sync bidirezionale del profilo.

---

## La separazione delle due dashboard (una codebase)

Non servono due codebase — la repo resta una. Serve rendere la **modalità** una scelta **dura** (build/deploy), non un indovinello per-richiesta:

| | Dashboard **locale** | Dashboard **cloud** |
|---|---|---|
| **Dove** | dentro l'app desktop (finestra → view locale); VPS via tunnel | browser su `jobhunterteam.ai` (Vercel) |
| **Dati** | SQLite (`jobs.db`) | Supabase (mirror read-only) |
| **Auth** | nessun login | login Supabase |
| **Scrittura** | piena (chat, config, ticket, profilo…) | **solo** corsia richieste (ticket + azioni-posizione) |
| **Entry point** | **esclusivo** all'app desktop (no più `localhost:3000` nel browser) | esclusivo al browser |

Implementazione: una modalità `local` vs `cloud` decisa a build/deploy. Sul build **cloud** le route di **scrittura-dati/controllo** sono disabilitate (non solo 403 a runtime); le **uniche** scritture ammesse sono la corsia richieste. Le primitive esistono già (`requireLocalWrite()`, `isLocalOnlyMode()`, `localWorkspace()`, branch `queries.ts`) → siamo a ~70%, è **completare**, non costruire.

Il "wrapper desktop" è una `BrowserWindow` Electron puntata alla view locale servita dal container — riusa al 100% la UI Next.js esistente, zero riscrittura di pagine. (Da verificare in fase realizzativa: *come* viene servito il web locale oggi nel pacchetto desktop.)

---

## ☁️ Modello dati Supabase (chi sincronizza cosa, in che direzione)

| Tabella | Direzione | Meccanismo | Note |
|---|---|---|---|
| `positions` (+score/applications/highlights) | VPS→cloud | push delta-only (`updated_at`) | invariato |
| `position_transitions` (mig 044) | VPS→cloud | **NUOVO: aggiungere al push** delta, idempotente | chiude event-log fossile |
| `candidate_profiles` (+ normalizzate) | VPS→cloud | push event-driven | vista cloud; modifica solo desktop |
| `position_tickets` (mig 043) | cloud→VPS | **NUOVO: aggiungere al pull** | + cablare Capitano |
| `position_feedback` (mig 019) | cloud→VPS | pull on-demand (Scorer) | ✅ esiste |
| `positions.*_requested` (024/041/042) | cloud→VPS | `pull-desired-state` | ✅ esiste |
| rendezvous `sync_requested_at` / `sync_completed_at` | bidir. | **NUOVO**: bump dal web, ack dalla VPS | tabella/campi da definire (riuso `team_state` o tabella dedicata) |
| `sentinel_ticks` | — | rimosso dal push | invariato |

**Si ritira** (coerente con `[JHT-CLOUD-INTERACTIVE-RETIRE]`, ma con un'eccezione): il bus **real-time di controllo** (`team_state` start/stop + reconciler), la **chat** cloud (`user_to_agent_messages` + poller), `team_commands` legacy. **Eccezione (decisione 2026-06-20):** la **corsia richieste async** (ticket + azioni-posizione) **resta** sul cloud — non è il bus interattivo real-time, è un'event-queue che la VPS pulla con calma.

---

## ✅ Decisione risolta

Il design 2026-06-15 lasciava aperta (#5): *"da telefono/PC-lavoro l'unico canale di comando è Telegram/e-mail, il web resta solo vista?"*

**Risposta (2026-06-20): NO al Telegram-only.** Il web cloud mantiene una **corsia di richieste async** (ticket + azioni-posizione leggere), pull-based dalla VPS. Resta escluso dal web cloud **solo** ciò che è real-time/controllo (chat, start/stop, config). Questo è coerente con `[JHT-WEB-READONLY]` punto **(1b)** già in BACKLOG ("azioni-posizione leggere RESTANO cloud").

---

## 🛠️ Piano a fasi

| Fase | Cosa | Dimensione | Deploy |
|---|---|---|---|
| **1 — Event-log sync** | cablare `position_transitions` nel push (CLI daemon + route `push` + delta cursor, idempotente). Nessuna migration nuova (tabella già esiste). Chiude il bug dell'event-log fossile. | 🟢 piccola, isolata | gated utente |
| **2 — Corsia richieste completa** | pull VPS di `position_tickets` (estende `pull-desired-state` o nuovo pull) + cablare il Capitano a `ticket.py list-open`/assign + l'agente risolve. | 🟡 media | gated utente |
| **3 — Sync on-access + "Sync now" + stop polling** | rendezvous `sync_requested_at`/`completed_at`; bump al mount + bottone cloud; rimuovere il polling client continuo; VPS push trigger-based + heartbeat lento. | 🟡 media | gated utente |
| **4 — Dashboard split duro** 🟡 *in corso* | modalità `local`/`cloud` a build; cloud = scrittura-dati disabilitata (solo corsia richieste); spostare la dashboard locale **dentro l'app desktop** (wrapper) → stop `localhost:3000` nel browser. | 🔴 grande | gated utente |
| **5 — Ritiro bus real-time cloud** | freeze/rimozione `team_state` control + reconciler + chat poller + `team_commands` (NON la corsia richieste). | 🟡 media | dopo 3+4 in prod |

Ordine non rigido. **Fase 1** è scorporabile subito ed è la più sicura (solo piano dati, direzione lettura, idempotente).

### Stato Fase 4 (aggiornato 2026-06-21)

Implementato su `dev4` (deploy gated all'utente, mai sui team in osservazione):

- **Deploy-mode DURO a build** — `web/lib/deploy-mode.ts`: `getDeployMode()` / `isCloudDeploy()` / `isLocalDeploy()`. Sorgente `NEXT_PUBLIC_JHT_DEPLOY` (`cloud` | `local`), client-safe; fallback solo server `VERCEL`→`cloud`; default `local`. La stessa immagine Docker (PC locale **o** VPS via tunnel) è co-locata → `local`; solo il deploy Vercel è `cloud`. Stesso pattern "default sicuro + override env" di `getSupabaseConfig()`.
- **Cloud = read-only a build** — `requireLocalWrite()` su `isCloudDeploy()` ritorna **sempre** 403 `read_only`, a prescindere dagli header (deterministico, non più solo host-based). La **corsia richieste** (ticket/feedback/user-exclude/`*_requested`) e il rendezvous `team-state` (Sync-now) **non** passano da `requireLocalWrite` → restano cloud, come da modello.
- **Client senza round-trip** — `useIsCloud` legge il flag di build quando presente (zero fetch); se l'env manca ricade sul vecchio `/api/local/sync/status` → nessuna regressione finché Vercel non è configurato.
- **Wrapper desktop** — `desktop/main.js`: `openDashboardWindow()` apre la view locale in una `BrowserWindow` Electron dedicata invece di `shell.openExternal(localhost:3000)`. Riuso finestra, popup/`target=_blank`→browser di sistema, navigazioni top-level in-finestra (SPA + eventuale OAuth), fallback a openExternal, chiusura su Stop. Invocato **solo** dal ramo locale (`openRuntimeInBrowser`); la modalità VPS resta su openExternal verso il cloud finché non arriva `[JHT-VPS-TUNNEL]`.

**Azione utente / deploy:** impostare `NEXT_PUBLIC_JHT_DEPLOY=cloud` nelle env del progetto Vercel (il fallback `VERCEL`→cloud copre il server ma il client cadrebbe sul fetch legacy); l'immagine Docker non richiede env (default `local`). Test runtime del wrapper desktop a carico utente (`npm run desktop:dev` o build packaged).

- **UI read-only sul cloud** (commit `1530430c7` + `32d28df48`) — a livello **pagina/sezione**, non a bottoni sparsi. **(a)** Guard unico in `(protected)/layout.tsx`: su `isCloudDeploy()` le pagine di pura config/controllo (`settings`/`credentials`/`secrets`/`channels`/`providers`/`integrations`/`cron`/`backup`/`setup`/`cli-link`) reindirizzano a `/dashboard` (eccezione `settings/cloud-sync`); `UserMenu` nasconde i relativi link. **(b)** Pagine miste: resta il monitoraggio/vista, sparisce la sola sezione-controllo — `/team` start/stop + azioni per-agente; `AgentInteraction` (chat+terminale condiviso) → `null` su cloud + stop polling; chat composer di capitano/assistente; `/profile` view-only (`ProfileEditButton`+`ProfileAssistantFab` nascosti, export resta). La sicurezza resta a monte (route 403); questa è rifinitura UX (niente vicoli ciechi).

**Residuo minore:** bottoni secondari nelle pagine miste (pulisci-chat, apri/toggle-terminale di capitano/assistente) — innocui sul cloud (agiscono su dati locali assenti), nascondibili con lo stesso pattern se si vuole.

---

## 🔗 Riferimenti

- `2026-06-15-interaction-planes-redesign-design.md` — il modello a piani (questo doc ne risolve la decisione #5)
- `cloud-sync-architecture.md` — meccanismo push/pull, incident history, stato implementazione lane
- `BACKLOG.md` — `[JHT-INTERACTION-PLANES]`, `[JHT-WEB-READONLY]` (1b), `[JHT-DESKTOP-COCKPIT]`, `[JHT-VPS-TUNNEL]`, `[JHT-CLOUD-INTERACTIVE-RETIRE]`
- `supabase/migrations/044_position_transitions.sql` — tabella event-log cloud (schema pronto, push da cablare)
- `supabase/migrations/043_position_tickets.sql` — tabella ticket (pull VPS = follow-up dichiarato)
- `web/app/api/cloud-sync/push/route.ts` · `cli/src/commands/cloud.js` — punti dove cablare il push transitions
- `web/app/api/cloud-sync/pull-desired-state/route.ts` — pull dei flag; da estendere ai ticket
- `shared/skills/ticket.py` · `agents/capitano/capitano.md` — CLI ticket esistente · prompt da cablare
