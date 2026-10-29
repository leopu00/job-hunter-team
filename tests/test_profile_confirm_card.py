"""In the app's chat the profile read from a CV is confirmed with a card, never with «press the panel».

TEST 15 (CV in the attachments folder): the Assistente read the PDF and filled the profile, then told the person to
«press Confirm and save in the panel». The chat of the first run has no panel: the person looked for a button that
was not there for four minutes. Now `profile_review.py ask-confirm` posts one card with a readable summary (what the
CV did not say marked as deduced) and two buttons, and `apply-confirmed` saves the review only when the person's own
answer to that card says confirm. Words never save; they get a one-line answer and, if the card is gone, a new card.
"""

from __future__ import annotations

import json
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from test_agent_questions import ROOT, aq, box, sql  # noqa: F401  (box is a fixture)

HELPER = ROOT / "shared" / "skills" / "profile_review.py"
LOCALES = ROOT / "shared" / "locales"
LANGS = ("en", "it", "es", "fr", "de", "hu", "pt")
SUFFIX = {"en": "", "it": ".it", "es": ".es", "fr": ".fr", "de": ".de", "hu": ".hu", "pt": ".pt"}
QUESTIONS = "SELECT agent, source_id, source_payload FROM pending_user_messages WHERE source_action = 'agent_question'"
EMAIL = "ada.test@example.invalid"


def patch(**over) -> dict:
    value = {
        "name": "Ada Test",
        "email": EMAIL,
        "target_role": "Data Engineer",
        "location": "Milano",
        "experience_years": 7,
        "seniority_target": "senior",
        "skills": {"primary": ["Python", "SQL", "Airflow"]},
        "languages": [{"language": "Italian", "level": "native"}],
    }
    value.update(over)
    return value


def stage(box, value: dict | None = None) -> dict:
    agent = box.home / "agents" / "assistente"
    agent.mkdir(parents=True, exist_ok=True)
    (agent / "profile-review.yml").write_text(yaml.safe_dump(value or patch(), allow_unicode=True), encoding="utf-8")
    rc, out = tool(box, "stage")
    assert rc == 0, out
    return out["review"]


def tool(box, *args: str, lang: str | None = None) -> tuple[int, dict]:
    env = dict(box.env)
    env["PYTHONPATH"] = str(Path(yaml.__file__).resolve().parent.parent)
    env["JHT_AGENT_DIR"] = str(box.home / "agents" / "assistente")
    if lang:
        env["JHT_LANG"] = lang
    done = subprocess.run([sys.executable, str(HELPER), *args], capture_output=True, text=True, env=env, timeout=120)
    assert done.stdout.strip(), done.stderr
    return done.returncode, json.loads(done.stdout)


def cards(box) -> list[dict]:
    return [dict(agent=a, id=i, payload=json.loads(p)) for a, i, p in sql(box, QUESTIONS)]


def answer(box, question_id: str, *choices: str) -> None:
    with sqlite3.connect(box.db, timeout=10) as conn:
        aq.record_answer(conn, question_id, list(choices), canale="desktop")


def profile_file(box) -> Path:
    return box.home / "profile" / "candidate_profile.yml"


def ask(box, inferred: str = "", lang: str | None = None) -> dict:
    args = ["ask-confirm"] + (["--inferred", inferred] if inferred else [])
    rc, out = tool(box, *args, lang=lang)
    assert rc == 0, out
    return out["card"]


# ── the card ─────────────────────────────────────────────────────────────────

def test_the_card_has_the_summary_the_deduced_marks_and_the_two_buttons(box):
    stage(box)

    posted = ask(box, "seniority_target,target_role")

    assert posted["asked"] is True
    (card,) = cards(box)
    assert card["agent"] == "assistente" and card["id"] == posted["question_id"]
    assert [o["id"] for o in card["payload"]["opzioni"]] == ["confirm", "correct"]
    assert [o["label"] for o in card["payload"]["opzioni"]] == ["Conferma e salva", "Voglio correggere qualcosa"]
    assert card["payload"]["libera"] is False and card["payload"]["multipla"] is False
    text = card["payload"]["testo"]
    assert "Data Engineer" in text and "senior" in text and "Milano" in text and "7 anni" in text
    assert "Python, SQL, Airflow" in text and "Italian (native)" in text
    lines = {line.split(":")[0].lstrip("- "): line for line in text.splitlines() if line.startswith("- ")}
    assert "dedotto" in lines["Ruolo che cerchi"] and "dedotto" in lines["Seniority"]
    assert "dedotto" not in lines["Città"] and "dedotto" not in lines["Esperienza"]


