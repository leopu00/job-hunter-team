# PR #223 — Rischio 4/5: igiene del log di `pager-unstick-watchdog.sh`

**Data:** 2026-09-01 · **Branch:** `lee-launcher-fixes` · **Commit:** `11eca0aa9c`
**File sotto esame:** `.launcher/pager-unstick-watchdog.sh:28-34`, `cli/src/commands/pid1.js:360-388`, `.launcher/daemon-lib.sh:28-52`

---

## ⚖️ Verdetto

**Confermato a metà, e la metà confermata ha una causa diversa da quella ipotizzata nel ticket.**

* **(a) `mkdir -p` mancante → scritture cieche: NON confermato sul percorso reale.**
  `spawnLabeled` esegue `mkdirSync(logDir, { recursive: true })` (`cli/src/commands/pid1.js:373-374`)
  **immediatamente prima** di `spawn()`, e il pager-watchdog nasce **esclusivamente** da lì
  (`pid1.js:811`). La directory esiste per costruzione al primo `printf`. Resta un residuo reale
  ma stretto: il ramo **EACCES** (bind mount Windows non riparato) e l'invocazione manuale/dev.
  E anche lì non è «silenzioso»: bash stampa `cannot create … : Permission denied` su stderr a
  **ogni** chiamata di `log()`, e pid1 quella stderr la raccoglie. È rumoroso e privo di contenuto,
  che è peggio del silenzio ma non è il silenzio.

* **(b) Nessuna rotazione: confermato, ma la convenzione vigente non è `jht_daemon_log`.**
  Nessuno dei daemon bash spawnati da pid1 ruota il proprio diario. Tutti però lo scrivono con
  **`tee -a`**, e per questo la loro stdout finisce in `$JHT_HOME/logs/<label>.log`, che **pid1
  ruota** a 5 MB (`pid1.js:376-381`). Il nuovo script usa `>>` invece di `tee -a`: è quindi
  **l'unico diario del container che non ha nessuna copia ruotata da nessuna parte**, e anche
  l'unico invisibile a `docker logs`. La riga difettosa è **una sola**, la `:32`.

* **(5) Igiene del contenuto: nessun rilievo.** Lo script logga solo nomi di sessione canonici e
  `jht-tmux-send` non stampa mai contenuto del pane né corpo del messaggio. Rispetta la disciplina
  di `codex-auth-healer.sh`, che è il precedente esatto.

**Raccomandazione: non bloccante da solo** (correttamente sotto il rischio 1/5), ma il fix è di
tre righe e deve viaggiare insieme a quello della finestra di rilevazione — perché è proprio
quel difetto a rendere concreto lo scenario di crescita del §3.

---

## 1. Chi crea `$JHT_HOME/logs`, e quando

### 1.1 La catena di avvio, verificata

| # | Tappa | Crea `logs/`? | Riferimento |
|---|-------|---------------|-------------|
| 1 | `Dockerfile` (`ENV JHT_HOME=/jht_home`) | ❌ nessuna `RUN mkdir` per `logs` | `Dockerfile:15` (grep `logs` sul Dockerfile: zero occorrenze) |
| 2 | `docker-compose.yml` bind `${HOME}/.jht:/jht_home` | ❌ Docker crea solo il mountpoint | `docker-compose.yml:115` |
| 3 | `.launcher/entrypoint.sh` | ❌ crea solo la probe `$d/.jht-write-probe-$$` e la rimuove | `entrypoint.sh:17-32` |
| 4 | `exec node /app/cli/bin/jht.js pid1` | — | `entrypoint.sh:39` |
| 5 | **`spawnLabeled(...)` — qualunque, la prima** | ✅ `mkdirSync(logDir, {recursive:true})` | `pid1.js:373-374` |

La tappa 5 è quella decisiva e **non è probabilistica**: `mkdirSync` sta *dentro* `spawnLabeled`,
prima della `spawn()` della riga `pid1.js:361`. Quindi ogni figlio, incluso il pager-watchdog
(`pid1.js:811`), trova la directory già creata **dal proprio stesso spawn**. Non serve nemmeno
ragionare sull'ordine con `spawnLabeled('migrate')` (`pid1.js:498`) o `spawnLabeled('watchdog')`
(`pid1.js:777`), che comunque vengono prima.

