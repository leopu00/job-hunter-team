"""The Assistente's questionnaire as cards: the tool posts one card at a time, reads the person's own click and
writes what the choice says into the profile. The data file and the words are checked by
test_onboarding_questionnaire.py; here the tool that runs them."""

from __future__ import annotations

import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from test_agent_questions import ROOT, aq, box, sql  # noqa: F401  (box is a fixture)

TOOL = ROOT / "shared" / "skills" / "onboarding_questionnaire.py"
LOCALES = ROOT / "shared" / "locales"
QUESTIONS = "SELECT agent, source_id, source_payload FROM pending_user_messages WHERE source_action = 'agent_question'"
PROFILE = "profile/candidate_profile.yml"


def run(box, *args: str, lang: str | None = None, data: Path | None = None) -> tuple[int, dict]:
    env = dict(box.env)
    env["PYTHONPATH"] = str(Path(yaml.__file__).resolve().parent.parent)
    if lang:
        env["JHT_LANG"] = lang
    if data:
        env["JHT_QUESTIONNAIRE_DATA"] = str(data)
    done = subprocess.run([sys.executable, str(TOOL), *args], capture_output=True, text=True, env=env, timeout=120)
    assert done.stdout.strip(), done.stderr
    return done.returncode, json.loads(done.stdout)


def ok(box, *args: str, **kw) -> dict:
    code, out = run(box, *args, **kw)
    assert code == 0 and out["ok"], out
    return out


def click(box, question_id: str, *choices: str) -> None:
    with sqlite3.connect(box.db, timeout=10) as conn:
        aq.record_answer(conn, question_id, list(choices), canale="desktop")


def cards(box) -> list[dict]:
    return [dict(agent=a, id=i, payload=json.loads(p)) for a, i, p in sql(box, QUESTIONS)]


def profile(box) -> dict:
    return yaml.safe_load((box.home / PROFILE).read_text(encoding="utf-8")) or {}


def put_profile(box, **fields) -> None:
    path = box.home / PROFILE
    path.parent.mkdir(exist_ok=True)
    # no target role unless the test gives one: a profile that names the role settles the role step (JHT-T363)
    path.write_text(yaml.safe_dump({"name": "Test Person", **fields}), encoding="utf-8")


def answer_step(box, choice: str) -> dict:
    asked = ok(box, "ask")
    assert asked["asked"], asked
    click(box, asked["question_id"], choice)
    return ok(box, "apply")


def test_it_starts_at_the_role_and_counts_the_steps_that_apply(box):
    out = ok(box, "status")
    assert out["next"] == "role" and not out["done"] and out["answered"] == 0
    # the specialty steps of the other roles do not count until the role says which one applies
    assert out["total"] == 9


def test_ask_posts_the_card_of_the_step_in_the_persons_language(box):
    catalog = json.loads((LOCALES / "it.json").read_text(encoding="utf-8"))

    out = ok(box, "ask")

    assert out["asked"] and out["step"] == "role"
    (card,) = cards(box)
    assert card["agent"] == "assistente" and card["id"] == out["question_id"]
    assert card["payload"]["oggetto"] == catalog["onb.role.object"]
    assert card["payload"]["testo"] == catalog["onb.role.text"]
    first = card["payload"]["opzioni"][0]
    assert (first["id"], first["label"]) == ("software", catalog["onb.role.opt.software"])
    aq.validate_question_payload(card["payload"])


def test_a_second_ask_posts_nothing_while_the_first_card_has_no_answer(box):
    first = ok(box, "ask")
    second = ok(box, "ask")

    assert first["asked"] and not second["asked"] and second["open"]
    assert second["question_id"] == first["question_id"]
    assert len(cards(box)) == 1


def test_the_click_writes_the_category_and_the_next_card_is_that_roles_specialty(box):
    put_profile(box)

    done = answer_step(box, "software")

    assert done["applied"] and done["option"] == "software" and done["next"] == "specialty_sw"
    assert profile(box)["target_role_category_id"] == "software"
    assert profile(box)["name"] == "Test Person"  # what the questionnaire does not own stays
    nxt = ok(box, "ask")
    assert nxt["step"] == "specialty_sw" and len(cards(box)) == 2


def test_the_specialty_belongs_to_its_category(box):
    put_profile(box, target_specialty="ml")  # a specialty of another family: it does not settle the software one

    answer_step(box, "software")

    assert "target_specialty" not in profile(box)
    answer_step(box, "backend")
    assert profile(box)["target_specialty"] == "backend"


