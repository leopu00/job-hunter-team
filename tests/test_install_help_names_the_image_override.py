"""`install.sh --help` shows the whole table of variables, and says JHT_IMAGE is for that install only (JHT-T312).

The help used to stop at line 62 of the header, before JHT_BIN_DIR, JHT_IMAGE and the rest. And a JHT_IMAGE given only to
the installer does not stay: a later `jht up` starts the release image of the runtime. The help says so.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "install.sh"

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the bash installer is not run on Windows")


def test_help_prints_the_variables_after_the_runtime_dir_and_the_image_override_is_for_the_install_only():
    done = subprocess.run(["bash", str(SCRIPT), "--help"], capture_output=True, text=True, timeout=30, check=False)
    assert done.returncode == 0
    for name in ("JHT_RUNTIME_DIR", "JHT_BIN_DIR", "JHT_IMAGE", "JHT_RAW_BASE", "JHT_SKIP_ONBOARD"):
        assert name in done.stdout, name
    image = done.stdout.split("JHT_IMAGE", 1)[1].split("JHT_RAW_BASE", 1)[0]
    assert "THIS install only" in image and "jht up" in image and "release digest" in image
    box = [line for line in done.stdout.splitlines() if line.startswith("║")]
    assert len({len(line) for line in box}) == 1, "the box keeps its width"
