"""scout_language.py: the countries to search for a profile's languages, and the cut by language BEFORE the ad is opened.

All texts here are written for the test (no real ad, no real profile). The rule that matters most is the one against
dropping a good candidate: every case where the profile speaks the language, the ad is in English, the language is only
a plus, or the text is too short to say, must NOT be dropped.
"""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS = REPO_ROOT / "shared" / "skills"


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


sl = _load("scout_language_under_test", SKILLS / "scout_language.py")

# Swedish native, English fluent, three beginner languages: the profile the numbers came from, rewritten.
SV_EN = {"sv": 5, "en": 4, "es": 1, "fr": 1, "hu": 1}
EN_ONLY = {"en": 5}
DE_EN = {"de": 4, "en": 4}


def _verdict(title, snippet="", spoken=SV_EN):
    return sl.screen(title, snippet, spoken)


# ── the profile ──────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("level,score", [
    ("native", 5), ("Madrelingua", 5), ("mother tongue", 5), ("C2", 5), ("bilingual", 5),
    ("fluent", 4), ("C1", 4), ("advanced", 4), ("professional working proficiency", 4), ("Fliessend", 4),
    ("B2", 4), ("upper intermediate", 4), ("intermediate", 4),
    ("conversational", 1), ("beginner", 1), ("A2", 1), ("basic", 1), ("B1", 1),
    ("something nobody wrote before", 3), ("", 3),
])
def test_levels_are_read_in_the_words_people_write_and_unknown_gets_the_benefit_of_the_doubt(level, score):
    assert sl.level_score(level) == score


def test_the_profile_languages_are_read_in_any_of_their_names(tmp_path):
    path = tmp_path / "candidate_profile.yml"
    path.write_text("languages:\n  - language: Svedese\n    level: madrelingua\n  - language: English\n    level: C1\n"
                    "  - language: Español\n    level: beginner\n  - language: Nederlands\n    level: B1\n"
                    "  - language: Klingon\n    level: native\n", encoding="utf-8")
    assert sl.read_languages(path) == {"sv": 5, "en": 4, "es": 1, "nl": 1}


def test_a_missing_or_broken_profile_gives_no_languages_and_so_never_a_drop(tmp_path):
    assert sl.read_languages(tmp_path / "none.yml") == {}
    broken = tmp_path / "broken.yml"
    broken.write_text("languages: [unclosed", encoding="utf-8")
    assert sl.read_languages(broken) == {}
    assert sl.screen("Backend-Entwickler (m/w/d)", "Wir suchen einen Entwickler fuer unser Team und Sie arbeiten mit uns",
                     {}) == {"verdict": "unknown", "reason": "no_profile_languages"}


# ── the plan ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_plan_puts_local_first_then_english_friendly_then_english_only():
    plan = sl.plan(SV_EN)
    modes = {c: v["mode"] for c, v in plan["countries"].items()}
    assert modes["se"] == "local" and modes["gb"] == "local" and modes["ie"] == "local"
    assert modes["nl"] == "english_friendly" and modes["dk"] == "english_friendly" and modes["pt"] == "english_friendly"
    assert modes["de"] == "english_only" and modes["fr"] == "english_only" and modes["hu"] == "english_only"
    rank = {"local": 0, "english_friendly": 1, "english_only": 2}
    assert [rank[modes[c]] for c in plan["order"]] == sorted(rank[modes[c]] for c in plan["order"])
    assert plan["spoken"] == ["en", "sv"] and plan["english"] is True


def test_the_plan_excludes_nothing_it_only_orders_and_gives_the_query_qualifiers():
    plan = sl.plan(SV_EN)
    assert set(plan["order"]) == set(plan["countries"]) == set(sl.COUNTRY_LANGUAGES)
    assert all(v["mode"] in ("local", "english_friendly", "english_only") for v in plan["countries"].values())
    assert plan["countries"]["nl"]["qualifiers"] == ["English-speaking", "international team", "English required"]
    assert "qualifiers" not in plan["countries"]["se"]


def test_a_profile_without_english_has_no_english_friendly_country():
    plan = sl.plan({"de": 5})
    assert plan["countries"]["de"]["mode"] == "local" and plan["countries"]["at"]["mode"] == "local"
    assert plan["countries"]["ch"]["mode"] == "local", "Swiss German counts: German is one of its working languages"
    assert plan["countries"]["nl"]["mode"] == "english_only" and plan["english"] is False


def test_a_language_below_business_level_does_not_make_a_country_local():
    assert sl.plan({"en": 4, "nl": 1})["countries"]["nl"]["mode"] == "english_friendly"


