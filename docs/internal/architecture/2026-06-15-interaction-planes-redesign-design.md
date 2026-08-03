# Interaction Planes — Redesign (2026-06-15)

> **Design / decision doc.** Sposta l'**interazione** col team fuori dal web cloud, sul **desktop**. Il web diventa una **dashboard di sola lettura**, con una sola capacità di sicurezza stop-only per le emergenze da telefono. **Telegram** torna **opzionale**. La **VPS** si interagisce *come fosse locale* via **tunnel SSH**.
>
> **Status: PROPOSTA** — ordina la visione utente del 2026-06-15 (post beta-test). Da validare prima di implementare. Ribalta una fetta del refactor cloud "desired-state" shippato fine maggio: **leggere § "Cosa si ritira" con attenzione**.
>
> Supersede la memoria `web-first-interaction-roadmap` (2026-05-23) e le voci interactive di `cloud-sync-architecture.md`.
>
> 🔄 **Raffinato 2026-06-20** da [`2026-06-20-data-sync-and-dashboard-split-design.md`](2026-06-20-data-sync-and-dashboard-split-design.md): la **decisione aperta #5 è risolta** (il web cloud NON è Telegram-only — mantiene una **corsia richieste async**, ticket+azioni-posizione, pull-based dalla VPS); inoltre quel doc definisce il meccanismo di **sync dati** (on-access + pulsante, niente polling) e la **separazione dura delle due dashboard** (locale dentro l'app desktop · cloud nel browser).
>
> 🪦 **SUPERATO in parte 2026-07-23 (native desktop migration, commit `32225cb7`):** la "dashboard locale" NON è più una pagina web servita dal container su `localhost:3000` (né embeddata via `<webview>`, né aperta nel browser). **Tutta l'interazione local/VPS vive nell'app desktop nativa (il gioco)**, che legge i dati via `docker exec` (local) o SSH (VPS) — il server Next.js locale è stato ritirato e il container non espone porte. Il **browser è solo cloud** (`jobhunterteam.ai`, con login). Restano validi i principi: interazione co-locata col team, cloud read-mostly, Telegram opzionale.

---

## TL;DR

Una sola idea: **l'interazione col team è SEMPRE co-locata col team**; la **visualizzazione** dei dati è ovunque (read-only).

Da qui due piani netti:

| Piano | Direzione | Dove vive | Cosa contiene |
|---|---|---|---|
| 📊 **Dati** | one-way `team → … → utente` | **2 modi, stessi dati, stessa UI:** ① web **online** (`jobhunterteam.ai`, login → Supabase) ② **local-only** (niente login, dashboard su `localhost` dal desktop → legge `jobs.db`) | positions, scores, map, case-studies — **sola lettura** |
| 🎛️ **Interazione** | two-way `utente ↔ team`, **diretta e co-locata** | **app desktop** (+ Telegram async opzionale) | chat, upload documenti, start/stop, like/dislike, "scrivi CV" |

> **Local-only è una feature, non un ripiego (precisazione utente 2026-06-15):** non vogliamo **costringere** l'utente a loggarsi sulla nostra piattaforma. Deve poter fare **tutto in locale** — l'app desktop avvia la dashboard su `localhost` che legge il DB locale, **senza Supabase e senza login**. Chi vuole la vista da telefono/PC-lavoro fa il login online. Due strade per gli **stessi dati**.

- **Locale** → l'app desktop parla al team su `localhost`.
- **VPS** → l'app desktop apre un **tunnel SSH** e parla allo *stesso* stack che gira sulla VPS: il team remoto si comporta esattamente come quello locale.
- **Telegram** → canale async **opzionale** per quando sei lontano dal desktop (consigliato, non obbligatorio). In alternativa: e-mail.

Conseguenza diretta (il motivo del cambio): si **smette di costruire** il "web cloud interattivo" — niente più chat/comandi/sincronizzazione-live del team via Vercel→Supabase→VPS. È il "lavoro inutile" che il beta-test ha rivelato.

## Mobile: PWA di stato + STOP, Telegram-first per il resto (decisione 2026-08-03)

