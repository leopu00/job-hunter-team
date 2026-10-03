"""Process-boundary harness for transactional runtime bundle migration.

The implementation and its functional contract live in ``install.sh`` and in
``test_runtime_wrapper_publication.py``.  This separate harness executes that
real entrypoint while controlling only filesystem/process dependencies: it
observes publication primitives, interrupts every rename window, and injects
one post-hash artifact swap.
"""

from __future__ import annotations

import os
from pathlib import Path
import shlex
import shutil
from urllib.parse import unquote, urlparse

import pytest

import test_runtime_wrapper_publication as publication


TARGET_KEYS = ("wrapper", "compose", "setup", "manifest")
LOCAL_ARTIFACTS = (
    "container-runtime",
    "podman-machine",
    "bin/docker",
)
FAILPOINTS = (
    "before-manifest-replace",
    "after-manifest-replace",
    "after-compose-replace",
    "before-wrapper-replace",
    "after-wrapper-replace",
)


def _target_bytes(sandbox: dict[str, object]) -> dict[str, bytes]:
    return {
        key: sandbox[key].read_bytes()
        for key in TARGET_KEYS
    }


def _bundle_bytes(sandbox: dict[str, object]) -> dict[str, bytes]:
    runtime = sandbox["runtime"]
    assert isinstance(runtime, Path)
    snapshot = _target_bytes(sandbox)
    snapshot.update(
        {
            relative: runtime.joinpath(relative).read_bytes()
            for relative in LOCAL_ARTIFACTS
        }
    )
    return snapshot


def _assert_no_transaction_debris(sandbox: dict[str, object]) -> None:
    runtime = sandbox["runtime"]
    wrapper = sandbox["wrapper"]
    assert isinstance(runtime, Path) and isinstance(wrapper, Path)
    assert not runtime.joinpath(".publish-runtime.lock").exists()
    assert not list(runtime.glob(".*-candidate.*"))
    assert not list(runtime.glob(".*-rollback.*"))
    assert not list(wrapper.parent.glob(".jht-*.*"))


def _candidate_root(sandbox: dict[str, object]) -> Path:
    env = sandbox["env"]
    assert isinstance(env, dict)
    parsed = urlparse(env["JHT_RAW_BASE"])
    assert parsed.scheme == "file"
    return Path(unquote(parsed.path))


def _spy_bin(sandbox: dict[str, object]) -> Path:
    env = sandbox["env"]
    assert isinstance(env, dict)
    return Path(env["PATH"].split(os.pathsep, 1)[0])


def _write_forwarder(
    sandbox: dict[str, object], command: str, real_command: str, log: Path
) -> None:
    script = _spy_bin(sandbox) / command
    script.write_text(
        "#!/bin/sh\n"
        f"printf '%s\\n' \"$*\" >> {shlex.quote(str(log))}\n"
        f"exec {shlex.quote(real_command)} \"$@\"\n",
        encoding="utf-8",
    )
    script.chmod(0o700)


def _manifest_values(sandbox: dict[str, object]) -> dict[str, str]:
    manifest = sandbox["manifest"]
    assert isinstance(manifest, Path)
    return dict(
        line.split("=", 1)
        for line in manifest.read_text(encoding="utf-8").splitlines()
        if "=" in line
    )