# ── dropping an ad by language ───────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("title,snippet,code", [
    ("Data Analyst", "Native German speaker required. You will work with our data team on the reports.", "de"),
    ("Software Engineer", "We build the platform together with the product team. Fluent Czech is required.", "cs"),
    ("Support", "Fluent in French mandatory. The role is based in Paris and reports to the head of support.", "fr"),
    ("Customer Success", "Deutschkenntnisse erforderlich. Join our team in Munich.", "de"),
    ("Analyst", "Sie sprechen fliessend Deutsch. Join us.", "de"),
    ("Account Manager", "Moedertaal Nederlands is een must. You report to the sales director.", "nl"),
    ("Sales", "Bilingual Spanish and English, Spanish at C2 level, for the Madrid office.", "es"),
])
def test_an_explicit_requirement_of_a_language_the_profile_does_not_speak_is_dropped(title, snippet, code):
    spoken = {"sv": 5, "en": 4}
    got = _verdict(title, snippet, spoken)
    assert got["verdict"] == "skip_language" and got["reason"] == "required_language" and code in got["languages"], got


@pytest.mark.parametrize("snippet", [
    "Fluent German or English required. You will work with our data team.",
    "Fluent English required, German is a plus. You will work with our data team.",
    "Good knowledge of Czech is a plus. You will work with our data team and our customers every day.",
    "Python is a plus. Fluent Swedish is required.",
    "A Czech company, English required. We ship every week and care about quality.",
    "Our German customers love the product. You work in English with the whole team.",
    "The team sits in Berlin and works in English. German-speaking colleagues will help you settle in.",
    "Czech Railways style punctuality, but we are a small English-speaking startup with a flat structure.",
    "Our Portugal office needs fluent English and a strong sense of ownership of the product.",
    "Roman is the founder; the team writes fluent English documentation and runs weekly demos.",
    "Fluent English required for the Francia and Italia accounts that we run from our office.",
])
def test_an_alternative_a_plus_or_a_mention_that_asks_for_nothing_is_not_dropped(snippet):
    assert _verdict("Software Engineer", snippet, {"sv": 5, "en": 4})["verdict"] != "skip_language"


def test_a_requirement_for_a_language_the_profile_speaks_is_never_a_drop():
    assert _verdict("Engineer", "Native German speaker required. We work with the data team.", DE_EN)["verdict"] != "skip_language"
    assert _verdict("Engineer", "Fluent Swedish is required. We work with the product team.", SV_EN)["verdict"] != "skip_language"


@pytest.mark.parametrize("title,snippet,language", [
    ("Backend-Entwickler (m/w/d)", "Wir suchen zum nächstmöglichen Zeitpunkt einen Entwickler für unser Team in Berlin. Sie arbeiten mit uns an der Plattform und sind verantwortlich für die Entwicklung.", "de"),
    ("Ontwikkelaar", "Wij zijn op zoek naar een ontwikkelaar voor ons team. Je werkt met ons aan de nieuwe applicatie en je bent verantwoordelijk voor de kwaliteit van de code.", "nl"),
    ("Développeur", "Nous recherchons un développeur pour rejoindre notre équipe. Vous travaillerez avec nous sur la plateforme et vous serez responsable de la qualité.", "fr"),
    ("Desarrollador", "Buscamos un desarrollador para nuestro equipo. Trabajarás con nosotros en la plataforma y serás responsable de la calidad del código que se entrega.", "es"),
    ("Sviluppatore", "Cerchiamo uno sviluppatore per il nostro team. Lavorerai con noi sulla piattaforma e sarai responsabile della qualità del codice che consegniamo.", "it"),
    ("Programista", "Poszukujemy programisty do naszego zespołu. Będziesz pracować z nami nad platformą i jest to praca dla osób, które lubią nasze podejście oraz nowe wyzwania.", "pl"),
])
def test_an_ad_written_in_a_language_the_profile_does_not_speak_is_dropped(title, snippet, language):
    got = _verdict(title, snippet, {"sv": 5, "en": 4})
    assert got["verdict"] == "skip_language" and got["languages"] == [language], got


def test_an_english_ad_a_spoken_language_ad_and_a_short_text_are_never_dropped():
    english = ("We are looking for a software engineer to join our team. You will work on our platform with the product "
               "team and ship features every week. Your experience with Python and the cloud is important for us.")
    assert _verdict("Software Engineer", english)["verdict"] == "ok"
    swedish = ("Vi söker en utvecklare till vårt team. Du kommer att arbeta med vår plattform och ansvara för kvaliteten "
               "i det vi levererar. Du har erfarenhet av Python och molnet och vill vara med och bygga.")
    assert _verdict("Utvecklare", swedish)["verdict"] != "skip_language"
    assert _verdict("Entwickler", "Berlin, Vollzeit")["verdict"] == "unknown"
    assert _verdict("Software Engineer")["verdict"] == "unknown"


