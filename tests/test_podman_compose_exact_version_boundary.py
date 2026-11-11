"""Regression harness for the supported macOS Podman Compose command plan.

The fixtures model only the external process boundary of podman-compose 1.6.0
and Podman 6.1.3.  The production wrapper, runtime attestation, dispatcher and
subcommands are executed unchanged; no machine, container or default Podman
connection is touched.
"""

from __future__ import annotations

# Shared immutable templates; each test still creates its own runtime.
from functools import lru_cache

import hashlib
import json
import os
import pty
from pathlib import Path
import shutil
import subprocess

import pytest
from podman_machine_fixture import write_machine_config, write_macos_host_tools


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
# After a successful `up` the wrapper only checks whether a broker is there to be brought back or adopted
# (broker_after_up): one read-only `compose ps -q` for the broker service, no hash probe and no attestation,
# because an install without a broker has nothing to configure (the broker is made at its first use).
WEB_AUTHORISATION_LOOKUPS = [PS_Q_CHILD]
# ... and the container it finds (the fixture's) is attested with one docker inspect.
WEB_AUTHORISATION_INSPECTS = 1
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


@lru_cache(maxsize=16)
def _prepared_executable_source(source: str) -> str:
    python_header = "#!/usr/bin/env python3\n"
    if source.startswith(python_header):
        # Private stdlib-only fakes need no global PDF/notary site hooks.
        # Keep the same PATH-selected interpreter and real process boundary.
        source = (
            "#!/bin/sh\n"
            '""":"\n'
            'exec python3 -S "$0" "$@"\n'
            '":"""\n'
            + source[len(python_header):]
        )
    return source


def _write_executable(path: Path, source: str) -> None:
    path.write_text(_prepared_executable_source(source), encoding="utf-8")
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
    write_macos_host_tools(bin_dir)
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

if command == "ps" and os.environ.get("JHT_FIXTURE_PS_FAILS"):
    print(os.environ["JHT_FIXTURE_PS_FAILS"], file=sys.stderr)
    raise SystemExit(1)
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
    # 1.6.0's `config` takes only --no-normalize, --services and -q: Docker Compose's --images is refused.
    print("podman-compose: error: unrecognized arguments: --images", file=sys.stderr)
    raise SystemExit(2)
