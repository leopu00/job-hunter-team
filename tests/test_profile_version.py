"""profile_version.py: the Scout finds out that the profile changed since it built its circles (03/11).

The burst starts with a role, a place and a language; when the questionnaire ends the profile holds the specialty, the
areas and the work mode. The Scout reads the profile again at its next round without starting from zero: the passes it
logged and the positions it inserted stay, and the plan of portals grows with the languages."""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent
SKILLS = ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


pv = _load("profile_version_under_test", SKILLS / "profile_version.py")
cov = _load("scout_coverage_for_profile_version", SKILLS / "scout_coverage.py")

MINIMAL = {"target_role": "Project Coordinator", "location": "Stockholm, Sweden",
           "languages": [{"language": "Svenska", "level": "native"}]}
COMPLETE = {**MINIMAL, "name": "Example Person", "email": "candidate@example.invalid", "experience_years": 3,
            "seniority_target": "junior", "skills": {"primary": ["Excel", "Planning"]},
            "target_role_category_id": "business", "target_specialty": "operations",
            "location_preferences": ["Stockholm", "Uppsala", "Remote Sweden"],
            "preferences": {"work_mode": "hybrid", "relocation": "no"},
            "languages": [{"language": "Svenska", "level": "native"}, {"language": "English", "level": "C1"}]}


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    (tmp_path / "profile").mkdir()
    return tmp_path


def write(home: Path, profile) -> Path:
    path = home / "profile" / "candidate_profile.yml"
    path.write_text(yaml.safe_dump(profile, allow_unicode=True) if not isinstance(profile, str) else profile, encoding="utf-8")
    return path


def test_no_profile_or_one_that_cannot_be_read_has_no_version_and_stops_nobody(home):
    assert pv.current()["version"] is None
    write(home, "{ not: [yaml")
    assert pv.current()["version"] is None
    write(home, "just text")
    assert pv.current()["version"] is None
    news = pv.check("scout-1")
    assert news["changed"] is False and news["first"] is False
    assert not pv.seen_path("scout-1").exists() and not pv.version_path().exists()


def test_the_first_look_records_the_profile_as_the_one_the_circles_were_built_on(home):
    write(home, MINIMAL)
    first = pv.check("scout-1")
    assert first["first"] is True and first["changed"] is False and first["groups"] == []
    again = pv.check("scout-1")
    assert again["first"] is False and again["changed"] is False


def test_a_minimal_profile_that_becomes_complete_is_news_for_the_groups_that_changed(home):
    write(home, MINIMAL)
    pv.check("scout-1")
    write(home, COMPLETE)
    news = pv.check("scout-1")
    assert news["changed"] is True
    # roles (specialty, seniority, category), places (preferred places, relocation), languages (English), mode (hybrid)
    assert news["groups"] == ["roles", "places", "languages", "mode"]
    # and it stays news until the Scout says it has read it
    assert pv.check("scout-1")["changed"] is True
    assert pv.ack("scout-1")["acknowledged"] is True
    assert pv.check("scout-1")["changed"] is False


def test_what_does_not_touch_the_search_is_not_news(home):
    write(home, COMPLETE)
    pv.check("scout-1")
    other = json.loads(json.dumps(COMPLETE))
    other.update({"name": "Another Name", "email": "else@example.invalid", "experience_years": 9,
                  "skills": {"primary": ["Other", "Things"]}, "has_degree": True,
                  "blocks": [{"key": "about", "kind": "narrative", "title": "x", "content": "text"}]})
    write(home, other)
    assert pv.check("scout-1")["changed"] is False


def test_each_group_is_told_apart(home):
    write(home, COMPLETE)
    pv.check("scout-1")
    cases = {
        "roles": lambda p: p.update(target_role="Operations Coordinator"),
        "places": lambda p: p.update(location_preferences=["Malmö"]),
        "languages": lambda p: p.update(languages=[{"language": "Svenska", "level": "native"}]),
        "mode": lambda p: p["preferences"].update(work_mode="remote"),
    }
    for group, change in cases.items():
        profile = json.loads(json.dumps(COMPLETE))
        change(profile)
        write(home, profile)
        news = pv.check("scout-1")
        assert news["groups"] == [group], (group, news)
        write(home, COMPLETE)
        assert pv.check("scout-1")["changed"] is False


def test_the_order_of_places_and_languages_and_the_case_of_texts_do_not_change_the_version(home):
    write(home, COMPLETE)
    before = pv.current()["version"]
    shuffled = json.loads(json.dumps(COMPLETE))
    shuffled["location_preferences"] = ["remote sweden", "UPPSALA", "Stockholm"]
    shuffled["languages"] = list(reversed(shuffled["languages"]))
    shuffled["target_role"] = "  project   coordinator "
    write(home, shuffled)
    assert pv.current()["version"] == before


def test_the_order_of_the_roles_by_priority_does_change_it(home):
    profile = {**COMPLETE, "target_roles_priority": ["Project Coordinator", "Operations Coordinator"]}
    write(home, profile)
    before = pv.current()["version"]
    write(home, {**COMPLETE, "target_roles_priority": ["Operations Coordinator", "Project Coordinator"]})
    assert pv.current()["version"] != before


