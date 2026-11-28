"""JHT-T351 point 2: an onsite job thousands of km from where the person lives at the top of the ranking, and offers with no
pay scored as if the pay did not matter. The code takes the distance and the missing pay off the score it saves, from the columns
of the position and the profile; without residence or radius nothing is invented and the breakdown says so. Synthetic profiles.
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared" / "skills"))
import score_place_pay as spp  # noqa: E402

HOME = {"residence": {"place": "Valencia, Spain", "lat": 39.4699, "lon": -0.3763}, "commute_max_km": 40,
         "preferences": {"salary_annual_eur": "38000 EUR gross"}}
FAR = {"work_mode": "onsite", "office_lat": 63.8258, "office_lon": 20.2630, "loc_country_code": "se",
       "salary_declared_min": None, "salary_declared_max": None}


def test_an_onsite_job_far_from_home_and_without_pay_loses_both():
    points, lines = spp.assess(FAR, HOME)
    assert points == spp.DISTANCE_POINTS + spp.SALARY_POINTS
    assert lines[0].startswith("DISTANCE -25: onsite job ") and "beyond 40 km" in lines[0]
    assert lines[1].startswith("SALARY -10:")


def test_near_home_or_remote_or_with_declared_pay_loses_nothing():
    milan = dict(FAR, office_lat=38.3452, office_lon=-0.4810, salary_declared_min=40000)
    assert spp.assess(dict(milan, office_lat=39.47, office_lon=-0.38), HOME) == (0, [])
    assert spp.assess(dict(FAR, work_mode="remote", salary_declared_max=52000), HOME) == (0, [])


@pytest.mark.parametrize("radius, far", [(120, True), (130, False)])
def test_the_edge_of_the_radius(radius, far):
    milan = dict(FAR, office_lat=38.3452, office_lon=-0.4810, salary_declared_min=40000)   # ~125 km from Valencia
    points, _ = spp.assess(milan, dict(HOME, commute_max_km=radius))
    assert (points == spp.DISTANCE_POINTS) is far


def test_without_coordinates_another_country_is_beyond_a_commuting_radius():
    points, lines = spp.assess(dict(FAR, office_lat=None, office_lon=None), dict(HOME, residence={"place": "Valencia, Spain"}))
    assert points == spp.DISTANCE_POINTS + spp.SALARY_POINTS and "in SE, the residence is in ES" in lines[0]


@pytest.mark.parametrize("profile, missing", [
    ({"preferences": {}}, "residence and radius (commute_max_km)"),
    ({"residence": {"place": "Valencia, Spain"}}, "radius (commute_max_km)"),
    ({"commute_max_km": 30}, "residence"),
])
def test_no_residence_or_no_radius_invents_nothing_and_says_so(profile, missing):
    points, lines = spp.assess(FAR, profile)
    assert points == 0
    assert lines == [f"DISTANCE not checked: the profile has no {missing}, so no penalty for the place of a onsite job"]


def test_pay_that_does_not_matter_is_not_penalized():
    profile = dict(HOME, preferences={"salary_annual_eur": None})
    points, lines = spp.assess(dict(FAR, work_mode="remote"), profile)
    assert (points, lines) == (0, [])


def test_db_insert_takes_it_off_the_saved_total_and_says_it_on_top(tmp_path, monkeypatch):
    import sqlite3
    import types
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_DB", str(tmp_path / "jobs.db"))
    (tmp_path / "profile").mkdir()
    (tmp_path / "profile" / "candidate_profile.yml").write_text(
        "target_role: Data Analyst\nlocation: anywhere\nresidence:\n  place: Valencia, Spain\n  lat: 39.4699\n  lon: -0.3763\n"
        "commute_max_km: 40\nlanguages:\n  - language: Svenska\n    level: native\nskills:\n  primary: [SQL]\n"
        "preferences:\n  salary_annual_eur: 38000 EUR gross\n", encoding="utf-8")
    import db_insert
    from _db import get_db, ensure_schema
    conn = get_db()
    ensure_schema(conn)
    conn.execute("INSERT INTO positions (id, title, company, url, work_mode, office_lat, office_lon, loc_country_code) "
                 "VALUES (1, 'Data Analyst', 'Exempel AB', 'https://example.invalid/1', 'onsite', 63.83, 20.26, 'se')")
    conn.commit()
    conn.close()
    args = types.SimpleNamespace(position_id=1, total=83, stack_match=36, experience_fit=9, remote_fit=20, salary_fit=8,
                                 strategic_fit=10, breakdown="STACK: fits", notes="n", scored_by="scorer-1")
    db_insert.insert_score(args)
    with sqlite3.connect(tmp_path / "jobs.db") as db:
        total, breakdown = db.execute("SELECT total_score, breakdown FROM scores WHERE position_id = 1").fetchone()
    assert total == 83 - spp.DISTANCE_POINTS - spp.SALARY_POINTS
    assert breakdown.splitlines()[0].startswith("DISTANCE -25") and breakdown.splitlines()[1].startswith("SALARY -10")
    assert breakdown.splitlines()[-1] == "STACK: fits"


@pytest.mark.parametrize("extra, ok", [
    ("residence:\n  place: Valencia, Spain\n  lat: 39.47\n  lon: -0.38\ncommute_max_km: 40\n", True),
    ("residence:\n  place: Valencia, Spain\n  lat: null\n  lon: null\n", True),
    ("residence: Valencia\n", False),
    ("residence:\n  place: Valencia\n  city: x\n", False),
    ("residence:\n  place: Valencia\n  lat: 120\n", False),
    ("commute_max_km: 0\n", False),
    ("commute_max_km: true\n", False),
])
def test_the_validator_knows_the_two_fields(tmp_path, extra, ok):
    import subprocess
    base = ("name: Example Person\ntarget_role: Data Analyst\nlocation: anywhere\nexperience_years: 4\nseniority_target: mid\n"
            "skills:\n  primary: [SQL]\nlanguages:\n  - language: Español\n    level: native\n")
    path = tmp_path / "p.yml"
    path.write_text(base + extra, encoding="utf-8")
    done = subprocess.run([sys.executable, str(Path(__file__).resolve().parents[1] / "shared" / "skills" / "validate_profile.py"),
                           str(path)], capture_output=True, text=True, timeout=30)
    assert (done.returncode == 0) is ok, done.stdout + done.stderr


@pytest.mark.parametrize("work_mode,remote_type,onsite", [
    ("home office", "", False),
    ("Homeoffice", "", False),
    ("Home-Office", "", False),
    ("remote (office in Milan)", "", False),
    ("", "fully remote", False),
    ("hybrid", "", True),
    ("hybrid, home office two days a week", "", True),
    ("office", "", True),
    ("onsite", "", True),
    ("in sede", "", True),
    # the other languages of the benches
    ("lavoro da casa", "", False), ("mobiles Arbeiten", "", False), ("télétravail", "", False), ("teletrabajo", "", False),
    ("teletrabalho", "", False), ("távmunka", "", False), ("Home Office", "", False),
    ("hybride", "", True), ("híbrido", "", True), ("hibrid", "", True),
])
def test_home_office_is_remote_and_only_a_bare_office_is_on_site(work_mode, remote_type, onsite):
    assert spp._onsite({"work_mode": work_mode, "remote_type": remote_type}) is onsite
    points, _ = spp.assess(dict(FAR, work_mode=work_mode, remote_type=remote_type, salary_declared_max=52000), HOME)
    assert (points == spp.DISTANCE_POINTS) is onsite  # the points taken off: the distance only, the pay is declared