def test_a_role_without_its_own_specialties_goes_to_the_general_ones(box):
    put_profile(box)

    done = answer_step(box, "design")

    assert done["next"] == "specialty_gen"


def test_apply_before_the_person_answers_waits_and_writes_nothing(box):
    put_profile(box)
    ok(box, "ask")

    out = ok(box, "apply")

    assert not out["applied"] and out["waiting"]
    assert "target_role_category_id" not in profile(box)


def test_apply_without_a_card_open_does_nothing(box):
    out = ok(box, "apply")

    assert not out["applied"] and "no card" in out["reason"]


def test_an_answer_is_applied_once(box):
    put_profile(box)
    answer_step(box, "software")

    again = ok(box, "apply")

    assert not again["applied"] and again.get("already")


def test_a_choice_the_step_does_not_have_is_not_applied_by_option_flag(box):
    put_profile(box)
    asked = ok(box, "ask")
    click(box, asked["question_id"], "software")

    # the person clicked: the flag cannot change what they chose, and an id of another step names nothing
    out = ok(box, "apply", "--option", "design")

    assert out["applied"] and out["option"] == "software"
    assert profile(box)["target_role_category_id"] == "software"


def test_a_preference_is_written_as_an_item_of_the_preferences_block(box):
    put_profile(box)
    for choice in ("software", "backend", "mid"):
        answer_step(box, choice)

    answer_step(box, "employed")

    block = next(b for b in profile(box)["blocks"] if b["key"] == "preferences")
    assert block["kind"] == "key_points" and block["title"]
    catalog = json.loads((LOCALES / "it.json").read_text(encoding="utf-8"))
    assert block["content"] == [{"heading": catalog["onb.current_status.object"], "text": catalog["onb.current_status.opt.employed"]}]


def test_an_answer_that_is_not_the_persons_own_writes_nothing(box):
    put_profile(box)
    asked = ok(box, "ask")
    with sqlite3.connect(box.db) as conn:
        conn.execute(
            "UPDATE pending_user_messages SET source_payload = ? WHERE source_id = ?",
            (json.dumps({"id_domanda": asked["question_id"], "scelte": ["software"], "testo": "", "origine": "sistema", "canale": "desktop", "ts": "2026-10-29T00:00:00Z"}), "answer:" + asked["question_id"]),
        )
    out = ok(box, "apply")

    assert not out["applied"]
    assert "target_role_category_id" not in profile(box)


def test_a_data_file_cannot_write_a_field_it_is_not_allowed_to(box, tmp_path):
    data = tmp_path / "data.json"
    data.write_text(json.dumps({"steps": [{"id": "x", "key": "onb.role", "options": [
        {"id": "software", "effect": {"set": {"email": "someone@example.com"}}},
        {"id": "data", "effect": {"set": {"target_role_category_id": "data"}}}]}]}), encoding="utf-8")
    put_profile(box)
    asked = ok(box, "ask", data=data)
    click(box, asked["question_id"], "software")

    code, out = run(box, "apply", data=data)

    assert code == 1 and out == {"ok": False, "error": "field_not_allowed"}
    assert "email" not in profile(box)


def test_where_asks_the_chat_for_the_place_and_adds_the_european_places(box):
    put_profile(box)
    for choice in ("software", "backend", "mid", "employed", "remote"):
        answer_step(box, choice)

    local = answer_step(box, "local")
    assert local["ask_in_chat"], "a place only the person can name is asked in the chat, not written"
    assert "location_preferences" not in profile(box)


def test_a_whole_run_ends_done_and_a_card_is_never_posted_twice_for_a_step(box):
    put_profile(box)
    path = ["software", "backend", "senior"]
    for choice in path:
        answer_step(box, choice)
    while not ok(box, "status")["done"]:
        step = ok(box, "status")["next"]
        data = json.loads((ROOT / "shared" / "config" / "onboarding-questionnaire.json").read_text(encoding="utf-8"))
        first = next(s for s in data["steps"] if s["id"] == step)["options"][0]
        if first.get("free_text"):
            break
        answer_step(box, first["id"])
    ids = [c["id"] for c in cards(box)]
    assert len(ids) == len(set(ids))
    assert ok(box, "ask").get("asked") is not True or ok(box, "status")["next"] is not None


def test_it_resumes_where_it_stopped(box):
    put_profile(box)
    answer_step(box, "software")
    out = ok(box, "status")

    assert out["answers"] == {"role": "software"} and out["next"] == "specialty_sw" and out["answered"] == 1


