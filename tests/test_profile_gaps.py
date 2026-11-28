"""JHT-T351: the Assistente says what the profile lacks for the search asked for and what it means, asks a topic once, and a gap the
person accepted on purpose is not raised again. No gate: a search wide on purpose stays possible.

Synthetic profiles only.

Run:
    pytest tests/test_profile_gaps.py -v
"""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "shared" / "skills"
spec = importlib.util.spec_from_file_location("profile_gaps", SKILLS / "profile_gaps.py")
gaps = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gaps)

FULL = {
    "target_role": "Data Analyst", "location": "Bologna, Italy", "languages": [{"language": "Italian", "level": "native"}],
    "residence": {"place": "Bologna, Italy", "lat": None, "lon": None}, "commute_max_km": 30,
    "preferences": {"work_mode": "hybrid", "salary_annual_eur": "35000"},
    "skills": {"primary": ["SQL", "Python", "Power BI"]},
}


def _home(tmp_path, cv=True):
    (tmp_path / "profile" / "sources").mkdir(parents=True)
    if cv:
        (tmp_path / "profile" / "sources" / "cv.pdf").write_bytes(b"%PDF-1.4 synthetic")
    return tmp_path


def test_a_complete_profile_has_no_gap(tmp_path):
    assert gaps.gaps_of(FULL, _home(tmp_path)) == []


def test_a_thin_profile_says_every_gap(tmp_path):
    thin = {"target_role": "Data Analyst", "location": "Ovunque", "languages": [{"language": "Italian", "level": "native"}],
          "skills": {"primary": ["Excel", "Comunicazione"]}}
    assert gaps.gaps_of(thin, _home(tmp_path, cv=False)) == ["place_anywhere", "residence", "salary", "skills", "cv"]


@pytest.mark.parametrize("place", ["Ovunque", "anywhere", "Worldwide", "überall", "En cualquier lugar", "partout", "qualquer lugar", "bárhol", " ovunque. "])
def test_anywhere_in_the_seven_languages_is_a_gap(tmp_path, place):
    assert "place_anywhere" in gaps.gaps_of({**FULL, "location": place}, _home(tmp_path))


@pytest.mark.parametrize("place", ["Anywhere Street, Leeds", "Bologna", "Partout-sur-Mer"])
def test_a_city_that_only_contains_the_word_is_a_city(tmp_path, place):
    assert "place_anywhere" not in gaps.gaps_of({**FULL, "location": place}, _home(tmp_path))


def test_the_radius_matters_only_with_a_residence_and_work_that_is_not_only_remote(tmp_path):
    home = _home(tmp_path)
    no_radius = {**FULL, "commute_max_km": None}
    assert "commute" in gaps.gaps_of(no_radius, home)
    assert "commute" not in gaps.gaps_of({**no_radius, "preferences": {**FULL["preferences"], "work_mode": "remote"}}, home)
    assert gaps.gaps_of({**no_radius, "residence": None}, home)[:1] == ["residence"]
    assert "commute" not in gaps.gaps_of({**no_radius, "residence": None}, home)


def test_the_notes_keep_topics_and_accepted_gaps_and_drop_anything_else(tmp_path):
    home = _home(tmp_path)
    gaps.write_notes(["residence", "salary"], ["place_anywhere"], home)
    gaps.write_notes(["residence", "commute_max_km"], [], home)
    assert gaps.read_state(home) == {"asked": ["residence", "salary", "commute_max_km"], "accepted": ["place_anywhere"]}
    assert gaps.report({**FULL, "location": "Ovunque"}, home)["gaps"] == []
    gaps.state_path(home).write_text(json.dumps({"asked": ["ok", "Not A Topic", 3], "accepted": ["cv", "everything"]}), encoding="utf-8")
    assert gaps.read_state(home) == {"asked": ["ok"], "accepted": ["cv"]}
    for asked, accept in ((["Residence!"], None), ("residence", None), (None, ["all"])):
        with pytest.raises(ValueError):
            gaps.check_notes(asked, accept)


class Box:
    def __init__(self, root: Path):
        self.home = root / "jht"
        (self.home / "profile").mkdir(parents=True)
        send = root / "send"
        send.write_text("#!/bin/sh\ncat > /dev/null\n", encoding="utf-8")
        send.chmod(0o755)
        self.env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(self.home), "JHT_SEND_BIN": str(send)}

    def run(self, request):
        done = subprocess.run([sys.executable, str(SKILLS / "profile_apply.py")], input=json.dumps(request), capture_output=True,
                              text=True, env=self.env, timeout=60)
        return done.returncode, json.loads(done.stdout)


def test_profile_apply_writes_the_residence_and_the_radius_and_answers_the_gaps(tmp_path):
    box = Box(tmp_path)
    code, out = box.run({"set": {"target_role": "Data Analyst", "location": "Ovunque"}, "asked": ["location"]})
    assert code == 0 and out["asked"] == ["location"]
    assert out["gaps"][:2] == ["place_anywhere", "residence"]
    code, out = box.run({"set": {"residence": {"place": "Bologna, Italy", "lat": None, "lon": None}, "commute_max_km": 30,
                                 "preferences.work_mode": "hybrid"},
                         "asked": ["residence", "commute_max_km"], "accept": ["place_anywhere"]})
    assert code == 0, out
    assert not [line for line in out["invalid"] if "residence" in line or "commute" in line]
    doc = yaml.safe_load((box.home / "profile" / "candidate_profile.yml").read_text(encoding="utf-8"))
    assert doc["residence"]["place"] == "Bologna, Italy" and doc["commute_max_km"] == 30
    assert "place_anywhere" not in out["gaps"] and "residence" not in out["gaps"] and "commute" not in out["gaps"]
    assert out["accepted"] == ["place_anywhere"] and out["asked"] == ["location", "residence", "commute_max_km"]


def test_a_bad_note_writes_nothing(tmp_path):
    box = Box(tmp_path)
    code, out = box.run({"set": {"name": "Ada"}, "accept": ["everything"]})
    assert code == 1 and "accept" in out["error"]
    assert not (box.home / "profile" / "candidate_profile.yml").exists()
