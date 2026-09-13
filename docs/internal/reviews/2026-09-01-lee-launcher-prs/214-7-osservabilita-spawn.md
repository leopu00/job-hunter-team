# PR #214 — rischio 7/7: osservabilità dello spawn

**Domanda del proprietario:** *«abbiamo un log di cosa fallisce? non sarebbe male
capire anche PERCHÉ l'ASSISTENTE sta fallendo così tante volte nella partenza.»*

**Risposta breve:** un log c'è, ma dice solo il SINTOMO. Con quello che si scrive
su disco oggi si sarebbe potuto stabilire *che* ogni tentativo moriva su
`concurrent spawn` e *da quando* — **non** *perché*, cioè chi teneva il lock.
Quella parte è stata trovata a mano su una macchina viva, e se il container
fosse stato ricreato prima dell'ispezione sarebbe sparita per sempre: nessun
file conserva PID, età o cmdline del processo appeso.

E c'è una scoperta a valle: **esiste una seconda sorgente, indipendente dal tmux
appeso, dello stesso errore `concurrent spawn`, e colpisce per costruzione
proprio ASSISTENTE / CAPITANO / MENTOR** — vedi § 4, ipotesi H1. Il codice
stesso documenta il meccanismo altrove e lì lo chiude; sul ramo agente no.

---

## 1. Inventario dei log che toccano uno spawn

| File (sotto `$JHT_HOME/logs/`, bind-mount) | Chi scrive | Formato | Rotazione / ritenzione |
|---|---|---|---|
| `agent-watchdog.log` | `agent-watchdog.sh:60`, funzione `log()` `:108-112` (`tee -a`) **+ output grezzo** di `jht team start` `:244`, `start-agent.sh` `:350`, `:509`, `:534` | testo, `[ISO8601] msg` + stdout/stderr dei figli | **NESSUNA.** Non è in `SOURCES` di `shared/skills/log_archive.py:41-47` → cresce all'infinito |
| `watchdog.log` | `cli/src/commands/pid1.js:777` (`spawnLabeled('watchdog')`) | testo, solo ciò che `log()` emette via `tee` su stdout | singola a 5 MB → `.old` (`pid1.js:376-381`) |
| `agent-recoveries.tsv` | `agent-watchdog.sh:82`, `record_recovery` `:189-211` | TSV `ts \t session \t observation` | **NESSUNA.** Registra **solo i recuperi RIUSCITI** (`notify_captain_recovery:219` è chiamata solo nel ramo start-OK di `ensure_agent:258`) |
| `autostart-<role>.log` | `pid1.js:296` (`spawnLabeled('autostart-'+role)`) | testo con header `=== spawn: … ===` / `=== exited code= … ===` (`pid1.js:383`, `:414-419`) | singola a 5 MB |
| `doctor-watchdog.log` | **DUE scrittori sullo stesso path**: `doctor-watchdog.sh:41-45` (`tee -a`) **e** `pid1.js:872` `spawnLabeled('doctor-watchdog')` | testo | la rotazione di pid1 (`renameSync`) sposta il file sotto l'fd aperto del `tee` → dopo la prima rotazione il `tee` continua a scrivere sull'inode orfano. Difetto latente, indipendente da #214 |
| `pager-unstick-watchdog.log` (script, `pager-unstick-watchdog.sh:29`) e `pager-unstick.log` (pid1, `:811`) | due file distinti, nessuna collisione | testo | script: nessuna; pid1: 5 MB |
| `<role>-actions.jsonl` (`dottore-actions.jsonl`, `mantenitore-actions.jsonl`) | `spawn-lib.sh:412-417` (`event:"spawn"`) e `:377-379` (`event:"spawn_failed","reason":"repl_not_up"`) | **JSONL strutturato** | nessuna |
| `stepcap.jsonl`, `idle-nudge.jsonl` | `stepcap-watchdog.py:182`, `:70-71` | JSONL | archiviate? no (non in `SOURCES`) |
| `welcome-send.log` | `welcome-send.sh:21`, `pid1.js:696` | testo | nessuna |
| daemon vari (`sentinel-bridge.log`, `pacing-bridge.log`, `heartbeat-bridge.log`, `token-meter.log`, `agent-vitals.log`, `codex-auth-healer.log`, `window-ratio-meter.log`, `tg-bridge-<role>.log`) | `jht_daemon_log` (`daemon-lib.sh:32-52`), chiamato da `start-agent.sh:219,237,258,276,291,308,326,412,440,460` | testo | **singola a 5 MB → `.old`** (`daemon-lib.sh:26,46-50`) |
| `/tmp/kickoff-<SESSION>.log` | `start-agent.sh:1261-1277` | testo | **layer effimero del container**: sparisce a ogni `--force-recreate`; sovrascritto a ogni kickoff |
| `/tmp/welcome-watchdog-<role>.log` | `start-agent.sh:1293`, `:1316-1334` | testo | idem |
| Supabase `team_commands.error` | `cli/src/lib/team-commands-poller.js:190-199` | testo, ultimi 2000 char, ANSI strippato | riga DB |

