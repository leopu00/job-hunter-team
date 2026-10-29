"""uid 1001 on the host must be nobody, or the person running JHT (P2, 08/10).

The container runs as uid 1001 and, on Linux, install.sh and the wrapper's
ensure_bind_owner chown ~/.jht and the documents folder to 1001. If another
account on the host has uid 1001, that account owns all of ~/.jht — data and
portal credentials — and can run a file the container made setuid there.
Both now check `getent passwd 1001` first and stop, touching nothing — except
with native rootless Podman, where keep-id makes the container's 1001 the
host user and nothing is chowned to 1001.

Run with: pytest tests/test_bind_uid_conflict.py -v
"""

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"


def stubs(tmp_path: Path, *, owner_of_1001: str | None, self_uid: str, dir_uid: str = "0",
          chown_ok: bool = True, sudo_ok: bool = True, docker: str | None = None) -> tuple[Path, Path]:
    """PATH with getent/id/uname/stat/chown/sudo/docker faked. chown only logs; when it works the folders are 1001's
    from then on (`stat` says so), when it fails it fails like a normal user's (EPERM). `docker` is what the
    one-shot container prints (None: no docker on this computer), and every call of it is logged in docker.log."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "chown.log"
    done = tmp_path / "chowned"
    entry = f"{owner_of_1001}:x:1001:1001::/home/{owner_of_1001}:/bin/bash" if owner_of_1001 else ""
    scripts = {
        "getent": f'#!/bin/sh\n[ "$1" = passwd ] && [ "$2" = 1001 ] && [ -n "{entry}" ] && echo "{entry}" && exit 0\nexit 2\n',
        "id": f'#!/bin/sh\n[ "$1" = -u ] && echo {self_uid} && exit 0\n'
        f'[ "$1" = -un ] && [ "$2" = 1001 ] && [ -n "{owner_of_1001 or ""}" ] && echo "{owner_of_1001 or ""}" && exit 0\nexit 1\n',
        "uname": "#!/bin/sh\necho Linux\n",
        "stat": f"#!/bin/sh\n[ -e {done} ] && echo 1001 || echo {dir_uid}\n",
        "chown": f'#!/bin/sh\necho "$@" >> {log}\n' + (f"touch {done}\n" if chown_ok else "exit 1\n"),
        "sudo": f'#!/bin/sh\necho "sudo $@" >> {tmp_path / "sudo.log"}\n' + ('"$@"\n' if sudo_ok else "exit 1\n"),
    }
    if docker is not None:
        (tmp_path / "docker.out").write_text(docker + "\n" if docker else "")
        scripts["docker"] = f'#!/bin/sh\necho "$@" >> {tmp_path / "docker.log"}\ncat {tmp_path / "docker.out"}\nexit 0\n'
    for name, body in scripts.items():
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    return bin_dir, log


def env_for(bin_dir: Path, home: Path) -> dict[str, str]:
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "HOME": str(home)}
    env.pop("SUDO_UID", None)
    return env


# ── install.sh ───────────────────────────────────────────────────────────


def run_installer_check(tmp_path, *, os_name: str = "", runtime: str = "", **kw):
    bin_dir, log = stubs(tmp_path, **kw)
    home = tmp_path / "home"
    home.mkdir()
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\n'
        f'OS="{os_name}"; RUNTIME_CHOICE="{runtime}"\n'
        "refuse_foreign_bind_uid\n"
        'chown -R 1001:1001 "$HOME/.jht"\n'
    )
    result = subprocess.run(["bash", "-c", script], env=env_for(bin_dir, home), capture_output=True, text=True, timeout=30)
    return result, (log.read_text() if log.exists() else "")


def test_installer_goes_on_when_1001_is_nobody(tmp_path):
    result, chowns = run_installer_check(tmp_path, owner_of_1001=None, self_uid="0")
    assert result.returncode == 0, result.stderr
    assert chowns.startswith("-R 1001:1001")


def test_installer_goes_on_when_1001_is_the_installing_user(tmp_path):
    result, chowns = run_installer_check(tmp_path, owner_of_1001="leo", self_uid="1001")
    assert result.returncode == 0, result.stderr
    assert chowns.startswith("-R 1001:1001")


def test_installer_stops_when_1001_is_another_account_and_changes_nothing(tmp_path):
    result, chowns = run_installer_check(tmp_path, owner_of_1001="alice", self_uid="0")
    assert result.returncode == 1
    assert "'alice'" in result.stderr and "Nothing was changed" in result.stderr
    assert chowns == ""


def test_installer_goes_on_with_native_podman_even_when_1001_is_another_account(tmp_path):
    # keep-id: the container's 1001 is this user, ~/.jht stays theirs, the other account owns none of it
    result, _ = run_installer_check(tmp_path, os_name="linux", runtime="podman", owner_of_1001="alice", self_uid="1000")
    assert result.returncode == 0, result.stderr
    assert "Nothing was changed" not in result.stderr


@pytest.mark.parametrize("os_name,runtime", [("linux", "docker"), ("linux", ""), ("macos", "podman")])
def test_installer_still_stops_on_another_1001_outside_native_podman(tmp_path, os_name, runtime):
    result, chowns = run_installer_check(tmp_path, os_name=os_name, runtime=runtime, owner_of_1001="alice", self_uid="1000")
    assert result.returncode == 1
    assert "'alice'" in result.stderr and "Nothing was changed" in result.stderr
    assert chowns == ""


def test_installer_checks_before_any_chown_to_1001():
    main = INSTALL.read_text(encoding="utf-8")
    body = main[main.index("\nmain() {"):]
    assert body.index("refuse_foreign_bind_uid") < body.index("save_pairing_token") < body.index("run_host_setup")


def test_the_public_installer_carries_the_same_check():
    assert (ROOT / "web" / "public" / "install.sh").read_text() == INSTALL.read_text()


# ── jht-wrapper.sh ensure_bind_owner ─────────────────────────────────────


def wrapper_functions() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    out = []
    for fn in ("bind_uid_conflict", "host_data_dir_same", "host_data_dirs_supported", "repair_owner_in_container",
               "ensure_bind_owner"):
        match = re.search(rf"^{fn}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, fn
        out.append(match.group(0))
    out.append(re.search(r"^MOUNT_REPAIR_DISPATCH=.*$", text, re.M).group(0))
    return "\n".join(out)


def run_ensure_bind_owner(tmp_path, **kw):
    bin_dir, log = stubs(tmp_path, **kw)
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    script = (
        'err() { echo "error: $*" >&2; }\nwarn() { echo "warn: $*" >&2; }\ninfo() { echo "$*" >&2; }\n'
        "CONTAINER_RUNTIME=docker; DEFAULT_RUNTIME_IMAGE=ghcr.io/leopu00/jht@sha256:test\n"
        + wrapper_functions()
        + "\nensure_bind_owner\necho done\n"
    )
    result = subprocess.run(["bash", "-c", script], env=env_for(bin_dir, home), capture_output=True, text=True, timeout=30)
    return result, (log.read_text() if log.exists() else "")


@pytest.mark.parametrize("owner,self_uid", [(None, "0"), ("leo", "1001")])
def test_the_wrapper_aligns_as_before_when_1001_is_nobody_or_the_user(tmp_path, owner, self_uid):
    result, chowns = run_ensure_bind_owner(tmp_path, owner_of_1001=owner, self_uid=self_uid)
    assert result.returncode == 0, result.stderr
    assert "done" in result.stdout
    assert "-R 1001:1001" in chowns


def test_the_wrapper_stops_up_when_1001_is_another_account_and_changes_nothing(tmp_path):
    result, chowns = run_ensure_bind_owner(tmp_path, owner_of_1001="alice", self_uid="0")
    assert result.returncode == 1
    assert "bind_uid_conflict" in result.stderr and "'alice'" in result.stderr
    assert "done" not in result.stdout
    assert chowns == ""


def test_the_wrapper_repairs_with_the_one_shot_container_for_a_user_who_is_not_1001_and_has_no_sudo(tmp_path):
    """The reproduction of the Gate CLI case (29/10): uid 1000, the folders are the user's, chown and sudo fail."""
    result, chowns = run_ensure_bind_owner(tmp_path, owner_of_1001=None, self_uid="1000", dir_uid="1000",
                                           chown_ok=False, sudo_ok=False, docker=RECEIPTS)
    assert result.returncode == 0, result.stderr
    assert "done" in result.stdout and "fallito" not in result.stderr
    assert "--cap-add CHOWN" in (tmp_path / "docker.log").read_text()
    assert not (tmp_path / "sudo.log").exists()  # nobody was asked for a password


