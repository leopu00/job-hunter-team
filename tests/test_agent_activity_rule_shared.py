"""The agents' status rule: shared/skills/agent_activity.py, run by the daemon.

The cloud daemon runs shared/skills/agent_activity.py
(cli/src/lib/agents-status.js). Until 08/10 a test also held it byte for byte
equal to the Godot game's copy (game/scripts/backend/payloads/agent_activity.py);
Godot is abandoned and that test went with it.
"""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SHARED = ROOT / "shared/skills/agent_activity.py"


def test_the_daemon_runs_the_shared_copy():
    js = (ROOT / "cli/src/lib/agents-status.js").read_text(encoding="utf-8")
    assert "shared/skills/agent_activity.py" in js
    assert "game/" not in js.split("RULE_SCRIPT =", 1)[1].split("\n", 1)[0]


def test_the_shared_copy_is_in_the_image():
    ignore = (ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
    rules = [line.strip() for line in ignore if line.strip() and not line.startswith("#")]
    assert not any(r.rstrip("/") in ("shared", "shared/skills", "**/shared", "**/skills") for r in rules)
