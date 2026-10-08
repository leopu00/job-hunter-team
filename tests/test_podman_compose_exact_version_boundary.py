"""Regression harness for the supported macOS Podman Compose command plan.

The fixtures model only the external process boundary of podman-compose 1.6.0
and Podman 6.1.3.  The production wrapper, runtime attestation, dispatcher and
subcommands are executed unchanged; no machine, container or default Podman
connection is touched.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
INSTALLER = ROOT / "scripts" / "install.sh"
CONTAINER_ID = "a" * 64
MACHINE = "jht-podman"
PODMAN_UNIT = "podman-compose" + "@" + "jht.service"
PS_Q_CHILD = [
    "ps",
    "-a",
    "--filter",
    "label=io.podman.compose.project=jht",
    "--format",
    "{{.ID}}",
]
PS_UP_CHILD = [
    "ps",
    "-a",
    "--filter",
    "label=io.podman.compose.project=jht",
]
HASH_PROBE_CHILD = [
    "ps",
    "--filter",
    "label=io.podman.compose.project=jht",
    "-a",
    "--format",
    "json",
]
UNTRUSTED_CONTAINER_CASES = (
    ("zero", False),
    ("wrong-name", True),
    ("wrong-io-project", True),
    ("wrong-com-project", True),
    ("upgrade-stage-project", True),
    ("wrong-working-dir", True),
    ("wrong-config-files", True),
    ("wrong-io-service", True),
    ("wrong-com-service", True),
    ("wrong-container-number", True),
    ("wrong-provider-version", True),
    ("wrong-systemd-unit", True),
    ("wrong-config-hash", True),
    ("missing-config-hash", True),
    # Two ids are legitimate since the broker (jht + jht-broker): the foreign
    # one is refused by its inspect, after the hash probe like every other.
    ("duplicate", True),
    ("stale", True),
    ("inspect-failure", True),
)


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_executable(path: Path, source: str) -> None:
    path.write_text(source, encoding="utf-8")
    path.chmod(0o700)


def _runtime(tmp_path: Path) -> tuple[Path, dict[str, str], Path, Path]:
    home = tmp_path / "home"
    runtime = tmp_path / "runtime"
    bin_dir = tmp_path / "bin"
    wrapper = bin_dir / "jht"
    adapter = runtime / "bin" / "docker"
    podman_log = tmp_path / "podman.log"
    compose_log = tmp_path / "podman-compose.log"
    docker_log = tmp_path / "docker.log"
    container_metadata = tmp_path / "container-metadata.json"

    home.mkdir()
    runtime.mkdir(mode=0o700)
    bin_dir.mkdir()
    adapter.parent.mkdir()
    shutil.copy2(WRAPPER, wrapper)
    wrapper.chmod(0o700)

    compose = runtime / "docker-compose.yml"
    compose.write_text(
        "services:\n"
        "  jht:\n"
        "    image: example.invalid/jht@sha256:" + "1" * 64 + "\n"
        "    volumes:\n"
        "      - jht-runtime-mask:/jht_home/runtime\n",
        encoding="utf-8",
    )
    candidate_source = tmp_path / "candidate-compose.yml"
    candidate_source.write_text(
        compose.read_text(encoding="utf-8").replace("1" * 64, "2" * 64)
        + "# candidate-release\n",
        encoding="utf-8",
    )
    setup = runtime / "host-setup.sh"
    setup.write_text("#!/bin/sh\nJHT_HOST_SETUP_PROTOCOL=1\n", encoding="utf-8")
    setup.chmod(0o700)
    selection = runtime / "container-runtime"
    selection.write_text("podman\n", encoding="utf-8")
    machine = runtime / "podman-machine"
    machine.write_text(f"{MACHINE}\n", encoding="utf-8")

    _write_executable(
        adapter,
        """#!/usr/bin/env python3
# JHT_PODMAN_DOCKER_SHIM=1
import json
import os
from pathlib import Path
import sys

args = sys.argv[1:]
with open(os.environ["JHT_FIXTURE_DOCKER_LOG"], "a", encoding="utf-8") as log:
    log.write(
        "connection=" + os.environ.get("CONTAINER_CONNECTION", "")
        + " argv=" + "\\x1f".join(args) + "\\n"
    )
with open(os.environ["JHT_FIXTURE_EVENT_LOG"], "a", encoding="utf-8") as log:
    log.write(
        json.dumps(
            {
                "tool": "docker",
                "connection": os.environ.get("CONTAINER_CONNECTION", ""),
                "args": args,
            }
        )
        + "\\n"
    )
if not args:
    raise SystemExit(92)
if args[0] == "info":
    if os.environ.get("JHT_FIXTURE_REQUIRE_WAKE", "0") == "1":
        raise SystemExit(0 if Path(os.environ["JHT_FIXTURE_RUNTIME_STATE"]).is_file() else 1)
    raise SystemExit(0)
if args[0] == "ps":
    if Path(os.environ["JHT_FIXTURE_CONTAINER_METADATA"]).is_file():
        print("jht")
    raise SystemExit(0)
case = os.environ.get("JHT_FIXTURE_CONTAINER_CASE", "valid")
expected_id = (
    os.environ["JHT_FIXTURE_FOREIGN_CONTAINER_ID"]
    if case.startswith("wrong-")
    else os.environ["JHT_FIXTURE_CONTAINER_ID"]
)
metadata_path = Path(os.environ["JHT_FIXTURE_CONTAINER_METADATA"])
if args[0] == "exec":
    target_index = 1
    while target_index < len(args):
        if args[target_index] in ("-i", "-t", "-it", "-ti"):
            target_index += 1
            continue
        if args[target_index] in ("-e", "--env", "-u", "--user", "-w", "--workdir"):
            target_index += 2
            continue
        break
    if (
        target_index >= len(args)
        or args[target_index] != expected_id
        or not metadata_path.is_file()
    ):
        raise SystemExit(95)
    if args[-1] == "--version":
        print("0.4.0")
    elif "node" in args and "-e" in args:
        print("1 1 1", end="")
    raise SystemExit(0)
if args[0] == "logs":
    if len(args) < 2 or args[-1] != expected_id or not metadata_path.is_file():
        raise SystemExit(95)
    print("fixture log")
    raise SystemExit(0)
if args[0] == "cp":
    if (
        len(args) != 3
        or not args[1].startswith(expected_id + ":")
        or not metadata_path.is_file()
    ):
        raise SystemExit(95)
    Path(args[2]).write_bytes(b"attested fixture download\\n")
    raise SystemExit(0)
