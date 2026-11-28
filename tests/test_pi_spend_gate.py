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
(async () => {
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
  if (step.standby !== undefined) {
    const file = process.env.JHT_HOME + "/.team-standby.flag";
    if (step.standby === null) { try { fs.unlinkSync(file); } catch (e) {} }
    else fs.writeFileSync(file, typeof step.standby === "string" ? step.standby : JSON.stringify(step.standby));
    continue;
  }
  if (step.queue !== undefined) {
    const file = process.env.JHT_HOME + "/state/pace-wake-queue.json";
    fs.mkdirSync(process.env.JHT_HOME + "/state", { recursive: true });
    if (step.queue === null) { try { fs.unlinkSync(file); } catch (e) {} }
    else fs.writeFileSync(file, typeof step.queue === "string" ? step.queue : JSON.stringify(step.queue));
    continue;
  }
  let aborted = 0;
  const ctx = { abort: () => { aborted += 1; } };
  const out = await Promise.all((handlers[step.event] || []).map((fn) => fn({ text: step.text || "", payload: {} }, ctx)));
  results.push({ handlers: out.length, out: out.length ? (out[0] === undefined ? null : out[0]) : null, aborted });
}
process.stdout.write(JSON.stringify(results));
})().catch((error) => { console.error(error); process.exitCode = 1; });
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


def _queue(names, age_s=0):
    import time
    return {"queue": {"pending": names, "at": time.time() - age_s}}


def test_a_session_in_the_queue_of_the_pace_holds_every_message_and_its_turn_stops(tmp_path):
    results, home = run(tmp_path, "scorer-1", [_queue(["SCORER-1", "DOTTORE"]), MESSAGE, REQUEST])
    assert results[0]["out"] == {"action": "handled"} and results[1]["aborted"] == 1
    assert "input_held_for_the_pace" in (home / "logs" / "pi-spend-gate.log").read_text(encoding="utf-8")


def test_what_was_held_for_the_pace_reaches_the_session_in_the_message_that_wakes_it(tmp_path):
    steps = [_queue(["SCORER-1"]),
             {"event": "input", "text": "[TEAM-LANGUAGE] answer in Italian"},
             {"event": "input", "text": "[WAKE] positions waiting"},
             {"event": "input", "text": "[TEAM-LANGUAGE] answer in Italian"},
             _queue([]),                                       # its stage: the brake took the name out BEFORE the message
             {"event": "input", "text": "[RIPRENDI] The pace allows your work again"},
             {"event": "input", "text": "next"}]
    results, _ = run(tmp_path, "scorer-1", steps)
    assert [r["out"]["action"] for r in results[:3]] == ["handled"] * 3
    woken = results[3]["out"]
    assert woken["action"] == "transform" and woken["text"].startswith("[RIPRENDI] The pace allows your work again")
    assert woken["text"].count("[TEAM-LANGUAGE] answer in Italian") == 1, "once each"
    assert "[WAKE] positions waiting" in woken["text"]
    assert results[4]["out"] == {"action": "continue"}, "delivered once"


def test_a_session_not_in_the_queue_is_not_held(tmp_path):
    results, _ = run(tmp_path, "scout-1", [_queue(["SCORER-1"]), MESSAGE, REQUEST])
    assert results[0]["out"] == {"action": "continue"} and results[1]["aborted"] == 0


@pytest.mark.parametrize("queue", ["not json", "[]", '{"pending": "SCORER-1", "at": 1}', "", '{"pending": ["SCORER-1"]}'])
def test_a_queue_that_cannot_be_read_holds_nobody(tmp_path, queue):
    results, _ = run(tmp_path, "scorer-1", [{"queue": queue}, MESSAGE, REQUEST])
    assert results[0]["out"] == {"action": "continue"} and results[1]["aborted"] == 0


def test_a_queue_nobody_touched_for_two_hours_holds_nobody(tmp_path):
    results, _ = run(tmp_path, "scorer-1", [_queue(["SCORER-1"], age_s=2 * 3600 + 60), MESSAGE, REQUEST])
    assert results[0]["out"] == {"action": "continue"} and results[1]["aborted"] == 0


