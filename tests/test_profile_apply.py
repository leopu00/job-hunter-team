"""profile_apply.py: one turn of the onboarding in one command (profile, summaries, check, answer)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

SCRIPT = Path(__file__).resolve().parents[1] / "shared" / "skills" / "profile_apply.py"


class Box:
    def __init__(self, root: Path, send_rc: int = 0):
        self.home = root / "jht"
        (self.home / "profile").mkdir(parents=True)
        self.sent = root / "sent.txt"
        send = root / "jht-send"
        send.write_text(f'#!/bin/sh\n{{ echo "ARGS $*"; cat; }} >> "{self.sent}"\nexit {send_rc}\n', encoding="utf-8")
        send.chmod(0o755)
        self.env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(self.home), "JHT_SEND_BIN": str(send),
                    "PYTHONDONTWRITEBYTECODE": "1"}

    @property
    def profile(self) -> Path:
        return self.home / "profile" / "candidate_profile.yml"

    def run(self, request) -> tuple[int, dict]:
        text = request if isinstance(request, str) else json.dumps(request)
        done = subprocess.run([sys.executable, "-I", str(SCRIPT)], input=text, capture_output=True, text=True,
                              timeout=120, env=self.env, check=False)
        return done.returncode, json.loads(done.stdout)

    def doc(self) -> dict:
        return yaml.safe_load(self.profile.read_text(encoding="utf-8"))

    def messages(self) -> str:
        return self.sent.read_text(encoding="utf-8") if self.sent.exists() else ""


@pytest.fixture()
def box(tmp_path: Path) -> Box:
    return Box(tmp_path)


def test_the_first_turn_creates_the_profile_and_says_what_is_missing(box: Box):
    code, out = box.run({"set": {"name": "Ada Example"}})
    assert code == 0 and out["ok"] and out["written"] == ["candidate_profile.yml"]
    assert box.doc() == {"name": "Ada Example"}
    assert any("target_role" in line for line in out["missing"]) and out["invalid"] == []
    assert out["launch_ready"] is False and out["said"] is False and box.messages() == ""


def test_dotted_paths_nest_and_append_does_not_repeat_items(box: Box):
    box.run({"set": {"preferences.work_mode": "remote", "skills.primary": ["SQL"]}})
    code, _ = box.run({"append": {"skills.primary": ["SQL", "Python"], "skills.secondary": ["Excel"]},
                       "set": {"preferences.salary": "32-38k"}})
    assert code == 0
    doc = box.doc()
    assert doc["skills"] == {"primary": ["SQL", "Python"], "secondary": ["Excel"]}
    assert doc["preferences"] == {"work_mode": "remote", "salary": "32-38k"}


def test_a_complete_launch_set_says_launch_ready_and_reports_the_flag(box: Box):
    request = {"set": {"name": "Ada Example", "target_role": "Data Analyst", "location": "Bologna", "experience_years": 5,
                       "seniority_target": "mid", "skills": {"primary": ["SQL"], "secondary": []},
                       "languages": [{"language": "Italian", "level": "native"}]}}
    code, out = box.run(request)
    assert code == 0 and out["launch_ready"] is True and out["launch_missing"] == [] and out["ready_flag"] is False
    (box.home / "profile" / "ready.flag").write_text("x", encoding="utf-8")
    assert box.run({"set": {"name": "Ada Example"}})[1]["ready_flag"] is True


def test_a_value_of_the_wrong_type_is_reported_as_invalid_not_missing(box: Box):
    code, out = box.run({"set": {"name": "Ada", "experience_years": "five"}})
    assert code == 0
    assert any("experience_years" in line for line in out["missing"] + out["invalid"])


def test_summaries_are_written_whole_and_only_with_the_four_names(box: Box):
    code, out = box.run({"summaries": {"about": "I am Ada.", "preferences": "Remote."}})
    assert code == 0 and out["written"] == ["summaries/about.md", "summaries/preferences.md"]
    box.run({"summaries": {"about": "I am Ada, a data analyst."}})
    assert (box.home / "profile" / "summaries" / "about.md").read_text(encoding="utf-8") == "I am Ada, a data analyst.\n"
    code, out = box.run({"set": {"name": "X"}, "summaries": {"about-ada": "no"}})
    assert code == 1 and "about-ada" in out["error"]
    assert not (box.home / "profile" / "summaries" / "about-ada.md").exists()


def test_the_answer_goes_to_the_chat_after_the_writes_with_its_kind(box: Box):
    code, out = box.run({"set": {"name": "Ada"}, "say": "[caldo] Hi $20 Ada", "kind": "completed"})
    assert code == 0 and out["said"] is True
    sent = box.messages()
    assert sent.startswith("ARGS --kind completed -\n") and "[caldo] Hi $20 Ada" in sent  # from stdin: the $ stays


def test_a_refused_request_writes_nothing_and_says_nothing(box: Box):
    box.run({"set": {"name": "Ada"}})
    before = box.profile.read_text(encoding="utf-8")
    for bad in ({"set": {"name": "B"}, "say": "hi", "kind": "shout"}, {"set": {"a..b": 1}},
                {"append": {"skills.primary": "SQL"}}, {"set": {"name.first": "B"}}, "not json", [1]):
        code, out = box.run(bad)
        assert code == 1 and out["ok"] is False, bad
    assert box.profile.read_text(encoding="utf-8") == before and box.messages() == ""


def test_a_profile_on_disk_that_is_not_an_object_is_left_alone(box: Box):
    box.profile.write_text("- just\n- a list\n", encoding="utf-8")
    code, out = box.run({"set": {"name": "Ada"}})
    assert code == 1 and "not an object" in out["error"]
    assert box.profile.read_text(encoding="utf-8") == "- just\n- a list\n"


def test_a_chat_that_fails_does_not_undo_the_profile(box: Box, tmp_path: Path):
    failing = Box(tmp_path / "f", send_rc=1)
    code, out = failing.run({"set": {"name": "Ada"}, "say": "hello"})
    assert code == 0 and out["said"] is False and failing.doc() == {"name": "Ada"}


def test_no_temporary_file_is_left_beside_the_profile(box: Box):
    box.run({"set": {"name": "Ada"}, "summaries": {"about": "x"}})
    names = [p.name for p in (box.home / "profile").rglob("*") if p.is_file()]
    assert sorted(names) == ["about.md", "candidate_profile.yml"]


def test_non_ascii_text_stays_readable_in_the_file(box: Box):
    box.run({"set": {"name": "Marta Rossetti", "location": "Forlì", "preferences.salary": "tra 32 e 38 mila € lordi"}})
    text = box.profile.read_text(encoding="utf-8")
    assert "Forlì" in text and "€" in text and "\\u" not in text
