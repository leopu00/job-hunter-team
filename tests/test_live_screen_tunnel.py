"""Il visore remoto dello schermo del CLOSER: tunnel SSH, password privata, uscita pulita.

Origine. Il CLOSER gira nel container `jht` della VPS dell'utente, dove il
compose non pubblica la porta dello stream. `scripts/live-screen-tunnel.sh`
apre un tunnel SSH verso l'interfaccia bridge del container, copia la password
VNC in una JHT_HOME temporanea del Mac e apre l'app desktop su quel tunnel.

Lo schermo mostra CV e form di candidatura: la password non deve finire in
argomenti di processo, in chat o nei log, e Ctrl-C deve chiudere tutto. Questa
suite gira lo script vero con un `ssh` finto su PATH e tiene fermo:

  1. il tunnel si lega a 127.0.0.1 del Mac e punta all'IP bridge del container
     sulla 6080 (loopback della VPS se il container è in rete host), con un
     proprio canale SSH (ControlMaster=no), così Ctrl-C lo chiude davvero;
  2. la password sta solo in un file 0600 dentro una cartella 0700, non compare
     in nessun argomento passato a ssh e non viene stampata;
  3. se il container riparte la password ruota e il file locale si aggiorna;
  4. Ctrl-C (SIGINT al gruppo, come il terminale) esce subito con rc 0,
     chiude il tunnel e cancella la cartella temporanea;
  5. password malformata, schermo spento e argomenti non validi fermano lo
     script prima di aprire qualunque tunnel.

Eseguire:
    pytest tests/test_live_screen_tunnel.py -v
"""

import os
import signal
import socket
import stat
import subprocess
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / "scripts" / "live-screen-tunnel.sh"
PASSWORD = "Ab3dE6gH"

FAKE_SSH = r"""#!/usr/bin/env python3
# ssh finto: registra gli argomenti, risponde ai comandi remoti dello script e,
# per `-N -L`, apre davvero la porta locale come farebbe il forward.
import json, os, socket, sys, time
state = os.environ["FAKE_SSH_STATE"]
with open(os.path.join(state, "argv.jsonl"), "a") as f:
    f.write(json.dumps(sys.argv[1:]) + "\n")
args = sys.argv[1:]
if "-N" in args:
    spec = args[args.index("-L") + 1]
    bind, port = spec.split(":")[0], int(spec.split(":")[1])
    with open(os.path.join(state, "tunnel.pid"), "w") as f:
        f.write(str(os.getpid()))
    s = socket.socket(); s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind((bind, port)); s.listen(8)
    s.settimeout(0.2)
    while True:
        try:
            c, _ = s.accept(); c.close()
        except socket.timeout:
            pass
command = args[-1]
if command.startswith("docker inspect"):
    print(os.environ.get("FAKE_CONTAINER_IPS", "172.18.0.5 "))
elif " test -f " in command:
    sys.exit(0 if os.environ.get("FAKE_SCREEN_ON", "1") == "1" else 1)
elif " cat " in command:
    sys.stdout.write(open(os.path.join(state, "password")).read())
else:
    sys.exit(2)
"""


