"""T220 host bridge: real wrapper dispatch and real fake-terminal execution."""
import json
import os
import re
import subprocess
from pathlib import Path

import pytest

from monitor_window_fakes import SH, calls, environment, executable, read_until, release, terminal


def helper(root):
    # Harness acquisition: anchored nonempty bodies, then Bash executes them.
    source = SH.read_text()
    bodies = []
    for name in ("jht_text_en", "jht_text_it", "jht_say", "jht_monitor_window"):
        matches = re.findall(r"(?ms)^" + name + r"\(\) \{\n.*?^\}\n", source)
        assert len(matches) == 1, name
        bodies.append(matches[0])
    return executable(root / "bridge.sh", "#!/bin/bash\nset -eu\n"
                      "err() { printf '%s\\n' \"$*\" >&2; }\n"
                      "HOST_KERNEL=\"$FAKE_KERNEL\"\n" + "\n".join(bodies)
                      + '\njht_monitor_window "$FAKE_ENTRY" "$@"\n')


def entry(root, env):
    directory = root / "quoted ' path $(touch NEVER)"
    directory.mkdir()
    target = executable(directory / "jht", '#!/bin/sh\nprintf "%s\\n" "$@" > "$FAKE_ENTRY_LOG"\n')
    env["FAKE_ENTRY"] = str(target)
    env["FAKE_ENTRY_LOG"] = str(root / "entry.log")
    return target


@pytest.mark.parametrize("kind", ["tmux", "macos", "linux"])
def test_new_terminal_executes_only_monitor_and_keeps_the_path_literal(tmp_path, kind):
    bin_dir, env = environment(tmp_path)
    target = entry(tmp_path, env)
    env["FAKE_TERMINAL_EXECUTE"] = "1"
    if kind == "tmux":
        env["TMUX"] = "synthetic-client"
        name = "tmux"
    elif kind == "macos":
        env["FAKE_KERNEL"] = "Darwin"
        name = "osascript"
    else:
        env["DISPLAY"] = ":synthetic"
        name = "x-terminal-emulator"
    terminal(bin_dir, name)
    done = subprocess.run([str(helper(tmp_path)), "--window"], env=env, cwd=tmp_path, capture_output=True, text=True, timeout=10)
    assert done.returncode == 0, done.stdout + done.stderr
    assert Path(env["FAKE_ENTRY_LOG"]).read_text().splitlines() == ["monitor"]
    observed = calls(env)
    assert len(observed) == 1 and observed[0]["tool"] == name
    if kind == "tmux":
        assert observed[0]["argv"] == ["new-window", "-n", "JHT-monitor", "--", str(target), "monitor"]
    elif kind == "macos":
        assert observed[0]["argv"] == ["-", str(target)]
        assert 'quoted form of (item 1 of argv)' in observed[0]["program"]
        assert str(target) not in observed[0]["program"]  # Data never becomes AppleScript source.
    else:
        assert observed[0]["argv"] == ["-e", str(target), "monitor"]
    assert not (tmp_path / "NEVER").exists()
    assert not Path(env["FAKE_FORBIDDEN_LOG"]).exists()


@pytest.mark.parametrize("args", [["--window", "--json"], ["--once", "--window"], ["--window", "--window"],
                                 ["--window", "--help"], ["-h", "--window"]])
def test_real_wrapper_refuses_extra_options_before_engine_or_terminal(tmp_path, args):
    bin_dir, env = environment(tmp_path)
    terminal(bin_dir, "tmux")
    env["TMUX"] = "synthetic-client"
    done = subprocess.run(["bash", str(SH), "monitor", *args], env=env, cwd=tmp_path, capture_output=True, text=True, timeout=10)
    assert done.returncode == 2
    assert "monitor_window_invalid" in done.stderr
    assert calls(env) == []
    assert not Path(env["FAKE_FORBIDDEN_LOG"]).exists()


def test_plain_monitor_help_still_opens_no_terminal_and_starts_nothing(tmp_path):
    _, env = environment(tmp_path)
    done = subprocess.run(["bash", str(SH), "monitor", "--help"], env=env, cwd=tmp_path,
                          capture_output=True, text=True, timeout=10)
    assert done.returncode == 0 and "jht" in done.stdout
    assert calls(env) == []
    observed = Path(env["FAKE_FORBIDDEN_LOG"])
    assert all(json.loads(line)[0] == "info" for line in observed.read_text().splitlines())


