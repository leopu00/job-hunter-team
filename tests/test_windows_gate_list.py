"""The list of the test files the Windows config ACL gate runs is one: tests/windows_gate_files.py.

The gate had a list of file names written in its workflow and another in win-gate-acl.sh: a Windows test written after
them ran on no Windows until someone remembered (two cases of test_integration_command_windows.py were red on Windows
PowerShell 5.1 on master-arthur and no gate saw it). Now every `tests/test_*windows*.py` is run on Windows, the other
files that are meant for Windows are named in one place, and a file that runs PowerShell with the project's helpers and
is in no group (nor said to be POSIX-only with its reason) fails here.
"""
import re
import subprocess
import sys
from pathlib import Path

import yaml

import windows_gate_files as gate

ROOT = Path(__file__).resolve().parent.parent
TESTS = ROOT / "tests"
WORKFLOW = ROOT / ".github" / "workflows" / "windows-config-acl.yml"


def _file(entry):
    return entry.split("::", 1)[0]


def test_every_listed_file_exists_and_every_pending_or_posix_entry_has_a_reason():
    entries = list(gate.HOST) + list(gate.STRICT) + list(gate.WINDOWS_GATE_EXTRA) + list(gate.PENDING) + list(gate.POSIX_ONLY)
    missing = [entry for entry in entries if not (ROOT / _file(entry)).is_file()]
    assert not missing, f"listed but not there (a pending entry goes away with its file): {missing}"
    for group in (gate.PENDING, gate.POSIX_ONLY):
        empty = [name for name, reason in group.items() if len(reason.strip()) < 15]
        assert not empty, f"entries with no reason: {empty}"


def test_a_file_is_in_one_group_only():
    host = {_file(entry) for entry in gate.HOST}
    strict = set(gate.STRICT)
    extra = set(gate.WINDOWS_GATE_EXTRA)
    pending = set(gate.PENDING)
    posix = set(gate.POSIX_ONLY)
    for left, right, names in (
        (host, strict, "HOST and STRICT"),
        (pending, posix, "PENDING and POSIX_ONLY"),
        (extra, posix, "WINDOWS_GATE_EXTRA and POSIX_ONLY"),
        (extra, pending, "WINDOWS_GATE_EXTRA and PENDING"),
        (strict | host, posix, "a Windows group and POSIX_ONLY"),
    ):
        assert not (left & right), f"{names}: {sorted(left & right)}"
    # the probe's file is in HOST for one case only, and its other cases are in the open group on purpose
    assert "tests/test_podman_windows_probe.py" in gate.open_files()


def test_the_open_group_is_what_the_names_say():
    opened = set(gate.open_files())
    windows = set(gate.windows_named())
    # every file that says «windows» is run, except the groups above, the files waiting for a correction and the POSIX-only
    left_out = windows - opened - set(gate.STRICT) - {_file(entry) for entry in gate.HOST} - set(gate.PENDING)
    assert not left_out, f"windows files run nowhere: {sorted(left_out)}"
    assert set(gate.WINDOWS_GATE_EXTRA) <= opened
    assert not (opened & set(gate.PENDING)) and not (opened & set(gate.POSIX_ONLY))
    assert len(opened) >= 30


def test_no_test_file_that_runs_powershell_is_left_out():
    left = gate.undecided()
    assert not left, (
        f"these files run PowerShell (JHT_TEST_SHELL, powershell_argv or windows_native_fakes) and are in no group of "
        f"tests/windows_gate_files.py: put each in WINDOWS_GATE_EXTRA, or in PENDING (red on Windows, with its owner), or in "
        f"POSIX_ONLY (with the reason it cannot run on Windows): {left}"
    )


def test_a_new_file_that_runs_powershell_is_caught(tmp_path):
    (tmp_path / "test_something_new.py").write_text("import os\nshell = os.environ['JHT_TEST_SHELL']\n", encoding="utf-8")
    (tmp_path / "test_nothing_to_do_with_it.py").write_text("def test_x():\n    pass\n", encoding="utf-8")
    (tmp_path / "test_new_windows_case.py").write_text("def test_y():\n    pass\n", encoding="utf-8")
    assert gate.undecided(tmp_path) == ["tests/test_something_new.py"]
    # a name with «windows» in it is run without anyone adding it to a list
    assert "tests/test_new_windows_case.py" in gate.open_files(tmp_path)


def test_the_command_prints_the_groups_the_workflow_reads():
    for flag, expected in (("--host", gate.host_files()), ("--strict", gate.strict_files()), ("--open", gate.open_files())):
        done = subprocess.run([sys.executable, str(TESTS / "windows_gate_files.py"), flag], capture_output=True, text=True, check=True)
        assert done.stdout.split() == expected
    bad = subprocess.run([sys.executable, str(TESTS / "windows_gate_files.py"), "--nope"], capture_output=True, text=True)
    assert bad.returncode == 2


def test_the_workflow_names_no_test_file_it_reads_the_list():
    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    scripts = []
    for job in workflow["jobs"].values():
        for step in job.get("steps", []):
            scripts.append(step.get("run", ""))
    text = "\n".join(scripts)
    assert "windows_gate_files.py" in text
    assert not re.search(r"tests/test_\w+\.py", text), "a test file written in the workflow is a second list"
    # a new test of the gate, and the list itself, start the gate (push paths)
    triggers = workflow[True]["push"]["paths"] if True in workflow else workflow["on"]["push"]["paths"]
    assert "tests/test_*windows*.py" in triggers and "tests/windows_gate_files.py" in triggers


def test_a_change_to_any_file_the_gate_runs_starts_the_gate():
    """The push filter of the workflow names the test files by globs and by the names of the files without «windows»
    in theirs: a file the list runs and the filter does not match would change without the gate running."""
    import fnmatch

    workflow = yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))
    on = workflow[True] if True in workflow else workflow["on"]
    patterns = on["push"]["paths"]
    runs = {_file(entry) for entry in gate.HOST} | set(gate.STRICT) | set(gate.open_files())
    # fnmatch's * crosses a folder, which GitHub's does not: the files here are all in tests/, so the result is the same
    unmatched = sorted(name for name in runs if not any(fnmatch.fnmatchcase(name, pattern) for pattern in patterns))
    assert not unmatched, f"the gate would not start for a change to: {unmatched} (add a glob or the name to the push paths)"
