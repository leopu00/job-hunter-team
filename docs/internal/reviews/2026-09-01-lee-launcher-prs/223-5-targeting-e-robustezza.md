# PR #223 — rischio 5/5: targeting e robustezza del loop di `pager-unstick-watchdog.sh`

**File in esame**: `.launcher/pager-unstick-watchdog.sh` (introdotto da `11eca0aa9c`, modo `100644`)
**Invocatore unico**: `cli/src/commands/pid1.js:811`
**Branch**: `lee-launcher-fixes`
**Metodo**: sola lettura (grep/read mirati + `git ls-files`). Nessun container avviato, nessuna sessione tmux creata.

---

## Verdetti in apertura

| # | Sospetto | Verdetto | Gravità |
|---|---|---|---|
| **(a)** | Nessun filtro sulle sessioni | **CONFERMATO — reale e il più grave dei quattro** | 🔴 Alta |
| **(b)** | Target non ancorato (`-t "$s"` invece di `-t "=$s"`) | **CONFERMATO — reale, NON stilistico**: non per il caso nominale (i nomi vengono da `list-sessions`) ma per la finestra TOCTOU fra `list-sessions` e `send-keys`, dove il fallback prefix-match di tmux dirotta su una sessione omonima più lunga | 🟠 Media-alta |
| **(c)** | Word splitting non quotato | **CONFERMATO come difetto, ma senza percorso di dirottamento dimostrato** in questo sistema: i nomi generati dal launcher sono `^[A-Z]+(-S?[0-9]+)?$` | 🟡 Bassa |
| **(d)** | Intervallo non validato | **CONFERMATO — reale**, con un costo che non è solo CPU: è **log flood su disco** e **saturazione del server tmux**, cioè del bus di messaggistica di tutta la squadra | 🟠 Media-alta |

Nota a margine (5): il modo `100644` è **irrilevante funzionalmente**, ma è un'incoerenza rispetto ai tre watchdog gemelli. Dettaglio in fondo.

---

## 1. Censimento delle sessioni tmux reali

Tutti i `tmux new-session` non-documentazione del repo:

| Sessione | Chi la crea | Cosa c'è nel pane | Effetto di un `q` inatteso | Effetto del *resume nudge* |
|---|---|---|---|---|
| `ASSISTENTE`, `CAPITANO`, `MENTOR`, `SENTINELLA`, `CRITICO` | `.launcher/start-agent.sh:1120` (nome da `spawn-lib.sh:80-101`) | TUI LLM (claude/codex/kimi) | Target legittimo | Legittimo |
| `SCOUT-N`, `ANALISTA-N`, `SCORER-N`, `SCRITTORE-N` | idem, `spawn-lib.sh:93-99` | TUI LLM | Target legittimo | Legittimo |
| `CRITICO-S<N>` (effimere, una per Scrittore) | idem, `spawn-lib.sh:82-88` | TUI LLM | Target legittimo | Legittimo (ma vedi `codex-auth-healer.sh:183-186`: sulle effimere il ciclo di cura è diverso) |
| **`SENTINELLA-WORKER`** (singleton) | `.launcher/start-agent.sh:125-146`, ramo `ROLE=worker` | `claude --dangerously-skip-permissions` **idle**, usato come **sensore** | Carattere spurio nel composer | ⚠️ **Corrompe la lettura di `/usage`** — vedi §1.1 |
| **`SENTINELLA-WORKER-<epoch>`** (effimere) | skill `agents/sentinella/_skills/check-usage-tui/SKILL.md:31-32` | come sopra, con modal `/usage` aperta | idem | idem |
| `DOTTORE` | `.launcher/spawn-doctor.sh:47` | TUI LLM **one-shot** | Innocuo | ⚠️ Rilancia un agente che aveva finito: kick-off LLM non voluto |
| `MANTENITORE` | `.launcher/spawn-maintainer.sh:47` | TUI LLM **one-shot** | Innocuo | idem |
| `DOCTOR-WATCHDOG` | percorso legacy/manuale, `.launcher/doctor-watchdog.sh:5-7` (oggi pid1 lo lancia come processo figlio, `pid1.js:872`) | script bash in loop | `q` resta nel buffer del tty e viene consumato dal primo comando che legge stdin | `jht-tmux-send` fallirebbe la verify (`exit 3`), ma non prima di aver typato testo e **`Escape`** nel pane |
| `<ROLE>` da CLI host | `cli/src/commands/team/start.js:392` | TUI LLM | Legittimo | Legittimo |
| Sessioni utente/debug | `docker exec -it jht tmux new -s ...` | qualunque cosa | Imprevedibile | Imprevedibile |