@pytest.mark.parametrize("printed", [None, "", "mount_repair_unsupported", "mount_repaired /jht_home"])
def test_the_wrapper_stops_up_instead_of_leaving_a_restart_loop_when_nothing_can_repair(tmp_path, printed):
    result, _ = run_ensure_bind_owner(tmp_path, owner_of_1001=None, self_uid="1000", dir_uid="1000",
                                      chown_ok=False, sudo_ok=False, docker=printed)
    assert result.returncode == 1
    assert "mount_repair_failed" in result.stderr and "sudo chown -R 1001:1001" in result.stderr
    assert "done" not in result.stdout


def test_the_wrapper_still_uses_sudo_when_the_container_cannot_repair_and_sudo_works(tmp_path):
    result, chowns = run_ensure_bind_owner(tmp_path, owner_of_1001=None, self_uid="1000", dir_uid="1000",
                                           chown_ok=True, sudo_ok=True, docker="mount_repair_unsupported")
    assert result.returncode == 0, result.stderr
    assert "done" in result.stdout and "-R 1001:1001" in chowns


def test_the_wrapper_as_root_does_not_start_a_container(tmp_path):
    result, chowns = run_ensure_bind_owner(tmp_path, owner_of_1001=None, self_uid="0", dir_uid="1000",
                                           chown_ok=True, docker=RECEIPTS)
    assert result.returncode == 0 and "-R 1001:1001" in chowns and not (tmp_path / "docker.log").exists()


