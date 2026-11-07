#!/usr/bin/env python3
"""Opt-in before/after CPU+profile-I/O measurement with a fake transport.

Run from the test queue: python3 scripts/measure_scout_search.py --baseline <SHA>.
The historical object must be available locally. No fetching is attempted.
This is not part of the ordinary pytest suite and measures no live provider.
"""
import argparse
import contextlib
import importlib.util
import io
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path
from statistics import median
from time import perf_counter
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared/skills"))
import linkedin_access as current


class BaselineUnavailable(RuntimeError):
    pass


@contextlib.contextmanager
def baseline_module(tmp_path, sha):
    result = subprocess.run(["git", "show", f"{sha}:shared/skills/linkedin_access.py"],
                            cwd=ROOT, check=False, capture_output=True, text=True)
    if result.returncode:
        raise BaselineUnavailable("The requested baseline is not available in this checkout; provide its Git object before measuring.")
    path = tmp_path / "baseline.py"
    path.write_text(result.stdout)
    spec = importlib.util.spec_from_file_location("scout_timing_baseline", path)
    module = importlib.util.module_from_spec(spec)
    absent = object()
    previous = sys.modules.get(spec.name, absent)
    sys.modules[spec.name] = module
    try:
        spec.loader.exec_module(module)
        yield module
    finally:
        if previous is absent:
            sys.modules.pop(spec.name, None)
        else:
            sys.modules[spec.name] = previous


def measure(module, args, samples):
    hits = []
    html = ('<div class="base-card" data-entity-urn="urn:li:jobPosting:101"><h3>Data Analyst</h3>'
            '<span class="job-search-card__location">Milano</span></div>')

    def get(url, **kwargs):
        hits.append(url)
        return SimpleNamespace(status_code=200, text=html if "start=0" in url else ""), None

    times = []
    with patch.object(module, "_get", get), patch.object(module.time, "sleep", lambda seconds: None):
        for _ in range(samples):
            start = perf_counter()
            with contextlib.redirect_stdout(io.StringIO()):
                if module.main(args) != 0:
                    raise RuntimeError("The synthetic search failed; no measurement is valid.")
            times.append((perf_counter() - start) * 1000)
    if len(hits) != samples * 2:
        raise RuntimeError("The synthetic request count changed; no measurement is valid.")
    return {"median_ms": median(times), "max_ms": max(times), "requests_per_search": 2, "samples": samples}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--baseline", required=True, help="locally available commit SHA, never a branch or a network fetch")
    parser.add_argument("--samples", type=int, default=25)
    args = parser.parse_args(argv)
    if not re.fullmatch(r"[0-9a-fA-F]{7,40}", args.baseline) or args.samples <= 0:
        parser.error("provide a commit SHA and a positive sample count")
    try:
        with tempfile.TemporaryDirectory(prefix="scout-measure-") as folder:
            root = Path(folder)
            profile = root / "candidate_profile.yml"
            profile.write_text("name: Synthetic Candidate\ntarget_role: Data Analyst\nlocation: Milano\n"
                               "preferences:\n  work_mode: ibrido\n  relocation: false\n")
            with baseline_module(root, args.baseline) as baseline:
                before = measure(baseline, ["search", "--keywords", "data", "--location", "Milano"], args.samples)
            after = measure(current, ["search", "--keywords", "data", "--profile", str(profile)], args.samples)
        print("SCOUT_SEARCH_TIMING " + json.dumps({"baseline": args.baseline, "before": before, "after": after}))
        return 0
    except (OSError, RuntimeError) as exc:
        print(f"scout_measurement_unavailable: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