Lo script **agisce su tutte e dieci le righe**: `.launcher/pager-unstick-watchdog.sh:37-38` itera l'output nudo di `tmux list-sessions` senza alcun predicato.

Per confronto, i due watchdog gemelli **filtrano entrambi**:
- `.launcher/agent-watchdog.sh:295-306` (`is_agent_session`) usa una **allow-list** e commenta esplicitamente le esclusioni: `DOTTORE*`, `MANTENITORE*`, `DOCTOR-WATCHDOG` (one-shot, li rimpiazza il loro scheduler), `SENTINELLA-WORKER` («pane di appoggio del bridge, non un agente LLM con contesto») e «qualunque sessione utente».
- `.launcher/codex-auth-healer.sh:102-113` (`role_of`) deriva i ruoli da `team_roster.py roles` e salta ogni sessione che non matcha `RUOLO` / `RUOLO-<n>` / `RUOLO-S<n>`; il commento a `codex-auth-healer.sh:98-101` ripete la stessa esclusione parola per parola.

Due processi indipendenti hanno scritto la stessa esclusione con la stessa motivazione. Il terzo non ce l'ha.

### 1.1 Il caso `SENTINELLA-WORKER` — perché è il più delicato

Il pane di `SENTINELLA-WORKER` non è una chat: è uno **strumento di misura**. `.launcher/sentinel-bridge.py:2412-2413` lo interroga con `query_claude_worker()` e ne passa il testo a `parse_claude_usage()`; la sequenza reale è in `shared/skills/check_usage.py:318-325`:

```
Escape → "/usage" Enter → sleep 4 → capture-pane -S -300 → Escape
```

Tre modi in cui un intervento del pager-watchdog rompe questa lettura:

1. **Il resume nudge inquina lo scrollback letto dal parser.** `parse_claude_usage` (`shared/skills/check_usage.py:167-190`) legge **300 righe di scrollback** e prende deliberatamente **l'ULTIMO** match di `Current session … XX% used … Resets …`. Un turno LLM iniettato in quel pane («Continue where you left off.») produce, in una sessione il cui unico contenuto precedente è una modal `/usage`, una risposta che con ogni probabilità **cita o riassume quei numeri** — e quella prosa finisce *dopo* la modal vera. Il parser preferisce l'ultimo match: la Sentinella riceverebbe un valore di usage **plausibile ma inventato**, che alimenta throttle e pacing (`.launcher/pacing-bridge.py`). Non è un guasto rumoroso: è un dato sbagliato che passa i controlli.
2. **`jht-tmux-send` manda `Escape` da solo.** Nel ramo «testo perso» (`agents/_skills/tmux-send/jht-tmux-send`, blocco finale del `for try`) invia `Escape` per chiudere eventuali modal. La skill avverte due volte del contrario: «⚠️ **NIENTE Esc preventivo**» (`check-usage-tui/SKILL.md:64`) e «Trust dialog ancora aperto → invia `Enter` (**NON `Escape`**: cancella e ti butta in bash)» (`SKILL.md:132`). Se la finestra cade nei 18s di boot, `Escape` è un *cancel* sul trust dialog e **il CLI esce**: pane in bash nudo, sensore morto.
3. **Spesa sull'account che si sta misurando.** Il worker gira sullo stesso abbonamento di cui la Sentinella legge la quota: un kick-off lì falsa la misura *e* consuma la risorsa misurata.

Il `q` in sé, sul worker, è il danno minore (un carattere nel composer). Il problema è che nulla, nello script attuale, distingue il worker da un agente — quindi il ramo del nudge è raggiungibile.

**Quando ci arriva davvero?** Non serve un falso positivo del rilevamento: basta il TOCTOU del punto (b), §2.

---

## 2. Verdetto su (b): ancoraggio del target

### Regole di risoluzione di tmux

`cmd_find_get_session()` (tmux `cmd-find.c`) prova, **in quest'ordine**:

