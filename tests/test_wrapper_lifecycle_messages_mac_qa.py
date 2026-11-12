"""Two lines of the Mac lifecycle QA run that said what had not happened.

1. `jht upgrade --check` on the test channel stops at the preflight, touches nothing, and used to end with «Runtime precedente
   ripristinato»: the flag is the text «false» (the field of the JSON), never empty, so `${rolled_back:+…}` always printed it.
2. A command that starts the stopped container (`jht doctor`) printed the engine's raw progress lines (Volume … Creating), where
   `jht up` and `jht down` print one line: it now goes through the same quiet compose.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")

pytestmark = pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")


def _function(name: str) -> str:
    return re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", SOURCE, re.S | re.M).group(0)


def _upgrade_result(rolled_back: str) -> subprocess.CompletedProcess:
    script = f"""set -u
UPGRADE_JSON=0
UPGRADE_PRUNE_JSON=""
{_function("upgrade_safe_field")}
{_function("upgrade_result")}
upgrade_result false false preflight 0.4.0 img 0.4.0 img false "si aggiorna reinstallando dalla build di test" {rolled_back}
"""
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)


def test_a_failure_that_restored_nothing_does_not_say_it_restored_anything():
    done = _upgrade_result("false")
    assert "Aggiornamento non completato (preflight)" in done.stderr
    assert "ripristinato" not in done.stderr


def test_a_real_rollback_still_says_so():
    assert "Runtime precedente ripristinato." in _upgrade_result("true").stderr


def test_the_container_started_on_demand_goes_through_the_quiet_compose():
    body = _function("ensure_up")
    code = "\n".join(line for line in body.splitlines() if not line.lstrip().startswith("#"))
    assert "compose_up_team" in code
    assert not re.search(r"^\s*compose up -d", code, re.M)