M2 non riapre il command bus del browser. Sul telefono servono due tempi diversi:

- **guardare e reagire a un'emergenza:** la PWA/dashboard è il percorso più affidabile, perché è già autenticata, non richiede di configurare Telegram e rende evidente lo stato osservato;
- **conversare e dare istruzioni asincrone:** Telegram resta il percorso mobile-first consigliato, con il cockpit desktop/tunnel come superficie completa.

L'inventario delle route necessarie da mobile è quindi deliberatamente corto:

| Route | Metodo | Capacità mobile | Scrittura |
|---|---|---|---|
| `/team` | GET | attività, stato desired/observed, heartbeat e bacheca | no |
| `/api/team-state` | GET | stato aggiornabile su richiesta | no |
| `/api/team-state/emergency-stop` | POST | porta esclusivamente `should_run` a `false` | sì, stop-only |
| route dati (`/dashboard`, `/positions`, `/map`, `/team/log`) | GET | dashboard consultabile | no |
| Telegram | canale async | conversazione e istruzioni lontano dal desktop | secondo il contratto dei bot |

Non sono route mobile: `/api/team/command`, le route shell degli agenti, start,
restart, configurazione, terminale e upload arbitrario. Restano nel cockpit
desktop, locale o sopra il tunnel SSH.

### Contratto dello STOP d'emergenza

La route richiede la sessione Supabase del browser, il CSRF same-origin del
middleware e un bucket dedicato di 3 richieste/minuto per utente. Accetta solo
il body esatto `{"confirm":"STOP"}` e fa un upsert idempotente di
`team_state.should_run=false` più un nuovo `emergency_stop_requested_at`. Non
accetta action, target, argomenti o testo da inoltrare. Il device chiude il
rendezvous con `emergency_stop_completed_at`, così un secondo stop dopo una
ripartenza locale è un evento nuovo e non resta confuso col primo.

Il daemon associato legge la stessa riga già usata per i rendezvous sync/chat.
Solo `should_run === false` con una richiesta valida non ancora completata
esegue il comando hard-coded `jht team stop`; nessun dato web entra nella shell. Con
Realtime la richiesta arriva come evento, con il poll esistente come
paracadute. Lo start resta volutamente impossibile dal cloud: uno STOP rubato è
recuperabile dal proprietario, uno START rubato consumerebbe budget e
riattiverebbe processi senza presenza fisica.

---

## Contesto / perché ora

Durante i beta-test sono emersi due fatti:

1. **Il setup è troppo complicato per l'utente medio.** Non tanto la VPS (copia IP + chiave SSH sono pulsanti dell'app desktop) — quanto l'accumulo di passaggi obbligatori, su tutti **Telegram come gate**.
2. **Rendere il web *cloud* interattivo costa tantissimo lavoro fragile.** Far parlare il browser su Vercel col team su una VPS richiede un bus bidirezionale "desired-state" (long-poll, reconciler, lane multiple, single-team enforcement, latenza, killswitch…). Tanto codice, tanti edge-case, per un valore che si ottiene meglio in altro modo.

La scelta di prodotto: **il web non serve a comandare il team, serve a guardarlo.** Chi comanda lo fa dal desktop (locale o via tunnel) o, da lontano, via Telegram/e-mail.

Questo è anche **coerente con la VISION** (anti-SaaS, "il team vive dentro il tuo laptop", "colleghi nel tuo computer"): un cockpit desktop è *più* in linea della dashboard-SaaS-interattiva.

---

## Il modello: due piani

### Principio guida

> **L'interazione passa sempre da un percorso diretto e co-locato: `web-backend → tmux`, sullo stesso host del team.**

Oggi questo percorso esiste già e funziona **in locale**: la UI web servita dentro il container (`localhost:3000`) manda i messaggi al team con `tmux send-keys` (vedi `web/app/api/capitano/chat/route.ts`). L'app desktop *è già* la finestra-browser su quel `localhost`.

La novità è generalizzarlo:

