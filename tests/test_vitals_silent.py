"""A vitals sampler that falls silent is told, apart from the CPU alarm.

After the sustained-CPU rule a gap of samples is «don't know» and does not reset the
run. But if the sampler stops altogether nobody would notice: a defence that exists and
stops running in silence. The bridge takes the sample each tick, retries once when it
fails, and when vitals.jsonl has not grown for 3 ticks sends a distinct
[BRIDGE VITALS SILENT] (not a CPU/RAM alarm, nothing to retire workers for), at most
once an hour. Synthetic samples only.
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

NOW = datetime(2026, 10, 22, 9, 0, tzinfo=timezone.utc)


def sample(minutes_ago: float, pct: float = 3.0) -> dict:
    return {"ts": (NOW - timedelta(minutes=minutes_ago)).isoformat(),
            "cpu": {"pct": pct, "ncpu": 4, "load1": 0.4}, "mem": {"pct": 40.0}}


# ── host_vitals.sampler_silence ──

def test_a_regular_sampler_is_not_silent():
    assert hv.sampler_silence([sample(10), sample(5), sample(1)], NOW, 15 * 60) is None


def test_a_sampler_stopped_for_longer_than_the_limit_is_silent_and_says_how_long():
    silence = hv.sampler_silence([sample(60), sample(50), sample(40)], NOW, 15 * 60)
    assert silence == {"minutes": 40.0, "last": (NOW - timedelta(minutes=40)).isoformat()}


def test_the_limit_itself_is_not_yet_silence():
    assert hv.sampler_silence([sample(15)], NOW, 15 * 60) is None
    assert hv.sampler_silence([sample(15.5)], NOW, 15 * 60) is not None


def test_samples_without_a_readable_time_do_not_count_as_samples():
    samples = [sample(60), {"cpu": {"pct": 1.0}}, {"ts": "not a time"}]
    assert hv.sampler_silence(samples, NOW, 15 * 60)["minutes"] == 60.0


def test_no_sample_at_all_is_silent_only_since_the_bridge_started():
    # a file still empty accuses nobody before the bridge has had time to write
    assert hv.sampler_silence([], NOW, 15 * 60) is None
    assert hv.sampler_silence([], NOW, 15 * 60, since=NOW - timedelta(minutes=5)) is None
    assert hv.sampler_silence([], NOW, 15 * 60, since=NOW - timedelta(minutes=30)) == {
        "minutes": 30.0, "last": None}


def test_a_bridge_started_after_the_last_sample_counts_from_its_start():
    samples = [sample(600)]
    assert hv.sampler_silence(samples, NOW, 15 * 60, since=NOW - timedelta(minutes=3)) is None


def test_the_cpu_rule_does_not_read_the_silence():
    # an hour of silence between high samples still alerts (T32): silence is «don't know»
    samples = [dict(sample(65, 97.0), cpu={"pct": 97.0, "ncpu": 4, "load1": 4.0}),
               dict(sample(60, 98.0), cpu={"pct": 98.0, "ncpu": 4, "load1": 4.0}),
               dict(sample(0, 99.0), cpu={"pct": 99.0, "ncpu": 4, "load1": 4.1})]
    assert hv.cpu_pressure(samples)["minutes"] == 65.0


def test_the_command_line_answers_json(tmp_path):
    vitals = tmp_path / "vitals.jsonl"
    old = datetime.now(timezone.utc) - timedelta(minutes=40)
    vitals.write_text(json.dumps({"ts": old.isoformat(), "cpu": {"pct": 1.0}}) + "\n")
    run = subprocess.run([sys.executable, str(SKILL), "silent", "--file", str(vitals),
                          "--max-age-min", "15"], capture_output=True, text=True)
    assert run.returncode == 0
    assert json.loads(run.stdout)["minutes"] >= 40
    fresh = datetime.now(timezone.utc)
    vitals.write_text(json.dumps({"ts": fresh.isoformat(), "cpu": {"pct": 1.0}}) + "\n")
    run = subprocess.run([sys.executable, str(SKILL), "silent", "--file", str(vitals),
                          "--max-age-min", "15"], capture_output=True, text=True)
    assert json.loads(run.stdout) is None


# ── the bridge ──

def _bridge():
    spec = importlib.util.spec_from_file_location("sentinel_bridge_vitals_silent",
                                                  ROOT / ".launcher" / "sentinel-bridge.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def world(tmp_path, monkeypatch):
    """The real `silent` command on a temp vitals.jsonl; `sample` is whatever the test says."""
    module = _bridge()
    sent: list[str] = []
    attempts: list[int] = []
    vitals = tmp_path / "vitals.jsonl"
    real_run = subprocess.run
    behaviour = {"sample": "fail"}

    def run(argv, *args, **kwargs):
        if "sample" in argv:
            attempts.append(1)
            if behaviour["sample"] == "fail":
                return subprocess.CompletedProcess(argv, 1, "", "boom")
            record = sample(0)
            record["ts"] = datetime.now(timezone.utc).isoformat()
            with open(vitals, "a", encoding="utf-8") as handle:
                handle.write(json.dumps(record) + "\n")
            return subprocess.CompletedProcess(argv, 0, json.dumps(record) + "\n", "")
        if "notify-disk" in argv:
            return subprocess.CompletedProcess(argv, 0, "none\n", "")
        return real_run(argv, *args, **kwargs)

    monkeypatch.setattr(module.subprocess, "run", run)
    monkeypatch.setattr(module, "VITALS_FILE", vitals)
    monkeypatch.setattr(module, "jht_tmux_send", lambda session, text: sent.append(text))
    monkeypatch.setattr(module, "_LAST_VITALS_ALERT_AT", 0.0)
    monkeypatch.setattr(module, "_LAST_VITALS_SILENT_AT", 0.0)
    # the bridge has been up for a day
    monkeypatch.setattr(module, "_BRIDGE_STARTED_AT",
                        (datetime.now(timezone.utc) - timedelta(days=1)).isoformat())

    def write_samples(*minutes_ago):
        now = datetime.now(timezone.utc)
        vitals.write_text("".join(json.dumps(
            {"ts": (now - timedelta(minutes=m)).isoformat(),
             "cpu": {"pct": 2.0, "ncpu": 4, "load1": 0.3}, "mem": {"pct": 30.0}}) + "\n"
            for m in minutes_ago))

    return module, sent, attempts, behaviour, write_samples


def test_a_stopped_sampler_gets_a_silent_notice_that_is_not_a_cpu_alarm(world):
    module, sent, attempts, _, write_samples = world
    write_samples(60, 50, 40)
    module._sample_vitals_and_maybe_alert()
    (text,) = sent
    assert text.startswith("[BRIDGE VITALS SILENT] ")
    assert "VITALS ALERT" not in text
    assert "40 min" in text
    assert "NOT a CPU/RAM alarm" in text and "do not retire workers" in text
    assert "Tell the user" in text and "operator" not in text
    assert len(attempts) == 2, "one retry in the same tick"


def test_a_regular_sampler_says_nothing(world):
    module, sent, _, behaviour, write_samples = world
    behaviour["sample"] = "ok"
    write_samples(10, 5)
    module._sample_vitals_and_maybe_alert()
    assert sent == []


def test_a_failed_sample_is_retried_once_and_a_retry_that_works_is_silence_of_the_alarm(world):
    module, sent, attempts, behaviour, write_samples = world
    write_samples(60)
    calls = {"n": 0}
    real = module.subprocess.run

    def flaky(argv, *args, **kwargs):
        if "sample" in argv:
            calls["n"] += 1
            behaviour["sample"] = "fail" if calls["n"] == 1 else "ok"
        return real(argv, *args, **kwargs)

    module.subprocess.run = flaky
    module._sample_vitals_and_maybe_alert()
    assert calls["n"] == 2
    assert sent == []


def test_a_failure_inside_the_limit_is_not_yet_silence(world):
    module, sent, _, _, write_samples = world
    write_samples(14, 9, 4)
    module._sample_vitals_and_maybe_alert()
    assert sent == []


def test_the_limit_follows_the_tick_interval(world):
    module, sent, _, _, write_samples = world
    write_samples(40)
    module._sample_vitals_and_maybe_alert(30)       # 3 ticks of 30 min = 90 min
    assert sent == []
    module._sample_vitals_and_maybe_alert(5)        # 3 ticks of 5 min = 15 min
    assert len(sent) == 1


def test_the_notice_has_a_cooldown(world):
    module, sent, _, _, write_samples = world
    write_samples(60)
    module._sample_vitals_and_maybe_alert()
    module._sample_vitals_and_maybe_alert()
    assert len(sent) == 1


def test_a_bridge_just_started_with_no_samples_accuses_nobody(world, monkeypatch):
    module, sent, _, _, write_samples = world
    write_samples()
    monkeypatch.setattr(module, "_BRIDGE_STARTED_AT", datetime.now(timezone.utc).isoformat())
    module._sample_vitals_and_maybe_alert()
    assert sent == []


def test_a_bridge_up_for_hours_with_no_sample_at_all_is_silent(world):
    module, sent, _, _, write_samples = world
    write_samples()
    module._sample_vitals_and_maybe_alert()
    (text,) = sent
    assert text.startswith("[BRIDGE VITALS SILENT] ") and "the bridge start" in text


def test_the_sentinel_prompt_names_the_silent_notice_apart_in_every_language():
    for name in ("sentinella.md", "sentinella.it.md", "sentinella.es.md", "sentinella.fr.md",
                 "sentinella.de.md", "sentinella.pt.md", "sentinella.hu.md"):
        text = (ROOT / "agents" / "sentinella" / name).read_text(encoding="utf-8")
        alert = text.index("[BRIDGE VITALS ALERT] ")
        silent = text.index("[BRIDGE VITALS SILENT] ")
        assert silent > alert, name
        block = text[silent:text.index("\n```", silent)]
        assert "Capitan" in block and "Mantenitor" in block, name
        assert not any(w in block.lower() for w in ("operat", "opérat", "operador", "operátor")), name  # the person is the user
