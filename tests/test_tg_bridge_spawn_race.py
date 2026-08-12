"""O-58 — il ramo tg-bridge di start-agent.sh non era protetto da lock.

Il danno, per intero: due `start-agent.sh tg-bridge` quasi simultanei (il
watchdog e chiunque altro) si intrecciano — A uccide, B uccide, A spawna tre,
B spawna tre — e restano SEI poller sugli stessi tre bot. Telegram risponde
409 a `getUpdates` concorrenti, e in quella raffica un messaggio dell'operatore
è stato ricevuto dal bridge e mai consegnato all'agente (`jht-tmux-send`
rc=141). Trenta ore così.

L'innesco però non era la race: era un bot NON configurato. Il mentor senza
token muore FATAL in partenza, il conteggio dei processi restava sotto la
soglia fissa di tre, e il watchdog «riparava» uccidendo e ricreando anche i
due bridge SANI. Un componente rotto ne rompeva due funzionanti.

Questa suite non verifica che il flock ci sia — un test così passerebbe anche
con un lock inutile. Esegue lo script VERO, due volte in parallelo, e CONTA i
processi che restano vivi.

Perché ci sono degli stub e perché non sono barare:
  • `setsid` e `flock` non esistono su macOS. Lo stub di flock è tre righe di
    `fcntl.flock` e ha la stessa semantica POSIX di util-linux — inclusa la
    parte che conta qui, cioè che il lock è tenuto dalla *open file
    description* ereditata sul fd 9 e sopravvive all'uscita del comando.
    NON toglietelo credendolo un residuo: senza, su macOS questa suite non
    gira e la race torna invisibile.
  • `proc-kill.py` legge `/proc`, che su macOS non c'è: `JHT_PROC_KILL_PY` (già
    override-abile) punta a un equivalente basato su `ps`. Il kill è
    l'ingrediente della race, non il pezzo sotto esame: se non funzionasse, il
    test direbbe «sei processi» anche a lock funzionante.
  • `tg-bridge.py` è sostituito da un finto che registra il proprio ruolo e
    dorme: qui si misura chi resta vivo, non cosa fa il bridge.

Eseguire:
    pytest tests/test_tg_bridge_spawn_race.py -v
"""

import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
LAUNCHER = REPO_ROOT / ".launcher"
ROLES = ("assistente", "capitano", "mentor")

FAKE_BRIDGE = '''#!/usr/bin/env python3
"""Finto tg-bridge: tiene vivo il processo con --role nel cmdline."""
import sys, time
role = ""
for i, a in enumerate(sys.argv[1:]):
    if a == "--role" and i + 2 <= len(sys.argv):
        role = sys.argv[i + 2]
time.sleep(120)
'''

FAKE_SETSID = """#!/bin/sh
# `setsid` non esiste su macOS: qui basta eseguire il comando (il test misura
# i processi, non la sessione POSIX in cui vivono).
exec "$@"
"""

FAKE_FLOCK = '''#!/usr/bin/env python3
"""flock(1) minimale per macOS: `flock -w SEC FD`.

Il lock si prende sul file descriptor EREDITATO (fd 9), non su un path: è la
stessa forma che usa start-agent.sh, ed è ciò che lo rende un lock che dura
quanto lo script padre invece che quanto questo comando.
"""
import fcntl, sys, time

argv = sys.argv[1:]
timeout = 0.0
if argv and argv[0] == "-w":
    timeout = float(argv[1])
    argv = argv[2:]
fd = int(argv[0])
deadline = time.time() + timeout
while True:
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        sys.exit(0)
    except OSError:
        if time.time() >= deadline:
            sys.exit(1)
        time.sleep(0.02)
'''