```
 LOCALE                          VPS (nuovo)                      LONTANO DAL DESKTOP
 ┌─────────────┐                 ┌─────────────┐                  ┌─────────────┐
 │ App Desktop │                 │ App Desktop │                  │  Telefono   │
 └──────┬──────┘                 └──────┬──────┘                  └──────┬──────┘
        │ browser → localhost:3000      │ SSH -L  → localhost:NNNN        │ Telegram (async, opz.)
        ▼                               ▼  (tunnel)                       ▼
 ┌─────────────┐                 ┌─────────────┐                  ┌─────────────┐
 │ Web (cont.) │                 │ Web (su VPS)│                  │  tg-bridge  │
 │  → tmux     │                 │  → tmux     │                  │  → tmux     │
 └─────────────┘                 └─────────────┘                  └─────────────┘
   stesso identico stack di interazione, co-locato col team
```

### Il piano dati ha DUE modalità di accesso (no login forzato)

La **stessa app Next.js** serve la dashboard in due contesti, decisi a runtime — **è già così** (verificato, vedi § "Cosa esiste già"):

- **① Online (cloud):** su Vercel/`jobhunterteam.ai`, l'utente fa login, la UI legge **Supabase** (mirror dei risultati pushati one-way dal team). Vista da telefono/PC-lavoro.
- **② Local-only:** l'app desktop avvia la **stessa** dashboard su `localhost:3000` dentro il container; con `cloud.json.enabled=false` la UI **bypassa Supabase e l'auth** e legge **diretto `jobs.db`** locale. **Niente login, niente piattaforma.**

Il branch è già nel codice: `web/lib/queries.ts` instrada `if (localRequest && workspaceHasDb) → local-queries` altrimenti → Supabase; `middleware.ts` bypassa l'auth per host `localhost`; `(protected)/layout.tsx` salta `supabase.auth.getUser()` quando `isLocalOnlyMode()`. **UI condivisa, cambia solo la sorgente dati.**

Il daemon push (`jht cloud daemon`) alimenta la modalità ① (one-way su Supabase). La modalità ② non ha bisogno di nulla di cloud. **È tutto ciò che il piano dati deve fare.**

---

## Cosa cambia rispetto alle decisioni già bakate

| Tema | Prima (bakato) | Dopo (2026-06-15) | Riferimento (sezione) |
|---|---|---|---|
| Web | GUI operativa nel browser, intenzioni utente cloud→container | **Dashboard sola lettura** (online o local-only); l'operatività è desktop | ROADMAP § Stack decisions + § Cloud sync direction |
| Desktop | "launcher only, not the interaction interface" | **Launcher + cockpit di interazione** | ROADMAP § Stack decisions; BACKLOG § Product Vision (Stack) |
| VPS | interazione via cloud desired-state bus | **interazione via tunnel SSH** (come locale) | ROADMAP § Phase 3; cloud-sync-architecture |
| Telegram | **3 bot obbligatori** in onboarding | **consigliato, opzionale/skippabile** | ROADMAP § Telegram; BACKLOG `[JHT-TELEGRAM-OPTIONAL]` |
| Cloud sync | ibrido push + bidirezionalità desired-state | **solo push dati one-way** (interattivo ritirato) | ROADMAP § Cloud sync direction |

---

## ✅ Cosa esiste GIÀ (verificato 2026-06-15, file:line)

Buona parte del modello **è già implementata** — questo riduce il lavoro a *completare + ritirare*, non *costruire da zero*.

