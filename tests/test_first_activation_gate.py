"""Regressioni del primo setup: nessun burst prima di ``Attiva team``.

Il test live Windows del 2026-08-03 ha riprodotto quattro processi Codex e i
turni Dottore/Mantenitore con setup 1/4. Questi test fissano i seam che rendono
il comportamento fail-safe senza impedire al solo Assistente di compilare il
profilo.
"""

from pathlib import Path
import json
import os
import shutil
import subprocess

import pytest


ROOT = Path(__file__).resolve().parent.parent
PID1 = ROOT / "cli/src/commands/pid1.js"
STOP = ROOT / "cli/src/commands/team/stop.js"
START = ROOT / "cli/src/commands/team/start.js"
SETUP = ROOT / "game/scripts/setup/setup_service.gd"
AGENT_WATCHDOG = ROOT / ".launcher/agent-watchdog.sh"
DOCTOR_WATCHDOG = ROOT / ".launcher/doctor-watchdog.sh"


def _src(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def test_pid1_creates_first_setup_halt_before_watchdogs():
    src = _src(PID1)
    assert "async function ensureInitialTeamHalt()" in src
    assert "await writeFile(TEAM_HALTED_FLAG, 'initial-setup\\n'" in src
    assert "initial setup: unable to create team-halted gate" in src
    assert "throw err;" in src
    assert src.index("await ensureInitialTeamHalt();") < src.index("startAgentWatchdog();")
    assert src.index("await ensureInitialTeamHalt();") < src.index("startDoctorWatchdog();")


def test_assistant_onboarding_does_not_remove_the_halt_gate():
    src = _src(START)
    branch = src[src.index("if (!agentArg)") : src.index("// Container mode:")]
    assert "clearGlobalHaltGate(containerMode)" in branch
    assert "unlinkSync(haltedFlag)" in src
    setup = _src(SETUP)
    assert "BackendBus.ensure_assistant()" in setup


def test_stop_all_is_persistent_and_stops_background_llm_sessions():
    src = _src(STOP)
    all_branch = src[src.index("if (options.all || !agentArg)") : src.index("} else {")]
    assert "touch" in all_branch
    assert "/jht_home/.team-halted.flag" in all_branch
    assert "isStopAllInfrastructure" in src
    assert "DOTTORE" in src and "MANTENITORE" in src


def test_both_watchdogs_honor_the_same_persistent_halt():
    for path in (AGENT_WATCHDOG, DOCTOR_WATCHDOG):
        src = _src(path)
        assert 'TEAM_HALTED_FLAG="$JHT_HOME/.team-halted.flag"' in src
        assert '[ -e "$TEAM_HALTED_FLAG" ]' in src


def test_ui_requires_an_operational_coordinator_not_any_tmux_session():
    src = _src(SETUP)
    assert "_tmux_has_operational_team(str(tmux[\"out\"]))" in src
    assert 'strip_edges() == "CAPITANO"' in src
    assert "_agents_have_operational_team(BackendBus.agents)" in src
    assert 'role in ["capitano", "coordinatore"]' in src


def test_stop_all_live_contract_sets_gate_and_kills_background_llms(tmp_path):
    node = shutil.which("node")
    if not node:
        pytest.skip("node non disponibile")

    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    state_path = tmp_path / "tmux.json"
    state_path.write_text(json.dumps([
        "ASSISTENTE", "CAPITANO", "DOTTORE", "MANTENITORE"
    ]), encoding="utf-8")

    tmux = fake_bin / "tmux"
    tmux.write_text("""#!/usr/bin/env python3
import json, os, sys
from pathlib import Path
p = Path(os.environ["FAKE_TMUX_STATE"])
sessions = json.loads(p.read_text())
args = sys.argv[1:]
if args and args[0] == "list-sessions":
    print("\\n".join(sessions))
elif args and args[0] == "kill-session":
    target = args[args.index("-t") + 1]
    if target not in sessions:
        sys.exit(1)
    sessions.remove(target)
    p.write_text(json.dumps(sessions))
else:
    sys.exit(2)
""", encoding="utf-8")
    tmux.chmod(0o755)

    touch = fake_bin / "touch"
    touch.write_text("""#!/usr/bin/env python3
import os
from pathlib import Path
Path(os.environ["JHT_HOME"], ".team-halted.flag").touch()
""", encoding="utf-8")
    touch.chmod(0o755)

    home = tmp_path / "jht-home"
    home.mkdir()
    run = subprocess.run(
        [node, str(ROOT / "cli/bin/jht.js"), "team", "stop", "--all"],
        cwd=ROOT,
        env={
            **os.environ,
            "PATH": f"{fake_bin}{os.pathsep}{os.environ.get('PATH', '')}",
            "IS_CONTAINER": "1",
            "JHT_HOME": str(home),
            "FAKE_TMUX_STATE": str(state_path),
            "NO_COLOR": "1",
        },
        text=True,
        capture_output=True,
        timeout=20,
    )

    assert run.returncode == 0, run.stderr
    assert (home / ".team-halted.flag").exists()
    assert json.loads(state_path.read_text()) == ["ASSISTENTE"]
    assert "CAPITANO stopped" in run.stdout
    assert "DOTTORE stopped" in run.stdout
    assert "MANTENITORE stopped" in run.stdout
    assert "ASSISTENTE preserved" in run.stdout