Due osservazioni sull'inventario:

1. **`start-agent.sh` non scrive NULLA su disco su nessun percorso d'errore.**
   Tutti i suoi `exit 1` (`:526`, `:549`, `:753`, `:763`, `:1121`, …) finiscono
   su stderr e basta. Lo script gira sotto `set -euo pipefail`
   (`start-agent.sh:11`), quindi molti fallimenti escono **senza nemmeno un
   messaggio proprio**. L'unica traccia persistente che lascia è indiretta:
   `team_roster.py record` a spawn **riuscito** (`:1220-1223`), per giunta
   `>/dev/null 2>&1 || true`.
2. **L'unico formato strutturato di esito-spawn che esiste già** è
   `jht_spawn_log_event` / il record `spawn_failed` di `spawn-lib.sh:377-379,
   411-417` — ma vale solo per Dottore e Mantenitore, che passano da
   `spawn-doctor.sh` / `spawn-maintainer.sh`. È il precedente da riusare (§ 5).

---

## 2. Il punto cieco: dove finisce stdout/stderr di `start-agent.sh`, per chiamante

| # | Chiamante | Riga | Cosa arriva su disco |
|---|---|---|---|
| a | **agent-watchdog → core** (ASSISTENTE, CAPITANO, MENTOR, SENTINELLA) | `agent-watchdog.sh:244` `"$NODE_BIN" "$JHT_BIN" team start "$role" >>"$LOG" 2>&1` | **UNA riga.** Il redirect c'è, ma in mezzo c'è `jht team start`: `cli/src/commands/team/start.js:290-303` cattura stdout+stderr in memoria e stampa **solo l'ultima riga non vuota** (`:301` `.split('\n').filter(Boolean).slice(-1)[0]`). Tutto il resto è **scartato in memoria** |
| b | **agent-watchdog → worker numerati** | `agent-watchdog.sh:350` `bash "$START_AGENT" "$role" "$inst" >>"$LOG" 2>&1` | **output INTEGRO** in `agent-watchdog.log`. È il percorso migliore che esiste oggi |
| c | **agent-watchdog → bridge / tg-bridge** | `agent-watchdog.sh:509`, `:534` | integro |
| d | **pid1 autostart** (boot container) | `pid1.js:296` → `logs/autostart-<role>.log` | passa da `jht team start` → di nuovo **una riga sola** (stesso `start.js:301`) |
| e | **Capitano / skill degli agenti** — `bash /app/.launcher/start-agent.sh <role> <n>` (`agents/_skills/spawn-agent/SKILL.md:14`, `session-refresh/SKILL.md:163`, `liveness-check/SKILL.md:103`, `agent-emergency/SKILL.md:112`, `critic-loop/SKILL.md:34`, `daily-restart-wave/SKILL.md:97`) | — | **NIENTE su disco.** L'output finisce nel transcript LLM del Capitano e muore lì. Per l'analisi post-hoc è perso |
| f | **Web UI → bus cloud → poller VPS** | `team-commands-poller.js:98-120` | stdout/stderr accumulati in memoria (`:106-109`); sul log del processo va **solo** `exec.exit {code}` (`:116`), **non** il corpo. Il corpo (troncato a 2000 char) va **su Supabase**, `team_commands.error` (`:190-199`). Sul VPS non resta |
| g | **sentinel-bridge → SENTINELLA-WORKER** | `sentinel-bridge.py:2400-2407` `subprocess.run([... start-agent.sh worker], capture_output=True, timeout=10)` | **buttato via integralmente**: il risultato non viene mai letto; su `TimeoutExpired`/`OSError` → `return None` silenzioso (`:2406-2407`) |
| h | **doctor-watchdog → spawn-doctor / spawn-maintainer** | `doctor-watchdog.sh:158`, `:189` `out=$(bash "$SPAWNER" 2>&1)` | **integro**, loggato sia in successo (`:160`, `:190`) sia in fallimento (`:163`, `:196`). Il modello giusto |
| i | **Electron desktop** (archiviato) | `archive/electron-desktop/main.js:1172` | mostrato in UI, non persistito. Fuori scope |