- **One-codebase-two-contexts — CONFERMATO.** La stessa app Next.js gira su Vercel (Supabase+login) e nel container su `localhost` (SQLite, no login). Branch a runtime: `web/middleware.ts` (bypass auth se host=localhost), `web/lib/workspace.ts::isCloudEnabled()/isLocalOnlyMode()/workspaceHasDb()`, `web/lib/queries.ts::ws()` (instrada local vs Supabase). `IS_CONTAINER=1` + `JHT_HOME=/jht_home` nel Dockerfile; porta bindata `127.0.0.1:3000:3000`.
- **Local-only mode — GIÀ FUNZIONANTE** (`[JHT-LOCAL-NO-API]` DONE 2026-05-31, commit `193d06fd`). `web/lib/local-queries.ts` copre ~30 funzioni (positions/scores/applications/stats/map/messages) leggendo `jobs.db` read-only via `better-sqlite3`. `(protected)/layout.tsx`, `dashboard`, `map`, `positions` già local-aware.
- **Desktop = control panel — GIÀ MOLTO COMPLETO.** Avvia container + dashboard localhost + apre browser (`desktop/main.js:396` `launcher:open-browser`, porta 3000, attende `/api/health`); **start/stop team** (`launcher:start|stop`); **cambia provider** Claude/Codex/Kimi post-setup dalla Home (`home.js:946`, persiste in `providers.json` → `syncJhtConfig`); **guest mode / login opzionale** in locale (skip Supabase visibile; sync gated dietro login) (`wizard-flow.js:128-170`, `home.js:191-227`).

## Stato attuale vs gap (per pilastro)

### A. Web read-only / differenziazione dati

- **Dove siamo:** la differenziazione **local vs cloud per i DATI è già fatta** per le pagine core (dashboard/map/positions + layout): leggono SQLite in local-only, Supabase online, **stessa UI**. Le primitive ci sono (`workspace.ts`, `queries.ts`, `middleware.ts`). Resta interattivo solo ciò che NON è dato: pagine chat `team/capitano|assistente`, ~11 route di controllo, bus desired-state.
- **Cosa manca (gap reali, verificati):**
  1. **Pagine `team/*` non local-aware** (`team/page.tsx`, capitano/assistente/analista/scorer/critico/sentinella) → usano `createBrowserSupabase` diretto → **si romperebbero in local-only**. Vanno: la parte *vista* resa local-aware (read-only su SQLite), la parte *interazione* (chat capitano/assistente) spostata sul cockpit desktop.
  2. **Coerenza `profile/page.tsx`** → usa `isLocalRequest()` invece di `isLocalOnlyMode()` (funziona ma incoerente).
  3. **Schema template `web/lib/db.ts`** manca 7 colonne (`status_changed_at`, `last_actor`, `office_lat/lon/address/geocoded`, `is_remote`) → un workspace creato *dalla web* fallirebbe su map/coords; quelli creati da CLI sono ok. Da allineare.
  4. **Gating write su cloud:** su Vercel le route di controllo non sono ancora 403-gated (oggi funzionano "per assenza di host locale", non per scelta).
- **Nota onesta:** ritirare il path interattivo cloud **congela/ritira** parte del refactor desired-state di fine maggio (vedi § dedicato).

### B. Desktop come cockpit (team LOCALE)

- **Dove siamo (più completo del previsto):** l'app desktop è **già il pannello di controllo**: avvia container + dashboard localhost + apre browser (`main.js:396`), **start/stop team**, **cambia provider** post-setup (`home.js:946`), **guest mode / login opzionale** (`wizard-flow.js:128`). La UI web nel container ha già **chat** (capitano/assistente) e **upload** (`/api/assistente/upload`, 10MB) via `HTTP → tmux send-keys`, persistenza `chat.jsonl`. **La chat locale di fatto già c'è**, inquadrata come "browser su localhost".
- **Cosa manca:** (1) chat di **prima classe** nell'app (decisione: tenere browser-to-localhost vs UI nativa); (2) **tutta** l'interazione **senza Telegram** end-to-end; (3) rifinitura UX (chat, upload, notifiche native, tray); (4) un punto su cui il desktop è ancora debole: **re-auth provider** e preferenze persistenti (oggi via wizard).

### C. Desktop ↔ VPS interattivo via tunnel SSH — **il grosso del lavoro nuovo**

