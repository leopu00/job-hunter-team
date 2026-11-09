"""What agents on the pi harness spend is read from pi's own session files: tokens, cache and cost per call.

The sessions are built in the shape pi 1.5.0 writes (compact JSON, a header, a huge system line, one assistant message
per call with its `usage`), with made-up round numbers. Nothing here talks to a model.
"""

from __future__ import annotations

import importlib.util
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
import pi_sessions  # noqa: E402
import token_metrics_lib as tlib  # noqa: E402


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


boot_cost = _load("boot_cost_pi_test", ROOT / "shared" / "skills" / "boot_cost.py")

NOW = time.time()


def stamp(offset_s: float) -> str:
    return datetime.fromtimestamp(NOW + offset_s, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def compact(row: dict) -> str:
    return json.dumps(row, separators=(",", ":"))


def call(at, input_=0, output=0, cache_read=0, cache_write=0, reasoning=0, cost=0.0, content=None, model="gpt-x"):
    return {"type": "message", "id": "a%d" % at, "parentId": None, "timestamp": stamp(at), "message": {
        "role": "assistant", "content": content or [{"type": "text", "text": "ok"}], "model": model,
        "stopReason": "toolUse" if content else "stop", "durationMs": 1500,
        "usage": {"input": input_, "output": output, "cacheRead": cache_read, "cacheWrite": cache_write,
                  "reasoning": reasoning, "totalTokens": input_ + output + cache_read + cache_write,
                  "cost": {"total": cost, "totalFromProvider": False}}}}


def bash_call(command: str) -> list:
    return [{"type": "thinking", "thinking": ""}, {"type": "toolCall", "id": "c1", "name": "bash",
                                                       "arguments": {"command": command}}]


def session(home: Path, agent: str, rows: list, name="2026-11-09T10-00-00-000Z_s1.jsonl", sid="s1", age_s=0, raw_tail=""):
    folder = home / ".pi" / "agent" / "sessions" / f"--jht_home-agents-{agent}--"
    folder.mkdir(parents=True, exist_ok=True)
    head = {"type": "session", "version": 3, "id": sid, "timestamp": stamp(-3600), "cwd": f"/jht_home/agents/{agent}"}
    system = {"type": "message", "id": "sys", "timestamp": stamp(-3599),
              "message": {"role": "system", "content": "x" * 50_000, "sections": {"usage": "not a call"}}}
    user = {"type": "message", "id": "u", "timestamp": stamp(-3598),
            "message": {"role": "user", "content": [{"type": "text", "text": "usage"}]}}
    path = folder / name
    path.write_text("".join(compact(r) + "\n" for r in [head, system, user, *rows]) + raw_tail, encoding="utf-8")
    if age_s:
        os.utime(path, (NOW - age_s, NOW - age_s))
    return path


# --- pi_sessions ----------------------------------------------------------------------------------------------

def test_one_event_per_call_with_tokens_cost_and_the_agent_of_the_folder(tmp_path):
    session(tmp_path, "scout-1", [call(-3000, 3, 121, 0, 13_772, 26, 0.04), call(-2990, 3, 144, 13_772, 1_574, 0, 0.01)])
    events = pi_sessions.usage_events(tmp_path)
    assert [(e["agent"], e["session"], e["input"], e["output"], e["cache_read"], e["cache_write"], e["reasoning"])
            for e in events] == [("scout-1", "s1", 3, 121, 0, 13_772, 26), ("scout-1", "s1", 3, 144, 13_772, 1_574, 0)]
    assert [e["cost"] for e in events] == [0.04, 0.01] and events[0]["model"] == "gpt-x"
    assert events[0]["duration_ms"] == 1500 and events[0]["cost_from_provider"] is False
    assert events[1]["ts"] - events[0]["ts"] == pytest.approx(10, abs=0.01)


def test_the_system_and_user_lines_are_never_counted_even_if_they_say_usage(tmp_path):
    session(tmp_path, "scout-1", [])
    assert pi_sessions.usage_events(tmp_path) == []


def test_a_spaced_json_line_is_read_too(tmp_path):
    path = session(tmp_path, "scout-1", [])
    path.write_text(path.read_text(encoding="utf-8") + json.dumps(call(-10, 7, 8)) + "\n", encoding="utf-8")
    assert [(e["input"], e["output"]) for e in pi_sessions.usage_events(tmp_path)] == [(7, 8)]


def test_a_half_written_last_line_is_skipped_not_fatal(tmp_path):
    session(tmp_path, "scout-1", [call(-100, 5, 6)], raw_tail='{"type":"message","message":{"role":"assistant","usage":{"inp')
    assert [(e["input"], e["output"]) for e in pi_sessions.usage_events(tmp_path)] == [(5, 6)]


def test_only_events_stamped_inside_the_window_are_returned(tmp_path):
    session(tmp_path, "scout-1", [call(-7200, 1, 1), call(-60, 2, 2)])
    assert [e["input"] for e in pi_sessions.usage_events(tmp_path, NOW - 600)] == [2]
    assert [e["input"] for e in pi_sessions.usage_events(tmp_path)] == [1, 2]


def test_a_session_file_untouched_since_the_window_is_not_even_opened(tmp_path):
    session(tmp_path, "scout-1", [call(-60, 2, 2)], age_s=10 * 3600)
    assert pi_sessions.usage_events(tmp_path, NOW - 3600) == []


@pytest.mark.parametrize("bad", [-5, True, None, "7", float("nan")])
def test_a_number_that_is_not_a_count_is_zero(tmp_path, bad):
    row = call(-60, 4, 5)
    row["message"]["usage"]["output"] = bad
    row["message"]["usage"]["cost"]["total"] = bad
    session(tmp_path, "scout-1", [row])
    [event] = pi_sessions.usage_events(tmp_path)
    assert event["input"] == 4 and event["output"] == 0 and event["cost"] == 0


def test_a_call_without_a_stamp_or_without_usage_is_ignored(tmp_path):
    no_stamp, no_usage = call(-60, 1, 1), call(-50, 2, 2)
    del no_stamp["timestamp"]
    del no_usage["message"]["usage"]
    session(tmp_path, "scout-1", [no_stamp, no_usage, call(-40, 3, 3)])
    assert [e["input"] for e in pi_sessions.usage_events(tmp_path)] == [3]


def test_a_missing_or_foreign_folder_is_no_usage(tmp_path):
    assert pi_sessions.usage_events(tmp_path / "nowhere") == []
    (tmp_path / ".pi" / "agent" / "sessions").mkdir(parents=True)
    (tmp_path / ".pi" / "agent" / "sessions" / "notes.txt").write_text("usage", encoding="utf-8")
    assert pi_sessions.usage_events(tmp_path) == []


def test_two_agents_two_sessions_stay_apart_and_totals_add_up(tmp_path):
    session(tmp_path, "scout-1", [call(-100, 10, 20, 100, 1000, cost=0.5)], sid="a", name="a.jsonl")
    session(tmp_path, "analista", [call(-90, 1, 2, 3, 4, cost=0.25)], sid="b", name="b.jsonl")
    events = pi_sessions.usage_events(tmp_path)
    assert sorted((e["agent"], e["session"]) for e in events) == [("analista", "b"), ("scout-1", "a")]
    assert pi_sessions.totals(events) == {"input": 11, "output": 22, "cache_read": 103, "cache_write": 1004,
                                          "reasoning": 0, "cost": 0.75, "calls": 2}


def test_the_agent_comes_from_the_header_cwd():
    assert pi_sessions.agent_of({"cwd": "/jht_home/agents/Scout-2/"}) == "scout-2"
    assert pi_sessions.agent_of({"cwd": "/"}) is None and pi_sessions.agent_of({}) is None
    assert pi_sessions.agent_of({"cwd": 5}) is None


# --- token_metrics_lib ----------------------------------------------------------------------------------------

def test_pi_tokens_weigh_cache_reads_a_tenth_and_do_not_add_the_reasoning_twice():
    tokens = {"input": 10, "output": 100, "cache_read": 1000, "cache_write": 50, "reasoning": 40}
    assert tlib.billing_weighted(tokens, "pi") == 10 + 50 + 100 + 1000 * 0.1


def test_read_pi_events_have_the_shape_of_the_kimi_ones_so_the_rates_work(tmp_path):
    session(tmp_path, "scout-1", [call(-30, 100, 200, 0, 0, cost=0.1), call(-20, 0, 0)])
    events = tlib.read_pi_events(NOW - 600, jht_home=tmp_path)
    assert len(events) == 1, "a call that weighs nothing is not an event"
    assert set(events[0]) == {"ts", "session", "agent", "tokens", "weighted", "cost"}
    assert events[0]["weighted"] == 300 and events[0]["agent"] == "scout-1" and events[0]["cost"] == 0.1
    rates = tlib.rolling_rate_per_agent(events, 60.0, now_ts=NOW)
    assert rates["scout-1"]["weighted_60s"] == 300 and rates["scout-1"]["rate_tokens_per_min"] == 300


def test_read_pi_events_default_to_the_jht_home_of_the_process(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    session(tmp_path, "critico", [call(-30, 5, 5)])
    assert [e["agent"] for e in tlib.read_pi_events()] == ["critico"]


# --- token-meter ----------------------------------------------------------------------------------------------

@pytest.fixture
def meter(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    return _load("token_meter_pi_test", ROOT / "shared" / "skills" / "token-meter.py")


def test_the_meter_block_for_pi_sums_tokens_cost_and_agents(meter, tmp_path):
    session(tmp_path, "scout-1", [call(-60, 10, 20, 100, 1000, cost=0.5), call(-50, 1, 2, 3, 4, cost=0.25)], sid="a")
    block = meter.summarize_pi(tlib.read_pi_events(NOW - 3600, jht_home=tmp_path))
    assert (block["events"], block["sessions"], block["input_raw"], block["output_raw"]) == (2, 1, 11, 22)
    assert (block["cache_read_raw"], block["cache_creation_raw"], block["cost"]) == (103, 1004, 0.75)
    assert block["agents"] == {"scout-1": {"events": 2, "cost": 0.75}} and block["cost_is_estimate"] is True
    assert meter.summarize_pi([])["events"] == 0 and meter.summarize_pi([])["cost"] == 0.0


# --- boot_cost ------------------------------------------------------------------------------------------------

def test_boot_cost_reads_a_pi_session_by_role_with_the_programs_of_the_previous_call(tmp_path):
    rows = [call(-3500, 5, 300, 0, 40_000, content=bash_call("git status && rg x")),
            call(-3440, 20, 100, 40_000, 800),
            call(-100, 9, 9, 9, 9)]
    session(tmp_path, "scorer-2", rows)
    role, calls = boot_cost._calls_pi(next((tmp_path / ".pi").rglob("*.jsonl")))
    assert role == "scorer"
    first, second, _later = calls
    assert first[1:4] == (40_005, 0, 300) and first[4] == ()
    assert second[1:4] == (820, 40_000, 100) and second[4] == ("git", "rg")


def test_boot_cost_measure_counts_pi_next_to_the_other_harnesses(tmp_path):
    session(tmp_path, "capitano", [call(-3500, 5, 300, 0, 40_000), call(-3440, 20, 100, 40_000, 800)])
    report = boot_cost.measure(tmp_path, NOW - 7200, minutes=5)["roles"]["capitano"]
    assert report["sessions"] == 1 and report["first_call_context_median"] == 40_005 and report["calls"] == 2
    assert report["fresh_in"] == 40_005 + 820 and report["cached_in"] == 40_000 and report["out"] == 400


def test_boot_cost_does_not_follow_a_link_planted_in_the_pi_folder(tmp_path):
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "x.jsonl").write_text(compact(call(-60, 1, 1)) + "\n", encoding="utf-8")
    root = tmp_path / ".pi" / "agent" / "sessions"
    root.mkdir(parents=True)
    (root / "--link--").symlink_to(outside, target_is_directory=True)
    assert list(boot_cost.sessions(tmp_path, NOW - 7200)) == []
