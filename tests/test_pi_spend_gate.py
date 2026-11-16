"""The spending gate of the agents on pi (shared/runtime/pi-harness/spend-gate.js): while the brake holds the team, a
message to an agent is held and a running turn is stopped before its next model call; the Assistente is left out.

Run by node against a fake `pi` that records the handlers, as the web search extension is (test_pi_web_search.py). The
daily-halt flag is written the way pi_spend_cap.py writes it. Made-up messages; nothing reaches a network.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
GATE = ROOT / "shared" / "runtime" / "pi-harness" / "spend-gate.js"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node required")

DRIVER = r"""
const fs = require("node:fs");
const handlers = {};
require(process.argv[2])({ on: (name, fn) => { (handlers[name] ||= []).push(fn); } });
const results = [];
for (const step of JSON.parse(fs.readFileSync(0, "utf8"))) {
  if (step.flag !== undefined) {
    const file = process.env.JHT_HOME + "/logs/daily-halt.flag";
    if (step.flag === null) { try { fs.unlinkSync(file); } catch (e) {} }
    else { fs.mkdirSync(process.env.JHT_HOME + "/logs", { recursive: true }); fs.writeFileSync(file, step.flag); }
    continue;
  }
  let aborted = 0;
  const ctx = { abort: () => { aborted += 1; } };
  const out = (handlers[step.event] || []).map((fn) => fn({ text: step.text || "", payload: {} }, ctx));
  results.push({ handlers: out.length, out: out.length ? (out[0] === undefined ? null : out[0]) : null, aborted });
}
process.stdout.write(JSON.stringify(results));
"""

BRAKE = json.dumps({"halted_at": "2026-11-16T09:45:00+00:00", "reason": "pi_spend_cap",
                    "pi_spend_cap": {"why": "pace", "spent": 1.14, "ceiling": 0.2}})
DAILY_CAP = json.dumps({"halted_at": "2026-11-16T09:45:00+00:00", "consumed_pct": 120})


def run(tmp_path: Path, agent: str, steps: list[dict]):
    driver = tmp_path / "driver.js"
    driver.write_text(DRIVER, encoding="utf-8")
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    env = {**os.environ, "JHT_HOME": str(home), "JHT_AGENT_NAME": agent}
    done = subprocess.run(["node", str(driver), str(GATE)], input=json.dumps(steps), capture_output=True, text=True,
                          env=env, timeout=30)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout), home


MESSAGE = {"event": "input", "text": "[BRIDGE TICK] synthetic"}
REQUEST = {"event": "before_provider_request"}


def test_without_a_pause_everything_goes(tmp_path):
    results, _ = run(tmp_path, "capitano", [MESSAGE, REQUEST])
    assert results[0]["out"] == {"action": "continue"} and results[1]["aborted"] == 0


@pytest.mark.parametrize("agent", ["capitano", "scout-1", "sentinella", "analista-2"])
def test_during_a_pause_of_the_brake_a_message_is_held_and_a_turn_stops_before_its_call(tmp_path, agent):
    results, home = run(tmp_path, agent, [{"flag": BRAKE}, MESSAGE, REQUEST, {"flag": None}, MESSAGE, REQUEST])
    assert results[0]["out"] == {"action": "handled"}, "the message does not reach the model"
    assert results[1]["aborted"] == 1, "a turn already running stops before its next request"
    assert results[2]["out"] == {"action": "continue"} and results[3]["aborted"] == 0, "the pause lifted: work again"
    log = (home / "logs" / "pi-spend-gate.log").read_text(encoding="utf-8")
    assert "input_held" in log and "request_stopped" in log and "synthetic" not in log, "never the text of a message"


def test_the_assistente_still_answers_the_person(tmp_path):
    results, _ = run(tmp_path, "assistente", [{"flag": BRAKE}, MESSAGE, REQUEST])
    assert results[0]["handlers"] == 0 and results[1]["handlers"] == 0


@pytest.mark.parametrize("flag", [DAILY_CAP, "{broken", "", json.dumps(["pi_spend_cap"])])
def test_a_pause_of_another_owner_or_a_broken_flag_does_not_close_the_gate(tmp_path, flag):
    results, _ = run(tmp_path, "capitano", [{"flag": flag}, MESSAGE, REQUEST])
    assert results[0]["out"] == {"action": "continue"} and results[1]["aborted"] == 0


def test_a_link_or_a_pipe_in_place_of_the_flag_is_no_pause_and_does_not_hold_the_agent(tmp_path):
    home = tmp_path / "home"
    (home / "logs").mkdir(parents=True)
    target = tmp_path / "elsewhere.json"
    target.write_text(BRAKE, encoding="utf-8")
    (home / "logs" / "daily-halt.flag").symlink_to(target)
    results, _ = run(tmp_path, "capitano", [MESSAGE])
    assert results[0]["out"] == {"action": "continue"}
    (home / "logs" / "daily-halt.flag").unlink()
    os.mkfifo(home / "logs" / "daily-halt.flag")
    results, _ = run(tmp_path, "capitano", [MESSAGE])
    assert results[0]["out"] == {"action": "continue"}