- **Dove siamo (verificato):** il desktop **provisiona** la VPS via SSH (gen chiavi Ed25519, paste IP, install one-shot `install.sh` + pairing-token) ma **non c'è canale interattivo né persistente** (`desktop/vps/ssh-exec.js` è one-shot). In modalità VPS il desktop apre la **dashboard CLOUD** (`jobhunterteam.ai/dashboard`) → quindi oggi per vedere i dati del team VPS **serve il login cloud**. I lifecycle button (pause/snapshot/destroy) **NON** sono nel desktop: sono route **web** (`/api/vps/*` + `web/lib/hetzner.ts`).
- **Implicazione local-only (precisazione utente):** col tunnel SSH non si sblocca solo l'**interazione**, ma anche la **visualizzazione local-only del team remoto**: `ssh -L` → dashboard su `localhost` servita dal container **sul VPS** → legge il `jobs.db` *del VPS* → **stessa esperienza local-only, senza login cloud**, anche per una VPS. Il login online resta un'**opzione** (vista da telefono), non un obbligo.
- **Cosa manca (la carne):**
  1. **SSH tunnel manager** nel desktop: `ssh -i <key> -L <localport>:localhost:3000 root@<ip>` con keep-alive + auto-reconnect.
  2. Puntare la **finestra/chat del desktop** su `localhost:<localport>` → si riusa **al 100%** lo stack di interazione locale, ma eseguito **sulla VPS** (la web-backend sulla VPS fa `tmux send-keys` sul tmux della VPS).
  3. **Terminale remoto** opzionale: `ssh -t root@<ip> tmux attach -t CAPITANO`.
  4. **Upload** via tunnel (la route upload scrive su FS locale → sul lato VPS funziona attraverso il tunnel) o SCP.
  5. **Live updates**: già serviti dalla web sulla VPS — niente bus cloud.
- **Payoff:** la VPS diventa "**locale over SSH**" e si **elimina il bus cloud interattivo** anche per il controllo. **Unifica** con il *"Dedicated computer mode"* (PC in LAN via SSH/mDNS — ROADMAP § Phase 2): è la **stessa** tecnologia di tunnel.
- **Decisione tecnica aperta:** SSH `-L` raw **vs** Tailscale/WireGuard (la ROADMAP § Phase 3 già cita Tailscale come "planned").

### D. Telegram opzionale

- **Dove siamo:** già **opzionale in LOCALE**; **obbligatorio solo nel path VPS** del wizard, in **2 punti**: `cli/wizard/setup.js:258-265` (`if (isVps) promptTelegramRequired`) e `desktop/renderer/modules/wizard-flow.js:775-841`. Boot (`agent-watchdog.sh`) e runtime (`tg-bridge.py` esce pulito se non configurato) **già tollerano** l'assenza. L'onboarding dell'Assistente funziona senza Telegram (web/file-drop).
- **Cosa manca:** trasformare i 2 gate VPS in **"consigliato + skip"**. Lavoro **piccolo e ben circoscritto**. Aggiornare la copy in ROADMAP/BACKLOG ("3 bot obbligatori" → "consigliati, skippabili").

### E. Setup local-first

- **Dove siamo:** setup già abbastanza snello (one-liner + wizard). La ROADMAP marca il Local PC come "works but not recommended for daily machines".
- **Cosa manca:** **rielevare il Local PC** a path di prima classe ("il team è tuo, lo accendi/spegni quando vuoi"). Si incastra con il *Dedicated computer mode* (PC dedicato in casa, stesso tunnel SSH del VPS). Il setup VPS resta com'è (accettabile per l'utente).

---

## Cosa si RITIRA / congela (la riduzione di lavoro)

Una volta che l'interazione è desktop + tunnel, il **path cloud interattivo** diventa ridondante. Candidati a **freeze/ritiro** (scope esatto da decidere in implementazione — *freeze* ≠ *delete*):

- bus **desired-state per il controllo** (`team_state.should_run/agents_enabled` + reconciler) usato dal **web cloud** per start/stop;
- lane **`user_to_agent_messages`** (chat web cloud → tmux VPS) + `user-messages-poller`;
- lane **`position_feedback`** come roundtrip cloud (il like/dislike si fa dal desktop, diretto);
- flag `*_requested` (`write_requested`, `geocode_requested`) come **roundtrip cloud** + `pull-desired-state` (il bottone "scrivi CV" sul desktop colpisce diretto la web della VPS via tunnel);
- legacy **`team_commands`** (già in cutover).

