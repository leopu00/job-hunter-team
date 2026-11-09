"""codex_usage.py and the cost block of token-meter.py: the calls of Codex and of Pi, priced by the model of each call.

Synthetic rollouts and Pi sessions with made-up numbers, shaped like the real ones (record types and fields of Codex and
Pi seen on 09/11/2026). No CLI is started.
"""
import importlib.util
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared/skills"))
import codex_usage  # noqa: E402
import model_pricing as mp  # noqa: E402

T0 = 1_790_000_000.0


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def meta(ts, cwd):
    return {"timestamp": iso(ts), "type": "session_meta", "payload": {"id": "s", "cwd": cwd}}


def turn(ts, model, cwd=None):
    return {"timestamp": iso(ts), "type": "turn_context", "payload": {"model": model, "effort": "high", "cwd": cwd}}


def usage(inp, cached, out, reasoning=0, written=0):
    return {"input_tokens": inp, "cached_input_tokens": cached, "cache_write_input_tokens": written,
            "output_tokens": out, "reasoning_output_tokens": reasoning, "total_tokens": inp + out}


def count(ts, last, total):
    return {"timestamp": iso(ts), "type": "event_msg",
            "payload": {"type": "token_count",
                        "info": {"total_token_usage": {"total_tokens": total}, "last_token_usage": last,
                                 "last_usage_includes_reasoning": True, "model_context_window": 258400}}}


def rollout(home, name, records, day="2026/10/01"):
    folder = Path(home) / ".codex" / "sessions" / day
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"rollout-{name}.jsonl"
    path.write_text("\n".join(json.dumps(r) for r in records) + "\n", encoding="utf-8")
    return path


def test_each_call_gets_the_model_of_the_turn_it_belongs_to(tmp_path):
    rollout(tmp_path, "a", [
        meta(T0, "/jht_home/agents/scout-1"),
        turn(T0 + 1, "gpt-5.6-terra"), count(T0 + 2, usage(1000, 400, 50), 1050),
        # the same session moves to another model for its next turn
        turn(T0 + 60, "gpt-5.6-sol"), count(T0 + 61, usage(2000, 0, 80, reasoning=30), 3130),
    ])
    calls = codex_usage.read_calls(tmp_path / ".codex" / "sessions")
    assert [(c["model"], c["agent"]) for c in calls] == [("gpt-5.6-terra", "scout-1"), ("gpt-5.6-sol", "scout-1")]
    assert calls[0]["fresh"] == 600 and calls[0]["cached"] == 400 and calls[0]["output"] == 50
    assert calls[1]["reasoning"] == 30 and calls[1]["output"] == 80, "the reasoning is inside the output already"


def test_a_count_repeated_with_nothing_new_is_one_call(tmp_path):
    same = usage(1000, 0, 50)
    rollout(tmp_path, "a", [meta(T0, "/x/agents/scout-1"), turn(T0 + 1, "gpt-5.6-terra"),
                            count(T0 + 2, same, 1050), count(T0 + 3, same, 1050),   # rate-limit refresh
                            {"timestamp": iso(T0 + 4), "type": "event_msg",
                             "payload": {"type": "token_count", "info": None}},
                            count(T0 + 5, usage(500, 0, 10), 1560)])
    assert len(codex_usage.read_calls(tmp_path / ".codex" / "sessions")) == 2


def test_only_the_window_is_read_and_a_broken_line_is_skipped(tmp_path):
    path = rollout(tmp_path, "a", [meta(T0, "/x/agents/scout-1"), turn(T0 + 1, "gpt-5.6-terra"),
                                   count(T0 + 2, usage(10, 0, 1), 11), count(T0 + 100, usage(20, 0, 2), 33)])
    with path.open("a") as handle:
        handle.write('{"timestamp": "half a line')
    calls = codex_usage.read_calls(tmp_path / ".codex" / "sessions", since_ts=T0 + 50)
    assert [c["fresh"] for c in calls] == [20]
    assert codex_usage.read_calls(tmp_path / "nothing-here") == []


