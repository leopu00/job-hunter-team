"""The agent watchdog says, when it starts, what it sees of the setup of the person (collaudo Linux 23/11: 2 s after the container it
started the team on the configuration of before, and its log did not say whether the flag of the setup was there)."""
import os
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WATCHDOG = (ROOT / ".launcher" / "agent-watchdog.sh").read_text(encoding="utf-8").replace("\r\n", "\n")


def _boot_block() -> str:
    """The definition of the gate and the boot line, as the watchdog has them, before its loop."""
    gate = WATCHDOG[WATCHDOG.index('SETUP_OPEN_FLAG="$JHT_HOME/.setup-open.flag"'):]
    gate = gate[:gate.index("\n", gate.index("setup_open() {"))]
    boot = WATCHDOG[WATCHDOG.index("\nif setup_open; then\n  log \"boot:"):WATCHDOG.index("\nwhile true; do\n")]
    assert WATCHDOG.index("\nif setup_open; then\n  log \"boot:") < WATCHDOG.index("\nwhile true; do\n")
    return gate + "\n" + boot


def _run(home: Path) -> str:
    script = 'log() { printf "%s\\n" "$*"; }\n' + _boot_block()
    done = subprocess.run(["bash", "-c", script], env={**os.environ, "JHT_HOME": str(home)},
                          capture_output=True, text=True, timeout=30)
    assert done.returncode == 0, done.stderr
    return done.stdout.strip()


def test_the_first_line_says_whether_the_setup_is_open(tmp_path):
    flag = tmp_path / ".setup-open.flag"
    assert _run(tmp_path) == "boot: no .setup-open.flag — the agents of the configuration are started"
    flag.write_text("2026-11-23T21:37:00Z\n", encoding="utf-8")
    assert _run(tmp_path).startswith("boot: setup open (.setup-open.flag present)")
    old = time.time() - 3 * 3600
    os.utime(flag, (old, old))
    assert _run(tmp_path).startswith("boot: .setup-open.flag present but older than 2 hours")
