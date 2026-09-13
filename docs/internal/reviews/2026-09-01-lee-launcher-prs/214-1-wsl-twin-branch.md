# 214-R1 — Il gemello WSL di `tmux new-session` (rischio 1 di 5)

**Data:** 2026-09-01
**Branch analizzato:** `lee-launcher-fixes` (contiene già i merge `0673592ca4` = PR #214 e `9d4c23969c` = PR #223)
**File sotto esame:** `.launcher/start-agent.sh`
**Tipo:** sola analisi statica — nessun file sorgente modificato, nessun docker/build/test eseguito.

---

## ⚖️ Verdetto in apertura

| Domanda | Risposta |
| --- | --- |
| Il ramo WSL è dentro la regione protetta dal flock? | ✅ **SÌ**, confermato |
| Un hang lì produce lo stesso lockout permanente? | ✅ **SÌ**, meccanica identica |
| È un percorso vivo? | ❌ **NO** — nessun chiamante reale può raggiungerlo oggi |

### 🟡 Rischio del ramo WSL: **TEORICO** — gravità **BASSA**, ma va chiuso lo stesso

Il ramo WSL (`.launcher/start-agent.sh:1079-1100`) è codice **irraggiungibile su tutti i percorsi supportati**: ogni chiamante vivo esegue lo script *dentro* il container, dove `IS_CONTAINER=1` (`Dockerfile:17`) fa cadere la condizione di guardia. Lee ha avuto ragione a metterlo fuori dallo scope *urgente*.

Ma la guardia è sottile in modo scomodo: il kernel WSL2 di Docker Desktop **fa** matchare `grep -qi microsoft /proc/version`, quindi l'unica cosa che separa il container Windows — cioè *esattamente la piattaforma dell'incidente delle 37h* — dal ramo non protetto è che la variabile `IS_CONTAINER` valga `1`. Una singola regressione d'ambiente (un `docker exec --env IS_CONTAINER=`, un `env -i`, un compose che rifà l'env da zero) trasforma il rischio teorico nell'incidente reale, e stavolta senza `timeout` a salvarci. Il costo del fix è **una parola** (`timeout 20`). Non c'è ragione per non pagarlo.

### 🔴 Però: due rischi **REALI** nella stessa regione post-flock, non coperti da #214

L'analisi ha trovato due cose più gravi del ramo WSL, entrambe nel ramo container **vivo**:

1. 🔴 **Il fd 9 del flock viene ereditato dalla subshell `setsid` di auto-accept** (`start-agent.sh:1148-1178`): manca il `9>&-` che lo stesso file documenta come non-decorativo alla riga 403-409. Il lock per-sessione resta preso **fino a 120 s dopo l'uscita** di `start-agent.sh` — e **per sempre** se `tmux capture-pane` dentro quel loop si appende. Questo **riproduce integralmente il lockout permanente che #214 doveva chiudere**.
2. 🟠 **Tredici chiamate `tmux` illimitate post-flock** nel ramo container (`has-session`, ~11 `send-keys`, `kill-session`). #214 ha limitato *una* chiamata `tmux`; se l'ipotesi del commit è "il server tmux si incanta", le altre dodici si incantano allo stesso modo, tenendo il lock.

Dettagli e patch proposte nelle sezioni §3 e §4.

---

## 1. Il ramo WSL è dentro la regione del flock? Sì.

### 1.1 Il lock

```
.launcher/start-agent.sh:545   if command -v flock >/dev/null 2>&1; then
.launcher/start-agent.sh:546     mkdir -p "${JHT_HOME:-/jht_home}/locks"
.launcher/start-agent.sh:547     exec 9>"${JHT_HOME:-/jht_home}/locks/start-${SESSION}.lock"
.launcher/start-agent.sh:548     if ! flock -w 30 9; then
.launcher/start-agent.sh:549       echo "Error: timed out waiting for the concurrent spawn of '$SESSION'." >&2
.launcher/start-agent.sh:550       exit 1
```

