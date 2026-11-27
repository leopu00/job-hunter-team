"""JHT-T346: after the switch of the tools the Assistente says it is back, what happens now and what the person can do.

Seen on Linux (L1 bis): the container was created again on the full image under the person's chat, the Assistente started again
with no word of it, and the chat looked dead («ci sei?»). The host writes state/tools-switch.json just before it stops the core
team; at the first start of the Assistente after it (the launcher runs `assistant_welcome.py settled`, the welcome runs `deliver`)
one line in its name says it is back, with no call of the model, once per switch. A paused team is said paused, never working.

Run:
    pytest tests/test_assistant_back_after_switch.py -v
"""
import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCRIPT = ROOT / "shared" / "skills" / "assistant_welcome.py"
LANGS = ("en", "it", "hu", "es", "de", "fr", "pt")

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the launcher and the container are Linux")


def _catalog(lang):
    return json.loads((ROOT / "shared" / "locales" / f"{lang}.json").read_text(encoding="utf-8"))


EN = _catalog("en")


def _iso(minutes_ago):
    return (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")


class Home:
    def __init__(self, path):
        self.path = path
        self.chat = path / "agents" / "assistente" / "chat.jsonl"
        (path / "state").mkdir(parents=True)
        (path / "profile").mkdir()

    def welcomed(self):
        """The welcome of the first start is in the chat, the onboarding over: the chat a team finds after the switch."""
        self.chat.parent.mkdir(parents=True, exist_ok=True)
        welcome = EN["welcome.assistente"].replace("{file_way}", EN["welcome.assistente_file_unknown"])
        rows = [{"role": "assistant", "text": welcome, "done": True}, {"role": "user", "text": "ok", "done": True}]
        self.chat.write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")
        for flag in ("welcomed.flag", "ready.flag", "onboarding-done.flag"):
            (self.path / "profile" / flag).write_text("2031-01-01T10:00:00Z\n", encoding="utf-8")

    def switched(self, minutes_ago=1):
        (self.path / "state" / "tools-switch.json").write_text(json.dumps({"schema": 1, "at": _iso(minutes_ago)}), encoding="utf-8")

    def run(self, command="settled"):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("JHT_", "FLEET"))}
        env.update(JHT_HOME=str(self.path), JHT_LANG="en")
        return subprocess.run([sys.executable, "-I", str(SCRIPT), command], env=env, capture_output=True, text=True, timeout=60)

    def said(self):
        return [json.loads(l)["text"] for l in self.chat.read_text(encoding="utf-8").splitlines() if l.strip()][2:]


@pytest.fixture
def home(tmp_path):
    return Home(tmp_path)


@pytest.mark.parametrize("command", ("settled", "deliver"))
def test_the_first_start_after_the_switch_says_it_is_back_once(home, command):
    home.welcomed()
    home.switched()
    done = home.run(command)
    assert done.returncode == 0, done.stderr
    # the one line the launcher reads is the one of before
    assert done.stdout.strip() in ("WELCOME_SETTLED", "WELCOME_DELIVERED chat=already telegram=replay flag=ok")
    assert home.said() == [EN["welcome.assistente_back"]]
    for _ in range(2):
        home.run(command)
    assert home.said() == [EN["welcome.assistente_back"]], "once per switch"


def test_a_team_paused_by_the_budget_is_said_paused_never_working(home):
    home.welcomed()
    home.switched()
    (home.path / "logs").mkdir()
    (home.path / "logs" / "daily-halt.flag").write_text(json.dumps({"reason": "pi_spend_cap", "pi_spend_cap": {"why": "budget"}}), encoding="utf-8")
    home.run()
    assert home.said() == [EN["welcome.assistente_back_paused"]]


def test_no_switch_an_old_one_or_no_welcome_yet_says_nothing(home, tmp_path):
    home.welcomed()
    home.run()
    assert home.said() == []
    home.switched(minutes_ago=30)
    home.run()
    assert home.said() == [], "a switch of half an hour ago is not this start"
    fresh = Home(tmp_path / "fresh")
    fresh.switched()
    fresh.run()
    assert not fresh.chat.exists(), "no welcome yet: the welcome comes first"


def test_a_second_switch_is_said_again(home):
    home.welcomed()
    home.switched(minutes_ago=5)
    home.run()
    home.switched(minutes_ago=0)
    home.run()
    assert home.said() == [EN["welcome.assistente_back"]] * 2


@pytest.mark.parametrize("lang", LANGS)
def test_the_line_says_back_what_happens_and_what_to_do_in_every_language(lang):
    catalog = _catalog(lang)
    for key in ("welcome.assistente_back", "welcome.assistente_back_paused"):
        text = catalog[key]
        assert text.strip() and "\n" not in text and "`jht team status`" in text, key
        # the chat of 0.4.0 is the terminal: no app, no dashboard
        for word in ("dashboard", "app ", "App "):
            assert word not in text, (key, word)
    # a paused team is never said to be working on the search
    assert catalog["welcome.assistente_back_paused"] != catalog["welcome.assistente_back"]
