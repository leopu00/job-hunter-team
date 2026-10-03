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
import subprocess
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
STALE_VALID_WRAPPER = r"""#!/usr/bin/env bash
set -euo pipefail
JHT_UPGRADE_PROTOCOL=1
JHT_HOST_RUNTIME_PROTOCOL=1
JHT_DESKTOP_CHAT_PROTOCOL=1
JHT_ONBOARDING_SNAPSHOT_PROTOCOL=1
DEFAULT_RUNTIME_VERSION="0.3.9"
case "${1:-}" in
  status) printf '%s\n' 'stale wrapper status' ;;
  onboarding-snapshot)
    printf '%s\n' runtimeInstalled=1 containerRunning=0 providerConfigured=0
    ;;
  *) exit 2 ;;
esac
"""
CONTAINER_ID = "a" * 64
CONFIG_HASH = "c" * 64


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


def _install_stale_valid_wrapper(sandbox: dict[str, object]) -> bytes:
    wrapper = sandbox["wrapper"]
    manifest = sandbox["manifest"]
    assert isinstance(wrapper, Path) and isinstance(manifest, Path)
    wrapper.write_text(STALE_VALID_WRAPPER, encoding="utf-8")
    wrapper.chmod(0o700)
    stale_digest = publication._digest(wrapper)
    manifest.write_text(
        "\n".join(
            f"jht-wrapper.sh={stale_digest}"
            if line.startswith("jht-wrapper.sh=")
            else line
            for line in manifest.read_text(encoding="utf-8").splitlines()
        )
        + "\n",
        encoding="utf-8",
    )
    manifest.chmod(0o600)
    return wrapper.read_bytes()


def _install_read_only_runtime_spies(sandbox: dict[str, object], log: Path) -> None:
    runtime = sandbox["runtime"]
    env = sandbox["env"]
    assert isinstance(runtime, Path) and isinstance(env, dict)
    podman = _spy_bin(sandbox) / "podman"
    podman.write_text(
        """#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
with open(os.environ["JHT_EXECUTED_WRAPPER_LOG"], "a", encoding="utf-8") as stream:
    stream.write(json.dumps({"tool": "podman", "args": args}) + "\\n")
if args == ["--version"]:
    print("podman version 6.1.3")
    raise SystemExit(0)
if args[:2] != ["--connection", "jht-podman"]:
    raise SystemExit(91)
args = args[2:]
if args == ["info"]:
    raise SystemExit(0)
if args and args[0] == "inspect":
    if "--format" not in args:
        raise SystemExit(92)
    template = args[args.index("--format") + 1]
    target = args[3] if args[1:3] == ["--type", "container"] else args[1]
    if target != os.environ["JHT_EXECUTED_CONTAINER_ID"]:
        raise SystemExit(93)
    if args[1:3] == ["--type", "container"]:
        print(
            "jht|true|jht|jht|jht|jht|1|"
            + os.environ["JHT_RUNTIME_DIR"]
            + "|"
            + os.environ["JHT_COMPOSE_FILE"]
            + "|1.6.0|podman-compose"
            + "@"
            + "jht.service|"
            + os.environ["JHT_EXECUTED_CONFIG_HASH"]
        )
    elif template == "{{.State.Running}}":
        print("true")
    else:
        print("name=jht status=running started=fixture image=fixture")
    raise SystemExit(0)
if args and args[0] == "exec":
    index = 1
    while args[index] in ("-i", "-t", "-it", "-ti"):
        index += 1
    while args[index] in ("-e", "--env"):
        index += 2
    if args[index] != os.environ["JHT_EXECUTED_CONTAINER_ID"]:
        raise SystemExit(93)
    if "node" in args and "-e" in args:
        print("1 1 1", end="")
    raise SystemExit(0)
Path(os.environ["JHT_RUNTIME_SIDE_EFFECT"]).touch()
raise SystemExit(98)
""",
        encoding="utf-8",
    )
    podman.chmod(0o700)

    compose = _spy_bin(sandbox) / "podman-compose"
    compose.write_text(
        """#!/usr/bin/env python3
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
with open(os.environ["JHT_EXECUTED_WRAPPER_LOG"], "a", encoding="utf-8") as stream:
    stream.write(json.dumps({"tool": "podman-compose", "args": args}) + "\\n")
if args == ["--version"]:
    print("podman-compose version 1.6.0")
    raise SystemExit(0)
dry_run = "--dry-run" in args
index = 0
while index < len(args):
    if args[index] in ("--verbose", "--dry-run"):
        index += 1
    elif args[index] in ("--podman-path", "-p", "--project-name", "-f"):
        index += 2
    else:
        break
command = args[index] if index < len(args) else ""
rest = args[index + 1:]
if command == "ps" and rest == ["-q"]:
    print(os.environ["JHT_EXECUTED_CONTAINER_ID"])
    raise SystemExit(0)
if command == "up" and dry_run:
    print(
        "INFO podman create --label io.podman.compose.config-hash="
        + os.environ["JHT_EXECUTED_CONFIG_HASH"],
        file=sys.stderr,
    )
    raise SystemExit(0)
Path(os.environ["JHT_RUNTIME_SIDE_EFFECT"]).touch()
raise SystemExit(98)
""",
        encoding="utf-8",
    )
    compose.chmod(0o700)
    env.update(
        {
            "JHT_COMPOSE_FILE": str(runtime / "docker-compose.yml"),
            "JHT_EXECUTED_CONTAINER_ID": CONTAINER_ID,
            "JHT_EXECUTED_CONFIG_HASH": CONFIG_HASH,
            "JHT_EXECUTED_WRAPPER_LOG": str(log),
            "JHT_RUNTIME_SIDE_EFFECT": str(sandbox["side_effect"]),
        }
    )


