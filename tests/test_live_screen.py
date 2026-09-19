"""Lo schermo live del CLOSER: display virtuale, stream in sola visione, solo loopback.

Origine. Le candidature non passano da API: il CLOSER compila i form con un
browser vero (`shared/skills/apply_flow.py`). L'utente vuole VEDERE quel
browser mentre lavora, in una finestra staccata dell'app desktop. Per questo il
container tiene un display X virtuale (`.launcher/live-screen.sh`, supervisionato
da pid1) su cui `apply_flow.py --headful` si apre, e ne pubblica uno stream VNC.

Quello schermo mostra CV e form di candidatura. Cosa questa suite tiene fermo:

  1. **lo script si comporta** (binari finti su PATH, nessun X vero):
     - x11vnc gira sul loopback del container, in sola visione, con password;
     - la password è nuova a ogni avvio, 8 caratteri, file 0600, e sparisce allo
       spegnimento;
     - websockify ascolta sull'indirizzo richiesto (0.0.0.0 di default, per la
       rete bridge di Docker);
     - se un componente muore lo script esce non-zero, così pid1 riavvia la
       terna intera invece di lasciare uno stream «su» che non mostra niente;
     - un lock X di un server morto si pulisce, quello di un server vivo no;
     - porta o display non validi e binari assenti escono con i codici che pid1
       considera non riparabili (2, 3);
  2. **i compose non espongono lo stream alla rete**: nel file base ogni porta è
     legata a 127.0.0.1; nell'override Podman (network_mode: host, dove il
     container vede le interfacce dell'host) le porte sono azzerate e il bind
     dello stream è 127.0.0.1;
  3. **l'immagine ha davvero lo schermo**: pacchetti X, Chromium completo
     (Playwright lancia quello quando headless=False), DISPLAY=:99 esportato e
     un gate di build che apre un Chromium headed su Xvfb.

Eseguire:
    pytest tests/test_live_screen.py -v
"""

import json
import os
import shutil
import signal
import stat
import subprocess
import time
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parent.parent
SCRIPT = REPO_ROOT / ".launcher" / "live-screen.sh"
DOCKERFILE = (REPO_ROOT / "Dockerfile").read_text(encoding="utf-8")
COMPOSE = REPO_ROOT / "docker-compose.yml"
PODMAN_COMPOSE = REPO_ROOT / "docker-compose.podman.yml"

# `wait -n` richiede bash >= 4.3: il container ha bookworm (5.2). Il /bin/bash
# di macOS è 3.2, quindi si cerca un bash moderno su PATH e altrimenti si salta.
BASH = shutil.which("bash")


def _bash_is_modern() -> bool:
    if not BASH:
        return False
    out = subprocess.run(
        [BASH, "-c", 'echo "${BASH_VERSINFO[0]} ${BASH_VERSINFO[1]}"'],
        capture_output=True, text=True, check=False,
    ).stdout.split()
    return len(out) == 2 and (int(out[0]), int(out[1])) >= (4, 3)


needs_bash = pytest.mark.skipif(not _bash_is_modern(), reason="live-screen.sh needs bash >= 4.3 (wait -n)")


# ── Binari finti ──────────────────────────────────────────────────────────


FAKE_XVFB = """\
#!/usr/bin/env python3
# Xvfb finto: crea il socket del display come il vero, registra gli argomenti
# e resta vivo finché non lo si ferma.
import os, socket, sys, time
num = sys.argv[1].lstrip(":")
base = os.environ["JHT_LIVE_SCREEN_X_TMP"]
os.makedirs(os.path.join(base, ".X11-unix"), exist_ok=True)
with open(os.path.join(os.environ["FAKE_LOG_DIR"], "Xvfb.args"), "w") as f:
    f.write("\\n".join(sys.argv[1:]))
if os.environ.get("FAKE_XVFB_NO_SOCKET") != "1":
    s = socket.socket(socket.AF_UNIX)
    s.bind(os.path.join(base, ".X11-unix", "X" + num))
life = float(os.environ.get("FAKE_XVFB_LIFETIME", "600"))
time.sleep(life)
"""