1. se la stringa inizia con `$` → session **ID**;
2. **nome esatto** (`session_find`);
3. nome di un **client**;
4. `=` davanti (`CMD_FIND_EXACT_SESSION`) → **stop qui**: se 1-3 falliscono, errore;
5. **prefix match**: una sessione il cui nome *inizia* con la stringa. Se il match è unico → vince. Se sono due o più → ambiguo, errore;
6. **fnmatch** (glob) sul nome.

Nota accessoria: `session_check_name()` sostituisce `:` e `.` con `_`, quindi quei due caratteri non arrivano mai in un nome; **spazi, `$`, `*`, `?` sono ammessi**.

### Il caso nominale è sicuro…

I nomi provengono da `tmux list-sessions` (`pager-unstick-watchdog.sh:37`), quindi al passo 2 esiste sempre un match esatto e i passi 5-6 non vengono raggiunti. Su questo il sospetto sarebbe stilistico.

### …ma la finestra TOCTOU no

Lo script legge la lista una volta e poi **fa quattro chiamate tmux separate** sulla stessa stringa, con **almeno 1 secondo** di distanza fra la prima e l'ultima (`sleep 1` a riga 46):

```
:39  capture-pane -t "$s"
:45  send-keys    -t "$s" q
:46  sleep 1
:47  capture-pane -t "$s"
:49  jht-tmux-send "$s" ...     → che a sua volta fa has-session/capture/send-keys, sempre non ancorati
```

Se la sessione muore in quella finestra, il match esatto sparisce e **tmux scivola al prefix match**. E le sessioni muoiono *per progetto*, non per sfortuna:

- `.launcher/agent-watchdog.sh:289` — `tmux kill-session -t SENTINELLA` ogni 24h (`maybe_refresh_sentinella`);
- `.launcher/agent-watchdog.sh:368-386` — TTL a 12h, **un kill per tick da 30s**;
- `.launcher/agent-watchdog.sh:586` — kill da containment;
- `.launcher/codex-auth-healer.sh:175` — kill ogni 60s su auth-fail;
- `.launcher/sentinel-bridge.py:2350` — `_kill_worker()` ogni 20 minuti per igiene;
- `check-usage-tui/SKILL.md:111` — kill della sessione effimera a fine lettura.

**Scenario concreto e ricorrente per costruzione.** Sessioni vive: `SENTINELLA` e `SENTINELLA-WORKER`. Il pager-watchdog cattura `SENTINELLA`, rileva il pager, e nell'istante fra il `capture` e il `send-keys` `agent-watchdog.sh:289` la killa per il refresh di contesto (evento pianificato, non un incidente).

- `send-keys -t SENTINELLA q` → nessun match esatto → prefix match: **`SENTINELLA-WORKER` è l'unico nome che inizia per `SENTINELLA`** → il `q` finisce nel sensore;
- `has-session -t SENTINELLA` dentro `jht-tmux-send` → **stessa risoluzione, ritorna 0** → il guard `exit 2` non scatta;
- `jht-tmux-send` typa e submitta **«Continue where you left off.» nel `SENTINELLA-WORKER`**, con tutte e tre le conseguenze del §1.1.

(Se invece esiste *anche* una `SENTINELLA-WORKER-<epoch>`, i candidati sono due, il prefix match è ambiguo e tmux fallisce: la protezione, oggi, è la coincidenza.)

Lo stesso vale per `SCOUT-1` che muore mentre esistono `SCOUT-10..19`, o `CRITICO-S1` con `CRITICO-S10`.

**Verdetto: reale.** `-t "=$s"` non è cosmesi: è la differenza fra «la sessione è morta, non faccio nulla» e «scrivo in un'altra sessione». Il repo conosce già la regola e la applica proprio dove il comando è distruttivo — `.launcher/agent-watchdog.sh:564` (`capture-pane -t "=$session"`) e `:586` (`kill-session -t "=$session"`). Da notare che `codex-auth-healer.sh:161,175` e `jht-tmux-send` **non** la applicano: la convenzione difensiva esiste ma è disomogenea, e il nuovo script si è allineato al ramo debole.

---

## 3. Verdetti su (c) e (d)

### (c) Word splitting e globbing — `for s in $sessions` (riga 38)

