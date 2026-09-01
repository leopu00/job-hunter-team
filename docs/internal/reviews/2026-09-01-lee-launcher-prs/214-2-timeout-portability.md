# PR #214 — Rischio 2/5: portabilità di `timeout` nella guardia di `tmux new-session`

> Analisi di sola lettura sul branch `lee-launcher-fixes` (PR #214 e #223 già mergiate).
> Nessun file sorgente è stato modificato.

---

## ⚖️ Verdetto

**RISCHIO REALE MA CONFINATO — gravità BASSA in produzione, MEDIA sulla diagnosticabilità.**

- ✅ Su **tutti** i percorsi di prodotto supportati (container Docker su Windows/macOS/Linux/VPS) `timeout` esiste: `Dockerfile:9` è `node:22-bookworm-slim`, cioè Debian con GNU coreutils. Lì il costrutto di #214 fa esattamente quello che promette.
- ⚠️ Esistono però **due percorsi reali fuori dal container** in cui il ramo `else` di `start-agent.sh` viene eseguito su host, e su **host macOS** `timeout` non c'è (è `gtimeout`, e solo se l'utente ha installato `coreutils` da Homebrew). In quel caso `command not found` → rc 127 → il ramo `if !` scatta → **ogni** spawn muore.
- 🔴 L'aggravante non è la frequenza ma il **messaggio**: lo script stampa `did not return within 20s (hung spawn)` mentre la causa vera è `timeout: command not found`. Chi debugga insegue un hang che non esiste. Questa è la parte davvero costosa del difetto.
- 💰 Il fix costa ~10 righe in un file già sorgeato da `start-agent.sh`. Rapporto costo/beneficio nettamente a favore del fix.

---

## 1️⃣ Il ramo bash/else gira solo nel container?

### La condizione al bivio

`.launcher/start-agent.sh:1079`:

```bash
if [ "${IS_CONTAINER:-0}" != "1" ] && grep -qi microsoft /proc/version 2>/dev/null; then
```

Il ramo `then` (PowerShell/WSL) richiede **entrambe** le condizioni. Quindi il ramo `else` — quello con `timeout 20` a `.launcher/start-agent.sh:1120` — è preso in **tre** situazioni distinte, non una:

| Ambiente | `IS_CONTAINER` | `/proc/version` contiene `microsoft` | Ramo preso |
|---|---|---|---|
| Container JHT (Docker Desktop su Windows, WSL2 backend) | `1` (`Dockerfile:17`) | sì (kernel WSL2 condiviso) | **else** ✅ `timeout` c'è |
| Container JHT (Linux/VPS/macOS+Colima) | `1` | no | **else** ✅ `timeout` c'è |
| WSL nativo (host Windows) | non settato | sì | then (PowerShell) — irrilevante |
| **Linux host nativo, no container** | non settato | no | **else** ✅ `timeout` c'è (coreutils GNU) |
| **macOS host nativo, no container** | non settato | no (nessun `/proc`) | **else** ❌ **`timeout` NON c'è** |

`IS_CONTAINER=1` è impostato solo nell'immagine e nei compose: `Dockerfile:17`, `docker-compose.yml:72`, `scripts/sim/docker-compose.sim.yml:39`, `game/scripts/backend/payloads/runtime_compose.yml:19`. Fuori di lì non è settato da nessuno — quindi *ogni* esecuzione host cade nel default `0`.

### Lo script è scritto per girare anche su host — non è un incidente

Tre punti lo dichiarano esplicitamente:

- `.launcher/config.sh:11-12` — «Rispetta `JHT_HOME`/`JHT_USER_DIR` se già settati via env (nel container JHT il Dockerfile esporta `JHT_HOME=/jht_home`). **Fallback: host-style**» → `JHT_HOME="${JHT_HOME:-$HOME/.jht}"`.
- `.launcher/start-agent.sh:569-577` — «In the JHT container HOME is overridden to `/jht_home` … **On the host the same file is at `~/.jht/jht.config.json`**».
- `.launcher/start-agent.sh:543-545` — «`flock` è disponibile nel container Linux; **fuori dal container il fallback conserva il comportamento storico**».