def test_the_card_never_names_a_panel_and_never_carries_the_email(box):
    stage(box)
    ask(box)

    (card,) = cards(box)
    everything = json.dumps(card["payload"], ensure_ascii=False).lower()
    assert "pannello" not in everything and "panel" not in everything
    assert EMAIL not in everything and "ada test" not in everything


def test_a_preference_the_eight_fields_do_not_carry_is_said_by_its_name_in_words_and_marked(box):
    stage(box, patch(location_preferences=["Milan", "remote"]))

    ask(box, "location_preferences")

    (card,) = cards(box)
    line = next(l for l in card["payload"]["testo"].splitlines() if l.startswith("- Location preferences"))
    assert "Milan, remote" in line and "dedotto" in line


WORK_AUTH_TEXT = "{'region': 'EU', 'status': 'Italian citizen - free movement'}"


@pytest.mark.parametrize("held", [{"region": "EU", "status": "Italian citizen - free movement"}, WORK_AUTH_TEXT, json.dumps({"region": "EU", "status": "Italian citizen - free movement"})])
def test_a_record_the_profile_holds_is_said_in_words_in_the_language_of_the_person(box, held):
    # the profile file may hold the record as a mapping, as the text str() writes (single quotes) or as JSON
    stage(box, patch(work_authorization=held))

    ask(box, "work_authorization", lang="it")

    (card,) = cards(box)
    catalog = json.loads((LOCALES / "it.json").read_text(encoding="utf-8"))
    lines = [l for l in card["payload"]["testo"].splitlines() if "Italian citizen" in l]
    assert lines == [f"- {catalog['profile_confirm.field.work_authorization']}: Italian citizen - free movement (EU) ({catalog['profile_confirm.deduced']})"]
    text = card["payload"]["testo"]
    assert "{" not in text and "'region'" not in text and "work_authorization" not in text


def test_the_exact_line_of_the_collaudo_is_said_in_english_with_the_deduced_mark(box):
    stage(box, patch(work_authorization=WORK_AUTH_TEXT))

    ask(box, "work_authorization", lang="en")

    (card,) = cards(box)
    assert "- Work authorization: Italian citizen - free movement (EU) (deduced by me, it is not in your CV)" in card["payload"]["testo"].splitlines()


def test_another_flat_record_is_said_as_pairs(box):
    stage(box, patch(notice_period={"weeks": 4, "remote": True}))
    ask(box, "notice_period", lang="en")
    assert "- Notice period: Remote: True, Weeks: 4 (deduced by me, it is not in your CV)" in cards(box)[0]["payload"]["testo"].splitlines()


def _profile_review_module():
    import importlib

    for path in (str(Path(yaml.__file__).resolve().parent.parent), str(HELPER.parent), str(HELPER.parent.parent)):
        if path not in sys.path:
            sys.path.insert(0, path)
    return importlib.import_module("profile_review")


@pytest.mark.parametrize("text", ["{[]: 1}", "{{}: 1}", "{'a': [1]}", "{'a': {'b': 1}}", "{'a'", "{}", "{1: 2}"])
def test_a_text_that_is_not_a_flat_record_is_none_and_never_a_traceback(text):
    # a key that cannot be hashed makes ast.literal_eval raise TypeError: the card must still go
    assert _profile_review_module()._flat_record(text) is None


def test_a_card_whose_deduced_value_is_such_a_text_still_goes_with_the_text_as_it_is(box):
    stage(box, patch(work_authorization="{[]: 1}"))

    ask(box, "work_authorization", lang="en")

    (card,) = cards(box)
    assert "- Work authorization: {[]: 1} (deduced by me, it is not in your CV)" in card["payload"]["testo"].splitlines()


def test_what_is_still_missing_is_on_the_card_and_the_card_still_goes(box):
    stage(box, patch(experience_years=None, languages=[]))

    ask(box)

    (card,) = cards(box)
    text = card["payload"]["testo"]
    assert "Mancano ancora" in text and "Esperienza" in text.split("Mancano ancora")[1] and "Lingue" in text.split("Mancano ancora")[1]


def test_a_name_that_is_not_a_field_of_the_review_is_refused_and_nothing_is_posted(box):
    stage(box)

    rc, out = tool(box, "ask-confirm", "--inferred", "seniorty_target")

    assert (rc, out) == (1, {"ok": False, "error": "inferred_unknown"}) and cards(box) == []


def test_without_a_review_waiting_or_with_a_stale_one_no_card_is_posted(box):
    assert tool(box, "ask-confirm") == (1, {"ok": False, "error": "no_review"})
    stage(box)
    profile_file(box).write_text("name: Someone Else\n", encoding="utf-8")  # the profile changed after the review

    assert tool(box, "ask-confirm") == (1, {"ok": False, "error": "stale"}) and cards(box) == []


