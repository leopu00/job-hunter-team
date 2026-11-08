"""T220: execute the actual PS bridge with pwsh and native fake terminals on Linux."""
import json
import os
import subprocess
from pathlib import Path

import pytest

from monitor_window_fakes import PS, calls, environment, read_until, release, require_pwsh, terminal


HARNESS = r'''
$ErrorActionPreference = 'Stop'
$tokens = $null; $errors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($env:FAKE_SOURCE, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'source parse failed' }
foreach ($name in @('Open-JhtMonitorWindow', 'Write-Err')) {
  $functions = @($ast.FindAll({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $name }, $true))
  if ($functions.Count -ne 1) { throw "missing or ambiguous executable $name" }
  . ([scriptblock]::Create($functions[0].Extent.Text))
}
[string[]]$request = @($env:FAKE_WINDOW_ARGS | ConvertFrom-Json)
$result = Open-JhtMonitorWindow -CommandPath $env:FAKE_ENTRY -WindowArgs $request
[Console]::Out.WriteLine("RETURNED:$result")
exit $result
'''


def fixture(root, *, wt=True, path_name="quoted ' path $(touch NEVER)"):
    bin_dir, env = environment(root)
    pwsh = require_pwsh()
    env.update(REAL_PWSH=pwsh, FAKE_SOURCE=str(PS), FAKE_WINDOW_ARGS='["--window"]', FAKE_TERMINAL_EXECUTE="1")
    shell = terminal(bin_dir, "powershell.exe")
    if wt:
        terminal(bin_dir, "wt.exe")
    directory = root / path_name
    directory.mkdir()
    entry = directory / "jht.ps1"
    entry.write_text('[IO.File]::WriteAllText($env:FAKE_ENTRY_LOG, (ConvertTo-Json -InputObject @($args) -Compress))\n')
    harness = root / "harness.ps1"
    harness.write_text(HARNESS)
    env.update(FAKE_ENTRY=str(entry), FAKE_ENTRY_LOG=str(root / "entry.json"))
    return [pwsh, "-NoLogo", "-NoProfile", "-File", str(harness)], env, shell


@pytest.mark.parametrize("wt", [True, False])
def test_windows_launch_executes_only_monitor_with_exact_path_and_arguments(tmp_path, wt):
    argv, env, shell = fixture(tmp_path, wt=wt)
    done = subprocess.run(argv, env=env, cwd=tmp_path, capture_output=True, text=True, timeout=15)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "RETURNED:0" in done.stdout
    assert json.loads(Path(env["FAKE_ENTRY_LOG"]).read_text()) == ["monitor"]
    observed = calls(env)
    assert [row["tool"] for row in observed] == (["wt.exe", "powershell.exe"] if wt else ["powershell.exe"])
    expected = ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", env["FAKE_ENTRY"], "monitor"]
    assert observed[-1]["argv"] == expected
    if wt:
        assert observed[0]["argv"] == ["-w", "new", "new-tab", "--title", "JHT monitor", str(shell), *expected]
    assert not (tmp_path / "NEVER").exists()
    assert not Path(env["FAKE_FORBIDDEN_LOG"]).exists()


@pytest.mark.parametrize("path_name", ["literal; separator", "literal %PROGRAMFILES% path"])
def test_wt_metacharacter_in_a_path_uses_direct_powershell_without_interpretation(tmp_path, path_name):
    argv, env, _ = fixture(tmp_path, path_name=path_name)
    done = subprocess.run(argv, env=env, cwd=tmp_path, capture_output=True, text=True, timeout=15)
    assert done.returncode == 0, done.stdout + done.stderr
    assert [row["tool"] for row in calls(env)] == ["powershell.exe"]
    assert json.loads(Path(env["FAKE_ENTRY_LOG"]).read_text()) == ["monitor"]