I nomi possono contenere spazi? Non quelli del launcher: `spawn-lib.sh:80-124` produce solo `PREFIX`, `PREFIX-<n>`, `PREFIX-S<n>` con `<n>` validato numerico (`case "$instance" in 0|0[0-9]*|*[!0-9]*|"") return 2`), e i prefissi sono maiuscoli senza separatori. `SENTINELLA-WORKER` (`start-agent.sh:126`) e `SENTINELLA-WORKER-$(date +%s)` (`SKILL.md:31`) idem. Restano fuori solo le sessioni create a mano dall'operatore in `docker exec`.

Cosa succede davvero:

- **Spazi** — `tmux new -s "debug leone"` produce due parole, `debug` e `leone`. `-t debug` non ha match esatto → prefix match unico su `debug leone` → l'operazione **riesce, sulla sessione giusta, per caso**. Diventa un dirottamento solo se esiste un'altra sessione con lo stesso prefisso.
- **Globbing** — la cwd del processo è `/app` (`Dockerfile:117`, e `pid1.js:811` non passa `cwd`). Un nome `*` si espanderebbe nei figli di `/app` (`agents`, `cli`, `web`, …); nessuno di questi è un nome di sessione, quindi le `capture-pane` tornano vuote. Rumore, non dirottamento.

**Verdetto: difetto reale ma latente.** È l'unico dei quattro per cui non ho trovato un percorso di danno concreto *in questo sistema*. Va corretto perché costa una riga e perché il pattern corretto è già nel file gemello (`agent-watchdog.sh:373-385` usa `while IFS= read -r line … done <<EOF`), non perché sia sfruttabile oggi. Nota: **nessun gate CI lo intercetterebbe** — non c'è shellcheck né in `.github/workflows/lint.yml` né in `.pre-commit-config.yaml` (solo detect-secrets, actionlint, zizmor, npm-audit-prod), e `.launcher/*.sh` non è coperto da nessun linter.

### (d) `sleep "$INTERVAL_SEC"` non validato (righe 30, 56)

`${JHT_PAGER_WATCHDOG_INTERVAL:-20}` usa `:-`, quindi la stringa **vuota** cade sul default: quel caso è coperto. Non lo sono:

- `JHT_PAGER_WATCHDOG_INTERVAL=abc` → `sleep: invalid time interval 'abc'`, exit 1;
- `= -5`, `= 20 ` (spazio finale), `= 20s` scritto come `= 20 s` → stesso esito;
- `= 0` → `sleep` riesce e ritorna subito: **busy loop senza nemmeno un errore in log**.

`set -u` è attivo ma **`set -e` no** (riga 24) e il fallimento è dentro un `while true`: il loop **prosegue a velocità massima**. Il costo non è quello che ci si aspetta:

1. **Fork storm sul server tmux.** Ogni iterazione fa 1 `list-sessions` + N `capture-pane` + fino a 2N `grep` + i `printf`. Con ~10 sessioni sono ~30 fork per iterazione; senza pausa, l'iterazione dura quanto i fork (ordine dei 50-100 ms) → **~300-600 comandi tmux al secondo**. Il collo di bottiglia è il **server tmux, che è a thread singolo**: si porta via un core e soprattutto **serializza tutti gli altri consumatori** — `jht-tmux-send` (il bus agente-agente), le `capture-pane` di `agent-watchdog.sh`, quelle di `sentinel-bridge.py:887`. Il danno peggiore non è la CPU: è che la messaggistica della squadra rallenta o va in timeout.
2. **Log flood su disco.** `pid1.js:361` cattura stdout/stderr del figlio e `pid1.js:382` li appende a `$JHT_HOME/logs/pager-unstick.log`, con rotazione a 5 MB (`pid1.js:378`). Una riga `sleep: invalid time interval` per iterazione a ~10-20 Hz riempie 5 MB in pochi minuti e mette il file in rotazione continua — su un bind mount, è **I/O continuo sul disco dell'host**. Su una macchina già fragile lato I/O questo è più grave della CPU.