def test_real_entrypoint_fetches_one_candidate_and_atomically_publishes_exact_bytes(
    tmp_path: Path, capable_bash: str
):
    sandbox = publication._sandbox(tmp_path)
    logs = {name: tmp_path / f"{name}.log" for name in ("curl", "cp", "mv")}
    for name, log in logs.items():
        real = shutil.which(name)
        assert real is not None
        _write_forwarder(sandbox, name, real, log)

    result = publication._publish(capable_bash, sandbox)

    assert result.returncode == 0, result.stderr
    assert sandbox["wrapper"].read_bytes() == publication.CANDIDATE_WRAPPER.read_bytes()
    assert sandbox["compose"].read_bytes() == publication.CANDIDATE_COMPOSE.read_bytes()
    assert sandbox["setup"].read_bytes() == publication.CANDIDATE_SETUP.read_bytes()

    values = _manifest_values(sandbox)
    assert set(values) == {
        "version",
        "docker-compose.yml",
        "host-setup.sh",
        "jht-wrapper.sh",
        "container-runtime",
        "podman-machine",
        "docker-shim",
    }
    assert values["version"] == "1"
    assert values["jht-wrapper.sh"] == publication._digest(publication.CANDIDATE_WRAPPER)
    assert values["docker-compose.yml"] == publication._digest(publication.CANDIDATE_COMPOSE)
    assert values["host-setup.sh"] == publication._digest(publication.CANDIDATE_SETUP)
    runtime = sandbox["runtime"]
    assert isinstance(runtime, Path)
    assert values["container-runtime"] == publication._digest(
        runtime / "container-runtime"
    )
    assert values["podman-machine"] == publication._digest(runtime / "podman-machine")
    assert values["docker-shim"] == publication._digest(runtime / "bin/docker")
    assert "JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1" in sandbox["wrapper"].read_text(
        encoding="utf-8"
    )

    candidate = _candidate_root(sandbox).as_uri()
    curl_calls = logs["curl"].read_text(encoding="utf-8").splitlines()
    assert len(curl_calls) == 4
    assert {
        next(field for field in call.split() if field.startswith("file://"))
        for call in curl_calls
    } == {
        f"{candidate}/scripts/install.sh",
        f"{candidate}/scripts/jht-wrapper.sh",
        f"{candidate}/docker-compose.yml",
        f"{candidate}/scripts/host-setup.sh",
    }

    copy_calls = logs["cp"].read_text(encoding="utf-8")
    assert "-candidate." not in copy_calls
    move_calls = logs["mv"].read_text(encoding="utf-8")
    for destination in (
        sandbox["manifest"],
        sandbox["compose"],
        sandbox["setup"],
        sandbox["wrapper"],
    ):
        assert str(destination) in move_calls
    _assert_no_transaction_debris(sandbox)
    assert not sandbox["side_effect"].exists()


@pytest.mark.parametrize(
    "relative",
    (
        "scripts/install.sh",
        "scripts/jht-wrapper.sh",
        "docker-compose.yml",
        "scripts/host-setup.sh",
    ),
)
def test_source_byte_mismatch_denies_the_entire_bundle_without_changes(
    tmp_path: Path, capable_bash: str, relative: str
):
    sandbox = publication._sandbox(tmp_path)
    candidate = _candidate_root(sandbox) / relative
    candidate.write_bytes(candidate.read_bytes() + b"\n# mixed-release byte\n")
    before = _bundle_bytes(sandbox)

    result = publication._publish(capable_bash, sandbox)

    assert result.returncode != 0
    assert _bundle_bytes(sandbox) == before
    _assert_no_transaction_debris(sandbox)
    assert not sandbox["side_effect"].exists()


@pytest.mark.parametrize(
    "corruption",
    ("compose", "host-setup", "shim", "partial-manifest"),
)
def test_mixed_or_partial_attested_baseline_is_rejected_before_publication(
    tmp_path: Path, capable_bash: str, corruption: str
):
    sandbox = publication._sandbox(tmp_path)
    runtime = sandbox["runtime"]
    manifest = sandbox["manifest"]
    assert isinstance(runtime, Path) and isinstance(manifest, Path)
    if corruption == "compose":
        sandbox["compose"].write_bytes(b"production compose mixed into candidate baseline\n")
    elif corruption == "host-setup":
        sandbox["setup"].write_bytes(b"#!/bin/sh\n# production setup mismatch\n")
    elif corruption == "shim":
        runtime.joinpath("bin/docker").write_bytes(b"#!/bin/sh\nexit 99\n")
    else:
        manifest.write_text(
            "\n".join(
                line
                for line in manifest.read_text(encoding="utf-8").splitlines()
                if not line.startswith("host-setup.sh=")
            )
            + "\n",
            encoding="utf-8",
        )
    before = _bundle_bytes(sandbox)

    result = publication._publish(capable_bash, sandbox)

    assert result.returncode != 0
    assert _bundle_bytes(sandbox) == before
    _assert_no_transaction_debris(sandbox)
    assert not sandbox["side_effect"].exists()


