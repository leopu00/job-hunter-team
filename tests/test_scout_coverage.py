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
    for key in (("jobbsafari", "se"), ("jobbland", "se"), ("weworkremotely", "remote"), ("himalayas", "remote")):
        assert by[key]["access"] == "search", key             # «to try», not «closed»
        assert _state([], key[0], key[1])["state"] == "untouched"
        assert _state([_pass(key[0], key[1], "role_language", "a", returned=0, status="closed")], key[0], key[1])["state"] == "closed"
    assert by[("jobbsafari", "se")]["tier"] == "core"
    # what the table closes was seen closed on a real run (the squad's own pass log), nothing from one network alone
    # (irishjobs 403 and jobgether's JavaScript shell on the runs of 10/11 and 11/11; the others on earlier ones)
    assert sorted(e["slug"] for e in by.values() if e["access"] == "closed") == [
        "careerjet", "eu-remote-jobs", "flexjobs", "gradireland", "irishjobs", "jobgether", "jobs-ie", "jooble", "remote-rocketship",
        "wellfound", "wellfound"]
    hub = by[("thehub", "se")]
    assert hub["tier"] == "core" and hub["portal_language"] == "en"
    rows = [_pass("thehub", "se", "role", "developer"), _pass("thehub", "se", "role", "engineer"), _pass("thehub", "se", "broad", "internship")]
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
    rows += [_pass("arbetsformedlingen", "se", "role", "developer"), _pass("arbetsformedlingen", "se", "broad", "praktik")]
    state = _state(rows, "arbetsformedlingen")
    assert (state["state"], state["passes"], state["distinct_queries"]) == ("covered", 3, 3)
    assert state["next_kind"] is None


def test_three_different_queries_without_a_wide_one_are_not_coverage_and_the_next_question_is_the_wide_one(profile):
    """Real run of 02/11: Platsbanken answers 0 to a full title in AND with a city and hundreds to «praktik». Titles only
    (three different, one in the portal's language) never covered it: one WIDE query is part of «covered»."""
    rows = [_pass("arbetsformedlingen", "se", "role_language", "utvecklare"), _pass("arbetsformedlingen", "se", "role", "developer"),
            _pass("arbetsformedlingen", "se", "level", "junior developer")]
    state = _state(rows, "arbetsformedlingen")
    assert (state["state"], state["passes"], state["distinct_queries"]) == ("partial", 3, 3)
    assert any("BROAD" in m and "broad" in m for m in state["missing"]) and not any("role_language" in m for m in state["missing"])
    assert state["next_kind"] == "broad"
    english = [_pass("thehub", "se", "role", q) for q in ("developer", "engineer", "junior developer")]
    assert _state(english, "thehub", "se")["state"] == "partial"


def test_three_passes_of_the_same_query_are_not_coverage(profile):
    rows = [_pass("arbetsformedlingen", "se", "role_language", "utvecklare") for _ in range(3)]
    state = _state(rows, "arbetsformedlingen")
    assert (state["state"], state["passes"], state["distinct_queries"]) == ("partial", 3, 1)


def test_a_portal_in_another_language_needs_a_query_in_it(profile):
    rows = [_pass("arbetsformedlingen", "se", "role", q) for q in ("developer", "engineer", "junior developer")]
    rows.append(_pass("arbetsformedlingen", "se", "broad", "praktik"))
    state = _state(rows, "arbetsformedlingen")
    assert state["state"] == "partial" and any("role_language" in m for m in state["missing"])    # wide, but not in its language
    assert state["next_kind"] == "role_language"
    english = [_pass("thehub", "se", "role", q) for q in ("developer", "engineer")] + [_pass("thehub", "se", "broad", "internship")]
    assert _state(english, "thehub", "se")["state"] == "covered"


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
    assert _state([_pass("thehub", "se", "broad", "internship")], "thehub", "se")["state"] == "covered"
    assert _state([_pass("thehub", "se", "role", "developer")], "thehub", "se")["state"] == "partial"      # still no wide one
    assert _state([_pass("arbetsformedlingen", "se", "broad", "praktik")], "arbetsformedlingen")["state"] == "partial"


