"""Security contract for host.env consumers.

The container can write ~/.jht/host.env through the /jht_home bind mount.
Host-side scripts must parse that file as data and must never execute it.
"""

import os
import hashlib
import re
import shlex
import subprocess
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
HOST_SETUP = ROOT / "scripts" / "host-setup.sh"
POWERSHELL_WRAPPER = ROOT / "scripts" / "jht-wrapper.ps1"
COMPOSE = ROOT / "docker-compose.yml"
GAME_SETUP = ROOT / "game" / "scripts" / "setup" / "setup_service.gd"


def write_trusted_runtime(runtime: Path, *, helper: str | None = None) -> None:
    runtime.mkdir(parents=True)
    runtime.chmod(0o700)
    compose = runtime / "docker-compose.yml"
    compose.write_text("services: {}\n", encoding="utf-8")
    compose.chmod(0o600)
    host_setup = runtime / "host-setup.sh"
    host_setup.write_text(
        helper or "#!/usr/bin/env bash\nset -eu\nexit 0\n", encoding="utf-8"
    )
    host_setup.chmod(0o700)
    manifest = runtime / ".runtime-integrity"
    manifest.write_text(
        "version=1\n"
        f"docker-compose.yml={hashlib.sha256(compose.read_bytes()).hexdigest()}\n"
        f"host-setup.sh={hashlib.sha256(host_setup.read_bytes()).hexdigest()}\n"
        f"jht-wrapper.sh={hashlib.sha256(WRAPPER.read_bytes()).hexdigest()}\n",
        encoding="utf-8",
    )
    manifest.chmod(0o600)


def make_fake_docker(fake_bin: Path, log: Path) -> None:
    fake_bin.mkdir(parents=True, exist_ok=True)
    docker = fake_bin / "docker"
    docker.write_text(
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        'printf \'%s\\n\' "$*" >> "$JHT_TEST_DOCKER_LOG"\n'
        'if [ "${1:-}" = ps ]; then printf \'jht\\n\'; fi\n',
        encoding="utf-8",
    )
    docker.chmod(0o755)


def wrapper_runtime_env(home: Path, runtime: Path, fake_bin: Path, log: Path) -> dict[str, str]:
    return {
        **os.environ,
        "HOME": str(home),
        "PATH": f"{fake_bin}{os.pathsep}{os.environ['PATH']}",
        "JHT_RUNTIME_DIR": str(runtime),
        "JHT_COMPOSE_FILE": str(runtime / "docker-compose.yml"),
        "JHT_HOST_SETUP_SCRIPT": str(runtime / "host-setup.sh"),
        "JHT_TEST_DOCKER_LOG": str(log),
    }


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
    runtime = runtime.resolve()
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
    compose_sha = hashlib.sha256((runtime / "docker-compose.yml").read_bytes()).hexdigest()
    setup_sha = hashlib.sha256(host_setup.read_bytes()).hexdigest()
    (runtime / ".runtime-integrity").write_text(
        f"version=1\ndocker-compose.yml={compose_sha}\nhost-setup.sh={setup_sha}\n"
        f"jht-wrapper.sh={hashlib.sha256(WRAPPER.read_bytes()).hexdigest()}\n",
        encoding="utf-8",
    )

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


def test_host_runtime_is_outside_bind_and_legacy_path_is_masked():
    bash = WRAPPER.read_text(encoding="utf-8")
    powershell = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    compose = COMPOSE.read_text(encoding="utf-8")
    game = GAME_SETUP.read_text(encoding="utf-8")

    assert 'RUNTIME_DIR="${JHT_RUNTIME_DIR:-$HOME/.jht/runtime}"' not in bash
    assert "Join-Path $env:USERPROFILE '.jht\\runtime'" not in powershell
    assert "jht-runtime-mask:/jht_home/runtime" in compose
    assert '_jht_home().path_join("runtime/docker-compose.yml")' not in game