`exec 9>` apre il fd **nel processo**, non in una subshell: la open file description vive finché il processo (o un suo erede) non chiude il fd. Non c'è **nessun** `exec 9>&-` fra la riga 548 e la fine dello script:

```
$ grep -n "9>&-" .launcher/start-agent.sh
403:  # `9>&-` NON è decorativo: il lock di flock vive nella *open file
418:    " >/dev/null 2>&1 < /dev/null 9>&- &
```

Entrambe le occorrenze stanno nel ramo `tg-bridge`, che esce a riga 421 e non attraversa mai il lock di riga 547. Il lock di riga 547 è quindi rilasciato **solo** dall'uscita del processo.

### 1.2 Il ramo WSL sta dopo

```
.launcher/start-agent.sh:1079   if [ "${IS_CONTAINER:-0}" != "1" ] && grep -qi microsoft /proc/version 2>/dev/null; then
.launcher/start-agent.sh:1080     WIN_AGENT_DIR=$(wslpath -w "$AGENT_DIR")
.launcher/start-agent.sh:1081     tmux new-session -d -x 220 -y 50 -s "$SESSION" powershell.exe
```

Riga 1081 ≫ riga 548, stesso processo, nessuna chiusura di fd in mezzo. **Un hang a 1081 tiene il lock `start-<SESSION>.lock` per sempre**, e ogni respawn successivo dello stesso agente aspetta 30 s (`flock -w 30`) e muore con `"timed out waiting for the concurrent spawn"` — la firma identica dei 756 fallimenti in 37h. Meccanica confermata al 100%: è lo stesso identico difetto che #214 ha chiuso 39 righe più sotto (`:1120`).

Nota aggiuntiva: nel ramo WSL la chiamata **più** a rischio di hang non è nemmeno `new-session`, è **`powershell.exe` lanciato via interop WSL** — quando il ponte interop Windows↔WSL muore (evento noto e osservato in questo stesso ambiente), i lanci di `.exe` da WSL si piantano invece di fallire. `tmux new-session -d ... powershell.exe` non aspetta il comando, ma la creazione della sessione può comunque restare appesa se il server tmux è wedgato, e i `send-keys` di 1083-1095 seguono senza alcun limite.

---

## 2. Chi esegue davvero quel ramo? Nessuno.

Ho tracciato tutti i riferimenti a `start-agent.sh` nel repo. Ogni **chiamante vivo** passa da un path `/app/...`, cioè dentro il container:

| Chiamante | Riga | Come invoca | `IS_CONTAINER` |
| --- | --- | --- | --- |
| CLI `jht team start` (container mode) | `cli/src/commands/team/start.js:290` | `execScriptInContainer('/app/.launcher/start-agent.sh', …)` → `docker exec` | `1` (ENV immagine) |
| pid1 (autostart + tg-bridge) | `cli/src/commands/pid1.js:44` | `const TG_BRIDGE_LAUNCHER = '/app/.launcher/start-agent.sh'` | `1` (gira nel container) |
| Watchdog agenti | `.launcher/agent-watchdog.sh:74`, usato a `:350`, `:509`, `:534` | `bash "$START_AGENT" …`, default `/app/.launcher/start-agent.sh` | `1` (ereditato da pid1) |
| Gioco / desktop (VPS backend) | `game/scripts/backend/vps_backend.gd:1080-1081` | `ssh … docker exec jht sh -lc '… setsid -f bash /app/.launcher/start-agent.sh assistente'` | `1` |
| Skill `agent-emergency` | `agents/_skills/agent-emergency/SKILL.md:4,112` | `bash /app/.launcher/start-agent.sh <role> <N>` (eseguita da un agente, quindi nel container) | `1` |

E i due percorsi che *sembrano* candidati ma non lo sono:

