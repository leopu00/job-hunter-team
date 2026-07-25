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
| `install.sh`: source italiano, mirror pubblico inglese — e il test rosso suggeriva `sync-public-installers.sh` | Il sync alla cieca avrebbe rimesso in **italiano** l'installer servito da jobhunterteam.ai. Delta funzionale verificato: **zero** (solo commenti e stringhe) | `800ec4ff` |
| `install.ps1` **mai tradotto** (né source né mirror) | Ogni utente Windows leggeva output italiano dal funnel pubblico | `800ec4ff` |
| **pytest non girava in nessuna CI** | È la ragione per cui `test_public_installers_sync.py` — scritto apposta per fallire in CI sul drift — è rimasto rosso tre settimane senza che nessuno lo vedesse | `e9b1f376` |
| `04-threat-model.md` modellava "Electron + dashboard su localhost:3000" | È il documento destinato a diventare il `SECURITY.md` pubblico: descriveva una superficie che non spedisce più | `c30a3e2b` |
| Demo mode (~10k righe, 4 personas × 7 lingue) senza una riga di documentazione, cookie non dichiarati | Superficie pubblica post-login senza design record né dichiarazione cookie | `f4fe27f3` |

Riallineati nello stesso ciclo: `MAINTAINERS.md` (firma macOS **obbligatoria**, non più "deferred post-beta"), `BACKLOG`/`ROADMAP`/`BETA`, indice `docs/internal`, review-log (20 voci morte, tutto il post-maggio assente), 18 link a un doc cancellato, 3 comandi CLI non documentati, `pyproject.toml` che escludeva ancora `desktop/`.

---

## 3. 🟠 Debito strutturale — tracciato nel BACKLOG

Tre voci nuove, tutte emerse da questo audit e tutte con evidenza misurata:

### `[JHT-WEB-LOCAL-ROUTES-ORPHANED]` — 28 route API irraggiungibili

`grep -rln "runBash" web/app/api/ | wc -l` → **28**. Sono le route che eseguono comandi
nel container (team start/stop, terminal, controllo agenti, sentinella,
`profile-assistant/chat`, …). Dopo il ritiro di `:3000` non sono raggiungibili da
**nessuno** dei due piani: su Vercel non c'è shell, nel container non c'è Next.js.
Restano nel bundle Vercel e nella superficie di ogni audit di sicurezza. Vive solo il
percorso di sviluppo `npm run dev:host` (`JHT_SHELL_VIA=docker:jht`).
**Decisione da prendere per ciascuna:** eliminare, oppure marcare esplicitamente
dev-only.

### `[JHT-E2E-STALE]` — 78 spec Playwright che nessuno esegue

`ls e2e/tests | wc -l` → **78**; ultimo commit sulla cartella **2026-07-03**; nessun
workflow le invoca (`grep -rl playwright .github/workflows` → vuoto). Non conoscono
`/welcome`, il demo mode, `/swipe`, il drawer messaggi né la pagina posizione
riscritta. Una suite che nessuno esegue è peggio di nessuna suite: **si legge come
copertura**.

### `[JHT-WEB-DEMO]` (residui) — demo senza rete di sicurezza

Nessuna spec copre `/welcome` o il ramo demo (`JHT_WEB_DEMO_PERSONA` esiste apposta per
renderli testabili senza wizard), e nulla verifica che i 4 seed portino ancora **tutti**
i campi che le pagine leggono: un campo nuovo produce un buco silenzioso nella demo.

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
- `vitest` 869/869, `pytest` 447 passed — entrambe verdi senza aggiustamenti.
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