`JHT_HOME` non può divergere fra i due lati: pid1 lo **hardcoda** a `/jht_home` (`pid1.js:38`) e il
Dockerfile esporta lo stesso valore (`Dockerfile:15`), che è anche il default del bash
(`pager-unstick-watchdog.sh:28`).

> 📌 Non esiste, oggi, nessun altro invocatore: grep su tutto il repo per `pager-unstick` trova
> solo lo script stesso, `pid1.js:46/810-820` e i doc di review. Nessun tmux, nessun
> `start-agent.sh`, nessuna riga di compose.

### 1.2 Il residuo vero: EACCES sul bind mount Windows

Il problema noto è documentato in testa a `entrypoint.sh:4-8`, che cita **testualmente** il sintomo
storico: «`[watchdog] mkdir /jht_home/logs: Permission denied`». La riparazione è la write-probe +
`sudo chown -R jht:jht` (`entrypoint.sh:19-31`), che però ammette esplicitamente la resa:

```
[entrypoint] WARNING: $d still not writable after chown — check the Docker Desktop
             file-sharing settings for this path      # entrypoint.sh:30
```

In quello stato il comportamento **diverge fra i daemon**:

* `mkdirSync` in `spawnLabeled` lancia → il `catch` di `pid1.js:386-388` stampa
  `log capture for 'pager-unstick' disabled: …` e prosegue con `fileStream = null`. Lo spawn avviene
  comunque: stdout/stderr del figlio restano su `docker logs`.
* `agent-watchdog.sh` scrive con `tee -a` (`:111`): `tee` fallisce sul file ma **la riga esce
  comunque su stdout** → `docker logs`. Il watchdog resta leggibile.
* `pager-unstick-watchdog.sh` scrive con `>>` (`:32`): la redirezione fallisce, bash emette
  `bash: /jht_home/logs/pager-unstick-watchdog.log: Permission denied` su stderr e **il contenuto
  della riga va perso**. Con `set -u` e **senza `set -e`** (`:24`) la funzione ritorna 1 e il loop
  prosegue: il watchdog **agisce** (manda `q`, manda i nudge) ma non lascia traccia di *cosa* ha
  fatto. Non muore, non viene rispawnato in loop — il ramo `pid1.js:812-825` non scatta perché il
  processo non esce.

**Questo è l'unico modo reale in cui la premessa (a) si avvera**, e la cura è la stessa della (b):
`tee -a`.

---

## 2. Censimento dei log sotto `$JHT_HOME/logs`

### 2.1 Daemon bash spawnati da pid1 (`spawnLabeled`)

| Diario | Scritto da | `mkdir -p`? | `tee`? | Copia ruotata? |
|---|---|---|---|---|
| `agent-watchdog.log` | `agent-watchdog.sh:60,111` | ✅ `:106` | ✅ | ✅ via `logs/watchdog.log` (`pid1.js:777` + `:376-381`) |
| `doctor-watchdog.log` | `doctor-watchdog.sh:43` | ✅ `:18` | ✅ | ✅ — il label pid1 è `doctor-watchdog` (`pid1.js:872`), quindi **è letteralmente lo stesso file** che pid1 apre e ruota |
| `auto-report.log` | `auto-report-loop.sh:25` | ✅ `:17` | ✅ | ✅ — stesso caso, label `auto-report` (`pid1.js:839`) |
| `welcome-send.log` | `welcome-send.sh:21-22,34` | ✅ `:22` | ✅ | ➖ one-shot al boot, crescita nulla |
| `codex-auth-healer.log` | `codex-auth-healer.sh:35,44` | ✅ `:39` | ✅ | ✅ — `start-agent.sh:326` gli passa lo **stesso** path via `jht_daemon_log` |
| **`pager-unstick-watchdog.log`** | **`pager-unstick-watchdog.sh:29,32`** | **❌** | **❌** | **❌ nessuna** |

### 2.2 Daemon detached (`setsid`) — la famiglia di `jht_daemon_log`

Tutti passano da `jht_daemon_log` (mkdir + rotazione 5 MB, `daemon-lib.sh:32-52`), che
`start-agent.sh:26` sorgea una volta:

`sentinel-bridge.log` (`start-agent.sh:219`) · `pacing-bridge.log` (`:237`) ·
`heartbeat-bridge.log` (`:258`) · `window-ratio-meter.log` (`:276`) · `token-meter.log` (`:291`,`:440`) ·
`agent-vitals.log` (`:308`,`:460`) · `codex-auth-healer.log` (`:326`) · `tg-bridge-<role>.log` (`:412`).

### 2.3 Registri append-only *per progetto* (non diari, non vanno ruotati)

`agent-recoveries.tsv` (`agent-watchdog.sh:82`, motivazione esplicita alle righe 76-79) ·
`logs/containment/*.txt` (`agent-watchdog.sh:559-568`, un file per evento, `chmod 600`) ·
`stepcap.jsonl` / `idle-nudge.jsonl` / `throttle-engine.jsonl` (`stepcap-watchdog.py:70-71,872`) ·
`messages.jsonl` (`jht-tmux-send:160`) · `sentinel-data.jsonl`, `dottore-actions.jsonl`,
`mantenitore-logbook.jsonl`, `telegram-sent.jsonl`. I file di flap (`bridge-flap-*`,
`bridge-escalate.ts`) si potano da soli con una rolling window (`agent-watchdog.sh:446-450`).

### 2.4 Che cosa dice il censimento

1. **Nessun daemon bash di pid1 ruota il proprio diario da sé.** Su questo il nuovo script è
   *conforme*: il ticket sopravvaluta la deviazione.
2. **La rotazione, per quella famiglia, arriva gratis dal `tee`.** Cinque daemon su sei hanno una
   copia ruotata; il sesto è il nuovo. Il `tee` non è cosmesi né semplice observability: **è il
   meccanismo di rotazione vigente**.
3. `jht_daemon_log` è la convenzione della famiglia **detached**, dove non esiste un pid1 che
   ruoti al posto tuo. Adottarla anche qui è legittimo e più esplicito (§4), ma va sommato al
   `tee`, non messo al suo posto.
4. Nota minore: lo script hardcoda `"$JHT_HOME/logs/…"` (`:29`) ignorando `JHT_LOGS_DIR`
   (`.launcher/config.sh:16`), che `jht_daemon_log_dir` invece rispetta (`daemon-lib.sh:29`).
   È lo stesso peccato veniale di `codex-auth-healer.sh:35`.

---

## 3. Crescita reale del file

Misure sulle stringhe effettive (timestamp `date -u +%FT%TZ` = 20 char, più `[`, `]`, spazio = 23 B):

| Riga | Sorgente | Byte |
|---|---|---|
| avvio | `:34` | ~67 |
| `stuck in pager, dismissing` | `:44` | ~71 |
| `dismissed cleanly, no resume needed` | `:52` | ~80 |
| `sent resume nudge` | `:50` | ~76 |
| output di `jht-tmux-send` | `jht-tmux-send:445` | ~56 (una riga) |

Una rilevazione «pulita» costa quindi **~151 B**; una con nudge ~205 B.

| Scenario | Rilevazioni/giorno | Crescita | Tempo per 5 MB |
|---|---|---|---|
| **Nominale** (nessun pager) | 0 | **67 B per avvio del processo** | mai |
| **Reale**, dato del commit (9 eventi in 2,5 h su una passata CV/giorno) | ~9 | 1,4 KB/g | ~10 anni |
| **Reale continuo** (3,6 ev/h × 24 h) | ~86 | 13 KB/g | ~1 anno |
| **Patologico, 1 sessione** falso-positivo permanente | ~4 000 | **607 KB/g** | **8 giorni** |
| **Patologico, 4 sessioni** | ~14 400 | **2,2 MB/g** | **2,3 giorni** |

Note sui due scenari patologici, che sono i soli che contano:

* **Sono resi plausibili dal rischio 1/5**, non da un'ipotesi teorica: `capture-pane -S -3` senza
  `-E` ispeziona **53 righe** invece di 3 (vedi `223-1-finestra-rilevazione.md`), e i due `grep`
  indipendenti (`:42-43`) matchano *questo stesso documento* o il sorgente del watchdog aperto in
  un pane. Un falso positivo così **non si risolve mai**: la `q` non toglie di mezzo il testo che
  lo causa, quindi si ripete a ogni tick finché la schermata cambia.
