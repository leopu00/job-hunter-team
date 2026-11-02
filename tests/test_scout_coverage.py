"""scout_coverage.py: where the Scout searches FIRST for a profile's languages, and how much of it is done.

The plan is data (scout_coverage_table.json); what is tested here is what the Scout and the exhaustion tool rely on:
the order (core before minor, the native language first), what «covered» and «closed» mean, that a portal is matched by
slug AND country, and that nothing of the profile reaches the output.
"""
import importlib.util
import json
import re
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS = REPO_ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


cov = _load("scout_coverage_under_test", SKILLS / "scout_coverage.py")
plog = _load("scout_pass_log_for_coverage_tests", SKILLS / "scout_pass_log.py")
report = _load("scout_pass_report_for_coverage_tests", SKILLS / "scout_pass_report.py")

PROFILE_SV_EN = "languages:\n  - language: Svenska\n    level: native\n  - language: English\n    level: C1\n"


@pytest.fixture
def profile(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_SCOUT_COVER_PASSES", raising=False)
    monkeypatch.delenv("JHT_SCOUT_COVER_QUERIES", raising=False)
    (tmp_path / "profile").mkdir()
    path = tmp_path / "profile" / "candidate_profile.yml"
    path.write_text(PROFILE_SV_EN, encoding="utf-8")
    return path


_clock = [1000.0]


def _pass(source, country, kind="role", query=None, returned=5, status=None):
    _clock[0] += 10
    row = {"kind": "pass", "ts": _clock[0], "agent": "scout-1", "source": source, "country": country,
           "returned": returned, "query_kind": kind}
    if query:
        row["query_hash"] = plog.query_hash(query)
    if status:
        row["status"] = status
    return row


def _inserted(source, country):
    _clock[0] += 1
    return {"kind": "candidate", "ts": _clock[0], "agent": "scout-1", "source": source, "country": country,
            "outcome": "inserted", "opened": True}


def _state(rows, source, country="se"):
    return next(r for r in cov.portal_states(rows) if r["source"] == source and r["country"] == country)


# ── the plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_plan_puts_every_core_portal_before_any_minor_one_and_the_native_language_first(profile):
    plan = cov.load_plan()
    tiers = [e["tier"] for e in plan["entries"]]
    assert tiers == sorted(tiers, key=lambda t: cov.TIER_ORDER[t])
    assert plan["languages"][0] == "sv"
    cores = [e for e in plan["entries"] if e["tier"] == "core"]
    assert [e["slug"] for e in cores[:6]] == ["arbetsformedlingen", "blocket-jobb", "linkedin", "indeed", "jobbsafari", "academic-work"]
    assert {e["country"] for e in cores[:6]} == {"se"}
    languages_in_order = [e["language"] for e in cores]
    assert languages_in_order.index("en") > max(i for i, g in enumerate(languages_in_order) if g == "sv")


def test_a_language_the_table_does_not_have_is_said_not_silently_dropped(profile):
    profile.write_text("languages:\n  - language: Magyar\n    level: native\n  - language: English\n    level: C1\n", encoding="utf-8")
    plan = cov.load_plan()
    assert plan["unmapped"] == ["hu"]
    assert plan["entries"] and all(e["language"] in ("en", "remote") for e in plan["entries"])


def test_a_profile_that_cannot_be_read_has_no_plan_and_demands_nothing(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    assert cov.portal_states([]) == []
    assert cov.core_missing([]) == []
    (tmp_path / "profile").mkdir()
    (tmp_path / "profile" / "candidate_profile.yml").write_text("languages: [[[", encoding="utf-8")
    assert cov.portal_states([]) == []


def test_the_remote_portals_are_left_out_of_an_on_site_search(profile):
    profile.write_text(PROFILE_SV_EN + "preferences:\n  work_mode: on-site\n", encoding="utf-8")
    assert not [e for e in cov.load_plan()["entries"] if e["language"] == "remote"]


def test_at_most_eight_core_portals_per_group_and_the_table_is_well_formed():
    data = cov.table()
    slug = re.compile(r"^[a-z0-9][a-z0-9._-]{0,39}$")
    country = re.compile(r"^(?:[a-z]{2}|remote)$")
    for group, entries in data["groups"].items():
        assert sum(1 for e in entries if e["tier"] == "core") <= 8, group
        seen = set()
        for e in entries:
            assert slug.match(e["slug"]) and country.match(e["country"]), e
            assert e["tier"] in cov.TIER_ORDER and e["access"] in ("search", "email", "closed"), e
            assert e["slug"] not in data["retired"], e
            assert (e["slug"], e["country"]) not in seen, e
            seen.add((e["slug"], e["country"]))
    for code in data["groups"]:
        assert code == "remote" or code in cov._lang.LANGUAGE_NAMES, code
        assert code == "remote" or code in data["level_terms"], code


def test_a_403_seen_only_from_the_mac_does_not_close_a_source_in_the_table_the_scout_on_the_field_does(profile):
    by = {(e["slug"], e["country"]): e for e in cov.load_plan()["entries"]}
    for key in (("jobbsafari", "se"), ("jobbland", "se"), ("weworkremotely", "remote"), ("himalayas", "remote"), ("jooble", "se")):
        assert by[key]["access"] == "search", key             # «to try», not «closed»
        assert _state([], key[0], key[1])["state"] == "untouched"
        assert _state([_pass(key[0], key[1], "role_language", "a", returned=0, status="closed")], key[0], key[1])["state"] == "closed"
    assert by[("jobbsafari", "se")]["tier"] == "core"
    # what the table closes was seen closed on a real run (the squad's own pass log), nothing from one network alone
    assert sorted(e["slug"] for e in by.values() if e["access"] == "closed") == ["eu-remote-jobs", "remote-rocketship"]
    hub = by[("thehub", "se")]
    assert hub["tier"] == "core" and hub["portal_language"] == "en"
    rows = [_pass("thehub", "se", "role", q) for q in ("developer", "engineer", "junior developer")]
    assert _state(rows, "thehub")["state"] == "covered"      # an English portal in Sweden: no Swedish query demanded


def test_the_company_boards_of_sweden_are_in_the_table_and_the_command_lists_them(tmp_path):
    out = _run(str(SKILLS / "scout_coverage.py"), "boards", "--country", "SE", home=tmp_path)
    boards = json.loads(out.stdout)
    assert out.returncode == 0
    assert len(boards["greenhouse"]["slugs"]) == 11 and len(boards["lever"]["slugs"]) == 4 and len(boards["teamtailor"]["urls"]) == 26
    assert all(u.startswith("https://") for u in boards["teamtailor"]["urls"].values())
    assert _run(str(SKILLS / "scout_coverage.py"), "boards", "--country", "xx", home=tmp_path).returncode == 1


# ── what covered, partial, closed mean ───────────────────────────────────────────────────────────────────────────────
def test_a_portal_is_covered_at_three_passes_with_three_different_queries_one_in_its_language(profile):
    rows = [_pass("arbetsformedlingen", "se", "role_language", "utvecklare")]
    assert _state(rows, "arbetsformedlingen")["state"] == "partial"
    rows += [_pass("arbetsformedlingen", "se", "role", "developer"), _pass("arbetsformedlingen", "se", "level", "junior developer")]
    state = _state(rows, "arbetsformedlingen")
    assert (state["state"], state["passes"], state["distinct_queries"]) == ("covered", 3, 3)
    assert state["next_kind"] is None


def test_three_passes_of_the_same_query_are_not_coverage(profile):
    rows = [_pass("arbetsformedlingen", "se", "role_language", "utvecklare") for _ in range(3)]
    state = _state(rows, "arbetsformedlingen")
    assert (state["state"], state["passes"], state["distinct_queries"]) == ("partial", 3, 1)


def test_a_portal_in_another_language_needs_a_query_in_it(profile):
    rows = [_pass("arbetsformedlingen", "se", "role", q) for q in ("developer", "engineer", "junior developer")]
    state = _state(rows, "arbetsformedlingen")
    assert state["state"] == "partial" and any("role_language" in m for m in state["missing"])
    assert state["next_kind"] == "role_language"
    english = [_pass("irishjobs", "ie", "role", q) for q in ("developer", "engineer", "junior developer")]
    assert _state(english, "irishjobs", "ie")["state"] == "covered"


def test_one_closed_pass_settles_the_portal_and_it_is_shown_as_closed_never_covered(profile):
    for status in ("closed", "gone"):
        rows = [_pass("blocket-jobb", "se", "role_language", "utvecklare", returned=0, status=status)]
        assert _state(rows, "blocket-jobb")["state"] == "closed"
    reopened = [_pass("blocket-jobb", "se", "role_language", "a", status="closed"), _pass("blocket-jobb", "se", "role", "b")]
    assert _state(reopened, "blocket-jobb")["state"] == "partial"
    after = [_pass("blocket-jobb", "se", "role_language", "a", status="closed"), _pass("blocket-jobb", "se", "role", "b"),
             _pass("blocket-jobb", "se", "synonym", "c")]
    state = _state(after, "blocket-jobb")
    assert (state["state"], state["passes"]) == ("partial", 2)       # the closed pass is not one of the three
    closed_last = [_pass("blocket-jobb", "se", "role", "b"), _pass("blocket-jobb", "se", "role", "c", status="closed")]
    assert _state(closed_last, "blocket-jobb")["state"] == "closed"


def test_a_portal_read_by_email_or_confirmed_closed_in_the_table_needs_no_pass(profile):
    assert _state([], "indeed")["state"] == "via_email"
    profile.write_text("languages:\n  - language: Nederlands\n    level: native\n", encoding="utf-8")
    assert _state([], "nationale-vacaturebank", "nl")["state"] == "closed"


def test_a_source_is_matched_by_slug_or_alias_and_by_country(profile):
    rows = [_pass("Platsbanken", "se", "role_language", "a"), _pass("arbets", "se", "role", "b"), _pass("arbetsformedlingen-se", "se", "synonym", "c")]
    assert _state(rows, "arbetsformedlingen")["passes"] == 3
    german = [_pass("linkedin", "de", "role_language", "a")] * 3
    assert _state(german, "linkedin")["passes"] == 0          # LinkedIn Germany is not LinkedIn Sweden
    assert _state([_pass("linkedin", "se", "role_language", "a")], "linkedin")["passes"] == 1


def test_candidates_and_inserted_are_counted_per_portal(profile):
    rows = [_pass("academic-work", "se", "role_language", "a", returned=4), _inserted("academic-work", "se"), _inserted("linkedin", "se")]
    state = _state(rows, "academic-work")
    assert (state["candidates"], state["inserted"]) == (4, 1)


def test_the_thresholds_come_from_the_environment(profile, monkeypatch):
    monkeypatch.setenv("JHT_SCOUT_COVER_PASSES", "1")
    monkeypatch.setenv("JHT_SCOUT_COVER_QUERIES", "1")
    assert _state([_pass("arbetsformedlingen", "se", "role_language", "a")], "arbetsformedlingen")["state"] == "covered"


# ── core_missing: what the exhaustion tool reads ─────────────────────────────────────────────────────────────────────
def test_core_missing_names_the_core_portals_not_done_and_nothing_else(profile):
    states = cov.portal_states([_pass("arbetsformedlingen", "se", "role", "a")])
    missing = cov.core_missing(states)
    assert "arbetsformedlingen/se 1/3 +role_language" in missing
    assert "blocket-jobb/se 0/3 +role_language" in missing
    assert not any(m.startswith("indeed/") for m in missing)            # email: done
    assert not any(m.startswith(("ledigajobb", "jobbland")) for m in missing)   # minor
    assert "irishjobs/ie 0/3" in missing


def test_core_missing_is_empty_when_the_whole_core_is_done(profile):
    rows = []
    for entry in cov.load_plan()["entries"]:
        if entry["tier"] != "core" or entry["access"] != "search":
            continue
        kinds = ("role_language", "role", "synonym") if entry["portal_language"] != "en" else ("role", "synonym", "level")
        rows += [_pass(entry["slug"], entry["country"], k, "%s %s" % (entry["slug"], k)) for k in kinds]
    assert cov.core_missing(cov.portal_states(rows)) == []
    assert cov.next_step(cov.load_plan(), [r for r in rows if r["kind"] == "pass"])["plan_done"] is False  # minor ones remain


# ── next ────────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_next_asks_a_different_kind_of_question_each_time(profile):
    plan = cov.load_plan()
    rows = []
    asked = []
    for _ in range(3):
        step = cov.next_step(plan, rows)
        assert step["source"] == "arbetsformedlingen"
        asked.append(step["query_kind"])
        rows.append(_pass(step["source"], step["country"], step["query_kind"], "q%d" % len(asked)))
    assert asked == ["role_language", "role", "synonym"]
    assert cov.next_step(plan, rows)["source"] == "blocket-jobb"


def test_next_gives_the_level_words_and_the_cities_only_when_it_asks_for_them(profile):
    plan = cov.load_plan()
    done_first = [_pass(s, "se", k, "%s-%s" % (s, k)) for s in ("arbetsformedlingen", "blocket-jobb") for k in ("role_language", "role", "synonym")]
    # LinkedIn: three kinds asked but the same query each time -> still partial, and the next kind is the level
    rows = done_first + [_pass("linkedin", "se", k, "same") for k in ("role_language", "role", "synonym")]
    step = cov.next_step(plan, rows)
    assert (step["source"], step["query_kind"]) == ("linkedin", "level")
    assert step["level_terms"] == cov.table()["level_terms"]["sv"] and "cities" not in step
    rows.append(_pass("linkedin", "se", "level", "same"))
    step = cov.next_step(plan, rows)
    assert (step["source"], step["query_kind"]) == ("linkedin", "city")
    assert "Stockholm" in step["cities"] and "level_terms" not in step
    # a portal with no city list never asks for one
    plain = done_first + [_pass("academic-work", "se", k, "same") for k in ("role_language", "role", "synonym", "level")]
    step = cov.next_step(plan, plain)
    assert step["source"] != "academic-work" or step["query_kind"] != "city"


def test_next_says_the_plan_is_done_when_every_portal_is_done(profile):
    rows = []
    for entry in cov.load_plan()["entries"]:
        if entry["access"] != "search":
            continue
        rows.append(_pass(entry["slug"], entry["country"], "role_language", "closed", returned=0, status="closed"))
    step = cov.next_step(cov.load_plan(), rows)
    assert step == {"plan_done": True, "core_done": True, "entries": step["entries"]}


# ── the pass log carries what the plan needs ─────────────────────────────────────────────────────────────────────────
def test_the_pass_log_accepts_the_new_kinds_and_a_closed_vocabulary_of_statuses(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_AGENT_NAME", "scout-1")
    for kind in ("synonym", "level", "city"):
        assert plog.main(["pass", "--source", "linkedin", "--country", "se", "--returned", "1", "--query-kind", kind]) == 0
    assert plog.main(["pass", "--source", "arbetsformedlingen", "--country", "se", "--returned", "0", "--status", "closed"]) == 0
    with pytest.raises(SystemExit):
        plog.main(["pass", "--source", "x", "--returned", "0", "--status", "a free text"])
    lines = [json.loads(l) for l in (tmp_path / "logs" / "scout-passes.jsonl").read_text().splitlines()]
    assert [l.get("status") for l in lines] == [None, None, None, "closed"]
    assert set(lines[3]) == {"v", "kind", "ts", "agent", "source", "country", "returned", "query_kind", "status"}


# ── the visible side: the P1 report ──────────────────────────────────────────────────────────────────────────────────
def _run(*argv, home):
    env = {"PATH": "/usr/bin:/bin", "JHT_HOME": str(home), "JHT_AGENT_NAME": "scout-1", "PYTHONDONTWRITEBYTECODE": "1"}
    return subprocess.run([sys.executable, *argv], capture_output=True, text=True, timeout=60, env=env)


def test_the_p1_report_shows_every_portal_of_the_plan_covered_or_not_and_nothing_of_the_profile(profile, tmp_path):
    profile.write_text(PROFILE_SV_EN + "name: Zorro Testsson\ntarget_role: Plumber of clouds\nlocation: Kiruna\n", encoding="utf-8")
    for q, kind in (("utvecklare", "role_language"), ("developer", "role"), ("junior developer", "level")):
        done = _run(str(SKILLS / "scout_pass_log.py"), "pass", "--source", "arbetsformedlingen", "--country", "se", "--returned", "7",
                    "--query-kind", kind, "--query", q, home=tmp_path)
        assert done.returncode == 0, done.stderr
    _run(str(SKILLS / "scout_pass_log.py"), "pass", "--source", "blocket-jobb", "--country", "se", "--returned", "0", "--status", "closed", home=tmp_path)
    out = _run(str(SKILLS / "scout_pass_report.py"), "--coverage", "--no-tokens", home=tmp_path)
    assert out.returncode == 0, out.stderr
    rows = {line.split()[3] + "/" + line.split()[4]: line.split()[5] for line in out.stdout.splitlines()[1:] if line[:1].isdigit()}
    assert rows["arbetsformedlingen/se"] == "covered" and rows["blocket-jobb/se"] == "closed"
    assert rows["academic-work/se"] == "untouched" and rows["indeed/se"] == "via_email"
    for secret in ("Zorro", "Testsson", "Plumber", "Kiruna"):
        assert secret not in out.stdout
    as_json = json.loads(_run(str(SKILLS / "scout_pass_report.py"), "--coverage", "--json", "--no-tokens", home=tmp_path).stdout)
    assert "arbetsformedlingen/se" not in " ".join(as_json["core_missing"]) and as_json["core_missing"]


def test_the_cli_plan_status_and_next_answer(profile, tmp_path):
    for sub in ("plan", "status", "next"):
        out = _run(str(SKILLS / "scout_coverage.py"), sub, "--json", home=tmp_path)
        assert out.returncode == 0, out.stderr
        json.loads(out.stdout)
