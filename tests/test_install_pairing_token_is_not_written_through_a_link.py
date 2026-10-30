"""install.sh writes the pairing token in ~/.jht without following a link an agent put there.

`~/.jht` is mounted read-write in the container. The token used to be written with `printf >` to a fixed name there and then given its
mode and owner by path, so a link planted as `.pairing-token` (dangling in the container, pointing into the person's home on the host)
made the installer truncate the file it names and change its mode and owner. The file is now made in a temporary in the home, which is
not mounted, with its mode set there, and takes the place of the entry with `ln -n`.
"""

from __future__ import annotations

import os
import re
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"
VICTIM = b"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample person@laptop\n"
TOKEN = "t0k-" + "a1b2c3d4e5f6" * 4          # looks like a pairing token, is not one


def _functions() -> str:
    text = INSTALL.read_text(encoding="utf-8")
    return "\n".join(re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M).group(0)
                     for name in ("write_file_in_home", "save_pairing_token"))


def _save(home: Path, shim_dir: Path | None = None, **extra: str) -> subprocess.CompletedProcess:
    script = (
        "set -u\nDRY_RUN=0\nOS=macos\nRUNTIME_CHOICE=docker\n"
        f'PAIRING_TOKEN="{TOKEN}"\n'
        'info() { :; }\nok() { :; }\nwarn() { echo "warn: $*" >&2; }\nrun() { "$@"; }\n'
        "podman_native_mode() { return 1; }\n" + _functions() + "\nsave_pairing_token\n"
    )
    path = os.environ["PATH"] if shim_dir is None else f"{shim_dir}{os.pathsep}{os.environ['PATH']}"
    return subprocess.run(["bash", "-c", script], env={**os.environ, "HOME": str(home), "PATH": path, **extra},
                          capture_output=True, text=True, timeout=30, check=False, stdin=subprocess.DEVNULL)


@pytest.fixture()
def home(tmp_path: Path) -> Path:
    (tmp_path / "home" / ".jht").mkdir(parents=True)
    return tmp_path / "home"


def _victim(home: Path) -> Path:
    path = home / ".ssh" / "authorized_keys"
    path.parent.mkdir()
    path.write_bytes(VICTIM)
    path.chmod(0o644)
    return path


def _assert_token_file(home: Path) -> Path:
    token = home / ".jht" / ".pairing-token"
    assert not token.is_symlink() and token.is_file()
    assert token.read_text(encoding="utf-8") == TOKEN, "the token is written as it is, with no newline"
    assert stat.S_IMODE(token.stat().st_mode) == 0o600
    assert sorted(p.name for p in (home / ".jht").iterdir()) == [".pairing-token"]
    assert [p.name for p in home.iterdir() if p.name.startswith(".jht-host-file.")] == []
    return token


def _shim(home: Path, name: str, body: str) -> Path:
    real = subprocess.run(["sh", "-c", f"command -v {name}"], capture_output=True, text=True, check=True).stdout.strip()
    shim_dir = home.parent / "shims"
    shim_dir.mkdir(exist_ok=True)
    shim = shim_dir / name
    shim.write_text("#!/bin/bash\n" + body.replace("@REAL@", real), encoding="utf-8")
    shim.chmod(0o755)
    return shim_dir


def test_the_token_is_written_as_it_is_with_mode_0600(home: Path):
    done = _save(home)
    assert done.returncode == 0, done.stderr
    _assert_token_file(home)


@pytest.mark.parametrize("target", ("relative", "absolute"))
def test_a_link_in_place_of_the_token_is_replaced_and_its_target_keeps_its_content_and_mode(home: Path, target: str):
    victim = _victim(home)
    (home / ".jht" / ".pairing-token").symlink_to("../.ssh/authorized_keys" if target == "relative" else str(victim))

    done = _save(home)

    assert done.returncode == 0, done.stderr
    assert victim.read_bytes() == VICTIM, "the file the link names was written through"
    assert stat.S_IMODE(victim.stat().st_mode) == 0o644, "the mode of the file the link names was changed"
    _assert_token_file(home)


def test_a_dangling_link_creates_nothing_where_it_points(home: Path):
    (home / ".jht" / ".pairing-token").symlink_to("../created-by-the-link")
    done = _save(home)
    assert done.returncode == 0, done.stderr
    assert not (home / "created-by-the-link").exists()
    _assert_token_file(home)


def test_a_link_to_a_folder_does_not_receive_the_token(home: Path):
    folder = home / "Documents"
    folder.mkdir()
    (folder / "note.txt").write_text("keep\n", encoding="utf-8")
    (home / ".jht" / ".pairing-token").symlink_to("../Documents")

    done = _save(home)

    assert done.returncode == 0, done.stderr
    assert sorted(p.name for p in folder.iterdir()) == ["note.txt"]
    _assert_token_file(home)


def test_the_mode_is_set_on_the_temporary_before_it_takes_the_place(home: Path):
    log = home.parent / "ln.log"
    shim_dir = _shim(home, "ln", 'ls -ln "$2" >> "$LN_LOG"\nexec @REAL@ "$@"\n')

    done = _save(home, shim_dir, LN_LOG=str(log))

    assert done.returncode == 0, done.stderr
    assert log.read_text(encoding="utf-8").startswith("-rw-------"), log.read_text(encoding="utf-8")
    _assert_token_file(home)


def test_a_link_put_back_while_the_file_is_being_placed_receives_nothing(home: Path):
    folder = home / "Documents"
    folder.mkdir()
    (folder / "note.txt").write_text("keep\n", encoding="utf-8")
    (home / ".jht" / ".pairing-token").write_text("old", encoding="utf-8")
    shim_dir = _shim(home, "rm", '@REAL@ "$@"; rc=$?\ncase "$*" in *.pairing-token) ln -s "$RACE_TARGET" "${@: -1}" ;; esac\nexit $rc\n')

    done = _save(home, shim_dir, RACE_TARGET=str(folder))

    assert done.returncode != 0, "the write went on although the path had changed"
    assert sorted(p.name for p in folder.iterdir()) == ["note.txt"], "the token went into the folder the link names"
    assert [p.name for p in home.iterdir() if p.name.startswith(".jht-host-file.")] == []


def test_the_installer_has_no_write_by_path_left_on_the_token():
    source = INSTALL.read_text(encoding="utf-8")
    body = re.search(r"^save_pairing_token\(\) \{\n.*?^\}\n", source, re.S | re.M).group(0)
    assert '> "$token_file"' not in body and 'chmod 600 "$token_file"' not in body and 'chown 1001:1001 "$token_file"' not in body
    assert 'write_file_in_home "$token_file" 600' in body
