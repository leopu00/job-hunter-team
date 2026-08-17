"""Chiedere aiuto non deve avviare il prodotto (P-07).

Il wrapper chiamava ``ensure_up`` in cima al catch-all, cioe' PRIMA di
guardare cosa avesse chiesto l'utente: ``jht --help`` scaricava l'immagine e
creava container e volumi. I test usano un Docker finto stateful: osservano
gli effetti e conservano la controprova che un comando runtime si avvii ancora.
"""

import hashlib
import os
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
BASH_WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
SAFE_COMPOSE = (
    "services:\n  jht:\n    image: example.invalid/jht\n"
    "    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n"
    "volumes:\n  jht-runtime-mask:\n"
)


def write_trusted_runtime(tmp_path: Path) -> dict[str, str]:
    """Installa il minimo bundle host firmato richiesto da un comando vero."""
    runtime = tmp_path / "runtime"
    runtime.mkdir(mode=0o700)
    compose = runtime / "docker-compose.yml"
    compose.write_text(SAFE_COMPOSE, encoding="utf-8")
    compose.chmod(0o600)
    host_setup = runtime / "host-setup.sh"
    host_setup.write_text(
        "#!/usr/bin/env bash\nset -eu\nJHT_HOST_SETUP_PROTOCOL=1\nexit 0\n",
        encoding="utf-8",
    )
    host_setup.chmod(0o700)
    manifest = runtime / ".runtime-integrity"
    manifest.write_text(
        "version=1\n"
        f"docker-compose.yml={hashlib.sha256(compose.read_bytes()).hexdigest()}\n"
        f"host-setup.sh={hashlib.sha256(host_setup.read_bytes()).hexdigest()}\n"
        f"jht-wrapper.sh={hashlib.sha256(BASH_WRAPPER.read_bytes()).hexdigest()}\n",
        encoding="utf-8",
    )
    manifest.chmod(0o600)
    return {
        "JHT_RUNTIME_DIR": str(runtime),
        "JHT_COMPOSE_FILE": str(compose),
        "JHT_HOST_SETUP_SCRIPT": str(host_setup),
    }


def make_docker_spy(tmp_path: Path, *, reachable: bool, container_running: bool):
    """Docker stateful: compose up rende visibile il container ai poll successivi."""
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir(exist_ok=True)
    log = tmp_path / "docker-calls.log"
    state = tmp_path / "container-running"
    if container_running:
        state.touch()
    docker = fake_bin / "docker"
    docker.write_text(
        f"""#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$JHT_TEST_DOCKER_LOG"
case "$1" in
  info) exit {0 if reachable else 1} ;;
  ps)
    if [ -e {state!s} ]; then printf 'jht\\n'; fi
    ;;
  compose)
    for arg in "$@"; do
      if [ "$arg" = up ]; then : > {state!s}; fi
    done
    ;;
  *) true ;;
esac
""",
        encoding="utf-8",
    )
    docker.chmod(0o755)
    return fake_bin, log


def run_wrapper(args, fake_bin: Path, tmp_path: Path, *, extra_env=None):
    env = {
        **os.environ,
        "PATH": f"{fake_bin}:/usr/bin:/bin:/usr/sbin:/sbin",
        "HOME": str(tmp_path),
        "JHT_TEST_DOCKER_LOG": str(tmp_path / "docker-calls.log"),
        **(extra_env or {}),
    }
    return subprocess.run(
        ["bash", str(BASH_WRAPPER), *args],
        capture_output=True,
        text=True,
        env=env,
        timeout=60,
    )


def calls(log: Path) -> list[str]:
    return log.read_text(encoding="utf-8").splitlines() if log.exists() else []


def assert_no_docker_effect(log: Path) -> None:
    """Sono ammesse solo probe read-only, mai mutazioni di risorse Docker."""
    observed = calls(log)
    assert set(observed) <= {"info", "ps --format {{.Names}}"}, (
        "la richiesta informativa ha toccato immagini, volumi o container: "
        f"{observed}"
    )


