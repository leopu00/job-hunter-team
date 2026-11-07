"""Synthetic dependencies for a single monitoring phase, without a daemon or tmux."""
from datetime import datetime, timezone
from types import SimpleNamespace


def context(parsed=None):
    events = []
    noop = lambda *a, **k: None
    api = SimpleNamespace(
        datetime=datetime, timezone=timezone, time=SimpleNamespace(time=lambda: 1000),
        read_config=lambda: (None, "fixture"), _do_fetch=lambda provider: (parsed, "fixture"),
        _read_dynamic_target=lambda: (None, "OFF"), _within_working_hours=lambda phase: False,
        _burn_intent_notify_user=noop, _burn_intent_sweep=noop, _burst_sweep=noop,
        _burn_intent_status=lambda: {"active": False}, _burn_intent_announce=noop,
        _standby_step=lambda value: events.append(("standby", value)),
        _agent_pause_step=lambda: events.append(("agent_pause", None)), _enforce_daily_halt=noop,
        _compute_metrics_via_skill=lambda *a, **k: {"usage": 10},
        write_jsonl=lambda value: events.append(("sample", value)), write_log=noop,
        _write_role_usage=noop, _record_work_stats=noop, _pace_guard_step=noop,
        _sample_vitals_and_maybe_alert=noop, ANCHOR_TICK_MIN=5,
    )
    run = SimpleNamespace(state={}, is_first_tick=True)
    return api, run, events
