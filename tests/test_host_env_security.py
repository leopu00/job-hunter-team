"""Security contract for host.env consumers.

The container can write ~/.jht/host.env through the /jht_home bind mount.
Host-side scripts must parse that file as data and must never execute it.
"""

import os
import re
import shlex
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
HOST_SETUP = ROOT / "scripts" / "host-setup.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"


def malicious_env(marker: Path, *, host_type: str = "local") -> str:
    quoted = shlex.quote(str(marker))
    return (
        "JHT_LANG=it\n"
        f"JHT_HOST_TYPE={host_type}\n"
        "JHT_USER_TZ=Europe/Rome\n"
        f"touch {quoted}\n"
        f"UNEXPECTED=$(touch {quoted})\n"
        f"JHT_LANG=$(touch {quoted})\n"
    )


def test_posix_host_env_is_never_sourced():
    source_command = re.compile(
        r"(?m)^\s*(?:\.|source)\s+[^\n]*(?:HOST_ENV_FILE|HOST_ENV_PATH)"
    )
    for script in (WRAPPER, HOST_SETUP):
        source = script.read_text(encoding="utf-8")
        assert not source_command.search(source), script
        assert "jht_read_host_env_value" in source


def test_wrapper_treats_shell_syntax_as_inert_data(tmp_path):
    home = tmp_path / "home"
    host_env = home / ".jht" / "host.env"
    host_env.parent.mkdir(parents=True)
    marker = tmp_path / "host-command-ran"
    host_env.write_text(malicious_env(marker), encoding="utf-8")

    result = subprocess.run(
        ["bash", str(WRAPPER), "game", "start", "--help"],
        env={**os.environ, "HOME": str(home), "JHT_HOST_ENV_FILE": str(host_env)},
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()


def test_wrapper_setup_reload_does_not_execute_new_host_env(tmp_path):
    home = tmp_path / "home"
    host_env = home / ".jht" / "host.env"
    host_env.parent.mkdir(parents=True)
    host_env.write_text("JHT_HOST_TYPE=local\n", encoding="utf-8")
    marker = tmp_path / "setup-reload-command-ran"

    runtime = tmp_path / "runtime"
    runtime.mkdir()
    (runtime / "docker-compose.yml").write_text("services: {}\n", encoding="utf-8")
    host_setup = runtime / "host-setup.sh"
    host_setup.write_text(
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        f"printf '%s' {shlex.quote(malicious_env(marker, host_type='vps'))} > "
        f"{shlex.quote(str(host_env))}\n",
        encoding="utf-8",
    )
    host_setup.chmod(0o755)

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    docker_log = tmp_path / "docker-args"
    docker = fake_bin / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "case \"$1\" in\n"
        "  info) exit 0 ;;\n"
        "  ps) printf 'jht\\n' ;;\n"
        "  exec) printf '%s\\n' \"$*\" > \"$JHT_TEST_DOCKER_LOG\" ;;\n"
        "  *) exit 0 ;;\n"
        "esac\n",
        encoding="utf-8",
    )
    docker.chmod(0o755)

    result = subprocess.run(
        ["bash", str(WRAPPER), "setup"],
        env={
            **os.environ,
            "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
            "HOME": str(home),
            "JHT_HOST_ENV_FILE": str(host_env),
            "JHT_HOST_SETUP_SCRIPT": str(host_setup),
            "JHT_RUNTIME_DIR": str(runtime),
            "JHT_COMPOSE_FILE": str(runtime / "docker-compose.yml"),
            "JHT_TEST_DOCKER_LOG": str(docker_log),
        },
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()
    assert "JHT_HOST_TYPE=vps" in docker_log.read_text(encoding="utf-8")


def test_host_setup_reads_language_without_executing_file(tmp_path):
    home = tmp_path / "home"
    jht_home = home / ".jht"
    jht_home.mkdir(parents=True)
    marker = tmp_path / "host-setup-command-ran"
    host_env = jht_home / "host.env"
    host_env.write_text(malicious_env(marker), encoding="utf-8")
    env = {**os.environ, "HOME": str(home), "JHT_HOME_HOST": str(jht_home)}
    env.pop("JHT_LANG", None)
    env.pop("JHT_USER_TZ", None)

    result = subprocess.run(
        ["bash", str(HOST_SETUP), "--host-type=local", "--non-interactive"],
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
    )

    assert result.returncode == 0, result.stderr
    assert not marker.exists()
    assert "JHT_LANG=it" in host_env.read_text(encoding="utf-8")


def test_powershell_reader_has_the_same_key_allowlist():
    source = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    for key in ("JHT_HOST_TYPE", "JHT_LANG", "JHT_USER_TZ"):
        assert key in source
    assert "$AllowedHostEnvNames -notcontains $name" in source
