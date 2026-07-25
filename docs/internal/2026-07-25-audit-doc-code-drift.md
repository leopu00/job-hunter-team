# 🔍 Audit doc↔codice — cosa era slittato in tre settimane (2026-07-25)

> **Nota di audit.** Fotografia dello stato repo dopo il ciclo più intenso del progetto
> (2026-07-06 → 07-25: ~500 commit non-merge, migrazione desktop nativa, ritiro della
> dashboard locale, demo mode cloud). Verifica richiesta dall'utente: *"vediamo se la
> documentazione sta slittando con tutto quello che stiamo facendo"*.
>
> La risposta breve: **il codice stava bene, i documenti di stato erano indietro di tre
> settimane.** Questa nota registra cosa è stato trovato, cosa è stato riallineato subito
> e cosa resta come debito tracciato (con il tag sotto cui cercarlo).

---

## 1. 📐 Metodo

Verifiche eseguite (tutte riproducibili):

- `git log` del periodo per temi, confrontato con i doc che dovrebbero rifletterli;
- data dell'ultimo commit su ogni doc chiave vs data dell'ultimo commit sul codice che descrive;
- suite reali eseguite (`pytest`, `vitest`) invece che dedotte dai claim nei doc;
- `scripts/check-release-version.sh` sul tag che sarebbe stato il prossimo;
- diff strutturale (commenti e stringhe normalizzati) fra `scripts/install.*` e i mirror pubblici;
- link-checker su tutti i `.md` tracciati da git;
- conteggi verificati a mano dei claim numerici (pagine web, route API, migration, comandi CLI);
- confronto fra i comandi registrati in `cli/src/program.js` e quelli documentati.

---

## 2. 🔴 Cose che avrebbero morso (riallineate subito)

| Trovato | Impatto reale | Chiuso da |
|---|---|---|
| `package.json` 0.2.0 vs metadati Godot 0.2.1 (dal 20/07) | `check-release-version.sh` è il **primo job** di `release.yml`: qualunque tag avrebbe fatto fallire la release (v0.2.1 ≠ root, v0.2.0 ≠ game) | `326d699f` |
| `CHANGELOG` fermo al 06/07 con ~500 commit fuori | `release.yml` estrae le note della GitHub Release dal blocco `## [X.Y.Z]`: taggare avrebbe pubblicato note quasi vuote | `326d699f` |
| `ops/release.md` descriveva la release Electron (`desktop/package.json`, electron-builder, DMG/AppImage/deb, Windows ARM64) | Chi seguiva il doc sbagliava la release; `desktop/` non esiste più dal 19/07 | `7d0a756c` |
| `install.sh`: source italiano, mirror pubblico inglese | **Il sito serviva l'italiano.** Il `buildCommand` di Vercel rigenera `web/public/install.sh` da `scripts/install.sh` a ogni deploy (dal 2026-04-11): la traduzione del 03/07, applicata **solo al mirror**, veniva sovrascritta a ogni build. Per tre settimane il repo sembrava tradotto e il funnel pubblico parlava italiano | `800ec4ff` + `[vedi § 3.1]` |
| `install.ps1` **mai tradotto** (né source né mirror) | Ogni utente Windows leggeva output italiano dal funnel pubblico | `800ec4ff` |
| **pytest non girava in nessuna CI** | È la ragione per cui `test_public_installers_sync.py` — scritto apposta per fallire in CI sul drift — è rimasto rosso tre settimane senza che nessuno lo vedesse | `e9b1f376` |
| `04-threat-model.md` modellava "Electron + dashboard su localhost:3000" | È il documento destinato a diventare il `SECURITY.md` pubblico: descriveva una superficie che non spedisce più | `c30a3e2b` |
| Demo mode (~10k righe, 4 personas × 7 lingue) senza una riga di documentazione, cookie non dichiarati | Superficie pubblica post-login senza design record né dichiarazione cookie | `f4fe27f3` |

