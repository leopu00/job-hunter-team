"""The CPU vitals alert: sustained pressure the load confirms, never one sample.

shared/skills/host_vitals.py measured /proc/stat over 0.25 s and the bridge sent a
[BRIDGE VITALS ALERT] on ONE sample >= 95%. On a 4-core VPS: 7 samples out of 565 in
two days, all isolated (their neighbours ~0), load 0.2-2.6, and the Capitano retired
a scout at each alert. Now one measure lasts CPU_SAMPLE_S, and the alert wants
CPU_ALERT_RUN consecutive measured samples >= the threshold (a missing measure or a
silent sampler is «don't know», never «all clear»), with load1 >=
0.9 x ncpu on the last one; its text says how long and the load per core.
Synthetic samples only.
"""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "shared" / "skills" / "host_vitals.py"
sys.path.insert(0, str(SKILL.parent))

import host_vitals as hv  # noqa: E402

T0 = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)


def sample(minute: float, pct: float | None, load1: float | None = 0.5, ncpu: int = 4) -> dict:
    return {"ts": (T0 + timedelta(minutes=minute)).isoformat(),
            "cpu": {"pct": pct, "ncpu": ncpu, "load1": load1, "load5": None, "load15": None},
            "mem": {"pct": 40.0}}


def test_an_isolated_spike_is_no_alert():
    # as measured: one high reading between quiet ones, load well under the cores
    samples = [sample(0, 1.0), sample(5, 98.7, load1=0.6), sample(10, 0.4)]
    assert hv.cpu_pressure(samples) is None
    # the spike as the LAST sample, too
    assert hv.cpu_pressure([sample(0, 0.3), sample(5, 0.5), sample(10, 99.0, load1=2.6)]) is None


def test_three_consecutive_high_samples_with_a_high_load_are_an_alert_that_says_how_long():
    samples = [sample(0, 2.0), sample(5, 96.0, 3.7), sample(10, 98.5, 3.9), sample(15, 99.1, 4.2)]
    assert hv.cpu_pressure(samples) == {"pcts": [96.0, 98.5, 99.1], "samples": 3, "minutes": 10.0,
                                        "load1": 4.2, "ncpu": 4}


@pytest.mark.parametrize("samples", [
    # high CPU but the load does not confirm it: 2.6 on 4 cores is not saturation
    [sample(0, 97.0, 2.6), sample(5, 98.0, 2.6), sample(10, 99.0, 2.6)],
    # two high samples only
    [sample(0, 1.0), sample(5, 97.0, 4.0), sample(10, 99.0, 4.0)],
    # two measured samples around one that could not be measured are still two
    [sample(0, 97.0, 4.0), sample(5, None, 4.0), sample(10, 99.0, 4.0)],
    [sample(0, 97.0, 4.0), {"cpu": {"pct": 98.0, "ncpu": 4, "load1": 4.0}}, sample(10, 99.0, 4.0)],
    # the last one without the load confirms nothing
    [sample(0, 97.0, 4.0), sample(5, 98.0, 4.0), sample(10, 99.0, None)],
])
def test_anything_short_of_sustained_and_confirmed_is_no_alert(samples):
    assert hv.cpu_pressure(samples) is None


def test_one_measure_lasts_long_enough_to_see_more_than_a_burst():
    assert hv.CPU_SAMPLE_S >= 1.0
    assert hv._cpu.__defaults__ == (hv.CPU_SAMPLE_S,)


def test_the_command_reads_the_last_samples_of_the_file(tmp_path):
    path = tmp_path / "vitals.jsonl"
    lines = [sample(0, 99.0, 4.0), sample(5, 0.5), "not json",
             sample(10, 97.0, 4.0), sample(15, 98.0, 4.0), sample(20, 99.0, 4.0)]
    path.write_text("\n".join(x if isinstance(x, str) else json.dumps(x) for x in lines) + "\n")
    run = lambda: subprocess.run([sys.executable, str(SKILL), "cpu-pressure", "--file", str(path)],  # noqa: E731
                                 capture_output=True, text=True, timeout=30)
    done = run()
    assert done.returncode == 0, done.stderr
    assert json.loads(done.stdout)["minutes"] == 10.0
    path.write_text(json.dumps(sample(0, 99.0, 4.0)) + "\n")
    assert json.loads(run().stdout) is None


# ── the bridge: the alert goes out only for the sustained pressure, and says it ──

def _bridge():
    spec = importlib.util.spec_from_file_location("sentinel_bridge_vitals", ROOT / ".launcher" / "sentinel-bridge.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def bridge(tmp_path, monkeypatch):
    module = _bridge()
    sent = []
    vitals = tmp_path / "vitals.jsonl"
    real_run = subprocess.run

    def run(argv, *args, **kwargs):
        # the skill's `sample` and `notify-disk` stand in; `cpu-pressure` is the real one
        if "sample" in argv:
            last = json.loads(vitals.read_text().splitlines()[-1])
            return subprocess.CompletedProcess(argv, 0, json.dumps(last) + "\n", "")
        if "notify-disk" in argv:
            return subprocess.CompletedProcess(argv, 0, "none\n", "")
        return real_run(argv, *args, **kwargs)

    monkeypatch.setattr(module.subprocess, "run", run)
    monkeypatch.setattr(module, "VITALS_FILE", vitals)
    monkeypatch.setattr(module, "jht_tmux_send", lambda session, text: sent.append(text))
    monkeypatch.setattr(module, "_LAST_VITALS_ALERT_AT", 0.0)

    def tick(samples):
        vitals.write_text("".join(json.dumps(x) + "\n" for x in samples))
        module._sample_vitals_and_maybe_alert()
        return sent

    return tick


def test_the_bridge_stays_silent_on_an_isolated_spike(bridge):
    assert bridge([sample(0, 0.2), sample(5, 0.4), sample(10, 98.9, 0.8)]) == []


def test_the_bridge_alerts_on_sustained_pressure_with_duration_and_load(bridge):
    (text,) = bridge([sample(0, 96.0, 3.8), sample(5, 97.5, 4.0), sample(10, 99.0, 4.1)])
    assert text.startswith("[BRIDGE VITALS ALERT] Container resources above threshold: ")
    assert "CPU 96%/97.5%/99% over 3 consecutive samples (10 min), load1 4.1 on 4 cores" in text
    assert "a single CPU spike never arrives here" in text


def test_a_silent_sampler_is_not_knowing_never_all_clear():
    # the sampler quiet for an hour between two high samples: the run goes on, and the alert says how long
    samples = [sample(0, 97.0, 4.0), sample(5, 98.0, 4.0), sample(65, 99.0, 4.1)]
    assert hv.cpu_pressure(samples) == {"pcts": [97.0, 98.0, 99.0], "samples": 3, "minutes": 65.0,
                                        "load1": 4.1, "ncpu": 4}
    # only a MEASURED sample under the threshold resets it
    assert hv.cpu_pressure([sample(0, 97.0, 4.0), sample(5, 20.0, 4.0), sample(65, 99.0, 4.1)]) is None


def test_a_sample_the_machine_could_not_measure_does_not_break_the_run():
    # saturation can cost a measure (the sampler late, /proc/stat unreadable): it is skipped, not a reset
    samples = [sample(0, 97.0, 3.9), sample(5, None, 3.9), {"cpu": {"pct": 98.0}}, sample(10, 98.0, 3.9),
               sample(15, 99.0, 4.0)]
    assert hv.cpu_pressure(samples) == {"pcts": [97.0, 98.0, 99.0], "samples": 3, "minutes": 15.0,
                                        "load1": 4.0, "ncpu": 4}