def test_a_mixed_text_that_does_not_clearly_belong_to_one_language_is_not_dropped():
    mixed = ("We are looking for a developer. Wir suchen einen Entwickler. You work with our team, und Sie arbeiten mit uns "
             "an der Plattform. Join us in Berlin where the team works with the product.")
    assert _verdict("Developer", mixed)["verdict"] != "skip_language"


def test_a_title_alone_is_weak_evidence_for_an_english_speaking_profile():
    assert _verdict("Softwareentwickler")["verdict"] == "unknown"
    assert _verdict("Software Entwickler Python")["verdict"] == "unknown"
    assert _verdict("Backend Developer (m/w/d)")["verdict"] == "unknown", "an English job word beside the mark"
    got = _verdict("Senior Entwickler Ingenieur (m/w/d)")
    assert got["verdict"] == "skip_language" and got["reason"] == "title_language" and got["languages"] == ["de"]


def test_a_title_alone_in_a_language_the_profile_has_not_is_dropped_when_it_has_no_english():
    assert _verdict("Entwickler", spoken={"sv": 5})["verdict"] == "skip_language"
    assert _verdict("Entwickler", spoken={"sv": 5, "de": 4})["verdict"] != "skip_language"


def test_the_answer_is_codes_only_and_never_echoes_the_text():
    title = "Zeer vertrouwelijke functietitel voor Mevrouw Voorbeeld"
    snippet = "Moedertaal Nederlands is een must voor deze rol bij Voorbeeld BV in Utrecht"
    out = json.dumps(_verdict(title, snippet, {"en": 4}))
    for word in ("vertrouwelijke", "Voorbeeld", "Utrecht", "Mevrouw"):
        assert word not in out
    assert set(json.loads(out)) <= {"verdict", "reason", "languages"}


# ── the command ──────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def home(tmp_path):
    (tmp_path / "profile").mkdir()
    (tmp_path / "profile" / "candidate_profile.yml").write_text(
        "languages:\n  - language: Swedish\n    level: native\n  - language: English\n    level: fluent\n", encoding="utf-8")
    return tmp_path


def _run(home, *argv):
    env = {**os.environ, "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1"}
    return subprocess.run([sys.executable, "-I", str(SKILLS / "scout_language.py"), *argv], env=env,
                          capture_output=True, text=True, timeout=60)


def test_the_command_exits_10_on_a_drop_and_0_otherwise(home):
    drop = _run(home, "screen", "--title", "Data Analyst", "--snippet", "Native German speaker required. You work with the data team.")
    assert drop.returncode == 10 and json.loads(drop.stdout)["verdict"] == "skip_language"
    keep = _run(home, "screen", "--title", "Data Analyst", "--snippet", "Fluent English required. You work with the data team.")
    assert keep.returncode == 0 and json.loads(keep.stdout)["verdict"] in ("ok", "unknown")
    plan = json.loads(_run(home, "plan").stdout)
    assert plan["countries"]["se"]["mode"] == "local" and plan["countries"]["de"]["mode"] == "english_only"


def test_a_dropped_candidate_is_written_to_the_pass_log_as_language_and_not_opened(home):
    done = _run(home, "screen", "--title", "Data Analyst", "--snippet", "Native German speaker required for the team.",
                "--source", "greenhouse", "--country", "de", "--log")
    assert done.returncode == 10
    log = home / "logs" / "scout-passes.jsonl"
    (line,) = [json.loads(l) for l in log.read_text(encoding="utf-8").splitlines()]
    assert (line["kind"], line["source"], line["country"], line["outcome"], line["opened"]) == (
        "candidate", "greenhouse", "de", "language", False)
    assert "German" not in log.read_text(encoding="utf-8")
    # an ad that is kept leaves no line
    _run(home, "screen", "--title", "Data Analyst", "--snippet", "English only. You work with the data team.", "--log")
    assert len(log.read_text(encoding="utf-8").splitlines()) == 1


def test_a_log_that_cannot_be_written_does_not_change_the_answer(home):
    (home / "logs").write_text("a file where the folder should be", encoding="utf-8")
    done = _run(home, "screen", "--title", "Data Analyst", "--snippet", "Native German speaker required for the team.",
                "--source", "greenhouse", "--log")
    assert done.returncode == 10 and json.loads(done.stdout)["verdict"] == "skip_language"