FAKE_X11VNC = """\
#!/usr/bin/env bash
if [ "${1:-}" = "-storepasswd" ]; then
  printf 'rfbauth-for:%s' "$2" > "$3"
  exit 0
fi
printf '%s\\n' "$@" > "$FAKE_LOG_DIR/x11vnc.args"
exec sleep 600
"""

FAKE_WEBSOCKIFY = """\
#!/usr/bin/env bash
printf '%s\\n' "$@" > "$FAKE_LOG_DIR/websockify.args"
exec sleep "${FAKE_WEBSOCKIFY_LIFETIME:-600}"
"""


@pytest.fixture
def env(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for name, body in {"Xvfb": FAKE_XVFB, "x11vnc": FAKE_X11VNC, "websockify": FAKE_WEBSOCKIFY}.items():
        path = bin_dir / name
        path.write_text(body, encoding="utf-8")
        path.chmod(0o755)
    logs = tmp_path / "logs"
    logs.mkdir()
    # Il socket unix ha un limite di ~104 byte su macOS: il tmp_path di pytest
    # può superarlo, quindi la radice X vive in una cartella corta.
    x_tmp = Path(f"/tmp/jls-{os.getpid()}-{time.monotonic_ns() % 10**8}")
    x_tmp.mkdir()
    values = {
        **os.environ,
        "PATH": f"{bin_dir}:{os.environ['PATH']}",
        "JHT_HOME": str(tmp_path / "jht_home"),
        "TMPDIR": str(tmp_path / "run"),
        "JHT_LIVE_SCREEN_X_TMP": str(x_tmp),
        "FAKE_LOG_DIR": str(logs),
    }
    (tmp_path / "run").mkdir()
    yield values
    shutil.rmtree(x_tmp, ignore_errors=True)


def _start(env):
    return subprocess.Popen(
        [BASH, str(SCRIPT)], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )


def _wait_for(predicate, timeout=10.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.05)
    return False


def _args(env, name):
    path = Path(env["FAKE_LOG_DIR"]) / f"{name}.args"
    return path.read_text(encoding="utf-8").splitlines() if path.exists() else None


def _stop(proc):
    if proc.poll() is None:
        proc.send_signal(signal.SIGTERM)
    try:
        return proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()
        return proc.wait()


def _password_file(env):
    return Path(env["JHT_HOME"]) / "live-screen" / "viewer-password"


# ── 1. Comportamento dello script ─────────────────────────────────────────


@needs_bash
def test_vnc_is_loopback_only_view_only_and_password_protected(env):
    proc = _start(env)
    try:
        assert _wait_for(lambda: _args(env, "websockify") is not None), proc.stdout
        vnc = _args(env, "x11vnc")
        assert "-localhost" in vnc
        assert "-viewonly" in vnc
        assert "-rfbauth" in vnc
        assert "-nopw" not in vnc
        assert vnc[vnc.index("-display") + 1] == ":99"
        assert _args(env, "Xvfb")[0] == ":99"
        assert "-nolisten" in _args(env, "Xvfb")
        # websockify: default 0.0.0.0 (rete bridge), verso la sola porta VNC locale.
        assert _args(env, "websockify") == ["0.0.0.0:6080", "127.0.0.1:5900"]
    finally:
        assert _stop(proc) == 0


@needs_bash
def test_password_is_fresh_private_and_removed_on_shutdown(env):
    seen = []
    for _ in range(2):
        proc = _start(env)
        try:
            password_file = _password_file(env)
            assert _wait_for(lambda: _args(env, "websockify") is not None)
            assert password_file.exists()
            mode = stat.S_IMODE(password_file.stat().st_mode)
            assert mode == 0o600, oct(mode)
            value = password_file.read_text(encoding="utf-8").strip()
            assert len(value) == 8 and value.isalnum()
            rfbauth = Path(env["TMPDIR"]) / "jht-live-screen" / "rfbauth"
            assert rfbauth.read_text(encoding="utf-8") == f"rfbauth-for:{value}"
            seen.append(value)
        finally:
            assert _stop(proc) == 0
        assert not password_file.exists()
        (Path(env["FAKE_LOG_DIR"]) / "websockify.args").unlink()
    assert seen[0] != seen[1]


@needs_bash
def test_bind_and_port_follow_the_environment(env):
    env = {**env, "JHT_LIVE_SCREEN_BIND": "127.0.0.1", "JHT_LIVE_SCREEN_PORT": "7090"}
    proc = _start(env)
    try:
        assert _wait_for(lambda: _args(env, "websockify") is not None)
        assert _args(env, "websockify") == ["127.0.0.1:7090", "127.0.0.1:5900"]
    finally:
        _stop(proc)


@needs_bash
def test_a_dead_component_stops_the_whole_screen(env):
    env = {**env, "FAKE_WEBSOCKIFY_LIFETIME": "0.3"}
    proc = _start(env)
    try:
        rc = proc.wait(timeout=15)
    finally:
        _stop(proc)
    assert rc == 1
    assert "a component exited" in proc.stdout.read()
    assert not _password_file(env).exists()


@needs_bash
def test_gives_up_when_xvfb_never_creates_its_socket(env):
    env = {**env, "FAKE_XVFB_NO_SOCKET": "1"}
    proc = _start(env)
    rc = proc.wait(timeout=20)
    assert rc == 6
    assert _args(env, "x11vnc") is None


@needs_bash
def test_stale_x_lock_is_cleared_but_a_live_one_is_respected(env):
    x_tmp = Path(env["JHT_LIVE_SCREEN_X_TMP"])
    lock = x_tmp / ".X99-lock"

    # pid morto: un processo appena terminato.
    dead = subprocess.Popen(["true"])
    dead.wait()
    lock.write_text(f"{dead.pid:>10}\n")
    proc = _start(env)
    try:
        assert _wait_for(lambda: _args(env, "websockify") is not None)
        assert not lock.exists()
    finally:
        _stop(proc)

    # pid vivo: il nostro stesso processo di test.
    lock.write_text(f"{os.getpid():>10}\n")
    proc = _start(env)
    assert proc.wait(timeout=10) == 4
    assert lock.exists()


@needs_bash
@pytest.mark.parametrize(
    "overrides",
    [
        {"JHT_LIVE_SCREEN_PORT": "80"},
        {"JHT_LIVE_SCREEN_PORT": "70000"},
        {"JHT_LIVE_SCREEN_PORT": "6080;id"},
        {"JHT_LIVE_SCREEN_DISPLAY": "remote.example:0"},
    ],
)
def test_invalid_configuration_exits_2(env, overrides):
    proc = _start({**env, **overrides})
    assert proc.wait(timeout=10) == 2
    assert _args(env, "Xvfb") is None


@needs_bash
def test_missing_binary_exits_3(env, tmp_path):
    (tmp_path / "bin" / "x11vnc").unlink()
    # PATH ridotto al minimo: un x11vnc vero installato sull'host non deve
    # nascondere l'assenza.
    minimal = f"{tmp_path / 'bin'}:/usr/bin:/bin"
    proc = _start({**env, "PATH": minimal})
    assert proc.wait(timeout=10) == 3


# ── 2. I compose non espongono lo stream ──────────────────────────────────


class _ComposeLoader(yaml.SafeLoader):
    """SafeLoader che accetta il tag `!reset` dei file Compose."""


_ComposeLoader.add_constructor("!reset", lambda loader, node: {"__reset__": loader.construct_sequence(node)})


def _service(path):
    return yaml.load(path.read_text(encoding="utf-8"), Loader=_ComposeLoader)["services"]["jht"]


def test_base_compose_publishes_only_on_host_loopback():
    ports = _service(COMPOSE).get("ports")
    assert ports, "the live screen port must be published for the desktop app"
    for entry in ports:
        assert isinstance(entry, str) and entry.startswith("127.0.0.1:"), entry
    assert any(entry.endswith(":6080") for entry in ports)


def test_podman_host_network_resets_ports_and_binds_loopback():
    service = _service(PODMAN_COMPOSE)
    assert service["network_mode"] == "host"
    assert service["ports"] == {"__reset__": []}
    assert "JHT_LIVE_SCREEN_BIND=127.0.0.1" in service["environment"]


def _compose_command():
    """`docker-compose` o il plugin `docker compose`: il primo che renderizza davvero.

    Si prova `config` su un file vuoto, non `version`: su alcune installazioni
    `docker compose version` risponde ma `docker compose -f` non è riconosciuto.
    """
    candidates = [["docker-compose"], ["docker", "compose"]]
    for command in candidates:
        if not shutil.which(command[0]):
            continue
        probe = subprocess.run([*command, "-f", str(COMPOSE), "config", "--quiet"], capture_output=True, check=False)
        if probe.returncode == 0:
            return command
    return None


@pytest.mark.skipif(_compose_command() is None, reason="docker compose not available")
def test_podman_override_merges_to_no_published_port(tmp_path):
    """Il merge vero di Compose, non la lettura dei due file separati."""
    result = subprocess.run(
        [*_compose_command(), "-f", str(COMPOSE), "-f", str(PODMAN_COMPOSE), "config", "--format", "json"],
        capture_output=True, text=True, check=False,
        env={**os.environ, "HOME": str(tmp_path)},
    )
    assert result.returncode == 0, result.stderr

    service = json.loads(result.stdout)["services"]["jht"]
    assert not service.get("ports")
    assert service["environment"]["JHT_LIVE_SCREEN_BIND"] == "127.0.0.1"


# ── 2b. La morte dello schermo non è invisibile ────────────────────────────


def _process_health(monkeypatch, cmdlines, env_value=None):
    import importlib.util

    if env_value is None:
        monkeypatch.delenv("JHT_LIVE_SCREEN", raising=False)
    else:
        monkeypatch.setenv("JHT_LIVE_SCREEN", env_value)
    spec = importlib.util.spec_from_file_location(
        "process_health_live_screen", REPO_ROOT / "shared" / "skills" / "process_health.py"
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(module, "_cmdlines", lambda: cmdlines)
    return next(row for row in module.scan()["rows"] if row["name"] == "live-screen")


def test_process_canary_expects_the_live_screen(monkeypatch):
    alive = _process_health(monkeypatch, ["/bin/bash /app/.launcher/live-screen.sh"])
    assert alive["alive"] is True and alive["group"] == "pid1-child"

    dead = _process_health(monkeypatch, ["/usr/bin/env python3 -u /app/shared/skills/throttle_engine.py"])
    assert dead["alive"] is False
    assert not dead.get("optional"), "a dead live screen must count as dead"


def test_process_canary_does_not_flag_a_screen_turned_off(monkeypatch):
    row = _process_health(monkeypatch, [], env_value="0")
    assert row["alive"] is False and row["optional"] is True


# ── 3. L'immagine ha davvero lo schermo ───────────────────────────────────


def test_image_installs_the_x_stack_without_debian_novnc():
    for package in ("xvfb", "x11vnc", "python3-websockify"):
        assert f" {package}" in DOCKERFILE, package
    # Il pacchetto `novnc` di bookworm si porta dietro nodejs + libnode.
    assert not any(
        line.strip().split()[:1] == ["novnc"] or " novnc " in f" {line.strip()} "
        for line in DOCKERFILE.splitlines()
        if not line.strip().startswith("#")
    )


def test_image_installs_full_chromium_and_exports_the_display():
    assert "playwright install chromium" in DOCKERFILE
    assert "DISPLAY=:99" in DOCKERFILE


def test_image_build_gate_launches_headed_chromium_on_xvfb():
    gate = DOCKERFILE[DOCKERFILE.index("RUN Xvfb :98"):]
    gate = gate[: gate.index("exit 1; }") + len("exit 1; }")]
    assert "headless=False" in gate
    assert "DISPLAY=:98" in gate
    # Skipped ONLY for an emulated target: a native build must still launch.
    assert '[ "$TARGETARCH" != "$BUILDARCH" ]' in gate
    assert "HEADED_LAUNCH_SKIPPED" in gate
    assert "ARG TARGETARCH" in DOCKERFILE and "ARG BUILDARCH" in DOCKERFILE
    assert "xvfb-run" not in gate.replace("xvfb-run waits", "")