# ── core_missing: what the exhaustion tool reads ─────────────────────────────────────────────────────────────────────
def test_core_missing_names_the_core_portals_not_done_and_nothing_else(profile):
    states = cov.portal_states([_pass("arbetsformedlingen", "se", "role", "a")])
    missing = cov.core_missing(states)
    assert "arbetsformedlingen/se 1/3 +role_language +broad" in missing
    assert "blocket-jobb/se 0/3 +role_language +broad" in missing
    assert "arbetsformedlingen/se 1/3 +broad" in cov.core_missing(cov.portal_states(
        [_pass("arbetsformedlingen", "se", "role_language", "a")]))
    assert not any(m.startswith("indeed/") for m in missing)            # email: done
    assert not any(m.startswith(("ledigajobb", "jobbland")) for m in missing)   # minor
    assert "thehub/se 0/3 +broad" in missing


def test_core_missing_is_empty_when_the_whole_core_is_done(profile):
    rows = []
    for entry in cov.load_plan()["entries"]:
        if entry["tier"] != "core" or entry["access"] != "search":
            continue
        kinds = ("broad", "role_language", "role") if entry["portal_language"] != "en" else ("broad", "role", "synonym")
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
    assert asked == ["broad", "role_language", "role"]            # wide first, then the portal's language, then English
    assert cov.next_step(plan, rows)["source"] == "blocket-jobb"


def test_next_gives_the_level_words_and_the_cities_only_when_it_asks_for_them(profile):
    plan = cov.load_plan()
    done_first = [_pass(s, "se", k, "%s-%s" % (s, k)) for s in ("arbetsformedlingen", "blocket-jobb") for k in ("broad", "role_language", "role")]
    # LinkedIn: three kinds asked but the same query each time -> still partial, and the next kind is the synonym
    rows = done_first + [_pass("linkedin", "se", k, "same") for k in ("broad", "role_language", "role")]
    step = cov.next_step(plan, rows)
    assert (step["source"], step["query_kind"]) == ("linkedin", "synonym")
    rows.append(_pass("linkedin", "se", "synonym", "same"))
    step = cov.next_step(plan, rows)
    assert (step["source"], step["query_kind"]) == ("linkedin", "level")
    assert step["level_terms"] == cov.table()["level_terms"]["sv"] and "cities" not in step
    rows.append(_pass("linkedin", "se", "level", "same"))
    step = cov.next_step(plan, rows)
    assert (step["source"], step["query_kind"]) == ("linkedin", "city")
    assert "Stockholm" in step["cities"] and "level_terms" not in step
    # a portal with no city list never asks for one
    plain = done_first + [_pass("academic-work", "se", k, "same") for k in ("broad", "role_language", "role", "synonym", "level")]
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
    for kind in ("synonym", "level", "city", "broad"):
        assert plog.main(["pass", "--source", "linkedin", "--country", "se", "--returned", "1", "--query-kind", kind]) == 0
    assert plog.main(["pass", "--source", "arbetsformedlingen", "--country", "se", "--returned", "0", "--status", "closed"]) == 0
    with pytest.raises(SystemExit):
        plog.main(["pass", "--source", "x", "--returned", "0", "--status", "a free text"])
    lines = [json.loads(l) for l in (tmp_path / "logs" / "scout-passes.jsonl").read_text().splitlines()]
    assert [l.get("status") for l in lines] == [None, None, None, None, "closed"]
    assert set(lines[4]) == {"v", "kind", "ts", "agent", "source", "country", "returned", "query_kind", "status"}


# ── the visible side: the P1 report ──────────────────────────────────────────────────────────────────────────────────
def _run(*argv, home):
    env = {"PATH": "/usr/bin:/bin", "JHT_HOME": str(home), "JHT_AGENT_NAME": "scout-1", "PYTHONDONTWRITEBYTECODE": "1"}
    return subprocess.run([sys.executable, *argv], capture_output=True, text=True, timeout=60, env=env)


def test_the_p1_report_shows_every_portal_of_the_plan_covered_or_not_and_nothing_of_the_profile(profile, tmp_path):
    profile.write_text(PROFILE_SV_EN + "name: Zorro Testsson\ntarget_role: Plumber of clouds\nlocation: Kiruna\n", encoding="utf-8")
    for q, kind in (("utvecklare", "role_language"), ("developer", "role"), ("praktik", "broad")):
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


