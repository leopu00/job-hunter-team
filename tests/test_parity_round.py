"""scripts/parity/parity_round.py: a parity round from one command, run here on two local "hosts".

Both sides are directories of this test (transport `local`): no ssh, no VPS, no
real data. The TUI side must never be written; the API side is put in a known
state by moving, never deleting.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "scripts" / "parity"))

import _db  # noqa: E402
import parity_round  # noqa: E402

REV = "789fa882f150062471f0462a07e06516cf552454"


def new_db(path: Path, urls: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    _db.ensure_schema(conn)
    for url in urls:
        conn.execute(
            "INSERT INTO positions (title, company, url, status, found_by, source) VALUES ('Synthetic Engineer', 'Example Co', ?, 'new', 'scout-1', 'example')",
            (url,),
        )
    conn.commit()
    conn.close()


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


class Box:
    """A TUI side and an API side in tmp_path, and the round's config for them."""

    def __init__(self, tmp: Path):
        self.tui = tmp / "tui"
        self.api = tmp / "api"
        self.out = tmp / "out"
        new_db(self.tui / "jobs.db", ["https://jobs.example/a", "https://jobs.example/b"])
        (self.tui / "profile.yml").write_text("name: Synthetic\n")
        (self.tui / "identity").write_text("started-1 image-1\n")
        new_db(self.api / "db" / "jobs.db", ["https://jobs.example/mock-old"])
        (self.api / "profile").mkdir()
        (self.api / "profile" / "candidate_profile.yml").write_text("name: Synthetic\n")
        (self.api / "keyproxy.json").write_text(json.dumps({"spent_usd": 1.0, "cap_usd": 3.0}))
        (self.api / "roles_running").write_text("0\n")
        # What an old round left, that the roles would read.
        mailbox = self.api / "home" / "channels" / "mailbox"
        mailbox.mkdir(parents=True)
        (mailbox / "capitano-1.jsonl").write_text('{"text":"old daily overrun"}\n')
        (self.api / "home" / "channels" / "notify.jsonl").write_text('{"old":1}\n')
        diary = self.api / "roles" / "capitano-1" / "base" / "team" / "logs"
        diary.mkdir(parents=True)
        (diary / "captain-diary-2026-09-20.md").write_text("HARD-COAST\n")
        control = self.api / "launcher" / "control"
        control.mkdir(parents=True)
        (control / "config.json").write_text('{"session": "old"}\n')
        (control / "STOP").write_text("")
        self.config = {
            "out_dir": str(self.out),
            "snapshot_every_min": 60,
            "tick_s": 60,
            "relaunch_min_s": 600,
            "tui": {
                "transport": "local",
                "exec_prefix": "",
                "db": str(self.tui / "jobs.db"),
                "profile": str(self.tui / "profile.yml"),
                "revision_cmd": f"echo {REV}",
                "identity_cmd": f"cat {self.tui / 'identity'}",
            },
            "api": {
                "transport": "local",
                "root": str(self.api),
                "db": str(self.api / "db" / "jobs.db"),
                "db_dir": "db",
                "profile": str(self.api / "profile" / "candidate_profile.yml"),
                "revision_cmd": "echo '[localhost/jht-api:latest localhost/jht-api:789fa882f1]'",
                "proxy_state": "{root}/keyproxy.json",
                "running_roles_cmd": "cat {root}/roles_running",
                "known_state_globs": [
                    "home/channels/mailbox/*.jsonl",
                    "home/channels/notify.jsonl",
                    "home/channels/replies/*",
                    "roles/*/base/team/logs/captain-diary-*.md",
                ],
                "launcher_config": "launcher/control/config.json",
                "stop_file": "launcher/control/STOP",
                "start_cmds": ["echo start >> {root}/actions.log"],
                "relaunch_cmds": ["echo relaunch >> {root}/actions.log"],
                "stop_cmds": ["echo stop >> {root}/actions.log", "touch {root}/launcher/control/STOP"],
            },
            "launcher_config": {"maxMinutes": 120, "team": [{"role": "scout", "instances": 1}]},
        }
        self.config_path = tmp / "round.json"
        self.write()

    def write(self) -> None:
        self.config_path.write_text(json.dumps(self.config))

    def cfg(self) -> parity_round.Config:
        self.write()
        return parity_round.Config.load(self.config_path)

    def spend(self, spent: float, cap: float = 3.0) -> None:
        (self.api / "keyproxy.json").write_text(json.dumps({"spent_usd": spent, "cap_usd": cap}))

    def actions(self) -> list[str]:
        path = self.api / "actions.log"
        return path.read_text().split() if path.exists() else []


class FakeClock:
    """Time that passes only when the round sleeps; `at` runs a change at a given minute."""

    def __init__(self, start: float = 1_790_000_000.0):
        self.t = start
        self.start = start
        self.hooks: list[tuple[float, callable]] = []

    def at(self, minute: float, action) -> None:
        self.hooks.append((self.start + minute * 60, action))

    def now(self) -> float:
        return self.t

    def sleep(self, seconds: float) -> None:
        self.t += seconds
        for when, action in list(self.hooks):
            if self.t >= when:
                self.hooks.remove((when, action))
                action()


