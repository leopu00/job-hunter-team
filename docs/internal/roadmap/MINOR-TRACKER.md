# 🪛 Minor tracker — note, debt, fix piccoli

> File di tracciamento per **cose da fare/migliorare/controllare che NON sono blocker pre-launch**.
> Da non confondere con `BACKLOG.md`: quello tiene le strategiche e i veri BLOCKER.
> Qui finiscono mini-fix, debt tecnico discreto, note di osservazione, ipotesi da verificare.

## ⚙️ Convenzione

- **Status emoji:** ⬜ open · 🟡 in progress · ✅ done · ❌ rejected/won't fix
- **Effort:** S (≤30 min) · M (≤2h) · L (>2h)
- **Origine:** dove è emerso (sessione, commit, issue, observation)

---

## 🧹 CI / Test / Lint debt

### ✅ `[MINOR-SHARED-LLM-DEAD]` Rimuovere `shared/llm/` (dead code) — FATTO 2026-07-25

- **Com'era:** ⬜ open dal 2026-07-03 (decisione release: fix minimale subito, rimozione dopo il lancio). `shared/llm/` (base + factory + 3 provider) non aveva NESSUN consumatore runtime — zero import da `agents/`, `cli/`, `tui/`, `scripts/`, Docker; unici consumatori i suoi 4 file di test. Il team parla ai modelli via processo CLI in tmux, non via SDK.
- **Fatto:** rimossi `shared/llm/` (7 file), i suoi 4 test, e il grappolo che ci stava attaccato — `shared/skills/credential_manager.py` + `credential_planner.py` + `tests/test_credential_manager.py`, che risolvevano le API key **per** quei provider e per nessun altro. 11 file, 1.409 righe.
- **In più, la conseguenza che non era stata vista:** `anthropic` e `openai` in `requirements.txt` esistevano solo per questo codice. Erano installate in ogni build del container — due SDK, e la loro superficie di aggiornamento, per zero import. Tolte anche quelle, con il motivo scritto accanto perché nessuno le rimetta per abitudine.
- **Origine:** fact-check pre-Reddit 2026-07-03 (sessione master-3). Chiuso nel giro di pulizia dead-code del 2026-07-25 insieme a [[MINOR-DISABLED-TESTS]] e alle 30 sottocartelle irraggiungibili di `shared/`.

### ✅ `[MINOR-PRETTIER-FORMAT]` Prettier check su `web/app/` + `shared/` — FIXED 2026-06-02

- **Stato:** chiuso 2026-06-02. 8 file riformattati con `npx prettier --write` (mig 024/027/028 + geocode + i18n). Lint workflow ora verde.
- **File toccati:** `web/app/(protected)/positions/[id]/page.tsx`, `GeocodeRequestButton.tsx`, `web/app/api/cloud-sync/{full-dump,pull-desired-state,push}/route.ts`, `web/app/api/i18n/route.ts`, `web/app/api/positions/[legacyId]/geocode-request/route.ts`, `shared/i18n/translations.ts`.
- **Effort:** S (5 min).
- **Follow-up consigliato:** valutare hook pre-commit con `prettier --write` su staged files per evitare ricorrenza ([[feedback-pre-commit-hooks]] futura).

### ✅ `[MINOR-DISABLED-TESTS]` 41 test file in `tests/js/tasks/_disabled/` — CHIUSO 2026-07-25

