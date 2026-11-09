"""A second run of the host preflight finds ~/.jht in the hands of the container's user and must not fail on it (JHT-T312).

After the first install the folder belongs to the container's user (uid 1001): the person who installed cannot replace a
file in it. host-setup.sh used to try anyway and print a raw «rm: …/host.env: Permission denied». Now a file that is
already right is left alone, and one that cannot be changed says so in one line.
"""

from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "host-setup.sh"
HOST_ENV = "JHT_LANG=en\nJHT_HOST_TYPE=local\nJHT_USER_TZ=Europe/Rome\n"
PREFS = '{\n  "locale": "en"\n}\n'

pytestmark = [
    pytest.mark.skipif(sys.platform == "win32", reason="the bash preflight is not run on Windows"),
    pytest.mark.skipif(hasattr(os, "geteuid") and os.geteuid() == 0, reason="root can write anywhere: the case cannot be made"),
]


def run(home: Path):
    env = {**os.environ, "HOME": str(home), "JHT_RUNTIME_DIR": str(home / "runtime"), "LANG": "C"}
    for name in ("JHT_LANG", "JHT_HOME_HOST", "JHT_USER_TZ", "LC_ALL", "LC_MESSAGES"):
        env.pop(name, None)
    (home / "runtime").mkdir(exist_ok=True)
    done = subprocess.run(["bash", str(SCRIPT), "--host-type=local"], stdin=subprocess.DEVNULL, capture_output=True,
                          text=True, env=env, timeout=120, check=False)
    return done.returncode, done.stdout + done.stderr


@pytest.fixture()
def jht(tmp_path: Path):
    home = tmp_path / "home"
    folder = home / ".jht"
    folder.mkdir(parents=True)
    (folder / "host.env").write_text(HOST_ENV, encoding="utf-8")
    (folder / "i18n-prefs.json").write_text(PREFS, encoding="utf-8")
    yield home, folder
    folder.chmod(0o755)  # so that the temporary folder can be removed


def test_a_second_run_in_a_folder_it_cannot_write_is_clean_when_nothing_changes(jht):
    home, folder = jht
    folder.chmod(0o555)
    code, out = run(home)
    assert code == 0, out
    assert "Permission denied" not in out and "rm:" not in out and "keeps its old content" not in out, out
    assert (folder / "host.env").read_text(encoding="utf-8") == HOST_ENV
    assert (folder / "i18n-prefs.json").read_text(encoding="utf-8") == PREFS


def test_a_change_it_cannot_make_is_said_once_without_a_raw_error(jht):
    home, folder = jht
    stale = HOST_ENV + "JHT_STALE=1\n"
    (folder / "host.env").write_text(stale, encoding="utf-8")
    folder.chmod(0o555)
    code, out = run(home)
    assert code == 0, out
    assert out.count("keeps its old content") == 1, out
    assert "Permission denied" not in out and "rm:" not in out, out
    assert (folder / "host.env").read_text(encoding="utf-8") == stale


def test_in_a_folder_it_can_write_the_file_is_brought_up_to_date(jht):
    home, folder = jht
    (folder / "host.env").write_text(HOST_ENV + "JHT_STALE=1\n", encoding="utf-8")
    code, out = run(home)
    assert code == 0, out
    assert (folder / "host.env").read_text(encoding="utf-8") == HOST_ENV
    code, out = run(home)
    assert code == 0 and (folder / "host.env").read_text(encoding="utf-8") == HOST_ENV