@pytest.fixture
def box(tmp_path: Path) -> Box:
    return Box(tmp_path)


def clock_for(box: Box) -> parity_round.Clock:
    fake = FakeClock()
    box.fake = fake
    return parity_round.Clock(now=fake.now, sleep=fake.sleep)


# ── check (read only) ────────────────────────────────────────────────────


def test_check_names_what_an_old_round_left_and_touches_nothing(box: Box):
    before = {p: sha(p) for p in box.api.rglob("*") if p.is_file()}
    result = parity_round.check(box.cfg(), budget_usd=2.0)
    assert result.facts["revision"] == {"tui": REV, "api": "789fa882f1"}
    assert result.facts["profile_same"] is True
    assert not result.ok
    assert any("mailbox" in p for p in result.problems)
    assert any("captain-diary" in p for p in result.problems)
    assert {p: sha(p) for p in box.api.rglob("*") if p.is_file()} == before


def test_check_refuses_two_revisions_two_profiles_and_a_cap_that_disagrees(box: Box):
    box.config["api"]["known_state_globs"] = []
    box.config["api"]["revision_cmd"] = "echo '[localhost/jht-api:latest localhost/jht-api:811212588e]'"
    (box.api / "profile" / "candidate_profile.yml").write_text("name: Someone else\n")
    box.spend(1.0, cap=2.5)  # 1.5 left for a budget of 2
    problems = parity_round.check(box.cfg(), budget_usd=2.0).problems
    assert any("same code revision" in p for p in problems)
    assert any("same candidate profile" in p for p in problems)
    assert any("less than the budget" in p for p in problems)
    box.spend(1.0, cap=10.0)  # 9 left: the proxy is no backstop
    assert any("no backstop" in p for p in parity_round.check(box.cfg(), budget_usd=2.0).problems)
    (box.api / "roles_running").write_text("3\n")
    assert any("already running" in p for p in parity_round.check(box.cfg(), budget_usd=2.0).problems)


def test_a_revision_is_a_full_sha_or_the_one_hex_tag_of_the_image():
    assert parity_round.extract_revision(REV + "\n") == REV
    assert parity_round.extract_revision("[localhost/jht-api:latest localhost/jht-api:811212588e]") == "811212588e"
    assert parity_round.extract_revision("[localhost/jht-api:latest]") == ""
    assert parity_round.same_revision(REV, "789fa882f1")
    assert not parity_round.same_revision(REV, "811212588e")
    assert not parity_round.same_revision("", "")


# ── start ────────────────────────────────────────────────────────────────


def test_start_without_yes_prints_the_plan_and_does_nothing(box: Box, capsys):
    before = {p: sha(p) for p in box.api.rglob("*") if p.is_file()}
    assert parity_round.main(["start", str(box.config_path), "--hours", "10", "--budget-usd", "2"]) == 0
    assert "--yes" in capsys.readouterr().out
    assert {p: sha(p) for p in box.api.rglob("*") if p.is_file()} == before
    assert not box.out.exists()


def test_a_whole_round_known_state_copies_on_the_clock_relaunch_and_report(box: Box):
    tui_before = sha(box.tui / "jobs.db")
    clock = clock_for(box)
    # At minute 30 the API roles have ended: the round relaunches them.
    box.fake.at(1, lambda: None)
    rnd = parity_round.run(box.cfg(), hours=2, budget_usd=2.0, clock=clock, round_id="round-test")

    # The TUI side was only read.
    assert sha(box.tui / "jobs.db") == tui_before
    # Known state: everything old moved into the archive, nothing deleted.
    archive = box.api / "archivio-round-test"
    assert (archive / "state" / "home" / "channels" / "mailbox" / "capitano-1.jsonl").read_text().startswith('{"text":"old')
    assert (archive / "state" / "home" / "channels" / "notify.jsonl").exists()
    assert (archive / "state" / "roles" / "capitano-1" / "base" / "team" / "logs" / "captain-diary-2026-09-20.md").exists()
    assert (archive / "db" / "jobs.db").exists()
    assert (box.api / "launcher" / "control" / "config.json.usata-round-test").read_text() == '{"session": "old"}\n'
    launcher = json.loads((box.api / "launcher" / "control" / "config.json").read_text())
    assert launcher["session"] == "round-test" and launcher["sessionUsd"] == 2.0 and launcher["maxMinutes"] == 120
    # The API db is the seed: the TUI's two positions, not the old mock row.
    urls = {r[0] for r in sqlite3.connect(box.api / "db" / "jobs.db").execute("SELECT url FROM positions")}
    assert urls == {"https://jobs.example/a", "https://jobs.example/b"}

    # Copies: T0, one per hour on the clock, and the end; a diff for each.
    labels = sorted(p.name for p in rnd.dir.glob("api-T*.db"))
    assert "api-T0.db" in labels and "api-Tend.db" in labels and len(labels) >= 3
    assert all((rnd.dir / f"diff-{n[4:-3]}.json").exists() for n in labels)
    # Start, relaunches every 10 minutes at most while no role runs, stop.
    actions = box.actions()
    assert actions[0] == "start" and actions[-1] == "stop"
    relaunches = actions.count("relaunch")
    assert 1 <= relaunches <= 2 * 60 // 10
    assert (box.api / "launcher" / "control" / "STOP").exists()
    report = (rnd.dir / "REPORT.md").read_text()
    assert "Verdict: VALID" in report and "end_of_window" in report