def test_next_for_a_wide_question_gives_the_entry_words_of_the_portals_language_and_says_how(profile):
    step = cov.next_step(cov.load_plan(), [])
    assert (step["source"], step["query_kind"], step["query_language"]) == ("arbetsformedlingen", "broad", "sv")
    assert step["broad_terms"][0] == "praktik" and "nyexaminerad" in step["broad_terms"]
    assert "ALL the results" in step["how"] and "no full title and no place" in step["how"]


def test_every_language_of_the_table_has_its_entry_words():
    data = cov.table()
    assert set(data["broad_terms"]) == set(data["level_terms"]) and all(data["broad_terms"][k] for k in data["broad_terms"])


def test_the_wide_english_queries_that_returned_positions_in_the_field_are_in_the_table_as_examples_and_in_the_wide_step(profile):
    data = cov.table()
    worked = {e["term"]: e for e in data["broad_examples"]["en"]}
    assert {"intern", "developer", "graduate", "trainee"} <= set(worked)
    assert all(e["inserted"] >= 1 and e["read"] >= e["inserted"] for e in worked.values())
    assert all(e["inserted"] == 0 for e in data["broad_examples"]["no_yield"])
    assert {"internship", "intern", "graduate", "trainee"} <= set(data["broad_terms"]["en"])
    step = cov.next_step(cov.load_plan(), [])
    assert step["query_kind"] == "broad" and step["broad_worked_in_english"] == list(worked)
    # nothing but the words and numbers: no profile text, no company
    assert set(json.dumps(data["broad_examples"])) <= set(json.dumps(data["broad_examples"]).encode("ascii", "ignore").decode())


# ── the kit of 03/11 for the countries where the Scout found nothing (FR, DE, ES, PT, NL, BE, CH, AT) ──────────────────────
KIT_COUNTRIES = ("fr", "de", "es", "pt", "nl", "be", "ch", "at")
KIT_APIS = {"arbeitnow"}


def test_every_country_of_the_kit_has_company_boards_the_tool_can_read():
    ats = _load("ats_board_search_for_coverage_tests", SKILLS / "ats_board_search.py")
    data = cov.table()
    for country in KIT_COUNTRIES:
        block = data["ats_boards"][country]
        slugs = [s for provider in ("greenhouse", "lever") for s in (block.get(provider) or {}).get("slugs", [])]
        assert len(slugs) >= 5, country
        for provider in ("greenhouse", "lever"):
            for slug in (block.get(provider) or {}).get("slugs", []):
                assert ats.SLUG.match(slug), (country, slug)
                assert ats.url_for(provider, slug, data["ats_boards"]).startswith("https://"), (country, slug)
        assert ats.COUNTRY.match(country) and country in ats.COUNTRIES, country


def test_the_public_documented_apis_of_the_kit_are_core_https_with_a_hint_that_says_how_to_ask():
    data = cov.table()
    found = set()
    for group in data["groups"].values():
        for entry in group:
            if entry.get("api"):
                assert entry["api"].startswith("https://") and "@" not in entry["api"], entry["slug"]
                assert len(entry.get("hint", "")) > 80, entry["slug"]
                assert "key" in entry["hint"].lower() or "no login" in entry["hint"].lower(), entry["slug"]
                found.add(entry["slug"])
    assert KIT_APIS <= found
    for group, slug in (("de", "arbeitnow"),):
        assert next(e for e in data["groups"][group] if e["slug"] == slug)["tier"] == "core"


