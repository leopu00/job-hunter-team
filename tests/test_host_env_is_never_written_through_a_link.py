"""host-setup.sh writes ~/.jht/host.env without ever following a link an agent put in its place.

`~/.jht` is mounted read-write in the container, so an agent can replace `host.env` with a link: relative to the container it
dangles, on the host it points into the person's home. The old `> "$HOST_ENV_PATH"` followed it and truncated the file it named
(`.zshrc`, `.ssh/authorized_keys`). The file is now written to a temporary of the same folder and renamed over the path, which
replaces the link itself.
"""

from __future__ import annotations

import os
import stat
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HOST_SETUP = ROOT / "scripts" / "host-setup.sh"
VICTIM = b"ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIexample person@laptop\n"


def _setup(home: Path, *args: str) -> subprocess.CompletedProcess:
    jht_home = home / ".jht"
    env = {**os.environ, "HOME": str(home), "JHT_HOME_HOST": str(jht_home), "TERM": "dumb"}
    for name in ("JHT_LANG", "JHT_USER_TZ", "JHT_HOST_TYPE", "JHT_SKIP_HOST_SETUP"):
        env.pop(name, None)
    return subprocess.run(
        ["bash", str(HOST_SETUP), "--host-type=local", "--non-interactive", *args],
        env=env, capture_output=True, text=True, timeout=30, check=False, stdin=subprocess.DEVNULL,
    )


@pytest.fixture()
def home(tmp_path: Path) -> Path:
    (tmp_path / "home" / ".jht").mkdir(parents=True)
    return tmp_path / "home"


def _victim(home: Path) -> Path:
    path = home / ".ssh" / "authorized_keys"
    path.parent.mkdir()
    path.write_bytes(VICTIM)
    return path


def _assert_regular_host_env(home: Path):
    host_env = home / ".jht" / "host.env"
    assert not host_env.is_symlink() and host_env.is_file()
    text = host_env.read_text(encoding="utf-8")
    assert "JHT_LANG=" in text and "JHT_HOST_TYPE=local" in text and "JHT_USER_TZ=" in text
    assert stat.S_IMODE(host_env.stat().st_mode) == 0o644
    return host_env


def _no_leftovers(home: Path):
    assert sorted(p.name for p in (home / ".jht").iterdir()) == ["host.env", "i18n-prefs.json"]


@pytest.mark.parametrize("target", ("relative", "absolute"))
def test_a_link_to_a_file_outside_the_mounted_folders_is_replaced_and_the_file_stays_intact(home: Path, target: str):
    victim = _victim(home)
    link = home / ".jht" / "host.env"
    link.symlink_to("../.ssh/authorized_keys" if target == "relative" else str(victim))

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    assert victim.read_bytes() == VICTIM, "the file the link named was written through"
    _assert_regular_host_env(home)
    _no_leftovers(home)


def test_a_dangling_link_creates_nothing_where_it_points(home: Path):
    link = home / ".jht" / "host.env"
    link.symlink_to("../created-by-the-link")

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    assert not (home / "created-by-the-link").exists()
    _assert_regular_host_env(home)


def test_a_link_to_a_folder_does_not_receive_the_file(home: Path):
    folder = home / "Documents"
    folder.mkdir()
    (folder / "note.txt").write_text("keep\n", encoding="utf-8")
    (home / ".jht" / "host.env").symlink_to("../Documents")

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    assert sorted(p.name for p in folder.iterdir()) == ["note.txt"]
    assert (folder / "note.txt").read_text(encoding="utf-8") == "keep\n"
    _assert_regular_host_env(home)


def test_a_link_is_not_read_as_the_persons_language(home: Path):
    victim = home / "elsewhere.env"
    victim.write_text("JHT_LANG=pt\nJHT_USER_TZ=America/Sao_Paulo\n", encoding="utf-8")
    (home / ".jht" / "host.env").symlink_to(victim)

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    text = _assert_regular_host_env(home).read_text(encoding="utf-8")
    assert "JHT_LANG=pt" not in text and "Sao_Paulo" not in text
    assert victim.read_text(encoding="utf-8") == "JHT_LANG=pt\nJHT_USER_TZ=America/Sao_Paulo\n"


def test_a_regular_host_env_is_replaced_with_the_three_values_and_no_temporary_is_left(home: Path):
    (home / ".jht" / "host.env").write_text("JHT_LANG=it\nJHT_USER_TZ=Europe/Rome\n", encoding="utf-8")

    done = _setup(home)

    assert done.returncode == 0, done.stderr
    text = _assert_regular_host_env(home).read_text(encoding="utf-8")
    assert "JHT_LANG=it" in text and "JHT_USER_TZ=Europe/Rome" in text
    _no_leftovers(home)


def test_a_folder_in_place_of_host_env_is_refused_and_left_alone(home: Path):
    folder = home / ".jht" / "host.env"
    folder.mkdir()
    (folder / "inside").write_text("keep\n", encoding="utf-8")

    done = _setup(home)

    assert done.returncode != 0
    assert (folder / "inside").read_text(encoding="utf-8") == "keep\n"
    assert sorted(p.name for p in folder.iterdir()) == ["inside"]
