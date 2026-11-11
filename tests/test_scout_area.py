"""A Scout does not hand over a position that is provably outside the area of the profile (and the plan does not send it there).

Measured 11/11: 19 of the 30 positions the Analistas excluded were onsite or hybrid in another country for a candidate based in
Bologna who asked for remote or hybrid and said nothing about relocating. Synthetic profile and database only.

Run:
    pytest tests/test_scout_area.py -v
"""
import importlib.util
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


area = _load("scout_area_under_test", SKILLS / "scout_area.py")
cov = _load("scout_coverage_area_test", SKILLS / "scout_coverage.py")

IT_PROFILE = ("languages:\n  - language: Italiano\n    level: native\n  - language: English\n    level: B2\n"
              "location: Bologna, Italy\npreferences:\n  work_mode: remote o ibrido\n")


@pytest.fixture
def home(tmp_path, monkeypatch):
    (tmp_path / "profile").mkdir()
    (tmp_path / "profile" / "candidate_profile.yml").write_text(IT_PROFILE, encoding="utf-8")
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    return tmp_path


def _profile(home, text):
    (home / "profile" / "candidate_profile.yml").write_text(text, encoding="utf-8")


# ── what a location names ────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("location,code", [
    ("Stockholm, Sweden", "se"), ("Zürich, CH", "ch"), ("Basel, CH (ibrido 50/50)", "ch"), ("United Kingdom", "gb"),
    ("Palma de Mallorca / Spain", "es"), ("Bologna, Italia", "it"), ("Bologna, IT", "it"), ("Allschwil-Basel, CH", "ch"),
    ("London, UK", "gb"), ("Berlin, Germany", "de"), ("Milano", None), ("Dublin", None), ("Data Analyst IT", None), ("", None), (None, None),
])
def test_country_of_reads_a_country_name_or_code_and_nothing_else(location, code):
    assert area.country_of(location) == code


@pytest.mark.parametrize("value,allowed", [(True, True), ("yes, to Germany or Austria", True), ("open to EU", True), (False, False),
                                           (None, False), ("no", False), ("No relocation", False), ("", False), ("never", False)])
def test_relocation_is_allowed_only_when_the_profile_says_so(value, allowed):
    assert area.relocation_allowed(value) is allowed


# ── the area of the profile ──────────────────────────────────────────────────────────────────────────────────────────
def test_the_home_is_only_the_country_written_in_the_profile_never_the_language(home):
    assert area.read_area()["home"] == ["it"] and area.read_area()["relocation"] is False
    _profile(home, IT_PROFILE.replace("location: Bologna, Italy", "location: Berlin, Germany"))
    assert area.read_area()["home"] == ["de"]
    _profile(home, IT_PROFILE + "  relocation: true\n")
    assert area.read_area()["relocation"] is True


@pytest.mark.parametrize("place,language", [
    ("Bologna", "Italiano"), ("Lugano", "Italiano"), ("Salzburg", "Deutsch"), ("Zürich", "Deutsch"), ("Genève", "Français"),
])
def test_a_place_that_names_no_country_gives_no_area_whatever_the_native_language(home, place, language):
    """Italian is spoken in Ticino, German in Austria and Switzerland: the language proves nothing about where a person lives."""
    _profile(home, IT_PROFILE.replace("location: Bologna, Italy", "location: " + place).replace("Italiano", language))
    assert area.read_area() is None
    assert area.check_position("Stockholm, Sweden", "onsite")["verdict"] == "ok"


def test_a_profile_with_no_place_at_all_gives_no_area(home):
    _profile(home, IT_PROFILE.replace("location: Bologna, Italy\n", ""))
    assert area.read_area() is None
    assert area.check_position("Stockholm, Sweden", "onsite")["verdict"] == "ok"


def test_a_profile_that_cannot_be_read_gives_no_area_and_no_refusal(home):
    (home / "profile" / "candidate_profile.yml").unlink()
    assert area.read_area() is None
    assert area.check_position("Stockholm, Sweden", "onsite")["verdict"] == "ok"
    _profile(home, "languages: [unclosed")
    assert area.check_position("Stockholm, Sweden", "onsite")["verdict"] == "ok"


# ── the verdict ──────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("location,remote_type,verdict", [
    ("Stockholm, Sweden", "onsite", "outside"), ("Zürich, CH", "hybrid", "outside"), ("United Kingdom", "onsite", "outside"),
    ("Palma de Mallorca / Spain", "onsite", "outside"),
    ("Stockholm, Sweden", "full_remote", "ok"), ("Remote (Sweden)", "onsite", "ok"), ("Remote", "hybrid", "ok"),
    ("Bologna, Italia", "onsite", "ok"), ("Rome, Italy", "onsite", "ok"), ("Milano", "onsite", "ok"), ("Zürich", "onsite", "ok"),
    (None, "onsite", "ok"), ("Stockholm, Sweden", None, "ok"),
])
def test_only_an_onsite_or_hybrid_position_in_another_named_country_is_outside(home, location, remote_type, verdict):
    assert area.check_position(location, remote_type)["verdict"] == verdict