if args[0:2] == ["image", "inspect"]:
    expected = "example.invalid/jht@sha256:" + os.environ["JHT_FIXTURE_IMAGE_DIGEST"]
    if len(args) < 3 or args[2] != expected:
        raise SystemExit(93)
    print("sha256:" + os.environ["JHT_FIXTURE_IMAGE_DIGEST"])
    raise SystemExit(0)
if args[0] != "inspect" or len(args) < 2:
    raise SystemExit(92)
target_index = 3 if args[1:3] == ["--type", "container"] else 1
try:
    target = args[target_index]
except IndexError:
    raise SystemExit(92)
if target != expected_id or case == "inspect-failure":
    raise SystemExit(91)
try:
    template = args[args.index("--format") + 1]
except (ValueError, IndexError):
    raise SystemExit(94)
metadata = {
    "name": "jht",
    "running": "true",
    "io_project": os.environ["JHT_FIXTURE_PROJECT"],
    "com_project": os.environ["JHT_FIXTURE_PROJECT"],
    "working_dir": os.environ["JHT_RUNTIME_DIR"],
    "config_files": os.environ["JHT_COMPOSE_FILE"],
    "io_service": "jht",
    "com_service": "jht",
    "container_number": "1",
    "provider_version": "1.6.0",
    "systemd_unit": "podman-compose" + "@" + "jht.service",
    "config_hash": os.environ["JHT_FIXTURE_CONFIG_HASH"],
}
if metadata_path.is_file():
    metadata.update(json.loads(metadata_path.read_text(encoding="utf-8")))
case_overrides = {
    "wrong-name": ("name", "foreign"),
    "wrong-io-project": ("io_project", "foreign-project"),
    "wrong-com-project": ("com_project", "foreign-project"),
    "wrong-working-dir": ("working_dir", "/foreign/workdir"),
    "wrong-config-files": ("config_files", "/foreign/compose.yml"),
    "wrong-io-service": ("io_service", "foreign-service"),
    "wrong-com-service": ("com_service", "foreign-service"),
    "wrong-container-number": ("container_number", "2"),
    "wrong-provider-version": ("provider_version", "1.7.0"),
    "wrong-systemd-unit": (
        "systemd_unit",
        "podman-compose" + "@" + "foreign.service",
    ),
    "wrong-config-hash": ("config_hash", "d" * 64),
    "missing-config-hash": ("config_hash", ""),
    "stale": ("running", "false"),
}
if case in case_overrides:
    key, value = case_overrides[case]
    metadata[key] = value
if case == "upgrade-stage-project":
    metadata["io_project"] = ".upgrade-stage.fixture"
    metadata["com_project"] = ".upgrade-stage.fixture"
values = {
    "{{.Name}}": metadata["name"],
    "{{.State.Running}}": metadata["running"],
    "{{.State.Status}}": "running" if metadata["running"] == "true" else "exited",
    "{{.State.StartedAt}}": "2026-10-03T00:00:00Z",
    "{{.Config.Image}}": "example.invalid/jht@sha256:" + metadata["image_digest"],
    "{{.Image}}": "sha256:" + metadata["image_digest"],
    '{{index .Config.Labels "io.podman.compose.project"}}': metadata["io_project"],
    '{{index .Config.Labels "com.docker.compose.project"}}': metadata["com_project"],
    '{{index .Config.Labels "com.docker.compose.project.working_dir"}}': metadata["working_dir"],
    '{{index .Config.Labels "com.docker.compose.project.config_files"}}': metadata["config_files"],
    '{{index .Config.Labels "io.podman.compose.service"}}': metadata["io_service"],
    '{{index .Config.Labels "com.docker.compose.service"}}': metadata["com_service"],
    '{{index .Config.Labels "com.docker.compose.container-number"}}': metadata["container_number"],
    '{{index .Config.Labels "io.podman.compose.version"}}': metadata["provider_version"],
    '{{index .Config.Labels "PODMAN_SYSTEMD_UNIT"}}': metadata["systemd_unit"],
    '{{index .Config.Labels "io.podman.compose.config-hash"}}': metadata["config_hash"],
}
for token, value in values.items():
    template = template.replace(token, value)
print(template)
""",
    )

    # podman-compose 1.6.0 places --podman-args after each Podman subcommand.
    # That historical behavior is the compatibility edge under test: a global
    # --connection there is invalid for Podman 6.1.3 and exits 125.
    _write_executable(
        bin_dir / "podman-compose",
        """#!/usr/bin/env python3
import os
import json
import hashlib
from pathlib import Path
import subprocess
import sys

VERSION = "1.6.0"
args = sys.argv[1:]
with open(os.environ["JHT_FIXTURE_COMPOSE_LOG"], "a", encoding="utf-8") as log:
    log.write("connection=" + os.environ.get("CONTAINER_CONNECTION", "") + " argv=" + "\\x1f".join(args) + "\\n")
