"""A team that has never run has no jobs.db yet: its positions are none, not a failure.

`POSITIONS_READ_PY` (desktop/src-tauri/src/existing_team_runtime.rs) is the reader the app sends over
SSH with every read of an existing team's positions. A team just installed, with its agents never
started, has a home and no jobs.db: the dashboard, the positions page and the filters must show an
empty team, not «The VPS did not return the positions». A jobs.db that is there and cannot be read,
and a missing home, stay a failure.

The reader is taken from the Rust source as it is, its paths pointed at a temporary folder. No cargo,
no container, no VPS. Synthetic data only.
"""

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "desktop" / "src-tauri" / "src" / "existing_team_runtime.rs").read_text(encoding="utf-8")


def reader(home: Path) -> str:
    start = SOURCE.index('r#"', SOURCE.index("const POSITIONS_READ_PY")) + len('r#"')
    script = SOURCE[start : SOURCE.index('"#;', start)]
    assert script.count("/jht_home/jobs.db") >= 2
    return script.replace("/jht_home", str(home))


def ask(home: Path, request: dict) -> dict:
    done = subprocess.run(
        [sys.executable, "-I", "-c", reader(home)],
        input=json.dumps(request) + "\n",
        capture_output=True,
        text=True,
        timeout=30,
        check=True,
    )
    return json.loads(done.stdout)


def test_a_team_without_jobs_db_has_no_positions(tmp_path):
    home = tmp_path / "home"
    home.mkdir()

    listed = ask(home, {"op": "list"})
    assert listed == {"ok": True, "data": {"items": [], "total": 0, "scamSection": 0}}

    facets = ask(home, {"op": "facets"})
    assert facets == {"ok": True, "data": {"items": []}}

    stats = ask(home, {"op": "stats"})
    assert stats["ok"] is True, stats
    assert stats["data"]["stats"]["total"] == 0
    assert stats["data"]["distribution"]["active"] == 0
    assert stats["data"]["points"] == {"rows": [], "included": 0, "of": 0}
    assert stats["data"]["recent"] == [] and stats["data"]["sources"] == []

    detail = ask(home, {"op": "detail", "id": "7"})
    assert detail == {"ok": True, "data": None}

    # nothing was created in the team's home: the empty database lives in memory only
    assert list(home.iterdir()) == []


def test_a_jobs_db_that_cannot_be_read_is_still_a_failure(tmp_path):
    home = tmp_path / "home"
    home.mkdir()
    (home / "jobs.db").write_bytes(b"not a database at all" * 64)
    assert ask(home, {"op": "list"}) == {"ok": False, "error": "positions_unavailable"}


def test_a_missing_home_is_still_a_failure(tmp_path):
    assert ask(tmp_path / "no-home", {"op": "stats"}) == {"ok": False, "error": "positions_unavailable"}