def test_ask_does_not_post_the_same_step_again_while_an_answer_waits_to_be_applied(box):
    put_profile(box)
    asked = ok(box, "ask")
    click(box, asked["question_id"], "software")

    again = ok(box, "ask")

    assert not again["asked"] and again["answered"] and "apply" in again["reason"]
    assert len(cards(box)) == 1
    assert ok(box, "apply")["applied"]
    assert ok(box, "ask")["step"] == "specialty_sw"


# ── a profile that already holds the answer (03/11, burst with the least profile) ──

def steps_until_experience(box) -> None:
    for choice in ("software", "backend"):
        answer_step(box, choice)


def test_the_experience_card_is_not_asked_when_the_profile_already_has_the_years_and_the_level(box):
    put_profile(box, experience_years=9, seniority_target="senior")
    before = ok(box, "status")
    assert before["total"] == 8, before  # the step is not one of the steps that apply to this person
    steps_until_experience(box)
    out = ok(box, "status")
    assert out["next"] == "current_status", out
    asked = ok(box, "ask")
    assert asked["step"] == "current_status"


def test_with_only_one_of_the_two_the_card_is_still_asked_and_the_years_the_person_gave_are_kept(box):
    put_profile(box, experience_years=9)
    steps_until_experience(box)
    assert ok(box, "status")["next"] == "experience"
    out = answer_step(box, "mid")  # the band's own threshold is 3
    assert out["applied"] is True
    assert profile(box)["experience_years"] == 9 and profile(box)["seniority_target"] == "mid"


def test_zero_years_is_an_answer_and_blank_text_is_not(box):
    put_profile(box, experience_years=0, seniority_target="entry")
    steps_until_experience(box)
    assert ok(box, "status")["next"] == "current_status"
    put_profile(box, experience_years=0, seniority_target="  ")
    assert ok(box, "status")["next"] == "experience"


def test_the_threshold_is_written_when_the_profile_has_no_years(box):
    put_profile(box)
    steps_until_experience(box)
    answer_step(box, "senior")
    assert profile(box)["experience_years"] == 7 and profile(box)["seniority_target"] == "senior"


def test_an_unreadable_profile_skips_nothing(box):
    path = box.home / PROFILE
    path.parent.mkdir(exist_ok=True)
    path.write_text("{ not: [yaml", encoding="utf-8")
    assert ok(box, "status")["total"] == 9


# ── a card posted before the profile held the answer (T179, addendum) ──

def stale_experience_card(box, **fields) -> str:
    """The experience card open, as an older tool posted it, and the profile settling that step afterwards."""
    put_profile(box)
    steps_until_experience(box)
    asked = ok(box, "ask")
    assert asked["step"] == "experience", asked
    put_profile(box, target_role_category_id="software", target_specialty="backend", **fields)
    return asked["question_id"]


def answer_of(box, question_id: str):
    with sqlite3.connect(box.db, timeout=10) as conn:
        return aq.existing_answer(conn, question_id)


def test_the_card_of_a_step_the_profile_now_settles_is_closed_as_the_systems_answer(box):
    qid = stale_experience_card(box, experience_years=8, seniority_target="senior")

    out = ok(box, "settle")

    assert out["closed"] and out["question_id"] == qid and out["choice"] == ["senior"]
    stored = answer_of(box, qid)
    assert stored["origine"] == "sistema" and stored["scelte"] == ["senior"]
    # it is closed, not answered by the person: the profile keeps what it held
    assert profile(box)["experience_years"] == 8 and profile(box)["seniority_target"] == "senior"
    assert ok(box, "settle")["closed"] is False  # idempotent


def test_the_closing_picks_the_band_of_the_years_when_the_level_is_not_one_of_the_choices(box):
    qid = stale_experience_card(box, experience_years=9, seniority_target="staff")

    assert ok(box, "settle")["choice"] == ["senior"]
    assert answer_of(box, qid)["origine"] == "sistema"


def test_a_card_whose_step_the_profile_does_not_settle_stays_open(box):
    qid = stale_experience_card(box, experience_years=8)  # no level: the step is still asked

    out = ok(box, "settle")

    assert out["closed"] is False and "still needs" in out["reason"]
    assert answer_of(box, qid) is None


def test_a_card_the_person_already_answered_is_left_to_apply(box):
    qid = stale_experience_card(box, experience_years=8, seniority_target="senior")
    click(box, qid, "mid")

    out = ok(box, "settle")

    assert out["closed"] is False
    assert answer_of(box, qid)["origine"] == "utente"