Riallineati nello stesso ciclo: `MAINTAINERS.md` (firma macOS **obbligatoria**, non più "deferred post-beta"), `BACKLOG`/`ROADMAP`/`BETA`, indice `docs/internal`, review-log (20 voci morte, tutto il post-maggio assente), 18 link a un doc cancellato, 3 comandi CLI non documentati, `pyproject.toml` che escludeva ancora `desktop/`.

---

### 3.1 🪤 Il caso installer, per esteso (la trappola più cattiva del giro)

Vale raccontarlo perché il meccanismo è generale: **un mirror rigenerato al build rende il file committato una bugia innocua fino al giorno in cui qualcuno lo modifica al posto del source.**

1. 2026-04-11 (`a38dba83`) — `vercel.json` prende un `buildCommand` che fa
   `cp scripts/install.sh web/public/install.sh`: il sito serve sempre il source.
2. 2026-07-03 (`1d59fa53`) — la traduzione EN del funnel pubblico viene applicata a
   **`web/public/install.sh`**, cioè esattamente al file che il build sovrascrive. Il repo
   sembra tradotto; il sito continua a servire italiano.
3. 2026-07-19 (`32225cb7`) — `scripts/install.sh` riceve modifiche di commento: ora i due
   file divergono anche nel contenuto e il test di sync diventa **rosso**.
4. Il test però non gira in CI (§ 2), quindi nessuno lo vede. E il suo messaggio d'errore
   consigliava `sync-public-installers.sh`, che avrebbe allineato il mirror **al source
   italiano** — peggiorando il repo senza cambiare nulla per gli utenti.

Chiuso così: traduzione portata a monte in `scripts/` (entrambi gli installer), `buildCommand`
che ora invoca `scripts/sync-public-installers.sh` — quindi rigenera **anche il `.ps1`**, che
prima non era coperto — e il test in CI a guardia del mirror committato.

---

## 3. 🟠 Debito strutturale — tracciato nel BACKLOG

Tre voci nuove, tutte emerse da questo audit e tutte con evidenza misurata:

### `[JHT-WEB-LOCAL-ROUTES-ORPHANED]` — 36 route morte, rimosse · 17 shell residue

Partito da `grep -rln "runBash" web/app/api/` → **28** route che shellano nel container.
Analizzando **tutte** le 149 route (chiamanti cercati in `web/`, `game/scripts`,
`cli/src`, `.launcher`, `shared`, `scripts`, `tui/src`, `e2e/tests`, `tests/js`,
`agents/`, `docs/`, con match esatto sui segmenti dinamici) il quadro è risultato
diverso e più ampio del sospetto iniziale:

| Categoria | Esito |
|---|---|
| Zero chiamanti in qualunque file | **29** → rimosse |
| Citate solo in commenti/doc | **7** → rimosse (6) / tenuta (1) |
| Solo negli spec Playwright | **11** → destino legato a `[JHT-E2E-STALE]` |
| Chiamate da codice vivo | il resto |

**Rimosse: 36** (149 → 113 route; shell 28 → 17). Erano i feed della dashboard locale
ritirata e della pagina team-v1 archiviata (`agents/*-activity`, `db/recent-writes`,
`dashboard/stats`, `tokens/by-type`, `tokens/throttle`, `tokens/by-agent`,
`team/{messages,queue,pacing-bridge}`, `dottore/actions`), il lifecycle VPS che ora vive
nell'app (`vps/{pause,terminate,snapshot-destroy}`), la corsia profile-assistant
(`profile-assistant/{chat,save,upload-cv}`, `profile/{sources,summaries}`), il controllo
bridge (`bridge/{start,stop}`), `team/{start-all,stop-all}` — di cui il CLI porta ora
l'unica implementazione — più `email`, `workspace/{browse,init}`, `assistente/{browse,check}`,
`telegram/status`, `local/sync/synced-ids`, `positions/{recent,reverse-geocode}`,
`pending-messages/ack-all`, `agents/speed-table`.

**Tenuta di proposito:** `/api/canary`, diagnostica Supabase-vs-Vercel con le istruzioni
`curl` nel file — si usa a mano durante un incidente, non ha bisogno di un chiamante.