def test_the_repair_container_and_the_public_installer_say_the_same_as_the_windows_one():
    windows = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")
    dispatch = re.search(r"^MOUNT_REPAIR_DISPATCH='(.*)'$", WRAPPER.read_text(encoding="utf-8"), re.M).group(1)
    assert f"$MountRepairDispatch = '{dispatch}'" in windows
    assert f"MOUNT_REPAIR_DISPATCH='{dispatch}'" in INSTALL.read_text(encoding="utf-8")
    assert (ROOT / "web" / "public" / "install.sh").read_bytes() == INSTALL.read_bytes()


# ── install.sh align_bind_ownership: the Mac does not chown (27/10) ─────────


def run_align_bind_ownership(tmp_path, *, os_name: str, runtime: str, chown_fails: bool, use_docker: int = 1,
                             docker: str | None = None):
    """The step that follows host-setup. chown logs, and fails like a normal user's does (EPERM)."""
    bin_dir, log = stubs(tmp_path, owner_of_1001=None, self_uid="501", chown_ok=not chown_fails, docker=docker)
    home = tmp_path / "home"
    home.mkdir()
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\n'
        f'OS="{os_name}"; RUNTIME_CHOICE="{runtime}"; USE_DOCKER={use_docker}\n'
        "align_bind_ownership\n"
    )
    result = subprocess.run(["bash", "-c", script], env=env_for(bin_dir, home), capture_output=True, text=True, timeout=30)
    return result, (log.read_text() if log.exists() else ""), home


@pytest.mark.parametrize("runtime", ["podman", "docker", ""])
def test_the_mac_neither_chowns_nor_warns(tmp_path, runtime):
    result, chowns, home = run_align_bind_ownership(tmp_path, os_name="macos", runtime=runtime, chown_fails=True)
    assert result.returncode == 0, result.stderr
    assert chowns == ""
    assert "failed" not in (result.stdout + result.stderr)
    assert "stays with this user" in result.stdout + result.stderr
    assert (home / "Documents" / "Job Hunter Team").is_dir()