**Collegamento alle soglie CPU dei LED — verifica.** La soglia è `CPU_ACTIVE_THRESHOLD := 8.0` in `game/scripts/characters/agent_state_tag.gd:11`, confrontata con `cpu_pct` a `agent_state_tag.gd:60`. Il dato arriva da `shared/skills/agent_vitals.py`, che però **conta solo i processi marcati**: `_agent_of()` (`agent_vitals.py:55-66`) legge `/proc/<pid>/environ` e scarta chi non ha `JHT_AGENT_NAME`; `scan()` (`:89-102`) itera solo quelli. Il pager-watchdog è un figlio di pid1 senza quella variabile, e il server tmux è stato avviato dal primo `tmux new-session` (nessun `tmux start-server` esplicito nel repo) da `start-agent.sh`, che `JHT_AGENT_NAME` lo esporta **dentro il pane** (`start-agent.sh:1072`), non nel proprio ambiente.

Conclusione onesta, opposta all'ipotesi del ticket: **il busy loop è invisibile ai LED per-agente**. Non li accende falsamente — e questo è peggio, non meglio: un core saturo e un log che gira non hanno **nessun** indicatore nella UI degli agenti. Comparirebbe solo in `container_cpu_pct` / `cpu_pct` host (`game/scripts/backend/payloads/host_metrics.py:15,34`, resi da `game/scripts/ui/section_panel.gd:1915-1924`), cioè in una schermata diversa da quella dove si guarda «gli agenti stanno lavorando?».

---

## 4. Tabella comparativa dei tre watchdog

| Dimensione | `agent-watchdog.sh` | `codex-auth-healer.sh` | `pager-unstick-watchdog.sh` |
|---|---|---|---|
| **Filtro sessioni** | ✅ allow-list `is_agent_session` (`:295-306`), esclusioni commentate | ✅ `role_of` da `team_roster.py roles` (`:102-113`) | ❌ **nessuno** (`:38`) |
| **Ancoraggio target** | ✅ `-t "=$session"` sui comandi distruttivi (`:564`, `:586`) | ❌ `-t "$sess"` (`:161`, `:175`) | ❌ `-t "$s"` (`:39`, `:45`, `:47`) |
| **Quoting della lista** | ✅ `while IFS= read -r` + heredoc (`:373-385`) | ❌ `for sess in $(...)` (`:157`) | ❌ `for s in $sessions` (`:38`) |
| **Validazione input env** | ⚠️ nessuna su `INTERVAL_SEC` (`:59`), ma il loop non è mai stato in condizione di girare a vuoto perché… vedi nota | ⚠️ nessuna su `INTERVAL`/`COOLDOWN` | ❌ nessuna (`:30`) |
| **Gate halt / weekly-halt / standby** | ✅ | ✅ (`:148`) | ❌ **nessuno** — e il nudge è un kick-off LLM, cioè spesa (approfondito in `223-2-nessun-freno-e-costo.md`) |
| **Cooldown / anti-storm** | ✅ un refresh per tick, il più vecchio (`:368-386`) | ✅ cooldown 300s per agente (`:164-172`) | ❌ nessuno (`223-1`) |
| **Singleton (flock)** | — | ✅ (`:125-139`) | ❌ |
| **Gestione errori tmux** | ✅ esito del kill controllato (`:289`, `:586`) | ⚠️ `2>/dev/null` e prosegue | ⚠️ `|| true` ovunque: **un `send-keys` fallito è indistinguibile da uno riuscito** e il log dice comunque «dismissing» |
| **Testabilità** | ✅ marker di bootstrap + confini iniettabili (`:552-555`, sfruttati da `tests/test_agent_watchdog_recovery_notice.py:18-23`) | ⚠️ path iniettabili via env, nessun marker | ❌ logica **interamente inline** nel `while true`: nessuna funzione, nessun marker, nessun seam → **non testabile** con la convenzione del repo |
| **Registrazione in `process_health.py`** | ✅ (`shared/skills/process_health.py:46`) | — | ❌ assente (fuori scope qui, vedi `223-3`) |

La riga che pesa di più è l'ultima delle prime tre: lo script si discosta dalla norma **su tutte e tre le dimensioni di targeting insieme**, e non ha nessuno dei freni che i gemelli hanno accumulato incidente dopo incidente.

---

## 5. Nota a margine: il modo `100644`