- **Com'era:** 🟠 open. 40 file spostati il 2026-05-31 per sbloccare il workflow Tests dopo il refactor dashboard, con un README che prometteva una procedura di riabilitazione mai eseguita in due mesi. Il workflow era verde solo perché `vitest.config.ts` **escludeva la cartella intera**.
- **Verdetto:** non recuperabili. Puntavano a superfici **rimosse**, non rinominate — la dashboard locale ritirata e le route API cancellate nel giro 149 → 97. `web/app/api/{activity,alerts,analytics,archive,audit,automations,budget,calendar,changelog,companies,compare,config,contacts,context,cover-letters,database,env,errors,events,…}` non esistono più. Cancellati: 6.068 righe che leggevano come copertura.
- **Il colpo di scena:** tolto l'exclude `**/_disabled/**`, è emerso un **secondo** cimitero che nessuno sapeva esistesse — `tests/js/assistant/_disabled/`. Quello era un falso positivo: `shared/assistant/assistant-bot.ts` e tutte e quattro le funzioni sotto test erano al loro posto. Lo spostamento in `_disabled/` aveva portato il file una directory più in basso senza correggere `../../../shared/…`, quindi l'import risolveva su `tests/shared/` e la suite moriva prima di eseguire un assert. Rimesso al posto giusto: **18 test che non avevano mai smesso di passare**, nascosti per due mesi dall'exclude che doveva nascondere quelli rotti.
- **Lezione:** un exclude a glob nasconde ciò che sai *e* ciò che non sai. Se un test va disabilitato, si disabilita **quel** test — `it.skip` con il motivo — non la cartella che lo contiene.
- **Origine:** `tests/js/tasks/_disabled/README.md` (che nel frattempo aveva anche perso il conto: diceva 38, erano 41).

### 🟡 `[MINOR-PRECOMMIT-DRIFT]` No hook pre-commit per Prettier/ESLint

- **Stato:** ⬜ open. La causa di `MINOR-PRETTIER-FORMAT` ricorrente è l'assenza di hook che blocchi il commit se i file non sono formattati.
- **Fix proposto:** `husky` + `lint-staged` (o pre-commit hook semplice) per `prettier --write` + `eslint --fix` sui file staged.
- **Effort:** M (1h setup + test su tutti gli OS).
- **Trade-off:** può rallentare i commit grandi; mitigabile con `lint-staged` che lavora solo sui file staged.

### ✅ `[MINOR-VITEST-DOUBLE-CONFIG]` Due config Vitest — CHIUSA 2026-07-25

- **Cosa era:** `tests/js/` conteneva sia `vitest.config.ts` sia `vitest.config.mjs`. Vitest preferisce il `.ts`, quindi `npm test` e la CI passavano da quello; il `.mjs` non era invocato da nessun workflow, e i due divergevano — l'alias `@` → `web/` c'era solo nel `.mjs`, quindi un test che importava un modulo dell'app **falliva in blocco all'import** sotto il config reale (nessun test eseguito, nessuna asserzione, un file che sembra copertura e non lo è).
- **I 287 fallimenti, spiegati:** il `.mjs` dichiarava un `include` esplicito su `tasks/**/*.test.ts` **senza escludere `tasks/_disabled/`**, che il `.ts` esclude. Quel config rimetteva quindi in gioco i 41 file disabilitati il 2026-05-31 → 287 test rossi. Nessun test "vero" era nascosto lì: è lo stesso debito di `[MINOR-DISABLED-TESTS]` visto da un'altra porta.
- **Fatto:** alias portato nel `.ts`, `.mjs` cancellato. Verificati **tutti e 11 i moduli** del job matrix di `test.yml` col config rimasto (assistant 12 · config 90 · context-engine 54 · deploy 38 · events 33 · integration 55 · queue 72 · sessions 43 · tasks 613 · validators 73 · wizard 39) e `npm test` → 911 test in 55 file.

### 🟡 `[MINOR-TUI-DEAD-BUILD]` `tui/` compilato in ogni immagine ma mai invocato — build ripulita 2026-07-25

