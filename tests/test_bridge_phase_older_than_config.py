"""The working phase the pacing-bridge wrote is older than the hours the person has just set: it is not believed (retest 25395266b)."""
import importlib.util
import json
import os
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = ROOT / ".launcher" / "sentinel-bridge.py"

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="il bridge gira nel container Linux")


@pytest.fixture()
def bridge(tmp_path, monkeypatch):
    home = tmp_path / "home"
    (home / "logs").mkdir(parents=True)
    monkeypatch.setenv("JHT_HOME", str(home))
    monkeypatch.setenv("PYTHONDONTWRITEBYTECODE", "1")
    spec = importlib.util.spec_from_file_location("sentinel_bridge_phase_test", BRIDGE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module, home


def _write(path, data, mtime):
    path.write_text(json.dumps(data), encoding="utf-8")
    os.utime(path, (mtime, mtime))


def test_phase_written_before_the_config_is_read_from_the_hours_of_the_config(bridge):
    module, home = bridge
    _write(home / "logs" / "pacing-bridge-state.json", {"current_window_target_pct": 40, "work_phase": "OFF"}, 1000)
    _write(home / "jht.config.json", {"team": {}}, 2000)    # 24/7: the hours were taken off after the phase was written
    assert module._read_dynamic_target() == (None, "ON")


def test_phase_written_after_the_config_is_believed(bridge):
    module, home = bridge
    _write(home / "jht.config.json", {"team": {}}, 1000)
    _write(home / "logs" / "pacing-bridge-state.json", {"current_window_target_pct": 40, "work_phase": "OFF"}, 2000)
    assert module._read_dynamic_target() == (40.0, "OFF")
