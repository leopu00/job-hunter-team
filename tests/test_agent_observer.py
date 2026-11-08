"""T220: real readers on synthetic session logs, meter and proc snapshots."""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared/skills"))
import agent_state as state
from agent_observer import Observer
from agent_observer_inputs import read_sessions, read_usage
from agent_process_usage import ProcessMeter, read_processes
from agent_session_identity import identity

NOW = 1_790_000_000


def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


def usage(home, agents, age=10):
    (home / "logs").mkdir(exist_ok=True)
    path = home / "logs/role-usage.json"
    path.write_text(json.dumps({"generated_at": iso(NOW-age), "agents_1h": agents}))
    return path


def codex(home, uid="capitano", created=NOW-300, model="gpt-5.6-luna"):
    cwd = home / "agents" / uid
    cwd.mkdir(parents=True, exist_ok=True)
    folder = home / ".codex/sessions" / datetime.fromtimestamp(NOW).strftime("%Y/%m/%d")
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"rollout-{uid}.jsonl"
    records = [
        {"type": "session_meta", "timestamp": iso(created), "payload": {"cwd": str(cwd), "model": "startup-sol"}},
        {"type": "turn_context", "timestamp": iso(created-50), "payload": {"model": "old-session", "effort": "high"}},
        {"type": "event_msg", "timestamp": iso(NOW-20), "payload": {"type": "task_started"}},
        {"type": "turn_context", "timestamp": iso(NOW-10), "payload": {"model": model, "effort": "low"}},
        {"type": "event_msg", "timestamp": iso(NOW-1), "payload": {"type": "agent_message", "message": "synthetic"}},
    ]
    path.write_text("\n".join(json.dumps(row) for row in records) + "\n")
    os.utime(path, (NOW, NOW))
    return path, records


def observer(home, names=("capitano",)):
    sessions = {name: {"created": NOW-300, "session": name.upper(), "pids": [100+i]}
                for i, name in enumerate(names)}
    return Observer(home, sessions=lambda: (sessions, []), processes=lambda: ({}, []),
                    meter=ProcessMeter(hz=100, page=4096, cpus=4, memory_bytes=4096*1000))


def test_real_instances_support_roles_and_stopped_usage_share_one_reader(tmp_path):
    usage(tmp_path, {"capitano": 35, "scout-4": 8, "scout-9": 2, "dottore": 0})
    for name in ("capitano", "scout-4", "dottore", "mantenitore"):
        codex(tmp_path, name)
    result = observer(tmp_path, ("capitano", "scout-4", "dottore", "mantenitore")).sample(NOW, 1)
    rows = {row["id"]: row for row in result["agents"]}
    assert set(rows) == {"capitano", "scout-4", "scout-9", "dottore", "mantenitore"}
    assert result["running"] == 4 and result["total"] == 5
    assert rows["capitano"]["identity"]["model"] == "gpt-5.6-luna"
    assert rows["capitano"]["identity"]["effort"] == "low"
    assert rows["capitano"]["state"] == "lavora"
    assert rows["scout-9"]["running"] is False and rows["scout-9"]["usage"]["tokens"] == 2
    assert rows["dottore"]["usage"]["tokens"] == 0  # An actual measured zero.
    assert rows["mantenitore"]["usage"] == {"tokens": None, "reason": "observer_usage_unattributed"}
    assert result["usage"]["unit"] == "weighted_tokens"
    assert result["usage"]["window"] == "1h" and result["usage"]["age_seconds"] == 10


@pytest.mark.parametrize("age", [901, -61])
def test_stale_or_future_usage_is_not_shown_as_a_current_value(tmp_path, age):
    usage(tmp_path, {"scout-4": 42}, age)
    result = observer(tmp_path, ()).sample(NOW, 1)
    assert result["agents"][0]["usage"] == {"tokens": None, "reason": "observer_usage_stale"}
    assert result["usage"]["generated_at"] == iso(NOW-age)
    assert "observer_usage_stale" in (tmp_path / "logs/runtime.log").read_text()


