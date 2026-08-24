# `[JHT-TEAM-API-BOUNDARY]` fetta 1 — stato al 2026-08-17 18:25 e come si riprende

**Base:** branch `dev` · **ADR:** [`0009`](../../adr/0009-team-exposes-one-loopback-api.md) (ancora `Proposed`: lo passa ad `Accepted` il gruppo G9, che non è ancora girato)
**Analisi del ticket:** [`2026-08-17-ticket-team-api-boundary.md`](2026-08-17-ticket-team-api-boundary.md)

> **Aggiornamento 2026-08-24:** il consumatore desktop target è ora Tauri 2 +
> React ([ADR-0011](../../adr/0011-tauri-desktop-shell.md)). Questa fetta non
> cambia forma: deve consegnare un contratto versionato che non dipende dal
> framework del client. Il piano desktop è in
> [`2026-08-24-desktop-tauri-migration.md`](2026-08-24-desktop-tauri-migration.md).

> 📌 **Perché questo file esiste.** Il lavoro si è fermato a metà per una scadenza,
> non per un problema tecnico. Questo documento è il punto di ripresa: cosa è
> committato, cosa è ancora sul disco senza commit, e cosa resta da scrivere con
> abbastanza precisione da non dover ricostruire nulla.

---

## 1. La forma scelta, e perché

Un panel di tre design indipendenti, giudicati da tre lenti (peso/ops · correttezza ·
testabilità), ha scelto: **server `node:http` in ESM puro dentro il container, zero
dipendenze npm, zero build step, zero TypeScript eseguito nell'immagine.**

La lente "correttezza" preferiva il design che **esegue** `web/lib` via bundle
esbuild — l'unico che non forka la logica di lettura. È stato scartato per una
ragione che vale registrare: **l'artefatto testato non era l'artefatto spedito.**
I suoi test validano i `.ts` trasformati da vitest col suo alias `@`, mentre
l'immagine eseguirebbe l'output di esbuild risolto da un plugin `onResolve` scritto
a mano; e `build.mjs` non è eseguibile su questa macchina. Per una fetta il cui
unico criterio d'uscita è *una baseline misurabile*, un nucleo non verificabile è
squalificante.

## 2. Le due decisioni ratificate dal direttore, come scostamenti dichiarati

Nessuna delle due è argomentata come conformità. Vanno lette così.

**D-1 — scostamento dalla lettera della decisione 4 dell'ADR-0009.** La decisione
dice che il server porta `web/lib/`. Non lo fa: ~50 righe di SQL sono riespresse in
JS puro, quindi dopo la fetta 1 **tre dialetti leggono `jobs.db`** —
`shared/skills/db_query.py` (Python, ancora consumato da `vps_backend.gd:406`),
`web/lib/local-queries.ts` (TypeScript, del web) e `shared/queries/readonly-sqlite.js`
(JS, nuovo). Accettato perché il costo immagine è ~zero e perché rende **attribuibile**
la misura di §7.1: eseguire `web/lib` si misura *dopo*, sopra una baseline che già
funziona, invece di misurare due cambiamenti insieme. Ritiro in tre passi: confinato
in un file → forma del payload appuntata a `db_query.py --json` così che uno scambio
sia diffabile → direzione di convergenza fissata (`web/lib` → ESM puro in `shared/`,
precedente `shared/release/version.js`).

**D-2 — parziale e dichiarato sulla decisione 5, per `jht positions`.** Solo il lane
`--json` passa dall'API. La tabella umana resta su `db_query.py` perché ogni suo
campo passa dal fence anti-prompt-injection basato su nonce
(`db_query.py:182-183, 225-233, 244, 246`, canonico in `external_content.py:109-113`).
Il lane `--json` non ha fence da perdere. **Nessun gemello JavaScript di
`external_content.py` va scritto, in nessuna fase, da nessuno su questo ticket.**
La decisione 5 è invece soddisfatta **piena** da `jht team status`, il cui percorso
privato viene cancellato del tutto.

## 3. Cosa è committato e verde

| Gruppo | File | Test |
|---|---|---|
| **G1** contratto | `shared/api/contract.js` | 48 ✅ |
| **G4** roster | `cli/src/lib/api/tmux-read.js` | 18 ✅ |
| **G2** auth | `shared/auth/local-token.js` · `cli/src/lib/api/auth.js` | 39 ✅ |
| **G3** letture | `shared/queries/readonly-sqlite.js` · `shared/queries/schema-census.js` | 23 + 9 ✅ |
| **G5** server | `cli/src/lib/api/handler.js` · `cli/src/lib/api/server.js` | 15 + 15 + 6 ✅ |

**Totale: 125 test verdi su cinque gruppi di dieci.**

Eseguiti **un file alla volta** (`cd tests/js && npx vitest run tasks/<f>.test.ts`),
mai `npm test` lì dentro: `tests/js/package.json:7` ha un `pretest` che lancia
`npm ci`. `tests/test_api_read_parity.py` è scritto ma **non è stato eseguito**.

### Il trap misurato, che è la ragione per cui G3 esiste così

Su Node v22.20.0, verificato a mano su questa macchina:

```
new DatabaseSync(f, { readOnly: true })  ->  INSERT bloccato (ERR_SQLITE_ERROR)
new DatabaseSync(f, { readonly: true })  ->  INSERT RIUSCITO
new DatabaseSync(f, { bogus:    true })  ->  INSERT RIUSCITO
```