def _free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@pytest.fixture
def env(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    ssh = bin_dir / "ssh"
    ssh.write_text(FAKE_SSH, encoding="utf-8")
    ssh.chmod(0o755)
    state = tmp_path / "state"
    state.mkdir()
    (state / "password").write_text(PASSWORD + "\n", encoding="utf-8")
    run_tmp = tmp_path / "tmp"
    run_tmp.mkdir()
    return {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "TMPDIR": str(run_tmp),
        "FAKE_SSH_STATE": str(state),
        "JHT_LIVE_SCREEN_TUNNEL_REFRESH_SEC": "1",
    }


def _start(env, *extra):
    port = _free_port()
    proc = subprocess.Popen(
        ["bash", str(SCRIPT), "vps-test", "--viewer", "none", "--local-port", str(port), *extra],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
        start_new_session=True,
        preexec_fn=lambda: signal.signal(signal.SIGINT, signal.SIG_DFL),
    )
    return proc, port


def _wait_for(predicate, timeout=15.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def _workdirs(env):
    return list(Path(env["TMPDIR"]).glob("jht-live-screen-tunnel.*"))


def _argv_log(env):
    path = Path(env["FAKE_SSH_STATE"]) / "argv.jsonl"
    import json

    return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


def _ctrl_c(proc):
    os.killpg(proc.pid, signal.SIGINT)
    out, _ = proc.communicate(timeout=10)
    return proc.returncode, out


def _tunnel_argv(env):
    return next(argv for argv in _argv_log(env) if "-N" in argv)


def test_tunnel_binds_mac_loopback_to_the_container_bridge_ip(env):
    proc, port = _start(env)
    try:
        assert _wait_for(lambda: _can_connect(port))
        argv = _tunnel_argv(env)
        assert argv[argv.index("-L") + 1] == f"127.0.0.1:{port}:172.18.0.5:6080"
        assert "ControlMaster=no" in argv and "ControlPath=none" in argv
        assert "ExitOnForwardFailure=yes" in argv
    finally:
        rc, out = _ctrl_c(proc)
    assert rc == 0, out


def test_host_network_container_targets_the_vps_loopback(env):
    env = {**env, "FAKE_CONTAINER_IPS": " "}
    proc, port = _start(env)
    try:
        assert _wait_for(lambda: _can_connect(port))
        argv = _tunnel_argv(env)
        assert argv[argv.index("-L") + 1] == f"127.0.0.1:{port}:127.0.0.1:6080"
    finally:
        _ctrl_c(proc)


def _can_connect(port):
    try:
        with socket.create_connection(("127.0.0.1", port), timeout=0.2):
            return True
    except OSError:
        return False


def _password_file(env):
    dirs = _workdirs(env)
    return dirs[0] / "jht_home" / "live-screen" / "viewer-password" if dirs else None


def test_password_lives_only_in_a_private_file(env):
    proc, port = _start(env)
    try:
        assert _wait_for(lambda: _can_connect(port))
        workdir = _workdirs(env)[0]
        password_file = _password_file(env)
        assert stat.S_IMODE(workdir.stat().st_mode) == 0o700
        assert stat.S_IMODE(password_file.stat().st_mode) == 0o600
        assert password_file.read_text().strip() == PASSWORD
        for argv in _argv_log(env):
            assert all(PASSWORD not in part for part in argv), argv
    finally:
        rc, out = _ctrl_c(proc)
    assert PASSWORD not in out


def test_a_rotated_password_reaches_the_local_file(env):
    proc, port = _start(env)
    try:
        assert _wait_for(lambda: _can_connect(port))
        (Path(env["FAKE_SSH_STATE"]) / "password").write_text("Zz9yY8xX\n")
        assert _wait_for(lambda: _password_file(env).read_text().strip() == "Zz9yY8xX", timeout=10)
    finally:
        _ctrl_c(proc)


def test_ctrl_c_exits_at_once_and_leaves_nothing_behind(env):
    # Refresh lungo apposta: Ctrl-C non deve aspettare il giro successivo.
    env = {**env, "JHT_LIVE_SCREEN_TUNNEL_REFRESH_SEC": "30"}
    proc, port = _start(env)
    assert _wait_for(lambda: _can_connect(port))
    tunnel_pid = int((Path(env["FAKE_SSH_STATE"]) / "tunnel.pid").read_text())
    started = time.monotonic()
    rc, out = _ctrl_c(proc)
    assert rc == 0, out
    # Il sleep di attesa è in primo piano: Ctrl-C non aspetta il giro di refresh.
    assert time.monotonic() - started < 3
    assert "tunnel chiuso" in out
    assert not _workdirs(env)
    assert _wait_for(lambda: not _pid_alive(tunnel_pid), timeout=5)
    assert _wait_for(lambda: not _can_connect(port), timeout=5)


def _pid_alive(pid):
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    return True


@pytest.mark.parametrize("password", ["short", "Ab3dE6gH9", "Ab3d E6g", "Ab3dE6g!", ""])
def test_malformed_password_stops_before_the_tunnel(env, password):
    (Path(env["FAKE_SSH_STATE"]) / "password").write_text(password)
    proc, _ = _start(env)
    out, _ = proc.communicate(timeout=15)
    assert proc.returncode == 1
    assert "password" in out
    assert not any("-N" in argv for argv in _argv_log(env))
    assert not _workdirs(env)


def test_screen_off_stops_before_the_tunnel(env):
    proc, _ = _start({**env, "FAKE_SCREEN_ON": "0"})
    out, _ = proc.communicate(timeout=15)
    assert proc.returncode == 1
    assert "non è acceso" in out
    assert not any("-N" in argv for argv in _argv_log(env))


@pytest.mark.parametrize(
    "args",
    [
        [],
        ["bad;alias"],
        ["-oProxyCommand=x"],
        ["vps", "--container", "jht;rm"],
        ["vps", "--local-port", "80"],
        ["vps", "--viewer", "vnc"],
    ],
)
def test_invalid_arguments_never_reach_ssh(env, args):
    proc = subprocess.run(["bash", str(SCRIPT), *args], env=env, capture_output=True, text=True, timeout=15)
    assert proc.returncode == 1
    assert not _argv_log(env)
