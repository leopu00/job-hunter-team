"""With the pi harness the Codex auth healer is not started and not expected: no respawn of the bridge suite every ~38 s.

The healer cures the refresh token SHARED by the Codex agents, reading their panes for Codex's own messages. On pi there is
nothing to cure; `start-agent.sh bridge` used to start it anyway and process_health.py expected it, so a healer that was not
alive made the watchdog of the bridge respawn the whole suite on every tick (D8 of the 10/11 CLI test).
"""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from test_bridge_suite_failure_aggregation import DAEMONS, _launcher_with_daemons  # noqa: E402

import subprocess  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent


@pytest.fixture
def health(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location("process_health", REPO_ROOT / "shared" / "skills" / "process_health.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _row(health, name="codex-auth-healer"):
    return next(r for r in health.scan()["rows"] if r["name"] == name)


@pytest.mark.parametrize("harness, optional", [("pi", True), ("codex", False), (None, False)])
def test_the_healer_is_optional_only_on_pi(health, tmp_path, monkeypatch, harness, optional):
    monkeypatch.setattr(health, "_cmdlines", lambda: [])
    config = {"active_provider": "glm"}
    if harness:
        config["harness"] = harness
    (tmp_path / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")
    row = _row(health)
    assert row["alive"] is False
    assert bool(row.get("optional")) is optional
    # the other daemons of the suite are expected on every harness
    assert not _row(health, "sentinel-bridge").get("optional")


def test_a_missing_or_broken_config_keeps_the_healer_expected(health, tmp_path, monkeypatch):
    monkeypatch.setattr(health, "_cmdlines", lambda: [])
    assert not _row(health).get("optional")
    (tmp_path / "jht.config.json").write_text("{not json", encoding="utf-8")
    assert not _row(health).get("optional")


def test_the_bridge_suite_on_pi_does_not_start_the_healer_and_does_not_fail_for_it(tmp_path):
    launcher, environment, home = _launcher_with_daemons(tmp_path)
    (home / "jht.config.json").write_text(json.dumps({"active_provider": "glm", "harness": "pi"}), encoding="utf-8")
    result = subprocess.run([str(launcher), "bridge"], env=environment, capture_output=True, text=True, timeout=30, check=False)
    assert "codex-auth-healer not needed" in result.stdout
    # every kill is refused in this fixture: the suite fails, naming every daemon except the healer
    summary = next(line for line in result.stderr.splitlines() if "bridge suite incomplete" in line)
    for label in set(DAEMONS) - {"codex-auth-healer"}:
        assert label in summary
    assert "codex-auth-healer" not in summary


def test_the_bridge_suite_on_codex_still_starts_the_healer(tmp_path):
    launcher, environment, home = _launcher_with_daemons(tmp_path)
    (home / "jht.config.json").write_text(json.dumps({"active_provider": "openai"}), encoding="utf-8")
    result = subprocess.run([str(launcher), "bridge"], env=environment, capture_output=True, text=True, timeout=30, check=False)
    assert "codex-auth-healer not needed" not in result.stdout
    summary = next(line for line in result.stderr.splitlines() if "bridge suite incomplete" in line)
    assert "codex-auth-healer" in summary
