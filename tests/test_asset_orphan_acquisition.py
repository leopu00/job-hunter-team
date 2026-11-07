"""The real asset gate must reject unreadable inputs, even with unchanged sets."""

import errno
import importlib.util
from pathlib import Path
import re
import subprocess
import sys

import pytest

AUDIT = Path(__file__).resolve().parents[1] / "game/tools/asset_orphan_audit.py"


@pytest.fixture
def asset_audit():
    spec = importlib.util.spec_from_file_location("asset_orphan_acquisition_subject", AUDIT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _observe_reads(monkeypatch, *, blocked=None):
    original = Path.read_text
    observed = {"successes": [], "errors": []}

    def read(path, *args, **kwargs):
        try:
            if path == blocked:
                raise PermissionError(errno.EACCES, "synthetic reader denial", str(path))
            text = original(path, *args, **kwargs)
        except OSError:
            observed["errors"].append(path)
            raise
        observed["successes"].append(path)
        return text

    monkeypatch.setattr(Path, "read_text", read)
    return observed


def _sources(tmp_path, texts):
    paths = []
    for index, text in enumerate(texts):
        path = tmp_path / f"input_{index}.gd"
        path.write_text(text, encoding="utf-8")
        paths.append(path)
    return paths


def test_readable_inputs_preserve_the_original_literal_set(asset_audit, tmp_path, monkeypatch):
    expected_inputs = _sources(tmp_path, ['var a = "shared"\nvar b = "alpha"', 'var a = "shared"\nvar b = "beta"'])
    observed = _observe_reads(monkeypatch)
    actual = asset_audit.collect_literals(expected_inputs)
    assert type(actual) is set
    assert actual == {"shared", "alpha", "beta"}
    assert observed["successes"] == expected_inputs
    assert observed["errors"] == []


def test_the_real_scanner_propagates_reader_errors_with_the_input_path(asset_audit, tmp_path, monkeypatch):
    expected_inputs = _sources(tmp_path, ['var a = "readable"', 'var a = "lost"'])
    blocked = expected_inputs[1]
    observed = _observe_reads(monkeypatch, blocked=blocked)
    with pytest.raises(OSError, match=re.escape(str(blocked))) as raised:
        asset_audit.collect_literals(expected_inputs)
    assert isinstance(raised.value.__cause__, PermissionError)
    assert observed["successes"] == expected_inputs[:1]
    assert observed["errors"] == [blocked]


def test_duplicate_literals_cannot_hide_an_unreadable_input(asset_audit, tmp_path, monkeypatch):
    expected_inputs = _sources(tmp_path, ['var a = "shared"', 'var a = "shared"'])
    # The genuine parser is a SET: losing the second input leaves its result
    # unchanged. Error propagation must therefore protect acquisition itself.
    readable_result = asset_audit.collect_literals(expected_inputs)
    assert readable_result == asset_audit.collect_literals(expected_inputs[:1]) == {"shared"}
    blocked = expected_inputs[1]
    observed = _observe_reads(monkeypatch, blocked=blocked)
    with pytest.raises(OSError, match=re.escape(str(blocked))):
        asset_audit.collect_literals(expected_inputs)
    assert observed["successes"] == expected_inputs[:1]
    assert observed["errors"] == [blocked]


def test_the_real_gate_command_exits_nonzero_for_a_reader_error():
    # Inject the deterministic failure at Path.read_text in a child process;
    # keep the real source enumeration, scanner, audit and main command.
    harness = """
import errno
import importlib.util
from pathlib import Path
import sys
spec = importlib.util.spec_from_file_location("asset_orphan_command_subject", sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
inputs = module._iter_sources()
assert inputs
blocked = inputs[0]
print("BLOCKED_INPUT=" + str(blocked), flush=True)
original = Path.read_text
def read(path, *args, **kwargs):
    if path == blocked:
        raise PermissionError(errno.EACCES, "synthetic reader denial", str(path))
    return original(path, *args, **kwargs)
Path.read_text = read
raise SystemExit(module.main(["--check"]))
"""
    result = subprocess.run([sys.executable, "-c", harness, str(AUDIT)], capture_output=True, text=True, timeout=60)
    assert result.returncode != 0
    markers = [line.removeprefix("BLOCKED_INPUT=") for line in result.stdout.splitlines() if line.startswith("BLOCKED_INPUT=")]
    assert len(markers) == 1 and markers[0]
    assert "Cannot read asset-audit source: " + markers[0] in result.stderr
    assert "synthetic reader denial" in result.stderr