@pytest.mark.parametrize("os_name,runtime", [("linux", "docker"), ("linux", ""), ("wsl", "docker")])
def test_linux_with_docker_still_aligns_to_1001(tmp_path, os_name, runtime):
    result, chowns, _ = run_align_bind_ownership(tmp_path, os_name=os_name, runtime=runtime, chown_fails=False)
    assert result.returncode == 0, result.stderr
    assert chowns.count("-R 1001:1001") == 1 and "/.jht" in chowns and "/Documents/Job Hunter Team" in chowns
    assert "1001:1001 (container UID)" in result.stdout + result.stderr


RECEIPTS = "mount_repaired /jht_home\nmount_repaired /jht_user"


def test_a_normal_user_without_sudo_gets_the_folders_from_the_one_shot_container(tmp_path):
    """Gate CLI 29/10: uid 1000, no sudo: the chown to 1001 failed with a warning and the container then died in a
    restart loop («mount_not_writable /jht_home»). The folders are now set by the same one-shot container as on Windows."""
    result, chowns, _ = run_align_bind_ownership(tmp_path, os_name="linux", runtime="docker", chown_fails=True,
                                                 docker=RECEIPTS)
    out = result.stdout + result.stderr
    assert result.returncode == 0, out
    assert "failed" not in out and "one-shot container" in out
    (call,) = (tmp_path / "docker.log").read_text().splitlines()
    for part in ("run --rm", "--user 0:0", "--cap-drop ALL", "--cap-add CHOWN", "--cap-add DAC_READ_SEARCH", "--network none",
                 "--security-opt no-new-privileges", "/.jht:/jht_home", "/Documents/Job Hunter Team:/jht_user",
                 "--entrypoint /bin/sh", "ghcr.io/leopu00/jht@sha256:", "/app/.launcher/repair-mounts.sh"):
        assert part in call, (part, call)
    assert "NET_ADMIN" not in call and "--privileged" not in call and "--cap-add ALL" not in call


@pytest.mark.parametrize("printed", ["", "mount_repair_unsupported", "mount_repair_failed /jht_home\nmount_ok /jht_user",
                                     "mount_repaired /jht_home", "mount_repaired /jht_home\nmount_repaired /jht_user\nmount_repaired /etc"])
def test_the_installer_stops_with_a_clear_error_when_the_container_cannot_confirm_both_folders(tmp_path, printed):
    result, _, _ = run_align_bind_ownership(tmp_path, os_name="linux", runtime="docker", chown_fails=True, docker=printed)
    assert result.returncode == 1
    assert "mount_repair_failed" in result.stderr and "sudo chown -R 1001:1001" in result.stderr


def test_the_installer_stops_when_there_is_no_docker_to_repair_with(tmp_path):
    result, _, _ = run_align_bind_ownership(tmp_path, os_name="linux", runtime="docker", chown_fails=True, docker=None)
    assert result.returncode == 1 and "mount_repair_failed" in result.stderr


def test_the_installer_does_not_start_the_container_when_the_chown_worked(tmp_path):
    result, chowns, _ = run_align_bind_ownership(tmp_path, os_name="linux", runtime="docker", chown_fails=False,
                                                 docker=RECEIPTS)
    assert result.returncode == 0 and not (tmp_path / "docker.log").exists()


def test_without_docker_a_failed_chown_is_only_a_warning(tmp_path):
    result, _, _ = run_align_bind_ownership(tmp_path, os_name="linux", runtime="", chown_fails=True, use_docker=0)
    assert result.returncode == 0 and "failed" in result.stdout + result.stderr
    assert not (tmp_path / "docker.log").exists()


def test_native_podman_still_leaves_the_owner_alone(tmp_path):
    result, chowns, _ = run_align_bind_ownership(tmp_path, os_name="linux", runtime="podman", chown_fails=True)
    assert chowns == ""
    assert "rootless Podman" in result.stdout + result.stderr
