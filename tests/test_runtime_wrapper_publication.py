"""MIGRATION del bundle candidato su una baseline preesistente attestata."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
INSTALLER = ROOT / "scripts" / "install.sh"
CANDIDATE_WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
CANDIDATE_COMPOSE = ROOT / "docker-compose.yml"
CANDIDATE_SETUP = ROOT / "scripts" / "host-setup.sh"


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write(path: Path, content: str, mode: int) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(mode)


def _sandbox(tmp_path: Path, *, wrapper_exists: bool = True) -> dict[str, object]:
    home = tmp_path / "home"
    runtime = tmp_path / "runtime"
    bin_dir = tmp_path / "bin"
    source = tmp_path / "candidate"
    spy_bin = tmp_path / "spy-bin"
    home.mkdir(parents=True, mode=0o700)
    runtime.mkdir(mode=0o700)
    bin_dir.mkdir(mode=0o700)
    (source / "scripts").mkdir(parents=True)
    spy_bin.mkdir(mode=0o700)
    shutil.copy2(INSTALLER, source / "scripts" / "install.sh")
    shutil.copy2(CANDIDATE_WRAPPER, source / "scripts" / "jht-wrapper.sh")
    shutil.copy2(CANDIDATE_COMPOSE, source / "docker-compose.yml")
    shutil.copy2(CANDIDATE_SETUP, source / "scripts" / "host-setup.sh")

    compose = runtime / "docker-compose.yml"
    setup = runtime / "host-setup.sh"
    selection = runtime / "container-runtime"
    machine = runtime / "podman-machine"
    shim = runtime / "bin" / "docker"
    _write(compose, "services:\n  jht:\n    volumes:\n      - jht-runtime-mask:/jht_home/runtime\n", 0o600)
    _write(setup, "#!/bin/sh\nJHT_HOST_SETUP_PROTOCOL=1\n", 0o700)
    _write(selection, "podman\n", 0o600)
    _write(machine, "jht-podman\n", 0o600)

    side_effect = tmp_path / "runtime-side-effect"
    podman = spy_bin / "podman"
    for name in ("podman", "docker", "jht"):
        _write(spy_bin / name, f"#!/bin/sh\n: > {side_effect!s}\nexit 98\n", 0o700)
    _write(
        shim,
        "#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\n"
        f"exec '{podman}' --connection 'jht-podman' \"$@\"\n",
        0o700,
    )

    wrapper = bin_dir / "jht"
    old_wrapper = (
        "#!/bin/sh\nJHT_UPGRADE_PROTOCOL=1\nJHT_HOST_RUNTIME_PROTOCOL=1\n"
        "JHT_DESKTOP_CHAT_PROTOCOL=1\nDEFAULT_RUNTIME_VERSION=\"0.3.0\"\n"
    )
    if wrapper_exists:
        _write(wrapper, old_wrapper, 0o700)
        old_wrapper_digest = _digest(wrapper)
    else:
        old_wrapper_digest = hashlib.sha256(old_wrapper.encode()).hexdigest()

    manifest = runtime / ".runtime-integrity"
    manifest.write_text(
        "\n".join(
            (
                "version=1",
                f"docker-compose.yml={_digest(compose)}",
                f"host-setup.sh={_digest(setup)}",
                f"jht-wrapper.sh={old_wrapper_digest}",
                f"container-runtime={_digest(selection)}",
                f"podman-machine={_digest(machine)}",
                f"docker-shim={_digest(shim)}",
                "",
            )
        ),
        encoding="utf-8",
    )
    manifest.chmod(0o600)
    env = {
        **os.environ,
        "HOME": str(home),
        "JHT_RUNTIME_DIR": str(runtime),
        "JHT_BIN_DIR": str(bin_dir),
        "JHT_RAW_BASE": source.as_uri(),
        "PATH": f"{spy_bin}:{os.environ.get('PATH', '')}",
    }
    return {
        "home": home,
        "runtime": runtime,
        "wrapper": wrapper,
        "compose": compose,
        "setup": setup,
        "manifest": manifest,
        "side_effect": side_effect,
        "env": env,
    }


def _publish(capable_bash: str, sandbox: dict[str, object], **overrides: str):
    expected = {
        "installer": _digest(INSTALLER),
        "wrapper": _digest(CANDIDATE_WRAPPER),
        "compose": _digest(CANDIDATE_COMPOSE),
        "setup": _digest(CANDIDATE_SETUP),
        "version": "0.4.0",
        **overrides,
    }
    return subprocess.run(
        [
            capable_bash,
            str(INSTALLER),
            "--publish-runtime-bundle",
            "--expected-installer-sha256",
            expected["installer"],
            "--expected-wrapper-sha256",
            expected["wrapper"],
            "--expected-compose-sha256",
            expected["compose"],
            "--expected-host-setup-sha256",
            expected["setup"],
            "--expected-runtime-version",
            expected["version"],
        ],
        env=sandbox["env"],
        text=True,
        capture_output=True,
        timeout=30,
        check=False,
    )


def _published_files(sandbox: dict[str, object]) -> list[Path]:
    return [sandbox[key] for key in ("wrapper", "compose", "setup", "manifest")]


def test_candidate_migration_restores_missing_wrapper_and_is_idempotent(
    tmp_path: Path, capable_bash: str
):
    sandbox = _sandbox(tmp_path, wrapper_exists=False)
    first = _publish(capable_bash, sandbox)
    assert first.returncode == 0, first.stderr
    assert sandbox["wrapper"].read_bytes() == CANDIDATE_WRAPPER.read_bytes()
    assert sandbox["compose"].read_bytes() == CANDIDATE_COMPOSE.read_bytes()
    assert sandbox["setup"].read_bytes() == CANDIDATE_SETUP.read_bytes()
    first_state = [path.read_bytes() for path in _published_files(sandbox)]

    second = _publish(capable_bash, sandbox)
    assert second.returncode == 0, second.stderr
    assert [path.read_bytes() for path in _published_files(sandbox)] == first_state
    assert not sandbox["side_effect"].exists()
    assert not (sandbox["home"] / ".jht").exists()
    assert not (sandbox["home"] / "Documents").exists()
    assert not list(sandbox["runtime"].glob(".*-candidate.*"))
    assert not list(sandbox["runtime"].glob(".*-rollback.*"))


def test_candidate_migration_updates_source_bytes_and_preserves_local_artifacts(
    tmp_path: Path, capable_bash: str
):
    sandbox = _sandbox(tmp_path)
    manifest = sandbox["manifest"]
    before = dict(line.split("=", 1) for line in manifest.read_text().splitlines() if "=" in line)
    result = _publish(capable_bash, sandbox)
    assert result.returncode == 0, result.stderr
    after = dict(line.split("=", 1) for line in manifest.read_text().splitlines() if "=" in line)
    assert after["jht-wrapper.sh"] == _digest(CANDIDATE_WRAPPER)
    assert after["docker-compose.yml"] == _digest(CANDIDATE_COMPOSE)
    assert after["host-setup.sh"] == _digest(CANDIDATE_SETUP)
    for key in ("container-runtime", "podman-machine", "docker-shim"):
        assert after[key] == before[key]
    assert sandbox["wrapper"].stat().st_mode & 0o777 == 0o700
    assert manifest.stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize(
    "failure",
    (
        "installer",
        "wrapper",
        "compose",
        "setup",
        "version",
        "manifest",
        "current-wrapper",
        "stale-shim",
        "partial-manifest",
    ),
)
def test_candidate_migration_rejects_mixed_or_untrusted_bundle_without_publish(
    tmp_path: Path, capable_bash: str, failure: str
):
    sandbox = _sandbox(tmp_path)
    if failure == "manifest":
        sandbox["runtime"].joinpath("container-runtime").write_text("tampered\n")
        overrides = {}
    elif failure == "current-wrapper":
        sandbox["wrapper"].write_text("tampered\n")
        overrides = {}
    elif failure == "stale-shim":
        shim = sandbox["runtime"] / "bin" / "docker"
        shim.write_text("#!/bin/sh\n# JHT_PODMAN_DOCKER_SHIM=1\nexit 7\n")
        shim.chmod(0o700)
        manifest = sandbox["manifest"]
        lines = manifest.read_text().splitlines()
        manifest.write_text(
            "\n".join(
                f"docker-shim={_digest(shim)}" if line.startswith("docker-shim=") else line
                for line in lines
            )
            + "\n"
        )
        overrides = {}
    elif failure == "partial-manifest":
        manifest = sandbox["manifest"]
        manifest.write_text(
            "\n".join(
                line
                for line in manifest.read_text().splitlines()
                if not line.startswith("docker-shim=")
            )
            + "\n"
        )
        overrides = {}
    elif failure == "version":
        overrides = {"version": "9.9.9"}
    else:
        overrides = {failure: "0" * 64}
    before = [path.read_bytes() for path in _published_files(sandbox)]
    result = _publish(capable_bash, sandbox, **overrides)
    assert result.returncode != 0
    assert [path.read_bytes() for path in _published_files(sandbox)] == before
    assert not sandbox["side_effect"].exists()


# The five failure windows x error/term are proven, on every byte of the
# bundle and on the transaction's debris, by
# test_runtime_wrapper_publication_process_boundary.py
# (test_every_process_failure_window_restores_all_previous_bytes).


def test_candidate_migration_rejects_unsafe_permissions_and_noncanonical_paths(
    tmp_path: Path, capable_bash: str
):
    for name, target in (
        ("runtime", "runtime"),
        ("bin", "bin"),
        ("manifest", "manifest"),
        ("wrapper", "wrapper"),
    ):
        unsafe = _sandbox(tmp_path / name)
        path = unsafe["wrapper"].parent if target == "bin" else unsafe[target]
        path.chmod(0o777 if path.is_dir() else 0o666)
        before = [published.read_bytes() for published in _published_files(unsafe)]
        result = _publish(capable_bash, unsafe)
        assert result.returncode != 0
        assert [published.read_bytes() for published in _published_files(unsafe)] == before

    escaped = _sandbox(tmp_path / "escaped")
    rejected_bin = tmp_path / "escaped" / "new" / ".." / "outside"
    escaped["env"] = {**escaped["env"], "JHT_BIN_DIR": str(rejected_bin)}
    result = _publish(capable_bash, escaped)
    assert result.returncode != 0
    assert not (tmp_path / "escaped" / "new").exists()
    assert not (tmp_path / "escaped" / "outside").exists()


def test_candidate_migration_rejects_physical_container_bind_through_home_alias(
    tmp_path: Path, capable_bash: str
):
    sandbox = _sandbox(tmp_path / "case")
    real_home = tmp_path / "real-home"
    real_home.mkdir(mode=0o700)
    alias = tmp_path / "home-alias"
    alias.symlink_to(real_home, target_is_directory=True)
    bind_runtime = real_home / ".jht" / "host-runtime"
    shutil.copytree(sandbox["runtime"], bind_runtime)
    sandbox.update(
        runtime=bind_runtime,
        manifest=bind_runtime / ".runtime-integrity",
        compose=bind_runtime / "docker-compose.yml",
        setup=bind_runtime / "host-setup.sh",
    )
    sandbox["env"] = {**sandbox["env"], "HOME": str(alias), "JHT_RUNTIME_DIR": str(bind_runtime)}
    before = [path.read_bytes() for path in _published_files(sandbox)]
    result = _publish(capable_bash, sandbox)
    assert result.returncode != 0
    assert [path.read_bytes() for path in _published_files(sandbox)] == before
