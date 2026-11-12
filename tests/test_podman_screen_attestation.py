"""`jht screen on` on Podman must not make the team «non attestabile».

podman-compose's `ps` lists every container of the project. The attestation refused the whole project when one of them had a service
the wrapper did not list, and the list held only the agents and the two isolated services: once the screen container was up, status,
up, down, doctor and the installer all refused (Mac, Podman, packages 18 and 19). The screen's own check failed too: its expected
hash was computed without the extras image the container is made with.
"""

from __future__ import annotations

import hashlib
import re
import subprocess
from pathlib import Path

import yaml

from test_podman_compose_exact_version_boundary import ROOT, WRAPPER, _wrapper_functions

EXTRAS_DIGEST = "sha256:" + "e" * 64
UNIT = "podman-compose" + "@" + "jht.service"
IDS = {"jht": "a" * 64, "jht-screen": "b" * 64, "jht-media": "c" * 64, "intruder": "d" * 64}


def _compose_services() -> list[str]:
    return sorted(yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))["services"])


def _wrapper_services() -> list[str]:
    match = re.search(r'^COMPOSE_SERVICES="([^"]+)"$', WRAPPER.read_text(encoding="utf-8"), re.M)
    assert match
    return match.group(1).split()


def test_the_wrapper_knows_every_service_of_the_compose():
    assert sorted(_wrapper_services()) == _compose_services()


def _hash(service: str) -> str:
    return hashlib.sha256(service.encode()).hexdigest()


def _attest(tmp_path: Path, service: str, present: list[str]) -> subprocess.CompletedProcess[str]:
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    rows = "\n".join(
        f'  {IDS[name]}) printf "%s\\n" "{name}|true|jht|jht|{name}|{name}|1|{runtime}|{runtime}/docker-compose.yml|1.6.0|'
        f'{UNIT}|{_hash(name)}" ;;'
        for name in present
    )
    services = " ".join(f'"{IDS[name]}"' for name in present)
    script = f"""
set -u
CONTAINER_RUNTIME=podman
PODMAN_RUNTIME_MODE=machine
RUNTIME_DIR="{runtime}"
COMPOSE_FILE="{runtime}/docker-compose.yml"
COMPOSE_SERVICES="{' '.join(_wrapper_services())}"
docker_reachable() {{ :; }}
compose_project_name() {{ printf 'jht\\n'; }}
compose_file() {{ printf '%s\\n' {services}; }}
attest_why() {{ :; }}
attest_inspect_format() {{ :; }}
podman_caller_env_set() {{ return 1; }}
podman_expected_config_hash() {{ printf '%s' "$2" | sha256sum | cut -c1-64; }}
docker() {{
  case "$4" in
{rows}
    *) return 1 ;;
  esac
}}
{_wrapper_functions("read_only_service_id_attest")}
JHT_ATTEST_CACHE=0 read_only_service_id_attest "{service}"
"""
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60)


def test_the_team_stays_ours_with_the_screen_and_media_containers_beside_it(tmp_path: Path):
    for service in ("jht", "jht-screen", "jht-media"):
        result = _attest(tmp_path, service, ["jht", "jht-screen", "jht-media"])
        assert result.returncode == 0, (service, result.stdout, result.stderr)
        assert result.stdout.strip() == IDS[service]


def test_a_container_of_the_project_with_a_service_the_compose_has_not_is_still_refused(tmp_path: Path):
    result = _attest(tmp_path, "jht", ["jht", "intruder"])
    assert result.returncode == 1 and result.stdout.strip() == ""


def _expected_hash(tmp_path: Path, extras: str, caller_extras: str | None = None) -> subprocess.CompletedProcess[str]:
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    compose = tmp_path / "podman-compose"
    # A stand-in provider that prints the create line of the asked service, its hash made from the extras image it was given.
    compose.write_text(
        "#!/bin/bash\n"
        'service="${@: -1}"\n'
        'h="$(printf %s "${JHT_EXTRAS_IMAGE:-jht-extras-unpinned}" | sha256sum | cut -c1-64)"\n'
        'echo "podman create --name=$service --label io.podman.compose.config-hash=$h image"\n',
        encoding="utf-8",
    )
    compose.chmod(0o755)
    caller = f'export JHT_EXTRAS_IMAGE="{caller_extras}"\n' if caller_extras else ""
    script = f"""
set -u
PODMAN_RUNTIME_MODE=machine
PODMAN_MACHINE_NAME=m
RUNTIME_DIR="{runtime}"
RUNTIME_IMAGE_PIN="{runtime}/no-pin"
RUNTIME_TIER_FILE="{runtime}/no-tier"
COMPOSE_ALL_PROFILES=screen
PODMAN_CALLER_ENV="JHT_EXTRAS_IMAGE"
podman_ensure_on_path() {{ :; }}
podman_binary() {{ printf '/bin/true\\n'; }}
podman_compose_binary() {{ printf '%s\\n' "{compose}"; }}
podman_compose_pair_supported() {{ :; }}
runtime_extras_digest() {{ [ -n "{extras}" ] || return 1; printf '%s\\n' "{extras}"; }}
{caller}{_wrapper_functions("podman_expected_config_hash")}
podman_expected_config_hash "{runtime}/docker-compose.yml" jht-screen
"""
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=60)


def test_the_screen_is_expected_with_the_pinned_extras_image(tmp_path: Path):
    result = _expected_hash(tmp_path, EXTRAS_DIGEST)
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == hashlib.sha256(f"ghcr.io/leopu00/jht@{EXTRAS_DIGEST}".encode()).hexdigest()


def test_the_pinned_extras_image_wins_over_one_the_caller_exported(tmp_path: Path):
    result = _expected_hash(tmp_path, EXTRAS_DIGEST, caller_extras="ghcr.io/leopu00/jht@sha256:" + "f" * 64)
    assert result.stdout.strip() == hashlib.sha256(f"ghcr.io/leopu00/jht@{EXTRAS_DIGEST}".encode()).hexdigest()


def test_an_extras_pin_that_cannot_be_trusted_gives_no_image_and_so_never_the_screens_hash(tmp_path: Path):
    result = _expected_hash(tmp_path, "")
    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == hashlib.sha256(b"jht-extras-unpinned").hexdigest()
