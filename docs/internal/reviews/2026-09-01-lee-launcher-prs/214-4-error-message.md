# PR #214 — rischio 4/5: la diagnostica che mente

**Verdetto: CONFERMATO, e più grave di come è stato formulato.**

Il problema non è solo che `if ! timeout …` attribuisce a un timeout qualunque
fallimento istantaneo di `tmux`. È che nello stesso blocco:

1. il messaggio afferma un fatto (`did not return within 20s`) che il codice non
   ha verificato — `.launcher/start-agent.sh:1121`;
2. il `tmux kill-session` incondizionato di `.launcher/start-agent.sh:1124` è
   **distruttivo** su almeno un rc non-timeout (rc=1 `duplicate session`): in
   quel caso uccide la sessione di un agente **vivo**, che questo processo non
   ha creato;
3. il solo posto dove la verità sopravvive (la riga che `tmux` scrive di suo su
   stderr) viene **scartata** dal chiamante principale, che tiene solo l'ultima
   riga di stderr — `cli/src/commands/team/start.js:301`. Cioè: l'unica frase
   che arriva all'utente e alla dashboard cloud è esattamente quella falsa.

Il blocco in esame, `.launcher/start-agent.sh:1120-1126`:

```sh
  if ! timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"; then
    echo "Error: 'tmux new-session' for '$SESSION' did not return within 20s (hung spawn)." >&2
    tmux kill-session -t "$SESSION" 2>/dev/null
    exit 1
  fi
```

Contesto rilevante: lo script gira sotto `set -euo pipefail`
(`.launcher/start-agent.sh:11`); l'immagine di runtime è
`node:22-bookworm-slim` (`Dockerfile:9`), quindi `timeout` è quello di GNU
coreutils e la tabella sotto vale per il percorso container.

---

## 1. Tabella dei return code

`timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"`

| rc | Cosa è successo davvero | Sessione creata? | Cleanup corretto | Cosa dovrebbe fare lo script |
|----|-------------------------|------------------|------------------|------------------------------|
| `0` | Sessione creata. | Sì | — | Prosegue (già corretto). |
| `124` | **Solo qui** il timeout è scaduto: `timeout` ha mandato SIGTERM al client `tmux` dopo 20s. Il server può aver registrato la sessione a metà. | Indeterminata | **Sì, `kill-session`** | Messaggio "hung spawn" attuale. È l'unico caso in cui la frase è vera. |
| `125` | È fallito `timeout` stesso (argomenti/uso). | No | No | Errore di *invocazione dello script*, non dello spawn. Fallire con messaggio distinto; non toccare la sessione. |
| `126` | `tmux` trovato ma non eseguibile (permessi, noexec sul mount). | No | No | Come sopra: problema d'ambiente, non spawn appeso. |
| `127` | `tmux` non trovato nel `PATH` del chiamante. Realistico: la preflight `command -v tmux` di `.launcher/start-agent.sh:762-765` gira nello stesso processo, quindi in pratica intercetta il caso — ma `timeout` è invocato **senza** preflight propria, e un `timeout` assente cade anch'esso in 127. | No | No | Messaggio distinto ("binario mancante"), nessun cleanup. |
| `1` | rc propagato da `tmux`. Caso più frequente: `duplicate session: <SESSION>`, ma anche `no server running` / socket dir non scrivibile / nome sessione invalido. `tmux` ha già scritto la sua diagnosi su stderr. | **Può esistere già, creata da altri** | **NO — cleanup DANNOSO** | Riportare rc + la riga di `tmux`, uscire 1, **non** killare nulla. |
| `2`+ (altri rc di tmux) | Uso/parsing errato lato tmux. | No | No | Come rc=1. |
| `137` / `143` | Il processo è stato ucciso dall'esterno (OOM killer, `docker stop`). Senza `-k`, `timeout` **non** produce 137 di suo. | Improbabile | No | Come rc=1: rc esplicito, nessuna affermazione sul timeout. |
| *(non ritorna)* | `timeout 20` senza `-k` manda SIGTERM e **poi aspetta**. Se il client `tmux` è bloccato in stato D (I/O su bind-mount Windows — cioè proprio lo scenario che la PR dice di aver osservato), SIGTERM non lo scioglie e il blocco resta appeso come prima. | — | — | Fuori scope di questo rischio, ma va segnalato: senza `-k 5` la garanzia "questo branch ritorna sempre" del commento `:1113-1119` non è dimostrata. |

### Il `kill-session` incondizionato è sbagliato

