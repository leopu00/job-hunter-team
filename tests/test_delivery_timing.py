"""Measure an empty wake poll while checking that it never calls a transport."""
import json
import os
from pathlib import Path
import sqlite3
import statistics
import sys
import time

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared/skills"))
import application_answers


def test_empty_wake_poll_has_no_transport_work(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(application_answers, "pending_wakes", lambda *a: [])
    connection = sqlite3.connect(":memory:")
    calls = []
    samples = []
    for _ in range(5):
        start = time.perf_counter()
        for _ in range(1000):
            assert application_answers.wake_closer(connection, {}, sender=lambda *a: calls.append(a)) == []
        samples.append((time.perf_counter() - start) * 1000 / 1000)
    connection.close()
    assert calls == []
    result = {"case": "wake_closer_empty_poll", "iterations": 5000,
              "median_ms": statistics.median(samples), "samples_ms": samples}
    target = os.environ.get("JHT_DELIVERY_TIMING_OUTPUT")
    if target:
        Path(target).write_text(json.dumps(result), encoding="utf-8")