FAKE_PROC_KILL = '''#!/usr/bin/env python3
"""proc-kill.py per BSD/macOS: stessa semantica, sorgente `ps` invece di /proc.

Uccide i processi il cui cmdline contiene il marker, escludendo se stesso e i
propri antenati — le due esclusioni che proc-kill.py fa leggendo /proc.
"""
import os, signal, subprocess, sys, time

marker = sys.argv[1]
grace = 0.0
settle = 0.0
for i, a in enumerate(sys.argv):
    if a == "--grace":
        grace = float(sys.argv[i + 1])
    if a == "--settle":
        settle = float(sys.argv[i + 1])

def ancestors():
    out, pid = set(), os.getppid()
    for _ in range(20):
        if pid <= 1:
            break
        out.add(pid)
        try:
            pid = int(subprocess.run(["ps", "-o", "ppid=", "-p", str(pid)],
                                     capture_output=True, text=True).stdout.strip())
        except ValueError:
            break
    return out

def targets():
    skip = ancestors() | {os.getpid()}
    rows = subprocess.run(["ps", "-ax", "-o", "pid=,command="],
                          capture_output=True, text=True).stdout.splitlines()
    found = []
    for row in rows:
        row = row.strip()
        if not row:
            continue
        pid_s, _, cmd = row.partition(" ")
        try:
            pid = int(pid_s)
        except ValueError:
            continue
        if pid in skip or marker not in cmd or sys.argv[0] in cmd:
            continue
        found.append(pid)
    return found

for pid in targets():
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError:
        pass
if grace:
    time.sleep(grace)
    for pid in targets():
        try:
            os.kill(pid, signal.SIGKILL)
        except OSError:
            pass
if settle:
    time.sleep(settle)
'''


def _write_exec(path: Path, body: str) -> None:
    path.write_text(body, encoding="utf-8")
    path.chmod(0o755)


@pytest.fixture
def env(tmp_path):
    """Una copia di .launcher con il bridge finto, più gli stub nel PATH."""
    launcher = tmp_path / "launcher"
    shutil.copytree(LAUNCHER, launcher)
    _write_exec(launcher / "tg-bridge.py", FAKE_BRIDGE)

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    _write_exec(bin_dir / "setsid", FAKE_SETSID)
    _write_exec(bin_dir / "flock", FAKE_FLOCK)
    kill_py = tmp_path / "proc-kill.py"
    _write_exec(kill_py, FAKE_PROC_KILL)

    home = tmp_path / "home"
    home.mkdir()

    environ = dict(os.environ)
    environ.update(
        JHT_HOME=str(home),
        JHT_PROC_KILL_PY=str(kill_py),
        PATH=f"{bin_dir}:{environ.get('PATH', '')}",
    )
    yield {"launcher": launcher, "home": home, "environ": environ, "bin": bin_dir}

    # Nessun processo di prova sopravvive alla fine del test.
    subprocess.run(["pkill", "-f", str(launcher / "tg-bridge.py")],
                   capture_output=True)