**Node non valida le chiavi delle opzioni.** Un carattere di differenza fra una API
in sola lettura e un handle scrivibile sul `jobs.db` vivo del team, mentre gli agenti
Python scrivono in WAL. Per questo `assertReadOnly()` al boot passa dallo **stesso**
helper `openReadonly()` del handle reale: un probe che apre un handle proprio con la
propria literal resterebbe verde davanti a una regressione di un carattere.

Altri due fatti misurati qui, da non riscoprire: `require('node:sqlite')` funziona
**senza flag** ma stampa `ExperimentalWarning` su stderr (in un figlio di pid1
finisce in `logs/api.log` a ogni boot); e su Windows un handle lasciato aperto da un
ramo che eccepisce rende il file temporaneo `EBUSY` e non cancellabile — i test che
aprono un DB su file devono chiudere in `finally`.

## 4. G5 recuperato — l'albero è pulito

Alla prima stesura di questo documento i cinque file di G5 erano sul disco senza
commit, scritti mentre il workflow veniva fermato, e la nota diceva che potevano
essere troncati. **Riletti e verificati poco dopo: erano completi**, e i tre file di
test passano (15 + 15 + 6). Committati in `c78b143712`.

`git status` è vuoto. Non resta nulla di non committato da questo lavoro.

Nello stesso giro sono stati tracciati tre `.uid` di Godot che mancavano su questo
branch mentre i `.gd` corrispondenti erano tracciati (`24a76e935a`). I blob sono
**identici per SHA** a quelli di `c2a36a547e` su `origin/dev1`, quindi la
confluenza non può confliggere. Nota per chi guarda i line ending: i blob sono LF,
ma la regola `.gitattributes` per `*.uid` (`29cb6df632`) **non è ancora su questo
branch** — arriverà con master, e fino a lì git avverte che la working copy passerà
a CRLF. Non è un problema del repo.

## 5. Cosa resta da scrivere

Il piano completo dei dieci gruppi — contratto normativo, ordine di merge, "must do"
e "must NOT do" per gruppo, e i test con i comandi esatti — è il file
`PHASE1-PLAN.md` prodotto dal workflow di progetto. **Se non è più reperibile va
rigenerato**: è il sintetizzato di 12 agenti e non vive nel repo.

| Gruppo | Cosa | Nota di ripresa |
|---|---|---|
| ~~**G5** server~~ | ~~handler + `node:http`~~ | **fatto**, vedi §4 |
| **G6** CLI | client con handshake, `jht api serve\|status`, registrazione | `resolveApiAccess()` è l'**unico** codice location-aware: rilocazione argv via `docker exec`, non un secondo percorso dati |
| **G7** consumatori | le cancellazioni in `team/list.js` e `positions.js` | non cancellare `getActiveSessions`, `runSkill`, `runSkillCaptured`: hanno chiamanti vivi |
| **G8** supervisione | `pid1.js`, undicesimo figlio | mai toccare il keep-alive a `pid1.js:1186`; due righe in `forwardSignal` |
| **G9** doc e policy | ADR → `Accepted`, `SECURITY.md`, threat model, CHANGELOG | **`SECURITY.md` afferma oggi che il container non espone porte HTTP, e la sua clausola out-of-scope escluderebbe la nuova superficie dal perimetro di vulnerabilità del progetto: entrambe diventano false con questo lavoro** |
| **G10** guardie | test fail-closed su bind, `EXPOSE`, `ports:`, cookie, `readonly:` | vanno per ultimi: falliscono su file che non esistono ancora |

### Le tre cose che i gruppi chiusi chiedono a G5, e che vanno rispettate

- **G1:** `ok(data, now)` torna **solo il body**; `fail(code, {...})` torna
  `{ status, body }`. L'asimmetria è voluta: il 200 è affare dell'handler, uno stato
  d'errore è affare della tabella.
- **G2:** importare l'auth come namespace (`import * as auth`), `auth.authenticate()`
  torna un booleano; `false` → 401 `UNAUTHORIZED`.
- **G3:** la superficie del backend è
  `{ dbPath, isLive(), connection(), close(), assertReadOnly(), describeDb(), census(), listPositions(filters), getPosition(id), getDashboard() }`.
  `readTmuxSessions` (G4) è **sincrono** e torna `{ tmux, sessions }`: `readAt` e
  `source: 'tmux'` li aggiunge l'handler.

## 6. Cosa non è ancora vero, e non va scritto da nessuna parte come se lo fosse

- **Non esiste un server funzionante.** Nessuno importa ancora il contratto; nessuna
  route è raggiungibile; `jht api` non è un comando.
- **Il delta immagine non è misurato.** Docker Desktop non era in esecuzione: nessuna
  verifica è stata fatta *dentro* l'immagine, e §7.1 resta un numero dovuto.
- **La versione di Node nell'immagine non è verificata.** `node:sqlite` richiede
  ≥ 22.5 ed è quasi certamente presente (digest fissato 2026-04-27), ma "quasi certo"
  non è "misurato". Il boot è progettato per rifiutare di ascoltare con `exit 78` e
  una riga di log nominata, invece di partire e mentire.
- **Manca il banco di prova Windows dall'11/08.** Il bind su loopback, la sua
  raggiungibilità dentro Docker Desktop/WSL2, il tunnel `ssh -L` end-to-end e il
  `mode 0600` del file token (**non applicabile** attraverso il bind mount WSL2:
  in `C:\Users\<utente>\.jht\` i file si leggono `-rw-r--r--`) restano **non
  provati**, non "funzionanti". Stesso blocco di `[JHT-RUNTIME-PODMAN]`.