@pytest.mark.parametrize("value", [None, True, -1, float("nan"), float("inf"), "100", {}, [], 10**1000])
def test_invalid_usage_never_becomes_zero(tmp_path, value):
    usage(tmp_path, {"scout-4": value})
    result = observer(tmp_path, ()).sample(NOW, 1)
    assert result["agents"][0]["usage"]["tokens"] is None
    assert result["agents"][0]["usage"]["reason"] == "observer_usage_unattributed"
    json.dumps(result, allow_nan=False)


def test_missing_invalid_and_unreadable_meter_are_explicit(tmp_path):
    assert read_usage(tmp_path, NOW)["reason"] == "observer_usage_missing"
    path = usage(tmp_path, {"capitano": 1})
    path.write_text("{")
    assert read_usage(tmp_path, NOW)["reason"] == "observer_usage_invalid"
    path.unlink()
    path.symlink_to(tmp_path / "other.json")
    assert read_usage(tmp_path, NOW)["reason"] == "observer_usage_invalid"


def test_unknown_running_inventory_never_claims_stopped(tmp_path):
    usage(tmp_path, {"capitano": 1})
    tool = observer(tmp_path, ())
    tool.sessions = lambda: ({}, ["observer_sessions_unavailable"])
    result = tool.sample(NOW, 1)
    assert result["ok"] is False
    assert result["agents"][0]["running"] is None
    assert result["agents"][0]["state"] == "sconosciuto"
    assert "observer_sessions_unavailable" in (tmp_path / "logs/runtime.log").read_text()


def test_tmux_inventory_is_read_once_and_never_sends_keys():
    calls = []
    def run(argv, **kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=0, stderr="", stdout=(
            "CAPITANO\t100\t10\t0\nSCOUT-4\t101\t11\t0\nDOTTORE\t102\t12\t0\n"
            "MANTENITORE\t103\t13\t0\nUNRELATED\t100\t14\t0\n"))
    sessions, errors = read_sessions(run)
    assert not errors and set(sessions) == {"capitano", "scout-4", "dottore", "mantenitore"}
    assert len(calls) == 1 and calls[0][:3] == ["tmux", "list-panes", "-a"]
    assert sessions["scout-4"]["pids"] == [11]


@pytest.mark.parametrize("stdout", ["CAPITANO\tNaN\t10\t0", "CAPITANO\t100\t0\t0", "CAPITANO\t100\t10",
                                    "CAPITANO\t100\t10\t0\nJHT-CAPITANO\t100\t11\t0",
                                    "CAPITANO\t100\t10\t0\nSCOUT-1\t100\t10\t0"])
def test_malformed_or_ambiguous_inventory_fails_closed(stdout):
    assert read_sessions(lambda *_a, **_kw: SimpleNamespace(returncode=0, stdout=stdout)) == (
        {}, ["observer_sessions_invalid"])


def test_actual_session_change_is_refreshed_without_startup_defaults(tmp_path):
    path, records = codex(tmp_path)
    tool = observer(tmp_path)
    first = tool.sample(NOW, 0)
    assert first["agents"][0]["identity"]["model"] == "gpt-5.6-luna"
    records.append({"type": "turn_context", "timestamp": iso(NOW+1),
                    "payload": {"model": "gpt-5.6-terra", "effort": "high"}})
    path.write_text("\n".join(json.dumps(row) for row in records) + "\n")
    os.utime(path, (NOW+1, NOW+1))
    assert tool.sample(NOW+1, 1)["agents"][0]["identity"]["model"] == "gpt-5.6-luna"
    assert tool.sample(NOW+16, 16)["agents"][0]["identity"]["model"] == "gpt-5.6-terra"


def test_no_record_does_not_use_metadata_or_model_role_defaults(tmp_path):
    cwd = tmp_path / "agents/capitano"
    cwd.mkdir(parents=True)
    result = observer(tmp_path).sample(NOW, 1)
    assert result["agents"][0]["identity"] is None
    assert result["agents"][0]["state"] != "lavora"


def test_malformed_effort_and_terminal_controls_never_become_identity():
    lines = [json.dumps({"type": "turn_context", "timestamp": iso(NOW),
                         "payload": {"model": "gpt-5.6-luna", "effort": []}})]
    assert identity("codex", lines, NOW-1, state)["effort"] is None
    lines[0] = lines[0].replace("gpt-5.6-luna", "bad\\u001b[2J")
    assert identity("codex", lines, NOW-1, state)["model"] is None


