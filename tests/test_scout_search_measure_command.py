"""The opt-in measurement command has no historical dependency during pytest."""
import importlib.util
import contextlib
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/measure_scout_search.py"


def load_command():
    spec = importlib.util.spec_from_file_location("scout_measure_command", SCRIPT)
    command = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(command)
    return command


def test_importing_the_command_does_not_read_git_history(monkeypatch):
    calls = []

    def no_git(*args, **kwargs):
        calls.append(args)
        pytest.fail("ordinary collection must not need Git or its objects")

    monkeypatch.setattr(subprocess, "run", no_git)
    assert callable(load_command().main)
    assert calls == []


def test_explicit_measurement_reports_a_missing_baseline_without_a_skip(monkeypatch, capsys):
    command = load_command()
    calls = []

    def unavailable(argv, **kwargs):
        calls.append(argv)
        return SimpleNamespace(returncode=128, stdout="", stderr="missing historical object")

    monkeypatch.setattr(subprocess, "run", unavailable)
    assert command.main(["--baseline", "7b54e495a"]) == 2
    output = capsys.readouterr()
    assert output.out == "" and "scout_measurement_unavailable" in output.err
    assert "baseline is not available" in output.err
    assert calls == [["git", "show", "7b54e495a:shared/skills/linkedin_access.py"]]


def test_explicit_command_keeps_both_sides_of_the_comparison(monkeypatch, capsys):
    command = load_command()
    baseline = object()
    calls = []
    monkeypatch.setattr(command, "baseline_module", lambda path, sha: contextlib.nullcontext(baseline))

    def measured(module, args, samples):
        calls.append((module, args, samples))
        return {"median_ms": 1.0 if module is baseline else 2.0, "requests_per_search": 2, "samples": samples}

    monkeypatch.setattr(command, "measure", measured)
    assert command.main(["--baseline", "7b54e495a", "--samples", "3"]) == 0
    output = capsys.readouterr()
    report = json.loads(output.out.removeprefix("SCOUT_SEARCH_TIMING "))
    assert report == {"baseline": "7b54e495a", "before": {"median_ms": 1.0, "requests_per_search": 2, "samples": 3},
                      "after": {"median_ms": 2.0, "requests_per_search": 2, "samples": 3}}
    assert calls[0][0] is baseline and calls[1][0] is command.current
    assert calls[0][1] == ["search", "--keywords", "data", "--location", "Milano"]
    assert "--profile" in calls[1][1] and [row[2] for row in calls] == [3, 3]


@pytest.mark.parametrize("args", [["--baseline", "not-a-sha"], ["--baseline", "7b54e495a", "--samples", "0"]])
def test_invalid_measurement_inputs_fail_before_reading_git(monkeypatch, args):
    command = load_command()
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: pytest.fail("Git must not run"))
    with pytest.raises(SystemExit) as failure:
        command.main(args)
    assert failure.value.code == 2


def test_historical_module_is_registered_during_measurement_and_restored_afterwards(monkeypatch, tmp_path):
    command = load_command()
    previous = object()
    monkeypatch.setitem(sys.modules, "scout_timing_baseline", previous)
    source = "import sys\nregistered_at_import = sys.modules[__name__]\ndef current_module():\n    return sys.modules[__name__]\n"
    monkeypatch.setattr(subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=0, stdout=source))
    with command.baseline_module(tmp_path, "7b54e495a") as baseline:
        assert baseline.registered_at_import is baseline
        assert baseline.current_module() is baseline
    assert sys.modules["scout_timing_baseline"] is previous
