# 👷‍♂️ Mantenitore 👷‍♂️ + Tool-Health + Resilience — Design unificato

**Data:** 2026-06-13 · **Autori:** dev1, dev2, dev3 (panel) · **Stato:** approvato dall'utente, in implementazione

> Design-doc condiviso. Ognuno riempie/espande la propria sezione di implementazione sul proprio
> branch dev-N; il consolidamento in master lo fa l'utente. Gemello, per struttura, del
> `usage-monitoring-redesign-design.md`.

## 1. Contesto e trigger

Indagando perché i team davano `new=0`/"coda esaurita", dev3 ha trovato un blocco LinkedIn
**fleet-wide**: l'immagine `:latest` non baka le system-lib di Chromium (`libatk-1.0.so.0`) →
`linkedin_check.py` (verifica apertura via Playwright) esce con exitCode 127 su **betaB E betaC**.
LinkedIn = ~68% delle fonti. Dettaglio: `project_linkedin_libatk_image_bug.md`. Fix immediato già
pronto (dev1@9db78625d `--with-deps`), ma il punto è la **classe di problema**, non il singolo bug.

## 2. Diagnosi affilata (la lezione vera)

La libertà NON mancava: gli agenti `jht` hanno **già** `sudo` NOPASSWD per `apt-get/apt`
(`/etc/sudoers.d/jht`, verificato a terra: `sudo -n apt-get` exit=0). Potevano
`sudo apt-get install libatk1.0-0` / `sudo playwright install-deps` e ripartire. Non l'hanno fatto.
Quindi le leve reali sono **tre**, non "aprire di più":

- **(a)** l'immagine non baka i deps critici → tool non funziona out-of-the-box;
- **(b)** gli agenti **degradano in SILENZIO** invece di auto-riparare con la sudo che hanno
  (13 report analisti = scoperto a valle, dopo ore);
- **(c)** **nessun test del browser a build-time** → la regressione arriva in prod indisturbata.

Riorientamento: rendere il rilevamento **strutturale** e gli agenti **testardi**, NON allargare i
permessi. La filosofia "libertà > restrizione" resta (gli agenti possono installare da fonti
ufficiali ciò che serve), ma il problema qui non era quello.

## 3. Soluzione unificata (4 blocchi complementari)

### Blocco 1 — Prevenzione + Detection
- **Build-time GATE** *(dev1, leva strutturale n.1)*: step nel Dockerfile/CI che lancia davvero il
  browser headless (launch chromium + 1 navigazione). Manca una `.so` → **build ROSSA**, non la
  produzione. "Mai più un libatk silenzioso" diventa strutturale.
- **Tool-health RUNTIME** *(dev2)*: il Mantenitore smoke-testa i tool critici e li espone come
  **segnale strutturato** (`tools_health` nel tick → Sentinella/Capitano), pattern `weekly_pace`.
  Cattura ciò che si rompe DOPO il deploy (runtime/ambiente). → Insieme: nessun tool-rotto sfugge,
  né a build né a runtime.

### Blocco 2 — Freedom standardizzata: `jht-install` *(dev1)*
Un wrapper unico che instrada nella lane giusta — sistema→`sudo apt-get`, python→`uv pip --user`,
node→npm prefix (`NPM_CONFIG_PREFIX`), browser→`PLAYWRIGHT_BROWSERS_PATH=/opt/playwright` — + un
prefisso globale scrivibile `/opt/jht-deps` (baked in PATH+LD_LIBRARY_PATH) per il resto. Usa i
meccanismi GIÀ esistenti, non ne aggiunge di nuovi. Risolve il "caos deps" con enforcement reale
(nel wrapper, non solo in un doc). *(dev3 ritira il "prefisso globale nuovo" separato in favore di
questo.)*

### Blocco 3 — Testardaggine
- **Skill RESILIENCE** *(dev3)*: ladder di fallback per i tool mission-critical — tool fallisce
  (exit≠0 / dep mancante) → auto-ripara con `jht-install` → ritenta → metodo alternativo → fonte
  ATS/careers canonica → `OPEN_UNVERIFIED`. **Mai degradare in silenzio.**
- **Regola-prompt vincolante** *(dev1)*: VIETATO scrivere "coda esaurita"/`new=0` senza prima un
  self-check del tool. Tool rotto e non riparabile → escala al Capitano col fix ESATTO.
- **Dato tool-health** *(dev2)*: dà all'agente il segnale per distinguere "rotto" da "vuoto".
I tre pezzi chiudono il cerchio.

### Blocco 4 — Mantenitore 👷‍♂️ *(convergenza dei 3)*
Sibling del Dottore, scope **INFRA**:
- Gira **1x/giorno**, auto-spawnato (riusa `doctor_schedule.py` + `doctor-watchdog.sh` con uno
  **slot 'maintainer'**, NON un watchdog nuovo), **logbook** sintetico (gemello del Dottore),
  **self-terminate** a sweep finito (come il Dottore).
- Skill `maintainer-sweep`: 1) smoke-test tool critici (riusa il gate del Blocco 1, es. lancia
  `linkedin_check.py` come canary); 2) audit deps fuori standard → consolida via `jht-install`;
  3) GC script/tmp orfani (sessioni non in `tmux ls`); 4) de-dup script ricorrenti → skill
  canonica; 5) freschezza/deprecate deps; 6) disco/RAM + trend vs ultimo logbook.
- **Single-writer** (regola redesign usage): è l'unico che ripara infra; azioni distruttive
  (delete/archive) le **PROPONE**, il **Capitano decide**.

## 4. Confini e regole
- **Dottore = salute/context degli AGENTI** (sessioni, token, refresh). **Mantenitore = salute
  dell'INFRA** (deps, disco, tool, script). Zero overlap.
- Capitano = decisore unico sulle azioni distruttive (coerente col redesign usage-monitoring).

## 5. Spartizione implementazione
| Owner | Fetta |
|---|---|
| **dev1** | Build-time gate (Dockerfile/CI) · wrapper `jht-install` · scheduling Mantenitore (slot su `doctor_schedule.py`/watchdog) |
| **dev2** | Tool-health runtime → `tools_health` nel tick (pattern `weekly_pace`) · core skill `maintainer-sweep` |
| **dev3** | Skill **RESILIENCE** condivisa · regola-prompt **no-silent-degrade** · `mantenitore.md` (persona agente, gemello di `dottore.md`) |

## 6. Domande aperte
- Quanto del browser bakare: `--with-deps --only-shell chromium` (scelto, -602MB vs full) basta per
  tutti i casi LinkedIn, o serve la full chromium per alcune navigazioni?
- `tools_health` nel tick: quali tool entrano nel set "critico" (LinkedIn/browser sicuro; quali
  altri?).
- GC tmp orfani: soglia età + come riconoscere "orfano" in modo safe (sessione non in `tmux ls` da
  >N h).

## 7. Riferimenti
- `project_linkedin_libatk_image_bug.md` (la scoperta)
- Fix LinkedIn: dev1@9db78625d (Dockerfile `--with-deps`) + dev1@1fd41d0a6 (prompt RULE-03 careers canonica)
- `usage-monitoring-redesign-design.md` (template + single-writer rule)
- Chat coordinamento `coordination/chat.jsonl` (panel 2026-06-13)
