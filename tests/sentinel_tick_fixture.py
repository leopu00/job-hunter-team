"""Execute one public bridge tick with synthetic providers and no live runtime."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]


class TickComplete(BaseException):
    pass


class SingleTick:
    def __init__(self, home, monkeypatch, *, active=False, within=True,
                 disabled=False, started=None, consumed=10, stats_failure=False):
        monkeypatch.setenv("JHT_HOME", str(home))
        spec = importlib.util.spec_from_file_location(
            "sentinel_single_tick", ROOT / ".launcher/sentinel-bridge.py")
        self.module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.module)
        self.real_announce = self.module._burn_intent_notify_user
        self.trace, self.phases, self.stats_args, self.pacing_args = [], [], [], []
        self.now, self.active, self.within = 1000000.0, active, within
        self.disabled, self.started, self.consumed = disabled, started, consumed
        self.stats_failure = stats_failure
        self._ports(monkeypatch)
        self._sampling(monkeypatch)
        self._daily(monkeypatch)

    def _ports(self, monkeypatch):
        noop = lambda *a, **k: None
        ports = {
            "acquire_singleton_lock": noop, "read_config": lambda: (None, "fixture"),
            "_do_fetch": lambda provider: ({"usage": 10}, None),
            "_read_dynamic_target": lambda: (75, "WORK" if self.within else "OFF"),
            "_within_working_hours": lambda phase: self.within,
            "_burn_intent_notify_user": lambda: self.trace.append("announce"),
            "_burn_intent_sweep": lambda: self.trace.append("burn_sweep"),
            "_burst_sweep": lambda: self.trace.append("burst_sweep"),
            "_burn_intent_status": self._intent,
            "_burn_intent_announce": noop, "_standby_step": noop, "_agent_pause_step": noop,
            "_enforce_daily_halt": lambda: self.trace.append("enforce_existing"),
            "session_exists": lambda session: False,
            "_next_tick_sleep_sec": lambda *a: 1,
            "_write_state_file": lambda *a, **k: self.trace.append("published"),
            "time": SimpleNamespace(time=lambda: self.now, sleep=self._sleep),
        }
        for name, value in ports.items():
            monkeypatch.setattr(self.module, name, value)

    def _sampling(self, monkeypatch):
        noop = lambda *a, **k: None
        ports = {
            "_compute_metrics_via_skill": lambda *a, **k: {
                "usage": 10, "projection": 50, "status": "NORMAL", "weekly_remaining_pct": 50},
            "load_last_sample": lambda: None,
            "load_recent_samples": lambda *a, **k: [],
            "write_jsonl": lambda entry: self.trace.append("sample"), "write_log": noop,
            "_write_role_usage": lambda *a: self.trace.append("role_usage"),
            "_WORK_STATS_MOD": SimpleNamespace(record=self._record_stats),
            "_pace_guard_step": lambda entry, **kw: self.pacing_args.append(kw),
            "_sample_vitals_and_maybe_alert": noop,
            "_fmt_reset": lambda *a: "fixture", "_read_pacing_pace": lambda: (1, 2),
            "_is_on_pace": lambda *a: True, "_is_quarter": lambda *a: False,
            "_weekly_pace_via_skill": lambda *a, **k: {"binding": False},
            "_maybe_offhours_stop": noop, "_build_tick_message": lambda *a: "fixture tick",
            "_write_last_tick": noop,
        }
        for name, value in ports.items():
            monkeypatch.setattr(self.module, name, value)

    def _daily(self, monkeypatch):
        ports = {
            "_daily_pacing_via_skill": lambda *a: {"budget": 10, "consumed": self.consumed},
            "_daily_hardstop_disabled": lambda: self.disabled,
            "_read_hardstop_override_started": self._read_override,
            "_persist_hardstop_override": self._persist_override,
            "_daily_halt_active": lambda: self.module._path("DAILY_HALT_FLAG").exists(),
            "_activate_daily_halt": self._halt,
        }
        for name, value in ports.items():
            monkeypatch.setattr(self.module, name, value)

    def _intent(self):
        self.trace.append("intent")
        return {"active": self.active, "remaining_min": 60}

    def _read_override(self):
        self.trace.append("read_override")
        return self.started

    def _persist_override(self, phase, started):
        self.phases.append((phase, started))
        self.started = started

    def _halt(self, consumed, cap, budget):
        self.trace.append("halt")
        self.module._path("DAILY_HALT_FLAG").write_text("fixture")
        return []

    def _record_stats(self, **kwargs):
        self.trace.append("stats")
        self.stats_args.append(kwargs)
        if self.stats_failure:
            raise OSError("fixture unavailable")

    def _sleep(self, seconds):
        if seconds == 1:
            self.remaining_ticks -= 1
            if self.remaining_ticks == 0:
                raise TickComplete()
            return
        self.trace.append("grace")

    def run(self, ticks=1):
        assert ticks > 0
        self.remaining_ticks = ticks
        with pytest.raises(TickComplete):
            self.module.main()
