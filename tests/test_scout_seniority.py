"""scout_seniority.py: the level a title names, against the level of THIS profile: `above`, `below`, `compatible`, `unknown`.
An order for the Scout (insert the candidates without the code first), never a reason to drop one (rule SC-04). Fake profiles."""

from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(name + "_under_test", SKILLS / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


sen = _load("scout_seniority")


def _profile(tmp_path: Path, body: str) -> Path:
    path = tmp_path / "candidate_profile.yml"
    path.write_text(body, encoding="utf-8")
    return path


JUNIOR = "name: Fake Person\ntarget_role: Data Analyst\nexperience_years: 1\nseniority_target: junior\nlanguages:\n  - language: English\n    level: fluent\n"
MID = "name: Fake Person\nexperience_years: 4\nseniority_target: mid\nlanguages:\n  - language: English\n    level: fluent\n"
SENIOR = "name: Fake Person\nexperience_years: 11\nseniority_target: senior\nlanguages:\n  - language: English\n    level: fluent\n"


@pytest.mark.parametrize("title, level", [
    ("Senior Data Scientist", "senior"), ("Sr. Data Analyst", "senior"), ("Principal Engineer", "senior"), ("Tech Lead, Data", "senior"),
    ("Head of Data & BI", "executive"), ("Director of Analytics", "executive"), ("VP Engineering", "executive"),
    ("Senior Director of Data", "executive"),            # the higher word is the level
    ("Junior Data Analyst", "junior"), ("Data Analyst (Trainee)", "junior"), ("Entry-Level Analyst", "junior"), ("Werkstudent Data", "junior"),
    ("Stagista Business Analyst", "junior"), ("Analista de Datos Pleno", "mid"), ("Mid-level Analyst", "mid"),
    ("Responsabile area dati, Direttore Generale", "executive"), ("Teamleiter Controlling", "senior"), ("Directeur Data", "executive"),
    ("Gyakornok adatelemző", "junior"), ("Diretora de Dados", "executive"), ("Chief Data Officer", "executive"),
])
def test_the_level_a_title_names(title: str, level: str):
    assert sen.title_level(title) == level


@pytest.mark.parametrize("title", [
    "Data Analyst", "Business Intelligence Analyst", "Product Manager", "Project Manager", "Lead Generation Specialist",
    "Data Entry Clerk", "Staff Accountant", "SAP Expert", "Principal Component Analysis Researcher", "Customer Leads Coordinator",
    "Junior / Senior Data Analyst", "Analyst - Junior to Mid-level", "",
])
def test_a_title_with_no_level_or_with_a_choice_of_levels_names_none(title: str):
    assert sen.title_level(title) is None


@pytest.mark.parametrize("body, title, code", [
    # a junior profile: everything above it is `above`
    (JUNIOR, "Senior Data Scientist", "above"), (JUNIOR, "Principal Engineer", "above"), (JUNIOR, "Head of Data", "above"),
    (JUNIOR, "Junior Data Analyst", "compatible"), (JUNIOR, "Data Analyst", "compatible"), (JUNIOR, "Stagista Data", "compatible"),
    # a mid profile: one step up is `above`, a trainee is `below`
    (MID, "Senior Data Analyst", "above"), (MID, "Data Analyst", "compatible"), (MID, "Mid-level Data Analyst", "compatible"),
    (MID, "Junior Data Analyst", "below"), (MID, "Head of Data", "above"),
    # a senior profile: «Senior» and «Principal» are the TARGET, not an order to put them last
    (SENIOR, "Senior Data Scientist", "compatible"), (SENIOR, "Principal Engineer", "compatible"), (SENIOR, "Tech Lead Data", "compatible"),
    (SENIOR, "Data Analyst", "compatible"), (SENIOR, "Head of Data", "above"), (SENIOR, "Junior Data Analyst", "below"),
    (SENIOR, "Werkstudent Data", "below"), (SENIOR, "Data Analyst, Mid-level", "below"),
])
def test_the_code_follows_the_level_of_the_profile_not_a_fixed_one(tmp_path: Path, body: str, title: str, code: str):
    assert sen.compare(title, sen.profile_level(_profile(tmp_path, body))) == code


@pytest.mark.parametrize("body, level", [
    ("seniority_target: Senior\n", "senior"), ("seniority_target: junior\nexperience_years: 15\n", "junior"),   # the stated target wins
    ("positioning:\n  seniority_target: mid\n", "mid"), ("candidate:\n  seniority_target: Sr\n", "senior"),
    ("experience_years: 0\n", "junior"), ("experience_years: 2\n", "junior"), ("experience_years: 3\n", "mid"),
    ("experience_years: 6\n", "mid"), ("experience_years: 7\n", "senior"), ("seniority_target: Director\n", "executive"),
    ("seniority_target: boh\nexperience_years: 5\n", "mid"),
    ("seniority_target: boh\n", None), ("name: x\n", None), ("experience_years: -3\n", None), ("experience_years: true\n", None), ("- a list\n", None),
])
def test_the_level_of_the_profile_comes_from_the_target_then_from_the_years(tmp_path: Path, body: str, level):
    assert sen.profile_level(_profile(tmp_path, body)) == level


def test_without_a_readable_profile_there_is_no_code(tmp_path: Path):
    assert sen.profile_level(tmp_path / "missing.yml") is None
    assert sen.profile_level(_profile(tmp_path, "{ not yaml: [")) is None
    assert sen.compare("Head of Data", None) == "unknown"


def test_the_lexicon_is_folded_whole_words_and_a_level_is_not_in_two_places():
    lexicon = json.loads((SKILLS / "scout_seniority_lexicon.json").read_text(encoding="utf-8"))
    assert set(lexicon["levels"]) == {"junior", "mid", "senior", "executive"}
    seen: dict[str, str] = {}
    for level, spec in lexicon["levels"].items():
        for word in spec["words"]:
            assert word == sen.fold(word) and word.isalnum(), word
            assert word not in seen, (word, level, seen.get(word))
            seen[word] = level
        for phrase in spec["phrases"]:
            assert phrase == sen.fold(phrase) and " " in phrase and "-" not in phrase, phrase
    for word in ("manager", "staff", "entry", "expert"):
        assert word not in seen  # jobs, not levels
    assert all(p == sen.fold(p) for p in lexicon["ignore"])


def _run(*args: str) -> dict:
    done = subprocess.run([sys.executable, "-I", str(SKILLS / "scout_seniority.py"), *args], capture_output=True, text=True, timeout=30, check=False)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


def test_the_cli_answers_codes_only(tmp_path: Path):
    junior = str(_profile(tmp_path, JUNIOR))
    out = _run("check", "--title", "Head of Data & BI", "--profile", junior)
    assert out == {"seniority": "above", "title_level": "executive", "profile_level": "junior"}
    assert _run("profile", "--profile", junior) == {"profile_level": "junior"}
    assert _run("check", "--title", "Data Analyst", "--profile", str(tmp_path / "none.yml")) == {"seniority": "unknown", "title_level": "none", "profile_level": "unknown"}
    assert "Head of" not in json.dumps(out)  # nothing of the title is echoed


# ── `scout_language.py screen` carries the code ─────────────────────────────────────────────────────────────────────────
def _screen(profile: Path, title: str, snippet: str = "") -> tuple[int, dict]:
    done = subprocess.run([sys.executable, "-I", str(SKILLS / "scout_language.py"), "screen", "--title", title, "--snippet", snippet,
                           "--profile", str(profile)], capture_output=True, text=True, timeout=30, check=False)
    return done.returncode, json.loads(done.stdout)


def test_screen_adds_the_code_when_the_title_is_above_or_below_the_profile_and_never_otherwise(tmp_path: Path):
    junior, senior = _profile(tmp_path, JUNIOR), tmp_path / "senior.yml"
    senior.write_text(SENIOR, encoding="utf-8")
    code, out = _screen(junior, "Head of Data & BI")
    assert code == 0 and out["seniority"] == "above" and out["verdict"] in ("ok", "unknown")
    assert "seniority" not in _screen(junior, "Data Analyst")[1] and "seniority" not in _screen(junior, "Junior Data Analyst")[1]
    assert "seniority" not in _screen(senior, "Principal Data Engineer")[1]       # the target of a senior profile
    assert _screen(senior, "Junior Data Analyst")[1]["seniority"] == "below"


def test_a_dropped_candidate_carries_no_seniority_and_the_exit_code_is_the_same(tmp_path: Path):
    profile = _profile(tmp_path, JUNIOR)  # English only
    code, out = _screen(profile, "Senior Entwickler", "Wir suchen einen Senior Entwickler. Fliessend Deutsch ist Pflicht für diese Stelle im Team.")
    assert code == 10 and out["verdict"] == "skip_language" and "seniority" not in out


@pytest.mark.parametrize("suffix", ["", ".it", ".de", ".es", ".fr", ".hu", ".pt"])
def test_the_skill_says_it_is_an_order_and_never_a_reason_to_drop(suffix: str):
    text = (SKILLS.parents[1] / "agents" / "_skills" / "scout-language-gate" / f"SKILL{suffix}.md").read_text(encoding="utf-8")
    start = text.index("\n## 3. ")
    section = text[start:text.index("\n## ", start + 5)]
    for key in ('"seniority": "above"', "`\"below\"`".replace('`', ''), "seniority_target", "SC-04", "Scorer", "`Principal`"):
        assert key in section, (suffix, key)


@pytest.mark.parametrize("suffix", ["", ".it", ".de", ".es", ".fr", ".hu", ".pt"])
def test_the_scout_prompt_says_the_code_is_an_order_after_the_gate_line(suffix: str):
    text = (SKILLS.parents[1] / "agents" / "scout" / f"scout{suffix}.md").read_text(encoding="utf-8")
    line = next(l for l in text.splitlines() if "scout-language-gate" in l and l.startswith("**"))
    assert "seniority: above|below" in line and "`scout_language.py screen`" in line
    assert "SC-04" not in line  # the tests of the score-integrity rules read the FIRST line that names SC-04 as the rule itself