* Il loop **rallenta se stesso**: 1 s di `sleep` per sessione che matcha (`:46`) e, sul ramo
  interrupted, la latenza di `jht-tmux-send` (fino a ~90 s quando la consegna non si verifica,
  `jht-tmux-send:452,475`). Con il nudge attivo il ritmo scende a ~800 cicli/giorno → ~160 KB/g.
  Il ramo *senza* nudge — cioè `dismissed cleanly`, il più probabile su un falso positivo — è il
  peggiore per il disco perché non paga quella latenza.
* **Non c'è troncamento ai restart**: il file è in append e vive sul bind `${HOME}/.jht`
  (`docker-compose.yml:115`), cioè sul disco del VPS. Su un Hetzner piccolo, 800 MB/anno di un
  singolo diario non fanno cadere il team da soli, ma concorrono con `jobs.db` e gli allegati.

**Il rischio è concreto ma di secondo ordine**, ed è interamente derivato dal rischio 1/5: sistemata
la finestra di rilevazione, resta lo scenario «reale continuo», che sfiora la soglia in un anno.
La correzione va comunque fatta, perché costa tre righe e chiude anche il buco EACCES del §1.2.

---

## 4. Vale la pena usare `jht_daemon_log`? Effetti collaterali del sourcing

**Sì, e il sourcing è innocuo.** `daemon-lib.sh` è dichiaratamente inerte — «Non esegue nulla di per
sé: definisce solo funzioni» (`:6`) — e l'ispezione conferma:

| Effetto | Valutazione |
|---|---|
| Definisce `JHT_LAUNCHER_DIR`, `JHT_PROC_KILL_PY`, `JHT_DAEMON_LOG_MAX_BYTES` (`:23-26`) | Variabili **non esportate** → invisibili ai figli (`tmux`, `jht-tmux-send`). Nessuna collisione con i nomi usati dal watchdog. |
| `$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)` (`:23`) | `cd` in **subshell**: la cwd dello script non cambia. `BASH_SOURCE` esiste sempre sotto `bash`, e pid1 invoca `/bin/bash` esplicito (`pid1.js:811`) → nessun problema con `set -u`. |
| Definisce `jht_kill_by_marker` (`:70-87`) | Solo definizione, mai invocata. È però una funzione **che uccide processi per marker in `/proc`**: portarla nello scope di un daemon che gira in loop è un foot-gun latente, da segnalare in un commento e nient'altro. |
| `_jht_kill_scan_fallback` (`:57-68`) | Idem. |
| `set -e` / `trap` / redirezioni globali | Assenti. Nessuna interferenza con `set -u` della riga `:24`. |

**Caveat che va scritto nel codice:** `jht_daemon_log` ruota **solo quando viene chiamata**
(`daemon-lib.sh:38-50`), perché nasce per daemon che risolvono il path **allo spawn**
(`start-agent.sh:219` ecc.). Un loop infinito che la chiama una volta sola non ruoterebbe mai —
esattamente la stessa limitazione di `spawnLabeled`, che fa lo `statSync` una volta per spawn
(`pid1.js:377-381`). Per un daemon che può restare su per mesi va **richiamata periodicamente**.
Costa uno `stat` ogni ora: irrilevante.

---

## 5. Igiene del *contenuto*: nessun rilievo

**Cosa finisce nel file, verificato riga per riga:**

* `:44`, `:50`, `:52` loggano **solo `$s`**, cioè un `#{session_name}` tmux. I nomi sono canonici e
  privi di PII (`agent-watchdog.sh:300-305`: `ASSISTENTE`, `SCOUT-3`, `CRITICO-S1`…).
* `$tail3` e `$after` (`:39`, `:47`) — **il contenuto del pane** — sono usati **solo** come input di
  `grep -q` (`:42-43`, `:48`). Non compaiono in nessuna chiamata a `log`, non vengono salvati,
  non vengono echeggiati. ✅
