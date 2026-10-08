"""The bridge-suite launcher must propagate every refused daemon restart."""

from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LAUNCHER = ROOT / ".launcher"

DAEMONS = {
    "sentinel-bridge": ("BRIDGE_SCRIPT", "/app/.launcher/sentinel-bridge.py"),
    "pacing-bridge": ("PACING_SCRIPT", "/app/.launcher/pacing-bridge.py"),
    "heartbeat-bridge": ("HEARTBEAT_SCRIPT", "/app/.launcher/heartbeat-bridge.py"),
    "window-ratio-meter": ("WRM_SCRIPT", "/app/shared/skills/window_ratio_meter.py"),
    "token-meter": ("METER_SCRIPT", "/app/shared/skills/token-meter.py"),
    "agent-vitals": ("AV_SCRIPT", "/app/shared/skills/agent_vitals.py"),
    "codex-auth-healer": ("HEALER_SCRIPT", "/app/.launcher/codex-auth-healer.sh"),
}


def _launcher_with_daemons(
    tmp_path: Path,
    *,
    refused_label: str | None = None,
) -> tuple[Path, dict[str, str], Path]:
    launcher = tmp_path / "launcher"
    shutil.copytree(LAUNCHER, launcher)
    source_path = launcher / "start-agent.sh"
    source = source_path.read_text(encoding="utf-8")
    for label, (variable, production_path) in DAEMONS.items():
        daemon = launcher / f"fake-{label}.py"
        daemon.write_text("# fixture: existence is enough when every kill is refused\n", encoding="utf-8")
        expected = f'{variable}="{production_path}"'
        replacement = f'{variable}="{daemon}"'
        assert source.count(expected) >= 1, expected
        source = source.replace(expected, replacement)
    source_path.write_text(source, encoding="utf-8")

    proc_kill = tmp_path / "proc-kill.py"
    refusal = "True" if refused_label is None else f"{refused_label!r} in sys.argv[1]"
    proc_kill.write_text(
        "import sys\n"
        f"refused = {refusal}\n"
        "if refused:\n"
        "    print('DENIED kill 4242', file=sys.stderr)\n"
        "    print('[proc-kill] FAIL: signal refused', file=sys.stderr)\n"
        "raise SystemExit(1 if refused else 0)\n",
        encoding="utf-8",
    )
    home = tmp_path / "home"
    home.mkdir()
    environment = {
        **os.environ,
        "JHT_HOME": str(home),
        "JHT_PROC_KILL_PY": str(proc_kill),
    }
    return source_path, environment, home


def test_bridge_suite_returns_nonzero_and_lists_every_refused_daemon(tmp_path: Path) -> None:
    launcher, environment, home = _launcher_with_daemons(tmp_path)

    result = subprocess.run(
        [str(launcher), "bridge"],
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode != 0
    summary = next(line for line in result.stderr.splitlines() if "bridge suite incomplete" in line)
    for label in DAEMONS:
        assert label in summary
        assert f"fake-{label}" not in result.stdout

    kill_log = home / "logs" / "daemon-kill.log"
    records = kill_log.read_text(encoding="utf-8").splitlines()
    assert len(records) == len(DAEMONS)
    assert all(r"DENIED kill 4242\n[proc-kill] FAIL" in record for record in records)


def test_one_refused_daemon_makes_the_whole_suite_fail_and_names_only_it(tmp_path: Path) -> None:
    launcher, environment, _home = _launcher_with_daemons(
        tmp_path,
        refused_label="heartbeat-bridge",
    )

    result = subprocess.run(
        [str(launcher), "bridge"],
        env=environment,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )

    assert result.returncode != 0
    summary = next(line for line in result.stderr.splitlines() if "bridge suite incomplete" in line)
    assert "heartbeat-bridge" in summary
    for label in set(DAEMONS) - {"heartbeat-bridge"}:
        assert label not in summary