- **Stato:** 🟡 mezzo chiuso. Il Dockerfile non installa né compila più `tui/` (via `COPY tui/package.json`, `npm ci --prefix tui`, `npm run build --prefix tui`): ogni immagine risparmia un `npm ci` e una compilazione TypeScript per codice che nessun processo lancia. **Il codice resta nel repo**: la rimozione definitiva aspetta la conferma che la TUI non serva più a nessuno (l'expert-mode di `install.sh` la compila ancora sull'host).
- **Contesto:** `tui/package.json` non dichiara né `bin` né `main`; l'unico entry point sarebbe `npm start` → `node dist/tui/src/tui.js`, che **nessuno invoca**: `grep -rn "dist/tui|tui.js|jht-tui"` su `cli/src/`, `.launcher/`, `jht-wrapper.sh` e `docker-compose.yml` non trova invocatori (fuori dai commenti "specchio di `tui-paths.ts`"). L'unica citazione viva è in `install.sh`, che compila la TUI sul path expert-mode.
- **Da fare:** decidere se (a) è morto come `shared/llm/` → rimuovere dal Dockerfile e dal repo, oppure (b) è un entry point voluto ma non cablato → cablarlo e documentarlo. Nel frattempo ogni immagine paga install + build TypeScript per codice che non parte.
- **Effort:** S per togliere le due righe dal Dockerfile · M per la rimozione completa (tocca `install.sh`, `jht-paths.js`, `.launcher/config.sh`).
- **Origine:** audit doc↔codice 2026-07-25 ([nota](../2026-07-25-audit-doc-code-drift.md)).

### ✅ `[MINOR-COMPOSE-NEXT-ENV]` Residui Next.js nel compose — CHIUSA 2026-07-25

- **Cosa era:** il compose di produzione passava sei variabili col profumo di Next mentre il container non avvia più Next.js.
- **Correzione dell'analisi iniziale (importante):** **quattro di quelle sei NON sono residui.** `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`, malgrado il prefisso, le legge il **sync del container** (`shared/skills/db_to_supabase.py`, `db_to_sheets.py`, `jht doctor`) come fallback quando la config non arriva da `~/.jht/cloud.json`: rimuoverle avrebbe rotto il push su chi le passa via env. `NEXT_PUBLIC_JHT_DEPLOY` resta perché il template compose generato dal gioco (`game/scripts/setup/setup_service.gd`) la include.
- **Fatto:** spostati nell'override dev i tre flag che servono davvero solo al dev server (`WATCHPACK_POLLING`, `CHOKIDAR_USEPOLLING`, `TURBOPACK_WATCH_POLL`) e annotate le due env Supabase con un "non rimuoverle, non sono per Next".
- **Lezione:** il prefisso di una variabile non dice chi la legge. `grep` prima di potare.

### ✅ `[MINOR-SUBPACKAGE-VERSIONS]` Versioni dei sub-package alla deriva — CHIUSA 2026-07-25

- **Fatto:** tutti allineati a `0.2.1` (root) e regola scritta in [`ops/release.md`](../ops/release.md) § "The other package.json files", con il one-liner da eseguire al bump — verificato sul posto. Restano fuori da `check-release-version.sh`: un disallineamento lì è bookkeeping, non deve bloccare una release.
- **Com'era:** Root `0.2.1` (l'unica che conta, verificata da `check-release-version.sh` insieme ai metadati Godot) · `web/` `0.1.13` · `cli/` `0.1.9` · `tui/` `0.1.7` · `shared/` `0.1.7`.
- **Contesto:** nessuno di questi numeri viene pubblicato, bumpato in release o verificato da CI: sono fermi a date diverse e non significano nulla per chi legge. Il rischio non è funzionale, è di **fraintendimento** (un contributor legge `web/package.json` e crede che il web sia alla 0.1.13).
- **Da fare:** decidere una regola sola — allineare i sub-package alla versione root al momento della release, oppure togliere il campo `version` dai package interni non pubblicati (npm lo tollera nei workspace privati) e dirlo in `release.md`.
- **Effort:** S.
- **Origine:** audit doc↔codice 2026-07-25.

---

## 🐛 Bug minori cross-platform

### 🟡 `[BUG-TURBOPACK-MONOREPO-RESOLVE]` Turbopack cerca `tailwindcss` dal monorepo root su Windows dev

