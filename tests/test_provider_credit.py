"""A provider that answers «no more credit» pauses the team in a declared way (JHT-T314). Synthetic sessions only."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared" / "skills"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared"))  # i18n

import pi_spend_cap  # noqa: E402
import provider_credit  # noqa: E402

KIMI_429 = '429 {"error":{"message":"Your account org-x is suspended due to insufficient balance, please check your plan and billing details","type":"exceeded_current_quota_error"}}'
ZAI_1113 = '429 {"error":{"code":"1113","message":"Insufficient balance or no resource package. Please recharge."}}'
OPENAI_QUOTA = '429 You exceeded your current quota, please check your plan and billing details. (insufficient_quota)'
RATE_LIMIT = "429 Rate limit reached for requests: please retry after 20 seconds"


@pytest.mark.parametrize(("message", "provider"), [(KIMI_429, "moonshotai"), (ZAI_1113, "zai"), (OPENAI_QUOTA, "openai"),
                                                   (RATE_LIMIT, None), ("500 server error", None), ("", None), (None, None)])
def test_only_the_words_of_a_credit_that_is_gone_are_told(message, provider):
    assert provider_credit.credit_gone(message) == provider


def session(home: Path, agent: str, rows: list[dict]):
    folder = home / ".pi" / "agent" / "sessions" / ("--jht_home-agents-%s--" % agent)
    folder.mkdir(parents=True, exist_ok=True)
    lines = [{"type": "session", "id": "s-" + agent, "cwd": "/jht_home/agents/" + agent}]
    lines += [{"type": "message", "timestamp": row["at"], "message": row["message"]} for row in rows]
    path = folder / "2026-11-09T00-00-00-000Z_synthetic.jsonl"
    path.write_text("\n".join(json.dumps(line) for line in lines) + "\n", encoding="utf-8")


def error_row(at, provider, text):
    return {"at": at, "message": {"role": "assistant", "provider": provider, "model": "m", "stopReason": "error",
                                  "errorMessage": text, "usage": {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,
                                                                   "cost": {"total": 0}}}}


def ok_row(at, provider):
    return {"at": at, "message": {"role": "assistant", "provider": provider, "model": "m", "stopReason": "stop",
                                  "usage": {"input": 100, "output": 20, "cacheRead": 0, "cacheWrite": 0, "cost": {"total": 0.001}}}}


NOW = time.time()  # the session files are filtered by their modification time, which is now


def stamp(offset_s):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(NOW + offset_s, timezone.utc).isoformat().replace("+00:00", "Z")


def test_the_newest_answer_that_says_no_credit_is_found(tmp_path):
    session(tmp_path, "scout-1", [ok_row(stamp(-600), "zai"), error_row(stamp(-60), "zai", ZAI_1113)])
    found = provider_credit.exhausted(tmp_path, NOW)
    assert found and found["provider"] == "zai" and found["agent"] == "scout-1"


def test_a_call_that_went_through_after_it_says_the_credit_is_back(tmp_path):
    session(tmp_path, "scout-1", [error_row(stamp(-120), "moonshotai", KIMI_429), ok_row(stamp(-30), "moonshotai")])
    assert provider_credit.exhausted(tmp_path, NOW) is None


def test_an_old_answer_a_rate_limit_and_an_empty_home_are_not_a_verdict(tmp_path):
    assert provider_credit.exhausted(tmp_path, NOW) is None
    session(tmp_path, "scout-1", [error_row(stamp(-3 * 3600), "zai", ZAI_1113), error_row(stamp(-30), "zai", RATE_LIMIT)])
    assert provider_credit.exhausted(tmp_path, NOW) is None


def test_the_brake_halts_in_a_declared_way_only_in_the_no_quota_mode(tmp_path):
    session(tmp_path, "scout-1", [error_row(stamp(-60), "moonshotai", KIMI_429)])
    spent = pi_spend_cap.spend(tmp_path, NOW)
    assert spent["credit"]["provider"] == "moonshotai"
    verdict = pi_spend_cap.decide({}, spent, True)
    assert verdict["action"] == "halt" and verdict["why"] == "credit" and verdict["provider"] == "moonshotai"
    assert pi_spend_cap.decide({}, spent, False) == {"action": "none"}
    assert "Kimi (Moonshot)" in pi_spend_cap.captain_text(verdict, spent) and "PAUSED" in pi_spend_cap.captain_text(verdict, spent)


def test_the_user_hears_it_in_every_language_with_the_name_of_the_provider(monkeypatch):
    verdict = {"action": "halt", "why": "credit", "provider": "zai", "spent": 0.0, "ceiling": 0.0}
    for lang in ("en", "it", "de", "es", "fr", "hu", "pt"):
        monkeypatch.setenv("JHT_LANG", lang)
        monkeypatch.setenv("JHT_HOME", "/nonexistent")
        text = pi_spend_cap.user_text(verdict, {"cost": 0.0})
        assert "GLM (Z.ai)" in text and "%s" not in text, (lang, text)
