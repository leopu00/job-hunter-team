"""Nessun client tmux senza tetto mentre start-agent.sh tiene il lock di spawn.

`start-agent.sh` prende `flock` sul fd 9 (`locks/start-<SESSIONE>.lock`) e lo
tiene fino all'uscita. Ogni client tmux lanciato in quella regione che non
ritorna — server incantato, bind mount in stato D — tiene il lock per sempre, e
ogni respawn successivo dello stesso agente muore in "concurrent spawn": il
lockout da 756 respawn falliti. #228 aveva messo il tetto al guard di
idempotenza e alla new-session; i `send-keys` di `send_env_vars`, quello del
comando del CLI e i poll di `jht_spawn_wait_repl` erano rimasti nudi, cioe' lo
stesso lockout spostato di un client.

Due livelli:

1. INVARIANTE sulla forma: nella regione fra il flock e la fine dello script,
   e dentro ogni funzione di spawn-lib.sh che quella regione chiama, un `tmux`
   eseguito in primo piano passa da `jht_spawn_tmux` oppure da
   `jht_timeout ... tmux ... 9>&-`. I corpi `setsid sh -c '...'` restano fuori:
   girano in background e chiudono il fd 9 (lo sorveglia
   test_start_agent_spawn_lock_fd.py).
2. COMPORTAMENTO del wrapper: contro un tmux che non risponde esce entro il
   tetto con rc 124 e lo dice, non passa il fd 9 al client, e
   `jht_spawn_wait_repl` rinuncia al primo poll invece di bruciarne 24.
"""

import os
import re
import subprocess
import sys
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parent.parent
START_AGENT = ROOT / ".launcher" / "start-agent.sh"
SPAWN_LIB = ROOT / ".launcher" / "spawn-lib.sh"

LOCK = 'flock -w "$JHT_SPAWN_LOCK_WAIT_SEC" 9'
TMUX_CALL = re.compile(r"(?<![\w-])tmux\s+([a-z][a-z-]*)")


def _code_lines(text: str):
    """Righe eseguite in primo piano: niente commenti, niente corpi `sh -c '...'`
    multi-riga (background, fd 9 chiuso), niente testo fra virgolette."""
    inside_body = False
    for number, line in enumerate(text.splitlines(), 1):
        stripped = line.strip()
        if inside_body:
            if stripped.startswith("'"):
                inside_body = False
            continue
        if not stripped or stripped.startswith("#"):
            continue
        if re.search(r"sh -c '\s*$", line):
            inside_body = True
            continue
        yield number, re.sub(r"\"(?:[^\"\\]|\\.)*\"", '""', line)


def _function_body(text: str, name: str) -> str:
    start = text.index(f"{name}() {{")
    return text[start : text.index("\n}\n", start) + 3]


def _bare_calls(text: str):
    offenders, seen = [], 0
    for number, line in _code_lines(text):
        for match in TMUX_CALL.finditer(line):
            seen += 1
            before, after = line[: match.start()], line[match.end() :]
            if "jht_timeout" in before and "9>&-" in after:
                continue
            offenders.append(f"{number}: {line.strip()}")
    return offenders, seen


def _lock_region() -> str:
    source = START_AGENT.read_text(encoding="utf-8")
    anchor = source.index('locks/start-${SESSION}.lock"')
    return source[source.index(LOCK, anchor) :]


def test_no_bare_tmux_runs_while_the_spawn_lock_is_held():
    offenders, seen = _bare_calls(_lock_region())
    wrapped = _lock_region().count("jht_spawn_tmux ")
    # Un gate che cerca deve rifiutare una ricerca vuota.
    assert wrapped >= 20, f"solo {wrapped} chiamate via jht_spawn_tmux: struttura cambiata"
    assert seen >= 3, "nessun `jht_timeout ... tmux` dopo il flock: parser cieco"
    assert not offenders, (
        "tmux senza tetto dopo la presa del flock: un client appeso tiene il lock "
        "di spawn per sempre. Righe:\n" + "\n".join(offenders)
    )


def test_every_spawn_lib_function_called_under_the_lock_is_bounded_too():
    region = _lock_region()
    lib = SPAWN_LIB.read_text(encoding="utf-8")
    called = sorted(
        name
        for name in set(re.findall(r"\b(jht_spawn_[a-z_]+)\b", region))
        if f"{name}() {{" in lib
    )
    assert "jht_spawn_wait_repl" in called and "jht_spawn_tmux" in called, called
    offenders = []
    for name in called:
        bad, _ = _bare_calls(_function_body(lib, name))
        offenders += [f"{name} {line}" for line in bad]
    assert not offenders, "\n".join(offenders)