def test_a_german_profile_gets_the_german_api_before_any_minor_portal(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    spoken = {"de": 6, "en": 4}
    plan = cov.build_plan(spoken)
    order = [(e["slug"], e["tier"]) for e in plan["entries"]]
    core = [s for s, tier in order if tier == "core"]
    assert "arbeitnow" in core and "jobs-ch" in core  # jobs.ch is core as a page, not as an API
    assert order.index(("arbeitnow", "core")) < min(i for i, (_, tier) in enumerate(order) if tier == "minor")


def test_the_wide_words_of_the_kit_countries_are_more_than_one_and_in_their_language():
    data = cov.table()
    for lang in ("de", "fr", "es", "pt", "nl"):
        assert len(data["broad_terms"][lang]) >= 2, lang


def test_next_gives_the_public_api_and_the_hint_of_the_portal_when_the_table_has_them(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    plan = cov.build_plan({"de": 6, "en": 4})
    plan["entries"] = [e for e in plan["entries"] if e["slug"] == "arbeitnow"]
    step = cov.next_step(plan, [])
    assert step["source"] == "arbeitnow" and step["api"].startswith("https://www.arbeitnow.com/")
    assert "no key" in step["hint"].lower()
    plain = cov.build_plan({"de": 6, "en": 4})
    plain["entries"] = [dict(e, access="search") for e in plain["entries"] if e["slug"] == "indeed"]
    assert "api" not in cov.next_step(plain, [])


def test_jobs_ch_is_read_through_its_public_search_page_not_through_an_internal_json():
    data = cov.table()
    entry = next(e for e in data["groups"]["de"] if e["slug"] == "jobs-ch")
    assert "api" not in entry and "jobs.ch/de/stellenangebote" in entry["hint"]


def test_a_source_whose_robots_txt_disallows_programs_is_closed_in_the_table_with_the_reason_and_has_no_api():
    data = cov.table()
    for group, slug in (("fr", "hellowork"), ("fr", "le-forem")):
        entry = next(e for e in data["groups"][group] if e["slug"] == slug)
        assert entry["access"] == "closed" and "api" not in entry and "robots.txt" in entry["hint"], slug
    landing = next(e for e in data["groups"]["pt"] if e["slug"] == "landing-jobs")
    assert "api" not in landing and "robots.txt" in landing["hint"]


# ── dead portals: not the first thing a Scout opens (measured 11/11: 11-17 of 30 minutes on them) ──────────────────────
PROFILE_IT_EN = "languages:\n  - language: Italiano\n    level: native\n  - language: English\n    level: B2\npreferences:\n  work_mode: remote\n"


def test_the_portals_that_were_seen_dead_on_the_runs_are_closed_in_the_table_with_the_reason():
    data = cov.table()
    by = {(e["slug"], e["country"]): e for g in data["groups"].values() for e in g}
    for key in (("infojobs-it", "it"), ("irishjobs", "ie"), ("cliclavoro", "it"), ("jobgether", "remote"),
                ("jobs-ie", "ie"), ("careerjet", "se"), ("flexjobs", "remote"), ("monster-it", "it"), ("jooble", "se"),
                ("wellfound", "se"), ("wellfound", "remote"), ("gradireland", "ie")):
        assert by[key]["access"] == "closed" and by[key]["hint"], key
    assert "shut down" in by[("infojobs-it", "it")]["hint"]
    # not closed: a 403 seen on one run only, or a path that was guessed wrong
    # (the UK portals are not closed doors: they are a rule of the plan, `needs_work_right`, see below)
    for key in (("weworkremotely", "remote"), ("himalayas", "remote"), ("totaljobs", "gb"), ("reed", "gb")):
        assert by[key]["access"] == "search", key
    assert "api" in by[("himalayas", "remote")]["hint"].lower() and "403" in by[("himalayas", "remote")]["hint"]


def test_an_italian_profile_does_not_start_on_a_closed_portal(profile):
    profile.write_text(PROFILE_IT_EN, encoding="utf-8")
    plan = cov.load_plan()
    first = []
    rows = []
    for _ in range(6):
        step = cov.next_step(plan, rows)
        assert step["source"] not in ("infojobs-it", "irishjobs", "cliclavoro", "jobgether"), step["source"]
        first.append(step["source"])
        rows += [_pass(step["source"], step["country"], k, q) for k, q in (("broad", "a"), ("role_language", "b"), ("role", "c"))]
    assert "thehub" in first or "remotive" in first or "weworkremotely" in first


def test_avoid_lists_the_tables_dead_sources_and_the_ones_this_run_found_dead(profile):
    plan = cov.load_plan()
    out = {a["source"]: a["why"] for a in cov.avoid_list(plan, [])}
    assert {"eures", "duckduckgo", "smartrecruiters-search", "welcome-to-the-jungle"} <= set(out) and all(out.values())
    rows = [_pass("some-board", "se", "broad", "x", returned=0, status="closed"),
            _pass("other-board", "se", "broad", "x", returned=0, status="blocked"),
            _pass("other-board", "se", "role", "y", returned=0, status="blocked"),
            _pass("flaky-board", "se", "broad", "x", returned=0, status="blocked"),
            _pass("flaky-board", "se", "role", "y", returned=3),
            _pass("gone-then-back", "se", "broad", "x", returned=0, status="gone"),
            _pass("gone-then-back", "se", "role", "y", returned=4)]
    out = {a["source"] for a in cov.avoid_list(plan, rows)}
    assert {"some-board", "other-board"} <= out
    assert "flaky-board" not in out              # one blocked pass and a good one: it answered
    assert "gone-then-back" not in out            # the LAST pass says what it is now: it answered again
    # a portal of the plan shows its own state, it is not listed twice
    plan_rows = [_pass("arbetsformedlingen", "se", "broad", "x", returned=0, status="closed")]
    assert "arbetsformedlingen" not in {a["source"] for a in cov.avoid_list(plan, plan_rows)}


def test_next_prints_the_avoid_list_and_it_never_grows_past_its_limit(profile, tmp_path):
    for n in range(cov.AVOID_MAX + 5):
        done = _run(str(SKILLS / "scout_pass_log.py"), "pass", "--source", "dead-%d" % n, "--country", "se", "--returned", "0",
                    "--status", "closed", home=tmp_path)
        assert done.returncode == 0, done.stderr
    out = _run(str(SKILLS / "scout_coverage.py"), "next", "--agent", "scout-1", home=tmp_path)
    assert out.returncode == 0, out.stderr
    step = json.loads(out.stdout)
    assert 4 <= len(step["avoid"]) == cov.AVOID_MAX
    assert step["avoid"][0]["source"] == "eures" and all(set(a) == {"source", "why"} for a in step["avoid"])


# ── the UK is a rule of the plan, not a closed door ───────────────────────────────────────────────────────────────────
def _gb(plan):
    return sorted(e["slug"] for e in plan["entries"] if e["country"] == "gb")


def test_the_uk_portals_are_left_out_of_the_plan_unless_the_profile_has_the_right_to_work_there(profile):
    profile.write_text(PROFILE_SV_EN + "work_authorization:\n  - region: eu\n    status: EU citizen, free movement\n", encoding="utf-8")
    plan = cov.load_plan()
    assert _gb(plan) == [] and plan["skipped_no_work_right"] == ["gb"]
    assert "totaljobs" in {e["slug"] for g in cov.table()["groups"].values() for e in g if e.get("needs_work_right") == "gb"}
    # nothing declared: no right is assumed
    profile.write_text(PROFILE_SV_EN, encoding="utf-8")
    assert _gb(cov.load_plan()) == []
    # a UK right (top level, or under preferences) puts them back, and they are NOT closed
    for body in ("work_authorization:\n  - region: uk\n    status: settled status\n",
                 "preferences:\n  work_mode: remote\n  work_authorization:\n    - region: gb\n      status: British citizen\n",
                 "work_authorization:\n  - region: eu\n    status: Skilled Worker visa, United Kingdom\n"):
        profile.write_text(PROFILE_SV_EN + body, encoding="utf-8")
        plan = cov.load_plan()
        assert _gb(plan) == ["linkedin", "reed", "totaljobs"] and plan["skipped_no_work_right"] == [], body
        assert all(e["access"] == "search" for e in plan["entries"] if e["country"] == "gb")


def test_a_profile_that_cannot_be_read_gives_no_work_right(tmp_path):
    assert cov.work_rights(tmp_path / "nothing.yml") == frozenset()
    broken = tmp_path / "p.yml"
    broken.write_text("work_authorization: [unclosed", encoding="utf-8")
    assert cov.work_rights(broken) == frozenset()


def test_jobspresso_stays_open_with_its_robots_rule_written_in_the_hint():
    """Its robots.txt disallows only the URLs with a query string (`Disallow: /*?`): the category pages are allowed, so the portal is
    not closed; the hint says what the Scout must not open."""
    by = {(e["slug"], e["country"]): e for g in cov.table()["groups"].values() for e in g}
    entry = by[("jobspresso", "remote")]
    assert entry["access"] == "search" and "query string" in entry["hint"] and "right to work" in entry["hint"]
