"""Podman rootless on native Linux: the versions are a MINIMUM, the container keeps the user's uid.

macOS and Windows stay on the exact Podman 6.1.3 / podman-compose 1.6.0 (see
test_podman_compose_exact_version_boundary.py). On native Linux the wrapper accepts podman >= 5.0.0 and
podman-compose >= 1.1.0 (the same minimums as install.sh), and `compose` passes a second file that maps
the host user onto uid 1001 (`keep-id:uid=1001,gid=1001`) so `~/.jht` stays writable.

The production functions are cut out of scripts/jht-wrapper.sh and run in bash with fake `podman` and
`podman-compose`; nothing real is touched.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"

FUNCTIONS = (
    "version_is_plain", "version_at_least", "podman_version_number", "podman_compose_version_number",
    "podman_compose_pair_supported", "podman_native_override_path", "podman_native_override_ensure",
    "compose_project_name", "podman_binary", "podman_compose_binary", "compose_file",
)


def _source() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    parts = []
    for name in FUNCTIONS:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, name
        parts.append(match.group(0))
    constants = re.findall(r'^PODMAN_(?:COMPOSE_)?NATIVE_MIN_VERSION="[0-9.]+"$', text, re.M)
    assert len(constants) == 2
    return "\n".join(constants + parts)


@pytest.fixture()
def box(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    runtime = tmp_path / "runtime"
    runtime.mkdir()
    log = tmp_path / "compose-argv.txt"

    def tools(podman: str, compose: str):
        (bin_dir / "podman").write_text(
            f'#!/bin/sh\nif [ "$1" = --version ]; then echo "podman version {podman}"; exit 0; fi\nexit 0\n', encoding="utf-8"
        )
        (bin_dir / "podman-compose").write_text(
            "#!/bin/sh\n"
            f'if [ "$1" = --version ]; then echo "podman-compose version {compose}"; echo "podman version {podman}"; exit 0; fi\n'
            f'printf "%s\\n" "$*" >> "{log}"\nexit 0\n',
            encoding="utf-8",
        )
        for tool in ("podman", "podman-compose"):
            (bin_dir / tool).chmod(0o755)

    base = runtime / "docker-compose.yml"
    base.write_text("services:\n  jht:\n    image: x\n  jht-broker:\n    image: y\n  jht-telegram:\n    image: z\n", encoding="utf-8")

    def run(mode: str, body: str, podman: str = "5.7.0", compose: str = "1.5.0"):
        tools(podman, compose)
        script = (
            "set -u\n"
            f'PATH="{bin_dir}:/usr/bin:/bin"\nRUNTIME_DIR="{runtime}"\nPODMAN_RUNTIME_MODE={mode}\nPODMAN_MACHINE_NAME=jht-podman\n'
            "CONTAINER_RUNTIME=podman\nerr() { echo \"error: $*\" >&2; }\n" + _source() + "\n" + body
        )
        return subprocess.run(["bash", "-c", script], capture_output=True, text=True, env={**os.environ, "LC_ALL": "C"})

    return type("Box", (), {"run": run, "runtime": runtime, "log": log, "base": base, "bin": bin_dir})


SUPPORTED = 'podman_compose_pair_supported "$(command -v podman)" "$(command -v podman-compose)" && echo yes || echo no'


@pytest.mark.parametrize(
    ("podman", "compose", "expected"),
    [
        ("5.7.0", "1.5.0", "yes"),   # Ubuntu 26.04 from apt
        ("5.0.0", "1.1.0", "yes"),   # the minimums themselves
        ("5.10.0", "1.12.3", "yes"),  # 10 > 9: numeric, not alphabetical
        ("6.1.3", "1.6.0", "yes"),
        ("4.9.9", "1.5.0", "no"),
        ("5.7.0", "1.0.6", "no"),
        ("5.7.0", "1.0.99", "no"),
        ("5.7.0-dev", "1.5.0", "no"),
        ("5.7", "1.5.0", "no"),
        ("5.7.0", "1.5.0rc1", "no"),
    ],
)
def test_native_linux_accepts_the_minimum_and_anything_above(box, podman, compose, expected):
    done = box.run("native", SUPPORTED, podman, compose)
    assert done.stdout.strip() == expected, done.stderr


@pytest.mark.parametrize(("podman", "compose", "expected"), [("6.1.3", "1.6.0", "yes"), ("5.7.0", "1.5.0", "no"), ("6.1.4", "1.6.0", "no"), ("6.1.3", "1.6.1", "no")])
def test_macos_machine_keeps_the_exact_versions(box, podman, compose, expected):
    done = box.run("machine", SUPPORTED, podman, compose)
    assert done.stdout.strip() == expected, done.stderr


def test_the_override_maps_the_host_user_onto_1001_for_every_service_the_file_has(box):
    done = box.run("native", f'podman_native_override_ensure "{box.base}"')
    assert done.returncode == 0, done.stderr
    path = Path(done.stdout.strip())
    assert path == box.runtime / "docker-compose.podman-linux.yml"
    text = path.read_text(encoding="utf-8")
    for service in ("jht", "jht-broker", "jht-telegram"):
        assert re.search(rf'^  {service}:\n    userns_mode: "keep-id:uid=1001,gid=1001"$', text, re.M), service
    assert "network" not in text  # the network is not touched
    assert path.stat().st_mode & 0o077 == 0


def test_the_override_names_only_services_the_compose_has_and_is_rewritten_when_altered(box):
    box.base.write_text("services:\n  jht:\n    image: x\n", encoding="utf-8")
    done = box.run("native", f'podman_native_override_ensure "{box.base}"')
    path = Path(done.stdout.strip())
    assert path.read_text(encoding="utf-8").count("userns_mode") == 1
    path.write_text("services:\n  jht:\n    privileged: true\n", encoding="utf-8")
    box.run("native", f'podman_native_override_ensure "{box.base}"')
    assert "privileged" not in path.read_text(encoding="utf-8")
    path.unlink()
    path.symlink_to(box.runtime / "elsewhere")
    assert box.run("native", f'podman_native_override_ensure "{box.base}"').returncode == 1  # never written through a link


def test_up_on_native_linux_passes_the_base_file_then_the_override(box):
    done = box.run("native", f'compose_file "{box.base}" up -d jht')
    assert done.returncode == 0, done.stderr
    (argv,) = box.log.read_text(encoding="utf-8").splitlines()
    override = box.runtime / "docker-compose.podman-linux.yml"
    assert f"-f {box.base} -f {override} up -d jht" in argv
    assert "--podman-path" in argv and "-p jht" in argv


def test_a_missing_provider_names_the_package_to_install(box):
    done = box.run("native", f'podman_compose_binary() {{ return 1; }}; compose_file "{box.base}" ps -q', podman="5.7.0")
    assert done.returncode != 0
    assert "podman-compose" in done.stderr and "apt install podman-compose" in done.stderr


def test_a_version_below_the_minimum_says_what_was_found_and_what_is_needed(box):
    done = box.run("native", f'compose_file "{box.base}" ps -q', podman="4.9.4", compose="1.0.6")
    assert done.returncode == 1
    assert "podman >= 5.0.0" in done.stderr and "4.9.4" in done.stderr
    assert "podman-compose >= 1.1.0" in done.stderr and "1.0.6" in done.stderr
    assert not box.log.exists()  # nothing was run
