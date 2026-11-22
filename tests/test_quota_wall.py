"""quota_wall.py: the workers answer the provider's limit, so the team pauses, the person is told, and it resumes by itself."""
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "shared"))
import quota_wall as qw  # noqa: E402
import standby as sb  # noqa: E402

NOW = datetime(2026, 11, 20, 12, 0, tzinfo=timezone(timedelta(hours=1)))
CODEX = "■ You've hit your usage limit. Upgrade to Plus, or try again at 6:12 PM."
BUSY = ["• Searching the web for roles", "  ctrl+c to interrupt"]


def screen(*lines):
    return list(lines)


def test_the_hour_on_the_screen_is_read_in_the_ways_the_providers_write_it():
    assert qw.resume_at(CODEX, NOW) == NOW.replace(hour=18, minute=12)
    assert qw.resume_at("5-hour limit reached ∙ resets 3pm", NOW) == NOW.replace(hour=15, minute=0)
    assert qw.resume_at("hit your usage limit, try again at Nov 24th, 2026 6:12 PM.", NOW) == NOW.replace(day=24, hour=18, minute=12)
    assert qw.resume_at("try again at 12:05 AM", NOW) == NOW.replace(day=21, hour=0, minute=5)
    assert qw.resume_at("Usage limit reached", NOW) is None
    assert qw.resume_at("try again at 99:99", NOW) is None
    assert qw.resume_at("try again at Jan 3 9:00 AM", NOW.replace(month=11, day=1)) is None, "more than eight days away is not believed"


def test_a_limit_said_far_up_the_screen_is_old_news():
    assert qw.limit_line([CODEX] + BUSY * 6) is None
    assert qw.limit_line(BUSY + [CODEX]) == CODEX


# Panes as the CLIs draw them (shapes of the fixtures of the other tests: Codex's composer and status row, Claude's prompt, Pi's rules).
CODEX_PANE = ["• Ran the search", "", CODEX, "", "› ", "", "  gpt-5.5 high · 82% context left · /jht_home/agents/scout-1"]
CLAUDE_PANE = ["⏺ Searching the web", "", "  Usage limit reached · resets at 18:00", "", "❯ ", "─" * 40, "  ? for shortcuts"]
PI_PANE = ["Working on it", " Error: 429 Rate limit reached for requests. Retry failed after 3 attempts", "", "─" * 120, "", "─" * 120,
           "/jht_home/agents/scout-1", "↑827 ↓5 $0.002 0.3%/272k (auto)        gpt-5.6-terra • low"]
# The same words inside what a page said, in each CLI's tool block, then the agent went on: not the CLI's own line.
PAGE = ["Promo: usage limit reached · resets at Dec 30 for free accounts", "You've hit your usage limit. Upgrade to Plus, or try again at 6:12 PM."]
WEB_CODEX = ["• Fetched https://example.test/pricing", "  └ " + PAGE[0], "    " + PAGE[1], "", "• The page is an advert, nothing to do with us.", "",
             "› ", "", "  gpt-5.5 high · 82% context left · /jht_home/agents/scout-1"]
WEB_CLAUDE = ["⏺ WebFetch(https://example.test/pricing)", "  ⎿  " + PAGE[0], "      " + PAGE[1], "", "⏺ The page is an advert.", "", "❯ ", "─" * 40, "  ? for shortcuts"]
WEB_PI = ["  $ curl https://example.test/pricing", "    " + PAGE[0], "    Error: 429 quota exceeded, upgrade to Plus", "", "The page is an advert.", "", "─" * 120, "", "─" * 120,
          "/jht_home/agents/scout-1", "↑827 ↓5 $0.002 0.3%/272k (auto)        gpt-5.6-terra • low"]
WEB_BARE_LAST = ["⏺ Bash(cat advert.txt)", "  ⎿  Done", "", "      Usage limit reached · resets at Dec 30", "", "❯ ", "─" * 40, "  ? for shortcuts"]


@pytest.mark.parametrize("pane", [CODEX_PANE, CLAUDE_PANE, PI_PANE])
def test_the_own_line_of_the_cli_of_each_provider_is_recognised(pane):
    assert qw.limit_line(pane) is not None


@pytest.mark.parametrize("pane", [WEB_CODEX, WEB_CLAUDE, WEB_PI, WEB_BARE_LAST, ["x " * 150 + "Usage limit reached"]])
def test_the_same_words_inside_a_page_or_a_tool_are_not_the_limit(pane):
    assert qw.limit_line(pane) is None


def test_a_page_with_the_phrase_in_two_workers_does_not_pause_the_team():
    assert qw.decide({"SCOUT-1": WEB_CODEX, "SCOUT-2": WEB_CLAUDE, "SCORER-1": WEB_PI}, NOW) is None


def test_the_hour_of_the_return_is_the_nearest_the_workers_read_not_the_farthest():
    far = ["■ You've hit your usage limit. Upgrade to Plus, or try again at Nov 28th, 2026 6:12 PM."]
    found = qw.decide({"SCOUT-1": far, "SCOUT-2": [CODEX], "SCORER-1": [CODEX]}, NOW)
    assert found["resume"] == NOW.replace(hour=18, minute=12)


