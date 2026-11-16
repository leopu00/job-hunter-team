"""A team paused because the old service said «no credit» starts again when the person changes the service or the key.

`jht setup` rewrites jht.config.json; provider_credit.exhausted() leaves out the refusals older than that write, so the
brake's own pause (why=credit) is lifted by the next tick, as any pause of the brake whose reason is gone. Synthetic
sessions in the shape pi writes, no model, no tmux: the bridge is the one of test_pi_spend_cap.py.
"""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests"))
from test_pi_spend_cap import Bridge  # noqa: E402

ZAI_1113 = '429 {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}'
NOW = time.time()  # the session files are filtered by their modification time, which is now


def stamp(offset_s):
    return datetime.fromtimestamp(NOW + offset_s, timezone.utc).isoformat().replace("+00:00", "Z")


def refusal(home: Path, offset_s: float):
    folder = home / ".pi" / "agent" / "sessions" / "--jht_home-agents-assistente--"
    folder.mkdir(parents=True, exist_ok=True)
    lines = [{"type": "session", "id": "s-assistente", "cwd": "/jht_home/agents/assistente"},
             {"type": "message", "timestamp": stamp(offset_s), "message": {
                 "role": "assistant", "provider": "zai", "model": "glm-5.3", "stopReason": "error", "errorMessage": ZAI_1113,
                 "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "cost": {"total": 0}}}}]
    (folder / "2026-11-16T00-00-00-000Z_synthetic.jsonl").write_text(
        "\n".join(json.dumps(line) for line in lines) + "\n", encoding="utf-8")


def test_the_pause_for_the_credit_of_the_old_service_lifts_at_the_tick_after_the_setup(tmp_path):
    refusal(tmp_path, -120)
    bridge = Bridge(tmp_path, {"active_provider": "glm"})
    bridge.clock["now"] = NOW
    state: dict = {}
    bridge.tick(state=state)
    flag = json.loads(bridge.flag.read_text(encoding="utf-8"))
    assert flag["reason"] == "pi_spend_cap" and flag["pi_spend_cap"]["why"] == "credit"
    # the person moves to Claude with `jht setup --reset`: the configuration is written after the refusal
    config = tmp_path / "jht.config.json"
    config.write_text(json.dumps({"active_provider": "claude"}), encoding="utf-8")
    os.utime(config, (NOW - 30, NOW - 30))
    bridge.config = {"active_provider": "claude"}
    bridge.sent.clear()
    bridge.tick(state=state)
    assert not bridge.flag.exists(), "the refusal of GLM is no verdict on Claude"
    assert any("allows work again" in text for text in bridge.texts())


def test_without_a_new_setup_the_pause_stays(tmp_path):
    refusal(tmp_path, -120)
    bridge = Bridge(tmp_path, {"active_provider": "glm"})
    bridge.clock["now"] = NOW
    state: dict = {}
    bridge.tick(state=state)
    bridge.tick(state=state)
    assert bridge.flag.exists() and bridge.esc == 1