def _spawn(env, *args, background=False):
    cmd = [str(env["launcher"] / "start-agent.sh"), "tg-bridge", *args]
    if background:
        return subprocess.Popen(cmd, env=env["environ"],
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return subprocess.run(cmd, env=env["environ"], capture_output=True, text=True)


def _alive(env):
    """Ruoli vivi → numero di processi python per quel ruolo."""
    rows = subprocess.run(["ps", "-ax", "-o", "command="],
                          capture_output=True, text=True).stdout.splitlines()
    script = str(env["launcher"] / "tg-bridge.py")
    counts = {r: 0 for r in ROLES}
    for row in rows:
        if script not in row or "--role" not in row:
            continue
        # Solo il processo python, non la shell wrapper che lo ha lanciato:
        # contare entrambi raddoppierebbe ogni numero e nasconderebbe i
        # doppioni veri dietro un fattore due. Il riconoscimento è "non è la
        # wrapper" e non "inizia per python": l'interprete di macOS si
        # presenta come /opt/homebrew/.../Python.app/Contents/MacOS/Python.
        if row.strip().startswith("sh -c") or "JHT_TG_BOT_ROLE" in row:
            continue
        for role in ROLES:
            if f"--role {role}" in row:
                counts[role] += 1
    return counts


@pytest.mark.skipif(sys.platform == "win32", reason="ps/pkill POSIX")
def test_two_concurrent_spawns_leave_one_bridge_per_role(env):
    """La race, riprodotta: due start in parallelo, un solo bridge per ruolo."""
    first = _spawn(env, background=True)
    time.sleep(0.05)  # abbastanza per intrecciarsi, non per serializzarsi
    second = _spawn(env, background=True)
    first.wait(timeout=60)
    second.wait(timeout=60)
    time.sleep(0.5)

    counts = _alive(env)
    assert counts == {r: 1 for r in ROLES}, (
        f"doppioni: {counts} — due poller sullo stesso bot = 409 da Telegram"
    )


@pytest.mark.skipif(sys.platform == "win32", reason="ps/pkill POSIX")
def test_without_the_lock_the_same_race_leaves_duplicates(env, tmp_path):
    """La prova che il test sopra vede davvero la race.

    Tolto `flock` dal PATH lo script prende il ramo di fallback storico —
    quello che girava in produzione — e gli stessi due start concorrenti
    lasciano più di un poller per bot. Se un giorno questo test diventasse
    verde, vorrebbe dire che l'altro non sta più misurando niente.
    """
    (env["bin"] / "flock").unlink()

    first = _spawn(env, background=True)
    time.sleep(0.05)
    second = _spawn(env, background=True)
    first.wait(timeout=60)
    second.wait(timeout=60)
    time.sleep(0.5)

    counts = _alive(env)
    assert any(n > 1 for n in counts.values()), (
        f"senza lock ci si aspetta doppioni, trovati {counts}: "
        "il test non sta riproducendo la race"
    )


@pytest.mark.skipif(sys.platform == "win32", reason="ps/pkill POSIX")
def test_respawning_one_role_leaves_the_others_alone(env):
    """(D) — il caso che giustifica il respawn selettivo.

    Un ruolo che muore non deve far riavviare gli altri due: prima il rimedio
    era `start-agent.sh tg-bridge`, che uccideva e ricreava tutti e tre, e nel
    buco fra kill e nuovo poll un messaggio si perde.
    """
    _spawn(env)  # boot completo
    time.sleep(0.3)
    before = _alive(env)
    assert before == {r: 1 for r in ROLES}

    pids_before = _pids(env)
    _spawn(env, "mentor")
    time.sleep(0.3)

    after = _alive(env)
    assert after == {r: 1 for r in ROLES}, f"{after}"
    pids_after = _pids(env)
    # Gli altri due sono ESATTAMENTE gli stessi processi: non riavviati.
    assert pids_before["assistente"] == pids_after["assistente"]
    assert pids_before["capitano"] == pids_after["capitano"]
    assert pids_before["mentor"] != pids_after["mentor"]


def _pids(env):
    rows = subprocess.run(["ps", "-ax", "-o", "pid=,command="],
                          capture_output=True, text=True).stdout.splitlines()
    script = str(env["launcher"] / "tg-bridge.py")
    out = {}
    for row in rows:
        row = row.strip()
        pid_s, _, cmd = row.partition(" ")
        if script not in cmd:
            continue
        if cmd.strip().startswith("sh -c") or "JHT_TG_BOT_ROLE" in cmd:
            continue
        for role in ROLES:
            if f"--role {role}" in cmd:
                out[role] = pid_s
    return out


@pytest.mark.skipif(sys.platform == "win32", reason="ps/pkill POSIX")
def test_an_unknown_role_is_refused(env):
    """Un ruolo sbagliato non deve diventare un rispawn di tutti e tre."""
    res = _spawn(env, "mentore")  # refuso plausibile
    assert res.returncode != 0
    assert "unknown tg-bridge role" in res.stderr
    assert _alive(env) == {r: 0 for r in ROLES}
