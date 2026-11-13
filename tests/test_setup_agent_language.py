"""The real host picker and launcher exports, followed by a synthetic provider in private tmux."""
from __future__ import annotations

import errno
import json
import os
import re
import select
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path

import pytest

from private_tmux import close_dir, private_dir

ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / ".launcher"
REGULAR = ("ASSISTENTE", "CAPITANO", "SCOUT-1", "ANALISTA-1", "SCORER-1", "SCRITTORE-1",
           "CRITICO", "SENTINELLA", "MENTOR", "CLOSER-1")
pytestmark = pytest.mark.skipif(os.name == "nt", reason="launcher runs in the POSIX container")


def _read_terminal(fd, screen):
    if select.select([fd], [], [], 0.05)[0]:
        try:
            screen.extend(os.read(fd, 65536))
        except OSError as exc:
            if exc.errno != errno.EIO:
                raise


def _until(fd, screen, text):
    deadline = time.monotonic() + 15
    while text.encode() not in screen and time.monotonic() < deadline:
        _read_terminal(fd, screen)
    assert text.encode() in screen, screen.decode("utf-8", "replace")


def choose_language(home, choice=2):
    import fcntl
    import pty
    import struct
    import termios
    (home.parent / "runtime").mkdir(exist_ok=True)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))
    env = {**os.environ, "HOME": str(home.parent), "JHT_HOME_HOST": str(home),
           "JHT_LANG": "en", "JHT_USER_TZ": "Europe/Rome", "DISPLAY": ":synthetic", "TERM": "xterm",
           "JHT_RUNTIME_DIR": str(home.parent / "runtime"), "XDG_DATA_HOME": str(home.parent / "data"),
           "BASH_ENV": "/dev/null"}
    env.pop("JHT_SKIP_HOST_SETUP", None)
    proc = subprocess.Popen(["bash", str(ROOT / "scripts/host-setup.sh")],
                            env=env, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
    os.close(slave)
    screen = bytearray()
    try:
        _until(master, screen, "Choice / Scelta / Választás / Elección / Auswahl / Choix / Escolha")
        os.write(master, f"{choice}\n".encode())
        _until(master, screen, "Dove fai girare JHT?" if str(choice) == "2" else "Where are you running JHT?")  # in the language just chosen (Italian or English)
        os.write(master, b"1\n")
        _until(master, screen, "Fuso orario [" if str(choice) == "2" else "Timezone [")
        os.write(master, b"\n")
        deadline = time.monotonic() + 10
        while proc.poll() is None and time.monotonic() < deadline:
            _read_terminal(master, screen)
        assert proc.wait(timeout=5) == 0, screen.decode("utf-8", "replace")
    finally:
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=5)
        os.close(master)
    return screen.decode("utf-8", "replace")


@pytest.fixture
def runtime(tmp_path):
    tmux = shutil.which("tmux")
    assert tmux, "The launcher gate requires real tmux"
    assert shutil.which("jq"), "The launcher gate requires real jq"
    socket_root = private_dir("language")
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    shim = bin_dir / "tmux"
    shim.write_text(f'#!/bin/sh\nPATH="$ORIGINAL_PATH" exec {shlex.quote(tmux)} -f /dev/null -L language-test "$@"\n')
    shim.chmod(0o755)
    home = tmp_path / "home" / ".jht"
    home.mkdir(parents=True)
    env = {k: v for k, v in os.environ.items() if k not in ("TMUX", "TMUX_PANE", "JHT_SCOUT_COORD_DB")}
    env.update(PATH=f"{bin_dir}:{env['PATH']}", ORIGINAL_PATH=env["PATH"], TMUX_TMPDIR=str(socket_root),
               JHT_HOME=str(home), JHT_LANG="en", JHT_USER_DIR=str(tmp_path / "documents"),
               JHT_SPAWN_LIB_DIR=str(LAUNCHER), HOME=str(home.parent), SHELL="/bin/bash", BASH_ENV="/dev/null")
    provider = tmp_path / "synthetic-provider.py"
    provider.write_text("import json,os,sys\nwith open(sys.argv[1],'w') as f:\n"
                        " json.dump({k:os.environ.get(k) for k in ('JHT_LANG','JHT_AGENT_NAME')},f)\n")

    def run(*args):
        return subprocess.run([str(shim), *args], env=env, capture_output=True, text=True, timeout=15)

    try:
        assert run("new-session", "-d", "-s", "FIXTURE-CONTROL", "bash --noprofile --norc").returncode == 0
        assert run("set-option", "-g", "default-shell", "/bin/bash").returncode == 0
        assert run("set-option", "-g", "default-command", "bash --noprofile --norc").returncode == 0
        yield home, env, run, provider
    finally:
        close_dir(socket_root)


def _function(source, name):
    match = re.search(rf"^{re.escape(name)}\(\) \{{.*?^\}}", source, re.M | re.S)
    assert match, f"Real launcher function missing: {name}"
    return match.group(0)