def test_the_wrapper_bounds_the_client_and_drops_the_lock_fd():
    body = _function_body(SPAWN_LIB.read_text(encoding="utf-8"), "jht_spawn_tmux")
    assert 'jht_timeout "$secs" tmux "$@" 9>&-' in body, body
    assert 'secs="${JHT_SPAWN_TMUX_PROBE_SEC:-5}"' in body, body


def test_the_parser_sees_a_bare_call():
    """Contro-prova: una riga rotta viene davvero riconosciuta."""
    offenders, _ = _bare_calls(
        'send_env_vars() {\n  tmux send-keys -t "$SESSION" "export X=1" C-m\n}\n'
        '  jht_timeout 5 tmux has-session -t "=$SESSION" 9>&-\n'
    )
    assert len(offenders) == 1 and "send-keys" in offenders[0], offenders


# ── Comportamento ────────────────────────────────────────────────────────────

# `timeout` finto quando l'host non ne ha uno (macOS senza coreutils): senza,
# jht_timeout esegue il comando nudo per scelta e il caso "appeso" dormirebbe
# i suoi 30s interi — un rosso che parla dell'host, non del codice. Il finto
# rispetta il contratto che il wrapper legge (124 allo scadere) e NON chiude i
# fd ereditati, cosi' la prova sul fd 9 resta una prova.
FAKE_TIMEOUT = f"""#!{sys.executable}
import subprocess, sys
try:
    sys.exit(subprocess.run(sys.argv[2:], timeout=float(sys.argv[1]), close_fds=False).returncode)
except subprocess.TimeoutExpired:
    sys.exit(124)
"""

# tmux finto: `hang` non risponde; altrimenti riporta se ha ereditato il fd 9.
FAKE_TMUX = """#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$T_CALLS"
if { true >&9; } 2>/dev/null; then echo FD9-OPEN >> "$T_CALLS"; fi
[ "${T_TMUX:-ok}" = hang ] && exec sleep 30
exit 0
"""


def _harness(tmp_path: Path, capable_bash: str):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in (("tmux", FAKE_TMUX),):
        path = bin_dir / name
        path.write_text(body, encoding="utf-8", newline="\n")
        path.chmod(0o755)
    has_ceiling = subprocess.run(
        [capable_bash, "-c", "command -v timeout || command -v gtimeout"],
        capture_output=True, timeout=30,
    ).returncode == 0
    if not has_ceiling:
        shim = bin_dir / "timeout"
        shim.write_text(FAKE_TIMEOUT, encoding="utf-8", newline="\n")
        shim.chmod(0o755)
    return bin_dir


def _run(tmp_path, capable_bash, body, tmux_mode):
    bin_dir = _harness(tmp_path, capable_bash)
    calls = tmp_path / "calls.txt"
    script = (
        "set -euo pipefail\n"
        f"export PATH='{bin_dir}':\"$PATH\"\n"
        f"export T_CALLS='{calls}' T_TMUX='{tmux_mode}' JHT_SPAWN_TMUX_PROBE_SEC=1\n"
        f"source '{SPAWN_LIB}'\n"
        f"exec 9>'{tmp_path / 'spawn.lock'}'\n"
        + body
        + "\n"
    )
    started = time.monotonic()
    result = subprocess.run(
        [capable_bash, "-c", script], capture_output=True, text=True, timeout=120
    )
    elapsed = time.monotonic() - started
    text = calls.read_text(encoding="utf-8") if calls.exists() else ""
    return result, elapsed, text


@pytest.mark.skipif(sys.platform == "win32", reason="il launcher gira nel container Linux")
def test_a_hung_tmux_client_gives_the_lock_back_within_the_ceiling(tmp_path, capable_bash):
    result, elapsed, calls = _run(
        tmp_path, capable_bash,
        'rc=0; jht_spawn_tmux send-keys -t SCOUT-1 "export A=1" C-m || rc=$?\necho "rc=$rc"',
        "hang",
    )
    assert "rc=124" in result.stdout, result.stdout + result.stderr
    assert elapsed < 15, f"il client appeso ha tenuto il lock per {elapsed:.0f}s"
    assert "did not return within 1s" in result.stderr, result.stderr
    assert "FD9-OPEN" not in calls, "il client tmux ha ereditato il fd del lock"


@pytest.mark.skipif(sys.platform == "win32", reason="il launcher gira nel container Linux")
def test_a_healthy_tmux_passes_through_with_its_rc(tmp_path, capable_bash):
    result, _, calls = _run(
        tmp_path, capable_bash,
        'jht_spawn_tmux send-keys -t "=S:" Enter && echo OK',
        "ok",
    )
    assert "OK" in result.stdout, result.stdout + result.stderr
    assert "send-keys -t =S: Enter" in calls
    assert "FD9-OPEN" not in calls
    assert result.stderr == ""