def test_the_assistente_is_not_held_by_the_queue_either(tmp_path):
    results, _ = run(tmp_path, "assistente", [_queue(["ASSISTENTE"]), MESSAGE, REQUEST])
    assert results[0]["handlers"] == 0 and results[1]["aborted"] == 0, "no handler at all: it is the person's voice"


# The person's pause and the technical standby (standby.py, .team-standby.flag): in a test run, the spending went on during
# «PAUSA TEAM» because the pause was only a message. Flags written the way standby.enter writes them.
def _standby(hours=1.0, **extra):
    from datetime import datetime, timedelta, timezone
    now = datetime.now(timezone.utc)
    payload = {"since": int(now.timestamp()), "until": (now + timedelta(hours=hours)).isoformat(timespec="seconds"),
               "wake_on": None, "reason": "user pause", "requested_by": "assistente", "mode": "pause", "manual": True}
    payload.update(extra)
    return {"standby": payload}


@pytest.mark.parametrize("agent", ["capitano", "scout-1", "analista-2", "scorer-1", "sentinella"])
def test_during_the_persons_pause_no_message_reaches_the_model_and_a_running_turn_stops(tmp_path, agent):
    results, home = run(tmp_path, agent, [_standby(), MESSAGE, REQUEST])
    assert results[0]["out"] == {"action": "handled"}, "the message does not reach the model"
    assert results[1]["aborted"] == 1, "a turn already running stops before its next request: the spending stops"
    log = (home / "logs" / "pi-spend-gate.log").read_text(encoding="utf-8")
    assert "input_held_for_the_pause" in log and "synthetic" not in log


def test_the_technical_standby_with_only_a_weekly_wake_holds_the_team_too(tmp_path):
    results, _ = run(tmp_path, "scout-1", [_standby(until=None, wake_on={"weekly_below": 100.0}, mode=None), MESSAGE, REQUEST])
    assert results[0]["out"] == {"action": "handled"} and results[1]["aborted"] == 1


def test_at_the_resume_what_was_held_arrives_once_without_the_pause_notice(tmp_path):
    steps = [_standby(),
             {"event": "input", "text": "[PAUSA] The user has paused the team. This is a PAUSE, not a shutdown"},
             {"event": "input", "text": "[WAKE] positions waiting"},
             {"event": "input", "text": "[WAKE] positions waiting"},
             {"standby": None},                                # standby.wake removes the flag BEFORE the [RIPRENDI]
             {"event": "input", "text": "[RIPRENDI] The pause is over"},
             MESSAGE, REQUEST]
    results, _ = run(tmp_path, "scout-1", steps)
    assert [r["out"]["action"] for r in results[:3]] == ["handled"] * 3
    woken = results[3]["out"]
    assert woken["action"] == "transform" and woken["text"].startswith("[RIPRENDI] The pause is over")
    assert woken["text"].count("[WAKE] positions waiting") == 1 and "[PAUSA]" not in woken["text"]
    assert results[4]["out"] == {"action": "continue"} and results[5]["aborted"] == 0, "after the resume the team works"


def test_the_assistente_answers_the_person_during_the_pause(tmp_path):
    results, _ = run(tmp_path, "assistente", [_standby(), MESSAGE, REQUEST])
    assert results[0]["handlers"] == 0 and results[1]["handlers"] == 0


@pytest.mark.parametrize("flag", [
    {"standby": "{broken"}, {"standby": ""}, {"standby": "[]"},
    {"standby": {"since": 1, "until": None, "wake_on": None}},              # no exit condition: standby.py calls it invalid
    _standby(hours=-1),                                                     # past its until: expired, nobody is held
])
def test_a_standby_flag_that_is_broken_expired_or_without_exit_holds_nobody(tmp_path, flag):
    results, _ = run(tmp_path, "scout-1", [flag, MESSAGE, REQUEST])
    assert results[0]["out"] == {"action": "continue"} and results[1]["aborted"] == 0