def test_a_second_call_while_the_card_is_open_posts_nothing_and_says_so(box):
    stage(box)
    first = ask(box)

    again = ask(box)

    assert again["asked"] is False and again["open"] is True and again["question_id"] == first["question_id"]
    assert len(cards(box)) == 1


def test_after_correct_a_new_card_goes_for_the_same_review(box):
    stage(box)
    first = ask(box)
    answer(box, first["question_id"], "correct")

    again = ask(box)

    assert again["asked"] is True and again["question_id"] != first["question_id"] and len(cards(box)) == 2


def test_a_review_confirmed_and_not_yet_applied_is_reported_not_asked_again(box):
    stage(box)
    first = ask(box)
    answer(box, first["question_id"], "confirm")

    again = ask(box)

    assert again["asked"] is False and again["confirmed"] is True and len(cards(box)) == 1


def test_the_sixth_card_for_one_review_is_refused(box):
    stage(box)
    for _ in range(5):
        posted = ask(box)
        answer(box, posted["question_id"], "correct")

    assert tool(box, "ask-confirm") == (1, {"ok": False, "error": "too_many_cards"}) and len(cards(box)) == 5


def test_a_card_that_cannot_be_posted_says_so_and_leaves_no_trace(box):
    stage(box)
    env_box = box
    box.db.unlink()

    rc, out = tool(env_box, "ask-confirm")

    assert rc == 1 and out["error"] in {"card_not_posted", "database_unreadable"}
    assert not (box.home / "state" / "profile-confirm-card.json").exists()


# ── what saves ───────────────────────────────────────────────────────────────

def test_nothing_is_saved_before_the_person_answers_the_card(box):
    stage(box)
    ask(box)

    assert tool(box, "apply-confirmed") == (1, {"ok": False, "error": "not_answered"})
    assert not profile_file(box).exists()


def test_the_persons_confirm_saves_the_review_and_says_what_is_still_missing(box):
    stage(box, patch(languages=[]))
    posted = ask(box)
    answer(box, posted["question_id"], "confirm")

    rc, out = tool(box, "apply-confirmed")

    assert rc == 0 and out["ok"] is True
    assert out["receipt"]["missing"] == ["languages"] and out["receipt"]["ready"] is False
    saved = yaml.safe_load(profile_file(box).read_text(encoding="utf-8"))
    assert saved["target_role"] == "Data Engineer" and saved["seniority_target"] == "senior"
    assert tool(box, "status") == (0, {"ok": True, "review": None})  # the review is spent


def test_correct_saves_nothing_and_says_the_person_wants_a_correction(box):
    stage(box)
    posted = ask(box)
    answer(box, posted["question_id"], "correct")

    assert tool(box, "apply-confirmed") == (1, {"ok": False, "error": "wants_correction"})
    assert not profile_file(box).exists()


def test_the_systems_answer_is_not_the_persons_and_saves_nothing(box):
    stage(box)
    posted = ask(box)
    with sqlite3.connect(box.db, timeout=10) as conn:
        aq.close_as_system(conn, posted["question_id"], ["confirm"])

    assert tool(box, "apply-confirmed") == (1, {"ok": False, "error": "not_confirmed"})
    assert not profile_file(box).exists()


def test_a_forged_answer_row_saves_nothing(box):
    stage(box)
    posted = ask(box)
    with sqlite3.connect(box.db, timeout=10) as conn:
        conn.execute(
            "INSERT INTO pending_user_messages (agent, body, kind, author, source_id, source_action, source_payload) "
            "VALUES ('assistente', 'x', 'notification', 'user', ?, 'agent_question_answer', ?)",
            ("ans:" + posted["question_id"], json.dumps({"scelte": ["confirm"], "origine": "utente"})),
        )

    assert tool(box, "apply-confirmed") == (1, {"ok": False, "error": "not_confirmed"})
    assert not profile_file(box).exists()


def test_a_confirm_given_to_an_older_card_does_not_save_a_newer_review(box):
    stage(box)
    posted = ask(box)
    answer(box, posted["question_id"], "confirm")
    stage(box, patch(target_role="Analytics Engineer"))  # the review was prepared again after the card

    assert tool(box, "apply-confirmed") == (1, {"ok": False, "error": "card_outdated"})
    assert not profile_file(box).exists()


def test_with_no_card_at_all_nothing_is_applied(box):
    stage(box)

    assert tool(box, "apply-confirmed") == (1, {"ok": False, "error": "no_card"})


def test_a_second_apply_after_the_save_has_nothing_to_do(box):
    stage(box)
    posted = ask(box)
    answer(box, posted["question_id"], "confirm")
    assert tool(box, "apply-confirmed")[0] == 0

    assert tool(box, "apply-confirmed") == (1, {"ok": False, "error": "no_review"})