def test_host_setup_never_imports_shell_i18n_from_disk():
    source = HOST_SETUP.read_text(encoding="utf-8")
    assert "shared/i18n.sh" not in source


@pytest.mark.parametrize("command", ["up", "down", "restart", "recreate", "setup", "upgrade"])
def test_container_writable_legacy_runtime_is_rejected_before_bash_or_docker(
    tmp_path, command
):
    home = tmp_path / "home"
    legacy = home / ".jht" / "runtime"
    shared = legacy / "shared"
    shared.mkdir(parents=True)
    marker = tmp_path / "legacy-payload-ran"
    payload = f"#!/usr/bin/env bash\ntouch {shlex.quote(str(marker))}\n"
    (legacy / "docker-compose.yml").write_text(
        "services:\n  pwn:\n    image: attacker.invalid/payload\n", encoding="utf-8"
    )
    (legacy / "host-setup.sh").write_text(payload, encoding="utf-8")
    (legacy / "host-setup.sh").chmod(0o755)
    (shared / "i18n.sh").write_text(payload, encoding="utf-8")

    fake_bin = tmp_path / "bin"
    docker_log = tmp_path / "docker.log"
    make_fake_docker(fake_bin, docker_log)
    result = subprocess.run(
        ["bash", str(WRAPPER), command],
        env=wrapper_runtime_env(home, legacy, fake_bin, docker_log),
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert result.returncode != 0
    assert not marker.exists()
    assert not docker_log.exists(), docker_log.read_text(encoding="utf-8") if docker_log.exists() else ""


def test_legacy_runtime_migration_downloads_fresh_release_bytes(tmp_path):
    home = tmp_path / "home"
    legacy = home / ".jht" / "runtime"
    (legacy / "shared").mkdir(parents=True)
    legacy_marker = tmp_path / "legacy-payload-ran"
    payload = f"#!/usr/bin/env bash\ntouch {shlex.quote(str(legacy_marker))}\n"
    (legacy / "docker-compose.yml").write_text("services: {pwn: {}}\n", encoding="utf-8")
    (legacy / "host-setup.sh").write_text(payload, encoding="utf-8")
    (legacy / "shared" / "i18n.sh").write_text(payload, encoding="utf-8")
    (home / ".jht" / "host.env").write_text(
        malicious_env(legacy_marker), encoding="utf-8"
    )

    runtime = (tmp_path / "protected" / "host-runtime").resolve()
    safe_marker = tmp_path / "release-helper-ran"
    release_sha = "a" * 40
    curl_log = tmp_path / "curl.log"
    fake_bin = tmp_path / "bin"
    docker_log = tmp_path / "docker.log"
    make_fake_docker(fake_bin, docker_log)
    curl = fake_bin / "curl"
    curl.write_text(
        "#!/usr/bin/env bash\n"
        "set -eu\n"
        "url='' out=''\n"
        "while [ \"$#\" -gt 0 ]; do\n"
        "  case \"$1\" in -o) out=$2; shift 2 ;; -*) shift ;; *) url=$1; shift ;; esac\n"
        "done\n"
        "printf '%s\\n' \"$url\" >> \"$JHT_TEST_CURL_LOG\"\n"
        "case \"$url\" in\n"
        f"  */commits/production) printf '{{\\n  \"sha\": \"{release_sha}\"\\n}}\\n' ;;\n"
        "  */docker-compose.yml) printf 'services: {}\\n' > \"$out\" ;;\n"
        "  */scripts/host-setup.sh) printf '#!/usr/bin/env bash\\n: > \"$JHT_TEST_SAFE_SETUP_MARKER\"\\n' > \"$out\" ;;\n"
        "  *) exit 22 ;;\n"
        "esac\n",
        encoding="utf-8",
    )
    curl.chmod(0o755)
    env = wrapper_runtime_env(home, runtime, fake_bin, docker_log)
    env.update(
        {
            "JHT_TEST_SAFE_SETUP_MARKER": str(safe_marker),
            "JHT_TEST_CURL_LOG": str(curl_log),
        }
    )
    result = subprocess.run(
        ["bash", str(WRAPPER), "setup"],
        env=env,
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert result.returncode == 0, result.stderr
    assert safe_marker.exists()
    assert not legacy_marker.exists()
    assert "attacker.invalid" not in (runtime / "docker-compose.yml").read_text(encoding="utf-8")
    assert (runtime / ".runtime-integrity").is_file()
    fetched = curl_log.read_text(encoding="utf-8").splitlines()
    assert any(url.endswith("/commits/production") for url in fetched)
    interpreted = [url for url in fetched if "raw.githubusercontent.com" in url]
    assert interpreted
    assert all(f"/{release_sha}/" in url for url in interpreted)


@pytest.mark.parametrize("tamper", ["compose_symlink", "world_writable", "digest", "owner"])
def test_untrusted_protected_runtime_stops_before_docker(tmp_path, tamper):
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    runtime = tmp_path / "protected" / "host-runtime"
    write_trusted_runtime(runtime)
    runtime = runtime.resolve()
    if tamper == "compose_symlink":
        external = tmp_path / "container-compose.yml"
        external.write_text("services: {pwn: {}}\n", encoding="utf-8")
        (runtime / "docker-compose.yml").unlink()
        (runtime / "docker-compose.yml").symlink_to(external)
    elif tamper == "world_writable":
        (runtime / "host-setup.sh").chmod(0o777)
    elif tamper == "digest":
        (runtime / "docker-compose.yml").write_text("services: {pwn: {}}\n", encoding="utf-8")

    fake_bin = tmp_path / "bin"
    docker_log = tmp_path / "docker.log"
    make_fake_docker(fake_bin, docker_log)
    if tamper == "owner":
        fake_id = fake_bin / "id"
        fake_id.write_text("#!/usr/bin/env bash\nprintf '424242\\n'\n", encoding="utf-8")
        fake_id.chmod(0o755)
    result = subprocess.run(
        ["bash", str(WRAPPER), "up"],
        env=wrapper_runtime_env(home, runtime, fake_bin, docker_log),
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert result.returncode != 0
    assert not docker_log.exists(), docker_log.read_text(encoding="utf-8") if docker_log.exists() else ""


def test_runtime_with_symlinked_ancestor_is_rejected(tmp_path):
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    real_parent = tmp_path / "real-parent"
    runtime = real_parent / "host-runtime"
    write_trusted_runtime(runtime)
    alias = tmp_path / "alias"
    alias.symlink_to(real_parent, target_is_directory=True)
    declared = alias / "host-runtime"
    fake_bin = tmp_path / "bin"
    docker_log = tmp_path / "docker.log"
    make_fake_docker(fake_bin, docker_log)

    result = subprocess.run(
        ["bash", str(WRAPPER), "up"],
        env=wrapper_runtime_env(home, declared, fake_bin, docker_log),
        capture_output=True,
        text=True,
        timeout=10,
    )

    assert result.returncode != 0
    assert not docker_log.exists()


def test_windows_runtime_contract_checks_path_acl_reparse_owner_and_digest():
    source = POWERSHELL_WRAPPER.read_text(encoding="utf-8")
    for seam in (
        "Test-RuntimePathAuthority",
        "Test-RuntimeAncestorsWithoutReparsePoint",
        "Test-RuntimeDirectoryAcl",
        "WindowsIdentity]::GetCurrent",
        "Get-FileHash -Algorithm SHA256",
        "Get-AttestedRawBase",
        "^[0-9a-fA-F]{40}$",
    ):
        assert seam in source
    assert source.index("Require-ComposeFile", source.index("switch ($Sub)")) < source.index(
        "Require-Docker", source.index("switch ($Sub)")
    )
