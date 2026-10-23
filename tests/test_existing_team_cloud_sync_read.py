"""The app connected to an existing team reads how the box's push to the website is going.

`POSITIONS_READ_PY` (desktop/src-tauri/src/existing_team_runtime.rs) answers the op `cloud_sync` from
the periodic push's own state, /jht_home/.cloud-periodic-push.json: a closed status and three checked
fields, nothing else. On 23/10 a box had been refused by the website for 16 days and the app said
nothing. The reader is taken from the Rust source as it is, its paths pointed at a temporary home.
Synthetic data only.
"""

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = (ROOT / "desktop" / "src-tauri" / "src" / "existing_team_runtime.rs").read_text(encoding="utf-8")


def ask(home: Path, request: dict) -> dict:
    start = SOURCE.index('r#"', SOURCE.index("const POSITIONS_READ_PY")) + len('r#"')
    script = SOURCE[start : SOURCE.index('"#;', start)].replace("/jht_home", str(home))
    done = subprocess.run([sys.executable, "-I", "-c", script], input=json.dumps(request) + "\n",
                          capture_output=True, text=True, timeout=30, check=True)
    return json.loads(done.stdout)


def state(home: Path, value) -> None:
    (home / ".cloud-periodic-push.json").write_text(value if isinstance(value, str) else json.dumps(value))


def test_a_refused_box_is_read_with_its_last_success_and_failures(tmp_path):
    state(tmp_path, {
        "status": "auth_failed", "last_success_at": "2026-10-07T12:12:46.425Z",
        "last_attempt_at": "2026-10-23T17:00:00.000Z", "consecutive_failures": 45012,
        "signature": {"positions": {"n": 2367}}, "token": "jht_sync_synthetic-never-read", "last_reason": "auth_failed",
    })
    assert ask(tmp_path, {"op": "cloud_sync"}) == {"ok": True, "data": {
        "state": "ok", "status": "auth_failed", "last_success_at": "2026-10-07T12:12:46.425Z",
        "last_attempt_at": "2026-10-23T17:00:00.000Z", "consecutive_failures": 45012,
    }}


def test_odd_values_are_closed_and_never_passed_on(tmp_path):
    state(tmp_path, {"status": "exploded", "last_success_at": "yesterday <b>", "last_attempt_at": 5, "consecutive_failures": "many"})
    assert ask(tmp_path, {"op": "cloud_sync"})["data"] == {
        "state": "ok", "status": "other", "last_success_at": None, "last_attempt_at": None, "consecutive_failures": 0,
    }


def test_no_state_a_garbled_one_or_a_link_say_so(tmp_path):
    assert ask(tmp_path, {"op": "cloud_sync"}) == {"ok": True, "data": {"state": "absent"}}
    state(tmp_path, "{not json")
    assert ask(tmp_path, {"op": "cloud_sync"})["data"] == {"state": "unreadable"}
    state(tmp_path, "[1, 2]")
    assert ask(tmp_path, {"op": "cloud_sync"})["data"] == {"state": "unreadable"}
    (tmp_path / ".cloud-periodic-push.json").unlink()
    (tmp_path / "elsewhere.json").write_text(json.dumps({"status": "completed"}))
    os.symlink(tmp_path / "elsewhere.json", tmp_path / ".cloud-periodic-push.json")
    assert ask(tmp_path, {"op": "cloud_sync"})["data"] == {"state": "unreadable"}


def test_the_request_is_closed(tmp_path):
    assert ask(tmp_path, {"op": "cloud_sync", "path": "/etc/passwd"}) == {"ok": False, "error": "positions_request_invalid"}