def _run_published_wrapper(
    sandbox: dict[str, object], command: str
) -> subprocess.CompletedProcess[str]:
    wrapper = sandbox["wrapper"]
    env = sandbox["env"]
    assert isinstance(wrapper, Path) and isinstance(env, dict)
    return subprocess.run(
        [str(wrapper), command],
        env=env,
        text=True,
        capture_output=True,
        timeout=15,
        check=False,
    )


def _published_owner_mode(capable_bash: str, wrapper: Path) -> tuple[str, str]:
    result = subprocess.run(
        [
            capable_bash,
            "-c",
            "if [ \"$(uname -s)\" = Darwin ]; then "
            "stat -f '%u %Lp' \"$1\"; else stat -c '%u %a' \"$1\"; fi; id -u",
            "jht-owner-mode",
            str(wrapper),
        ],
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    metadata, current_owner = result.stdout.splitlines()
    owner, mode = metadata.split()
    assert owner == current_owner
    return owner, mode


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


def test_stale_valid_wrapper_is_replaced_and_final_destination_executes(
    tmp_path: Path, capable_bash: str
):
    sandbox = publication._sandbox(tmp_path)
    stale_bytes = _install_stale_valid_wrapper(sandbox)
    wrapper = sandbox["wrapper"]
    manifest = sandbox["manifest"]
    assert isinstance(wrapper, Path) and isinstance(manifest, Path)
    assert stale_bytes != publication.CANDIDATE_WRAPPER.read_bytes()

    result = publication._publish(capable_bash, sandbox)

    assert result.returncode == 0, result.stderr
    assert wrapper.read_bytes() == publication.CANDIDATE_WRAPPER.read_bytes()
    assert wrapper.read_bytes().splitlines()[0] == b"#!/usr/bin/env bash"
    _, mode = _published_owner_mode(capable_bash, wrapper)
    assert mode == "700"
    values = _manifest_values(sandbox)
    assert values["jht-wrapper.sh"] == publication._digest(wrapper)

    process_log = tmp_path / "published-wrapper-processes.jsonl"
    _install_read_only_runtime_spies(sandbox, process_log)
    status = _run_published_wrapper(sandbox, "status")
    snapshot = _run_published_wrapper(sandbox, "onboarding-snapshot")

    assert status.returncode == 0, status.stderr
    assert "name=jht status=running" in status.stdout
    assert snapshot.returncode == 0, snapshot.stderr
    assert "runtimeInstalled=1" in snapshot.stdout
    assert "containerRunning=1" in snapshot.stdout
    assert process_log.is_file()
    assert not sandbox["side_effect"].exists()


@pytest.mark.parametrize("failure_mode", ("error", "term"))
def test_stale_valid_wrapper_is_restored_executable_after_final_rename_failure(
    tmp_path: Path, capable_bash: str, failure_mode: str
):
    sandbox = publication._sandbox(tmp_path)
    stale_bytes = _install_stale_valid_wrapper(sandbox)
    before = _bundle_bytes(sandbox)
    sandbox["env"] = {
        **sandbox["env"],
        "JHT_RUNTIME_PUBLISH_TEST_MODE": "1",
        "JHT_RUNTIME_PUBLISH_FAILPOINT": "after-wrapper-replace",
        "JHT_RUNTIME_PUBLISH_FAILURE": failure_mode,
    }

    result = publication._publish(capable_bash, sandbox)

    assert result.returncode != 0
    assert _bundle_bytes(sandbox) == before
    wrapper = sandbox["wrapper"]
    assert isinstance(wrapper, Path)
    assert wrapper.read_bytes() == stale_bytes
    _, mode = _published_owner_mode(capable_bash, wrapper)
    assert mode == "700"
    assert _run_published_wrapper(sandbox, "status").returncode == 0
    assert _run_published_wrapper(sandbox, "onboarding-snapshot").returncode == 0
    _assert_no_transaction_debris(sandbox)
    assert not sandbox["side_effect"].exists()


@pytest.mark.parametrize("mismatch", ("wrapper-bytes", "manifest-digest"))
def test_exact_candidate_is_idempotent_only_while_bytes_and_manifest_agree(
    tmp_path: Path, capable_bash: str, mismatch: str
):
    sandbox = publication._sandbox(tmp_path)
    _install_stale_valid_wrapper(sandbox)
    first = publication._publish(capable_bash, sandbox)
    assert first.returncode == 0, first.stderr
    exact = _bundle_bytes(sandbox)

    second = publication._publish(capable_bash, sandbox)

    assert second.returncode == 0, second.stderr
    assert _bundle_bytes(sandbox) == exact

    wrapper = sandbox["wrapper"]
    manifest = sandbox["manifest"]
    assert isinstance(wrapper, Path) and isinstance(manifest, Path)
    if mismatch == "wrapper-bytes":
        wrapper.write_text(STALE_VALID_WRAPPER, encoding="utf-8")
        wrapper.chmod(0o700)
    else:
        stale_digest = publication._digest(publication.INSTALLER)
        manifest.write_text(
            "\n".join(
                f"jht-wrapper.sh={stale_digest}"
                if line.startswith("jht-wrapper.sh=")
                else line
                for line in manifest.read_text(encoding="utf-8").splitlines()
            )
            + "\n",
            encoding="utf-8",
        )
    mismatched = _bundle_bytes(sandbox)

    rejected = publication._publish(capable_bash, sandbox)

    assert rejected.returncode != 0
    assert _bundle_bytes(sandbox) == mismatched
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