@pytest.mark.parametrize("point", FAILPOINTS)
@pytest.mark.parametrize("failure_mode", ("error", "term"))
def test_every_process_failure_window_restores_all_previous_bytes(
    tmp_path: Path, capable_bash: str, point: str, failure_mode: str
):
    sandbox = publication._sandbox(tmp_path)
    before = _bundle_bytes(sandbox)
    sandbox["env"] = {
        **sandbox["env"],
        "JHT_RUNTIME_PUBLISH_TEST_MODE": "1",
        "JHT_RUNTIME_PUBLISH_FAILPOINT": point,
        "JHT_RUNTIME_PUBLISH_FAILURE": failure_mode,
    }

    result = publication._publish(capable_bash, sandbox)

    assert result.returncode != 0
    assert _bundle_bytes(sandbox) == before
    _assert_no_transaction_debris(sandbox)
    assert not sandbox["side_effect"].exists()


def test_existing_publication_lock_is_fail_closed_and_untouched(
    tmp_path: Path, capable_bash: str
):
    sandbox = publication._sandbox(tmp_path)
    runtime = sandbox["runtime"]
    assert isinstance(runtime, Path)
    lock = runtime / ".publish-runtime.lock"
    lock.mkdir(mode=0o700)
    before = _bundle_bytes(sandbox)

    result = publication._publish(capable_bash, sandbox)

    assert result.returncode != 0
    assert _bundle_bytes(sandbox) == before
    assert lock.is_dir()
    assert not list(runtime.glob(".*-candidate.*"))
    assert not list(runtime.glob(".*-rollback.*"))
    assert not sandbox["side_effect"].exists()


def test_artifact_swap_after_publish_hash_is_detected_by_final_bundle_recheck(
    tmp_path: Path, capable_bash: str
):
    sandbox = publication._sandbox(tmp_path)
    compose = sandbox["compose"]
    assert isinstance(compose, Path)
    marker = tmp_path / "compose-swapped"
    counter = tmp_path / "compose-hash-count"
    real_sha = shutil.which("sha256sum")
    if real_sha is not None:
        real_hash_command = shlex.quote(real_sha)
    else:
        real_shasum = shutil.which("shasum")
        assert real_shasum is not None
        real_hash_command = f"{shlex.quote(real_shasum)} -a 256"
    spy = _spy_bin(sandbox) / "sha256sum"
    spy.write_text(
        "#!/bin/sh\n"
        f"{real_hash_command} \"$@\"\n"
        "status=$?\n"
        f"if [ \"${{1:-}}\" = {shlex.quote(str(compose))} ]; then\n"
        f"  count=$(cat {shlex.quote(str(counter))} 2>/dev/null || printf 0)\n"
        "  count=$((count + 1))\n"
        f"  printf '%s\\n' \"$count\" > {shlex.quote(str(counter))}\n"
        "  if [ \"$count\" -eq 2 ]; then\n"
        f"    printf '\\n# post-hash swap\\n' >> {shlex.quote(str(compose))}\n"
        f"    : > {shlex.quote(str(marker))}\n"
        "  fi\n"
        "fi\n"
        "exit \"$status\"\n",
        encoding="utf-8",
    )
    spy.chmod(0o700)
    before_targets = _target_bytes(sandbox)

    result = publication._publish(capable_bash, sandbox)

    assert result.returncode != 0
    assert marker.is_file()
    assert _target_bytes(sandbox) == before_targets
    _assert_no_transaction_debris(sandbox)
    assert not sandbox["side_effect"].exists()