- **CLI in host mode (`--no-docker` / native install).** `cli/src/commands/team/start.js:322-328` devia al container solo se `usingContainer()`; il ramo host che segue **non chiama affatto `start-agent.sh`**: reimplementa lo spawn inline con `execSync('tmux new-session …')` a `cli/src/commands/team/start.js:392-397`. Quindi nemmeno l'installazione nativa (`scripts/install.sh --no-docker`, `main_native` a `scripts/install.sh:1244`) raggiunge il ramo WSL.
- **`shared/skills/dashboard_server.py:195` e `:1839`** puntano a `alfa/scripts/scripts/start-agent.sh` — directory **inesistente** nel repo (verificato). È codice morto ereditato, non un chiamante.
- **`archive/electron-desktop/*`** è, per definizione della directory, archivio.

**Ultima modifica funzionale del ramo WSL: `10951b4294` (2026-04-24).** Da allora il progetto ha consolidato lo spawn dentro il container (le skill vietano esplicitamente il `tmux new-session` a mano, cfr. `shared/skills/team_roster.py:14-17`). Il ramo è quindi **legacy** — sopravvivenza di quando si lanciavano gli agenti da una shell WSL sull'host — non un percorso supportato.

**Conclusione punto 2:** il rischio è *teorico*. L'unico modo per eseguirlo oggi è che una persona lanci `bash .launcher/start-agent.sh <role>` a mano da una shell WSL su un checkout del repo (scenario da sviluppatore, non da utente), **oppure** che `IS_CONTAINER` sparisca dall'ambiente del container su Docker Desktop.

---

## 3. Altre chiamate potenzialmente bloccanti nella regione post-flock

Tutto quello che segue sta fra la riga 548 (lock preso) e l'uscita dello script, e quindi **tiene il lock mentre gira**. Ordinate per rischio reale.

### 🔴 3.1 La subshell `setsid` di auto-accept eredita il fd 9 — `:1148-1178`

```
.launcher/start-agent.sh:1148     setsid sh -c '
…
.launcher/start-agent.sh:1154       _pane=$(tmux capture-pane -t "$_sess" -p -S -40 2>/dev/null)
…
.launcher/start-agent.sh:1178     ' >/dev/null 2>&1 < /dev/null &
```

Confronta con il gemello nel ramo tg-bridge, che il fd lo chiude:

```
.launcher/start-agent.sh:403   # `9>&-` NON è decorativo: il lock di flock vive nella *open file
.launcher/start-agent.sh:404   # description*, che i figli EREDITANO. […]
.launcher/start-agent.sh:418     " >/dev/null 2>&1 < /dev/null 9>&- &
```

Manca `9>&-` a riga 1178. Conseguenze, in ordine di gravità:

1. **Sempre, a regime:** quando nessun dialog TUI compare (il caso normale a steady state), il loop fa 60 iterazioni × 2 s = **120 s**. Per tutti quei 120 s il lock `start-<SESSION>.lock` resta preso, *anche se `start-agent.sh` è già uscito con successo*. Il watchdog gira ogni 30 s (`.launcher/agent-watchdog.sh`): se lo spawn "riesce" ma la TUI muore subito, il respawn al tick successivo aspetta 30 s sul flock e fallisce con `"concurrent spawn"` — un errore **fuorviante**, perché la vera risposta sarebbe `"Session already active"` (il check a `:553` non viene nemmeno raggiunto).
2. **Permanente, nel caso patologico:** `tmux capture-pane` a riga 1154 **non ha limite**. Se il server tmux si incanta — che è precisamente l'ipotesi di root cause nel commit message di #214 — la subshell resta appesa per sempre, il fd 9 con lei, e **il lockout permanente si ripresenta identico**, con `timeout 20` a riga 1120 perfettamente innocuo perché il new-session in quel caso era già passato.

👉 **Questo è, a mio avviso, il buco più serio dei cinque rischi in review: PR #214 non chiude la classe di difetto che dichiara di chiudere.**