Quest'ultimo è la prova più diretta: l'autore del lock *aveva in mente* l'esecuzione host e ha degradato di conseguenza. `timeout` è stato aggiunto senza la stessa cura.

### Censimento dei chiamanti reali

| Chiamante | File:riga | Trasporto | Host possibile? |
|---|---|---|---|
| CLI `jht team start` (container mode) | `cli/src/commands/team/start.js:290` (`execScriptInContainer('/app/.launcher/start-agent.sh', …)`) | `docker exec` | ❌ no |
| CLI `jht team start` (host legacy, `--no-docker`) | `cli/src/commands/team/start.js:330-404` | **non usa start-agent.sh**: `execSync('tmux new-session …')` inline a `start.js:392` | ❌ (non passa da qui) |
| pid1 / bootstrap bridge | `cli/src/commands/pid1.js:44` (`/app/.launcher/start-agent.sh`) | dentro il container | ❌ no |
| Watchdog agenti | `.launcher/agent-watchdog.sh:74` (`JHT_START_AGENT:-/app/.launcher/start-agent.sh`) | dentro il container | ❌ no |
| Bridge Python (auto-riparazione) | `.launcher/sentinel-bridge.py:2328`, `.launcher/pacing-bridge.py:1291` | dentro il container | ❌ no |
| Godot / VPS backend | `game/scripts/backend/vps_backend.gd:1081` (`setsid -f bash /app/.launcher/start-agent.sh assistente`) | via SSH + `docker exec` | ❌ no |
| Simulatore | `scripts/sim/sim-up.sh:97,100`, `scripts/sim/sim-reset.sh:109` | `docker exec` | ❌ no |
| **Web API `POST /api/agents/[id]` action=start** | `web/app/api/agents/[id]/route.ts:188-196` → `runScript(startAgentScript, …)` | **dipende dall'env** ⬇️ | ⚠️ **sì** |

Il caso web è l'unico vivo con un ramo host. `web/lib/shell.ts:90-111`:

```ts
export async function runScript(scriptPath: string, ...args: string[]) {
  if (dockerContainer) { /* docker exec -i <c> bash <script> args */ }
  const prefix = await shellPrefix();          // shell.ts:48-57
  …
  return execAsync(`${prefix}bash ${quotedScript} ${escapedArgs}`);
}
```

`shellPrefix()` (`web/lib/shell.ts:48-57`) ritorna `wsl -d <distro> -- ` su Windows e **stringa vuota su Linux/macOS**. `dockerContainer` esiste solo se `JHT_SHELL_VIA=docker:<c>` (`web/lib/shell.ts:14-17`). Quindi:

- **Web dentro il container** (produzione): nessun `JHT_SHELL_VIA`, `isWindows` falso → `bash /app/.launcher/start-agent.sh …` **dentro** il container. ✅ sicuro.
- **Web dev su host Windows**: `npm run dev:host` esporta `JHT_SHELL_VIA=docker:jht` (`web/package.json:7`, anche `scripts/dev-up.sh:95`, `scripts/dev-up-additional.sh:81`) → `docker exec`. ✅ sicuro. Senza quella env cade sul ramo WSL — Linux, `timeout` c'è. ✅
- **Web dev su host macOS con il semplice `npm run dev`** (`web/package.json:6`, nessun `JHT_SHELL_VIA`): `prefix = ""` → esegue **`bash <repo>/.launcher/start-agent.sh scout 1` nativamente su macOS**. ❌ **qui il difetto morde.**