- **Stato:** ⬜ open. Specifico Windows dev mode. Vercel CI (Linux) non lo vede; macOS/Linux dev probabilmente nemmeno.
- **Sintomo:** `npm run dev` su Windows → primo GET `/` → Turbopack risale il filesystem cercando `node_modules` → CPU/IO saturati → server inutilizzabile per smoke locale.
- **Causa probabile:** `web/next.config.ts` linea ~9 ha `outputFileTracingRoot: MONOREPO_ROOT` (pensato per Vercel file tracing in build), ma Turbopack lo propaga come root anche per node-module resolution in dev.
- **Fix proposti:**
  - 🥇 Rendere `outputFileTracingRoot` conditional (solo `process.env.NODE_ENV === 'production'`).
  - 🥈 Override esplicito PostCSS config: `path.resolve(__dirname, 'node_modules/tailwindcss')`.
  - 🥉 Test cross-OS via CI prima di toccare la config.
- **Verifica:** `cd web && npm run dev` + `curl localhost:3000/` deve rispondere 200 senza loop di resolve.
- **Effort:** M (1-2h con test cross-OS).
- **Priorità:** 🟡 bassa per il maintainer (lavora su macOS); fastidiosa per contributor Windows. Non blocca Vercel deploy.
- **Memoria correlata:** `feedback_no_heavy_smoke_tests_stacking`.

---

## 📝 Note / osservazioni / da-verificare

(Sezione per osservazioni che non sono ancora task ma vale la pena tracciare.)

### ⬜ `[MINOR-TAXONOMY-I18N]` Allineare le 6 traduzioni di analista/capitano al redesign brain-driven

- **Origine:** redesign tassonomia 2026-06-20 (`docs/internal/architecture/2026-06-20-taxonomy-brain-driven-redesign.md`).
- **Cosa serve:** lo step 8 (categorizzazione brain-driven: `other-pile` → `promote`) di `agents/analista/analista.<lang>.md` e la regola **C-17** (arbitro tassonomia) di `agents/capitano/capitano.<lang>.md` esistono solo nel **base EN**. Le 6 varianti `.it/.de/.es/.fr/.hu/.pt` sono stale (descrivono ancora il vecchio modello a string-pass).
- **Impatto:** NESSUNO su betaA+betaB (entrambi `locale=en` → caricano il base EN). Riguarda solo eventuali utenti in altre lingue.
- **Effort:** M (2 file × 6 lingue, traduzione fedele).

### 🔭 `[NOTE-TAXONOMY-OBSERVE]` Osservare i primi cicli post-deploy brain-driven (dal 2026-06-21)

- **Origine:** deploy 2026-06-20, vedi doc redesign.
- **betaB** (riparte 20:00 Rome): il nuovo **C-17** splitta da solo `Engineering (Other)` 104 (semi-catch-all: Document Control + ingegneria off-profile)? Sì = arbitro OK; no entro un giorno → nudge/reset di quel solo bucket. `Technical Writing` 220 deve restare "keep" (famiglia vera multilingue).
- **betaA** (riparte 08:00 Rome, registro resettato): le ~224 "da categorizzare" convergono a ~7-9 famiglie reali (IB/M&A, Credit, Infra, VC, PE, Corp Finance, Public Markets)?
- **Principio:** osservazione, non intervento (betaB sano). Backup reset betaA: `/jht_home/logs/taxonomy-reset-betaA-backup.json`.
- **Effort:** S (check via SSH read-only).

### ✅ `[NOTE-NODE-20-DEPRECATION]` GitHub Actions Node.js 20 deprecato dal 2026-09-16 — CHIUSA 2026-07-21

- **Origine:** warning ricorrente in CI logs 2026-06-02.
- **Cosa serviva:** aggiornare `actions/checkout@v4` + `actions/setup-node@v4` a versioni che girano su Node 24.
- **Chiusa da:** i bump Dependabot del 2026-07-21 (`0b40effc` checkout 4→7, `81a5e1ec` setup-node 4→7). Verificato 2026-07-25: i workflow usano `checkout@v7`, `setup-node@v7`, `upload-artifact@v7`, `download-artifact@v8`, `setup-python@v6`. La deadline del 2026-09-16 non è più un rischio.

### 🟡 `[MINOR-EMAIL-GUIDE-SCREENSHOTS]` Screenshot mai prodotti in `EMAIL-FORWARDING.md` — lista ridotta 2026-07-25