# ── the card in every language, and the contract of the old commands ─────────

@pytest.mark.parametrize("lang", LANGS)
def test_the_card_is_in_the_language_of_the_person(box, lang: str):
    stage(box)
    ask(box, "seniority_target", lang=lang)

    (card,) = cards(box)
    catalog = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
    payload = card["payload"]
    assert payload["oggetto"] == catalog["profile_confirm.subject"]
    assert [o["label"] for o in payload["opzioni"]] == [catalog["profile_confirm.confirm"], catalog["profile_confirm.correct"]]
    assert catalog["profile_confirm.intro"] in payload["testo"] and catalog["profile_confirm.deduced"] in payload["testo"]
    assert catalog["profile_confirm.outro"] in payload["testo"]
    assert len(payload["oggetto"]) <= 120 and all(len(o["label"]) <= 60 for o in payload["opzioni"])


KEYS = [
    "subject", "intro", "role", "seniority", "location", "years", "years_value", "skills", "languages",
    "deduced", "missing", "outro", "confirm", "correct", "name", "email", "field.work_authorization",
]


@pytest.mark.parametrize("lang", LANGS)
def test_the_catalog_has_the_card_in_every_language(lang: str):
    catalog = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
    english = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))

    for key in KEYS:
        value = catalog.get(f"profile_confirm.{key}")
        assert isinstance(value, str) and value.strip(), (lang, key)
        assert value.count("%s") == english[f"profile_confirm.{key}"].count("%s"), (lang, key)
        if lang != "en" and key not in {"name", "email", "seniority"}:  # a card in English for another language is the bug
            assert value != english[f"profile_confirm.{key}"], (lang, key)


def test_the_old_commands_keep_their_answers(box):
    review = stage(box)

    assert tool(box, "status")[1]["review"]["review_id"] == review["review_id"]
    rc, out = tool(box, "confirm", review["review_id"])
    assert rc == 0 and "receipt" in out and out["receipt"]["ready"] is True


# ── the agent's instructions ─────────────────────────────────────────────────

OLD_PANEL = {
    "": "in the profile panel", ".it": "nel pannello profilo", ".es": "en el panel del perfil",
    ".fr": "dans le panneau du profil", ".de": "im Profilbereich", ".hu": "a profilpanelen", ".pt": "no painel do perfil",
}


@pytest.mark.parametrize("lang", LANGS)
def test_the_profile_skill_confirms_with_the_card_and_never_sends_the_person_to_a_panel(lang: str):
    text = (ROOT / "agents" / "_skills" / "profile-yaml" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")

    for command in ("ask-confirm --inferred", "apply-confirmed", "wants_correction", "`open: true`", "`asked: true`", "`confirmed: true`", "no_review"):
        assert command in text, (lang, command)
    assert OLD_PANEL[SUFFIX[lang]] not in text
    assert re.search(r"^[3-6]\. ", text, re.M) and len(re.findall(r"^[1-6]\. ", text, re.M)) >= 6


@pytest.mark.parametrize("lang", LANGS)
def test_the_button_the_skill_tells_the_person_to_press_is_the_one_the_card_has(lang: str):
    text = (ROOT / "agents" / "_skills" / "profile-yaml" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    catalog = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))
    step = next(line for line in text.splitlines() if line.startswith("5. "))

    named = re.findall(r"\*\*(.+?)\*\*", step)
    assert named == [catalog["profile_confirm.confirm"]], (lang, named)
    assert catalog["profile_confirm.correct"] != catalog["profile_confirm.confirm"]


@pytest.mark.parametrize("lang", LANGS)
def test_the_onboarding_skill_ends_with_the_card_and_names_no_panel(lang: str):
    text = (ROOT / "agents" / "_skills" / "onboarding-flow" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    step = re.search(r"^8\. .*?(?=\n```)", text, re.S | re.M).group(0)

    assert "ask-confirm" in step and "profile-yaml" in step
    assert "**" not in step, step  # the old step sent the person to a named button; the card carries its own


@pytest.mark.parametrize("lang", LANGS)
def test_the_assistente_stages_and_asks_with_the_card_and_does_not_name_the_left_panel(lang: str):
    text = (ROOT / "agents" / "assistente" / f"assistente{SUFFIX[lang]}.md").read_text(encoding="utf-8")
    route = next(l for l in text.splitlines() if l.startswith("   - `candidate-related` →"))

    assert "ask-confirm" in route and "candidate_profile.yml" in route
    assert not re.search(r"left panel|pannello (a )?sinistra|panel izquierdo|panneau de gauche|linke Panel|bal panel|painel à esquerda", text)