Il secondo percorso host è l'esecuzione **manuale/documentata** dello script su un'installazione expert-mode. `scripts/install.sh:105` accetta `--no-docker`; il path nativo (`scripts/install.sh:796-990`) clona il repo (quindi `.launcher/` c'è) e a `scripts/install.sh:813-819` installa tmux **anche su macOS** (`install_dep tmux brew install tmux`). In quella modalità `jht team start` non passa da `start-agent.sh` (usa il ramo legacy di `start.js:392`), ma lo script è presente, eseguibile, documentato (`docs/about/FAQ.md:85`, `docs/guides/ADDING-A-PROVIDER.md:59`) e storicamente lanciato a mano in diagnosi (vedi `docs/internal/_archive/BACKLOG-2026-07-03-frozen.md:1254`, «Eseguito `start-agent.sh` a mano»).

**Conclusione punto 1:** il ramo `else` **non** gira solo nel container. Gira su qualunque host non-WSL. Su Linux host è innocuo; su macOS host no.

---

## 2️⃣ L'host macOS è contemplato dal repo? Verdetto documentato

**Contemplato e supportato — ma come *host del container*, non come runtime nativo degli agenti.** Le prove:

| Prova | File:riga | Cosa dimostra |
|---|---|---|
| `stat -f` BSD con commento esplicito | `.launcher/daemon-lib.sh:39-43` — «`stat -c` = GNU (container), **`stat -f` = BSD (host macOS)**, `wc` = fallback» | Il codice `.launcher/` è scritto **sapendo** che può girare su macOS host. È il precedente diretto: stessa famiglia di problema (binario GNU vs BSD), risolto con degradazione a cascata |
| Commento entrypoint | `.launcher/entrypoint.sh:7-8` — «On **macOS**/Linux the mounts map to the caller and are already writable» | macOS è un host di primo livello per il container |
| Requisiti pubblici | `README.md:89` — «Windows x64, Linux x64, or **macOS** (Intel 11+; Apple silicon 13+)»; `README.md:113-114` — build `.zip` macOS firmata e notarizzata | Piattaforma di rilascio dichiarata, non legacy |
| Installer | `scripts/install.sh:25-26, 52-54, 78-79, 236, 266, 343-346` — runtime `colima` (default) / `podman` (preview) / `docker-desktop`; `RUNTIME_DIR` in `~/Library/Application Support/…` | Supporto macOS di prima classe nell'installer |
| Test dedicato | `tests/test_podman_macos_preparation.py` | Il supporto macOS ha copertura propria |
| Modalità nativa | `scripts/install.sh:105` (`--no-docker`), `:813-819` (`brew install tmux` su macOS) | Esiste una modalità **senza container** dichiaratamente supportata (expert), anche su macOS |

**Verdetto:** macOS host è **supportato, non deprecato, mai stato assente**. Ciò che *non* è il percorso raccomandato è far girare gli agenti nativamente su macOS (`--no-docker` è marcato "expert mode", `scripts/install.sh:216`) — ma "expert mode" è un percorso supportato con un avviso, non un percorso rimosso.

---

## 3️⃣ Come il repo gestisce altrove i binari opzionali

Il pattern dominante è `command -v <bin>` + **degradazione**, mai fallimento. Censimento completo in `.launcher/`:

| # | File:riga | Binario | Comportamento se manca |
|---|---|---|---|
| 1 | `.launcher/start-agent.sh:545-552` | `flock` | **Salta il lock** e prosegue. Commento a `:543-544`: «fuori dal container il fallback conserva il comportamento storico» ← **precedente più vicino** |
| 2 | `.launcher/start-agent.sh:380-387` | `flock` (ramo tg-bridge) | idem: salta il lock, prosegue |
| 3 | `.launcher/codex-auth-healer.sh:123-137` | `flock` | `log "WARN flock unavailable — continuing without singleton lock"` e prosegue. Commento a `:123-124`: «**meglio un healer senza lock che nessun healer**» ← **il modello di riferimento per il fix** |
| 4 | `.launcher/start-agent.sh:586-604` | `python3`, poi `jq` | Cascata a tre livelli: python3 → jq → `echo "\|\|"` (vuoto) |
| 5 | `.launcher/start-agent.sh:731` | `python3` | Condizione AND: se manca, salta il blocco |
| 6 | `.launcher/start-agent.sh:833` | `python3` | Guardia sul blocco Scout |
| 7 | `.launcher/start-agent.sh:1202` | `python3` | Guardia sullo spawn-stagger |
| 8 | `.launcher/daemon-lib.sh:73` | `python3` + `proc-kill.py` | Fallback shell `_jht_kill_scan_fallback` (`daemon-lib.sh:57-68`) |
| 9 | `.launcher/daemon-lib.sh:40-43` | `stat` GNU/BSD | Cascata `stat -c` → `stat -f` → `wc -c` → `0` |
| 10 | `.launcher/spawn-lib.sh:143` | `jq` | Salta la lettura preferenze |
| 11 | `.launcher/spawn-lib.sh:282` | `python3` | `return 0` (no-op) |

**Dipendenze *dure*** (fallimento voluto), per contrasto: `.launcher/start-agent.sh:752` (`$CLI_BIN`) e `:762` (`tmux`) — cioè le due cose senza cui l'agente **non può esistere**. `timeout` non è in questa categoria: è un guard-rail, non un ingrediente.

`timeout` a `.launcher/start-agent.sh:1120` è oggi **l'unica** dipendenza da binario opzionale in tutto `.launcher/` gestita né con `command -v` né con tolleranza al fallimento. L'asimmetria segnalata da Lee è confermata: a `.launcher/start-agent.sh:985` lo stesso binario è usato con `|| true`, cioè in modo benigno.

---

## 4️⃣ Fix proposto (NON applicato)

### Dove metterlo

`.launcher/daemon-lib.sh` è già sorgeato da `start-agent.sh:26` — **zero wiring nuovo**, e ospita già la cascata GNU/BSD di `stat` (`:39-43`), quindi è il posto tematicamente giusto. `config.sh` è per i path e basta: non è il posto.

Bonus: `bridge-control.sh:16` sorgea anch'esso `daemon-lib.sh`, quindi l'helper è disponibile a chi verrà dopo.

### Diff 1 — helper condiviso

```diff
--- a/.launcher/daemon-lib.sh
+++ b/.launcher/daemon-lib.sh
@@
 #   jht_daemon_log <nome-file>
 #       Stampa il path del log del daemon sotto $JHT_HOME/logs (bind-mount,
 #       sopravvive al recreate del container — /tmp è il layer effimero e i log
 #       ci sparivano a ogni `docker compose up --force-recreate`), creando la
 #       directory e ruotando il file se supera la soglia.
+#
+#   jht_timeout <secondi> <comando...>
+#       Esegue <comando> con un tetto di tempo DOVE il tetto è disponibile.
+#       Propaga sempre il rc del comando (124 se il tetto è scattato).
 
 # Directory di questo file — risolta una volta sola, funziona anche quando lo
 # script sorgente viene invocato via path relativo.
 JHT_LAUNCHER_DIR="${JHT_LAUNCHER_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"
+
+# `timeout` è GNU coreutils: c'è sempre nel container (Dockerfile: Debian
+# bookworm) e sugli host Linux, NON su macOS/BSD — lì al più è `gtimeout`,
+# e solo con `brew install coreutils`. Senza questa cascata un `timeout`
+# assente esce 127 e ogni chiamante che tratta il non-zero come errore
+# fatale trasforma un guard-rail mancante nel fallimento dell'operazione
+# che doveva proteggere. Stessa scelta di `stat -c`/`stat -f` qui sotto e
+# di `flock` in codex-auth-healer.sh: si degrada, non si muore.
+jht_timeout() {
+  local secs="$1"
+  shift
+  if command -v timeout >/dev/null 2>&1; then
+    timeout "$secs" "$@"
+  elif command -v gtimeout >/dev/null 2>&1; then
+    gtimeout "$secs" "$@"
+  else
+    "$@"
+  fi
+}
```

### Diff 2 — call site

```diff
--- a/.launcher/start-agent.sh
+++ b/.launcher/start-agent.sh
@@
-  if ! timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR"; then
-    echo "Error: 'tmux new-session' for '$SESSION' did not return within 20s (hung spawn)." >&2
+  # jht_timeout (daemon-lib.sh): il tetto c'è dove `timeout` esiste; su un
+  # host senza coreutils GNU il comando gira nudo invece di fallire 127.
+  _spawn_rc=0
+  jht_timeout 20 tmux new-session -d -x 220 -y 50 -s "$SESSION" -c "$AGENT_DIR" \
+    || _spawn_rc=$?
+  if [ "$_spawn_rc" -ne 0 ]; then
+    if [ "$_spawn_rc" -eq 124 ]; then
+      echo "Error: 'tmux new-session' for '$SESSION' did not return within 20s (hung spawn)." >&2
+    else
+      echo "Error: 'tmux new-session' for '$SESSION' failed (rc=$_spawn_rc)." >&2
+    fi
     # Pulizia best-effort: se tmux ha comunque registrato una sessione a
     # meta', non lasciarla a meta' per il prossimo tentativo.
     tmux kill-session -t "$SESSION" 2>/dev/null
     exit 1
   fi
```

### Perché la forma `|| _spawn_rc=$?` e non `if ! …; then … $?`

Con `if ! cmd; then`, dentro il `then` `$?` vale il risultato **negato** (0/1), non il rc di `cmd`: POSIX definisce `!` come negazione logica dello stato d'uscita. Quindi l'unico modo di distinguere il 124 (timeout scattato davvero) da un rc qualunque di tmux è catturare prima. `|| _spawn_rc=$?` è anche l'unica forma safe sotto il `set -euo pipefail` di `start-agent.sh:11`.

Questo è un **beneficio collaterale non banale**: oggi qualunque fallimento di `tmux new-session` (sessione duplicata, server tmux non avviabile, `-c "$AGENT_DIR"` inesistente) viene riportato come «hung spawn». La diagnosi mente in tutti i casi tranne uno.

### Nota su `.launcher/start-agent.sh:985`

Lasciarlo com'è è accettabile (`|| true`: se `timeout` manca, `claude -p "ok"` semplicemente non viene mai eseguito e il warmup avvisa a `:990`). Per coerenza si può passare anche quello a `jht_timeout 30 claude …` — così su un host senza `timeout` il warmup **funziona** invece di essere silenziosamente saltato. È un miglioramento, non un requisito del fix.

### Alternativa scartata

Una guardia in linea `if command -v timeout >/dev/null 2>&1; then … else … fi` duplicherebbe l'intera invocazione di `tmux new-session` (14 argomenti) in due rami da tenere allineati a mano. L'helper è più corto e non ha quel debito.

---

## 5️⃣ Test da aggiungere

Convenzione del repo: pytest che **asserisce sul sorgente shell** (vedi `tests/test_start_agent_persistent_cli_path.py:4-27` e `tests/test_spawn_stagger.py:40-42`), più — dove serve — una verifica comportamentale reale in `subprocess` (precedente: `tests/test_message_origin.py:174`). Oggi **nessun test copre la riga `timeout 20`**: l'unico match su `tmux new-session` in `tests/` è `tests/test_critic_effort_contract.py:47`, che verifica tutt'altro.

File proposto: `tests/test_start_agent_spawn_timeout_portability.py`.

```python
"""La guardia sullo spawn tmux non deve diventare il motivo del fallimento.

Origine: PR #214. `timeout 20 tmux new-session` protegge da un `tmux
new-session` appeso (osservato in produzione su bind mount Windows), ma
`timeout` è GNU coreutils: sul container c'è sempre, su un host macOS no.
Assente → rc 127 → il ramo di errore scatta → ogni spawn fallisce, con un
messaggio che accusa un hang inesistente.

Cosa questa suite tiene fermo:
  1. il call site passa da `jht_timeout`, non da `timeout` nudo;
  2. `jht_timeout` è definito in daemon-lib.sh, che start-agent.sh sorgea
     PRIMA di usarlo;
  3. senza né `timeout` né `gtimeout` il comando gira comunque e il rc è
     quello del comando (degradazione, non fallimento);
  4. dove `timeout` c'è, il tetto scatta davvero e il rc è 124;
  5. il call site distingue 124 (hang) da un rc qualunque di tmux.
"""
```

Casi:

| # | Test | Tipo | Ancoraggio |
|---|---|---|---|
| 1 | `test_spawn_guard_uses_the_portable_timeout_helper` — nel sorgente di `start-agent.sh` compare `jht_timeout 20 tmux new-session` e **non** compare `timeout 20 tmux new-session` | source-assert | difende dal ritorno del binario nudo |
| 2 | `test_helper_is_sourced_before_the_spawn_guard` — `source "$DEV_TEAM_DIR/daemon-lib.sh"` (`start-agent.sh:26`) ha indice **minore** dell'uso di `jht_timeout`; stessa forma di `test_start_agent_persistent_cli_path.py:22-27` | source-assert ordinale | un futuro riordino dei `source` romperebbe tutto in silenzio |
| 3 | `test_jht_timeout_runs_the_command_when_no_timeout_binary_exists` — `bash -c 'source daemon-lib.sh; jht_timeout 5 …'` con `PATH` ridotto a una dir temp contenente solo i binari necessari (**senza** `timeout`/`gtimeout`): rc 0 e output prodotto | comportamentale | è **il** caso macOS, e nessun source-assert lo cattura |
| 4 | `test_jht_timeout_propagates_the_command_exit_code` — stesso setup, comando che esce 3 → rc 3 (non 0, non 1) | comportamentale | il degrado non deve mascherare errori veri |
| 5 | `test_jht_timeout_still_caps_when_the_binary_exists` — con `timeout` sul PATH, `jht_timeout 1 sleep 5` → rc 124 in < 3s | comportamentale | la protezione di #214 resta la protezione di #214 |
| 6 | `test_jht_timeout_prefers_gtimeout_on_bsd` — PATH con un solo shim `gtimeout` eseguibile che scrive un marker: il marker viene scritto | comportamentale con shim | copre il ramo BSD che nessuna CI Linux esercita |
| 7 | `test_spawn_guard_reports_a_hang_only_on_124` — nel sorgente, `hung spawn` è dentro un ramo condizionato a `124`, ed esiste un ramo alternativo che stampa l'`rc` | source-assert | evita il ritorno alla diagnosi che mente |

Note d'implementazione:

- I casi 3-6 richiedono `bash`; guardarli con `pytest.mark.skipif(shutil.which("bash") is None, reason="bash non disponibile")` — su host Windows la baseline è già rumorosa e non vale la pena aggiungere fallimenti ambientali.
- Il PATH ridotto va costruito con `tmp_path` + symlink/copy dei soli binari serventi (`sh`, `env`, `printf` builtin basta), **non** svuotando `PATH` (bash ha un fallback interno che rimetterebbe `/usr/bin`).
- Nessun test deve avviare tmux reale: il guard-rail si prova con `sleep`/`true`/`false`, non con lo spawn di un agente.

---

## 📌 Sintesi per il merge

Il costrutto di #214 è **corretto nel merito** (il difetto che risolve è documentato a `.launcher/start-agent.sh:1108-1119` con numeri: 756 respawn falliti in 37h) e **innocuo in produzione**. Ha però due difetti di forma che il repo altrove non si concede: è l'unica dipendenza da binario opzionale in `.launcher/` senza `command -v`, ed è l'unica in cui l'assenza del binario è **fatale** invece che degradante. Il fix è locale, riusa un file già sorgeato, e in più ripara un messaggio d'errore che oggi è sbagliato in tutti i casi tranne uno.

**Raccomandazione:** non bloccante per il merge di #214; da schedulare come follow-up ravvicinato insieme ai test 1-3 e 7 (i più economici e quelli che coprono la regressione vera).
