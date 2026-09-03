"""Il fd del lock di spawn non deve sopravvivere in nessun figlio.

Origine. `start-agent.sh` serializza lo spawn per sessione con
`exec 9>.../locks/start-$SESSION.lock` + `flock -w "$JHT_SPAWN_LOCK_WAIT_SEC" 9`. Il lock però non vive
nel processo: vive nella *open file description* del fd 9, che ogni figlio
EREDITA. Il ramo tg-bridge lo sapeva già e chiude il fd (`9>&-`) sui suoi
daemon; il ramo agente no.

Il caso peggiore non è il figlio detached, è tmux. Quando il server tmux non è
ancora vivo, è la PRIMA `tmux new-session` a forkarlo: il server nasce con il
fd 9 aperto, si stacca (PPid 1) e resta su quanto il container. Il lock di quella
sessione non viene quindi rilasciato MAI — nemmeno dopo un'uscita pulita di
`start-agent.sh` — e ogni respawn successivo di quell'agente muore in
"timed out after Ns waiting for the concurrent spawn" alla scadenza di `flock -w`, finché il
container non riparte. Osservato in produzione: un `tmux: server` con PPid 1
vivo da 11 giorni con `fd 9 -> locks/start-<AGENTE>.lock`, e 2.677 start falliti
a valle. Il tetto di tempo sulla new-session (PR #214) copre la new-session
APPESA, non questa: qui la new-session ritorna 0, è il server forkato che porta
via il fd.

Cosa questa suite tiene fermo, dopo la presa del flock per-sessione:

  1. ogni `tmux new-session` chiude il fd 9 — anche se avvolta in un wrapper
     con tetto di tempo, con la redirezione sull'intero comando cosi' il fd
     sparisce sia per il wrapper sia per tmux;
  2. ogni processo lanciato in background (`... &`) chiude il fd 9 — la regola è
     sulla FORMA, non sulle righe di oggi: un figlio nuovo aggiunto domani senza
     `9>&-` fa fallire il test;
  3. il ramo tg-bridge, che aveva già la chiusura, non la perde;
  4. il ramo `ROLE=worker` resta prima del flock (per questo non ha bisogno di
     `9>&-`): se qualcuno lo spostasse dopo, il punto 1 lo coprirebbe comunque;
  5. lo script resta sintatticamente valido (le redirezioni aggiunte non rompono
     `set -euo pipefail` né la cattura dell'rc (`|| _ns_rc=$?`) del ramo di spawn).

Eseguire:
    pytest tests/test_start_agent_spawn_lock_fd.py -v
"""

import re
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
LAUNCHER = REPO_ROOT / ".launcher" / "start-agent.sh"

SOURCE = LAUNCHER.read_text(encoding="utf-8")
LINES = SOURCE.splitlines()

CLOSE_FD = "9>&-"
SESSION_LOCK = 'exec 9>"${JHT_HOME:-/jht_home}/locks/start-${SESSION}.lock"'
TG_LOCK = 'exec 9>"${JHT_HOME:-/jht_home}/locks/start-tg-bridge.lock"'

# `cmd &` (fork) e non `cmd &&` (and-list): il `&` deve essere l'ultimo
# carattere e non essere preceduto da un altro `&` o da `>` (`2>&1`, `9>&-`).
BACKGROUND = re.compile(r"(?<![&>])&$")


def _line_of(needle: str, after: int = 0) -> int:
    """Numero di riga 1-based della prima riga dopo `after` che contiene `needle`."""
    for number, line in enumerate(LINES, start=1):
        if number > after and needle in line:
            return number
    raise AssertionError(f"pattern non piu' presente in start-agent.sh: {needle!r}")


def _is_comment(line: str) -> bool:
    return line.lstrip().startswith("#")


def _unquoted(line: str) -> str:
    """La riga senza le porzioni fra apici: `echo "... tmux new-session ..."` è
    testo, non un comando, e non deve contare come punto di fork."""
    return re.sub(r"'[^']*'|\"[^\"]*\"", " ", line)


def _numbered(after: int):
    """Righe di codice (commenti esclusi) dopo la riga `after`, 1-based."""
    for number, line in enumerate(LINES, start=1):
        if number > after and not _is_comment(line):
            yield number, line


SESSION_LOCK_LINE = _line_of(SESSION_LOCK)


def test_the_session_lock_is_still_taken_on_fd_9():
    """Se il lock cambiasse fd o sparisse, il resto della suite sarebbe vuoto.

    L'attesa e' un'env var con default (`JHT_SPAWN_LOCK_WAIT_SEC`): qui conta
    che il lock sia sul fd 9 e subito dopo l'`exec`, non quanti secondi
    vale."""
    assert (
        _line_of('flock -w "$JHT_SPAWN_LOCK_WAIT_SEC" 9', after=SESSION_LOCK_LINE)
        == SESSION_LOCK_LINE + 1
    )