* `jht-tmux-send "$s" "…" >>"$LOG" 2>&1` (`:49`): audit del sender (476 righe). Su stdout stampa
  **una sola** riga, `jht-tmux-send: ${#message} chars to $session (try …)` — la **lunghezza** del
  messaggio, non il testo (`jht-tmux-send:445`). Su stderr, cinque frasi fisse
  (`:79,139,382,452,475`) che contengono al più nomi di sessione e di ruolo. **Nessun `set -x`,
  nessun dump del pane**, benché il pane sia catturato in `$pane` più volte. Il corpo del messaggio
  finisce solo in `logs/messages.jsonl` (`:160`), che è il registro *del sender*, non il nostro
  diario — e qui il corpo è comunque il letterale `"Continue where you left off."`.

**Confronto con le due convenzioni esistenti**, entrambe rispettate:

* `codex-auth-healer.sh:161-171` è il precedente esatto: cattura il pane, ci fa `grep`, e logga
  **solo il verdetto** (`$sess: AUTH FAILURE detected …`). Mai il pane.
* L'unico posto del repo dove il contenuto di un pane tocca il disco è
  `capture_for_containment` (`agent-watchdog.sh:556-570`), e lì è **deliberato**, isolato in
  `logs/containment/`, un file per evento, con **`chmod 600`** (`:568`). Il diario del pager non
  contiene pane, quindi il `0644` di default è coerente col resto dei `logs/*.log`.

**Nessuna via di esfiltrazione oltre il disco locale:** `logs/` non viene mai spinto su Supabase
(nessun riferimento a `logs/` in `cli/src/lib/cloud-*.js`, `periodic-push.js`, `bootstrap-push.js`)
e l'API loopback non serve file di log — li usa solo come proprio diario
(`cli/src/lib/api/server.js:61`, `tmux-read.js:126`).

⚠️ **Unico appunto, di accoppiamento:** `2>&1` sulla riga `:49` è un canale aperto verso un file
non ruotato. Oggi `jht-tmux-send` è disciplinato, ma cattura il pane in `$pane` in quattro punti; il
giorno in cui qualcuno aggiunge un `echo "$pane"` diagnostico, quel contenuto atterrerebbe qui in
silenzio. Il `tee` + rotazione proposti sotto limitano il danno; il test 4 del §6 lo rende una
regressione visibile.

---

## 6. Proposta

### 6.1 Diff (testuale — **non applicato**)

```diff
--- a/.launcher/pager-unstick-watchdog.sh
+++ b/.launcher/pager-unstick-watchdog.sh
@@ -22,15 +22,38 @@
 # by pid1 at container boot, log-and-continue on any single-session
 # failure rather than fail-fast.
 set -u
 
 export PATH="/app/agents/_tools:${PATH}"
 
+# jht_daemon_log — crea $JHT_HOME/logs (rispettando JHT_LOGS_DIR) e ruota a
+# 5 MB, con la soglia allineata a quella di spawnLabeled
+# (cli/src/commands/pid1.js:376-381). Stessa forma di sourcing di
+# bridge-control.sh:22. NB: il file definisce anche jht_kill_by_marker —
+# qui NON va usata, il pager-watchdog non uccide processi.
+. "$(dirname "$0")/daemon-lib.sh"
+
 JHT_HOME="${JHT_HOME:-/jht_home}"
-LOG="$JHT_HOME/logs/pager-unstick-watchdog.log"
+LOG="$(jht_daemon_log pager-unstick-watchdog.log)"
 INTERVAL_SEC="${JHT_PAGER_WATCHDOG_INTERVAL:-20}"
+# jht_daemon_log ruota solo quando viene CHIAMATA (daemon-lib.sh:38-50): è
+# nata per daemon che risolvono il path allo spawn. Questo gira per mesi
+# senza riavvii, quindi la richiamiamo ogni ~1h (180 tick @ 20s): è uno
+# `stat` all'ora, e la finestra patologica riempie 5 MB in giorni, non in ore.
+ROTATE_EVERY_TICKS="${JHT_PAGER_WATCHDOG_ROTATE_TICKS:-180}"
+tick=0
 
-log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
+# `tee -a`, non `>>`: è la forma di OGNI altro daemon bash spawnato da pid1
+# (agent-watchdog.sh:111, doctor-watchdog.sh:43, auto-report-loop.sh:25,
+# codex-auth-healer.sh:44) e non è cosmesi. Mandare la riga anche su stdout
+# la fa arrivare in `docker logs` E in $JHT_HOME/logs/pager-unstick.log, che
+# pid1 ruota per conto suo: è così che gli altri cinque diari hanno una copia
+# ruotata. Con il solo `>>` questo sarebbe l'unico log del container senza
+# nessuna copia ruotata — e, se il bind mount arriva non scrivibile
+# (entrypoint.sh:30), l'unico a perdere il CONTENUTO delle righe invece di
+# degradare su docker logs.
+log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }
 
 log "pager-unstick-watchdog up — interval=${INTERVAL_SEC}s"
 
 while true; do
+  if [ $((tick % ROTATE_EVERY_TICKS)) -eq 0 ]; then
+    LOG="$(jht_daemon_log pager-unstick-watchdog.log)"
+  fi
+  tick=$((tick + 1))
   sessions=$(tmux list-sessions -F '#{session_name}' 2>/dev/null || true)
```

