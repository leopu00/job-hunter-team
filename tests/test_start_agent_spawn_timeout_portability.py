"""La guardia sullo spawn tmux non deve diventare il motivo del fallimento.

Origine: PR #214. `timeout <N> tmux new-session` protegge da un `tmux
new-session` appeso (osservato in produzione su bind mount Windows), ma
`timeout` e' GNU coreutils: nel container c'e' sempre (Debian bookworm), su un
host macOS no — li' al piu' si chiama `gtimeout`, e solo con `brew install
coreutils`. Assente -> rc 127 -> il ramo di errore scatta -> OGNI spawn
fallisce, con un messaggio che accusa un hang inesistente. E il ramo host non
e' teorico: `web/lib/shell.ts` esegue lo script senza prefisso quando non c'e'
`JHT_SHELL_VIA`, cioe' con un semplice `npm run dev` su macOS.

Era anche l'unico binario opzionale di tutto `.launcher/` gestito ne' con
`command -v` ne' con tolleranza al fallimento: `flock`, `python3`, `jq`, `stat`
degradano tutti (11 precedenti; il modello e' `codex-auth-healer.sh`, "meglio
un healer senza lock che nessun healer").

Cosa questa suite tiene fermo:
  1. il call site passa da `jht_timeout`, non da un `timeout` nudo;
  2. `jht_timeout` e' definito in daemon-lib.sh, che start-agent.sh sorgea
     PRIMA di usarlo;
  3. senza ne' `timeout` ne' `gtimeout` il comando gira comunque e l'rc e'
     quello del comando (degradazione, non fallimento);
  4. dove `timeout` c'e', il tetto scatta davvero e l'rc e' 124;
  5. su BSD/macOS si preferisce `gtimeout` al comando nudo.

Eseguire:
    pytest tests/test_start_agent_spawn_timeout_portability.py -v
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
LAUNCHER = REPO_ROOT / ".launcher" / "start-agent.sh"
DAEMON_LIB = REPO_ROOT / ".launcher" / "daemon-lib.sh"

SOURCE = LAUNCHER.read_text(encoding="utf-8")
DAEMON_SOURCE = DAEMON_LIB.read_text(encoding="utf-8")

SPAWN_GUARD = 'jht_timeout "$JHT_SPAWN_TMUX_TIMEOUT_SEC" tmux new-session'

# `bash` serve per i casi comportamentali; su host Windows la baseline delle
# suite e' gia' rumorosa e non vale aggiungere fallimenti ambientali.
BASH = shutil.which("bash")
needs_bash = pytest.mark.skipif(BASH is None, reason="bash non disponibile")


def _bash(script: str, timeout: int = 60) -> subprocess.CompletedProcess:
    """Esegue uno snippet con cwd=repo: su Windows bash non digerisce `C:\\...`,
    quindi daemon-lib.sh va sorgeato per path relativo.

    L'eseguibile arriva da `shutil.which`, non dalla risoluzione di `argv[0]`:
    su un host Windows con WSL installato `bash` in PATH e' il launcher di WSL,
    che avviato da un processo Windows non riesce a forkare (la command
    substitution torna vuota e le redirezioni su file non creano niente), e i
    casi comportamentali fallirebbero per l'ambiente invece che per il codice.
    """
    return subprocess.run(
        [BASH, "-c", script],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
    )


# Prologo comune ai casi comportamentali: sorgea l'helper e prepara due dir
# temporanee — una con gli eseguibili di prova, una VUOTA da usare come PATH.
# Il PATH non si svuota (una stringa vuota vale "." per la lookup): si punta a
# una directory reale e priva di binari.
PRELUDE = """
source .launcher/daemon-lib.sh
work="$(mktemp -d)"
empty="$(mktemp -d)"
"""


def test_the_spawn_guard_uses_the_portable_timeout_helper():
    assert SPAWN_GUARD in SOURCE, (
        "la guardia sullo spawn non passa piu' da jht_timeout: un `timeout` nudo "
        "rende l'assenza del binario un fallimento di spawn"
    )
    bare = re.search(r"\btimeout\s+\S+\s+tmux\s+new-session", SOURCE)
    assert bare is None, f"`timeout` nudo tornato sulla new-session: {bare.group(0)!r}"


def test_the_cleanup_clients_are_bounded_through_the_helper_too():
    """`has-session`/`kill-session` del ramo d'errore parlano con lo STESSO
    server sospetto di essere appeso: senza tetto sono l'ultimo punto in cui il
    processo puo' bloccarsi per sempre tenendo il fd 9 del lock."""
    assert 'jht_timeout 5 tmux has-session -t "=$SESSION"' in SOURCE
    assert 'jht_timeout 5 tmux kill-session -t "=$SESSION"' in SOURCE


def test_the_helper_is_sourced_before_the_spawn_guard():
    """Un riordino dei `source` romperebbe tutto in silenzio."""
    sourced = SOURCE.index('source "$DEV_TEAM_DIR/daemon-lib.sh"')
    first_use = SOURCE.index("jht_timeout ")
    assert sourced < first_use


