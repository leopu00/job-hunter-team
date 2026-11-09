"""The harness list lives in four places; they must say the same thing.

shared/runtime/agent-harness.js (what the CLI checks), shared/config/schema.ts
and types.ts (what the config accepts), .launcher/spawn-lib.sh (what an agent
start accepts) and shared/config/provider-touchpoints.json (the inventory).
A harness added to one and not the others would be accepted by the setup and
refused when the team starts, or the other way round.
"""

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def _js_list() -> list[str]:
    out = subprocess.run(
        ["node", "--input-type=module", "-e",
         "import('./shared/runtime/agent-harness.js').then(m=>console.log(JSON.stringify(m.AGENT_HARNESSES)))"],
        cwd=ROOT, capture_output=True, text=True, check=True,
    ).stdout
    return json.loads(out)


def test_the_four_lists_agree() -> None:
    expected = _js_list()
    assert expected == ["codex", "pi"]

    schema = (ROOT / "shared/config/schema.ts").read_text(encoding="utf-8")
    declared = re.search(r"AgentHarnessSchema = z\.enum\(\[([^\]]*)\]\)", schema)
    assert declared and re.findall(r'"([a-z]+)"', declared.group(1)) == expected

    types = (ROOT / "shared/config/types.ts").read_text(encoding="utf-8")
    union = re.search(r"AgentHarnessName = ([^;]*);", types)
    assert union and re.findall(r'"([a-z]+)"', union.group(1)) == expected

    lib = (ROOT / ".launcher/spawn-lib.sh").read_text(encoding="utf-8")
    launcher = re.search(r'^JHT_AGENT_HARNESSES="([^"]*)"', lib, re.M)
    assert launcher and launcher.group(1).split() == expected

    inventory = json.loads((ROOT / "shared/config/provider-touchpoints.json").read_text(encoding="utf-8"))
    assert inventory["canonical_agent_harnesses"] == expected
