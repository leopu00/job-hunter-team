"""JHT_TEST_SLICE=k/n (tests/conftest.py): the Windows gate runs one slice of its test files per job.

Five jobs with k = 0..4 must run every test once between them: a test in two slices is run twice, a test in none is
never run and the gate stays green. The tests list what a slice collects (`--collect-only`) on one small file.
"""
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
TARGET = "tests/test_windows_pull_progress.py"


def _collect(slice_spec=None):
    env = {key: value for key, value in os.environ.items() if key != "JHT_TEST_SLICE"}
    if slice_spec is not None:
        env["JHT_TEST_SLICE"] = slice_spec
    result = subprocess.run(
        [sys.executable, "-m", "pytest", TARGET, "--collect-only", "-q", "-p", "no:cacheprovider"],
        cwd=ROOT, env=env, capture_output=True, text=True, timeout=120,
    )
    ids = [line for line in result.stdout.splitlines() if line.startswith("tests/") and "::" in line]
    return result.returncode, ids, result.stdout + result.stderr


def test_the_slices_together_hold_every_test_once():
    code, everything, _ = _collect()
    assert code == 0 and len(everything) >= 5

    for n in (1, 2, 3, len(everything), len(everything) + 2):
        slices = []
        for k in range(n):
            code, ids, output = _collect(f"{k}/{n}")
            # n larger than the tests leaves empty slices: pytest then exits 5 («no tests collected»), not an error
            assert code in (0, 5), output
            slices.append(ids)
        merged = [test_id for ids in slices for test_id in ids]
        assert sorted(merged) == sorted(everything), f"{n} slices"
        assert len(merged) == len(set(merged)), f"a test in two of {n} slices"
        sizes = [len(ids) for ids in slices]
        assert max(sizes) - min(sizes) <= 1, f"{n} slices are not even: {sizes}"


def test_a_slice_takes_the_tests_at_its_place_not_whole_files():
    _, everything, _ = _collect()
    _, second, _ = _collect("1/2")
    assert second == everything[1::2]


@pytest.mark.parametrize("spec", ["abc", "1", "2/2", "-1/3", "0/0", "1/2/3"])
def test_a_slice_that_is_not_k_of_n_stops_the_run(spec):
    code, _, output = _collect(spec)
    assert code == 4, output  # pytest's usage error: the gate is red, not green on a wrong slice
    assert "JHT_TEST_SLICE must be k/n" in output