def test_a_profile_willing_to_relocate_has_no_outside(home):
    _profile(home, IT_PROFILE + "  relocation: true\n")
    assert area.check_position("Stockholm, Sweden", "onsite")["verdict"] == "ok"


def test_the_command_exits_4_when_outside_and_says_why(home):
    env = {"PATH": "/usr/bin:/bin", "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1"}
    out = subprocess.run([sys.executable, str(SKILLS / "scout_area.py"), "check", "--location", "Stockholm, Sweden", "--remote-type", "onsite"],
                         capture_output=True, text=True, timeout=60, env=env)
    assert out.returncode == 4, out.stderr
    body = json.loads(out.stdout)
    assert body["verdict"] == "outside" and body["country"] == "se" and body["home"] == ["it"] and "relocating" in body["reason"]
    ok = subprocess.run([sys.executable, str(SKILLS / "scout_area.py"), "check", "--location", "Bologna, Italia", "--remote-type", "onsite"],
                        capture_output=True, text=True, timeout=60, env=env)
    assert ok.returncode == 0 and json.loads(ok.stdout)["verdict"] == "ok"


# ── the INSERT of a Scout ────────────────────────────────────────────────────────────────────────────────────────────
def _insert(home, agent, n, location, remote_type):
    env = {**os.environ, "JHT_HOME": str(home), "JHT_AGENT_NAME": agent, "JHT_DB": str(home / "jobs.db")}
    return subprocess.run([sys.executable, str(SKILLS / "db_insert.py"), "position", "--title", "Role %d" % n, "--company", "Company %d" % n,
                           "--url", "https://jobs.example/%d" % n, "--source", "test", "--found-by", agent, "--location", location,
                           "--remote-type", remote_type], capture_output=True, text=True, env=env, timeout=60)


def _rows(home):
    return sqlite3.connect(str(home / "jobs.db")).execute("SELECT location FROM positions ORDER BY id").fetchall()


def test_a_scout_cannot_insert_an_onsite_position_abroad_and_nothing_is_written(home):
    done = _insert(home, "scout-1", 1, "Stockholm, Sweden", "onsite")
    assert done.returncode == 4 and done.stdout.startswith("AREA_MISMATCH") and "INSERT refused" in done.stdout, done.stdout + done.stderr
    assert _rows(home) == []
    assert _insert(home, "scout-1", 2, "Zürich, CH", "hybrid").returncode == 4


def test_a_scout_inserts_what_is_remote_or_in_the_profiles_country_or_unclear(home):
    for n, (loc, rt) in enumerate([("Remote (Sweden)", "full_remote"), ("Bologna, Italia", "onsite"), ("Milano", "onsite"), ("Stockholm, Sweden", "full_remote")], 1):
        done = _insert(home, "scout-1", n, loc, rt)
        assert done.returncode == 0, (loc, done.stdout + done.stderr)
    assert len(_rows(home)) == 4


def test_the_gate_is_for_the_scout_alone_and_a_willing_profile_passes(home):
    assert _insert(home, "user", 1, "Stockholm, Sweden", "onsite").returncode == 0      # a position the user adds is not the Scout's rule
    _profile(home, IT_PROFILE + "  relocation: true\n")
    assert _insert(home, "scout-1", 2, "Stockholm, Sweden", "onsite").returncode == 0


# ── the plan does not send a Scout abroad ────────────────────────────────────────────────────────────────────────────
def test_the_plan_of_a_profile_that_stays_has_only_its_own_country_and_the_remote_portals(home):
    plan = cov.load_plan()
    assert {e["country"] for e in plan["entries"]} == {"it", "remote"}
    assert {"ie", "se", "mt"} <= set(plan["skipped_abroad"])
    assert not {("thehub", "se"), ("keepmeposted", "mt"), ("reed", "gb"), ("linkedin", "ie")} & {(e["slug"], e["country"]) for e in plan["entries"]}


def test_the_plan_of_a_profile_willing_to_relocate_has_the_other_countries_back(home):
    _profile(home, IT_PROFILE + "  relocation: true\n")
    plan = cov.load_plan()
    assert {"ie", "se", "mt"} <= {e["country"] for e in plan["entries"]} and plan["skipped_abroad"] == []


@pytest.mark.parametrize("place", ["Bologna", "Lugano", ""])
def test_the_plan_leaves_nothing_out_when_the_profile_names_no_country(home, place):
    _profile(home, IT_PROFILE.replace("location: Bologna, Italy", ("location: " + place) if place else "x: y"))
    assert cov.load_plan()["skipped_abroad"] == []


def test_a_scout_inserts_abroad_when_the_profile_names_no_country(home):
    _profile(home, IT_PROFILE.replace("location: Bologna, Italy", "location: Lugano"))
    assert _insert(home, "scout-1", 1, "Zürich, CH", "onsite").returncode == 0