def test_every_tmux_new_session_after_the_lock_closes_the_fd():
    """Il punto critico: la prima new-session forka il server tmux, che eredita
    il fd 9 e vive quanto il container."""
    spawns = [
        (number, line)
        for number, line in _numbered(SESSION_LOCK_LINE)
        if "tmux new-session" in _unquoted(line)
    ]
    # La suite deve davvero guardare qualcosa: se il ramo sparisse, l'assert
    # sotto passerebbe a vuoto.
    assert spawns, "nessuna `tmux new-session` dopo il flock: assert diventata vacua"

    offenders = [(number, line.strip()) for number, line in spawns if CLOSE_FD not in line]
    assert not offenders, (
        "`tmux new-session` senza `9>&-` dopo la presa del flock: il server tmux "
        f"eredita il lock e non lo rilascia mai. Righe: {offenders}"
    )


def test_the_container_branch_closes_the_fd_for_the_timeout_wrapper_too():
    """La redirezione va sull'INTERO comando: `jht_timeout <sec> tmux ... 9>&-`.
    Messa fra il wrapper e `tmux` chiuderebbe il fd solo per tmux, e il wrapper
    (o il `timeout` che esso esegue) resterebbe a tenere il lock."""
    line = next(
        line
        for _, line in _numbered(SESSION_LOCK_LINE)
        if "tmux new-session" in _unquoted(line) and "timeout" in line
    )
    # In coda al COMANDO: dopo `9>&-` puo' restare solo il modo in cui l'rc
    # viene raccolto (`|| _ns_rc=$?`, `; then`), non un altro argomento.
    tail = line.rstrip().split(CLOSE_FD, 1)[1].strip()
    assert tail in ("", "; then", "|| _ns_rc=$?"), (
        f"la chiusura del fd non e' in coda al comando completo: {line.strip()!r}"
    )
    # `9>&-` deve stare DOPO `tmux`, non infilata prima come argomento del
    # wrapper — e dopo TUTTI gli argomenti di tmux, redirezioni incluse.
    assert line.index("tmux") < line.index(CLOSE_FD)
    assert line.index("$AGENT_DIR") < line.index(CLOSE_FD)


def test_every_background_child_after_the_lock_closes_the_fd():
    """Regola sulla forma: qualsiasi `... &` dopo il flock deve chiudere il fd 9.
    Un figlio nuovo aggiunto domani senza `9>&-` fa fallire qui."""
    offenders = [
        (number, line.strip())
        for number, line in _numbered(SESSION_LOCK_LINE)
        if BACKGROUND.search(line.rstrip()) and CLOSE_FD not in line
    ]
    assert not offenders, (
        "processo lanciato in background senza `9>&-` dopo la presa del flock: "
        f"si porta via il lock di spawn. Righe: {offenders}"
    )
    assert any(
        BACKGROUND.search(line.rstrip()) for _, line in _numbered(SESSION_LOCK_LINE)
    ), "nessun figlio in background dopo il flock: assert diventata vacua"


def test_the_tg_bridge_branch_keeps_its_own_close():
    """Regressione storica gia' fixata: i bridge detached vivono giorni."""
    tg_lock_line = _line_of(TG_LOCK)
    # Il ramo esce con `exit 0`: oltre quel punto il fd 9 del lock tg non è più
    # aperto, quindi i daemon degli altri short-circuit non c'entrano.
    tg_branch_end = _line_of("exit 0", after=tg_lock_line)
    backgrounded = [
        line
        for number, line in _numbered(tg_lock_line)
        if BACKGROUND.search(line.rstrip()) and number < tg_branch_end
    ]
    assert backgrounded, "ramo tg-bridge senza figli in background: struttura cambiata"
    assert all(CLOSE_FD in line for line in backgrounded)


def test_the_worker_branch_runs_before_the_lock_is_taken():
    """SENTINELLA-WORKER esce prima di `exec 9>`: non eredita niente, e per
    questo non porta `9>&-`. Se venisse spostato dopo, il test sulle
    new-session lo prenderebbe comunque."""
    assert _line_of('-s "$WORKER_SESSION"') < SESSION_LOCK_LINE


@pytest.mark.skipif(shutil.which("bash") is None, reason="bash non disponibile")
def test_the_launcher_still_parses():
    """Le redirezioni aggiunte non devono rompere `set -euo pipefail` ne' la
    cattura dell'rc (`|| _ns_rc=$?`) del ramo di spawn."""
    # Path relativo + cwd: su Windows bash non digerisce `C:\...`.
    result = subprocess.run(
        ["bash", "-n", ".launcher/start-agent.sh"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
