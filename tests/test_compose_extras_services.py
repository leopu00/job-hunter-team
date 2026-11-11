"""The containers of the tools the user asks for (docker-compose.yml, profiles off by default), read as YAML.

Each one has the options the security opinions ask for; a missing option is a red test, not a review remark."""
from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = yaml.safe_load((ROOT / "docker-compose.yml").read_text(encoding="utf-8"))
SERVICES = COMPOSE["services"]
ON_REQUEST = {"jht-media": "media"}
FORBIDDEN_MOUNTS = ("docker.sock", "podman.sock", "/var/run", "/run/user")


def mounts(service: str) -> dict[str, str]:
    """destination -> mode (`rw` when none is written)."""
    out = {}
    for item in SERVICES[service].get("volumes", []):
        parts = item.split(":")
        out[parts[1]] = parts[2] if len(parts) > 2 else "rw"
    return out


@pytest.mark.parametrize("service", sorted(ON_REQUEST))
def test_every_on_request_container_is_off_by_default_and_hardened(service):
    spec = SERVICES[service]
    assert spec["profiles"] == [ON_REQUEST[service]], "a profile of its own: nothing starts it but the command that asked"
    assert spec["restart"] == "no", "off at boot, off after a stop"
    assert spec["cap_drop"] == ["ALL"] and spec["security_opt"] == ["no-new-privileges:true"]
    assert not any("seccomp" in option for option in spec["security_opt"]), "the default seccomp profile, never unconfined"
    assert isinstance(spec["pids_limit"], int) and 0 < spec["pids_limit"] <= 512
    assert spec["mem_limit"] and spec["cpus"]
    assert spec["read_only"] is True
    assert any(item.startswith("/tmp:size=") for item in spec["tmpfs"]), "a tmpfs of fixed size for /tmp"
    for masked in ("/jht_home", "/jht_user"):
        assert any(item.startswith(f"{masked}:size=64k,mode=0555") for item in spec["tmpfs"]), f"{masked} masked with an empty folder"
    assert not spec.get("privileged") and not spec.get("devices") and "pid" not in spec and "ipc" not in spec
    assert not any(any(bad in item for bad in FORBIDDEN_MOUNTS) for item in spec.get("volumes", []))
    assert not spec.get("ports") or all(p.startswith("127.0.0.1:") for p in spec["ports"]), "a published port is on the loopback only"
    assert spec["user"].split(":")[0] not in ("0", "root")


@pytest.mark.parametrize("service", sorted(ON_REQUEST))
def test_the_image_has_no_digest_in_the_compose_and_cannot_start_without_the_pin(service):
    image = SERVICES[service]["image"]
    assert image == "${JHT_EXTRAS_IMAGE:-jht-extras-unpinned}"
    assert not re.search(r"sha256:[0-9a-f]{64}", image), "the extras digest lives in the wrappers, one copy checked by the pin tool"


def test_media_has_no_network_and_the_two_folders_with_opposite_modes():
    spec = SERVICES["jht-media"]
    assert spec["network_mode"] == "none"
    assert mounts("jht-media") == {"/jht_media/in": "ro", "/jht_media/out": "rw"}
    # and jht sees them the other way round: it writes the questions, it only reads the answers
    assert mounts("jht")["/jht_media/in"] == "rw" and mounts("jht")["/jht_media/out"] == "ro"
    assert spec["volumes"][0].split(":")[0] == "jht-media-in" and spec["volumes"][1].split(":")[0] == "jht-media-out"
    assert {"jht-media-in", "jht-media-out"} <= set(COMPOSE["volumes"]), "named volumes, never a bind on the host"
    assert not any(item.startswith(("/", "$", ".", "~")) for item in spec["volumes"])


def test_media_runs_the_worker_of_the_repository_and_nothing_else():
    assert SERVICES["jht-media"]["entrypoint"][-2:] == ["python3", "/app/shared/media/media_worker.py"]
    assert (ROOT / "shared" / "media" / "media_worker.py").is_file()


def test_the_media_folders_are_made_by_the_image_with_the_owner_of_jht():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "mkdir -p /jht_media/in /jht_media/out" in dockerfile and "chown jht:jht /jht_media /jht_media/in /jht_media/out" in dockerfile


def test_no_other_service_got_a_profile_or_a_mount_by_this():
    assert SERVICES["jht"].get("profiles") is None and SERVICES["jht-broker"]["profiles"] == ["broker"]
    assert SERVICES["jht-telegram"]["profiles"] == ["telegram"]
    assert "ports" in SERVICES["jht"] and SERVICES["jht"]["ports"] == ["127.0.0.1:${JHT_LIVE_SCREEN_PORT:-6080}:6080"]


def test_the_tmpfs_of_the_media_container_runs_nothing_and_grants_no_privilege():
    assert "/tmp:size=512m,mode=1777,noexec,nosuid" in SERVICES["jht-media"]["tmpfs"]


def test_the_volume_of_the_closers_browser_is_read_only_in_jht_and_written_only_by_the_one_shot_populator():
    assert mounts("jht")["/opt/playwright-extras"] == "ro"
    populate = SERVICES["jht-playwright-populate"]
    assert populate["profiles"] == ["playwright"] and populate["network_mode"] == "none" and populate["read_only"] is True
    assert populate["cap_drop"] == ["ALL"] and populate["restart"] == "no" and populate["user"] == "1001:1001"
    assert populate["volumes"] == ["jht-playwright:/opt/playwright-extras"] and "jht-playwright" in COMPOSE["volumes"]
    assert populate["entrypoint"][-5:-3] == ["/app/shared/skills/playwright_extras.py", "populate"] and populate["entrypoint"][-2:] == ["/opt/playwright", "/opt/playwright-extras"]
    assert (ROOT / "shared" / "skills" / "playwright_extras.py").is_file()
    assert not [var for var in SERVICES["jht"]["environment"] if "EXTRAS" in var], "a variable here would change the hash the wrapper attests jht by"


def test_the_mount_folder_of_the_closers_browser_is_made_by_the_image_with_the_owner_of_jht():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "mkdir -p /opt/playwright-extras" in dockerfile and "chown jht:jht /opt/playwright-extras" in dockerfile