Redirezioni che buttano via output **dentro** `start-agent.sh` stesso:
`:986` warmup `claude -p` → `>/dev/null 2>&1 || true`; `:1203` `spawn_stagger.py`
→ `2>/dev/null || echo 0`; `:1222` `team_roster.py record` → `>/dev/null 2>&1
|| true`; `:1178` il watcher auto-accept → `>/dev/null 2>&1`; `:587`, `:602-605`
estrazione provider → `2>/dev/null`.

**Sintesi del punto cieco:** l'unico percorso che chiama `start-agent.sh`
direttamente e ne conserva l'output per intero è quello dei **worker numerati**
(b) e quello del Dottore/Mantenitore (h). Il percorso dei **core** — cioè quello
dell'ASSISTENTE, che è la domanda — passa da `jht team start` e sopravvive con
**una riga**. Il percorso del **Capitano** non lascia niente.

---

## 3. Ricostruzione forense: si poteva rispondere?

### Cosa avrebbe lasciato l'incidente, file per file

Ogni tentativo fallito dell'ASSISTENTE avrebbe scritto in
`$JHT_HOME/logs/agent-watchdog.log` (e, per le sole righe `log()`, anche in
`logs/watchdog.log`) questa tripletta:

```
[2026-08-2xT..:..:..Z] agent assistente: session ASSISTENTE is inactive — relaunching via jht team start
  ✗ ASSISTENTE — Error: timed out waiting for the concurrent spawn of 'ASSISTENTE'.
[2026-08-2xT..:..:..Z] agent assistente: start FAILED (rc=1) — retrying at the next tick
```

Riga 1 da `agent-watchdog.sh:243`; riga 2 è l'unica superstite di `start.js:301`,
il cui testo viene da `start-agent.sh:549`; riga 3 da `agent-watchdog.sh:261`.
Fra riga 1 e riga 3 passano ~30 s reali, i `flock -w 30` di `start-agent.sh:548`.

`agent-recoveries.tsv` sarebbe stato **vuoto** per quelle 37 ore: si scrive solo
sui recuperi riusciti (§ 1). Assenza informativa, ma va letta in negativo.

Nessuna traccia sarebbe finita in `token-meter`, `stepcap.jsonl`,
`sentinel-*`: quei file non guardano lo spawn.

### Cosa NON si sarebbe potuto ricavare

1. **Il primo evento, quello che si è appeso, non lascia nessuna riga di esito.**
   Il processo non ritorna mai, quindi non arriva mai né a `:1209` (`✓ … started`)
   né a un `exit`. In `agent-watchdog.log` si vede una riga «relaunching…» **senza
   la sua "start OK/FAILED"** — un buco che bisogna notare a occhio, e che non è
   segnalato da nulla.
2. **Nessun dato sul detentore del lock.** Il messaggio di `start-agent.sh:549`
   nomina il sintomo (`concurrent spawn`) e nasconde il colpevole: niente PID,
   niente età, niente cmdline. È esattamente il salto che è stato colmato a mano
   ispezionando i processi sulla macchina viva.
3. **Nessuna durata e nessun rc per tentativo.** «30 s» si deduce dai timestamp
   delle righe 1 e 3, non è misurato.
