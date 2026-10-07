"""uid 1001 on the host must be nobody, or the person running JHT (P2, 08/10).

The container runs as uid 1001 and, on Linux, install.sh and the wrapper's
ensure_bind_owner chown ~/.jht and the documents folder to 1001. If another
account on the host has uid 1001, that account owns all of ~/.jht — data and
portal credentials — and can run a file the container made setuid there.
Both now check `getent passwd 1001` first and stop, touching nothing.

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


def stubs(tmp_path: Path, *, owner_of_1001: str | None, self_uid: str, dir_uid: str = "0") -> tuple[Path, Path]:
    """PATH with getent/id/uname/stat/chown faked. chown only logs."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log = tmp_path / "chown.log"
    entry = f"{owner_of_1001}:x:1001:1001::/home/{owner_of_1001}:/bin/bash" if owner_of_1001 else ""
    scripts = {
        "getent": f'#!/bin/sh\n[ "$1" = passwd ] && [ "$2" = 1001 ] && [ -n "{entry}" ] && echo "{entry}" && exit 0\nexit 2\n',
        "id": f'#!/bin/sh\n[ "$1" = -u ] && echo {self_uid} && exit 0\n'
        f'[ "$1" = -un ] && [ "$2" = 1001 ] && [ -n "{owner_of_1001 or ""}" ] && echo "{owner_of_1001 or ""}" && exit 0\nexit 1\n',
        "uname": "#!/bin/sh\necho Linux\n",
        "stat": f"#!/bin/sh\necho {dir_uid}\n",
        "chown": f'#!/bin/sh\necho "$@" >> {log}\n',
        "sudo": f'#!/bin/sh\nshift 0\n"$@"\n',
    }
    for name, body in scripts.items():
        (bin_dir / name).write_text(body)
        (bin_dir / name).chmod(0o755)
    return bin_dir, log


def env_for(bin_dir: Path, home: Path) -> dict[str, str]:
    env = {**os.environ, "PATH": f"{bin_dir}:{os.environ['PATH']}", "HOME": str(home)}
    env.pop("SUDO_UID", None)
    return env


# ── install.sh ───────────────────────────────────────────────────────────


def run_installer_check(tmp_path, **kw):
    bin_dir, log = stubs(tmp_path, **kw)
    home = tmp_path / "home"
    home.mkdir()
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}"\n'
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
    for fn in ("bind_uid_conflict", "ensure_bind_owner"):
        match = re.search(rf"^{fn}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, fn
        out.append(match.group(0))
    return "\n".join(out)


def run_ensure_bind_owner(tmp_path, **kw):
    bin_dir, log = stubs(tmp_path, **kw)
    home = tmp_path / "home"
    (home / ".jht").mkdir(parents=True)
    script = (
        'err() { echo "error: $*" >&2; }\nwarn() { echo "warn: $*" >&2; }\ninfo() { echo "$*" >&2; }\n'
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