def test_a_call_before_any_turn_context_has_no_model(tmp_path):
    rollout(tmp_path, "a", [meta(T0, "/x/agents/scout-1"), count(T0 + 2, usage(10, 0, 1), 11)])
    assert codex_usage.read_calls(tmp_path / ".codex" / "sessions")[0]["model"] is None


# ── the meter ───────────────────────────────────────────────────────────

def load_meter(home, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(home))
    spec = importlib.util.spec_from_file_location("token_meter_under_test", ROOT / "shared/skills/token-meter.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def pi_session(home, agent, calls, searches=0):
    folder = Path(home) / ".pi" / "agent" / "sessions" / f"--jht_home-agents-{agent}--"
    folder.mkdir(parents=True, exist_ok=True)
    rows = [{"type": "session", "version": 3, "id": f"pi-{agent}", "timestamp": iso(T0), "cwd": f"/jht_home/agents/{agent}"}]
    for n, (model, token) in enumerate(calls):
        rows.append({"type": "message", "timestamp": iso(T0 + 10 + n), "message": {
            "role": "assistant", "model": model, "usage": {
                "input": token[0], "cacheRead": token[1], "cacheWrite": token[2], "output": token[3], "reasoning": 0,
                "cost": {"total": 99.0, "totalFromProvider": False}}}})   # Pi's own figure is NOT what the meter uses
    if searches:
        rows.append({"type": "custom", "customType": "jht-web-search", "timestamp": iso(T0 + 50),
                     "data": {"searches": searches}})
    (folder / "2026-10-01T10-00-00-000Z_x.jsonl").write_text("\n".join(json.dumps(r) for r in rows) + "\n", encoding="utf-8")


def test_the_meter_prices_codex_and_pi_with_the_same_list_and_ignores_pis_own_figure(tmp_path, monkeypatch):
    rollout(tmp_path, "a", [meta(T0, "/jht_home/agents/scout-1"), turn(T0 + 1, "gpt-5.6-terra"),
                            count(T0 + 2, usage(200_000, 0, 100_000), 300_000)])
    pi_session(tmp_path, "analista-1", [("gpt-5.6-sol", (1_000, 2_000, 3_000, 4_000)), ("gpt-9-mystery", (1, 1, 1, 1))],
               searches=2)
    meter = load_meter(tmp_path, monkeypatch)
    out = meter.cost_summary("openai", T0 - 1)
    terra = (200_000 * 2 + 100_000 * 12) / 1e6
    sol = (1_000 * 4 + 2_000 * 0.4 + 3_000 * 5 + 4_000 * 20) / 1e6
    assert out["models"]["gpt-5.6-terra"]["usd"] == pytest.approx(terra, abs=1e-9)
    assert out["models"]["gpt-5.6-sol"]["usd"] == pytest.approx(sol, abs=1e-9)
    assert out["models"]["gpt-9-mystery"]["usd"] is None and out["unknown_models"] == ["gpt-9-mystery"]
    assert out["agents"]["scout-1"]["usd"] == pytest.approx(terra, abs=1e-9)
    assert out["agents"]["analista-1"]["usd"] is None and out["agents"]["analista-1"]["usd_known"] == pytest.approx(sol + 0.02, abs=1e-9)
    assert out["web_search"] == {"searches": 2, "usd": 0.02}
    assert out["usd"] is None and out["usd_known"] == pytest.approx(terra + sol + 0.02, abs=1e-9)
    assert out["usd_known"] < 99, "Pi's cost.total (99) is not used"


def test_a_team_on_kimi_or_claude_has_no_cost_block_yet(tmp_path, monkeypatch):
    meter = load_meter(tmp_path, monkeypatch)
    assert meter.cost_summary("kimi", T0) is None and meter.cost_summary("claude", T0) is None