4. **Dal 2026-08-31 (PR #214) la riga superstite può essere falsa.** Se `tmux`
   fallisce subito con rc≠0 non-timeout, `start-agent.sh:1121` afferma comunque
   *"did not return within 20s"* e la vera riga di errore di `tmux` viene scartata
   da `start.js:301` — vedi `214-4-error-message.md`.
5. **Ritenzione asimmetrica.** `agent-watchdog.log` non ruota mai (utile qui, ma
   cresce senza limite e non è archiviato da `log_archive.py:41-47`); il gemello
   `watchdog.log` ruota a 5 MB con **una sola** generazione `.old`, quindi un
   incidente più lungo o più verboso lo sovrascrive.

### Verdetto

**Parzialmente NO.** Con i log odierni si rispondeva a *«l'Assistente non parte
perché ogni tentativo muore su "concurrent spawn"»* e a *«da quando»*. Non si
rispondeva a *«perché»*: il passaggio da «il lock è occupato» a «lo occupa un
`tmux new-session` orfano di 15 ore» **non è ricostruibile da nessun file su
disco**, solo da un'ispezione live di `/proc`. Su un'installazione di un utente,
dove la reazione naturale è riavviare il container, quella prova non esiste più.

---

## 4. Ipotesi sulla causa profonda, in ordine di plausibilità

### H1 — l'fd 9 del flock ereditato dai figli detached di `start-agent.sh` *(alta, e verificabile subito)*

Non è l'ipotesi del tmux appeso: è una **seconda sorgente indipendente dello
stesso errore**, e spiega perché è l'ASSISTENTE a fallire tanto.

Il codice documenta il meccanismo da solo, nel ramo bridge — `start-agent.sh:403-409`:

> `9>&-` NON è decorativo: il lock di flock vive nella *open file description*,
> che i figli EREDITANO. […] senza questa chiusura il fd 9 resta aperto in loro e
> il lock non viene mai rilasciato […] ogni respawn successivo […] andrebbe in
> timeout dopo 30s.

Il ramo bridge lo chiude (`:418`, `9>&- &`). **Il ramo agente non lo chiude in
nessuno dei tre figli detached che lancia dopo aver preso il lock a `:547`:**

| Figlio | Riga | Vita massima | Chiude fd 9? |
|---|---|---|---|
| watcher auto-accept dei dialog TUI | `:1148-1178` | 60 × 2 s = **120 s** | no (`:1178` `>/dev/null 2>&1 < /dev/null &`) |
| `_kickoff` | `:1262-1277` | `tui_wait_ready` `max_wait=120` (`tui-helpers.sh:19,72`) + retry di send | no (`:1277`) |
| watchdog del welcome | `:1317-1334` | 3 × `sleep 90` = **270 s** | no (`:1334`) |

E il terzo, `_welcome_kickoff`, è chiamato **solo per assistente, capitano e
mentor** (`:1338`, `:1349`, `:1358`). Conseguenza diretta: dopo **ogni** spawn di
ASSISTENTE, `locks/start-ASSISTENTE.lock` resta preso fino a ~270 s da un
processo che `start-agent.sh` ha già lasciato andare, e qualunque tentativo
concorrente in quella finestra aspetta 30 s e muore con `concurrent spawn`.

Perché la finestra si apre così spesso: `is_session_alive`
(`agent-watchdog.sh:150-175`) considera viva una sessione solo se
`pane_current_command` è nella whitelist `:165`
(`kimi|claude|codex|node|python|python3`). Durante il boot della TUI il pane è
ancora `bash` — e pid1 stesso stima che «l'init vero dura ~15-30 s»
(`pid1.js:319`). Un tick del watchdog (30 s, `agent-watchdog.sh:59`) che cade in
quella finestra dichiara **ZOMBIE**, killa la sessione (`:170-171`) e fa
ripartire il ciclo, mentre il figlio detached del giro precedente tiene ancora il
lock. È un loop auto-sostenuto che produce esattamente la firma osservata.

Aritmetica coerente (indizio, non prova): 756 tentativi in 37 h ≈ uno ogni
~2,9 min, cioè ~6 tick — dello stesso ordine delle finestre 120 s / 270 s, non
del tick da 30 s.

**Evidenza necessaria e come raccoglierla:** vedi § 4-bis, blocco A. È
**indipendente da Windows**: si verifica sulla VPS di produzione così com'è.

### H2 — `tmux new-session -c "$AGENT_DIR"` che si blocca sul bind mount Windows *(alta per l'hang originale)*

`$AGENT_DIR` sta sotto `$JHT_HOME`, che su Docker Desktop for Windows è un bind
mount servito da gRPC-FUSE (o 9p). `tmux new-session -c` fa `chdir()` nella
directory e la tiene come cwd della sessione per tutta la sua vita. Una
`chdir()`/`stat()` che non ritorna su un filesystem virtuale mette il processo in
stato **D (uninterruptible sleep)**: spiega alla lettera «né crea la sessione, né
esce, né fallisce» e i 15+ ore. Spiega anche perché `timeout 20` (`:1120`) è un
palliativo: `SIGTERM` non tocca un processo in D — vedi
`214-3-timeout-value.md` / `214-2-timeout-portability.md`.

Corollario da segnalare: **lo stesso `-c` su `$JHT_HOME` senza alcun timeout** sta
in `spawn-doctor.sh:47` e `spawn-maintainer.sh:48`. Lì non c'è flock, quindi
niente lockout — ma `doctor-watchdog.sh:189` (`out=$(bash "$SPAWNER" 2>&1)`) è
**anch'esso senza timeout**, quindi un hang lì blocca il loop del doctor-watchdog
per sempre, in silenzio. Stessa classe di guasto, area non coperta da #214.

### H3 — socket del server tmux su un percorso bind-mountato *(media)*

Se `TMUX_TMPDIR` (o `/tmp`, il default `/tmp/tmux-<uid>/default`) cade su un
mount virtuale, la `connect()`/`accept()` sul socket unix passa dal filesystem
virtuale: stesso stato D, ma senza dipendere da `-c`. Distingue H3 da H2 il fatto
che l'hang si presenterebbe anche con `-c /tmp`.

### H4 — server tmux già degradato *(media)*

Il `new-session` è un **client** che si appende in attesa di risposta da un server
che è a sua volta bloccato (un pane che scrive su un fd pieno, un client
attaccato che non consuma). In questo caso il processo appeso è in `S`, non in
`D`, e anche `tmux list-sessions` si appende — differenza diagnostica netta.

### H5 — esaurimento di fd / PID, o contesa sul lock file *(bassa)*

Coerente con l'esito ma non con la durata (15 h senza recupero); resta da
escludere solo per completezza.

---

## 4-bis. Comandi diagnostici (sola lettura) per la VPS di produzione

> **Caveat che cambia la lettura dei risultati:** la VPS è Linux con bind mount
> nativi. **H2 e H3 non sono riproducibili lì** — erano specifici di Docker
> Desktop for Windows. La VPS serve a verificare **H1, H4, H5** e a stabilire il
> **baseline** (dopo uno spawn normale, quanto resta preso il lock?).

**A — H1: chi tiene il lock, e per quanto** (l'immagine è `node:22-bookworm-slim`,
niente `lsof`/`fuser`: si va di `/proc`)

```sh
# stato dei lock
docker exec jht sh -c 'ls -la /jht_home/locks/'

# CHI ha il fd aperto su un lock di spawn: pid, età del processo, cmdline
docker exec jht sh -c '
for p in /proc/[0-9]*; do
  for f in "$p"/fd/*; do
    t=$(readlink "$f" 2>/dev/null) || continue
    case "$t" in */locks/start-*)
      printf "%s  age=%ss  %s\n  -> %s\n" "${p#/proc/}" \
        "$(( $(date +%s) - $(stat -c %Y "$p") ))" \
        "$(tr "\0" " " < "$p/cmdline" | cut -c1-140)" "$t" ;;
    esac
  done
done'

# il lock è preso ADESSO? (non distruttivo: il file è a 0 byte per costruzione)
docker exec jht sh -c 'exec 9>/jht_home/locks/start-ASSISTENTE.lock; \
  flock -n 9 && echo FREE || echo HELD'

# baseline: subito dopo uno spawn riuscito, ripetere il blocco sopra a
# +10s / +60s / +150s / +300s. Se a +150s risulta ancora HELD con un
# `sh -c` detached come detentore, H1 è confermata.
```

**B — processi appesi e loro stato**

```sh
docker exec jht ps -eo pid,ppid,etimes,stat,wchan:24,args | grep -E 'tmux|start-agent' | grep -v grep
# per ogni pid sospetto:
docker exec jht sh -c 'p=/proc/<PID>; grep -E "^(Name|State|PPid|Threads)" $p/status; \
  echo "wchan=$(cat $p/wchan 2>/dev/null)"; ls -l $p/cwd; \
  tr "\0" " " < $p/cmdline; echo'
#   State D + wchan su una funzione fs  -> H2/H3 (non atteso sulla VPS)
#   State S + tmux list-sessions appeso -> H4
```

**C — traccia storica già su disco**

```sh
docker exec jht sh -c 'grep -c "concurrent spawn" /jht_home/logs/agent-watchdog.log'
docker exec jht sh -c 'grep -n "ZOMBIE detected" /jht_home/logs/agent-watchdog.log | tail -50'
docker exec jht sh -c 'grep -n "ASSISTENTE" /jht_home/logs/agent-watchdog.log | tail -120'
docker exec jht sh -c 'grep -n "start FAILED" /jht_home/logs/agent-watchdog.log | tail -50'
docker exec jht sh -c 'awk -F"\t" "\$2==\"ASSISTENTE\"" /jht_home/logs/agent-recoveries.tsv | tail -30'
docker exec jht sh -c 'ls -l /jht_home/logs/ | sort -k5 -n | tail -25'
```

Se `ZOMBIE detected (pane_current_command='"'"'bash'"'"')` compare a ridosso di
ogni `relaunching`, la parte «perché la finestra si riapre» di H1 è confermata
dai log esistenti, senza toccare niente.

**D — H3/H4: dove vive il socket tmux**

```sh
docker exec jht sh -c 'echo "TMUX_TMPDIR=$TMUX_TMPDIR"; ls -ld /tmp/tmux-*; \
  findmnt -T /tmp; findmnt -T /jht_home; findmnt -T /jht_home/agents'
docker exec jht sh -c 'timeout 5 tmux list-sessions; echo "rc=$?"'   # rc=124 -> H4
```

---

## 5. Proposta di osservabilità minima

**Principio:** una riga strutturata **per tentativo**, scritta da
`start-agent.sh` stesso — l'unico punto che vede *tutti* i chiamanti, compreso il
Capitano — su **un solo file**, con la rotazione **che esiste già**. Nessuna
primitiva nuova: `jht_daemon_log` (`daemon-lib.sh:32-52`) è già `source`d a
`start-agent.sh:26` e dà path + rotazione singola a 5 MB, la stessa soglia di
pid1 (`daemon-lib.sh:26`). Il formato ricalca `jht_spawn_log_event`
(`spawn-lib.sh:411-417`), che è già il precedente in casa.

Quattro pezzi, in ordine di valore:

1. **Traccia per tentativo** con esito, fase, rc e durata → `logs/spawn-attempts.jsonl`.
2. **Il detentore del lock nel messaggio di timeout** — è *la* domanda a cui oggi
   non si può rispondere.
3. **`9>&-` sui tre figli detached** (§ 4, H1): non è osservabilità, è la
   rimozione di una delle due cause. Il commento che lo giustifica è già scritto
   a `start-agent.sh:403-409`.
4. **Ritenzione**: aggiungere `spawn-attempts.jsonl` e `agent-watchdog.log` a
   `SOURCES` di `log_archive.py:41-47`.

### Diff proposto (NON applicato)

```diff
--- a/.launcher/start-agent.sh
+++ b/.launcher/start-agent.sh
@@ -30,6 +30,66 @@ source "$DEV_TEAM_DIR/spawn-lib.sh"
 
+# ── Traccia dello spawn: una riga per TENTATIVO ─────────────────────────────
+# Oggi questo script non scrive NIENTE su disco: la diagnosi di un fallimento
+# dipende dal chiamante, e il chiamante principale dei core
+# (cli/src/commands/team/start.js:301) tiene solo l'ULTIMA riga di stderr.
+# Risultato osservato: 756 respawn falliti in 37h con, su disco, una sola frase
+# generica ("concurrent spawn") che nomina il sintomo e tace sul colpevole.
+# jht_daemon_log (daemon-lib.sh:32) dà path + rotazione singola a 5MB, la
+# stessa dei daemon e di pid1: niente crescita illimitata, niente primitive
+# nuove. Formato JSONL come jht_spawn_log_event (spawn-lib.sh:411).
+JHT_SPAWN_TRACE="$(jht_daemon_log spawn-attempts.jsonl)"
+JHT_SPAWN_SRC="${JHT_SPAWN_SRC:-unknown}"
+JHT_SPAWN_T0="$(date -u +%s)"
+_spawn_stage="init"
+
+spawn_trace() {
+  # <event: attempt|ok|fail> <stage> <rc> [detail]
+  local event="$1" stage="$2" rc="$3" detail="${4:-}" ts
+  ts="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
+  printf '{"ts":"%s","event":"%s","session":"%s","role":"%s","instance":"%s","src":"%s","pid":%s,"stage":"%s","rc":%s,"dur_s":%s,"detail":"%s"}\n' \
+    "$ts" "$event" "${SESSION:-?}" "${ROLE:-?}" "${INSTANCE:-}" \
+    "$JHT_SPAWN_SRC" "$$" "$stage" "$rc" \
+    "$(( $(date -u +%s) - JHT_SPAWN_T0 ))" "$detail" \
+    >>"$JHT_SPAWN_TRACE" 2>/dev/null || true
+}
+
+# Chi tiene il lock: senza questo, "concurrent spawn" nomina il sintomo e
+# nasconde la causa. Scan di /proc perche' l'immagine (node:22-bookworm-slim)
+# non ha ne' lsof ne' fuser. Best-effort: non deve mai far fallire lo spawn.
+_spawn_lock_holder() {
+  local lock="$1" p pid t f
+  for p in /proc/[0-9]*; do
+    pid="${p#/proc/}"
+    [ "$pid" = "$$" ] && continue
+    for f in "$p"/fd/*; do
+      t="$(readlink "$f" 2>/dev/null)" || continue
+      [ "$t" = "$lock" ] || continue
+      printf 'pid=%s age=%ss cmd=%s' "$pid" \
+        "$(( $(date -u +%s) - $(stat -c %Y "$p" 2>/dev/null || echo 0) ))" \
+        "$(tr '\0' ' ' <"$p/cmdline" 2>/dev/null | cut -c1-120 | tr -d '"')"
+      return 0
+    done
+  done
+  return 0
+}
+
+# Rete di sicurezza: sotto `set -euo pipefail` (riga 11) la maggior parte dei
+# percorsi d'errore esce SENZA passare da un echo. La trap garantisce che ogni
+# invocazione lasci esattamente una riga d'esito, anche quando muore dove
+# nessuno ha scritto un messaggio.
+_spawn_on_exit() {
+  local rc=$?
+  if [ "$rc" -eq 0 ]; then spawn_trace ok "$_spawn_stage" 0
+  else spawn_trace fail "$_spawn_stage" "$rc"; fi
+}
+trap _spawn_on_exit EXIT
+
@@ -545,10 +605,17 @@ fi
 if command -v flock >/dev/null 2>&1; then
   mkdir -p "${JHT_HOME:-/jht_home}/locks"
-  exec 9>"${JHT_HOME:-/jht_home}/locks/start-${SESSION}.lock"
+  _spawn_stage="lock"
+  _spawn_lock="${JHT_HOME:-/jht_home}/locks/start-${SESSION}.lock"
+  spawn_trace attempt lock 0
+  exec 9>"$_spawn_lock"
   if ! flock -w 30 9; then
-    echo "Error: timed out waiting for the concurrent spawn of '$SESSION'." >&2
+    _holder="$(_spawn_lock_holder "$_spawn_lock")"
+    echo "Error: timed out waiting for the concurrent spawn of '$SESSION' (lock holder: ${_holder:-unknown})." >&2
+    spawn_trace fail lock_timeout 1 "holder=${_holder:-unknown}"
     exit 1
   fi
 fi
+_spawn_stage="preflight"
@@ -1118,6 +1185,7 @@ else
+  _spawn_stage="tmux_new_session"
   if ! timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"; then
     echo "Error: 'tmux new-session' for '$SESSION' did not return within 20s (hung spawn)." >&2
     tmux kill-session -t "$SESSION" 2>/dev/null
     exit 1
   fi
+  _spawn_stage="tui_boot"
@@ -1175,7 +1243,10 @@ else
     done
     tmux send-keys -t "$_sess" Enter
-    ' >/dev/null 2>&1 < /dev/null &
+    # 9>&- come nel ramo bridge (righe 403-409): questo figlio vive fino a 120s
+    # DOPO l'uscita dello script e senza la chiusura eredita il lock di spawn,
+    # facendo fallire con "concurrent spawn" ogni respawn in quella finestra.
+    ' >/dev/null 2>&1 < /dev/null 9>&- &
   fi
 fi
@@ -1274,7 +1345,7 @@ _kickoff() {
     fi
-  ' </dev/null &
+  ' </dev/null 9>&- &      # vedi righe 403-409: non ereditare il lock di spawn
 }
@@ -1331,7 +1402,7 @@ _welcome_kickoff() {
     fi
-  ' </dev/null &
+  ' </dev/null 9>&- &      # fino a 270s di vita: senza questo il lock di
+                           # ASSISTENTE/CAPITANO/MENTOR resta preso 4+ minuti
 }
```

```diff
--- a/.launcher/agent-watchdog.sh
+++ b/.launcher/agent-watchdog.sh
@@ -243,7 +243,7 @@ ensure_agent() {
   log "agent $role: session $session is inactive — relaunching via jht team start"
-  if "$NODE_BIN" "$JHT_BIN" team start "$role" >>"$LOG" 2>&1; then
+  if JHT_SPAWN_SRC=agent-watchdog "$NODE_BIN" "$JHT_BIN" team start "$role" >>"$LOG" 2>&1; then
@@ -349,7 +349,8 @@ respawn_worker() {
-  if JHT_HOME="$JHT_HOME" bash "$START_AGENT" "$role" "$inst" >>"$LOG" 2>&1; then
+  if JHT_HOME="$JHT_HOME" JHT_SPAWN_SRC=agent-watchdog \
+     bash "$START_AGENT" "$role" "$inst" >>"$LOG" 2>&1; then
```

```diff
--- a/cli/src/commands/team/start.js
+++ b/cli/src/commands/team/start.js
@@ -286,7 +286,10 @@ function launchInContainer({ role, instance, mode, env, notATmuxSession, session
-  const childEnv = { ...(mode === 'fast' ? { JHT_MODE: 'fast' } : {}), ...(env || {}) };
+  // JHT_SPAWN_SRC va passato ESPLICITAMENTE: sull'host execArgvInContainer
+  // costruisce `docker exec -e K=V` solo dalle chiavi qui dentro, quindi una
+  // env del processo padre non attraversa il confine del container.
+  const childEnv = {
+    JHT_SPAWN_SRC: process.env.JHT_SPAWN_SRC || 'cli-team-start',
+    ...(mode === 'fast' ? { JHT_MODE: 'fast' } : {}), ...(env || {}),
+  };
```

```diff
--- a/shared/skills/log_archive.py
+++ b/shared/skills/log_archive.py
@@ -41,6 +41,10 @@ SOURCES = [
     {"file": "sentinel-data.jsonl", "kind": "jsonl"},
+    # Traccia degli spawn: append-only per costruzione. jht_daemon_log ruota a
+    # 5MB tenendo UNA sola generazione .old; l'archiviazione settimanale e' cio'
+    # che rende ricostruibile un incidente di 37 ore a distanza di giorni.
+    {"file": "spawn-attempts.jsonl", "kind": "jsonl"},
     {"file": "token-meter.csv", "kind": "csv"},
```

### Cosa avrebbe prodotto, sull'incidente reale

```json
{"ts":"…T02:14:03Z","event":"attempt","session":"ASSISTENTE","role":"assistente","instance":"","src":"agent-watchdog","pid":8123,"stage":"lock","rc":0,"dur_s":0,"detail":""}
{"ts":"…T02:14:33Z","event":"fail","session":"ASSISTENTE","role":"assistente","instance":"","src":"agent-watchdog","pid":8123,"stage":"lock_timeout","rc":1,"dur_s":30,"detail":"holder=pid=412 age=54120s cmd=tmux new-session -d -x 220 -y 50 -s ASSISTENTE -c /jht_home/agents/assistente"}
```

Una riga, e la domanda del proprietario è chiusa: chi, da quanto, con che
comando. `jq -r 'select(.event=="fail") | [.ts,.session,.stage,.detail] | @tsv'`
sul file dà l'intera storia delle 37 ore.

### Costo e non-obiettivi

Scritture: 2 righe per spawn riuscito, 2 per fallito, ~250 byte l'una. A regime
(4 core + worker, con TTL 12 h da `agent-watchdog.sh:66`) sono decine di KB al
giorno; la rotazione a 5 MB non si tocca mai in condizioni normali, e in
crash-loop tiene comunque il tetto. **Non** propongo di persistere lo stdout
completo di `start-agent.sh` per ogni chiamante: sarebbe la soluzione grossa e
alla domanda risponde già la riga strutturata. Resta però da valutare a parte se
`start.js:301` debba smettere di buttare tutte le righe tranne l'ultima, almeno
sul ramo `r.code !== 0` (vedi `214-4-error-message.md`).

---

## 6. Difetti collaterali emersi, fuori dallo scope di #214

1. `spawn-doctor.sh:47` e `spawn-maintainer.sh:48`: stesso `tmux new-session -c`
   su `$JHT_HOME`, **senza** timeout; e `doctor-watchdog.sh:158,189` li invoca in
   command substitution **senza** timeout → un hang lì ferma il loop del
   doctor-watchdog per sempre, senza una riga di log.
2. `start-agent.sh:1081` (ramo WSL): `tmux new-session` **senza timeout e senza
   controllo del rc** — il gemello non trattato di #214.
3. `sentinel-bridge.py:2400-2407`: output di `start-agent.sh worker` catturato e
   mai letto; `TimeoutExpired`/`OSError` → `return None` muto.
4. `doctor-watchdog.log`: due scrittori sullo stesso path (`doctor-watchdog.sh:44`
   via `tee -a` e `pid1.js:872` via `createWriteStream`); dopo la prima rotazione
   di pid1 il `tee` scrive su un inode orfano.
5. `agent-watchdog.log` e `agent-recoveries.tsv` crescono senza limite e senza
   archiviazione (`log_archive.py:41-47`).
6. La whitelist di `is_session_alive` (`agent-watchdog.sh:165`) non copre `sh` né
   varianti di nome dei binari CLI: durante il boot della TUI il pane è `bash` e
   la sessione appena creata viene dichiarata ZOMBIE e uccisa (`:170-171`).
