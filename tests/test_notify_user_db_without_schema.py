"""JHT-T352 F-12: «jht-notify-user failed with exit 2: … insert fallita: no such table:
pending_user_messages». The jobs.db the tool opened existed but had no schema yet (a reader opens it before the first agent
writes), and the notice to the person was lost. The tool now creates the schema of shared/skills/_db.py on that same file, and
an error names the file it opened. A private JHT_HOME, made-up texts, no Telegram.
"""
from __future__ import annotations

import os
import sqlite3
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NOTIFY = ROOT / "agents" / "_tools" / "jht-notify-user"


def notify(home: Path, *args: str, env_extra=None):
    env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(home), "JHT_HOME": str(home),
           "PYTHONDONTWRITEBYTECODE": "1", **(env_extra or {})}
    return subprocess.run([sys.executable, str(NOTIFY), "--agent", "capitano", "--no-telegram", *args], capture_output=True,
                          text=True, env=env, timeout=60)


def test_a_jobs_db_without_schema_gets_it_and_the_notice_is_kept(tmp_path):
    sqlite3.connect(tmp_path / "jobs.db").close()       # the empty file a reader leaves behind
    done = notify(tmp_path, "the team is paused")
    assert done.returncode == 0, done.stderr
    with sqlite3.connect(tmp_path / "jobs.db") as db:
        assert db.execute("SELECT agent, body FROM pending_user_messages").fetchall() == [("capitano", "the team is paused")]
        assert db.execute("SELECT 1 FROM sqlite_master WHERE name = 'positions'").fetchone(), "the whole schema of _db.py"


def test_the_schema_goes_on_the_file_asked_for_never_another(tmp_path):
    other = tmp_path / "elsewhere"
    other.mkdir()
    target = other / "jobs.db"
    sqlite3.connect(target).close()
    done = notify(tmp_path, "one line", env_extra={"JHT_DB": str(target)})
    assert done.returncode == 0, done.stderr
    assert not (tmp_path / "jobs.db").exists()
    with sqlite3.connect(target) as db:
        assert db.execute("SELECT COUNT(*) FROM pending_user_messages").fetchone() == (1,)


def test_an_error_says_which_file_was_opened(tmp_path):
    target = tmp_path / "jobs.db"
    target.write_bytes(b"not a database at all, just bytes " * 40)
    done = notify(tmp_path, "one line")
    assert done.returncode == 2
    assert str(target) in done.stderr
