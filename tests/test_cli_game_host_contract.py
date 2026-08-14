"""Contratto del lifecycle host, incluso un processo client POSIX reale."""

import os
import re
import signal
import subprocess
import time
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
JHT = ROOT / "cli" / "bin" / "jht.js"
PS = ROOT / "scripts" / "jht-wrapper.ps1"
BASH = ROOT / "scripts" / "jht-wrapper.sh"
CLIENT_CONTROL = ROOT / "game" / "scripts" / "client_control.gd"
WINDOWS_GUARD = ROOT / "game" / "scripts" / "support" / "windows_instance_guard.gd"


def _terminate(pid: int, timeout: float = 5.0) -> None:
    """Termina un processo e ACCERTA che sia morto, escalando a SIGKILL."""
    for sig in (signal.SIGTERM, signal.SIGKILL):
        try:
            os.kill(pid, sig)
        except ProcessLookupError:
            return
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.05)
    raise AssertionError(f"il processo {pid} è sopravvissuto anche a SIGKILL")


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
# `trap ... TERM` da solo NON basta: bash esegue l'handler e RIPRENDE il loop,
# quindi lo stub sopravvive al SIGTERM che il test gli manda (misurato). Su
# INT/TERM si esce davvero.
trap cleanup EXIT
trap 'cleanup; exit 143' TERM
trap 'cleanup; exit 130' INT
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
    for action in ("start", "stop", "status", "restart", "background"):
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
        "Invoke-GameRequest 'background'",
        "Invoke-GameRestart",
        "timeout richiesta",
        "TASK_LOGON_INTERACTIVE_TOKEN",
        "Remove-GameRequestIfOwned",
        "$WindowsInstanceGuardSha256",
        "Get-InstanceGuardFingerprint",
        "Get-GameProcessStartTicks $guard",
        "$guard.SessionId -ne $process.SessionId",
        "instance guard binding mismatch",
    ):
        assert seam in source
    forbidden = ("taskkill", "Stop-Process", "docker stop", "Invoke-Compose down")
    lifecycle = source[source.index("# ── Client desktop nativo") : source.index(
        "# Il CLI Node vive nel container"
    )]
    for command in forbidden:
        assert command not in lifecycle


def test_windows_state_binds_live_desktop_to_attested_guard() -> None:
    state = CLIENT_CONTROL.read_text(encoding="utf-8")
    guard = WINDOWS_GUARD.read_text(encoding="utf-8")
    wrapper = PS.read_text(encoding="utf-8")

    assert 'state["schema"] = 2' in state
    for field in (
        "desktop_executable",
        "desktop_started",
        "executable",
        "instance_id",
        "mode",
        "mutex_fingerprint",
        "pid",
        "source_sha256",
        "started",
    ):
        assert f'"{field}"' in state
    digest = re.search(r'SOURCE_SHA256 := "([0-9a-f]{64})"', guard).group(1)
    assert f"$WindowsInstanceGuardSha256 = '{digest}'" in wrapper
    for rejection in (
        "$guardPid -eq $statePid",
        "$guard.SessionId -ne $process.SessionId",
        "Get-CanonicalGameProcessPath $guard",
        "Get-GameProcessStartTicks $process",
        "Get-GameProcessStartTicks $guard",
        "Get-InstanceGuardFingerprint",
    ):
        assert rejection in wrapper


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

        background = run_bash_game(env, "game", "background")
        status = run_bash_game(env, "game", "status")
        repeated = run_bash_game(env, "game", "start")
        foreground = run_bash_game(env, "gui", "open")
        assert background.returncode == status.returncode == repeated.returncode == foreground.returncode == 0
        assert f"pid={pid}" in background.stdout
        assert "client and team still running" in background.stdout
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


def test_bash_restart_replaces_only_client_and_keeps_control_plane_clean(tmp_path):
    _, control, env = make_fake_game(tmp_path)
    try:
        started = run_bash_game(env, "game", "start")
        assert started.returncode == 0, started.stderr
        old_pid = int(re.search(r"pid=(\d+)", started.stdout).group(1))

        restarted = run_bash_game(env, "game", "restart")
        assert restarted.returncode == 0, restarted.stderr
        new_pid = int(re.search(r"game restarted old_pid=\d+ pid=(\d+)", restarted.stdout).group(1))
        assert new_pid != old_pid
        assert f"old_pid={old_pid}" in restarted.stdout
        assert "team still running" in restarted.stdout
        assert not (control / "request.json").exists()
        with pytest.raises(ProcessLookupError):
            os.kill(old_pid, 0)

        status = run_bash_game(env, "game", "status")
        assert status.returncode == 0
        assert f"pid={new_pid}" in status.stdout
    finally:
        run_bash_game(env, "game", "stop")


def test_bash_rejects_same_pid_and_executable_with_stale_started_at(tmp_path):
    _, control, env = make_fake_game(tmp_path)
    started = run_bash_game(env, "game", "start")
    assert started.returncode == 0, started.stderr
    pid = int(re.search(r"pid=(\d+)", started.stdout).group(1))
    state = control / "state.json"
    original = state.read_text(encoding="utf-8")
    state.write_text(re.sub(r'"started_at":\d+', '"started_at":1', original), encoding="utf-8")
    try:
        status = run_bash_game(env, "game", "status")
        assert status.returncode == 0
        assert status.stdout.strip() == "game stopped"
        assert not state.exists()
    finally:
        # Qui `game stop` non servirebbe: il test ha appena verificato che lo
        # stato è stato rimosso, quindi il wrapper non sa più chi fermare. Si
        # passa dal pid, ma senza dare per scontato che un segnale basti — è
        # così che 49 stub sono rimasti accesi sulle macchine di sviluppo, il
        # più vecchio per due giorni.
        _terminate(pid)


def test_host_subcommand_help_and_invalid_options_have_honest_exit_codes(tmp_path):
    _, _, env = make_fake_game(tmp_path)
    for args in (("game", "start", "--help"), ("game", "stop", "--help"),
                 ("game", "status", "--help"), ("game", "restart", "--help"),
                 ("game", "background", "--help"), ("gui", "open", "--help")):
        result = run_bash_game(env, *args)
        assert result.returncode == 0, (args, result.stderr)
        assert "Usage:" in result.stdout
    invalid = run_bash_game(env, "game", "explode")
    assert invalid.returncode == 2


def test_background_and_restart_fail_honestly_when_client_cannot_run(tmp_path):
    _, _, env = make_fake_game(tmp_path)
    background = run_bash_game(env, "game", "background")
    assert background.returncode == 1
    assert "client non attivo" in background.stderr

    env["JHT_GAME_EXECUTABLE"] = str(tmp_path / "missing-client")
    restart = run_bash_game(env, "game", "restart")
    assert restart.returncode == 1
    assert "client non trovato" in restart.stderr