with open(os.environ["JHT_FIXTURE_EVENT_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps({"tool": "podman-compose", "args": args}) + "\\n")
if args == ["--version"] or args == ["version"]:
    print(f"podman-compose version {os.environ.get('JHT_FIXTURE_COMPOSE_VERSION', VERSION)}")
    raise SystemExit(0)

podman = "podman"
podman_args = []
compose_file = ""
project = ""
dry_run = False
index = 0
while index < len(args):
    arg = args[index]
    if arg in ("--verbose", "--dry-run"):
        if arg == "--dry-run":
            dry_run = True
        index += 1
        continue
    if arg in ("--podman-path", "--podman-args", "-f", "-p", "--project-name"):
        if index + 1 >= len(args):
            raise SystemExit(2)
        value = args[index + 1]
        if arg == "--podman-path":
            podman = value
        elif arg == "--podman-args":
            podman_args = value.split()
        elif arg == "-f":
            compose_file = value
        else:
            project = value
        index += 2
        continue
    break

if index >= len(args):
    raise SystemExit(2)
command = args[index]
rest = args[index + 1:]
if not project:
    project = Path(compose_file).resolve().parent.name.lower()

def run_podman(subcommand, *tail):
    # Exact 1.6.0 edge: custom podman args are appended after the subcommand.
    return subprocess.run([podman, subcommand, *podman_args, *tail], check=False)

if command == "ps":
    # 1.6.0 accepts ps options but no Docker-Compose-style service operand.
    if any(not value.startswith("-") for value in rest):
        raise SystemExit(2)
    raise SystemExit(
        run_podman(
            "ps",
            "-a",
            "--filter",
            "label=io.podman.compose.project=" + project,
            "--format",
            "{{.ID}}",
        ).returncode
    )
if command == "config" and rest == ["-q"]:
    raise SystemExit(0)
if command == "config" and rest == ["--images"]:
    print("example.invalid/jht@sha256:" + os.environ["JHT_FIXTURE_IMAGE_DIGEST"])
    raise SystemExit(0)
if command == "pull" and rest == ["jht"]:
    raise SystemExit(run_podman("pull", "jht").returncode)
if command == "up" and dry_run and rest and rest[0] == "-d":
    probe = run_podman(
        "ps",
        "--filter",
        "label=io.podman.compose.project=" + project,
        "-a",
        "--format",
        "json",
    )
    if probe.returncode:
        raise SystemExit(probe.returncode)
    config_hash = (
        os.environ["JHT_FIXTURE_CANDIDATE_CONFIG_HASH"]
        if "# candidate-release" in Path(compose_file).read_text(encoding="utf-8")
        else os.environ["JHT_FIXTURE_CONFIG_HASH"]
    )
    print(
        "INFO podman create --label io.podman.compose.config-hash="
        + config_hash
        + " --label next=value",
        file=sys.stderr,
    )
    raise SystemExit(0)
if command == "up" and rest and rest[0] == "-d":
    probe = run_podman(
        "ps", "-a", "--filter", "label=io.podman.compose.project=" + project
    )
    if probe.returncode:
        raise SystemExit(probe.returncode)
    created = run_podman("create", "jht")
    if created.returncode:
        raise SystemExit(created.returncode)
    Path(os.environ["JHT_FIXTURE_CONTAINER_METADATA"]).write_text(
        json.dumps(
            {
                "name": "jht",
                "running": "true",
                "io_project": project,
                "com_project": project,
                "working_dir": str(Path(compose_file).resolve().parent),
                "config_files": str(Path(compose_file).resolve()),
                "io_service": "jht",
                "com_service": "jht",
                "container_number": "1",
                "provider_version": "1.6.0",
                "systemd_unit": "podman-compose" + "@" + "jht.service",
                "config_hash": (
                    os.environ["JHT_FIXTURE_CANDIDATE_CONFIG_HASH"]
                    if "# candidate-release" in Path(compose_file).read_text(encoding="utf-8")
                    else os.environ["JHT_FIXTURE_CONFIG_HASH"]
                ),
                "image_digest": (
                    os.environ["JHT_FIXTURE_IMAGE_DIGEST"]
                    if "# candidate-release" in Path(compose_file).read_text(encoding="utf-8")
                    else "1" * 64
                ),
                "compose_digest": hashlib.sha256(Path(compose_file).read_bytes()).hexdigest(),
            }
        ),
        encoding="utf-8",
    )
    raise SystemExit(0)
raise SystemExit(2)
""",
    )

    _write_executable(
        bin_dir / "podman",
        """#!/usr/bin/env python3
import os
import json
from pathlib import Path
import sys

VERSION = "6.1.3"
args = sys.argv[1:]
with open(os.environ["JHT_FIXTURE_EVENT_LOG"], "a", encoding="utf-8") as log:
    log.write(json.dumps({"tool": "podman", "args": args}) + "\\n")
if args == ["--version"] or args == ["version"]:
    with open(os.environ["JHT_FIXTURE_PODMAN_LOG"], "a", encoding="utf-8") as log:
        log.write("connection=" + os.environ.get("CONTAINER_CONNECTION", "") + " argv=" + "\\x1f".join(args) + "\\n")
    print(f"podman version {os.environ.get('JHT_FIXTURE_PODMAN_VERSION', VERSION)}")
    raise SystemExit(0)

connection = os.environ.get("CONTAINER_CONNECTION", "")
with open(os.environ["JHT_FIXTURE_PODMAN_LOG"], "a", encoding="utf-8") as log:
    log.write(
        "connection=" + connection + " argv=" + "\\x1f".join(args) + "\\n"
    )
if not args:
    raise SystemExit(125)
command, tail = args[0], args[1:]
if args == ["--connection", os.environ["JHT_FIXTURE_MACHINE"], "info"]:
    if connection:
        raise SystemExit(125)
    if os.environ.get("JHT_FIXTURE_NAMED_CONNECTION_SUPPORTED", "1") != "1":
        raise SystemExit(125)
    raise SystemExit(0)
if command == "machine" and tail == ["start", "--update-connection=false", os.environ["JHT_FIXTURE_MACHINE"]]:
    if connection:
        raise SystemExit(125)
    Path(os.environ["JHT_FIXTURE_RUNTIME_STATE"]).write_text("ready\\n")
    raise SystemExit(0)
if "--connection" in tail:
    # Podman global options are forbidden after the subcommand.
    raise SystemExit(125)
if connection != os.environ["JHT_FIXTURE_MACHINE"]:
    raise SystemExit(125)
if os.environ.get("JHT_FIXTURE_NAMED_CONNECTION_SUPPORTED", "1") != "1":
    raise SystemExit(125)
if command == "ps":
    if "--format" in tail and "json" in tail:
        print("[]")
    elif "--format" in tail and "{{.ID}}" in tail:
        case = os.environ.get("JHT_FIXTURE_CONTAINER_CASE", "valid")
        if case == "zero":
            if Path(os.environ["JHT_FIXTURE_CREATE_MARKER"]).is_file():
                print(os.environ["JHT_FIXTURE_CONTAINER_ID"])
        elif case.startswith("wrong-"):
            print(os.environ["JHT_FIXTURE_FOREIGN_CONTAINER_ID"])
        elif case == "duplicate":
            print(os.environ["JHT_FIXTURE_CONTAINER_ID"])
            print(os.environ["JHT_FIXTURE_FOREIGN_CONTAINER_ID"])
        else:
            print(os.environ["JHT_FIXTURE_CONTAINER_ID"])
    raise SystemExit(0)
if command in ("create", "pull"):
    if command == "pull":
        raise SystemExit(0)
    Path(os.environ["JHT_FIXTURE_CREATE_MARKER"]).write_text("created\\n")
    raise SystemExit(0)
raise SystemExit(125)
""",
    )

    _write_executable(
        bin_dir / "curl",
        """#!/bin/sh
set -eu
url=''
out=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
case "$url" in
  */docker-compose.yml) cp "$JHT_FIXTURE_CANDIDATE_COMPOSE" "$out" ;;
  */scripts/jht-wrapper.sh) cp "$JHT_FIXTURE_CANDIDATE_WRAPPER" "$out" ;;
  *) exit 22 ;;