Tre note sul diff:

1. `. "$(dirname "$0")/daemon-lib.sh"` invece del path assoluto `/app/.launcher/…`: è l'idioma già
   usato da `bridge-control.sh:22`, funziona sia in container che nei test da worktree.
2. Il `tee` raddoppia i byte scritti (diario + `logs/pager-unstick.log`), ma la seconda copia è
   **limitata a 10 MB** dalla rotazione di pid1. Nello scenario patologico peggiore il totale su
   disco passa da «illimitato» a «5 MB (+5 `.old`) + 10 MB».
3. Il fix **non sostituisce** quello del rischio 1/5. Da solo mette un tetto ai byte di un watchdog
   che continua a mandare `q` sbagliate.

### 6.2 Test proposto

Nuovo file `tests/test_pager_unstick_watchdog_log_hygiene.py`, sulla forma di
`tests/test_agent_watchdog_recovery_notice.py:17-24` (estrazione del *prelude* fino al marker,
esecuzione delle funzioni **vere** con `bash` e `tmp_path`, zero tmux, zero container):

| # | Test | Tipo | Perché |
|---|------|------|--------|
| 1 | `test_il_prelude_crea_la_directory_dei_log_se_manca` — `JHT_HOME=tmp_path` **senza** `logs/`; esegue prelude + `log "ciao"`; asserisce che `tmp_path/logs/pager-unstick-watchdog.log` esiste e contiene `ciao`, e che stderr **non** contiene `No such file` | comportamentale | è la (a) del ticket, resa impossibile per costruzione invece che per fortuna dell'ordine di boot |
| 2 | `test_la_riga_esce_anche_su_stdout` — asserisce `"ciao" in result.stdout` | comportamentale | blinda il **contratto del `tee`**, che è ciò che dà la copia ruotata e la sopravvivenza al bind non scrivibile. Un ritorno a `>>` passerebbe il test 1 ma non questo |
| 3 | `test_il_log_ruota_oltre_la_soglia` — `JHT_DAEMON_LOG_MAX_BYTES=100`, pre-crea il log con 200 B; dopo il prelude asserisce che `.log.old` esiste e che il file vivo è < 100 B | comportamentale | prova la rotazione **senza scrivere 6 MB** (PC con I/O fragile) |
| 4 | `test_il_log_non_contiene_mai_il_contenuto_del_pane` — regex sul sorgente: nessuna riga `log "…"` può contenere `$tail3`, `$after` o `$pane` | source-assert | §5: è la regola che non deve mai regredire, e nessun test comportamentale la coglie perché oggi il difetto semplicemente non c'è |
| 5 | `test_la_rotazione_viene_richiamata_dentro_il_loop` — l'indice di `while true` è **minore** dell'indice della seconda occorrenza di `jht_daemon_log` | source-assert ordinale (stessa forma del test 2 di `214-2-timeout-portability.md:249`) | senza questo, la chiamata periodica può sparire in un refactor e la rotazione tornerebbe a essere solo-allo-spawn, in silenzio |

Marker per `_prelude()`: `log "pager-unstick-watchdog up` (`:34`), cioè lo stesso schema
dell'`assert marker in source` di `test_agent_watchdog_recovery_notice.py:21`.

Esecuzione mirata, secondo la regola «niente suite intere su questo PC»:
`python -m pytest tests/test_pager_unstick_watchdog_log_hygiene.py -q`.