`git ls-files -s .launcher` dà `100644` per `pager-unstick-watchdog.sh` contro `100755` di `agent-watchdog.sh`, `doctor-watchdog.sh`, `auto-report-loop.sh`, `codex-auth-healer.sh`, `start-agent.sh`, `entrypoint.sh`, `spawn-doctor.sh`, `spawn-maintainer.sh`, `bridge-control.sh`, `config.sh`, `welcome-send.sh`, `pacing-bridge.py`.

**Conta?** No, funzionalmente:

- pid1 lo invoca come `spawnLabeled('pager-unstick', '/bin/bash', [PAGER_UNSTICK_WATCHDOG_SCRIPT])` (`cli/src/commands/pid1.js:811`) — **identico** a come invoca `agent-watchdog.sh` (`:777`), `auto-report-loop.sh` (`:839`), `doctor-watchdog.sh` (`:872`). Con l'interprete esplicito il bit di esecuzione non viene mai consultato;
- il Dockerfile **non fa nessun `chmod` su `.launcher`**: gli unici `chmod` sono a `Dockerfile:249` (sudoers) e il `COPY . .` di `Dockerfile:158` preserva il modo git. L'unico file per cui il bit è indispensabile è `entrypoint.sh`, eseguito direttamente da tini (`Dockerfile:267`), ed è già `100755`;
- nessun hook lo verifica: `.pre-commit-config.yaml` ha solo detect-secrets, actionlint, zizmor, npm-audit-prod — niente `check-executables-have-shebangs`;
- nessun test asserisce modi di file in `.launcher`;
- esiste un precedente: 8 dei 22 file in `.launcher` sono `100644` (`daemon-lib.sh`, `spawn-lib.sh`, `tui-helpers.sh` sono *sourceati*; `sentinel-bridge.py`, `tg-bridge.py`, `heartbeat-bridge.py`, `stepcap-watchdog.py`, `proc-kill.py` girano via interprete).

**Verdetto: incoerenza cosmetica, non un blocco.** Vale però un `git update-index --chmod=+x .launcher/pager-unstick-watchdog.sh`: ha uno shebang `#!/usr/bin/env bash` (riga 1) che promette eseguibilità, ed è un *daemon loop* — la categoria in cui **tutti** i fratelli sono 755. La differenza morde solo il giorno in cui qualcuno documenta o scripta `./.launcher/pager-unstick-watchdog.sh` invece di `bash <path>`.

---

## 6. Proposta concreta (diff testuale — NON applicato)