**Resta** (è il piano dati, one-way, già solido):

- daemon **push** `team → Supabase` (positions/scores/applications, delta-only, tombstones);
- **`jht cloud restore`** / bootstrap pull di soli **dati** su container vuoto;
- la **dashboard read-only** che legge da Supabase.

> ⚠️ **Heads-up onesto:** questo ribalta una parte consistente di codice shippato 23–31 maggio (refactor `team_state`, writer-on-demand cloud-side, `pull-desired-state`, i 4 reader container). È *il punto* — il beta-test ha mostrato che quel percorso costa troppo per il valore — ma la scelta **freeze-vs-delete** va fatta con gli occhi aperti, pezzo per pezzo. Niente va cancellato in questo doc.

---

## Piano a fasi (proposta di sequenza)

| Fase | Cosa | Dimensione | Dipendenze |
|---|---|---|---|
| **I — Telegram opzionale** | 2 gate VPS → "consigliato + skip"; aggiorna copy | 🟢 piccola | nessuna |
| **II — Web read-only gating** | split per contesto deploy: route di controllo 403 su cloud, bottoni nascosti; riusa `isLocalRequest/isLocalOnlyMode` | 🟡 media | decisione "cosa ritirare" |
| **III — Desktop cockpit (locale)** | chat locale di prima classe + path 100% no-Telegram + UX | 🟡 media | II |
| **IV — Desktop ↔ VPS tunnel SSH** | tunnel manager + punta il cockpit a `localhost:<tunnel>` + terminale/upload remoti | 🔴 grande (lavoro nuovo) | III; decisione SSH-raw vs Tailscale |
| **V — Ritiro path cloud interattivo** | freeze/rimozione lane + reconciler + poller ridondanti | 🟡 media | II + IV in produzione |

L'ordine non è rigido: I è scorporabile subito; IV è il pezzo che porta il valore "VPS come locale".

---

## Decisioni aperte (per l'utente)

1. **Chat desktop:** tenere "**browser su localhost**" (riusa tutto, zero riscrittura) o **UI nativa** Electron? — *raccomando browser-to-localhost*, almeno per la beta.
2. **Tunnel VPS:** **SSH `-L` raw** vs **Tailscale/WireGuard**? (impatta robustezza/NAT/UX).
3. **Quanto ritirare ORA** del path cloud interattivo: **congelare** e basta, o **rimuovere** i pezzi ridondanti?
4. **Unificare** "Dedicated computer mode" (LAN) e "VPS" sotto lo **stesso** tunnel SSH? (raccomando sì).
5. ~~**Away-interaction:** confermi che da telefono/PC-lavoro l'unico canale di *comando* è **Telegram/e-mail** (il web resta solo vista)?~~ → **RISOLTA 2026-06-20: NO.** Il web cloud mantiene una **corsia richieste async** (ticket + azioni-posizione, pull-based dalla VPS); restano fuori dal cloud solo chat/start-stop/config. Vedi [`2026-06-20-data-sync-and-dashboard-split-design.md`](2026-06-20-data-sync-and-dashboard-split-design.md).

---

## Riferimenti

- `docs/about/ROADMAP.md` — § "🔀 Direction shift" (callout), § Telegram, § Cloud sync direction
- `BACKLOG.md` — `[JHT-INTERACTION-PLANES]` + `[JHT-WEB-READONLY]` + `[JHT-DESKTOP-COCKPIT]` + `[JHT-VPS-TUNNEL]` + `[JHT-TELEGRAM-OPTIONAL]`
- `docs/internal/cloud-sync-architecture.md` — le sue parti *interactive* sono superate da questo doc
- `web/lib/workspace.ts` — `isLocalRequest()` / `isLocalOnlyMode()` (primitive per il gating)
- `web/app/api/capitano/chat/route.ts` — il percorso `HTTP → tmux send-keys` già esistente
- `desktop/vps/ssh-exec.js` — base SSH oggi one-shot, da estendere a interattivo/tunnel
