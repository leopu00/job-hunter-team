"""La traccia di una ricreazione dei core (shared/skills/recreate_marker.py)."""
import importlib.util
import json
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
MODULE = REPO / "shared" / "skills" / "recreate_marker.py"


def _load(monkeypatch, home):
    monkeypatch.setenv("JHT_HOME", str(home))
    spec = importlib.util.spec_from_file_location("recreate_marker_under_test", MODULE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_no_trace_is_none(tmp_path, monkeypatch):
    assert _load(monkeypatch, tmp_path).seconds_since(now=1000.0) is None


def test_a_round_of_recreations_is_one_marker_with_the_last_time(tmp_path, monkeypatch):
    rm = _load(monkeypatch, tmp_path)
    for i, name in enumerate(["assistente", "capitano", "mentor", "sentinella"]):
        rm.mark(name, "ttl", now=1000.0 + 60 * i)
    data = json.loads(rm.marker_path().read_text(encoding="utf-8"))
    assert data == {"ts": 1180.0, "kind": "ttl", "sessions": ["ASSISTENTE", "CAPITANO", "MENTOR", "SENTINELLA"]}
    assert rm.seconds_since(now=1180.0 + 900) == 900.0


def test_a_later_round_starts_a_new_list(tmp_path, monkeypatch):
    rm = _load(monkeypatch, tmp_path)
    rm.mark("capitano", "ttl", now=1000.0)
    rm.mark("capitano", "doctor", now=1000.0 + rm.SAME_ROUND_SEC + 1)
    data = json.loads(rm.marker_path().read_text(encoding="utf-8"))
    assert data["sessions"] == ["CAPITANO"] and data["kind"] == "doctor"


def test_unreadable_or_future_traces_are_no_trace(tmp_path, monkeypatch):
    rm = _load(monkeypatch, tmp_path)
    rm.marker_path().parent.mkdir(parents=True)
    rm.marker_path().write_text("not json", encoding="utf-8")
    assert rm.seconds_since(now=5.0) is None
    rm.mark("capitano", now=1000.0)
    assert rm.seconds_since(now=999.0) is None


def test_a_disk_error_is_silent(tmp_path, monkeypatch):
    blocker = tmp_path / "state"
    blocker.write_text("a file where the folder should be", encoding="utf-8")
    _load(monkeypatch, tmp_path).mark("capitano", now=1.0)  # must not raise


def test_the_command_line_marks_for_the_watchdog(tmp_path):
    done = subprocess.run([sys.executable, str(MODULE), "mark", "capitano", "ttl"], env={"JHT_HOME": str(tmp_path), "PATH": "/usr/bin:/bin"},
                          capture_output=True, text=True, timeout=30, check=False)
    assert done.returncode == 0, done.stderr
    assert json.loads((tmp_path / "state" / "last-recreate.json").read_text())["sessions"] == ["CAPITANO"]
    bad = subprocess.run([sys.executable, str(MODULE)], env={"JHT_HOME": str(tmp_path), "PATH": "/usr/bin:/bin"},
                         capture_output=True, text=True, timeout=30, check=False)
    assert bad.returncode == 2