**Verifica:** `npm run build` in `web/` verde (compilato in 4.6s, zero errori) e nessun
import residuo verso le route rimosse. I commenti che le citavano come riferimento di
parità logica (`cli/src/commands/team/{start,stop}.js`, `.launcher/pacing-bridge.py`,
`shared/skills/token-by-agent-series.py`) ora dicono che quel consumatore non esiste più.

**Residuo aperto:** le 17 route shell restanti sono tutte chiamate dalle pagine
`(protected)/team/*`, che appartengono al piano locale e sul cloud degradano a vuoto
(`useIsCloud()` in `AgentInteraction`). La decisione — pagine dev-only o rimozione
insieme alle route — resta nel BACKLOG.

### `[JHT-E2E-STALE]` — 78 spec Playwright che nessuno esegue

`ls e2e/tests | wc -l` → **78**; ultimo commit sulla cartella **2026-07-03**; nessun
workflow le invoca (`grep -rl playwright .github/workflows` → vuoto).

**Misurato il 2026-07-25** (server locale, suite intera): **770 passed · 574 skipped ·
0 failed** in 6.9 minuti. La suite non è rotta: **si skippa da sola**, e la causa è più
vecchia del drift di luglio — *non ha mai avuto una storia di autenticazione*.
`01-auth.spec.ts` porta ancora il suo `TODO: test con sessione autenticata — richiede
storageState`, quindi ogni spec che tocca l'area riservata si skippa appena il deploy si
comporta come produzione. Una run verde certifica le pagine **pubbliche** e quasi nulla
d'altro: si legge come copertura, e non lo è.

Piano (in [`e2e/README.md`](../../e2e/README.md) e nel BACKLOG): account Supabase di test
+ `storageState` → potatura degli spec scritti per superfici che non esistono → subset
pubblico in CI contro un preview deployment. Gli spec nuovi seguono la regola **skip
rumoroso**: ciò che è verificabile in anonimo gira sempre, il resto dice cosa gli manca.

### `[JHT-WEB-DEMO]` (residui) — coperta il 2026-07-25

Le pagine pretendono una sessione, il codice dietro no: la copertura è andata dove può
davvero asserire. **42 test vitest** in `tests/js/tasks/demo-{seeds,queries,feedback-cookie}.test.ts`:
contratto dei seed (4 personas × 56, id/legacy-id, campi letti dalle pagine, breakdown
per dimensione, coordinate a coppie), le query che alimentano ogni pagina, la semantica
del giudizio ritrattabile nel cookie. Più `e2e/tests/8{0,1}-*.spec.ts` per il contratto
dell'API demo e la chiusura dell'area riservata (6 test che girano sempre).

**Invariante i18n messo a contratto:** ogni seed con testo della "voce agenti" deve
avere l'overlay in tutte e 6 le lingue. È il buco silenzioso che si voleva intercettare —
aggiungo una posizione con le note dello Scorer, dimentico i 6 overlay, e chi guarda la
demo in tedesco legge italiano.