def proc_entry(root, pid, parent, ticks, start=100, rss=20, status="S"):
    folder = root / str(pid)
    folder.mkdir(exist_ok=True)
    fields = ["0"] * 22
    for index, value in {0: status, 1: parent, 11: ticks, 12: 0, 19: start, 21: rss}.items():
        fields[index] = str(value)
    (folder / "stat").write_text(f"{pid} (fake (worker)) " + " ".join(fields))


def test_proc_cpu_rss_start_identity_and_no_double_count_for_one_tree(tmp_path):
    proc_entry(tmp_path, 100, 1, 20)
    proc_entry(tmp_path, 101, 100, 30)
    proc_entry(tmp_path, 999, 1, 1000)  # Not part of this agent.
    sessions = {"scout-4": {"pids": [100, 101]}}
    meter = ProcessMeter(hz=100, page=4096, cpus=4, memory_bytes=409600)
    processes, errors = read_processes(tmp_path)
    assert errors == []
    first = meter.sample(sessions, processes, 1)["scout-4"]
    assert first["cpu_pct"] is None and first["rss_bytes"] == 40 * 4096
    proc_entry(tmp_path, 101, 100, 430)
    second = meter.sample(sessions, read_processes(tmp_path)[0], 2)["scout-4"]
    assert second["cpu_pct"] == 100 and second["rss_pct"] == 40
    assert second["pids"] == [100, 101] and second["alive"] is True
    proc_entry(tmp_path, 101, 100, 800, start=101)
    assert meter.sample(sessions, read_processes(tmp_path)[0], 3)["scout-4"]["cpu_pct"] is None
    assert meter.sample(sessions, read_processes(tmp_path)[0], 4)["scout-4"]["cpu_pct"] == 0


def test_partial_or_missing_proc_is_nd_and_zombie_is_not_alive(tmp_path):
    proc_entry(tmp_path, 100, 1, 20, status="Z")
    meter = ProcessMeter(hz=100, page=4096, cpus=4, memory_bytes=409600)
    sessions = {"capitano": {"pids": [100]}}
    row = meter.sample(sessions, read_processes(tmp_path)[0], 1)["capitano"]
    assert row["alive"] is False and row["cpu_pct"] is None and row["rss_bytes"] is None
    assert read_processes(tmp_path / "missing")[1] == ["observer_process_unavailable"]
    row = meter.sample(sessions, {}, 2, partial=True)["capitano"]
    assert row["alive"] is None and row["cpu_pct"] is None


def test_runtime_log_link_is_not_written(tmp_path):
    usage(tmp_path, {})
    target = tmp_path / "sentinel"
    target.write_text("keep")
    (tmp_path / "logs/runtime.log").symlink_to(target)
    tool = observer(tmp_path)
    tool.sessions = lambda: ({}, ["observer_sessions_unavailable"])
    assert "observer_log_unavailable" in tool.sample(NOW, 1)["errors"]
    assert "observer_log_unavailable" in tool.sample(NOW+3, 4)["errors"]
    assert target.read_text() == "keep"


@pytest.mark.parametrize("part", ["header", "tail"])
def test_unreadable_session_log_is_unknown_not_never_started_and_is_logged(tmp_path, monkeypatch, part):
    path, _ = codex(tmp_path)
    tool = observer(tmp_path)
    if part == "header":
        original = Path.open
        def open_log(candidate, *args, **kwargs):
            if candidate == path:
                raise PermissionError("synthetic unreadable session")
            return original(candidate, *args, **kwargs)
        monkeypatch.setattr(Path, "open", open_log)
    else:
        original = state.tail_lines
        def tail_log(candidate, *args, **kwargs):
            if candidate == path:
                raise PermissionError("synthetic unreadable session")
            return original(candidate, *args, **kwargs)
        monkeypatch.setattr(state, "tail_lines", tail_log)
    result = tool.sample(NOW, 1)
    assert result["agents"][0]["identity"] is None
    assert result["agents"][0]["state"] == "sconosciuto"
    assert "observer_session_logs_unavailable" in result["errors"]
    assert "observer_session_logs_unavailable" in (tmp_path / "logs/runtime.log").read_text()