def test_the_helper_cascades_from_timeout_to_gtimeout_to_the_bare_command():
    assert "jht_timeout() {" in DAEMON_SOURCE
    body = DAEMON_SOURCE[DAEMON_SOURCE.index("jht_timeout() {") :]
    body = body[: body.index("\n}\n")]
    gnu = body.index('command -v timeout')
    bsd = body.index('command -v gtimeout')
    bare = body.index('    "$@"')
    assert gnu < bsd < bare, "l'ordine della cascata non e' timeout -> gtimeout -> nudo"
    # Il comando nudo non deve essere in un ramo che scarta l'rc.
    assert "|| true" not in body


def test_the_helper_is_documented_in_the_daemon_lib_header():
    header = DAEMON_SOURCE[: DAEMON_SOURCE.index("JHT_LAUNCHER_DIR=")]
    assert "jht_timeout <secondi> <comando...>" in header


@needs_bash
def test_jht_timeout_runs_the_command_when_no_timeout_binary_exists():
    """E' IL caso macOS, e nessun source-assert lo cattura."""
    result = _bash(
        PRELUDE
        + 'printf "#!/bin/sh\\necho ran\\n" >"$work/probe"\n'
        + 'chmod +x "$work/probe"\n'
        # Il PATH ridotto vive in una SUBSHELL: fuori serve ancora una shell
        # utilizzabile per leggere i risultati (`cat`, `ls`) — dentro bastano
        # i builtin.
        + '( PATH="$empty"\n'
        + '  command -v timeout >/dev/null 2>&1 && { echo "PATH-NOT-REDUCED"; exit 90; }\n'
        + '  command -v gtimeout >/dev/null 2>&1 && { echo "PATH-NOT-REDUCED"; exit 91; }\n'
        + '  jht_timeout 5 "$work/probe"\n'
        + '  echo "rc=$?" )\n'
    )
    assert "PATH-NOT-REDUCED" not in result.stdout, result.stdout
    assert "ran" in result.stdout, result.stdout + result.stderr
    assert "rc=0" in result.stdout, result.stdout + result.stderr


@needs_bash
def test_jht_timeout_propagates_the_command_exit_code():
    """Il degrado non deve mascherare errori veri: 3 resta 3, non 0 e non 1."""
    result = _bash(
        PRELUDE
        + 'printf "#!/bin/sh\\nexit 3\\n" >"$work/probe"\n'
        + 'chmod +x "$work/probe"\n'
        + '( PATH="$empty"\n'
        + '  jht_timeout 5 "$work/probe"\n'
        + '  echo "rc=$?" )\n'
    )
    assert "rc=3" in result.stdout, result.stdout + result.stderr


@needs_bash
def test_jht_timeout_still_caps_when_the_binary_exists():
    """La protezione di #214 resta la protezione di #214."""
    if _bash("command -v timeout").returncode != 0:
        pytest.skip("`timeout` non disponibile su questo host")
    result = _bash(
        "source .launcher/daemon-lib.sh\n"
        "start=$SECONDS\n"
        "jht_timeout 1 sleep 5\n"
        'echo "rc=$? elapsed=$((SECONDS - start))"\n'
    )
    match = re.search(r"rc=(\d+) elapsed=(\d+)", result.stdout)
    assert match, result.stdout + result.stderr
    assert match.group(1) == "124", result.stdout
    assert int(match.group(2)) < 3, result.stdout


@needs_bash
def test_jht_timeout_prefers_gtimeout_when_timeout_is_absent():
    """Copre il ramo BSD, che nessuna CI Linux esercita."""
    # Heredoc quotato: lo shim non deve subire NESSUNA espansione alla
    # scrittura, altrimenti il suo `"$@"` verrebbe risolto dalla shell del test
    # (vuoto) invece che dallo shim a runtime. Il path del marker arriva da una
    # env var, che e' l'unica cosa che lo shim risolve da se'.
    result = _bash(
        PRELUDE
        + 'export JHT_TEST_MARKER="$work/marker"\n'
        + 'cat >"$empty/gtimeout" <<\'SHIM\'\n'
        + "#!/bin/sh\n"
        + 'echo used > "$JHT_TEST_MARKER"\n'
        + "shift\n"
        + 'exec "$@"\n'
        + "SHIM\n"
        + 'printf "#!/bin/sh\\nexit 7\\n" >"$work/probe"\n'
        + 'chmod +x "$empty/gtimeout" "$work/probe"\n'
        + '( PATH="$empty"\n'
        + '  command -v timeout >/dev/null 2>&1 && { echo "PATH-NOT-REDUCED"; exit 90; }\n'
        + '  jht_timeout 9 "$work/probe"\n'
        + '  echo "rc=$?" )\n'
        + 'cat "$JHT_TEST_MARKER" 2>/dev/null || echo "gtimeout-NOT-used"\n'
    )
    assert "PATH-NOT-REDUCED" not in result.stdout, result.stdout
    assert "gtimeout-NOT-used" not in result.stdout, result.stdout + result.stderr
    assert "used" in result.stdout, result.stdout + result.stderr
    # L'rc del comando passa attraverso il wrapper BSD come attraverso il GNU.
    assert "rc=7" in result.stdout, result.stdout + result.stderr


@needs_bash
def test_the_launcher_and_the_helper_still_parse():
    for script in (".launcher/daemon-lib.sh", ".launcher/start-agent.sh"):
        result = _bash(f"bash -n {script}")
        assert result.returncode == 0, f"{script}: {result.stderr}"
