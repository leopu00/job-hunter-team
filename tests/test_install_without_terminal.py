"""The installer finishes when it has no terminal at all.

`curl | bash` re-opens stdin from /dev/tty so the setup wizard can ask its questions. The node
/dev/tty exists, and is readable, on every machine, but opening it fails with ENXIO («No such
device or address») when the process has no controlling terminal: `ssh host 'curl … | bash'`
without -t, cron, CI. `[ -r /dev/tty ]` is true there, `exec </dev/tty` failed and the installer
died with exit 1 after everything had been installed.

The decision is now «can it be opened», asked by opening it. The production functions are run in
bash, in a new session (no controlling terminal), with a fake `jht`.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALLERS = [ROOT / "scripts" / "install.sh", ROOT / "web" / "public" / "install.sh"]


def run_without_terminal(tmp_path: Path, installer: Path, call: str, *, env_extra: str = ""):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    ran = tmp_path / "jht-ran"
    jht = bin_dir / "jht"
    jht.write_text(f'#!/bin/sh\necho "$*" >> "{ran}"\n', encoding="utf-8")
    jht.chmod(0o755)
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . "{installer}"\n'
        f'set -e\nBIN_DIR="{bin_dir}"\nDRY_RUN=0\nPAIRING_TOKEN=""\n{env_extra}\n'
        f"{call}\n"
        "echo finished-with-$?\n"
    )
    done = subprocess.run(
        ["bash", "-c", script],
        env={"PATH": f"{bin_dir}:/usr/bin:/bin", "HOME": str(tmp_path)},
        stdin=subprocess.DEVNULL,
        capture_output=True, text=True, timeout=30,
        start_new_session=True,  # no controlling terminal: opening /dev/tty fails with ENXIO
    )
    return done, ran


@pytest.mark.parametrize("installer", INSTALLERS, ids=["scripts", "web-public"])
def test_without_a_terminal_the_installer_skips_the_wizard_and_finishes(tmp_path, installer):
    done, ran = run_without_terminal(tmp_path, installer, "maybe_onboard")
    assert done.returncode == 0, done.stdout + done.stderr
    assert "finished-with-0" in done.stdout
    assert "skipping the wizard" in done.stdout + done.stderr
    assert "jht setup" in done.stdout + done.stderr
    assert not ran.exists(), "the wizard must not start without a terminal"
    assert "No such device" not in done.stderr


@pytest.mark.parametrize("installer", INSTALLERS, ids=["scripts", "web-public"])
def test_without_a_terminal_the_closing_message_still_points_to_the_setup(tmp_path, installer):
    done, _ = run_without_terminal(tmp_path, installer, "will_auto_onboard && echo auto || echo manual")
    assert done.returncode == 0, done.stdout + done.stderr
    assert "manual" in done.stdout and "auto\n" not in done.stdout.replace("manual", "")
