"""The fixed script the desktop app runs inside the team to read the provider's work window.

desktop/src-tauri/src/provider_window.rs holds it as a string (PROVIDER_WINDOW_PY) and runs it through the chat's
Python channel; the Rust tests only close its answer again. Here the script itself is run, as the team would, on a
synthetic state file of the bridge (logs/sentinel-bridge-state.json).
"""
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).parents[1]
SOURCE = (ROOT / "desktop" / "src-tauri" / "src" / "provider_window.rs").read_text(encoding="utf-8")
SCRIPT = re.search(r'PROVIDER_WINDOW_PY: &str = r#"(.*?)"#;', SOURCE, re.S).group(1)


def run(home: Path, request: str = '{"op":"read"}\n', state=None, raw: str | None = None) -> dict:
    logs = home / "logs"
    logs.mkdir(parents=True, exist_ok=True)
    if raw is not None:
        (logs / "sentinel-bridge-state.json").write_text(raw, encoding="utf-8")
    elif state is not None:
        (logs / "sentinel-bridge-state.json").write_text(json.dumps(state), encoding="utf-8")
    done = subprocess.run(
        [sys.executable, "-I", "-c", SCRIPT], input=request, capture_output=True, text=True, timeout=30,
        env={"JHT_HOME": str(home), "PATH": "/usr/bin:/bin"},
    )
    assert done.returncode == 0, done.stderr
    lines = done.stdout.strip().splitlines()
    assert len(lines) == 1, done.stdout
    return json.loads(lines[0])


GONE = {"ok": False, "error": "window_unavailable"}
GOOD = {"updated_at": "2026-10-29T12:00:00+00:00", "last_usage": 93.4, "last_reset_at_unix": 1793300000.0,
        "last_provider": "codex", "last_status": "on_pace", "g_spot": {"lower": 1, "upper": 2}, "uncounted": {"x": 1}}


def test_the_script_is_found_in_the_rust_source():
    assert "sentinel-bridge-state.json" in SCRIPT and SCRIPT.count("emit(") >= 5


def test_it_answers_the_four_values_and_nothing_else(tmp_path):
    answer = run(tmp_path, state=GOOD)
    assert answer == {"ok": True, "provider": "codex", "usedPct": 93.4, "resetAtUnix": 1793300000.0, "updatedAtUnix": 1793275200.0}  # 2026-10-29T12:00:00Z
    assert set(answer) == {"ok", "provider", "usedPct", "resetAtUnix", "updatedAtUnix"}


def test_a_stamp_without_a_zone_is_read_as_utc_whatever_the_zone_of_the_machine(tmp_path):
    naive = dict(GOOD, updated_at="2026-10-29T12:00:00")
    assert run(tmp_path, state=naive)["updatedAtUnix"] == 1793275200.0


@pytest.mark.parametrize("field,value", [("last_usage", None), ("last_usage", "93"), ("last_usage", True), ("last_reset_at_unix", "soon")])
def test_a_missing_or_wrong_number_is_null_not_a_made_up_one(tmp_path, field, value):
    answer = run(tmp_path, state=dict(GOOD, **{field: value}))
    assert answer["ok"] is True
    assert answer["usedPct" if field == "last_usage" else "resetAtUnix"] is None


def test_a_provider_that_is_not_a_string_is_null(tmp_path):
    assert run(tmp_path, state=dict(GOOD, last_provider=7))["provider"] is None


def test_no_file_an_unreadable_one_or_one_that_is_not_an_object_is_unavailable(tmp_path):
    assert run(tmp_path / "none") == GONE
    assert run(tmp_path / "bad", raw="{not json") == GONE
    assert run(tmp_path / "list", raw="[1, 2]") == GONE


def test_no_time_of_writing_is_unavailable(tmp_path):
    without = {k: v for k, v in GOOD.items() if k != "updated_at"}
    assert run(tmp_path / "a", state=without) == GONE
    assert run(tmp_path / "b", state=dict(GOOD, updated_at="yesterday")) == GONE


@pytest.mark.parametrize("request_text", ['{"op":"clear"}\n', '{"op":"read","extra":1}\n', "not json\n", "\n", "[]\n"])
def test_only_the_one_request_it_knows_is_answered(tmp_path, request_text):
    assert run(tmp_path, request=request_text, state=GOOD) == GONE


def test_a_nan_an_infinity_or_a_huge_integer_in_the_file_is_null_and_never_an_error(tmp_path):
    raw = '{"updated_at": "2026-10-29T12:00:00+00:00", "last_usage": NaN, "last_reset_at_unix": Infinity, "last_provider": "codex"}'
    answer = run(tmp_path / "nan", raw=raw)
    assert answer["ok"] is True and answer["usedPct"] is None and answer["resetAtUnix"] is None
    huge = '{"updated_at": "2026-10-29T12:00:00+00:00", "last_usage": 1' + "0" * 400 + ', "last_reset_at_unix": -1' + "0" * 400 + "}"
    answer = run(tmp_path / "huge", raw=huge)
    assert answer["ok"] is True and answer["usedPct"] is None and answer["resetAtUnix"] is None
    assert json.dumps(answer, allow_nan=False)
