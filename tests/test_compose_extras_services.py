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
ON_REQUEST = {"jht-media": "media", "jht-screen": "screen", "jht-playwright-populate": "playwright", "jht-login": "login", "jht-login-proxy": "login", "jht-login-view": "login"}
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
    assert "ports" not in SERVICES["jht"] and SERVICES["jht-screen"]["ports"] == ["127.0.0.1:${JHT_LIVE_SCREEN_PORT:-6080}:6080"]


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


def test_the_login_browser_has_no_network_and_is_the_only_one_with_the_profile_and_the_display_stays_in_its_own_container():
    login = SERVICES["jht-login"]
    assert login["network_mode"] == "none"
    assert any(item.endswith(":/linkedin-profile") and item.startswith("${HOME}/.jht/secrets/linkedin-profile") for item in login["volumes"])
    for name, spec in SERVICES.items():
        if name != "jht-login":
            assert not any("linkedin-profile" in item for item in spec.get("volumes", [])), name
            assert not any(item.startswith("jht-login-") for item in spec.get("volumes", [])) or name in ("jht-login-proxy", "jht-login-view"), name
    assert not login.get("ports") and "/tmp/.X11-unix" not in " ".join(login.get("volumes", [])), "its display is its own"
    assert "jht-x11" not in " ".join(login["volumes"])


def test_each_folder_of_sockets_of_the_login_is_mounted_by_two_of_the_three_and_the_proxy_has_no_port_and_no_profile():
    def mounted(volume):
        return sorted(name for name, spec in SERVICES.items() if any(item.split(":")[0] == volume for item in spec.get("volumes", [])))
    assert mounted("jht-login-vnc") == ["jht-login", "jht-login-view"]
    assert mounted("jht-login-egress") == ["jht-login", "jht-login-proxy"]
    proxy = SERVICES["jht-login-proxy"]
    assert not proxy.get("ports") and proxy["volumes"] == ["jht-login-egress:/ipc/egress"]
    assert SERVICES["jht-login-view"]["ports"] == ["127.0.0.1:6081:6081"] and SERVICES["jht-login-view"]["volumes"] == ["jht-login-vnc:/ipc/vnc"]
    assert {"jht-login-vnc", "jht-login-egress"} <= set(COMPOSE["volumes"])


def test_the_login_services_run_the_modules_of_the_repository_with_the_paths_the_other_two_use():
    def last(name):
        return " ".join(SERVICES[name]["entrypoint"])
    assert "login_session.py /ipc/vnc/vnc.sock /ipc/egress/proxy.sock /ipc/vnc/hint /linkedin-profile" in last("jht-login")
    assert "login_proxy.py /ipc/egress/proxy.sock" in last("jht-login-proxy")
    assert "login_view.py serve /ipc/vnc/vnc.sock /ipc/vnc/hint" in last("jht-login-view")
    for module in ("login_session.py", "login_proxy.py", "login_view.py", "allowed_hosts.txt"):
        assert (ROOT / "shared" / "login" / module).is_file(), module
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    assert "mkdir -p /ipc/vnc /ipc/egress" in dockerfile and "chown jht:jht /ipc /ipc/vnc /ipc/egress" in dockerfile


def test_only_the_login_browser_has_a_capability_and_it_is_the_one_the_sandbox_of_chromium_needs():
    assert SERVICES["jht-login"]["cap_add"] == ["SYS_CHROOT"] and SERVICES["jht-login"]["cap_drop"] == ["ALL"]
    assert [name for name, spec in SERVICES.items() if spec.get("cap_add")] == ["jht-login"]
    assert not any("seccomp" in option for option in SERVICES["jht-login"]["security_opt"]), "the default seccomp profile"
    assert "--no-sandbox" not in " ".join(SERVICES["jht-login"]["entrypoint"])


def test_the_tmpfs_of_an_on_request_container_holds_the_8_mb_the_image_has_in_its_tmp_or_the_engine_cannot_create_it():
    for name in ("jht-login", "jht-login-proxy", "jht-login-view", "jht-screen", "jht-media", "jht-playwright-populate"):
        size = [item for item in SERVICES[name]["tmpfs"] if item.startswith("/tmp:")][0].split("size=")[1].split(",")[0]
        assert int(size.rstrip("mg")) * (1024 if size.endswith("g") else 1) >= 16, (name, size)
