"""Controlled before/after CPU+profile-I/O timings, with a fake transport only."""
import contextlib
import importlib.util
import io
import json
import subprocess
import sys
from pathlib import Path
from statistics import median
from time import perf_counter
from types import SimpleNamespace

from test_scout_search_scope import profile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared/skills"))
import linkedin_access as current


def baseline_module(tmp_path):
    source = subprocess.run(["git", "show", "7b54e495a:shared/skills/linkedin_access.py"],
                            cwd=ROOT, check=True, capture_output=True, text=True).stdout
    path = tmp_path / "baseline.py"
    path.write_text(source)
    spec = importlib.util.spec_from_file_location("scout_timing_baseline", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def measure(module, args, monkeypatch):
    hits = []
    html = ('<div class="base-card" data-entity-urn="urn:li:jobPosting:101"><h3>Data Analyst</h3>'
            '<span class="job-search-card__location">Milano</span></div>')

    def get(url, **kwargs):
        hits.append(url)
        return SimpleNamespace(status_code=200, text=html if "start=0" in url else ""), None

    monkeypatch.setattr(module, "_get", get)
    monkeypatch.setattr(module.time, "sleep", lambda seconds: None)
    times = []
    for _ in range(25):
        start = perf_counter()
        with contextlib.redirect_stdout(io.StringIO()):
            assert module.main(args) == 0
        times.append((perf_counter() - start) * 1000)
    assert len(hits) == 50
    return {"median_ms": median(times), "max_ms": max(times), "requests_per_search": 2, "samples": 25}


def test_before_after_search_measurement_uses_identical_fake_pages(profile, tmp_path, monkeypatch):
    path, _ = profile
    before = measure(baseline_module(tmp_path), ["search", "--keywords", "data", "--location", "Milano"], monkeypatch)
    after = measure(current, ["search", "--keywords", "data", "--profile", str(path)], monkeypatch)
    print("SCOUT_SEARCH_TIMING " + json.dumps({"baseline": "7b54e495a", "before": before, "after": after}))
    # Times are evidence, not a flaky wall-clock limit; transport requests must
    # stay constant while the new path also reads and checks the profile.
    assert before["requests_per_search"] == after["requests_per_search"]