### 🟠 3.2 Tredici chiamate `tmux` illimitate post-flock (ramo container vivo)

| Riga | Chiamata | Nota |
| --- | --- | --- |
| `:553` | `tmux has-session -t "$SESSION"` | **prima** chiamata tmux dopo il lock; se il server è wedgato si appende qui, prima ancora del `timeout` di #214 |
| `:1020`, `:1022` | `tmux send-keys` (env opzionali) | dentro `send_optional_env` |
| `:1044`, `:1055`, `:1059`, `:1066`, `:1067`-`:1072` | `tmux send-keys` × 9 (env) | dentro `send_env_vars`, chiamata a `:1127` |
| `:1124` | `tmux kill-session` | **nel path di pulizia dell'errore di #214**: se new-session è andato in timeout perché il server tmux è morto, questa kill-session ha ottime probabilità di appendersi a sua volta — e allora il `exit 1` di riga 1125 non viene mai raggiunto e il lock non si libera. Il fix di #214 si autoannulla. |
| `:1128` | `tmux send-keys "$FULL_CMD"` | |

Se la premessa di #214 ("un tmux che non ritorna mai") è vera, limitare solo `new-session` è **campionamento**, non un fix. Nota in particolare `:1124`.

### 🟡 3.3 I/O su bind mount (lento su Docker Desktop/Windows, non infinito)