Copre (a), (b), (c), (d) e rende lo script testabile. **Non** tocca i gate halt/standby né il cooldown: sono oggetto di `223-1` e `223-2` e vanno risolti lì per non produrre due diff in conflitto sullo stesso file (ho lasciato un commento nel punto d'innesto).

```diff
--- a/.launcher/pager-unstick-watchdog.sh
+++ b/.launcher/pager-unstick-watchdog.sh
@@ -28,30 +28,96 @@ set -u
 JHT_HOME="${JHT_HOME:-/jht_home}"
 LOG="$JHT_HOME/logs/pager-unstick-watchdog.log"
-INTERVAL_SEC="${JHT_PAGER_WATCHDOG_INTERVAL:-20}"
 
 log() { printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
 
+# Intervallo: SOLO un intero positivo. Un valore non numerico faceva fallire
+# `sleep` senza fermare il `while true` (qui non c'e' `set -e`): il loop
+# ripartiva subito, ~300-600 comandi tmux/s contro un server tmux a thread
+# singolo — cioe' il bus agente-agente in coda dietro di noi — e una riga di
+# errore per iterazione dentro logs/pager-unstick.log (pid1.js:382, rotazione
+# a 5MB) su un bind mount. Un guasto che i LED per-agente NON mostrano:
+# agent_vitals conta solo i processi con JHT_AGENT_NAME (agent_vitals.py:55).
+INTERVAL_DEFAULT=20
+INTERVAL_SEC="${JHT_PAGER_WATCHDOG_INTERVAL:-$INTERVAL_DEFAULT}"
+case "$INTERVAL_SEC" in
+  ''|0|*[!0-9]*)
+    log "WARN JHT_PAGER_WATCHDOG_INTERVAL='$INTERVAL_SEC' is not a positive integer — using ${INTERVAL_DEFAULT}s"
+    INTERVAL_SEC="$INTERVAL_DEFAULT"
+    ;;
+esac
+
+# Allow-list, non deny-list: una sessione sconosciuta non riceve tasti.
+# Stessa forma di agent-watchdog.sh:295-306, e per le stesse ragioni:
+#   • SENTINELLA-WORKER / SENTINELLA-WORKER-<ts> sono uno STRUMENTO DI MISURA,
+#     non una chat: sentinel-bridge.py:2412 ne parsa il pane per leggere
+#     /usage e parse_claude_usage (check_usage.py:167) prende l'ULTIMO match
+#     nello scrollback — un turno LLM iniettato li' produce un valore di usage
+#     inventato ma plausibile, che alimenta throttle e pacing;
+#   • DOTTORE* / MANTENITORE* sono one-shot: "Continue where you left off."
+#     rilancerebbe un agente che aveva finito;
+#   • DOCTOR-WATCHDOG e' uno script bash, non una TUI;
+#   • le sessioni utente non sono nostre.
+is_pager_target() {
+  case "$1" in
+    ASSISTENTE|CAPITANO|MENTOR|SENTINELLA|CRITICO) return 0 ;;
+    SCOUT-[0-9]*|ANALISTA-[0-9]*|SCORER-[0-9]*|SCRITTORE-[0-9]*|CRITICO-S[0-9]*) return 0 ;;
+    *) return 1 ;;
+  esac
+}
+
+# `=` = match ESATTO del nome. Senza, tmux ripiega sul prefix match: una
+# sessione morta fra due chiamate (TTL di agent-watchdog.sh:380, refresh
+# Sentinella :289, kill del worker sentinel-bridge.py:2350) fa risolvere
+# `SENTINELLA` su `SENTINELLA-WORKER`. Stessa convenzione di
+# agent-watchdog.sh:564,586.
+pane_tail() { tmux capture-pane -t "=$1" -p -S -3 2>/dev/null || true; }
+
+unstick_session() {
+  local s="$1" tail3 after
+  tail3="$(pane_tail "$s")"
+  # Entrambi i frammenti del footer insieme sono la firma fissa del pager —
+  # abbastanza specifica da non matchare la chiacchiera dell'agente.
+  printf '%s' "$tail3" | grep -q 'pgup/pgdn to page' || return 0
+  printf '%s' "$tail3" | grep -q 'q to quit'         || return 0
+  log "session $s: stuck in pager, dismissing"
+  if ! tmux send-keys -t "=$s" q 2>/dev/null; then
+    # Un send-keys fallito non deve produrre una riga di log che dice
+    # "dismissed": il log e' l'unica prova che resta.
+    log "session $s: send-keys failed (session gone?) — nothing was dismissed"
+    return 0
+  fi
+  sleep 1
+  # La sessione puo' sparire nel secondo che separa il `q` dal nudge. Senza
+  # questo controllo il nudge — che passa da jht-tmux-send, il quale usa a sua
+  # volta un `has-session -t` NON ancorato — finirebbe per prefix-match in una
+  # sessione omonima piu' lunga, cioe' un kick-off LLM sull'agente sbagliato.
+  if ! tmux has-session -t "=$s" 2>/dev/null; then
+    log "session $s: gone right after the dismissal — no resume nudge"
+    return 0
+  fi
+  after="$(pane_tail "$s")"
+  if ! printf '%s' "$after" | grep -q 'Conversation interrupted'; then
+    log "session $s: dismissed cleanly, no resume needed"
+    return 0
+  fi
+  # NOTA: qui manca ancora il gate halt/weekly-halt/standby che gli altri tre
+  # watchdog hanno (codex-auth-healer.sh:148) — il nudge e' spesa LLM. Vedi la
+  # review 223-2: si risolve li' per non spezzare la modifica in due diff.
+  jht-tmux-send "$s" "Continue where you left off." >>"$LOG" 2>&1 || true
+  log "session $s: dismissal interrupted the turn, sent resume nudge"
+}
+
+# Marker di bootstrap: i test estraggono il prelude fino a questa riga per
+# esercitare le funzioni senza far partire il daemon (stessa convenzione di
+# agent-watchdog.sh:552-555 / tests/test_agent_watchdog_recovery_notice.py:18).
 log "pager-unstick-watchdog up — interval=${INTERVAL_SEC}s"
 
 while true; do
-  sessions=$(tmux list-sessions -F '#{session_name}' 2>/dev/null || true)
-  for s in $sessions; do
-    tail3=$(tmux capture-pane -t "$s" -p -S -3 2>/dev/null || true)
-    # Both footer fragments together are the pager's fixed signature —
-    # specific enough to avoid matching normal agent chatter.
-    if printf '%s' "$tail3" | grep -q 'pgup/pgdn to page' \
-      && printf '%s' "$tail3" | grep -q 'q to quit'; then
-      log "session $s: stuck in pager, dismissing"
-      tmux send-keys -t "$s" q
-      sleep 1
-      after=$(tmux capture-pane -t "$s" -p -S -3 2>/dev/null || true)
-      if printf '%s' "$after" | grep -q 'Conversation interrupted'; then
-        jht-tmux-send "$s" "Continue where you left off." >>"$LOG" 2>&1 || true
-        log "session $s: dismissal interrupted the turn, sent resume nudge"
-      else
-        log "session $s: dismissed cleanly, no resume needed"
-      fi
-    fi
-  done
+  # Heredoc e non pipe: il `while` deve girare nella shell corrente. `IFS= read
+  # -r` preserva i nomi con spazi e non fa globbing (la cwd e' /app: un nome
+  # `*` si espanderebbe nei figli della repo). Stesso pattern di
+  # agent-watchdog.sh:373-385.
+  while IFS= read -r s; do
+    [ -n "$s" ] || continue
+    is_pager_target "$s" || continue
+    unstick_session "$s"
+  done <<EOF
+$(tmux list-sessions -F '#{session_name}' 2>/dev/null)
+EOF
   sleep "$INTERVAL_SEC"
 done
```

### Test proposto — `tests/test_pager_unstick_targeting.py`

Segue la convenzione già usata per l'altro watchdog (`tests/test_agent_watchdog_recovery_notice.py:14-56`): niente tmux, niente TUI, niente container. Si estrae il prelude fino al marker, si mette un finto `tmux` in testa al `PATH` che registra la propria `argv` su file, si invocano le funzioni vere.

Quattro asserzioni, una per sospetto:

1. **(a) filtro** — dato un roster finto `SCOUT-1, CAPITANO, SENTINELLA-WORKER, SENTINELLA-WORKER-1756000000, DOTTORE, MANTENITORE, DOCTOR-WATCHDOG, "debug leone"`, il file delle chiamate deve contenere `capture-pane` **solo** per `SCOUT-1` e `CAPITANO`. È il test che vale di più: fallisce oggi e protegge il sensore `/usage`.
2. **(b) ancoraggio** — ogni argomento che segue un `-t` nelle chiamate registrate deve iniziare con `=`. Più un caso mirato: se il finto `tmux` fa fallire `has-session`, il finto `jht-tmux-send` **non deve essere invocato**.
3. **(c) quoting** — con una sessione `"debug leone"` nella lista, il finto `tmux` deve ricevere **un solo** token come target (oggi ne riceverebbe due e in ordine sparso).
4. **(d) intervallo** — con `JHT_PAGER_WATCHDOG_INTERVAL=abc`, `=0`, `=-5` il prelude deve terminare con `INTERVAL_SEC=20` e una riga `WARN` nel log; con `=45` deve restare `45`.

Costo di esecuzione: quattro `subprocess.run(["bash","-c", …])`, nessun I/O pesante — compatibile con il vincolo «solo i test dei file toccati» su questa macchina.

---

## Riepilogo per il merge

Il rilevamento del pager risolve un problema **vero e documentato** (`docs/internal/postmortems/2026-06-26-sentinella-capitano-relationship-live.md:27` cita proprio la schermata «q to quit»), e il ramo del nudge dopo «Conversation interrupted» è una buona intuizione. Ma la consegna dei tasti è costruita senza le tre difese che gli altri due watchdog del launcher hanno già scritto — filtro, ancoraggio, quoting — e senza validare l'unico input esterno che ha. Il caso peggiore non è teorico: è un turno LLM iniettato nel pane che la Sentinella usa come strumento di misura, con conseguenze silenziose su throttle e pacing.

**Raccomandazione: bloccare** finché (a) e (b) non sono corretti; (c) e (d) sono nello stesso diff a costo quasi nullo. Il modo `100644` non è un blocco.
