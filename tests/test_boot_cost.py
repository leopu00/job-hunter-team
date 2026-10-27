"""boot_cost.py reads the session files of the provider CLIs and says what each role spends right after it starts."""

from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "shared" / "skills" / "boot_cost.py"
spec = importlib.util.spec_from_file_location("boot_cost", SCRIPT)
boot_cost = importlib.util.module_from_spec(spec)
spec.loader.exec_module(boot_cost)

NOW = time.time()


def _iso(offset_s: float) -> str:
    return datetime.fromtimestamp(NOW - 3600 + offset_s, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def _write(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def _codex(home: Path, name: str, role: str, calls: list[tuple[float, int, int, int]]) -> None:
    rows = [{"type": "session_meta", "timestamp": _iso(0), "payload": {"cwd": f"/jht_home/agents/{role}"}},
            {"type": "event_msg", "timestamp": _iso(0), "payload": {"type": "token_count", "info": None}}]
    for at, total_in, cached, out in calls:
        rows.append({"type": "event_msg", "timestamp": _iso(at), "payload": {"type": "token_count", "info": {
            "last_token_usage": {"input_tokens": total_in, "cached_input_tokens": cached, "output_tokens": out,
                                 "reasoning_output_tokens": 0}}}})
    _write(home / ".codex" / "sessions" / "2026" / "10" / "27" / f"rollout-{name}.jsonl", rows)


def _claude(home: Path, name: str, role: str, calls: list[tuple[float, int, int, int, int]]) -> None:
    rows = [{"timestamp": _iso(at), "message": {"usage": {
        "input_tokens": fresh, "cache_creation_input_tokens": created, "cache_read_input_tokens": read,
        "output_tokens": out}}} for at, fresh, created, read, out in calls]
    _write(home / ".claude" / "projects" / f"-jht-home-agents-{role}" / f"{name}.jsonl", rows)


def test_codex_session_first_call_and_first_minutes(tmp_path: Path):
    # first call 40k of context (all fresh: cold cache), then two more in the window, one after it
    _codex(tmp_path, "a", "capitano", [(5, 40_000, 0, 300), (60, 41_000, 40_000, 200), (200, 42_000, 41_000, 100),
                                       (900, 50_000, 49_000, 999)])
    out = boot_cost.measure(tmp_path, NOW - 7200, minutes=5)["roles"]["capitano"]
    assert out["sessions"] == 1 and out["first_call_context_median"] == 40_000
    assert out["calls"] == 3  # the call at 900 s is outside the first 5 minutes
    assert out["fresh_in"] == 40_000 + 1_000 + 1_000
    assert out["cached_in"] == 0 + 40_000 + 41_000
    assert out["out"] == 600


def test_claude_session_cache_creation_counts_as_fresh_input(tmp_path: Path):
    _claude(tmp_path, "s1", "sentinella", [(3, 10, 9_000, 0, 50), (40, 20, 100, 9_000, 70)])
    out = boot_cost.measure(tmp_path, NOW - 7200, minutes=10)["roles"]["sentinella"]
    assert out["first_call_context_median"] == 10 + 9_000
    assert out["fresh_in"] == 10 + 9_000 + 20 + 100 and out["cached_in"] == 9_000 and out["out"] == 120


def test_roles_are_separated_means_and_medians_per_role(tmp_path: Path):
    for i, size in enumerate((10_000, 30_000, 20_000)):
        _codex(tmp_path, f"m{i}", "scout", [(2, size, 0, 100)])
    _codex(tmp_path, "z", "mentor", [(2, 4_000, 0, 10)])
    report = boot_cost.measure(tmp_path, NOW - 7200, minutes=10)["roles"]
    assert report["scout"]["sessions"] == 3 and report["scout"]["first_call_context_median"] == 20_000
    assert report["mentor"]["first_call_context_median"] == 4_000


def test_a_name_that_is_not_a_role_and_a_session_older_than_the_period_are_not_counted(tmp_path: Path):
    _codex(tmp_path, "x", "somebody-else", [(2, 5_000, 0, 1)])
    _codex(tmp_path, "old", "scout", [(2, 5_000, 0, 1)])
    assert boot_cost.measure(tmp_path, NOW - 600, minutes=10)["roles"] == {}  # both began 1 h ago
    assert boot_cost.role_of("analista-3") == "analista" and boot_cost.role_of("critico_S2") == "critico"
    assert boot_cost.role_of("?unknown") is None and boot_cost.role_of(None) is None


def test_it_prints_numbers_and_role_names_only(tmp_path: Path):
    _codex(tmp_path, "a", "capitano", [(5, 40_000, 0, 300)])
    # a line that carries text of the conversation must never reach the output
    path = next((tmp_path / ".codex").rglob("rollout-a.jsonl"))
    path.write_text(path.read_text(encoding="utf-8")
                    + json.dumps({"type": "response_item", "timestamp": _iso(6), "payload": {"text": "SECRET-CV-TEXT"}}) + "\n",
                    encoding="utf-8")
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(tmp_path), "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, "-I", str(SCRIPT), "--hours", "3", "--json"],
                          capture_output=True, text=True, env=env, timeout=60, check=False)
    assert done.returncode == 0 and "SECRET-CV-TEXT" not in done.stdout + done.stderr and str(tmp_path) not in done.stdout
    assert json.loads(done.stdout)["roles"]["capitano"]["first_call_context_median"] == 40_000
    table = subprocess.run([sys.executable, "-I", str(SCRIPT), "--hours", "3"],
                           capture_output=True, text=True, env=env, timeout=60, check=False).stdout
    assert "capitano" in table and "first call" in table


def test_empty_home_is_an_empty_report_not_an_error(tmp_path: Path):
    assert boot_cost.measure(tmp_path, NOW - 7200, minutes=10) == {"minutes": 10, "roles": {}}
    assert "no session started" in boot_cost.render(boot_cost.measure(tmp_path, NOW - 7200, minutes=10))


def test_a_link_in_the_session_folders_is_not_followed(tmp_path: Path):
    outside = tmp_path / "outside"
    _codex(outside, "s", "capitano", [(2, 5_000, 0, 1)])
    target = next((outside / ".codex").rglob("rollout-s.jsonl"))
    folder = tmp_path / "home" / ".codex" / "sessions" / "2026" / "10" / "27"
    folder.mkdir(parents=True)
    (folder / "rollout-link.jsonl").symlink_to(target)  # a file link
    claude = tmp_path / "home" / ".claude" / "projects"
    claude.mkdir(parents=True)
    _claude(outside, "c", "scout", [(2, 1, 0, 0, 1)])
    (claude / "-jht-home-agents-scout").symlink_to(outside / ".claude" / "projects" / "-jht-home-agents-scout")  # a folder link
    assert boot_cost.measure(tmp_path / "home", NOW - 7200, minutes=10)["roles"] == {}
    # the same files, there for real, are read
    _codex(tmp_path / "home", "real", "capitano", [(2, 5_000, 0, 1)])
    assert "capitano" in boot_cost.measure(tmp_path / "home", NOW - 7200, minutes=10)["roles"]


def test_a_file_over_the_size_bound_is_not_read(tmp_path: Path, monkeypatch):
    _codex(tmp_path, "big", "capitano", [(2, 5_000, 0, 1)])
    monkeypatch.setattr(boot_cost, "MAX_SESSION_BYTES", 10)
    assert boot_cost.measure(tmp_path, NOW - 7200, minutes=10)["roles"] == {}