@pytest.mark.parametrize("args", [["--help"], ["-h"], ["help"], []])
def test_help_prints_and_starts_nothing_when_docker_is_unreachable(tmp_path, args):
    fake_bin, log = make_docker_spy(
        tmp_path, reachable=False, container_running=False
    )
    res = run_wrapper(args, fake_bin, tmp_path)

    assert res.returncode == 0, res.stderr
    assert "jht" in res.stdout and "jht up" in res.stdout
    assert_no_docker_effect(log)


@pytest.mark.parametrize("args", [["--help"], []])
def test_help_starts_nothing_when_docker_runs_but_container_is_down(tmp_path, args):
    # Docker risponde ma il container no: il vecchio wrapper faceva compose up.
    fake_bin, log = make_docker_spy(
        tmp_path, reachable=True, container_running=False
    )
    res = run_wrapper(args, fake_bin, tmp_path)

    assert res.returncode == 0, res.stderr
    assert "jht up" in res.stdout
    assert_no_docker_effect(log)


@pytest.mark.parametrize(
    "command",
    [
        "positions",
        "up",
        "start-container",
        "down",
        "stop-container",
        "restart",
        "recreate",
        "upgrade",
        "logs",
        "status",
        "shell",
        "oauth-login",
        "claude-login",
        "setup",
        "download",
    ],
)
def test_every_dispatched_subcommand_help_is_offline(tmp_path, command):
    # I nomi host hanno rami espliciti prima del catch-all: il vecchio gate,
    # collocato soltanto nel default, non poteva proteggerli.
    fake_bin, log = make_docker_spy(
        tmp_path, reachable=False, container_running=False
    )
    res = run_wrapper([command, "--help"], fake_bin, tmp_path)

    assert res.returncode == 0, res.stderr
    assert "jht" in res.stdout
    assert_no_docker_effect(log)


@pytest.mark.parametrize(
    "args", [["game", "--help"], ["game", "start", "--help"], ["gui", "--help"]]
)
def test_desktop_subcommand_help_remains_host_only(tmp_path, args):
    fake_bin, log = make_docker_spy(
        tmp_path, reachable=False, container_running=False
    )
    res = run_wrapper(args, fake_bin, tmp_path)

    assert res.returncode == 0, res.stderr
    assert_no_docker_effect(log)


def test_version_prints_without_docker_effects(tmp_path):
    fake_bin, log = make_docker_spy(
        tmp_path, reachable=False, container_running=False
    )
    res = run_wrapper(["--version"], fake_bin, tmp_path)

    assert res.returncode == 0, res.stderr
    assert res.stdout.splitlines()[0] == "0.3.9"
    assert_no_docker_effect(log)


def test_a_real_command_still_starts_the_container(tmp_path):
    # Controprova: un wrapper che non avvia MAI nulla non deve passare.
    fake_bin, log = make_docker_spy(
        tmp_path, reachable=True, container_running=False
    )
    res = run_wrapper(
        ["positions", "list"],
        fake_bin,
        tmp_path,
        extra_env=write_trusted_runtime(tmp_path),
    )

    assert res.returncode == 0, res.stderr
    observed = calls(log)
    assert any("compose" in call and call.endswith("up -d") for call in observed), (
        "un comando vero deve avviare il container: " f"{observed}"
    )
    assert any(
        call.startswith("exec ") and call.endswith("positions list")
        for call in observed
    ), "dopo l'avvio il comando deve ancora raggiungere il CLI: " f"{observed}"


def test_both_wrappers_gate_help_before_dispatch():
    """Il difetto era di forma, e la forma va tenuta in entrambi i wrapper."""
    bash = BASH_WRAPPER.read_text(encoding="utf-8")
    powershell = POWERSHELL_WRAPPER.read_text(encoding="utf-8")

    assert bash.index("host_command_uses_local_help") < bash.index('case "$SUB" in')
    assert bash.index('for arg in "${@:2}"') < bash.index('case "$SUB" in')
    assert powershell.index("Test-HostCommandUsesLocalHelp") < powershell.index(
        "switch ($Sub)"
    )
    assert powershell.index("$HelpRequested =") < powershell.index("switch ($Sub)")
    assert "Write-Output $ConfiguredVersion" in powershell