if command == "config" and rest == []:
    print("services:\\n  jht:\\n    image: example.invalid/jht@sha256:" + os.environ["JHT_FIXTURE_IMAGE_DIGEST"] + "\\n")
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
    if os.environ.get("JHT_FIXTURE_ENV_IN_HASH") == "1" and os.environ.get("OPENAI_API_KEY"):
        # 1.6.0 resolves ${OPENAI_API_KEY:-} of the compose from the caller's environment into the hash
        config_hash = hashlib.sha256((config_hash + os.environ["OPENAI_API_KEY"]).encode()).hexdigest()
    # 1.6.0 hashes each service's own configuration, and the plan of a service prints the create of its
    # dependency first, with its own hash (jht depends on jht-telegram), then the create of the service asked
    service = rest[-1]
    if service == "jht":
        print(
            "INFO podman create --name=jht-telegram --label io.podman.compose.config-hash="
            + "7" * 64
            + " --label next=value",
            file=sys.stderr,
        )
    print(
        "INFO podman create --name=" + service + " --label io.podman.compose.config-hash="
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
    if os.environ.get("JHT_FIXTURE_REQUIRE_MOUNT_POINT") == "1":
        # What a Podman machine does with a named volume mounted inside the ~/.jht bind: the mount point has to
        # be on the host already, the engine cannot make it there (crun: mkdir ... Operation not permitted).
        if not (Path(os.environ["HOME"]) / ".jht" / "runtime").is_dir():
            print("Error: crun: mkdir `/jht_home/runtime`: Operation not permitted: OCI permission denied", file=sys.stderr)
            raise SystemExit(126)
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
        # these tests hold the exact sequence of the COMPLETE attestation; the cache has its own tests (test_wrapper_attest_cache.py)
        "JHT_ATTEST_CACHE": "0",
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
    write_machine_config(home, env, machine=MACHINE)
    return wrapper, env, podman_log, create_marker


# Only a guard against a wrapper that hangs: `upgrade --apply` alone runs the fake compose,
# the candidate checks and two health probes one second apart, and takes 10-30 s on a loaded
# runner or laptop. A 10 s guard failed the upgrade test on a correct wrapper.
WRAPPER_TIMEOUT_S = 60


def _run(wrapper: Path, env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [str(wrapper), *args],
        env=env,
        text=True,
        capture_output=True,
        timeout=WRAPPER_TIMEOUT_S,
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










































OPERATIONS = (
    ("desktop-chat", "probe"),
    ("up",),
    ("upgrade", "--check", "--json"),
)








# ── The hash follows the caller's environment (TEST 19g) ────────────────────────────────────────────
# podman-compose 1.6.0 puts the resolved ${OPENAI_API_KEY:-} (and the other variables the compose takes from the caller)
# in the config-hash. A terminal with a key exported expected another hash than the app that made the container with a
# clean environment, and every read said «container non attivo» while the team ran.

def _status(tmp_path: Path, *, key: str | None, label_made_with: str | None):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_ENV_IN_HASH"] = "1"
    for name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MOONSHOT_API_KEY"):
        env.pop(name, None)
    if label_made_with is not None:
        made = hashlib.sha256((env["JHT_FIXTURE_CONFIG_HASH"] + label_made_with).encode()).hexdigest()
        path = Path(env["JHT_FIXTURE_CONTAINER_METADATA"])
        path.write_text(json.dumps({**json.loads(path.read_text(encoding="utf-8")), "config_hash": made}), encoding="utf-8")
    if key is not None:
        env["OPENAI_API_KEY"] = key
    return _run(wrapper, env, "status"), create_marker


















# ── podman-compose looks for podman in PATH at its own start (TEST 19g) ──────────────────────────────
# The wrapper finds podman in /opt/homebrew/bin when the caller's PATH has none of it (`env -i`, a terminal opened from the app),
# but podman-compose 1.6.0 runs `podman version` through PATH whatever --podman-path says: its `--version` probe died, the wrapper read
# «no provider» and `status` said «container 'jht' non attivo» for a team that was running.

def _tools_outside_path(tmp_path: Path) -> Path:
    tools = tmp_path / "tools-not-on-path"
    tools.mkdir()
    _write_executable(tools / "podman", "#!/bin/sh\necho 'podman version 6.1.3'\n")
    _write_executable(
        tools / "podman-compose",
        "#!/bin/bash\n"
        "command -v podman >/dev/null 2>&1 || { echo \"ERROR:podman_compose:failed to check if podman is installed: 'podman'\" >&2; exit 1; }\n"
        "echo 'podman-compose version 1.6.0'\n",
    )
    return tools


def _minimal_path(tmp_path: Path) -> Path:
    """A PATH that holds only what the probe itself needs (bash, sed, head), as links: no /usr/bin, so that a podman the machine
    happens to have there (the CI runner has a real one) can never be found. The test must not depend on the machine."""
    import shutil as _shutil
    folder = tmp_path / "minimal-path"
    folder.mkdir()
    for tool in ("bash", "sed", "head", "tr", "cut", "cat"):
        found = _shutil.which(tool)
        assert found, tool
        (folder / tool).symlink_to(found)
    assert not (folder / "podman").exists()
    return folder


def _wrapper_functions(*names: str) -> str:
    import re
    text = WRAPPER.read_text(encoding="utf-8")
    out = []
    for name in names:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, name
        out.append(match.group(0))
    return "\n".join(out)


def _probe_version(tmp_path: Path, *, ensure: bool) -> subprocess.CompletedProcess[str]:
    tools = _tools_outside_path(tmp_path)
    minimal = _minimal_path(tmp_path)
    script = (
        f'PATH="{minimal}"\nPODMAN_RUNTIME_MODE=machine\nPODMAN_MACHINE_NAME=m\n'
        f'podman_binary() {{ printf "%s\\n" "{tools}/podman"; }}\n'
        + _wrapper_functions("podman_ensure_on_path", "podman_compose_version_number")
        + (f'\npodman_compose_version_number "{tools}/podman-compose"\n' if ensure else
           f'\npodman_ensure_on_path() {{ :; }}\npodman_compose_version_number "{tools}/podman-compose"\n')
    )
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60)










# ── The team can always be stopped from the terminal (TEST 19g) ─────────────────────────────────────

def _team(tmp_path: Path, *args: str, key: str | None, made_with: str | None):
    wrapper, env, podman_log, create_marker = _runtime(tmp_path)
    env["JHT_FIXTURE_ENV_IN_HASH"] = "1"
    for name in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "MOONSHOT_API_KEY"):
        env.pop(name, None)
    if made_with is not None:
        made = hashlib.sha256((env["JHT_FIXTURE_CONFIG_HASH"] + made_with).encode()).hexdigest()
        path = Path(env["JHT_FIXTURE_CONTAINER_METADATA"])
        path.write_text(json.dumps({**json.loads(path.read_text(encoding="utf-8")), "config_hash": made}), encoding="utf-8")
    if key is not None:
        env["OPENAI_API_KEY"] = key
    return _run(wrapper, env, "team", *args), create_marker








# ── `jht status` says what the provider said (TEST 19h) ──────────────────────────────────────────────









# ── `jht status` for a person: a short screen at a terminal, key=value for the app on a pipe ────────

def _run_in_terminal(wrapper: Path, env: dict[str, str], *args: str) -> tuple[int, str]:
    master, slave = pty.openpty()
    try:
        process = subprocess.Popen([str(wrapper), *args], env=env, stdout=slave, stderr=slave, stdin=subprocess.DEVNULL)
        os.close(slave)
        chunks = []
        while True:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            chunks.append(data)
        process.wait(timeout=WRAPPER_TIMEOUT_S)
    finally:
        os.close(master)
    return process.returncode, b"".join(chunks).decode("utf-8", "replace")
