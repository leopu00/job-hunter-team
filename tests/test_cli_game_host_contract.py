"""Contratto del lifecycle host, incluso un processo client POSIX reale."""

import os
import re
import subprocess
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
JHT = ROOT / "cli" / "bin" / "jht.js"
PS = ROOT / "scripts" / "jht-wrapper.ps1"
BASH = ROOT / "scripts" / "jht-wrapper.sh"


def make_fake_game(tmp_path: Path) -> tuple[Path, Path, dict[str, str]]:
    control = tmp_path / "client-control"
    executable = tmp_path / "job-hunter-team.x86_64"
    executable.write_text(
        r'''#!/usr/bin/env bash
set -eu
control="$JHT_GAME_CONTROL_DIR"
instance="$JHT_GAME_INSTANCE_ID"
mkdir -p "$control"
if [ "$(uname -s)" = "Linux" ]; then
  process_executable="$(readlink /proc/$$/exe)"
else
  process_executable="$(ps -p $$ -o comm= | sed 's/^[[:space:]]*//')"
fi
state="$control/state.json"
printf '{"schema":1,"instance_id":"%s","pid":%s,"executable":"%s","started_at":%s}\n' \
  "$instance" "$$" "$process_executable" "$(date +%s)" > "$state"
printf '{"schema":1,"executable":"%s"}\n' "$0" > "$control/launcher.json"
cleanup() {
  current="$(sed -n 's/.*"instance_id":"\([^"]*\)".*/\1/p' "$state" 2>/dev/null || true)"
  if [ "$current" = "$instance" ]; then rm -f "$state"; fi
}
trap cleanup EXIT INT TERM
while :; do
  request="$control/request.json"
  if [ -f "$request" ]; then
    target="$(sed -n 's/.*"target_instance_id":"\([^"]*\)".*/\1/p' "$request")"
    request_id="$(sed -n 's/.*"request_id":"\([^"]*\)".*/\1/p' "$request")"
    action="$(sed -n 's/.*"action":"\([^"]*\)".*/\1/p' "$request")"
    if [ "$target" = "$instance" ]; then
      rm -f "$request"
      printf '{"schema":1,"request_id":"%s","instance_id":"%s","ok":true}\n' \
        "$request_id" "$instance" > "$control/ack-$request_id.json"
      if [ "$action" = "stop" ]; then exit 0; fi
    fi
  fi
  sleep 0.05
done
''',
        encoding="utf-8",
    )
    executable.chmod(0o755)
    env = {
        **os.environ,
        "HOME": str(tmp_path / "home"),
        "JHT_GAME_CONTROL_DIR": str(control),
        "JHT_GAME_EXECUTABLE": str(executable),
    }
    return executable, control, env


def run_bash_game(env: dict[str, str], *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["bash", str(BASH), *args],
        env=env,
        capture_output=True,
        text=True,
        timeout=20,
    )


def test_node_cli_documents_game_and_gui_commands():
    game = subprocess.run(["node", str(JHT), "game", "--help"], capture_output=True, text=True)
    gui = subprocess.run(["node", str(JHT), "gui", "--help"], capture_output=True, text=True)
    assert game.returncode == 0
    assert gui.returncode == 0
    for action in ("start", "stop", "status"):
        assert action in game.stdout
    assert "open" in gui.stdout


def test_windows_wrapper_uses_nonce_control_plane_without_forced_kill():
    source = PS.read_text(encoding="utf-8")
    for seam in (
        "JHT_GAME_EXECUTABLE",
        "JHT_GAME_CONTROL_DIR",
        "start.lock",
        "JHT_GAME_INSTANCE_ID",
        "target_instance_id",
        "request_id",
        "Write-GameJsonAtomic",
        "Invoke-GameRequest 'stop'",
        "Invoke-GameRequest 'foreground'",
        "timeout richiesta",
        "TASK_LOGON_INTERACTIVE_TOKEN",
        "Remove-GameRequestIfOwned",
    ):
        assert seam in source
    forbidden = ("taskkill", "Stop-Process", "docker stop", "Invoke-Compose down")
    lifecycle = source[source.index("# ── Client desktop nativo") : source.index(
        "# Il CLI Node vive nel container"
    )]
    for command in forbidden:
        assert command not in lifecycle


def test_invalid_host_options_are_fail_closed_before_effects():
    source = PS.read_text(encoding="utf-8")
    assert "if ($GameArgs.Count -ne 1)" in source
    assert "if ($GuiArgs.Count -ne 1" in source
    assert "return 2" in source


def test_bash_lifecycle_is_idempotent_foregrounds_and_stops_cleanly(tmp_path):
    _, control, env = make_fake_game(tmp_path)
    try:
        started = run_bash_game(env, "game", "start")
        assert started.returncode == 0, started.stderr
        pid = int(re.search(r"pid=(\d+)", started.stdout).group(1))

        status = run_bash_game(env, "game", "status")
        repeated = run_bash_game(env, "game", "start")
        foreground = run_bash_game(env, "gui", "open")
        assert status.returncode == repeated.returncode == foreground.returncode == 0
        assert f"pid={pid}" in status.stdout
        assert f"pid={pid}" in repeated.stdout
        assert f"pid={pid}" in foreground.stdout

        before = time.monotonic()
        stopped = run_bash_game(env, "game", "stop")
        assert stopped.returncode == 0, stopped.stderr
        assert time.monotonic() - before < 15
        assert "team still running" in stopped.stdout
        assert not (control / "request.json").exists()

        repeated_stop = run_bash_game(env, "game", "stop")
        assert repeated_stop.returncode == 0
        assert "already stopped" in repeated_stop.stdout
    finally:
        run_bash_game(env, "game", "stop")


def test_bash_concurrent_start_claims_one_process(tmp_path):
    _, _, env = make_fake_game(tmp_path)
    commands = [["bash", str(BASH), "game", "start"] for _ in range(2)]
    processes = [
        subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        for command in commands
    ]
    try:
        results = [process.communicate(timeout=20) + (process.returncode,) for process in processes]
        assert all(result[2] == 0 for result in results), results
        pids = {int(re.search(r"pid=(\d+)", result[0]).group(1)) for result in results}
        assert len(pids) == 1
    finally:
        run_bash_game(env, "game", "stop")


def test_host_subcommand_help_and_invalid_options_have_honest_exit_codes(tmp_path):
    _, _, env = make_fake_game(tmp_path)
    for args in (("game", "start", "--help"), ("game", "stop", "--help"),
                 ("game", "status", "--help"), ("gui", "open", "--help")):
        result = run_bash_game(env, *args)
        assert result.returncode == 0, (args, result.stderr)
        assert "Usage:" in result.stdout
    invalid = run_bash_game(env, "game", "explode")
    assert invalid.returncode == 2
