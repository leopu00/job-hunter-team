"""JHT-T351 point 5: the bench of the Scout's plan and the Scorer's ranking on a MADE-UP profile (a native Swedish speaker living in
Valencia, searching «anywhere», with a pay target). Made-up positions and companies, made-up raw scores in the shape the Scorer gives
them (the measure of the role, before the code's penalties); no model, no network.

    BEFORE  the code before JHT-T351 and the profile without its place: no place or pay penalty, location «anywhere», no residence
    AFTER   this code, and the same person with residence and radius (the onboarding of JHT-T351 point 1 asks them)

Run with `-s` to print the two tables the merge request quotes:
    python3 -m pytest -q -s tests/test_bench_place_far_onsite.py
"""
from __future__ import annotations

import sqlite3
import sys
import types
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

PROFILE = ("name: Example Person\ntarget_role: Data Analyst\nlocation: anywhere\nexperience_years: 11\nseniority_target: lead\n"
           "skills:\n  primary: [SQL, Tableau, dbt]\n"
           "languages:\n  - language: Svenska\n    level: native\n  - language: Español\n    level: B2\n"
           "  - language: English\n    level: B2\n"
           "preferences:\n  work_mode: remote or hybrid\n  relocation: true\n  salary_annual_eur: 38000 EUR gross\n")
RESIDENCE = "residence:\n  place: Valencia, Spain\n  lat: 39.4699\n  lon: -0.3763\ncommute_max_km: 40\n"

# (title, company, work_mode, office lat, lon, country, declared pay, raw score of the Scorer)
POSITIONS = [
    ("Data Analyst", "Exempel AB (Umeå)", "onsite", 63.8258, 20.2630, "se", None, 86),
    ("BI Analyst", "Prov AB (Sundsvall)", "onsite", 62.3908, 17.3069, "se", None, 81),
    ("Data Analyst", "Muestra SL (Valencia)", "hybrid", 39.4699, -0.3763, "es", 40000, 76),
    ("Lead Data Analyst", "Placeholder GmbH", "remote", None, None, "remote", 52000, 78),
    ("Analytics Engineer", "Prueba SA (Madrid)", "onsite", 40.4168, -3.7038, "es", None, 74),
    ("BI Developer", "Mock BV (remote EU)", "remote", None, None, "remote", None, 72),
    ("Data Analyst", "Ficticia SL (Paterna)", "onsite", 39.5027, -0.4406, "es", 37000, 70),
    # home office with an office far away: remote work, nothing taken off for the distance (two spellings)
    ("Data Analyst", "Beispiel GmbH (München)", "Homeoffice", 48.1372, 11.5756, "de", 55000, 75),
    ("BI Analyst", "Exempel AB (Göteborg)", "home office", 57.7089, 11.9746, "se", 49000, 73),
]


def ranking(tmp_path: Path, with_residence: bool):
    import importlib

    home = tmp_path / ("after" if with_residence else "before")
    (home / "profile").mkdir(parents=True)
    (home / "profile" / "candidate_profile.yml").write_text(PROFILE + (RESIDENCE if with_residence else ""), encoding="utf-8")
    mp = pytest.MonkeyPatch()
    mp.setenv("JHT_HOME", str(home))
    mp.setenv("JHT_DB", str(home / "jobs.db"))
    try:
        import db_insert
        import score_place_pay
        importlib.reload(db_insert)
        if not with_residence:   # the code of before: no penalty of place or pay at all
            mp.setattr(score_place_pay, "for_position", lambda conn, position_id, profile=None: (0, []))
        from _db import ensure_schema, get_db
        conn = get_db()
        ensure_schema(conn)
        for i, (title, company, mode, lat, lon, cc, pay, _raw) in enumerate(POSITIONS, 1):
            conn.execute("INSERT INTO positions (id, title, company, url, work_mode, office_lat, office_lon, loc_country_code, "
                         "salary_declared_min) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                         (i, title, company, f"https://example.invalid/{i}", mode, lat, lon, cc, pay))
        conn.commit()
        conn.close()
        for i, position in enumerate(POSITIONS, 1):
            raw = position[-1]
            args = types.SimpleNamespace(position_id=i, total=raw, stack_match=min(40, raw // 2), experience_fit=8,
                                         remote_fit=15, salary_fit=10, strategic_fit=5, breakdown="STACK: synthetic",
                                         notes="synthetic", scored_by="scorer-bench")
            db_insert.insert_score(args)
        with sqlite3.connect(home / "jobs.db") as db:
            rows = db.execute("SELECT p.company, p.work_mode, s.total_score FROM scores s JOIN positions p ON p.id = s.position_id "
                              "ORDER BY s.total_score DESC, p.id").fetchall()
    finally:
        mp.undo()
    return rows


def plan_countries(tmp_path: Path, with_residence: bool):
    import importlib.util

    spec = importlib.util.spec_from_file_location("scout_coverage_bench", ROOT / "shared" / "skills" / "scout_coverage.py")
    cov = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(cov)
    path = tmp_path / ("plan-after.yml" if with_residence else "plan-before.yml")
    path.write_text(PROFILE + (RESIDENCE if with_residence else ""), encoding="utf-8")
    plan = cov.load_plan(path)
    return sorted({e["country"] for e in plan["entries"]}), plan.get("skipped_language_only", [])


def _table(title, rows):
    lines = [title] + ["  %d. %-28s %-7s %3d" % (n, company, mode, total) for n, (company, mode, total) in enumerate(rows, 1)]
    return "\n".join(lines)


def test_the_bench_before_and_after(tmp_path, capsys):
    before, after = ranking(tmp_path, False), ranking(tmp_path, True)
    plan_before, plan_after = plan_countries(tmp_path, False), plan_countries(tmp_path, True)
    with capsys.disabled():
        print("\n" + _table("BEFORE (no residence, no radius)", before))
        print(_table("AFTER (residence Valencia, radius 40 km, pay target)", after))
        print(f"Scout plan BEFORE: countries {plan_before[0]}, left out {plan_before[1]}")
        print(f"Scout plan AFTER:  countries {plan_after[0]}, left out {plan_after[1]}")
    # before: the far onsite jobs in Sweden are at the top
    assert [company for company, _m, _t in before[:2]] == ["Exempel AB (Umeå)", "Prov AB (Sundsvall)"]
    assert "se" in plan_before[0]
    # after: nothing onsite far from home in the first three, and Sweden is out of the plan until it is named
    top3 = [company for company, _m, _t in after[:3]]
    assert not {"Exempel AB (Umeå)", "Prov AB (Sundsvall)", "Prueba SA (Madrid)"} & set(top3), after
    assert "se" not in plan_after[0] and "se" in plan_after[1]
    assert dict((c, t) for c, _m, t in after)["Exempel AB (Umeå)"] == 86 - 25 - 10
    # a home office job keeps its score, wherever its office is
    totals = dict((c, t) for c, _m, t in after)
    assert totals["Beispiel GmbH (München)"] == 75 and totals["Exempel AB (Göteborg)"] == 73