@pytest.mark.skipif(sys.platform == "win32", reason="il launcher gira nel container Linux")
def test_wait_repl_gives_up_at_the_first_unanswered_poll(tmp_path, capable_bash):
    """Prima: 2 tentativi x 12 poll, ognuno appeso senza limite. Col tetto ma
    senza uscita anticipata sarebbero ~2 minuti col lock preso."""
    logs = tmp_path / "logs"
    logs.mkdir()
    result, elapsed, calls = _run(
        tmp_path, capable_bash,
        f'rc=0; jht_spawn_wait_repl SCOUT-1 claude start-agent scout "{logs}" start-agent.sh || rc=$?\n'
        'echo "rc=$rc"',
        "hang",
    )
    assert "rc=1" in result.stdout, result.stdout + result.stderr
    assert elapsed < 20, f"wait_repl ha tenuto il lock per {elapsed:.0f}s"
    assert "tmux did not answer" in result.stderr, result.stderr
    assert calls.count("display-message") == 1, calls
    assert "kill-session -t =SCOUT-1" in calls, calls


# ── Il guscio di uno spawn interrotto ────────────────────────────────────────
# Il tetto trasforma un client appeso in un'USCITA (set -e) — dopo che la
# new-session ha gia' creato la sessione. Senza pulizia resterebbe un pane bash
# che il guard di idempotenza dichiara "already active" per sempre.


def _cleanup_function() -> str:
    return _function_body(START_AGENT.read_text(encoding="utf-8"), "_spawn_abort_cleanup")


def test_the_half_made_session_is_owned_by_the_cleanup_until_the_agent_is_up():
    source = START_AGENT.read_text(encoding="utf-8")
    trap = source.index("trap _spawn_abort_cleanup EXIT")
    first_new_session = source.index("tmux new-session -d -x 220 -y 50 -s \"$SESSION\" powershell.exe")
    assert source.index(LOCK) < trap < first_new_session
    # Due rami (PowerShell e container): la sessione diventa "da pulire" subito
    # dopo la sua new-session e smette di esserlo solo a spawn riuscito.
    marks = [m.start() for m in re.finditer(r"^  _SPAWN_SESSION_CREATED=1$", source, re.M)]
    clears = [m.start() for m in re.finditer(r"^  _SPAWN_SESSION_CREATED=0$", source, re.M)]
    assert len(marks) == 2 and len(clears) == 2, (marks, clears)
    container_mark = marks[1]
    assert source.index('|| _ns_rc=$?', source.index('-c "$AGENT_DIR"')) < container_mark
    assert container_mark < source.index("  send_env_vars\n") < clears[1]
    assert source.index('jht_spawn_wait_repl "$SESSION"') < clears[1]
    body = _cleanup_function()
    assert 'jht_timeout "$JHT_SPAWN_TMUX_PROBE_SEC" tmux kill-session -t "=$SESSION"' in body
    assert "9>&-" in body


@pytest.mark.skipif(sys.platform == "win32", reason="il launcher gira nel container Linux")
@pytest.mark.parametrize(
    ("created", "exit_rc", "expect_kill"),
    [(1, 1, True), (1, 0, False), (0, 1, False)],
)
def test_an_aborted_spawn_removes_only_its_own_half_made_session(
    tmp_path, capable_bash, created, exit_rc, expect_kill
):
    bin_dir = _harness(tmp_path, capable_bash)
    calls = tmp_path / "calls.txt"
    script = (
        f"export PATH='{bin_dir}':\"$PATH\"\n"
        f"export T_CALLS='{calls}'\n"
        f"source '{ROOT / '.launcher' / 'daemon-lib.sh'}'\n"
        "SESSION=SCOUT-1\nJHT_SPAWN_TMUX_PROBE_SEC=1\n"
        + _cleanup_function()
        + f"_SPAWN_SESSION_CREATED={created}\n"
        "trap _spawn_abort_cleanup EXIT\n"
        f"exit {exit_rc}\n"
    )
    result = subprocess.run([capable_bash, "-c", script], capture_output=True, text=True, timeout=60)
    assert result.returncode == exit_rc, result.stderr
    text = calls.read_text(encoding="utf-8") if calls.exists() else ""
    assert ("kill-session -t =SCOUT-1" in text) is expect_kill, text
    assert ("half-made session" in result.stderr) is expect_kill, result.stderr