Sequenza realistica sul rc=1:

- `.launcher/start-agent.sh:545-552` serializza per sessione con `flock`, **ma
  solo se `flock` esiste** (`command -v flock`); fuori dal container (macOS, e
  il ramo host non-WSL) il lock semplicemente non c'è;
- due spawn concorrenti dello stesso ruolo passano entrambi il check di
  idempotenza `tmux has-session` di `.launcher/start-agent.sh:553-557` perché
  nessuno dei due ha ancora creato la sessione;
- il primo crea `SCOUT-1`; il secondo riceve `duplicate session: SCOUT-1`, rc=1;
- `.launcher/start-agent.sh:1124` esegue `tmux kill-session -t SCOUT-1` e
  **ammazza l'agente appena nato**, poi esce 1.

Prima della PR #214 il ramo `else` non aveva alcun `kill-session`: questo è un
comportamento **introdotto** dalla PR, non preesistente. Vale anche come
violazione della regola di team T01 ("mai killare la sessione di un altro
agente", citata in `agents/_skills/spawn-agent/SKILL.md:134`).

Nota minore sullo stesso `kill-session`: non ha `|| true`, a differenza del
gemello `.launcher/start-agent.sh:188`. Sotto `set -e` un `kill-session` che
fallisce (sessione inesistente — il caso *normale*) fa uscire lo script prima di
raggiungere `exit 1`. L'rc osservato resta 1, quindi non è un bug funzionale, ma
la riga `exit 1` è di fatto irraggiungibile nel caso più comune ed è
un'incoerenza di stile.

---

## 2. Dove finisce oggi quel messaggio, chiamante per chiamante

`start-agent.sh` **non scrive mai su file di log**: non esiste alcun
`>> $JHT_HOME/logs/...` nello script (le sole occorrenze di `logs/` sono path
passati ai daemon figli, `.launcher/start-agent.sh:429-431`). Il destino del
messaggio è quindi interamente deciso dal chiamante.

| Chiamante | Percorso | Destino della riga | Persa? |
|---|---|---|---|
| **Agenti LLM (Capitano/Dottore) dalla propria TUI** — `agents/_skills/spawn-agent/SKILL.md:11-22`, `agents/capitano/capitano.md:267` | `bash /app/.launcher/start-agent.sh <role> <N>` dentro il tool Bash del CLI | stdout+stderr uniti nel tool result → **letti dall'LLM**, insieme alla riga nativa di `tmux` | **No — ma è il lettore peggiore**: il Capitano legge "hung spawn" e apre un'indagine sul percorso sbagliato, o insiste col respawn |
| **`agent-watchdog.sh` — worker numerati** | `.launcher/agent-watchdog.sh:350` — `bash "$START_AGENT" … >>"$LOG" 2>&1` | `$JHT_HOME/logs/agent-watchdog.log` (`.launcher/agent-watchdog.sh:60`), riga grezza + riga di `tmux` | **No, persistita** (è il posto migliore in cui finisce oggi) |
| **`agent-watchdog.sh` — ruoli core** | `.launcher/agent-watchdog.sh:244` — passa da `jht team start "$role" >>"$LOG" 2>&1` | Nel log ci finisce **l'output di `jht`**, cioè già la riga riassunta e troncata (vedi sotto), non lo stderr originale | **Parzialmente persa** |
| **`agent-watchdog.sh` — bridge / tg-bridge** | `.launcher/agent-watchdog.sh:509-510` e `:534-535`, `>>"$LOG" 2>&1` | `agent-watchdog.log` | No (ma il ramo bridge non passa da `:1120`) |
| **CLI `jht team start`** | `cli/src/commands/team/start.js:290-296` → `execScriptInContainer` → `spawnSync` con stdout/stderr **catturati** (`cli/src/utils/container-proxy.js:116-123`, `:60-65`) | `cli/src/commands/team/start.js:301` prende **solo l'ultima riga non vuota** di stderr e stampa `✗ <SESSION> — <msg>` | **La riga di `tmux` è persa.** Sopravvive solo la nostra frase. Nel caso `duplicate session` l'utente vede *esclusivamente* la diagnosi falsa |
| **pid1 auto-start (boot container)** | `cli/src/commands/pid1.js:296-301` `spawnLabeled('autostart-<role>', node, ['team','start',role])` | `docker logs` + `$JHT_HOME/logs/autostart-<role>.log` (`cli/src/commands/pid1.js:360-388`, `:408-409`) — ma il contenuto è già l'output riassunto del CLI | **Parzialmente persa** (stessa amputazione del punto precedente) |
| **pid1 bootstrap bridge / tg-bridge** | `cli/src/commands/pid1.js:143-153`, `:167-177` (`start-agent.sh tg-bridge` / `bridge`) | `logs/tg-bridge-launcher.log`, `logs/bridge-launcher.log` | No (rami che non toccano `:1120`) |
| **Dashboard cloud → `team_commands` → poller** | `web/app/api/team/command/route.ts` accoda; `cli/src/lib/team-commands-poller.js:193-198` esegue `jht team start` e scrive `stdout || stderr || exit code` (ultimi 2000 char, ANSI strippato) nel campo `error` della riga Supabase | L'utente in dashboard vede la frase **falsa**, senza la riga di `tmux` | **Persa** |
| **Web UI locale, start del singolo agente** | `web/app/api/agents/[id]/route.ts:180-202` → `runScript` (`web/lib/shell.ts:90-112`, `promisify(execFile)`) → `err.message` in JSON | `err.message` di execFile include lo stderr completo → nella response `{ ok:false, error }` | **No** (unico percorso UI che conserva tutto) |
| **Guscio Godot / desktop** | `game/scripts/backend/vps_backend.gd:1079-1081` — `docker exec jht sh -lc 'tmux has-session … \|\| setsid -f bash …/start-agent.sh assistente'` | `setsid -f` forka e `docker exec` ritorna subito: l'output finisce su fd che nessuno legge | **Persa del tutto** |

**Conclusione del punto 2.** Il messaggio è persistito su file in un solo
percorso (`agent-watchdog.log`, per i worker numerati). Nei due percorsi che
un essere umano guarda davvero — il `✗` del CLI e il campo `error` della
dashboard cloud — arriva **solo la frase inventata**, perché il troncamento
all'ultima riga di `cli/src/commands/team/start.js:301` butta via proprio la
diagnosi vera di `tmux`. Rendere il messaggio accurato **non basta**: va reso
accurato *e* auto-contenuto in una riga sola, altrimenti l'informazione
aggiunta muore nello stesso punto in cui muore oggi.

---

## 3. Convenzione di error reporting in `.launcher/`

Censimento (tutti gli `>&2` degli script `.launcher/*.sh`):

**In `start-agent.sh`** — prefisso `Error: `, frase in **inglese**, minuscola
dopo i due punti, punto finale, `>&2`, nessun marker parsabile, nessun log su
file:

- `:362` `Error: unknown tg-bridge role '$INSTANCE' (valid: …).`
- `:384` `Error: timed out waiting for the concurrent spawn of tg-bridge […].`
- `:525` `Error: instance must be a positive numeric identifier.`
- `:549` `Error: timed out waiting for the concurrent spawn of '$SESSION'.`
- `:629` `Error: no Codex model mapping for role alias '$alias'.`
- `:720-721` `Error: active_provider is missing or unsupported in '…'.` + riga di rimedio
- `:817` `Error: invalid agent instance '$INSTANCE'.`
- `:1121` (la riga in esame)
- `:187` variante con glifo: `✗ $WORKER_SESSION: … — session removed`

Eccezioni interne allo stesso file (errori su **stdout**, non stderr):
`:514` (`Error: unrecognized role`) e `:763` (`Error: tmux not found`). Sono le
due incoerenze già presenti; non vanno imitate.

**Negli altri script `.launcher/*.sh`** — prefisso `[<label>] ERROR:` /
`[<label>] WARN:`, sempre inglese, sempre `>&2`:

- `.launcher/spawn-doctor.sh:48` e `.launcher/spawn-maintainer.sh:48`
  `[$LABEL] ERROR: tmux new-session failed` ← **gemelli diretti** della riga in
  esame, e sono onesti proprio perché non affermano una causa;
- `.launcher/spawn-lib.sh:327`, `:348`, `:376`, `:383`;
- `.launcher/entrypoint.sh:23`, `:30` (`[entrypoint] WARNING: …`);
- `.launcher/bridge-control.sh:34`, `:58`.

Chi ha un proprio file di log usa una funzione `log()` con timestamp UTC +
`tee`: `.launcher/agent-watchdog.sh:108-112`. Nessuno script `.launcher/`
emette marker machine-parsabili.

**Italiano vs inglese.** La convenzione vigente è netta e va rispettata per i
messaggi NUOVI: **commenti in italiano, messaggi user-visible in inglese**.
`start-agent.sh` ha 100% dei commenti in italiano e 100% dei messaggi in
inglese; l'unica eccezione italiana in tutto `.launcher/` è un messaggio
*interno* a un log (`.launcher/agent-watchdog.sh:513`, "suite bridge (morti: …)"
verso il Capitano) e va trattata come residuo, non come precedente. Regola per
questa PR: **inglese, prefisso `Error: `, `>&2`, una riga per condizione**.

---

## 4. Proposta (diff testuale — NON applicato)

Tre requisiti: (a) `124` discriminato dal resto; (b) `kill-session` solo su
`124`; (c) la diagnosi nativa di `tmux` **dentro la stessa riga**, così
sopravvive al troncamento di `cli/src/commands/team/start.js:301`.

```diff
--- a/.launcher/start-agent.sh
+++ b/.launcher/start-agent.sh
@@ -1117,13 +1117,42 @@
   # garantisce che questo branch ritorni sempre, cosi' il lock si libera
   # e il prossimo tentativo puo' ripartire pulito invece di ripetere
   # all'infinito lo stesso fallimento silenzioso.
-  if ! timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"; then
-    echo "Error: 'tmux new-session' for '$SESSION' did not return within 20s (hung spawn)." >&2
-    # Pulizia best-effort: se tmux ha comunque registrato una sessione a
-    # meta', non lasciarla a meta' per il prossimo tentativo.
-    tmux kill-session -t "$SESSION" 2>/dev/null
-    exit 1
-  fi
+  #
+  # Il rc va DISCRIMINATO: `timeout` restituisce 124 solo quando scade, 125/126/
+  # 127 per problemi suoi (binario mancante o non eseguibile) e altrimenti
+  # PROPAGA il rc di tmux. Un `if !` nudo attribuirebbe al timeout anche un
+  # fallimento istantaneo (`duplicate session`, socket dir non scrivibile,
+  # nome sessione invalido) — e manderebbe chi legge il log a cercare nel
+  # posto sbagliato, che e' esattamente il depistaggio che questo blocco
+  # esiste per chiudere.
+  #
+  # Lo stderr di tmux va catturato e RIMESSO nella nostra riga: il chiamante
+  # principale (cli/src/commands/team/start.js) tiene solo l'ULTIMA riga di
+  # stderr, quindi la diagnosi nativa di tmux, se resta una riga a se',
+  # non arriva mai ne' all'utente ne' alla dashboard cloud.
+  _ns_err="${TMPDIR:-/tmp}/jht-new-session-$$.err"
+  _ns_rc=0
+  timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR" \
+    2>"$_ns_err" || _ns_rc=$?
+  _ns_msg="$(tr '\n' ' ' <"$_ns_err" 2>/dev/null | sed 's/  */ /g; s/ *$//')"
+  rm -f "$_ns_err"
+  if [ "$_ns_rc" -ne 0 ]; then
+    case "$_ns_rc" in
+      124)
+        echo "Error: 'tmux new-session' for '$SESSION' did not return within 20s (hung spawn; tmux said: ${_ns_msg:-nothing})." >&2
+        # Pulizia best-effort SOLO qui: il client e' stato terminato a meta'
+        # dialogo col server, che puo' aver registrato la sessione lo stesso.
+        # Su ogni altro rc la sessione o non esiste, o esiste ma NON l'ha
+        # creata questo tentativo (`duplicate session`) — e ucciderla
+        # significherebbe ammazzare l'agente di qualcun altro (team-rules T01).
+        tmux kill-session -t "$SESSION" 2>/dev/null || true
+        ;;
+      125|126|127)
+        echo "Error: could not run 'timeout tmux new-session' for '$SESSION' (rc=$_ns_rc: command missing or not executable). No session was created." >&2
+        ;;
+      *)
+        echo "Error: 'tmux new-session' for '$SESSION' failed immediately (rc=$_ns_rc, not a timeout): ${_ns_msg:-no message from tmux}. No session was created by this attempt." >&2
+        ;;
+    esac
+    exit 1
+  fi
```

Note sulla proposta:

- `_ns_rc=0` prima dell'uso soddisfa `set -u` (`.launcher/start-agent.sh:11`);
  `|| _ns_rc=$?` neutralizza `set -e` senza `if !`.
- `|| true` sul `kill-session` allinea al gemello `.launcher/start-agent.sh:188`
  e rende raggiungibile l'`exit 1`.
- Ogni messaggio è **una riga sola** e dice esplicitamente se la sessione è
  stata creata o no: è l'informazione che serve a chi legge il `✗` del CLI o il
  campo `error` in dashboard.
- Fuori scope ma da tenere agganciato al ticket: `timeout 20` senza `-k`
  (vedi ultima riga della tabella) e il gemello WSL `.launcher/start-agent.sh:1081`
  che resta senza timeout. Sono i rischi degli altri due report.

---

## 5. Test da aggiungere

Convenzione: pytest source-asserting sullo script, come
`tests/test_start_agent_persistent_cli_path.py:4-27` e
`tests/test_spawn_stagger.py:40-42`. Un test comportamentale non è praticabile:
per arrivare alla riga 1120 lo script attraversa provider preflight, `flock`,
copia delle skill e `tmux has-session` — servirebbe un container. Il contratto
che va tenuto fermo è testuale, ed è esattamente ciò che una futura
"semplificazione" romperebbe.

Nuovo file `tests/test_start_agent_spawn_error_diagnostics.py`:

```python
"""Il fallimento di `tmux new-session` non deve MENTIRE sulla causa.

`timeout` restituisce 124 solo quando scade; 125/126/127 per problemi suoi;
altrimenti propaga il rc di tmux. Un `if ! timeout ...` nudo etichettava come
"hung spawn" anche un `duplicate session` istantaneo — e, peggio, faceva
partire un `kill-session` che su quel rc ammazza la sessione di un ALTRO
agente. Questa suite tiene fermo che:

  1. il rc viene catturato e discriminato, non collassato da un `if !`;
  2. la frase sul timeout compare SOLO nel ramo 124;
  3. il `kill-session` di quel blocco vive SOLO nel ramo 124;
  4. i rami non-timeout dicono esplicitamente che la sessione non e' stata
     creata da questo tentativo;
  5. lo stderr di tmux viene rimesso nella riga di errore (il chiamante CLI
     ne conserva solo l'ULTIMA riga, vedi cli/src/commands/team/start.js).
"""

from pathlib import Path

LAUNCHER = Path(__file__).parents[1] / ".launcher" / "start-agent.sh"


def _spawn_block() -> str:
    source = LAUNCHER.read_text(encoding="utf-8")
    start = source.index('tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"')
    end = source.index("send_env_vars", start)
    return source[start:end]


def test_rc_is_captured_instead_of_collapsed_by_a_bare_if():
    block = _spawn_block()
    assert "if ! timeout 20 tmux new-session" not in LAUNCHER.read_text(encoding="utf-8")
    assert "|| _ns_rc=$?" in block
    assert "case \"$_ns_rc\" in" in block


def test_timeout_wording_lives_only_in_the_124_branch():
    block = _spawn_block()
    timed_out = block.index("124)")
    other = block.index("125|126|127)")
    for phrase in ("hung spawn", "did not return within 20s"):
        assert block.count(phrase) == 1, f"{phrase!r} deve comparire una volta sola"
        assert timed_out < block.index(phrase) < other


def test_kill_session_is_confined_to_the_timeout_branch():
    # Su rc=1 (`duplicate session`) la sessione esiste ma l'ha creata QUALCUN
    # ALTRO: un kill incondizionato viola team-rules T01.
    block = _spawn_block()
    kill = block.index('tmux kill-session -t "$SESSION"')
    assert block.count('tmux kill-session -t "$SESSION"') == 1
    assert block.index("124)") < kill < block.index("125|126|127)")
    assert "2>/dev/null || true" in block[kill:kill + 80]


def test_non_timeout_branches_state_that_no_session_was_created():
    block = _spawn_block()
    tail = block[block.index("125|126|127)"):]
    assert tail.count("No session was created") == 1
    assert "not a timeout" in tail
    assert "No session was created by this attempt" in tail


def test_tmux_stderr_is_folded_into_the_single_error_line():
    # cli/src/commands/team/start.js tiene solo l'ultima riga di stderr: se la
    # diagnosi di tmux resta una riga a se', l'utente non la vede mai.
    block = _spawn_block()
    assert '2>"$_ns_err"' in block
    assert block.count("$_ns_msg") >= 2  # ramo 124 + ramo generico


def test_error_lines_go_to_stderr_in_english_with_the_house_prefix():
    block = _spawn_block()
    errors = [ln.strip() for ln in block.splitlines() if ln.strip().startswith("echo \"Error:")]
    assert len(errors) == 3
    assert all(ln.endswith(">&2") for ln in errors)
```

Il test `test_kill_session_is_confined_to_the_timeout_branch` è quello che
avrebbe fermato il difetto introdotto dalla PR; gli altri quattro sono la rete
sulla diagnostica.
