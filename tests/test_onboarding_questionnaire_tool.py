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
    path.write_text(yaml.safe_dump({"name": "Test Person", "target_role": "Backend engineer", **fields}), encoding="utf-8")


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
    assert profile(box)["target_role"] == "Backend engineer"  # what the questionnaire does not own stays
    nxt = ok(box, "ask")
    assert nxt["step"] == "specialty_sw" and len(cards(box)) == 2


def test_the_specialty_belongs_to_its_category(box):
    put_profile(box, target_role_category_id="data", target_specialty="ml")

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