**Trovato scrivendo i test:** `demoPositionById` ritorna `company: null` per costruzione
→ la card azienda (logo, banner esclusione, verdetto dell'Analista, shippata il 22/07)
**non compare mai in demo**. Il test fotografa il limite invece di nasconderlo; il debito
è nel BACKLOG.

---

## 4. 🟡 Debito minore — tracciato nel MINOR-TRACKER

Registrato in [`roadmap/MINOR-TRACKER.md`](roadmap/MINOR-TRACKER.md) con contesto ed effort:

- `[MINOR-TUI-DEAD-BUILD]` — `tui/` viene installato **e compilato in ogni immagine**
  (`npm ci --prefix tui`, `npm run build --prefix tui`) ma nessuno lo invoca: nessun
  `bin`, nessun `main`, zero riferimenti runtime fuori dai commenti "specchio di
  `tui-paths.ts`".
- `[MINOR-COMPOSE-NEXT-ENV]` — il compose passa ancora `NEXT_PUBLIC_*` e i tre flag di
  polling di Turbopack/Chokidar, e il Dockerfile pre-crea `/app/web/.next`: residui
  innocui ma fuorvianti ora che il container non avvia Next.
- `[MINOR-SUBPACKAGE-VERSIONS]` — root 0.2.1, `web/` 0.1.13, `cli/` 0.1.9, `tui/` 0.1.7,
  `shared/` 0.1.7: versioni alla deriva che non entrano nel check di release e non
  significano nulla per nessuno.
- `[MINOR-EMAIL-GUIDE-SCREENSHOTS]` — `EMAIL-FORWARDING.md` elenca 5 screenshot
  attesi; `docs/guides/assets/` non esiste.
- `[MINOR-INTERNAL-NOTE-UNFILED]` — `2026-07-11-team-directives-bacheca.md` è ancora
  nella root di `docs/internal/` (il protocollo la vuole smistata in `architecture/`).
- `[MINOR-DISABLED-TESTS]` (già aperta, **numeri aggiornati**) — `tests/js/tasks/`:
  **32 attivi, 41 disabilitati** in `_disabled/`. Il workflow è verde ignorando il 56%
  dei file di quella cartella.
- `[MINOR-SHARED-LLM-DEAD]` (già aperta, **confermata**) — `shared/llm/` non ha ancora
  consumatori runtime.

---

## 5. ✅ Cosa invece era in ordine

Vale registrarlo, perché dice dove il processo funziona:

- **Il ritiro di `:3000` è il pezzo meglio documentato del mese**: guide utente
  (QUICKSTART, CLI-REFERENCE, VPS-SETUP, AI-AGENT-INTEGRATION) e pagina web pubblica in
  7 lingue aggiornate **nello stesso commit** del breaking change, con lapidi 🪦 sui
  paragrafi superati invece di cancellazioni silenziose.
- **Prompt agenti senza drift nuovo**: contratto card posizione e gate profilo Scorer
  propagati su tutte e 7 le lingue nello stesso commit.
- **CI del gioco già completa**: import, 4 self-test, 3 scenari headless, export, firma
  e notarizzazione, smoke test del binario.
- **59 migration, nessuna collisione di numero.**
- `vitest` 869/869, `pytest` 447 passed — entrambe verdi senza aggiustamenti (dopo il lavoro sulla demo: **911 vitest**, 55 file).
- Branch `dev-N` senza lavoro dimenticato (dev1 1, dev2 4, dev3 5 commit avanti).

---

## 6. 📌 Lezione di processo

Il pattern comune ai tre problemi più gravi (versioni non taggabili, CHANGELOG vuoto,
installer in due lingue) è lo stesso: **esisteva un controllo automatico, ma non girava
dove serviva.**

- `check-release-version.sh` esiste dal v0.1.8 → ma si esegue solo su un tag, cioè
  quando è già troppo tardi per accorgersene con calma.
- `test_public_installers_sync.py` è stato scritto *proprio* per fallire in CI → ma la
  suite Python non era in CI.
- Il CHANGELOG è la fonte delle release notes → ma niente verifica che `[Unreleased]`
  sia vivo.

Le prime due sono chiuse (pytest in CI dal 2026-07-24). La terza resta aperta come
idea: un check leggero che avverta quando `[Unreleased]` è più vecchio di N commit
sostanziali su `master`.

---

## 📚 Collegati

- [`CHANGELOG.md`](../../CHANGELOG.md) — il ciclo che questa nota ha verificato
- [`roadmap/MINOR-TRACKER.md`](roadmap/MINOR-TRACKER.md) — il debito minore, con tag
- [`../../BACKLOG.md`](../../BACKLOG.md) — il debito strutturale
- [`ops/release.md`](ops/release.md) — la procedura riscritta
- [`architecture/2026-07-22-web-demo-mode-and-welcome.md`](architecture/2026-07-22-web-demo-mode-and-welcome.md) — il design record scritto in questo giro
