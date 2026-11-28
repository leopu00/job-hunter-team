"""JHT-T351 F-02: a residence written as a city alone named no country, a place list with the code of the home country in
lowercase («pt») was not read as that country, a radius said in minutes was written as a guessed number of km, «only big cities»
was not applied, and an office whose distance could not be checked ranked above one that was checked within reach.

The profile is invented: a person living in Lisboa, the city alone, searching «EU» with [pt, EU, anywhere], 20 minutes by car,
only big cities, native in Spanish. The plan of the Scout keeps Portugal and leaves Spain out; the Scorer reads the country of the
residence from the places, turns the minutes into km by a declared speed, lowers a small place, and keeps the unverified below.
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))
import profile_gaps  # noqa: E402
import scout_area  # noqa: E402
import score_place_pay as spp  # noqa: E402

PERSON = {
    "location": "EU",
    "location_preferences": ["pt", "EU", "anywhere"],
    "residence": {"place": "Lisboa", "lat": None, "lon": None},
    "commute_said": "20 min de carro",
    "preferences": {"work_mode": "hybrid", "only_big_cities": True},
}
PERSON_YAML = ("name: Example Person\ntarget_role: Data Analyst\nlocation: EU\nexperience_years: 4\nseniority_target: mid\n"
               "location_preferences: [pt, EU, anywhere]\nresidence:\n  place: Lisboa\n  lat: null\n  lon: null\n"
               "commute_said: 20 min de carro\nskills:\n  primary: [SQL]\n"
               "languages:\n  - language: Español\n    level: native\n  - language: Português\n    level: C1\n"
               "  - language: English\n    level: B2\n"
               "preferences:\n  work_mode: hybrid\n  only_big_cities: true\n")


# ── (b) a code alone in an entry of the list names its country ───────────────────────────────────────────────────────────
@pytest.mark.parametrize("entry, country", [("pt", "pt"), ("PT", "pt"), (" es ", "es"), ("EU", None), ("anywhere", None),
                                            ("Lisboa", None), ("Porto, Portugal", "pt")])
def test_an_entry_that_is_only_a_code_names_its_country(entry, country):
    assert scout_area.country_of_entry(entry) == country


def test_free_text_still_asks_for_capitals():
    assert scout_area.country_of("lavoro in pt e in es") is None


def test_the_plan_keeps_the_named_country_and_leaves_out_the_country_of_the_language_only(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    spec = importlib.util.spec_from_file_location("scout_coverage_f02", ROOT / "shared" / "skills" / "scout_coverage.py")
    cov = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cov)
    path = tmp_path / "candidate_profile.yml"
    path.write_text(PERSON_YAML, encoding="utf-8")
    assert cov.named_countries(path) == frozenset({"pt"})
    plan = cov.load_plan(path)
    countries = {e["country"] for e in plan["entries"]}
    assert "pt" in countries and "es" not in countries
    assert "es" in plan["skipped_language_only"] or "es" in plan["skipped_abroad"]


# ── (a) the residence says its country ──────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("residence, gap", [
    ({"place": "Lisboa"}, True),
    ({"place": "Lisboa, Portugal"}, False),
    ({"place": "Lisboa", "lat": 38.72, "lon": -9.14}, False),
    (None, True),
])
def test_a_residence_without_its_country_is_still_a_gap(tmp_path, residence, gap):
    profile = {"residence": residence} if residence else {}
    assert ("residence" in profile_gaps.gaps_of(profile, tmp_path)) is gap


# ── (c) without the country of the residence, the one named in the places ───────────────────────────────────────────────
def test_the_home_country_comes_from_the_places_when_the_residence_names_none():
    assert spp.home_country(PERSON, "Lisboa") == "pt"
    assert spp.home_country(dict(PERSON, location_preferences=["pt", "es"]), "Lisboa") is None   # two named: none chosen
    assert spp.home_country(dict(PERSON, location="anywhere", location_preferences=[]), "Lisboa") is None
    assert spp.home_country(PERSON, "Madrid, Spain") == "es"                                   # the residence wins


def test_an_office_in_another_country_is_beyond_the_radius_with_a_city_alone_as_residence():
    points, lines = spp.assess({"work_mode": "onsite", "work_country_code": "es", "loc_city": "Madrid"}, PERSON)
    assert points == spp.DISTANCE_POINTS
    assert lines[0].startswith("DISTANCE -25: onsite job in ES, the residence is in PT, beyond 16 km")


# ── (e) minutes are not km: a declared speed, and the person's words kept ────────────────────────────────────────────────
@pytest.mark.parametrize("said, km, way", [
    ("20 min de carro", 16.0, "car"), ("20 minuti in auto", 16.0, "car"), ("20 perc autóval", 16.0, "car"),
    ("mezz'ora in treno", 15.0, "transit"), ("1 h mit der Bahn", 30.0, "transit"), ("45' in bici", 11.2, "bike"),
    ("30 minutes à pied", 2.4, "foot"), ("1 h 20 min", 64.0, "car"),
])
def test_a_duration_becomes_km_by_the_declared_speed(said, km, way):
    found = spp.radius_from_words(said)
    assert found[:2] == (km, way)
    assert found[0] == round(found[2] * spp.KM_PER_MINUTE[way], 1)


@pytest.mark.parametrize("said", ["max 15 km", "", None, "non lo so"])
def test_words_without_a_duration_leave_the_km_written(said):
    assert spp.radius_from_words(said) is None
    assert spp.residence_of({"residence": {"place": "Lisboa"}, "commute_said": said, "commute_max_km": 15})[3] == 15


def test_the_words_win_over_a_guessed_number_and_the_line_says_how():
    profile = dict(PERSON, commute_max_km=10, residence={"place": "Lisboa", "lat": 38.7223, "lon": -9.1393})
    assert spp.residence_of(profile)[3] == 16.0
    points, lines = spp.assess({"work_mode": "hybrid", "office_lat": 38.80, "office_lon": -9.38, "loc_city": "Sintra"}, profile)
    assert points == spp.DISTANCE_POINTS
    assert lines[0].endswith("beyond 16 km (20 min by car, 0.8 km a minute)")


# ── (f) only big cities ─────────────────────────────────────────────────────────────────────────────────────────────────
def test_a_small_place_loses_points_with_the_reason_and_a_big_city_does_not():
    near = {"residence": {"place": "Lisboa", "lat": 38.7223, "lon": -9.1393}}
    small = {"work_mode": "hybrid", "office_lat": 38.75, "office_lon": -9.20, "loc_city": "Vila Franca", "work_country_code": "pt"}
    points, lines = spp.assess(small, dict(PERSON, **near))
    assert points == spp.SMALL_PLACE_POINTS
    assert lines == ["SMALL PLACE -10: hybrid job in a city that is not a big one, and the person works on site only in big cities"]
    assert spp.assess(dict(small, loc_city="Amadora"), dict(PERSON, **near)) == (0, [])
    assert spp.assess(dict(small, loc_city="Vila Franca"), dict(PERSON, preferences={}, **near)) == (0, [])
    assert spp.assess(dict(small, work_mode="remote"), dict(PERSON, **near)) == (0, [])


def test_a_city_that_is_not_known_is_not_lowered_and_says_so():
    near = {"residence": {"place": "Lisboa", "lat": 38.7223, "lon": -9.1393}}
    points, lines = spp.assess({"work_mode": "onsite", "office_lat": 38.75, "office_lon": -9.20}, dict(PERSON, **near))
    assert points == 0 and lines == ["SMALL PLACE not checked: the city of the office is not known, so no penalty for a onsite job"]


def test_the_big_cities_list_compares_without_case_or_accents():
    assert spp.big_city("SETUBAL", "pt") and spp.big_city("setúbal") and spp.big_city("Amadora", "es") is False
    assert spp.big_city("", "pt") is None


# ── (g) a distance that cannot be checked never ranks above one that was ────────────────────────────────────────────────
@pytest.mark.parametrize("row, why", [
    ({"work_mode": "hybrid", "loc_city": "Porto"}, "the place of the office is not known"),
    ({"work_mode": "hybrid", "loc_city": "Porto", "work_country_code": "pt"}, "a job in the country of the residence"),
])
def test_an_unverified_distance_says_so_and_loses_points(row, why):
    points, lines = spp.assess(row, PERSON)
    assert points == spp.UNVERIFIED_POINTS
    assert lines[0].startswith(f"DISTANCE not verified -10: {why}")


def test_with_the_same_score_the_checked_job_within_reach_ranks_first():
    near = dict(PERSON, residence={"place": "Lisboa", "lat": 38.7223, "lon": -9.1393})
    checked, _ = spp.assess({"work_mode": "hybrid", "office_lat": 38.75, "office_lon": -9.15, "loc_city": "Lisboa"}, near)
    unchecked, _ = spp.assess({"work_mode": "hybrid", "loc_city": "Lisboa", "work_country_code": "pt"}, near)
    assert 80 - checked > 80 - unchecked
    assert unchecked < spp.DISTANCE_POINTS          # still above an office checked and beyond reach


def test_without_a_residence_nothing_is_lowered_for_the_distance():
    points, lines = spp.assess({"work_mode": "hybrid", "loc_city": "Porto"}, {"commute_max_km": 30})
    assert points == 0 and lines[0].startswith("DISTANCE not checked")


# ── the profile is valid with the two new fields ────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("extra, ok", [
    ("", True),
    ("commute_said: ''\n", False),
    ("commute_said: " + "x" * 201 + "\n", False),
])
def test_the_validator_knows_the_words_and_the_size_of_place(tmp_path, extra, ok):
    path = tmp_path / "p.yml"
    text = PERSON_YAML.replace("commute_said: 20 min de carro\n", "") if extra else PERSON_YAML
    path.write_text(text + extra, encoding="utf-8")
    done = subprocess.run([sys.executable, str(ROOT / "shared" / "skills" / "validate_profile.py"), str(path)],
                          capture_output=True, text=True, timeout=30)
    assert (done.returncode == 0) is ok, done.stdout + done.stderr


def test_the_validator_refuses_a_size_of_place_that_is_not_yes_or_no(tmp_path):
    path = tmp_path / "p.yml"
    path.write_text(PERSON_YAML.replace("only_big_cities: true", "only_big_cities: often"), encoding="utf-8")
    done = subprocess.run([sys.executable, str(ROOT / "shared" / "skills" / "validate_profile.py"), str(path)],
                          capture_output=True, text=True, timeout=30)
    assert done.returncode != 0 and "only_big_cities" in done.stdout + done.stderr