def test_real_wrapper_dispatches_its_own_path_not_a_wrapper_override(tmp_path):
    bin_dir, env = environment(tmp_path)
    installed = executable(tmp_path / "jht", SH.read_text())
    terminal(bin_dir, "tmux")
    env["TMUX"] = "synthetic-client"
    env["JHT_WRAPPER_PATH"] = str(tmp_path / "not-the-invoked-wrapper")
    done = subprocess.run([str(installed), "monitor", "--window"], env=env, cwd=tmp_path, capture_output=True, text=True, timeout=10)
    assert done.returncode == 0, done.stderr
    assert calls(env)[0]["argv"][-2:] == [str(installed), "monitor"]
    assert not Path(env["FAKE_FORBIDDEN_LOG"]).exists()


def test_headless_call_does_not_choose_an_unrelated_tmux_server(tmp_path):
    bin_dir, env = environment(tmp_path)
    terminal(bin_dir, "tmux")
    done = subprocess.run(["bash", str(SH), "monitor", "--window"], env=env, cwd=tmp_path, capture_output=True, text=True, timeout=10)
    assert done.returncode == 1
    assert "monitor_window_unavailable" in done.stderr and "jht monitor" in done.stderr
    assert calls(env) == []
    assert not Path(env["FAKE_FORBIDDEN_LOG"]).exists()


@pytest.mark.parametrize("name,kernel", [("tmux", "Linux"), ("osascript", "Darwin"), ("x-terminal-emulator", "Linux")])
def test_terminal_launch_error_is_visible_and_keeps_nonzero_exit(tmp_path, name, kernel):
    bin_dir, env = environment(tmp_path)
    entry(tmp_path, env)
    terminal(bin_dir, name)
    env.update(FAKE_KERNEL=kernel, FAKE_TERMINAL_FAIL=name, DISPLAY=":synthetic")
    if name == "tmux":
        env["TMUX"] = "synthetic-client"
    done = subprocess.run([str(helper(tmp_path)), "--window"], env=env, cwd=tmp_path, capture_output=True, text=True, timeout=10)
    assert done.returncode == 1
    assert "monitor_window_unavailable" in done.stderr and "jht monitor" in done.stderr


def test_calling_terminal_is_free_while_the_new_window_is_still_alive(tmp_path):
    bin_dir, env = environment(tmp_path)
    entry(tmp_path, env)
    terminal(bin_dir, "x-terminal-emulator")
    fifo = tmp_path / "release"
    os.mkfifo(fifo)
    env.update(DISPLAY=":synthetic", FAKE_TERMINAL_HOLD="x-terminal-emulator", FAKE_TERMINAL_FIFO=str(fifo))
    script = helper(tmp_path)
    process = subprocess.Popen(["bash", "-c", '"$1" --window; printf "RETURNED:%s\\n" "$?"', "bridge", str(script)],
                               env=env, cwd=tmp_path, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        assert b"RETURNED:0" in read_until(process, "RETURNED:0")
        assert calls(env)[0]["tool"] == "x-terminal-emulator"
    finally:
        try:
            release(env)
        finally:
            process.communicate(timeout=15)
    assert process.returncode == 0


def test_control_characters_in_the_entry_path_are_refused_before_launch(tmp_path):
    bin_dir, env = environment(tmp_path)
    terminal(bin_dir, "tmux")
    env.update(TMUX="synthetic-client", FAKE_ENTRY=str(tmp_path / "unsafe\ncommand"))
    done = subprocess.run([str(helper(tmp_path)), "--window"], env=env, cwd=tmp_path, capture_output=True, text=True, timeout=10)
    assert done.returncode == 1 and "monitor_window_unavailable" in done.stderr
    assert calls(env) == []


def test_exit_attestation_refuses_a_missing_process_birth_token(tmp_path):
    _, env = environment(tmp_path)
    Path(env["FAKE_TERMINAL_LOG"]).write_text(json.dumps({"pid": os.getpid(), "start_ticks": None}) + "\n")
    env["FAKE_TERMINAL_FIFO"] = str(tmp_path / "must-not-open")
    with pytest.raises(AssertionError, match="birth token"):
        release(env)
    assert not Path(env["FAKE_TERMINAL_FIFO"]).exists()
