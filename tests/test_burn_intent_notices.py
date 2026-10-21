"""JHT-T33 — the user is told when the full-throttle override is about to end, and when it has.

On 20/10 an override of 8.8 hours expired at 05:58 UTC and the team went back to its normal pace;
the next night the yield fell from 58 positions to 17 and nobody, the user included, knew why. Now
`burn_intent.announce()` tells the user twice per grant, in the user's language, through the same
channel every other message to the user takes:

- `warning` — one hour (or less) before the end; not for a grant of an hour or less;
- `expired` — the override ran out; sent before the flag is cleared, so it is still there to read.

Each is sent once per grant; a renewal is a new grant. A send that fails is not marked as sent and
is tried again at the next tick. The panel of the agents reads the state from `agent_control team`
(see test_agent_control.py).
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SKILLS = ROOT / "shared" / "skills"
LAUNCHER = ROOT / ".launcher"
sys.path.insert(0, str(SKILLS))
sys.path.insert(0, str(ROOT / "shared"))

import burn_intent as bi_module  # noqa: E402

T0 = datetime(2026, 10, 20, 0, 0, tzinfo=timezone.utc)
LANGS = ("en", "it", "de", "es", "fr", "hu", "pt")


@pytest.fixture
def bi(tmp_path, monkeypatch):
    bi_module.INTENT_FLAG = tmp_path / ".burn-intent.flag"
    bi_module.AUDIT_LOG = tmp_path / "logs" / "burn-intent.jsonl"
    bi_module.NOTICES_FILE = tmp_path / ".burn-intent-notices.json"
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_LANG", "en")
    return bi_module


class Outbox:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []
        self.fail = False

    def __call__(self, kind, message, data):
        if self.fail:
            raise RuntimeError("the channel is down")
        self.sent.append((kind, message))


def test_the_user_is_warned_an_hour_before_the_end_and_only_once(bi):
    bi.grant(hours=8.8, now=T0)
    out = Outbox()
    ends = T0 + timedelta(hours=8.8)
    assert bi.announce(now=ends - timedelta(minutes=61), notifier=out) == []
    assert bi.announce(now=ends - timedelta(minutes=60), notifier=out) == ["warning"]
    assert bi.announce(now=ends - timedelta(minutes=30), notifier=out) == []
    [(kind, message)] = out.sent
    assert kind == "warning" and "60 minutes" in message and "08:48 UTC" in message and "Captain" in message


def test_the_user_is_told_when_it_has_ended_before_the_flag_is_cleared(bi):
    bi.grant(hours=8.8, now=T0)
    out = Outbox()
    ends = T0 + timedelta(hours=8.8)
    assert bi.announce(now=ends - timedelta(minutes=10), notifier=out) == ["warning"]
    after = ends + timedelta(minutes=1)
    assert bi.announce(now=after, notifier=out) == ["expired"]
    assert [k for k, _ in out.sent] == ["warning", "expired"]
    assert "08:48 UTC" in out.sent[1][1]
    # The bridge sweeps after announcing; once the flag is gone there is nothing more to say.
    assert bi.sweep(now=after) is not None
    assert bi.announce(now=after + timedelta(minutes=5), notifier=out) == []
    assert len(out.sent) == 2


def test_a_bridge_that_was_down_still_says_it_ended_but_not_that_it_was_ending(bi):
    bi.grant(hours=5, now=T0)
    out = Outbox()
    assert bi.announce(now=T0 + timedelta(hours=7), notifier=out) == ["expired"]
    assert [k for k, _ in out.sent] == ["expired"]


def test_a_grant_of_an_hour_or_less_has_no_warning_only_the_end(bi):
    bi.grant(hours=1, now=T0)
    out = Outbox()
    assert bi.announce(now=T0 + timedelta(minutes=1), notifier=out) == []
    assert bi.announce(now=T0 + timedelta(minutes=59), notifier=out) == []
    assert bi.announce(now=T0 + timedelta(minutes=61), notifier=out) == ["expired"]


def test_a_renewal_is_a_new_grant_and_warns_again(bi):
    bi.grant(hours=5, now=T0)
    out = Outbox()
    assert bi.announce(now=T0 + timedelta(hours=4, minutes=5), notifier=out) == ["warning"]
    renewed = T0 + timedelta(hours=4, minutes=10)
    bi.grant(hours=5, now=renewed)
    assert bi.announce(now=renewed + timedelta(minutes=1), notifier=out) == []
    assert bi.announce(now=renewed + timedelta(hours=4, minutes=5), notifier=out) == ["warning"]


def test_a_revoked_override_does_not_announce_an_ending(bi):
    bi.grant(hours=5, now=T0)
    out = Outbox()
    bi.revoke(now=T0 + timedelta(hours=1))
    assert bi.announce(now=T0 + timedelta(hours=6), notifier=out) == []
    assert out.sent == []


def test_a_send_that_fails_is_not_marked_and_is_tried_again(bi):
    bi.grant(hours=5, now=T0)
    out = Outbox()
    out.fail = True
    when = T0 + timedelta(hours=4, minutes=30)
    assert bi.announce(now=when, notifier=out) == []
    assert not bi.NOTICES_FILE.exists()
    out.fail = False
    assert bi.announce(now=when + timedelta(minutes=1), notifier=out) == ["warning"]
    assert json.loads(bi.NOTICES_FILE.read_text())["sent"] == ["warning"]


def test_no_flag_or_a_broken_one_announces_nothing_and_never_raises(bi):
    out = Outbox()
    assert bi.announce(now=T0, notifier=out) == []
    bi.INTENT_FLAG.write_text("not json", encoding="utf-8")
    assert bi.announce(now=T0, notifier=out) == []
    assert out.sent == []


@pytest.mark.parametrize("lang", LANGS)
def test_the_message_is_in_the_users_language(bi, monkeypatch, lang):
    monkeypatch.setenv("JHT_LANG", lang)
    data = bi.grant(hours=5, now=T0)
    warning = bi.notice_text("warning", data)
    expired = bi.notice_text("expired", data)
    assert "60" in warning and "05:00" in warning and "burn_intent" not in warning
    assert "burn_intent" not in expired
    assert warning != expired
    import text_language

    for text in (warning, expired):
        assert text_language.guess_language(text) in (lang, None), (lang, text)


def test_every_catalog_has_both_messages_with_the_same_placeholders():
    catalogs = {lang: json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8")) for lang in LANGS}
    for lang, catalog in catalogs.items():
        assert catalog["burn_intent.warning"].count("%d") == 1 and catalog["burn_intent.warning"].count("%s") == 1, lang
        assert catalog["burn_intent.expired"].count("%s") == 1 and "%d" not in catalog["burn_intent.expired"], lang
    assert len({c["burn_intent.warning"] for c in catalogs.values()}) == len(LANGS)


def test_the_message_goes_through_the_channel_every_other_message_to_the_user_takes(bi, monkeypatch):
    calls = []

    class Done:
        returncode = 0

    monkeypatch.setattr(bi.subprocess, "run", lambda command, **kw: calls.append(command) or Done())
    monkeypatch.setattr(bi.shutil, "which", lambda name: None)
    data = bi.grant(hours=5, now=T0)
    bi._default_notifier("warning", "hello", data)
    [command] = calls
    assert command[0].endswith("jht-notify-user")
    assert command[command.index("--agent") + 1] == "capitano" and command[command.index("--kind") + 1] == "alert"
    payload = json.loads(command[command.index("--source-payload") + 1])
    assert payload == {"kind": "warning", "expires_at": data["expires_at"]}
    assert command[command.index("--source-action") + 1] == "burn_intent_notice"
    assert command[-1] == "hello"


def test_the_sentinel_bridge_announces_before_it_sweeps():
    src = (LAUNCHER / "sentinel-bridge.py").read_text(encoding="utf-8")
    tick = src[src.index("_burn_intent_notify_user()\n"):]
    assert tick.index("_burn_intent_notify_user()") < tick.index("_burn_intent_sweep()")
    assert "announce()" in src