def test_every_scout_has_its_own_acknowledgement(home):
    write(home, MINIMAL)
    pv.check("scout-1")
    pv.check("scout-2")
    write(home, COMPLETE)
    assert pv.check("scout-1")["changed"] and pv.check("scout-2")["changed"]
    pv.ack("scout-1")
    assert pv.check("scout-1")["changed"] is False
    assert pv.check("scout-2")["changed"] is True


def test_the_version_file_follows_the_profile_whoever_wrote_it(home):
    write(home, MINIMAL)
    pv.sync()
    first = json.loads(pv.version_path().read_text(encoding="utf-8"))
    write(home, COMPLETE)
    pv.sync()
    second = json.loads(pv.version_path().read_text(encoding="utf-8"))
    assert first["version"] != second["version"] and set(second["groups"]) == set(pv.GROUPS)
    stamp = second["changed_at"]
    pv.sync()  # nothing changed: the file is not rewritten
    assert json.loads(pv.version_path().read_text(encoding="utf-8"))["changed_at"] == stamp
    assert not list(pv.version_path().parent.glob("profile-version.*.tmp"))


def test_the_circles_grow_with_the_profile_and_nothing_found_is_lost(home):
    """The minimal profile has Swedish; the complete one adds English: the plan gains the English portals, and the
    passes already logged on the Swedish ones still count."""
    write(home, MINIMAL)
    minimal_plan = cov.load_plan()
    rows = []
    for i, kind in enumerate(("broad", "role_language", "role")):
        rows.append({"kind": "pass", "source": "arbetsformedlingen", "country": "se", "ts": 100.0 + i, "status": "ok",
                     "query_hash": "h%d" % i, "query_kind": kind, "returned": 12})
    rows.append({"kind": "candidate", "source": "arbetsformedlingen", "country": "se", "ts": 105.0, "outcome": "inserted"})
    before = {r["slug"]: r for r in cov.status(minimal_plan, rows)}
    assert before["arbetsformedlingen"]["state"] == "covered" and before["arbetsformedlingen"]["inserted"] == 1

    pv.check("scout-1")
    write(home, COMPLETE)
    assert pv.check("scout-1")["groups"] == ["roles", "places", "languages", "mode"]
    complete_plan = cov.load_plan()
    assert len(complete_plan["entries"]) > len(minimal_plan["entries"])
    assert "en" in complete_plan["languages"]
    after = {(r["slug"], r["country"]): r for r in cov.status(complete_plan, rows)}
    assert after[("arbetsformedlingen", "se")]["state"] == "covered"
    assert after[("arbetsformedlingen", "se")]["passes"] == 3 and after[("arbetsformedlingen", "se")]["inserted"] == 1
    new = [r for r in complete_plan["entries"] if r["language"] == "en" and r["access"] == "search"]
    assert new and all(after[(r["slug"], r["country"])]["state"] == "untouched" for r in new)


def run(home: Path, *args: str) -> tuple[int, dict]:
    done = subprocess.run([sys.executable, "-I", str(SKILLS / "profile_version.py"), *args], capture_output=True, text=True,
                          env={"JHT_HOME": str(home), "PATH": "/usr/bin:/bin", "PYTHONPATH": str(Path(yaml.__file__).resolve().parent.parent)},
                          timeout=60)
    return done.returncode, json.loads(done.stdout)


def test_the_command_line_and_what_it_prints(home):
    write(home, MINIMAL)
    code, out = run(home, "check", "--agent", "Scout-1")
    assert code == 0 and out["first"] is True
    write(home, COMPLETE)
    code, out = run(home, "check", "--agent", "scout-1")
    assert code == 0 and out["changed"] is True
    printed = json.dumps(out)
    for value in ("Project Coordinator", "Stockholm", "operations", "hybrid", "Svenska"):
        assert value not in printed
    code, out = run(home, "ack", "--agent", "scout-1")
    assert code == 0 and out["acknowledged"] is True
    code, out = run(home, "check", "--agent", "../etc/passwd")
    assert code == 2 and out["ok"] is False
    code, out = run(home, "current")
    assert code == 0 and len(out["version"]) == 16


def test_scout_coverage_next_with_the_agent_carries_the_news_and_what_to_do(home):
    write(home, MINIMAL)
    env_run = lambda *a: subprocess.run(  # noqa: E731
        [sys.executable, "-I", str(SKILLS / "scout_coverage.py"), *a], capture_output=True, text=True, timeout=60,
        env={"JHT_HOME": str(home), "PATH": "/usr/bin:/bin", "PYTHONPATH": str(Path(yaml.__file__).resolve().parent.parent)})
    first = json.loads(env_run("next", "--agent", "scout-1").stdout)
    assert first["profile"]["changed"] is False
    assert "profile" not in json.loads(env_run("next").stdout)  # without the agent the answer is the one it always was
    write(home, COMPLETE)
    news = json.loads(env_run("next", "--agent", "scout-1").stdout)["profile"]
    assert news["changed"] is True and "roles" in news["groups"] and "ack --agent scout-1" in news["do"]
    assert pv.ack("scout-1")["ok"]
    assert json.loads(env_run("next", "--agent", "scout-1").stdout)["profile"]["changed"] is False
    assert json.loads(env_run("next", "--agent", "!!bad").stdout)["profile"] == {"changed": False}