def provider_environment(run, session, provider, suffix):
    output = provider.parent / f"{session}-{suffix}.json"
    command = " ".join(shlex.quote(str(arg)) for arg in (sys.executable, provider, output))
    sent = run("send-keys", "-t", session, command, "C-m")
    assert sent.returncode == 0, sent.stderr
    deadline = time.monotonic() + 10
    while not output.exists() and time.monotonic() < deadline:
        time.sleep(0.02)
    assert output.exists(), run("capture-pane", "-pt", session).stdout
    # The provider opens and writes it in separate operations: wait for complete JSON as well.
    while time.monotonic() < deadline:
        try:
            return json.loads(output.read_text())
        except json.JSONDecodeError:
            time.sleep(0.02)
    pytest.fail(f"Provider did not finish its environment receipt: {output.name}")


def propagate(env, session):
    source = (LAUNCHER / "start-agent.sh").read_text(encoding="utf-8")
    script = "\n".join([
        "set -euo pipefail", f"source {shlex.quote(str(LAUNCHER / 'config.sh'))}",
        f"source {shlex.quote(str(LAUNCHER / 'spawn-lib.sh'))}",
        'USER_LOCALE="$(jht_spawn_user_locale)"; export JHT_LANG="$USER_LOCALE"',
        f"SESSION={shlex.quote(session)}; AGENT_NAME={shlex.quote(session.lower())}; AGENT_DIR=$JHT_HOME",
        _function(source, "send_env_vars"), "send_env_vars",
    ])
    done = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True, timeout=20)
    assert done.returncode == 0, done.stderr


@pytest.mark.parametrize("previous", [None, "en"])
def test_setup_italian_reaches_every_agent_even_with_a_stale_english_tmux_server(runtime, previous):
    home, env, run, provider = runtime
    if previous:
        (home / "i18n-prefs.json").write_text(json.dumps({"locale": previous}))
    (home / "host.env").write_text("JHT_LANG=en\nJHT_USER_TZ=Europe/Rome\n")
    screen = choose_language(home)
    prefs = json.loads((home / "i18n-prefs.json").read_text())
    # asked_at: the host setup asked the language now, so the wizard in the container does not ask it again
    assert prefs["locale"] == "it" and set(prefs) <= {"locale", "asked_at"} and isinstance(prefs.get("asked_at", 0), int)
    assert "JHT_LANG=it\n" in (home / "host.env").read_text()
    assert "JHT_LANG=it\n" in (home.parent / "runtime" / "host-values").read_text()
    for session in REGULAR:
        started = run("new-session", "-d", "-s", session, "bash --noprofile --norc")
        assert started.returncode == 0, started.stderr
        assert provider_environment(run, session, provider, "before")["JHT_LANG"] == "en"
        propagate(env, session)
        receipt = provider_environment(run, session, provider, "after")
        assert receipt == {"JHT_LANG": "it", "JHT_AGENT_NAME": session.lower()}
    for session in ("DOTTORE", "MANTENITORE"):
        script = (f"source {shlex.quote(str(LAUNCHER / 'spawn-lib.sh'))}; "
                  f"jht_spawn_new_session {session} {shlex.quote(str(home))} TEST")
        started = subprocess.run(["bash", "-c", script], env=env, capture_output=True, text=True, timeout=20)
        assert started.returncode == 0, started.stderr
        assert provider_environment(run, session, provider, "after")["JHT_LANG"] == "it"
    assert "JHT_LANG=en" in run("show-environment", "-g", "JHT_LANG").stdout
    print("T215 real setup screen, synthetic home:\n" + screen)
    print("T215 actual provider receipts: 12 roles JHT_LANG=it; server remains en")


@pytest.mark.parametrize("choice, expected", [(1, "en"), (6, "fr")])
def test_a_new_explicit_setup_choice_replaces_the_old_canonical_language(tmp_path, choice, expected):
    home = tmp_path / "home" / ".jht"
    home.mkdir(parents=True)
    (home / "i18n-prefs.json").write_text('{"locale":"it"}')
    choose_language(home, choice)
    prefs = json.loads((home / "i18n-prefs.json").read_text())
    assert prefs["locale"] == expected and set(prefs) <= {"locale", "asked_at"} and isinstance(prefs.get("asked_at", 0), int)
    assert f"JHT_LANG={expected}\n" in (home / "host.env").read_text()


@pytest.mark.parametrize("flavor", ["bash", "powershell"])
def test_a_failed_environment_send_is_not_hidden_by_a_later_success(tmp_path, flavor):
    calls = tmp_path / "calls"
    script = "\n".join([
        "set -euo pipefail", f"source {shlex.quote(str(LAUNCHER / 'agent-environment.sh'))}",
        f"jht_spawn_tmux() {{ printf '%s\\n' \"$*\" >> {shlex.quote(str(calls))}; "
        "case \"$*\" in *JHT_SCOUT_COORD_DB*) return 17;; *) return 0;; esac; }",
        "SESSION=ASSISTENTE; JHT_SCOUT_COORD_DB=/synthetic/coord.db; JHT_LANG=it",
        f"rc=0; send_optional_env {flavor} || rc=$?; printf 'RC=%s\\n' \"$rc\"",
    ])
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=10)
    assert done.returncode == 0, done.stderr
    assert done.stdout.strip() == "RC=17"
    sent = calls.read_text().splitlines()
    assert len(sent) == 1 and "JHT_SCOUT_COORD_DB" in sent[0]