esac
""",
    )
    _write_executable(bin_dir / "brew", "#!/bin/sh\nexit 97\n")

    for path in (compose, selection, machine):
        path.chmod(0o600)
    manifest = runtime / ".runtime-integrity"
    manifest.write_text(
        "\n".join(
            (
                "version=1",
                f"docker-compose.yml={_digest(compose)}",
                f"host-setup.sh={_digest(setup)}",
                f"jht-wrapper.sh={_digest(wrapper)}",
                f"container-runtime={_digest(selection)}",
                f"podman-machine={_digest(machine)}",
                f"docker-shim={_digest(adapter)}",
                "",
            )
        ),
        encoding="utf-8",
    )
    manifest.chmod(0o600)

    create_marker = tmp_path / "container-created"
    container_metadata.write_text(
        json.dumps(
            {
                "name": "jht",
                "running": "true",
                "io_project": "jht",
                "com_project": "jht",
                "working_dir": str(runtime),
                "config_files": str(compose),
                "io_service": "jht",
                "com_service": "jht",
                "container_number": "1",
                "provider_version": "1.6.0",
                "systemd_unit": PODMAN_UNIT,
                "config_hash": "c" * 64,
                "image_digest": "1" * 64,
                "compose_digest": _digest(compose),
            }
        ),
        encoding="utf-8",
    )
    env = {
        **os.environ,
        "HOME": str(home),
        "PATH": f"{bin_dir}:/usr/bin:/bin",
        "JHT_RUNTIME_DIR": str(runtime),
        "JHT_COMPOSE_FILE": str(compose),
        "JHT_WRAPPER_PATH": str(wrapper),
        "JHT_FIXTURE_COMPOSE_LOG": str(compose_log),
        "JHT_FIXTURE_PODMAN_LOG": str(podman_log),
        "JHT_FIXTURE_DOCKER_LOG": str(docker_log),
        "JHT_FIXTURE_EVENT_LOG": str(tmp_path / "process-events.jsonl"),
        "JHT_FIXTURE_CREATE_MARKER": str(create_marker),
        "JHT_FIXTURE_RUNTIME_STATE": str(tmp_path / "runtime-ready"),
        "JHT_FIXTURE_CONTAINER_ID": CONTAINER_ID,
        "JHT_FIXTURE_FOREIGN_CONTAINER_ID": "b" * 64,
        "JHT_FIXTURE_CONTAINER_METADATA": str(container_metadata),
        "JHT_FIXTURE_CONFIG_HASH": "c" * 64,
        "JHT_FIXTURE_CANDIDATE_CONFIG_HASH": "e" * 64,
        "JHT_FIXTURE_MACHINE": MACHINE,
        "JHT_FIXTURE_PROJECT": "jht",
        "JHT_FIXTURE_IMAGE_DIGEST": "2" * 64,
        "JHT_FIXTURE_CANDIDATE_COMPOSE": str(candidate_source),
        "JHT_FIXTURE_CANDIDATE_WRAPPER": str(WRAPPER),
        "JHT_RAW_BASE": f"file://{tmp_path / 'candidate'}",
        "JHT_BIN_DIR": str(tmp_path / "installer-bin"),
        "JHT_INSTALLER_SOURCE_ONLY": "1",
    }
    env.pop("CONTAINER_CONNECTION", None)
    return wrapper, env, podman_log, create_marker


def _run(wrapper: Path, env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(wrapper), *args],
        env=env,
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )


def _run_installer_podman_preflight(
    env: dict[str, str],
) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            "/bin/bash",
            "-c",
            'source "$JHT_FIXTURE_INSTALLER"; install_podman_macos',
        ],
        env={**env, "JHT_FIXTURE_INSTALLER": str(INSTALLER)},
        text=True,
        capture_output=True,
        timeout=10,
        check=False,
    )


def _podman_calls(log: Path) -> list[tuple[str, list[str]]]:
    calls = []
    if not log.exists():
        return calls
    for line in log.read_text(encoding="utf-8").splitlines():
        connection, argv = line.split(" argv=", 1)
        calls.append((connection.removeprefix("connection="), argv.split("\x1f")))
    return calls


def _compose_calls(env: dict[str, str]) -> list[tuple[str, list[str]]]:
    log = Path(env["JHT_FIXTURE_COMPOSE_LOG"])
    if not log.exists():
        return []
    calls = []
    for line in log.read_text(encoding="utf-8").splitlines():
        connection, argv = line.split(" argv=", 1)
        calls.append((connection.removeprefix("connection="), argv.split("\x1f")))
    return calls


def _actual_compose_calls(env: dict[str, str]) -> list[tuple[str, list[str]]]:
    return [
        (connection, args)
        for connection, args in _compose_calls(env)
        if args not in (["--version"], ["version"])
    ]


def _actual_podman_calls(log: Path) -> list[tuple[str, list[str]]]:
    return [
        (connection, args)
        for connection, args in _podman_calls(log)
        if args not in (["--version"], ["version"])
    ]


def _provider_podman_calls(log: Path) -> list[tuple[str, list[str]]]:
    return [
        (connection, args)
        for connection, args in _actual_podman_calls(log)
        if args and args[0] in ("ps", "create", "pull")
    ]


def _direct_podman_calls(log: Path) -> list[tuple[str, list[str]]]:
    return [
        (connection, args)
        for connection, args in _podman_calls(log)
        if not (args and args[0] in ("ps", "create", "pull"))
    ]


def _assert_only_podman_path_option(calls: list[tuple[str, list[str]]]) -> None:
    for _, args in calls:
        podman_options = [arg for arg in args if arg.startswith("--podman-")]
        assert podman_options in ([], ["--podman-path"])


def _assert_literal_project(calls: list[tuple[str, list[str]]]) -> None:
    for _, args in calls:
        option = "-p" if "-p" in args else "--project-name"
        assert option in args
        assert args[args.index(option) + 1] == "jht"


def _docker_calls(env: dict[str, str]) -> list[tuple[str, list[str]]]:
    return [
        (str(event["connection"]), list(event["args"]))
        for event in _events(env)
        if event["tool"] == "docker"
    ]


def _docker_runtime_target(args: list[str]) -> str | None:
    if not args:
        return None
    if args[0] == "inspect":
        index = 3 if args[1:3] == ["--type", "container"] else 1
        return args[index] if index < len(args) else None
    if args[0] == "logs":
        return args[-1] if len(args) > 1 else None
    if args[0] == "cp":
        return args[1].split(":", 1)[0] if len(args) > 1 else None
    if args[0] != "exec":
        return None
    index = 1
    while index < len(args):
        if args[index] in ("-i", "-t", "-it", "-ti"):
            index += 1
            continue
        if args[index] in ("-e", "--env", "-u", "--user", "-w", "--workdir"):
            index += 2
            continue
        return args[index]
    return None


def _events(env: dict[str, str]) -> list[dict[str, object]]:
    log = Path(env["JHT_FIXTURE_EVENT_LOG"])
    if not log.exists():
        return []
    return [json.loads(line) for line in log.read_text(encoding="utf-8").splitlines()]


def _assert_hash_probes_are_read_only(env: dict[str, str]) -> None:
    events = _events(env)
    probe_indexes = [
        index
        for index, event in enumerate(events)
        if event["tool"] == "podman-compose"
        and "--dry-run" in event["args"]
    ]
    assert probe_indexes
    for index in probe_indexes:
        assert events[index + 1]["tool"] == "podman"
        assert events[index + 1]["args"] == HASH_PROBE_CHILD


def _attest_machine(env: dict[str, str], value: str) -> None:
    runtime = Path(env["JHT_RUNTIME_DIR"])
    machine = runtime / "podman-machine"
    machine.write_text(value, encoding="utf-8")
    machine.chmod(0o600)
    manifest = runtime / ".runtime-integrity"
    lines = manifest.read_text(encoding="utf-8").splitlines()
    manifest.write_text(
        "\n".join(
            f"podman-machine={_digest(machine)}"
            if line.startswith("podman-machine=")
            else line
            for line in lines
        )
        + "\n",
        encoding="utf-8",
    )
    manifest.chmod(0o600)


@pytest.mark.parametrize("inherited_connection", [None, "user-default-machine"])
@pytest.mark.parametrize("machine_override", [None, MACHINE])
def test_exact_supported_versions_use_named_connection_for_real_ps_and_up(
    tmp_path: Path,
    inherited_connection: str | None,
    machine_override: str | None,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    if inherited_connection is None:
        env.pop("CONTAINER_CONNECTION", None)
    else:
        env["CONTAINER_CONNECTION"] = inherited_connection
    if machine_override is not None:
        env["JHT_PODMAN_MACHINE"] = machine_override

    podman_version = subprocess.run(
        ["podman", "--version"], env=env, text=True, capture_output=True, check=False
    )
    compose_version = subprocess.run(
        ["podman-compose", "--version"],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert podman_version.stdout.strip() == "podman version 6.1.3"
    assert compose_version.stdout.strip() == "podman-compose version 1.6.0"
    podman_log.unlink()
    Path(env["JHT_FIXTURE_COMPOSE_LOG"]).unlink()

    probe = _run(wrapper, env, "desktop-chat", "probe")
    up = _run(wrapper, env, "up")

    assert probe.returncode == 0, probe.stderr
    assert probe.stdout == "true\n"
    assert up.returncode == 0, up.stderr
    assert create_marker.read_text(encoding="utf-8") == "created\n"
    assert any(args == ["--version"] for _, args in _compose_calls(env))
    _assert_only_podman_path_option(_compose_calls(env))
    assert all(connection == MACHINE for connection, _ in _compose_calls(env))
    _assert_literal_project(_actual_compose_calls(env))
    calls = _provider_podman_calls(podman_log)
    assert [args for _, args in calls] == [
        PS_Q_CHILD,
        HASH_PROBE_CHILD,
        PS_Q_CHILD,
        HASH_PROBE_CHILD,
        PS_UP_CHILD,
        ["create", "jht"],
        PS_Q_CHILD,
        HASH_PROBE_CHILD,
    ]
    assert all(connection == MACHINE for connection, _ in calls)
    direct_calls = _direct_podman_calls(podman_log)
    assert direct_calls
    assert all(connection == "" for connection, _ in direct_calls)
    assert any(
        args == ["--connection", MACHINE, "info"] for _, args in direct_calls
    )
    assert all(
        not any(arg == "--connection" or arg.startswith("--connection=") for arg in args[1:])
        for _, args in calls
    )
    _assert_hash_probes_are_read_only(env)
    docker_calls = _docker_calls(env)
    assert any(args and args[0] == "info" for _, args in docker_calls)
    assert any(args and args[0] == "inspect" for _, args in docker_calls)
    assert all(connection == "" for connection, _ in docker_calls)
    inspect = [args for _, args in docker_calls if args and args[0] == "inspect"]
    assert len(inspect) == 3
    for inspect_call in inspect:
        assert inspect_call[1:3] == ["--type", "container"]
        inspect_argv = " ".join(inspect_call)
        for field in (
            ".Name",
            "io.podman.compose.project",
            "com.docker.compose.project",
            "com.docker.compose.project.working_dir",
            "com.docker.compose.project.config_files",
            "io.podman.compose.service",
            "com.docker.compose.service",
            "com.docker.compose.container-number",
            "io.podman.compose.version",
            "PODMAN_SYSTEMD_UNIT",
            "io.podman.compose.config-hash",
        ):
            assert field in inspect_argv


def test_exact_1_6_fixture_accepts_ps_q_and_rejects_service_operand(tmp_path: Path):
    _, env, podman_log, create_marker = _runtime(tmp_path)
    compose_file = Path(env["JHT_RUNTIME_DIR"]) / "docker-compose.yml"
    common = [
        "podman-compose",
        "--podman-path",
        "podman",
        "-f",
        str(compose_file),
        "-p",
        "jht",
        "ps",
        "-q",
    ]
    provider_env = {**env, "CONTAINER_CONNECTION": MACHINE}

    accepted = subprocess.run(
        common,
        env=provider_env,
        text=True,
        capture_output=True,
        check=False,
    )
    rejected = subprocess.run(
        [*common, "jht"],
        env=provider_env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert accepted.returncode == 0
    assert accepted.stdout.strip() == CONTAINER_ID
    assert rejected.returncode == 2
    assert not create_marker.exists()
    assert _provider_podman_calls(podman_log) == [(MACHINE, PS_Q_CHILD)]


def test_exact_1_6_dry_run_hash_probe_executes_only_read_only_podman_output(
    tmp_path: Path,
):
    _, env, podman_log, create_marker = _runtime(tmp_path)
    compose_file = Path(env["JHT_COMPOSE_FILE"])
    provider_env = {**env, "CONTAINER_CONNECTION": MACHINE}

    result = subprocess.run(
        [
            "podman-compose",
            "--verbose",
            "--dry-run",
            "--project-name",
            "jht",
            "--podman-path",
            "podman",
            "-f",
            str(compose_file),
            "up",
            "-d",
            "--force-recreate",
            "jht",
        ],
        env=provider_env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert f"io.podman.compose.config-hash={env['JHT_FIXTURE_CONFIG_HASH']}" in result.stderr
    assert _provider_podman_calls(podman_log) == [(MACHINE, HASH_PROBE_CHILD)]
    assert not create_marker.exists()
    _assert_hash_probes_are_read_only(env)


def test_exact_1_6_rejects_connection_injected_after_ps_with_exit_125(
    tmp_path: Path,
):
    _, env, podman_log, create_marker = _runtime(tmp_path)
    provider_env = {**env, "CONTAINER_CONNECTION": MACHINE}

    result = subprocess.run(
        [
            "podman-compose",
            "--podman-path",
            "podman",
            "--podman-args",
            f"--connection {MACHINE}",
            "-f",
            env["JHT_COMPOSE_FILE"],
            "-p",
            "jht",
            "ps",
            "-q",
        ],
        env=provider_env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 125
    assert not create_marker.exists()
    assert _provider_podman_calls(podman_log) == [
        (
            MACHINE,
            [
                "ps",
                "--connection",
                MACHINE,
                "-a",
                "--filter",
                "label=io.podman.compose.project=jht",
                "--format",
                "{{.ID}}",
            ],
        )
    ]


@pytest.mark.parametrize(
    ("container_case", "inspect_expected"),
    UNTRUSTED_CONTAINER_CASES,
)
def test_read_only_ps_rejects_unowned_ambiguous_or_stale_ids_without_create(
    tmp_path: Path,
    container_case: str,
    inspect_expected: bool,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["CONTAINER_CONNECTION"] = "user-default-machine"
    env["JHT_FIXTURE_CONTAINER_CASE"] = container_case

    result = _run(wrapper, env, "desktop-chat", "probe")

    assert result.returncode != 0
    assert not create_marker.exists()
    expected_provider_calls = [(MACHINE, PS_Q_CHILD)]
    if inspect_expected:
        expected_provider_calls.append((MACHINE, HASH_PROBE_CHILD))
    assert _provider_podman_calls(podman_log) == expected_provider_calls
    assert all(connection == "" for connection, _ in _direct_podman_calls(podman_log))
    assert not any(args and args[0] == "machine" for _, args in _podman_calls(podman_log))
    compose_calls = _actual_compose_calls(env)
    _assert_literal_project(compose_calls)
    ps_calls = [call for call in compose_calls if call[1][-2:] == ["ps", "-q"]]
    assert len(ps_calls) == 1
    assert ps_calls[0][0] == MACHINE
    docker_calls = _docker_calls(env)
    inspect_calls = [args for _, args in docker_calls if args and args[0] == "inspect"]
    assert bool(inspect_calls) is inspect_expected
    assert all(connection == "" for connection, _ in docker_calls)
    if inspect_expected:
        _assert_hash_probes_are_read_only(env)


@pytest.mark.parametrize(
    ("container_case", "inspect_expected"),
    tuple(case for case in UNTRUSTED_CONTAINER_CASES if case[0] != "zero"),
)
def test_up_rejects_untrusted_existing_container_before_any_mutation(
    tmp_path: Path,
    container_case: str,
    inspect_expected: bool,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = container_case

    result = _run(wrapper, env, "up")

    assert result.returncode != 0
    assert not create_marker.exists()
    expected_provider_calls = [(MACHINE, PS_Q_CHILD)]
    if inspect_expected:
        expected_provider_calls.append((MACHINE, HASH_PROBE_CHILD))
    assert _provider_podman_calls(podman_log) == expected_provider_calls
    compose_calls = _actual_compose_calls(env)
    _assert_literal_project(compose_calls)
    ps_calls = [call for call in compose_calls if call[1][-2:] == ["ps", "-q"]]
    assert len(ps_calls) == 1
    assert not any("up" in args and "--dry-run" not in args for _, args in compose_calls)
    inspect_calls = [
        args
        for _, args in _docker_calls(env)
        if args and args[0] == "inspect"
    ]
    assert bool(inspect_calls) is inspect_expected
    if inspect_expected:
        _assert_hash_probes_are_read_only(env)


def test_up_creates_only_when_precheck_finds_no_existing_project_container(
    tmp_path: Path,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = "zero"

    result = _run(wrapper, env, "up")

    assert result.returncode == 0, result.stderr
    assert create_marker.read_text(encoding="utf-8") == "created\n"
    assert [args for _, args in _provider_podman_calls(podman_log)] == [
        PS_Q_CHILD,
        PS_UP_CHILD,
        ["create", "jht"],
        PS_Q_CHILD,
        HASH_PROBE_CHILD,
    ]
    inspect_calls = [
        args
        for _, args in _docker_calls(env)
        if args and args[0] == "inspect"
    ]
    assert len(inspect_calls) == 1
    assert ".Name" in " ".join(inspect_calls[0])
    _assert_hash_probes_are_read_only(env)


def test_literal_project_does_not_adopt_a_stage_compose_container(tmp_path: Path):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    runtime = Path(env["JHT_RUNTIME_DIR"])
    stage = runtime / ".upgrade-stage.fixture"
    stage.mkdir()
    stage_compose = stage / "docker-compose.yml"
    shutil.copy2(env["JHT_COMPOSE_FILE"], stage_compose)
    provider_env = {**env, "CONTAINER_CONNECTION": MACHINE}

    staged_up = subprocess.run(
        [
            "podman-compose",
            "--podman-path",
            "podman",
            "-f",
            str(stage_compose),
            "-p",
            "jht",
            "up",
            "-d",
            "--force-recreate",
            "jht",
        ],
        env=provider_env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert staged_up.returncode == 0, staged_up.stderr
    assert create_marker.exists()
    metadata = json.loads(
        Path(env["JHT_FIXTURE_CONTAINER_METADATA"]).read_text(encoding="utf-8")
    )
    assert metadata["io_project"] == metadata["com_project"] == "jht"
    assert metadata["working_dir"] == str(stage)
    assert metadata["config_files"] == str(stage_compose)
    assert metadata["config_hash"] == env["JHT_FIXTURE_CONFIG_HASH"]

    creates_before_probe = sum(
        args == ["create", "jht"] for _, args in _provider_podman_calls(podman_log)
    )
    result = _run(wrapper, env, "desktop-chat", "probe")

    assert result.returncode != 0
    assert sum(
        args == ["create", "jht"] for _, args in _provider_podman_calls(podman_log)
    ) == creates_before_probe
    assert any(
        args == PS_Q_CHILD for _, args in _provider_podman_calls(podman_log)
    )


def test_named_connection_incompatibility_propagates_125_without_create(
    tmp_path: Path,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_NAMED_CONNECTION_SUPPORTED"] = "0"

    result = _run(wrapper, env, "up")

    assert result.returncode != 0
    assert not create_marker.exists()
    assert _provider_podman_calls(podman_log) == []
    assert _actual_compose_calls(env) == []
    assert ("", ["--connection", MACHINE, "info"]) in _direct_podman_calls(
        podman_log
    )


def test_read_only_ps_fails_closed_without_create_on_connection_incompatibility(
    tmp_path: Path,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_NAMED_CONNECTION_SUPPORTED"] = "0"

    result = _run(wrapper, env, "desktop-chat", "probe")

    assert result.returncode != 0
    assert not create_marker.exists()
    assert _provider_podman_calls(podman_log) == []
    assert _actual_compose_calls(env) == []
    assert ("", ["--connection", MACHINE, "info"]) in _direct_podman_calls(
        podman_log
    )


def test_machine_start_never_inherits_the_provider_connection(tmp_path: Path):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["CONTAINER_CONNECTION"] = "user-default-machine"
    env["JHT_FIXTURE_REQUIRE_WAKE"] = "1"

    result = _run(wrapper, env, "up")

    assert result.returncode == 0, result.stderr
    assert create_marker.read_text(encoding="utf-8") == "created\n"
    calls = _podman_calls(podman_log)
    machine_calls = [
        (connection, args)
        for connection, args in calls
        if args and args[0] == "machine"
    ]
    provider_calls = _provider_podman_calls(podman_log)
    assert machine_calls == [
        ("", ["machine", "start", "--update-connection=false", MACHINE])
    ]
    assert provider_calls
    assert all(connection == MACHINE for connection, _ in provider_calls)
    assert all(connection == "" for connection, _ in _direct_podman_calls(podman_log))
    assert all(connection == "" for connection, _ in _docker_calls(env))


@pytest.mark.parametrize(
    "operation",
    (
        ("logs", "--tail", "1"),
        ("status",),
        ("shell",),
        ("providers", "current"),
    ),
)
def test_runtime_operations_use_only_the_attested_container_id(
    tmp_path: Path, operation: tuple[str, ...]
):
    wrapper, env, _, _ = _runtime(tmp_path)
    env["JHT_CONTAINER_NAME"] = "same-name-decoy"

    result = _run(wrapper, env, *operation)

    assert result.returncode == 0, result.stderr
    targets = [
        target
        for _, args in _docker_calls(env)
        if (target := _docker_runtime_target(args)) is not None
    ]
    assert targets
    assert set(targets) == {CONTAINER_ID}
    assert all(
        "same-name-decoy" not in args and "jht" not in args
        for _, args in _docker_calls(env)
    )


def test_host_download_copies_from_and_cleans_up_only_the_attested_id(
    tmp_path: Path,
):
    wrapper, env, _, _ = _runtime(tmp_path)
    env["JHT_CONTAINER_NAME"] = "same-name-decoy"
    destination = tmp_path / "downloads" / "desktop.zip"

    result = _run(
        wrapper,
        env,
        "download",
        "--os",
        "macos",
        "--output",
        str(destination),
    )

    assert result.returncode == 0, result.stderr
    assert destination.read_bytes() == b"attested fixture download\n"
    docker_calls = _docker_calls(env)
    targets = [
        target
        for _, args in docker_calls
        if (target := _docker_runtime_target(args)) is not None
    ]
    assert targets
    assert set(targets) == {CONTAINER_ID}
    cp_calls = [args for _, args in docker_calls if args and args[0] == "cp"]
    assert len(cp_calls) == 1
    assert cp_calls[0][1].startswith(CONTAINER_ID + ":/tmp/jht-download-")
    assert all(
        "same-name-decoy" not in args and "jht" not in args
        for _, args in docker_calls
    )


@pytest.mark.parametrize("inherited_connection", [None, "user-default-machine"])
def test_upgrade_check_uses_the_same_exact_version_named_connection_contract(
    tmp_path: Path, inherited_connection: str | None
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    if inherited_connection is not None:
        env["CONTAINER_CONNECTION"] = inherited_connection

    result = _run(wrapper, env, "upgrade", "--check", "--json")

    assert result.returncode == 0, result.stderr
    assert '"ok":true' in result.stdout
    assert not create_marker.exists()
    compose_calls = _actual_compose_calls(env)
    assert any(args[-2:] == ["config", "-q"] for _, args in compose_calls)
    assert any(args[-2:] == ["pull", "jht"] for _, args in compose_calls)
    assert any(args[-2:] == ["config", "--images"] for _, args in compose_calls)
    _assert_only_podman_path_option(compose_calls)
    _assert_literal_project(compose_calls)
    assert all(connection == MACHINE for connection, _ in _compose_calls(env))
    calls = _provider_podman_calls(podman_log)
    assert calls == [
        (MACHINE, PS_Q_CHILD),
        (MACHINE, HASH_PROBE_CHILD),
        (MACHINE, PS_Q_CHILD),
        (MACHINE, HASH_PROBE_CHILD),
        (MACHINE, PS_Q_CHILD),
        (MACHINE, HASH_PROBE_CHILD),
        (MACHINE, ["pull", "jht"]),
    ]
    _assert_hash_probes_are_read_only(env)
    assert all(connection == "" for connection, _ in _direct_podman_calls(podman_log))
    assert all(connection == "" for connection, _ in _docker_calls(env))


def test_upgrade_activate_commits_canonical_project_metadata_for_later_probes(
    tmp_path: Path,
):
    wrapper, env, _, create_marker = _runtime(tmp_path)
    env["CONTAINER_CONNECTION"] = "user-default-machine"
    runtime = Path(env["JHT_RUNTIME_DIR"])
    canonical_path = runtime / "docker-compose.yml"
    canonical_compose = str(canonical_path)
    baseline_bytes = canonical_path.read_bytes()
    candidate_path = Path(env["JHT_FIXTURE_CANDIDATE_COMPOSE"])
    candidate_bytes = candidate_path.read_bytes()
    assert baseline_bytes != candidate_bytes

    upgraded = _run(wrapper, env, "upgrade", "--apply", "--json")

    assert upgraded.returncode == 0, upgraded.stderr
    assert '"ok":true' in upgraded.stdout
    assert create_marker.read_text(encoding="utf-8") == "created\n"
    metadata = json.loads(
        Path(env["JHT_FIXTURE_CONTAINER_METADATA"]).read_text(encoding="utf-8")
    )
    assert metadata["name"] == "jht"
    assert metadata["io_project"] == metadata["com_project"] == "jht"
    assert metadata["working_dir"] == str(runtime)
    assert metadata["config_files"] == canonical_compose
    assert metadata["io_service"] == metadata["com_service"] == "jht"
    assert metadata["container_number"] == "1"
    assert metadata["provider_version"] == "1.6.0"
    assert metadata["systemd_unit"] == PODMAN_UNIT
    assert metadata["config_hash"] == env["JHT_FIXTURE_CANDIDATE_CONFIG_HASH"]
    assert metadata["image_digest"] == env["JHT_FIXTURE_IMAGE_DIGEST"]
    assert metadata["compose_digest"] == hashlib.sha256(candidate_bytes).hexdigest()
    assert ".upgrade-stage." not in json.dumps(metadata)
    assert canonical_path.read_bytes() == candidate_bytes

    up_calls = [
        args
        for _, args in _actual_compose_calls(env)
        if "up" in args and "--dry-run" not in args
    ]
    assert len(up_calls) == 1
    assert up_calls[0][up_calls[0].index("-f") + 1] == canonical_compose
    assert up_calls[0][up_calls[0].index("-p") + 1] == "jht"
    assert up_calls[0][up_calls[0].index("up") + 1 :] == [
        "-d",
        "--force-recreate",
        "jht",
    ]
    stage_calls = [
        args
        for _, args in _actual_compose_calls(env)
        if ".upgrade-stage." in " ".join(args)
    ]
    assert stage_calls
    assert all("up" not in args for args in stage_calls)
    assert all(
        any(command in args for command in ("config", "pull")) for args in stage_calls
    )

    events = _events(env)
    create_index = next(
        index
        for index, event in enumerate(events)
        if event["tool"] == "podman" and event["args"] == ["create", "jht"]
    )
    ownership_inspects = [
        index
        for index, event in enumerate(events)
        if event["tool"] == "docker"
        and event["args"]
        and event["args"][0] == "inspect"
        and ".Name" in " ".join(event["args"])
    ]
    assert any(index < create_index for index in ownership_inspects)
    assert any(index > create_index for index in ownership_inspects)

    chat = _run(wrapper, env, "desktop-chat", "probe")
    snapshot = _run(wrapper, env, "onboarding-snapshot")

    assert chat.returncode == 0, chat.stderr
    assert chat.stdout == "true\n"
    assert snapshot.returncode == 0, snapshot.stderr
    assert "runtimeInstalled=1" in snapshot.stdout
    assert "containerRunning=1" in snapshot.stdout
    assert all(connection == "" for connection, _ in _docker_calls(env))


@pytest.mark.parametrize(
    ("container_case", "inspect_expected"),
    tuple(case for case in UNTRUSTED_CONTAINER_CASES if case[0] != "zero"),
)
def test_upgrade_rejects_untrusted_baseline_before_publish_or_up(
    tmp_path: Path,
    container_case: str,
    inspect_expected: bool,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_CONTAINER_CASE"] = container_case
    canonical = Path(env["JHT_COMPOSE_FILE"])
    baseline_bytes = canonical.read_bytes()

    result = _run(wrapper, env, "upgrade", "--apply", "--json")

    assert result.returncode != 0
    assert not create_marker.exists()
    assert canonical.read_bytes() == baseline_bytes
    assert not any(
        "up" in args and "--dry-run" not in args
        for _, args in _actual_compose_calls(env)
    )
    expected_provider_calls = [(MACHINE, PS_Q_CHILD)]
    if inspect_expected:
        expected_provider_calls.append((MACHINE, HASH_PROBE_CHILD))
    assert _provider_podman_calls(podman_log) == expected_provider_calls
    assert not any(
        args and args[0] == "machine" for _, args in _actual_podman_calls(podman_log)
    )
    assert not any(
        command in args
        for _, args in _actual_compose_calls(env)
        for command in ("config", "pull")
    )


OPERATIONS = (
    ("desktop-chat", "probe"),
    ("up",),
    ("upgrade", "--check", "--json"),
)


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize(
    ("variable", "unsupported"),
    (
        ("JHT_FIXTURE_COMPOSE_VERSION", "1.5.0"),
        ("JHT_FIXTURE_PODMAN_VERSION", "6.2.0"),
    ),
)
def test_unsupported_exact_version_fails_before_any_compose_operation(
    tmp_path: Path,
    operation: tuple[str, ...],
    variable: str,
    unsupported: str,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env[variable] = unsupported

    result = _run(wrapper, env, *operation)

    assert result.returncode != 0
    assert not create_marker.exists()
    assert _actual_compose_calls(env) == []
    assert _actual_podman_calls(podman_log) == []
    compose_calls = _compose_calls(env)
    assert all(connection == MACHINE for connection, _ in compose_calls)
    if variable == "JHT_FIXTURE_COMPOSE_VERSION":
        assert compose_calls
    assert all(connection == "" for connection, _ in _podman_calls(podman_log))


@pytest.mark.parametrize("operation", OPERATIONS)
@pytest.mark.parametrize(
    "machine_state",
    ("override-mismatch", "missing", "empty", "invalid"),
)
def test_unattested_or_ambiguous_machine_name_fails_before_compose(
    tmp_path: Path,
    operation: tuple[str, ...],
    machine_state: str,
):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    machine = Path(env["JHT_RUNTIME_DIR"]) / "podman-machine"
    if machine_state == "override-mismatch":
        env["JHT_PODMAN_MACHINE"] = "other-machine"
    elif machine_state == "missing":
        machine.unlink()
    elif machine_state == "empty":
        _attest_machine(env, "")
    else:
        _attest_machine(env, "invalid/name\n")

    result = _run(wrapper, env, *operation)

    assert result.returncode != 0
    assert not create_marker.exists()
    assert _compose_calls(env) == []
    assert _actual_podman_calls(podman_log) == []


@pytest.mark.parametrize(
    ("variable", "unsupported"),
    (
        ("JHT_FIXTURE_COMPOSE_VERSION", "1.5.0"),
        ("JHT_FIXTURE_PODMAN_VERSION", "6.2.0"),
    ),
)
def test_installer_version_mismatch_precedes_every_machine_or_provider_action(
    tmp_path: Path,
    variable: str,
    unsupported: str,
):
    _, env, podman_log, create_marker = _runtime(tmp_path)
    env[variable] = unsupported

    result = _run_installer_podman_preflight(env)

    assert result.returncode != 0
    assert not create_marker.exists()
    podman_calls = _podman_calls(podman_log)
    compose_calls = _compose_calls(env)
    assert podman_calls
    assert all(call == ("", ["--version"]) for call in podman_calls)
    assert all(call == (MACHINE, ["--version"]) for call in compose_calls)
    if variable == "JHT_FIXTURE_COMPOSE_VERSION":
        assert compose_calls