# ── the Scout's prompts in the seven languages carry the three rules of this work ──────────────────────────────────
@pytest.mark.parametrize("suffix", ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"])
def test_every_scout_prompt_names_the_measure_the_language_gate_and_the_linkedin_wait(suffix):
    text = (REPO_ROOT / "agents" / "scout" / ("scout%s.md" % suffix)).read_text(encoding="utf-8")
    for needle in ("scout-pass-log", "scout-language-gate", "scout_language.py plan", "scout_language.py screen",
                   '"rate_limited": true', "http_429|cooldown|request_cap", "retry_at", "40"):
        assert needle in text, "%s is missing %r" % (suffix or "en", needle)
    listed = (REPO_ROOT / "agents" / "scout" / "skills.list").read_text(encoding="utf-8").split()
    assert "scout-pass-log" in listed and "scout-language-gate" in listed


# ── the job boards written in the language of their country ────────────────────────────────────────────────────────
@pytest.mark.parametrize("source,country", [
    ("jobs.ch", "ch"), ("Jobs.ch", "ch"), ("jobup", "ch"), ("jobscout24", "ch"), ("jobnet", "dk"), ("jobindex", "dk"),
    ("stepstone-de", "de"), ("StepStone DE", "de"), ("profession.hu", "hu"), ("infojobs", "es"),
])
def test_a_local_language_portal_the_profile_cannot_read_is_skipped(source, country):
    got = sl.portal_verdict(source, country, SV_EN)
    assert got["verdict"] == "skip" and got["reason"] == "local_language_required" and got["languages"], got


@pytest.mark.parametrize("source,country", [("jobbsafari", "se"), ("arbetsformedlingen-se", "se"), ("Arbetsformedlingen SE", "se")])
def test_a_local_language_portal_in_a_language_the_profile_speaks_is_searched(source, country):
    assert sl.portal_verdict(source, country, SV_EN)["verdict"] == "search"


def test_the_same_portal_is_searched_by_a_profile_that_speaks_one_of_its_languages():
    assert sl.portal_verdict("jobs.ch", "ch", {"fr": 4, "en": 4})["verdict"] == "search", "French is one of its three"
    assert sl.portal_verdict("jobs.ch", "ch", {"it": 5})["verdict"] == "search"
    assert sl.portal_verdict("jobup", "ch", {"de": 5, "en": 4})["verdict"] == "skip", "jobup is in French"


def test_eures_is_judged_by_the_country_it_is_searched_in():
    assert sl.portal_verdict("EURES", "pt", SV_EN)["verdict"] == "skip"
    assert sl.portal_verdict("eures", "de", SV_EN)["verdict"] == "skip"
    assert sl.portal_verdict("eures", "se", SV_EN)["verdict"] == "search"
    assert sl.portal_verdict("eures", "gb", SV_EN)["verdict"] == "search", "English is a working language there"
    assert sl.portal_verdict("eures", "", SV_EN) == {"verdict": "unknown", "reason": "country_needed"}


@pytest.mark.parametrize("source", ["greenhouse", "lever", "ashby", "workday", "smartrecruiters", "teamtailor", "linkedin",
                                    "a-portal-nobody-listed", "ofir"])
def test_ats_lists_linkedin_and_unknown_portals_are_never_excluded(source):
    assert sl.portal_verdict(source, "nl", SV_EN) == {"verdict": "unknown", "reason": "not_in_table"}


def test_without_the_profile_languages_no_portal_is_excluded():
    assert sl.portal_verdict("jobs.ch", "ch", {})["verdict"] == "unknown"


def test_the_plan_lists_the_portals_and_eures_by_country():
    plan = sl.plan(SV_EN)
    assert plan["portals"]["jobs-ch"] == "skip" and plan["portals"]["jobbsafari"] == "search"
    assert plan["eures"]["pt"] == "skip" and plan["eures"]["se"] == "search"
    assert set(plan["eures"]) == set(sl.COUNTRY_LANGUAGES)


def test_the_portal_command_exits_10_on_skip(home):
    skip = _run(home, "portal", "--source", "jobs.ch", "--country", "ch")
    assert skip.returncode == 10 and json.loads(skip.stdout)["verdict"] == "skip"
    keep = _run(home, "portal", "--source", "jobbsafari", "--country", "se")
    assert keep.returncode == 0 and json.loads(keep.stdout)["verdict"] == "search"
    assert _run(home, "portal", "--source", "greenhouse").returncode == 0


# ── the sources the Scout is told to leave alone ────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("suffix", ["", ".it", ".es", ".fr", ".de", ".hu", ".pt"])
def test_the_scout_is_told_403_closes_a_source_and_the_ats_are_read_per_company(suffix):
    prompt = (REPO_ROOT / "agents" / "scout" / ("scout%s.md" % suffix)).read_text(encoding="utf-8")
    skill = (REPO_ROOT / "agents" / "_skills" / "circles-and-sources" / ("SKILL%s.md" % suffix)).read_text(encoding="utf-8")
    for text in (prompt, skill):
        assert "**403**" in text and "Email-first sourcing" in text
        for ats in ("Greenhouse", "Ashby", "Workable", "Personio", "Teamtailor", "Recruitee", "Jobvite"):
            assert ats in text
    tiers = [l for l in skill.splitlines() if l.startswith("| 2 ") or l.startswith("| `on-site`")]
    assert tiers and not any("Indeed" in l or "Glassdoor" in l for l in tiers), "the two are not on the lists of direct search"