def test_settle_with_no_card_open_does_nothing(box):
    put_profile(box, experience_years=8, seniority_target="senior")
    assert ok(box, "settle")["closed"] is False
    assert cards(box) == []


def test_the_next_card_does_not_come_while_the_old_one_stays_open(box):
    qid = stale_experience_card(box, experience_years=8, seniority_target="senior")

    asked = ok(box, "ask")

    assert asked["asked"] and asked["step"] == "current_status"
    assert answer_of(box, qid)["origine"] == "sistema"  # one open card, not two
    open_cards = [c for c in cards(box) if answer_of(box, c["id"]) is None]
    assert [c["id"] for c in open_cards] == [asked["question_id"]]


def test_the_first_card_is_posted_on_an_installation_with_no_database_and_a_failure_says_why(tmp_path):
    script = Path(__file__).resolve().parents[1] / "shared" / "skills" / "onboarding_questionnaire.py"
    home = tmp_path / "jht"
    home.mkdir()
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(home), "PYTHONDONTWRITEBYTECODE": "1"}

    def run(extra=None):
        done = subprocess.run([sys.executable, "-I", str(script), "ask"], capture_output=True, text=True, timeout=120,
                              env={**env, **(extra or {})}, check=False)
        return done.returncode, json.loads(done.stdout)

    assert not (home / "jobs.db").exists()
    code, out = run()
    assert code == 0 and out["asked"] is True and (home / "jobs.db").is_file()
    # a database that cannot be prepared: the error carries the reason, not only the code
    blocked = tmp_path / "file"
    blocked.write_text("x")
    code, out = run({"JHT_HOME": str(tmp_path / "other"), "JHT_DB": str(blocked / "jobs.db")})
    assert code == 1 and out["error"] == "card_not_posted" and out["why"]


# ── the choices the program reads, not only the person ──────────────────────────────────────────────────────────────

def _option_effect(step_id: str, option_id: str):
    data = json.loads((ROOT / "shared" / "config" / "onboarding-questionnaire.json").read_text(encoding="utf-8"))
    step = next(s for s in data["steps"] if s["id"] == step_id)
    return step, next(o for o in step["options"] if o["id"] == option_id)


@pytest.mark.parametrize("option,expected", [("remote", "remote"), ("remote_first", "remote-first"), ("hybrid", "hybrid"),
                                             ("onsite", "on-site"), ("flexible", "flexible")])
def test_the_mode_card_writes_preferences_work_mode_besides_the_item_the_person_reads(option, expected):
    sys.path.insert(0, str(ROOT / "shared" / "skills"))
    import onboarding_questionnaire as oq
    step, chosen = _option_effect("mode", option)
    profile: dict = {"name": "Test Person"}
    oq.write_effect(profile, step, chosen, lambda key: key)
    # what the Scout's plan reads (a profile with only the text item has no work mode: the remote boards came for a person on site)
    assert profile["preferences"]["work_mode"] == expected
    block = next(b for b in profile["blocks"] if b["key"] == "preferences")
    assert block["content"][0]["text"] == "onb.mode.opt." + option


@pytest.mark.parametrize("option,expected", [("never", False), ("eu", True), ("worldwide", True), ("sponsored", True)])
def test_the_relocation_card_writes_preferences_relocation(option, expected):
    sys.path.insert(0, str(ROOT / "shared" / "skills"))
    import onboarding_questionnaire as oq
    step, chosen = _option_effect("relocation", option)
    profile: dict = {"preferences": {"work_mode": "on-site"}}
    oq.write_effect(profile, step, chosen, lambda key: key)
    assert profile["preferences"] == {"work_mode": "on-site", "relocation": expected}


@pytest.mark.parametrize("option", ["same_country", "depends"])
def test_a_relocation_answer_that_is_not_a_yes_or_a_no_writes_no_field(option):
    # unset is never assumed to be a yes: the Scout keeps to the person's own country
    sys.path.insert(0, str(ROOT / "shared" / "skills"))
    import onboarding_questionnaire as oq
    step, chosen = _option_effect("relocation", option)
    profile: dict = {}
    oq.write_effect(profile, step, chosen, lambda key: key)
    assert "preferences" not in profile and any(b["key"] == "preferences" for b in profile["blocks"])


