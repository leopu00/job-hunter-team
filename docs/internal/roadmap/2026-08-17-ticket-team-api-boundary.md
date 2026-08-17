# `[JHT-TEAM-API-BOUNDARY]` — una piattaforma sola: il team espone una API, i client diventano sottili

**Data:** 2026-08-17 · **Base della misura:** worktree `master` a `dbd6369d6f`
**Stato:** aperto, direzione approvata dal direttore il 2026-08-17 · **forma tecnica da decidere misurando**
**ADR:** [`0009-team-exposes-one-loopback-api.md`](../../adr/0009-team-exposes-one-loopback-api.md) (Proposed)

> 📌 **Perché questo documento esiste.** La richiesta era «una piattaforma unica su
> web, desktop e telefono, anche al costo di riscrivere tutto». Misurando è venuto
> fuori che il problema non è quale framework: è che **il confine che teneva insieme
> le casistiche è stato rimosso nel 2026-07-23 come effetto collaterale**, e da
> allora ogni client si è scritto il proprio trasporto. Questo file misura il danno,
> nomina ciò che esiste già, e dice cosa va deciso con un numero invece che con una
> preferenza.

---

## 1. La richiesta, nelle parole di chi la pone

> «Una piattaforma unica usabile sia su web che desktop (i 3 OS) che su cel. La cosa
> difficile è che bisogna fare molte casistiche: se l'utente vuole il suo team in
> container sul suo PC → da app desktop parla col team tramite file sul PC e comandi
> app; se ha team su VPS ma ha app desktop → parla tramite SSH; se ha VPS e usa web
> parla tramite DB e socket; ecc.»

E il criterio: **non mantenere tre framework con casistiche incasinate**, decidere
linguaggi e framework «per poi andare lisci nel futuro».

## 2. La casistica non esplode — è già stata collassata una volta

`web/lib/deploy-mode.ts`, che documenta se stesso come il cuore di
`[JHT-DASHBOARD-SPLIT]`:

> `'local'` → container **CO-LOCATO** col team: PC dell'utente dentro l'app desktop,
> **oppure VPS via tunnel SSH**. SQLite source-of-truth, scrittura piena.
> **La STESSA immagine Docker vale per PC e VPS: entrambi sono co-locati → entrambi
> `'local'`.**

Cioè la matrice `(dove sta il team) × (che client uso)` non è una matrice:

| | Dati | Scrittura | Chi ci arriva |
|---|---|---|---|
| 🏠 `local` | SQLite = verità | piena | desktop → loopback **oppure** loopback dentro un tunnel SSH |
| ☁️ `cloud` | Supabase | sola lettura + corsia richieste async | browser, telefono |

**Una API · due modalità dati · tre trasporti.** E i trasporti non sono casistiche
applicative: sono venti righe l'uno, e l'applicazione non deve poterli distinguere.

Vale la pena notare che la matrice *cresce* se la si tiene esplicita:
`[JHT-DESKTOP-06]` (modalità «computer dedicato», JHT su un PC della LAN via
SSH/mDNS) è già in backlog e chiede esattamente di **unificarsi col percorso del
tunnel VPS**. Con il confine, è una voce di configurazione. Senza, è un quarto
backend.

## 3. Cosa è stato rimosso il 2026-07-23, e cosa è stato rimosso per sbaglio

Commit `303a6ec604`, messaggio integrale sul punto:

> «Il container continuava a servire la Next.js su 127.0.0.1:3000 e il gioco aveva
> ancora un pulsante che apriva il browser sulla landing con Sign in — **residui
> fuorvianti**. Il browser è solo cloud (jobhunterteam.ai, con login).»

Quel motivo **è ancora valido** e non va toccato. Ma nello stesso commit sono
cadute due cose diverse:

| Cosa | Giudizio |
|---|---|
| 🚫 Una **dashboard aperta nel browser** su `:3000` | giustamente ritirata, resta ritirata |
| ⚠️ **Qualunque confine API sul container** (`EXPOSE 3000`, `ports:`, `web/` nell'immagine) | effetto collaterale, ed è il buco di oggi |

Il `Dockerfile` conserva le due frasi che governano il seguito — riga 122: *«web/
NON è installato nel container […] Il web gira solo in cloud, buildato altrove»*
perché *«Next/React/eslint/tailwind, ~centinaia di MB, erano peso morto»*; riga 260:
*«Nessuna porta esposta»*. La seconda va rivista, **la prima no**: l'argomento del
peso non è stato ribaltato, va rispettato.

Nota di metodo: `[JHT-DESKTOP-07]` («il container serve `next start` invece di
`next dev`») fu chiuso *per superamento* proprio da quel commit. Questo ticket
riapre quel territorio, da un lato diverso.

## 4. Il costo del confine mancante — misurato 2026-08-17

| Client | Peso | Trasporto proprio |
|---|---|---|
| 🎮 `game/scripts/backend/` | **3.929 LOC** gd | `local_backend.gd` via `docker exec`, `vps_backend.gd` con **62** riferimenti ssh/tunnel |
| 🌐 `web/` | **142.437 LOC** tsx, 97 route | `local-queries.ts` (1.840) e `team-directives-local.ts` (225) scritti *per* il caso co-locato, deployati **solo** in `cloud` |
| ⌨️ `cli/` | **21.020 LOC** js | percorsi propri verso gli stessi dati |
| 👻 `tui/` | su disco, **0 file tracciati** | quinto client, non versionato |

E il buco che pesa più di tutti: **nel caso co-locato non esiste alcun canale
live.** Il Realtime è un websocket *diretto* browser↔Supabase;
`web/app/hooks/useChatLaneLive.ts` lo dice a chiare lettere — in local mode il
client è un mock senza `channel`, la SELECT torna errore, l'hook resta `null` per
costruzione. Il piano **Interazione** (chat, upload, start/stop, config) è l'unico
che ha bisogno del box, l'unico bidirezionale, ed è quello implementato tre volte.

## 5. Cosa esiste già — e non va riscritto

Questa è la ragione per cui «ricominciare da 0» costerebbe più di quello che rende.

| Pezzo | Dove | Stato |
|---|---|---|
| Lo **split duro** delle modalità | `web/lib/deploy-mode.ts` | implementato, deciso a build via `NEXT_PUBLIC_JHT_DEPLOY` |
| L'**auth locale** | `web/lib/local-token.ts` | 32 byte random in `~/.jht/.local-token`, canale `Bearer` vivo, usato da CLI/curl sul box |
| Il **gancio riservato** al guscio desktop | idem | il ramo cookie è tenuto **inerte di proposito**: *«resta perché il giorno che un setter lato Node servirà (browser del desktop nativo) è lì pronto»*, e `tests/js/tasks/local-token-cookie-claim.test.ts` fallisce se qualcuno lo scrive senza aggiornare il commento |
| L'**indirezione di trasporto**, in embrione | `web/lib/shell.ts` | `JHT_SHELL_VIA=docker:<container>` dirotta ogni `runBash`/`runScript` dentro il container: oggi host→container, il confine lo capovolge |
| Le **query del caso locale** | `local-queries.ts`, `db.ts`, `team-directives-local.ts` | 2.357 LOC già scritte per la modalità che nessuno esegue |
| Il **runtime** | `Dockerfile` | base `node:22-bookworm-slim`, e la build fa già `npm ci --prefix cli` → Node non è un costo nuovo |

Tre dei quattro pezzi ci sono, e **uno di essi contiene un commento che aspetta
esattamente questo consumatore**.

## 6. La stack che ne consegue — quattro strati

| Strato | Linguaggio | Cosa cambia |
|---|---|---|
| 🐍 Team | Python (9.901 LOC) | **nulla** |
| 🔌 API sul container | TypeScript | **è questo il lavoro**: 90% già scritto, va spacchettato dal peso di Next |
| ⚛️ UI | React, un albero, tre gusci — browser (Next) · desktop 3 OS · telefono | i gusci consumano solo la API |
| 🏢 Ufficio 2.5D | GDScript (12.296 LOC salvati) | pannello opzionale, non più il contenitore di tutto |

Il criterio che tiene il nativo sotto controllo: **il codice nativo serve solo dove
il dispositivo può ospitare un team.** Telefono: mai → client cloud puro, zero
nativo. Browser: mai → zero nativo. Desktop: sì → è l'unico posto con codice
nativo. Le casistiche non si moltiplicano per client.

**Conto dei linguaggi.** Dopo: TS (UI + API) · Python (agenti) · Rust (solo guscio
desktop) · GDScript (solo ufficio). Oggi: TS · Python · **GDScript che fa UI +
trasporto + SSH + setup, 69.254 LOC** · JS (CLI 21.020). Non se ne aggiungono: si
sposta GDScript-che-fa-tutto in GDScript-che-fa-l'ufficio.

## 7. Le quattro cose da decidere con una misura, non con una preferenza

1. **Peso dell'immagine.** `next build` standalone contro un server minimale
   (Hono/Fastify) che riusa `web/lib/`. Il numero da produrre è il **delta sull'immagine**,
   contro il riferimento noto: il container è già stato dimezzato 7,2 → 3,2 GB il
   2026-07-24, e quel dimezzamento è in parte *questo* taglio. Va rimisurato prima di
   scegliere, non stimato.
2. **Canale live.** SSE su `text/event-stream` attraverso lo stesso tunnel — la cosa
   più economica da provare — contro websocket. Da decidere **misurando la tenuta
   attraverso SSH**, non in astratto.
3. **Versionamento del contratto.** L'app desktop e l'immagine si aggiornano su
   binari separati; con `docker exec` lo scarto è tollerato in modo lasco, su HTTP è
   un disallineamento di protocollo. È la classe di guasto che ha già prodotto
   `[CHAT-LANE-SILENT-DROP-ON-OLD-CLIENT]`. L'handshake di versione appartiene alla
   **prima fetta**.
4. **Primo client.** Il CLI è la prova più economica (è già Node, è già sul box); il
   guscio desktop è l'obiettivo. Qualunque sia il primo, il suo percorso vecchio va
   **cancellato**, non parcheggiato accanto al nuovo.

## 8. Fasi

| # | Fetta | Fatto quando |
|---|---|---|
| 1 | Server minimo sul container: 3–4 route di sola lettura + `GET /version`, bind `127.0.0.1`, `Bearer` obbligatorio, **nessun `ports:`** | il CLI legge lo stato del team dalla API e non più con un percorso proprio; delta immagine misurato e scritto |
| 2 | Il tunnel SSH diventa il trasporto del caso VPS, sotto la stessa API | la stessa build del client funziona su PC e VPS senza rami per posizione |
| 3 | Corsia di scrittura + canale live (piano Interazione) | una chat funziona nel caso co-locato senza passare da Supabase |
| 4 | Primo guscio grafico sulla API | una vista non-2D professionale sostituisce la sua controparte GDScript |
| 5 | Sfoltimento | `game/scripts/backend/` scende dai 3.929 LOC; il CLI si assottiglia |

Prima di ogni fase: **misura, poi scrittura**, come pretende `BACKLOG.md` per ogni
riga aperta.

## 9. I blocchi

☠️ **Nessun banco di prova Windows dall'11/08** (`BACKLOG.md`: *«la macchina virtuale
Windows usata per queste verifiche è stata rimossa»*). Il tunnel, il bind su
loopback e la rete di WSL2 sono precisamente i punti dove questa architettura si
rompe, e Windows è dove sta la maggior parte degli utenti. Stesso blocco di
`[JHT-RUNTIME-PODMAN]`, e non è una coincidenza: entrambi i temi vivono nel gradino
di installazione.

⚠️ **`origin/game` è a 951 commit di distanza con 32 commit unici**, in attesa di un
oracle Windows. Ogni giorno di indecisione allarga quella forbice.

⚠️ **Nessun ADR per Electron→Godot.** La migrazione più costosa del progetto non è
scritta da nessuna parte. Questo documento e l'ADR-0009 non la ricostruiscono — ma
la registrano come lacuna, perché senza di essa non si distingue una correzione da
un'oscillazione.

## 10. Cosa questo documento NON decide

- **Quale framework rende la UI.** Tauri, Electron, Flutter: resta aperto di
  proposito. Il senso del confine è che quella risposta smette di essere portante,
  e che una scelta sbagliata costa un guscio invece di una piattaforma.
- **Il destino dell'ufficio 2.5D.** Resta, in un pannello; se via WASM o come
  binario separato si decide quando esiste un guscio.
- **Se il container debba anche *servire* la UI.** No, per ora: serve dati. Chi
  disegna sta fuori.
