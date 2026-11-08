"""The daily hard-coast orders itself from «consumed today» = the weekly now minus the first reading of today's window.

On a real team (02/11) a wrong 0 read in the budget counter was taken for a reset; the same wrong reading as the first
one of the window would make the consumption the whole week. The baseline skips an isolated wrong reading (pace_rate).
"""
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "shared" / "skills"))
UTC = timezone.utc


def test_the_daily_consumption_does_not_start_from_a_wrong_zero(monkeypatch, tmp_path):
    """The hard-coast of the day orders itself from «consumed today» = the weekly now minus the first reading of today's
    window. A wrong 0 as that first reading made the consumption the whole week."""
    import importlib.util
    import json as _json
    home = tmp_path / "jht"
    home.mkdir()
    monkeypatch.setenv("JHT_HOME", str(home))
    spec = importlib.util.spec_from_file_location("sentinel_bridge_daily_under_test", REPO / ".launcher" / "sentinel-bridge.py")
    bridge = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bridge)
    cfg = {"team": {"working_hours": {"timezone": "Europe/Budapest",
           "windows": [{"days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], "start": "22:00", "end": "08:00"}]}}}
    monkeypatch.setattr(bridge, "_read_config_json", lambda: cfg)
    start = datetime(2026, 11, 2, 21, 0, tzinfo=UTC)          # 22:00 in Budapest: the window opens
    before = [(start - timedelta(minutes=10), 70.0), (start - timedelta(minutes=5), 70.0)]
    samples = before + [(start, 70.0), (start + timedelta(minutes=5), 0.0), (start + timedelta(minutes=10), 70.0),
                        (start + timedelta(minutes=15), 70.0), (start + timedelta(minutes=20), 71.0)]
    data = tmp_path / "sentinel-data.jsonl"
    data.write_text("".join(_json.dumps({"ts": t.isoformat(), "weekly_usage": w}) + "\n" for t, w in samples), encoding="utf-8")
    monkeypatch.setitem(bridge._PATHS, "DATA_JSONL", data)
    now = start + timedelta(hours=2)
    reset = (datetime(2026, 11, 4, 6, 35, tzinfo=UTC)).timestamp()
    entry = {"weekly_usage": 75.0, "weekly_remaining_pct": 25.0, "weekly_reset_at_unix": reset}
    daily = bridge._daily_pacing_via_skill(entry, now, now.timestamp())
    assert daily["consumed"] == 5.0, daily            # 75 - 70, not 75 - 0
    # and a wrong zero in the first position of the window
    samples[2] = (start, 0.0)                          # the wrong zero is now the first reading of the window
    data.write_text("".join(_json.dumps({"ts": t.isoformat(), "weekly_usage": w}) + "\n" for t, w in samples), encoding="utf-8")
    assert bridge._daily_pacing_via_skill(entry, now, now.timestamp())["consumed"] == 5.0