def test_two_workers_saying_the_limit_make_a_wall_and_one_does_not():
    two = {"SCOUT-1": [CODEX], "SCOUT-2": [CODEX], "ANALISTA-1": BUSY, "SCORER-1": BUSY, "SCOUT-3": BUSY}
    assert qw.decide(two, NOW) is None, "two of five is not most of them"
    three = dict(two, **{"SCORER-1": [CODEX]})
    found = qw.decide(three, NOW)
    assert found["sessions"] == ["SCORER-1", "SCOUT-1", "SCOUT-2"] and found["resume"] == NOW.replace(hour=18, minute=12)
    assert qw.decide({"SCOUT-1": [CODEX], "SCOUT-2": BUSY}, NOW) is None
    assert qw.decide({"SCOUT-1": [CODEX]}, NOW) is not None, "a team of one worker"
    assert qw.decide({"CAPITANO": [CODEX], "ASSISTENTE": [CODEX]}, NOW) is None, "only the workers count"
    assert qw.decide({}, NOW) is None


class Fake:
    def __init__(self, tmp_path):
        self.home = tmp_path
        self.told, self.sent, self.users = [], [], []
        self.api = SimpleNamespace(_path=lambda name: self.home, CAPITANO_SESSION="CAPITANO", SENTINELLA_SESSION="SENTINELLA",
                                   time=SimpleNamespace(time=lambda: NOW.timestamp()),
                                   session_exists=lambda s: True, jht_tmux_send=lambda s, t: self.sent.append((s, t)) or True)
        self.run = SimpleNamespace(state={})
        self.standby = SimpleNamespace(
            is_active=lambda home=None: (self.home / ".team-standby.flag").exists(),
            enter=self.enter, log_event=lambda *a, **k: None, MODE_PAUSE=sb.MODE_PAUSE)

    def enter(self, reason, until, by, mode):
        (self.home / ".team-standby.flag").write_text(json.dumps({"until": until.isoformat(), "requested_by": by, "mode": mode}))

    def step(self, screens, now=NOW):
        return qw.step(self.api, self.run, screens=screens, notify_user=lambda t, r: self.users.append((t, r)), standby=self.standby, now=now)


@pytest.fixture(autouse=True)
def no_real_pause(monkeypatch):
    monkeypatch.setattr(qw, "_load", lambda name: SimpleNamespace(pause_all=lambda **k: ([], []), tf=None) if name == "soft_pause_team" else __import__(name))


WALL = {"SCOUT-1": [CODEX], "SCOUT-2": [CODEX], "ANALISTA-1": [CODEX]}


def test_a_wall_pauses_the_team_tells_the_person_and_binds_the_pause_to_the_hour(tmp_path):
    fake = Fake(tmp_path)
    assert fake.step(WALL)["sessions"] == ["ANALISTA-1", "SCOUT-1", "SCOUT-2"]
    flag = json.loads((tmp_path / ".team-standby.flag").read_text())
    assert flag["requested_by"] == "quota" and flag["mode"] == sb.MODE_PAUSE
    assert flag["until"].startswith("2026-11-20T18:14:00"), "the hour on the screen plus the margin"
    state = json.loads((tmp_path / "state" / "quota-wall.json").read_text())
    assert state["on"] is True and state["resumes_at"].startswith("2026-11-20T18:12") and state["probe"] is False
    assert len(fake.users) == 1 and "18:12" in fake.users[0][0]
    assert "quota" in fake.users[0][0].lower()
    assert {s for s, _ in fake.sent} >= {"ASSISTENTE", "CAPITANO"}


def test_without_an_hour_the_pause_is_a_probe_and_the_person_is_told_once_in_six_hours(tmp_path):
    fake = Fake(tmp_path)
    wall = {s: ["Usage limit reached"] for s in WALL}
    assert fake.step(wall)["resume"] is None
    flag = json.loads((tmp_path / ".team-standby.flag").read_text())
    assert flag["until"].startswith("2026-11-20T12:30:00")
    assert len(fake.users) == 1
    (tmp_path / ".team-standby.flag").unlink()           # the probe woke the team
    assert fake.step(wall, NOW + timedelta(minutes=31)) is None, "the first look after the wake only records it"
    assert not (tmp_path / ".team-standby.flag").exists()
    assert json.loads((tmp_path / "state" / "quota-wall.json").read_text())["on"] is False
    assert fake.step(wall, NOW + timedelta(minutes=35)) is None, "the old words are still on the screens: grace"
    fake.step(wall, NOW + timedelta(minutes=45))         # still limited after the grace: paused again
    assert (tmp_path / ".team-standby.flag").exists()
    assert len(fake.users) == 1, "not told again within six hours"


def test_a_team_already_held_by_another_pause_is_left_alone(tmp_path):
    fake = Fake(tmp_path)
    (tmp_path / ".team-standby.flag").write_text("{}")
    assert fake.step(WALL) is None and fake.users == []


def test_a_look_that_breaks_never_stops_the_tick(tmp_path):
    fake = Fake(tmp_path)
    fake.standby.is_active = lambda home=None: (_ for _ in ()).throw(RuntimeError("boom"))
    assert fake.step(WALL) is None


def test_the_state_file_is_written_through_a_new_file_and_never_through_a_link_left_in_its_place(tmp_path):
    import os
    state = tmp_path / "state"
    state.mkdir()
    victim = tmp_path / "victim.txt"
    victim.write_text("keep")
    (state / (".quota-wall.json.%d.tmp" % os.getpid())).symlink_to(victim)
    qw._write_state(tmp_path, {"on": True})
    assert victim.read_text() == "keep"
    assert json.loads((state / "quota-wall.json").read_text()) == {"on": True}
    assert oct((state / "quota-wall.json").stat().st_mode & 0o777) == "0o600"