def test_a_preferences_that_is_not_a_mapping_is_refused_and_a_field_outside_the_list_is_not_written():
    sys.path.insert(0, str(ROOT / "shared" / "skills"))
    import onboarding_questionnaire as oq
    step, chosen = _option_effect("mode", "onsite")
    with pytest.raises(oq.QuestionnaireError):
        oq.write_effect({"preferences": "on site"}, step, chosen, lambda key: key)
    with pytest.raises(oq.QuestionnaireError):
        oq.write_effect({}, step, {"id": "x", "effect": {"preference_field": {"salary_annual_eur": "1"}}}, lambda key: key)


# ── JHT-T363: a step the profile already answers is never asked, whatever the person's language ──────────────────────
# A made-up profile confirmed from a CV and a full document: the roles in order, the years and the level, the work mode, the
# places, a yes to moving, a pay target, and the items of the «preferences» block the questionnaire would write (current
# status, contract, company) with their question in the person's language as the heading.
LANGS = ("en", "it", "de", "es", "fr", "pt", "hu")


def _block_items(lang: str) -> list[dict]:
    catalog = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
    return [{"heading": catalog[f"onb.{step}.object"], "text": catalog[f"onb.{step}.opt.{choice}"]}
            for step, choice in (("current_status", "active"), ("contract", "permanent"), ("company", "established"))]


def test_the_steps_to_read_are_asked_only_before_the_profile_is_built(box):
    put_profile(box, target_specialty="backend")  # no role and no place yet: the whole questionnaire, as before
    assert ok(box, "status")["total"] == 9
    put_profile(box, target_role="Data Analyst", location="Valencia, Spain")
    out = ok(box, "status")
    assert out["next"] == "experience" and out["total"] == 4, out  # experience, mode, relocation, salary (the place settles where)


def _full_profile(lang: str) -> dict:
    return {
        "target_role": "Data Analyst", "target_roles_priority": ["Data Analyst", "BI Analyst"], "location": "Valencia, Spain",
        "experience_years": 11, "seniority_target": "lead", "location_preferences": ["Valencia, Spain", "Remote EU"],
        "preferences": {"work_mode": "hybrid", "relocation": False, "salary_annual_eur": "38000 EUR gross"},
        "blocks": [{"key": "preferences", "title": "Preferences", "kind": "key_points", "content": _block_items(lang)}],
    }


@pytest.mark.parametrize("lang", LANGS)
def test_a_full_profile_asks_no_card_in_any_language(box, lang):
    put_profile(box, **_full_profile(lang))
    out = ok(box, "status", lang=lang)
    assert out["done"] and out["next"] is None and out["total"] == 0, out
    asked = ok(box, "ask", lang=lang)
    assert asked["asked"] is False and asked["done"] is True, asked
    assert cards(box) == []


def test_a_partial_profile_asks_only_what_is_missing(box):
    # the role, the years, the mode and the places are known; nothing about moving, pay, status, contract or company
    put_profile(box, target_role="Data Analyst", experience_years=4, seniority_target="mid", location="Valencia, Spain",
                preferences={"work_mode": "remote"})
    out = ok(box, "status")
    # after the profile: only what the search needs, never the steps that write an item to read (status, contract, company)
    assert out["next"] == "relocation" and out["total"] == 2, out
    seen = []
    while True:
        asked = ok(box, "ask")
        if not asked["asked"]:
            break
        seen.append(asked["step"])
        step_options = {"current_status": "active", "relocation": "never", "contract": "permanent", "salary": "market",
                        "company": "established"}
        click(box, asked["question_id"], step_options[asked["step"]])
        ok(box, "apply")
    assert seen == ["relocation", "salary"]
    # never the family of roles: the person named the role already
    assert "role" not in seen and not [c for c in cards(box) if "role" in json.dumps(c["payload"]).lower() and "famil" in json.dumps(c["payload"]).lower()]


def test_a_relocation_no_is_an_answer_and_an_empty_list_is_not():
    import importlib.util
    spec = importlib.util.spec_from_file_location("oq_t363", TOOL)
    oq = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(oq)
    steps = {s["id"]: s for s in oq.load_steps()}
    assert oq._known(steps["relocation"], {"preferences": {"relocation": False}})
    assert not oq._known(steps["where"], {"location_preferences": []})
    assert oq._known(steps["role"], {"target_roles_priority": ["Designer"]})
    # a specialty of another family does not settle this one
    assert not oq._known(steps["specialty_sw"], {"target_specialty": "ml"})
    assert oq._known(steps["specialty_data"], {"target_specialty": "ml"})