| Riga | Operazione |
| --- | --- |
| `:837` | `python3 "$COORD_SCRIPT" bootstrap` — apre lo SQLite di coordinamento; un lock SQLite contesso può bloccare a lungo |
| `:932-933` | `cmp -s` + `cp` del template d'identità |
| `:948-957` | ciclo `cp` dei doc `_team` |
| `:964-965` | `jht_spawn_copy_skills` → `rm -rf` + `cp` ricorsivi delle skill (il volume di I/O maggiore dell'intero script) |
| `:1203` | `python3 spawn_stagger.py --arm` |
| `:1221` | `python3 team_roster.py record` |

Valutazione: **rallentano** il tempo di detenzione del lock (su bind mount Windows le copie di skill sono l'operazione più cara), ma non ho evidenza che possano non ritornare mai. Non li metterei nel fix urgente; li metterei sotto un wrapper unico se si sceglie la strada strutturale (§4.3).

### ✅ 3.4 Già limitate correttamente

- `:985` — `HOME="$JHT_HOME" timeout 30 claude … -p "ok"` (warmup `.claude.json`): limitata e con `|| true`. Buon precedente stilistico, ed è quello che #214 cita.
- `:1120` — `timeout 20 tmux new-session` (il fix di #214).

### ✅ 3.5 Niente rete

Nessun `curl`, `wget`, `nc` o attesa su socket nella regione post-flock — verificato. Il rischio SSRF/hang-di-rete non esiste qui.

---

## 4. Fix proposto

### 4.1 Patch minima (allinea il gemello WSL) — **NON applicata**

```diff
--- a/.launcher/start-agent.sh
+++ b/.launcher/start-agent.sh
@@ -1076,9 +1076,20 @@
 # Rileva se siamo in WSL nativo (non dentro un container Docker Desktop, che
 # condivide il kernel WSL2 ma non ha wslpath/powershell.exe): in WSL la CLI
 # Claude è un binario Windows e va lanciata via PowerShell.
+#
+# Il `timeout` ha la stessa identica motivazione del ramo container più sotto
+# (vedi il commento esteso lì): questa riga sta DOPO il flock di riga 547 e un
+# hang qui terrebbe il lock per sempre. Il ramo è oggi irraggiungibile —
+# tutti i chiamanti reali girano nel container con IS_CONTAINER=1 — ma la
+# condizione di guardia è l'UNICA cosa che lo separa da Docker Desktop, il cui
+# kernel WSL2 fa matchare /proc/version. Costo del presidio: una parola.
 if [ "${IS_CONTAINER:-0}" != "1" ] && grep -qi microsoft /proc/version 2>/dev/null; then
   WIN_AGENT_DIR=$(wslpath -w "$AGENT_DIR")
-  tmux new-session -d -x 220 -y 50 -s "$SESSION" powershell.exe
+  if ! timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" powershell.exe; then
+    echo "Error: 'tmux new-session' for '$SESSION' did not return within 20s (hung spawn)." >&2
+    timeout 10 tmux kill-session -t "$SESSION" 2>/dev/null
+    exit 1
+  fi
   sleep 2
```

### 4.2 Patch che chiude il buco REALE (§3.1) — priorità più alta della 4.1

```diff
@@ -1175,7 +1175,12 @@
       _i=$((_i + 1))
     done
     tmux send-keys -t "$_sess" Enter
-    ' >/dev/null 2>&1 < /dev/null &
+    # `9>&-`: identico al ramo tg-bridge (vedi il commento a riga 403). Questa
+    # subshell vive fino a 120s dopo l'uscita di start-agent.sh e il suo
+    # `tmux capture-pane` non ha limite: senza chiudere il fd 9 EREDITATO,
+    # tiene il lock per-sessione per tutto quel tempo — e per sempre se il
+    # server tmux si incanta, cioè esattamente il lockout che #214 chiude.
+    ' >/dev/null 2>&1 < /dev/null 9>&- &
```

E, nello stesso giro, limitare la `kill-session` del path d'errore di #214 (`:1124` → `timeout 10 tmux kill-session …`), altrimenti il fix di #214 può autoannullarsi.

### 4.3 Alternativa strutturale — la raccomando come seguito, non come sostituto

Tre opzioni, in ordine di rapporto valore/rischio:

1. ⭐ **`jht_bounded()` in `.launcher/spawn-lib.sh`** (raccomandata). Un wrapper unico `jht_bounded <sec> <cmd…>` che fa `timeout`, logga la scadenza con nome comando + sessione, e ritorna un exit code distinguibile (124). Tutte le chiamate `tmux` post-flock ci passano. Vantaggio decisivo: diventa **verificabile da un test sorgente** ("nessun `tmux ` nudo dopo la riga del flock"), quindi l'invariante non si erode al prossimo contributo. `spawn-lib.sh` è già la casa condivisa di questa logica (`jht_spawn_session_name`, `jht_spawn_copy_skills`), quindi non introduce un nuovo posto dove guardare.
2. **Restringere la regione del lock**: `exec 9>&-` esplicito subito dopo `tmux send-keys "$FULL_CMD"` (`:1128`), prima dello stagger e del roster. Regge rispetto all'invariante già testata in `tests/test_start_agent_persistent_cli_path.py::test_start_agent_serializes_before_rewriting_agent_skills` (lock < has-session < skill_sync), perché la copia skill (`:964`) resta dentro. Ma è un rilascio *anticipato*, e da solo **non** salva dagli hang che avvengono *prima* di 1128 (che sono la maggioranza).
3. **Lock watchdog esterno** (un cleaner che rompe i lock più vecchi di N minuti): sconsigliato. Aggiunge un secondo attore che compete sullo stato di spawn — la classe di problema che `team_roster.py:20` ("il rischio vero: combattere col coordinatore") documenta di voler evitare.

**Raccomandazione operativa:** 4.2 subito (è un bug vivo), 4.1 nello stesso commit (costa una parola e chiude questo ticket), 4.3-opzione-1 come ticket separato con la sua suite.

---

## 5. Come lo si testa

Convenzione della casa: **test pytest source-asserting** che leggono `.launcher/start-agent.sh` come testo e affermano ordine/presenza di costrutti — cfr. `tests/test_start_agent_persistent_cli_path.py` (usa `Path(__file__).parents[1]`, `source.index(...)` per l'ordine, docstring/commento che spiega *perché* l'invariante esiste). Nessun tmux, nessun docker, gira ovunque in millisecondi. Perfetta per questo caso, dove il difetto è "una chiamata senza guardia" e non un comportamento runtime.

⚠️ **Nota di review su #214: il commit `1e45cd7d42` non ha aggiunto nessun test** (verificato: nessun match per `timeout 20` / `hung spawn` / `did not return within` sotto `tests/`). L'invariante che ha introdotto è quindi oggi non presidiata e si può perdere al primo refactor.

File nuovo proposto: **`tests/test_start_agent_bounded_post_lock.py`**

```python
"""Nessuna chiamata illimitata mentre il lock di spawn è preso.

`start-agent.sh` prende un flock per-sessione (`locks/start-<SESSION>.lock`)
e lo rilascia SOLO uscendo: il fd 9 resta aperto per tutta la vita del
processo. Qualunque comando che non ritorna, dopo quel punto, tiene il lock
per sempre e ogni respawn successivo dello stesso agente muore con
"concurrent spawn" — 756 fallimenti in 37h su una installazione reale
(2026-08-31) prima che la causa fosse isolata.

Queste asserzioni tengono ferme le due metà del rimedio:
  1. OGNI `tmux new-session` post-lock è limitato (non solo quello del ramo
     container: il gemello WSL sta nella stessa regione);
  2. i figli detached NON ereditano il fd 9 (`9>&-`), altrimenti il lock
     sopravvive all'uscita dello script.
"""

from pathlib import Path

import pytest

LAUNCHER = Path(__file__).parents[1] / ".launcher" / "start-agent.sh"


@pytest.fixture(scope="module")
def source() -> str:
    return LAUNCHER.read_text(encoding="utf-8")


def _spawn_lock_offset(source: str) -> int:
    """Offset del flock per-sessione: da qui in poi vale l'invariante."""
    return source.index('exec 9>"${JHT_HOME:-/jht_home}/locks/start-${SESSION}.lock"')


def test_every_post_lock_new_session_is_bounded(source):
    lock = _spawn_lock_offset(source)
    unbounded = [
        line.strip()
        for line in source[lock:].splitlines()
        if "tmux new-session" in line
        and not line.lstrip().startswith("#")
        and "timeout " not in line
    ]
    # Il ramo container (post-#214) e il ramo WSL/PowerShell sono entrambi
    # dentro la regione del lock: nessuno dei due può restare nudo.
    assert unbounded == [], f"tmux new-session senza timeout dopo il flock: {unbounded}"


def test_post_lock_new_session_count_is_known(source):
    """Guardia contro un TERZO ramo di spawn aggiunto senza limite."""
    lock = _spawn_lock_offset(source)
    calls = [
        line for line in source[lock:].splitlines()
        if "tmux new-session" in line and not line.lstrip().startswith("#")
    ]
    assert len(calls) == 2, (
        "i rami di spawn post-lock sono cambiati: aggiorna il test E verifica "
        f"che il nuovo sia limitato — trovati {len(calls)}"
    )


def test_detached_children_do_not_inherit_the_spawn_lock(source):
    """`9>&-` sui figli detached: il lock non deve sopravvivere allo script.

    Il loop di auto-accept del dialog TUI vive fino a 120s DOPO l'uscita di
    start-agent.sh e fa `tmux capture-pane` senza limite. Ereditando il fd 9
    terrebbe il lock per tutto quel tempo — e per sempre se tmux si incanta.
    Il ramo tg-bridge lo chiude già (vedi il commento a ~riga 403): questa
    asserzione estende la stessa regola a TUTTI i figli detached.
    """
    detached = [
        line.strip()
        for line in source.splitlines()
        if line.rstrip().endswith("&")
        and "< /dev/null" in line
        and not line.lstrip().startswith("#")
    ]
    assert detached, "nessun figlio detached trovato: il test ha perso il bersaglio"
    leaking = [line for line in detached if "9>&-" not in line]
    assert leaking == [], f"figli detached che ereditano il fd 9 del flock: {leaking}"


def test_error_cleanup_after_a_hung_spawn_cannot_itself_hang(source):
    """La kill-session del path d'errore è a sua volta limitata.

    Se `new-session` è scaduto perché il server tmux è wedgato, una
    `kill-session` nuda si appende con la stessa probabilità: il `exit 1` non
    viene raggiunto e il fix del timeout si autoannulla.
    """
    lock = _spawn_lock_offset(source)
    naked = [
        line.strip()
        for line in source[lock:].splitlines()
        if "tmux kill-session" in line
        and not line.lstrip().startswith("#")
        and "timeout " not in line
    ]
    assert naked == [], f"tmux kill-session senza timeout dopo il flock: {naked}"
```

Comando (mirato, coerente con la regola "niente suite intere su questo PC"):

```
pytest tests/test_start_agent_bounded_post_lock.py -v
```

Stato atteso **prima** delle patch §4.1/§4.2: `test_every_post_lock_new_session_is_bounded` ❌ (ramo WSL nudo), `test_detached_children_do_not_inherit_the_spawn_lock` ❌ (riga 1178), `test_error_cleanup_after_a_hung_spawn_cannot_itself_hang` ❌ (riga 1124), `test_post_lock_new_session_count_is_known` ✅. **Dopo** le patch: tutti verdi. Un test che fallisce oggi e passa dopo il fix è esattamente ciò che a #214 mancava.

### Cosa NON provare a testare qui

Un test d'integrazione che appende davvero un `tmux new-session` (via un fake `tmux` nel PATH che fa `sleep infinity`) sarebbe più fedele ma serve un tmux vero, tempi reali di 20-30 s, e su Windows/host è rumore garantito (cfr. la baseline nota di ~155 fallimenti pytest su host Windows). Il difetto è statico — una guardia mancante — e il test statico lo presidia al 100% con costo zero.

---

## 6. Sintesi per la decisione di merge

| # | Finding | Rischio | Azione |
| --- | --- | --- | --- |
| 1 | `tmux new-session` WSL non limitato (`:1081`) dentro la regione flock | 🟡 TEORICO (ramo irraggiungibile: tutti i chiamanti sono container con `IS_CONTAINER=1`) — ma unica barriera è una env var, su una piattaforma dove il difetto gemello ha già colpito | Patch §4.1, una parola |
| 2 | Subshell `setsid` eredita il fd 9 del flock (`:1178`, manca `9>&-`) | 🔴 **REALE** — lock tenuto 120 s dopo ogni spawn; **permanente** se `capture-pane` si appende → riproduce il lockout che #214 dichiara di chiudere | Patch §4.2, **da fare** |
| 3 | `tmux kill-session` nuda nel path d'errore di #214 (`:1124`) | 🟠 REALE — può annullare il fix di #214 proprio nello scenario che lo attiva | Patch §4.2 (seconda metà) |
| 4 | 12 altre chiamate `tmux` illimitate post-flock (`:553`, `send-keys` ×11) | 🟠 REALE se la root cause è un server tmux wedgato | `jht_bounded()` §4.3-1, ticket separato |
| 5 | I/O su bind mount post-flock (skill copy, cp, sqlite) | 🟡 lentezza, non hang dimostrato | Osservare; coprire con §4.3-1 |
| 6 | #214 non ha portato test | 🟠 invariante non presidiata | `tests/test_start_agent_bounded_post_lock.py` §5 |

**#214 resta un miglioramento netto e va tenuto.** Ma la sua tesi — "un tmux che non ritorna mai tiene il lock per sempre" — è più larga della sua patch: il finding #2 mostra che lo stesso lockout permanente è ancora raggiungibile nel ramo container vivo, per una via che il `timeout 20` non intercetta.