@pytest.mark.parametrize("window_args", [["--window", "--json"], ["--once", "--window"], ["--window", "--window"]])
def test_extra_options_are_refused_before_any_terminal(tmp_path, window_args):
    argv, env, _ = fixture(tmp_path)
    env["FAKE_WINDOW_ARGS"] = json.dumps(window_args)
    done = subprocess.run(argv, env=env, cwd=tmp_path, capture_output=True, text=True, timeout=15)
    assert done.returncode == 2 and "monitor_window_invalid" in done.stdout
    assert calls(env) == []
    assert not Path(env["FAKE_ENTRY_LOG"]).exists()


@pytest.mark.parametrize("name", ["wt.exe", "powershell.exe"])
def test_a_failed_windows_launcher_returns_a_visible_error(tmp_path, name):
    argv, env, _ = fixture(tmp_path, wt=name == "wt.exe")
    env["FAKE_TERMINAL_FAIL"] = name
    done = subprocess.run(argv, env=env, cwd=tmp_path, capture_output=True, text=True, timeout=15)
    assert done.returncode == 1, done.stdout + done.stderr
    assert "monitor_window_unavailable" in done.stdout and "jht monitor" in done.stdout
    assert not Path(env["FAKE_ENTRY_LOG"]).exists()


def test_windows_terminal_lifetime_does_not_block_the_calling_terminal(tmp_path):
    argv, env, _ = fixture(tmp_path)
    fifo = tmp_path / "release"
    os.mkfifo(fifo)
    env.update(FAKE_TERMINAL_HOLD="wt.exe", FAKE_TERMINAL_FIFO=str(fifo))
    process = subprocess.Popen(argv, env=env, cwd=tmp_path, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        assert b"RETURNED:0" in read_until(process, "RETURNED:0")
        assert calls(env)[0]["tool"] == "wt.exe"
        assert not Path(env["FAKE_ENTRY_LOG"]).exists()
    finally:
        try:
            release(env)
        finally:
            process.communicate(timeout=15)
    assert process.returncode == 0
    assert json.loads(Path(env["FAKE_ENTRY_LOG"]).read_text()) == ["monitor"]


def test_a_control_character_is_refused_before_native_process_start(tmp_path):
    argv, env, _ = fixture(tmp_path)
    env["FAKE_ENTRY"] += "\ninvalid"
    done = subprocess.run(argv, env=env, cwd=tmp_path, capture_output=True, text=True, timeout=15)
    assert done.returncode == 1 and "monitor_window_unavailable" in done.stdout
    assert calls(env) == []


@pytest.mark.parametrize("monitor_args,code", [(["--window"], 0), (["--window", "--json"], 2),
                                             (["--window", "--help"], 2), (["-h", "--window"], 2)])
def test_real_powershell_wrapper_dispatches_before_any_engine_access(tmp_path, monitor_args, code):
    _, env, _ = fixture(tmp_path)
    env["FAKE_TERMINAL_EXECUTE"] = "0"
    env["JHT_WRAPPER_PATH"] = str(tmp_path / "not-the-invoked-wrapper.ps1")
    done = subprocess.run([env["REAL_PWSH"], "-NoLogo", "-NoProfile", "-File", str(PS),
                           "monitor", *monitor_args], env=env, cwd=tmp_path, capture_output=True, text=True, timeout=15)
    assert done.returncode == code, done.stdout + done.stderr
    assert not Path(env["FAKE_FORBIDDEN_LOG"]).exists()
    if code == 0:
        assert calls(env)[0]["argv"][-2:] == [str(PS), "monitor"]
    else:
        assert "monitor_window_invalid" in done.stdout and calls(env) == []


def test_plain_powershell_monitor_help_keeps_the_existing_read_only_help_path(tmp_path):
    _, env, _ = fixture(tmp_path)
    env["FAKE_TERMINAL_EXECUTE"] = "0"
    done = subprocess.run([env["REAL_PWSH"], "-NoLogo", "-NoProfile", "-File", str(PS), "monitor", "--help"],
                          env=env, cwd=tmp_path, capture_output=True, text=True, timeout=15)
    assert done.returncode == 0 and "jht" in done.stdout
    assert calls(env) == []
    assert all(json.loads(line)[0] == "info" for line in Path(env["FAKE_FORBIDDEN_LOG"]).read_text().splitlines())