def test_the_tui_side_changing_code_stops_the_round_and_voids_it(box: Box):
    clock = clock_for(box)
    box.fake.at(45, lambda: (box.tui / "identity").write_text("started-2 image-2\n"))
    rnd = parity_round.run(box.cfg(), hours=10, budget_usd=2.0, clock=clock, round_id="round-restart")
    report = (rnd.dir / "REPORT.md").read_text()
    assert "NOT VALID" in report and "changed code" in report
    assert box.actions()[-1] == "stop"
    assert (rnd.dir / "api-Tend.db").exists()
    assert box.fake.now() - box.fake.start < 60 * 60


def test_the_budget_stops_the_round_on_the_spend_since_the_start(box: Box):
    # The key proxy counts since long before the round: 2.5 spent already, 2.0 left.
    box.spend(2.5, cap=4.5)
    clock = clock_for(box)
    box.fake.at(90, lambda: box.spend(4.49, cap=4.5))  # 1.99 spent since the start, of a 2.0 budget
    rnd = parity_round.run(box.cfg(), hours=10, budget_usd=2.0, clock=clock, round_id="round-cap")
    events = [json.loads(l) for l in (rnd.dir / "timeline.jsonl").read_text().splitlines()]
    assert any(e["event"] == "budget_reached" for e in events)
    assert next(e for e in events if e["event"] == "stop")["reason"] == "budget"
    assert 90 * 60 <= box.fake.now() - box.fake.start < 2 * 60 * 60


def test_a_round_does_not_start_on_a_side_that_is_not_ready(box: Box):
    box.config["api"]["revision_cmd"] = "echo '[localhost/jht-api:811212588e]'"
    with pytest.raises(parity_round.RoundError, match="same code revision"):
        parity_round.run(box.cfg(), hours=1, budget_usd=2.0, clock=clock_for(box), round_id="round-refused")
    # Nothing on the API side moved.
    assert (box.api / "home" / "channels" / "mailbox" / "capitano-1.jsonl").exists()
    assert not (box.api / "archivio-round-refused").exists()


def test_the_example_config_and_the_readme_carry_no_address():
    # Hosts come from a config outside git: the repository names no machine.
    for name in ("round.example.json", "README.md"):
        text = (ROOT / "scripts" / "parity" / name).read_text()
        assert not re.search(r"\b\d{1,3}(\.\d{1,3}){3}\b", text), name
    example = json.loads((ROOT / "scripts" / "parity" / "round.example.json").read_text())
    assert example["tui"]["host"].startswith("<") and example["api"]["host"].startswith("<")


def test_a_role_that_comes_up_while_the_state_is_prepared_stops_the_round_before_the_start(box: Box):
    # A hub left running starts a role between the first check and the start.
    calls = box.api / "role_checks"
    box.config["api"]["running_roles_cmd"] = (
        f'n=$(cat {calls} 2>/dev/null || echo 0); echo $((n+1)) > {calls}; [ "$n" -ge 1 ] && echo 1 || echo 0'
    )
    with pytest.raises(parity_round.RoundError, match="after the known state"):
        parity_round.run(box.cfg(), hours=1, budget_usd=2.0, clock=clock_for(box), round_id="round-late-role")
    assert box.actions() == []


def test_a_box_silent_for_a_few_minutes_does_not_lose_the_round(box: Box):
    state = box.api / "keyproxy.json"
    saved = {}
    clock = clock_for(box)
    box.fake.at(10, lambda: saved.setdefault("s", state.read_text()) and state.unlink())
    box.fake.at(13, lambda: state.write_text(saved["s"]))
    rnd = parity_round.run(box.cfg(), hours=1, budget_usd=2.0, clock=clock, round_id="round-blip")
    events = [json.loads(l) for l in (rnd.dir / "timeline.jsonl").read_text().splitlines()]
    assert sum(e["event"] == "unreachable" for e in events) >= 2
    assert next(e for e in events if e["event"] == "stop")["reason"] == "end_of_window"
    assert "Verdict: VALID" in (rnd.dir / "REPORT.md").read_text()


def test_a_box_that_stays_silent_stops_the_round_and_still_gets_its_stop(box: Box):
    box.config["max_consecutive_misses"] = 5
    clock = clock_for(box)
    box.fake.at(10, lambda: (box.api / "keyproxy.json").unlink())
    rnd = parity_round.run(box.cfg(), hours=10, budget_usd=2.0, clock=clock, round_id="round-silent")
    assert box.actions()[-1] == "stop"
    assert (box.api / "launcher" / "control" / "STOP").exists()
    report = (rnd.dir / "REPORT.md").read_text()
    assert "NOT VALID" in report and "unreachable" in report
    assert box.fake.now() - box.fake.start < 30 * 60