- **Stato:** 🟡 la lista è passata da 5 a **2** (form email nell'ufficio Godot + filtro Gmail): gli altri tre erano UI di Google/LinkedIn che cambia sotto di noi o già visibile in qualunque screenshot della dashboard. Restano da catturare le due immagini.
- **Com'era:** ⬜ open. La guida elenca 5 screenshot attesi con i path di destinazione (`docs/guides/assets/email-0*.png`) e un callout "📸 Missing screenshots"; **`docs/guides/assets/` non esiste**.
- **Nota:** il primo screenshot atteso ("Desktop Settings → Team email") va rifatto sull'ufficio Godot, non sul vecchio wizard.
- **Da fare:** produrre le 5 immagini e sostituire il callout con gli embed, oppure ridurre la lista a quelle che si vogliono davvero mantenere.
- **Effort:** M (serve un giro di cattura schermate su app + Gmail).
- **Origine:** audit doc↔codice 2026-07-25 (unico link "rotto" restante nel repo, ed è un esempio in backtick).

### ✅ `[MINOR-INTERNAL-NOTE-UNFILED]` Nota del 2026-07-11 ancora nella root di `docs/internal/`

- **Com'era:** ⬜ open. `2026-07-11-team-directives-bacheca.md` era in root; il protocollo di `docs/internal/README.md` vuole la root riservata a `landing-image-prompts.md` e le note smistate in `architecture/` · `postmortems/` · `roadmap/` · `_archive/`.
- **Fatto (2026-07-25):** `git mv` in `architecture/` + riga nell'indice. Era una nota **non indicizzata**: fuori dal protocollo *e* fuori da ogni sommario, quindi raggiungibile solo per `ls`.
- **Origine:** audit doc↔codice 2026-07-25. Le altre due note in root (`2026-07-03-desktop-app-*`) sono già state archiviate nello stesso giro.

### ⬜ `[NOTE-COMPANIES-RUBRIC]` Analista rubric companies troppo permissivo

- **Origine:** Case Study #2 + #3 — 0 NO_GO su 357 companies totali tra 2 run.
- **Implicazione:** hard requirements (degree, geo) NON filtrati upfront. Coerente con `[[project-team-value-chain-shift]]` (Analisti hanno lavoro espanso).
- **Da promuovere a fix:** valutare se è un bug rubric o un task agent prompts v2.
- **Effort:** M.

### ⬜ `[NOTE-WRITER-ATTRIBUTION-NULL]` `written_by` field null 93% su run Codex

- **Origine:** Case Study #2 staging analysis.
- **Implicazione:** orchestration log incompleto → metriche per-writer impossibili.
- **Da promuovere a fix:** verificare flow scrittura `written_by` in `applications` table, probabile race condition o regressione recente.
- **Effort:** S-M.

---

## 🔧 TODO inline nel codice (audit 2026-06-02)

### ⬜ `[TODO-CLOUD-CLAIM-FORCE]` `jht cloud claim --force` non implementato

- **File:** `cli/src/commands/cloud.js:924` — messaggio utente cita `jht cloud claim --force (TODO)` su sync conflict.
- **Cosa serve:** subcomando che permetta force-claim della device su conflitto multi-device (oggi l'utente deve spegnere il container conflittuale).
- **Effort:** M.
- **Priorità:** 🟡 — funziona il workaround (spegni container), ma scomodo se multi-device "live".

### ⬜ `[TODO-TOKEN-METER-CALIBRATION]` `token-meter.py` calibrazione incompleta

- **File:** `shared/skills/token-meter.py:52` (Step 4 rolling window per-agent) + `:66` (Step 3 EMA alpha calibration).
- **Cosa serve:** completare le 2 calibrazioni residue dello sprint Bridge V7/Token Meter (commento "TODO Step 3/4" inline).
- **Effort:** M.
- **Priorità:** 🟡 — fallback a hardcoded `CALIB_EMA_ALPHA = 0.3` funziona; rifinitura per accuracy.

### ⬜ `[TODO-SALARY-WEB-SEARCH]` `salary_estimate.py` LIVELLO 3 web search è stub

- **File:** `shared/skills/salary_estimate.py:14` — docstring dice "LIVELLO 3 — Web search (TODO, web access). Stub per ora: ritorna None".
- **Cosa serve:** integrazione web search per stima salariale di fallback quando i 2 livelli sopra (cache locale + listino) non hanno dato.
- **Effort:** M-L (dipende da web access architecture).
- **Priorità:** 🟡 — il fallback `None` è gestito a monte; impacta solo accuracy stima salary.

---

## 📍 Verifiche live 2026-06-02

### ✅ Security gap residui ROADMAP — false positive
ROADMAP linea 244 citava "3 gap residui: SSRF, resolve-system-bin, CSP prod". Verifica live:
- ✅ CSP prod: nonce-based attivo (`web/middleware.ts:74-77`), `unsafe-inline` solo in dev HMR
- ✅ SSRF dispatcher: integrato a webhooks+gateway (BACKLOG:969). `shared/skills/check_links.py` NON usa HTTP fetch (le occorrenze di `fetch` sono `cursor.fetchall()` SQLite — falso positivo audit)
- ⏸️ resolve-system-bin: trade-off accettato per Homebrew/Docker macOS (`desktop/main.js:12-20` prepend `/opt/homebrew/bin`), documentato in `04-threat-model.md`

ROADMAP aggiornato 2026-06-02.

### ✅ PR/Issue GitHub
0 PR open · 0 Issue open. Branch `dev1/dev2/dev3` sono l'unico work-in-progress non mergiato.

---

## 🌉 Bridge / fix#4 weekly — 2026-06-13

### ⏸️ Due `weekly_remaining_pct` omonimi (consolidare a regime) — debt M
**Origine:** discussione post-deploy VPS betaA 2026-06-13 (dev1+dev2+dev3).
Il fix#4 espone `weekly_remaining_pct` in DUE percorsi distinti con stessa chiave:
1. `sentinel-data.jsonl` (via `compute_metrics.py`) — **driver canonico** dello status binding / ATTENZIONE-WEEKLY (live, es. 91.0).
2. `pacing-bridge-state.json` (via `_compute_dynamic_target` in `pacing-bridge.py`) — input al verdetto COAST lato pacing (`None` in fallback post-boot).
**Rischio:** a regime i due possono divergere (arrotondamenti / finestra usata) → confonde chi legge. Binding NON è rotto (la fonte 1 è quella che conta).
**Fix concordato (non scope incidente):** consolidare su fonte unica — il pacing legge `weekly_remaining_pct` dal sample di `compute_metrics` invece di ricalcolarlo. dev1 espone il campo "pacing-friendly" lato sua lane, dev2 adegua `pacing-bridge.py`. Da fare insieme all'unit-test COAST.

### ⏸️ `work_phase=None` cosmetico nel `pacing-bridge-state.json` post-boot — debt S
Subito dopo il recreate il pacing è in fallback (`effective_window_too_short`) → `work_phase`/`current_window_target_pct`/`weekly_remaining_pct` a `None` nel pacing-state. **Nessun impatto funzionale:** il gate working-hours reale è nel launcher/watchdog (verificato `inside=True`), indipendente da questo campo. Si popola da sé a regime (≥2 sample). **Da ri-verificare** che `work_phase`→`ON` a regime (~30-45min post-boot).

---

## 📜 Come usare questo file

1. **Quando aggiungere qui:** mini-fix < 2h, debt non blocker, note osservative, bug specifici a un ambiente, da-verificare.
2. **Quando promuovere a `BACKLOG.md`:** se diventa blocker pre-launch, se scope cresce > 1 giorno, se entra in roadmap strategica.
3. **Quando chiudere:** marca ✅ FIXED con data + commit ref. Lascia 1-2 settimane di "storia recente" poi archivia se vuoi.

**Linked:** `BACKLOG.md` (strategico + blocker), `CHANGELOG.md` (storico release).
