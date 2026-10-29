"""The plan is asked with a card, never as text in the Capitano's pane.

TEST 13: after the profile import the Capitano wrote «Which OpenAI plan do you have?» in its own pane and
posted no card. The user watches the app, which shows cards and chat messages, so nobody was asking and nobody
could answer. The skill said «ask the user in the chat» without naming the tool, so the way of asking was the
agent's choice. Now there is one way, `first_run.py ask-plan`, and under it a net: the watchdog runs
`plan-question-check`, which posts the card itself when the profile is imported, the plan is missing and nobody
has asked for a few minutes — and never before the profile is imported.
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
import yaml  # the profile gate of the product reads the profile with it: without it the net stays quiet

from test_agent_questions import NOTIFY, ROOT, aq, box, sql  # noqa: F401  (box is a fixture)

FIRST_RUN = ROOT / "shared" / "skills" / "first_run.py"
WATCHDOG = ROOT / ".launcher" / "agent-watchdog.sh"
LOCALES = ROOT / "shared" / "locales"
LANGS = ("en", "it", "es", "fr", "de", "hu", "pt")
SUFFIX = {"en": "", "it": ".it", "es": ".es", "fr": ".fr", "de": ".de", "hu": ".hu", "pt": ".pt"}
QUESTIONS = "SELECT agent, source_id, source_payload FROM pending_user_messages WHERE source_action = 'agent_question'"


def run(box, *args: str, lang: str | None = None, profile: bool = True) -> dict:
    """Run first_run.py. The plan is asked after the profile is saved, so an `ask-plan` finds one in place unless the
    test says `profile=False` (the plan is never asked before it)."""
    if profile and args and args[0] == "ask-plan" and not (box.home / "profile" / "candidate_profile.yml").exists():
        import_profile(box, minutes_ago=60)
    env = dict(box.env)
    # HOME is the box's, so a PyYAML in the user's site-packages is found through the path, as in the image
    env["PYTHONPATH"] = str(Path(yaml.__file__).resolve().parent.parent)
    if lang:
        env["JHT_LANG"] = lang
    done = subprocess.run([sys.executable, str(FIRST_RUN), *args], capture_output=True, text=True, env=env, timeout=120)
    assert done.stdout.strip(), done.stderr
    return json.loads(done.stdout)


def configure(box, plan: str | None = None, provider: str = "openai") -> None:
    config = {"active_provider": provider}
    if plan:
        config["providers"] = {provider: {"plan": plan}}
    (box.home / "jht.config.json").write_text(json.dumps(config), encoding="utf-8")


def import_profile(box, minutes_ago: float = 0, content: str = "name: Test Person\ntarget_role: Backend engineer\n") -> Path:
    profile = box.home / "profile"
    profile.mkdir(exist_ok=True)
    path = profile / "candidate_profile.yml"
    path.write_text(content, encoding="utf-8")
    moment = time.time() - minutes_ago * 60
    os.utime(path, (moment, moment))
    return path


def codex_reports(box, plan_type: str = "prolite") -> None:
    logs = box.home / "logs"
    logs.mkdir(exist_ok=True)
    (logs / "codex-plan-reading.json").write_text(
        json.dumps({"plan_type": plan_type, "single_weekly": True, "observed_at": time.time()}), encoding="utf-8"
    )


def questions(box) -> list[dict]:
    return [dict(agent=a, id=i, payload=json.loads(p)) for a, i, p in sql(box, QUESTIONS)]


def steady(box) -> None:
    state = box.home / "state"
    state.mkdir(exist_ok=True)
    (state / "first-run.json").write_text(json.dumps({"phase": "steady"}), encoding="utf-8")


def answer(box, question_id: str, *choices: str, when=None) -> None:
    with sqlite3.connect(box.db, timeout=10) as conn:
        aq.record_answer(conn, question_id, list(choices), canale="desktop", now=when)


# ── ask-plan: the one way to ask ─────────────────────────────────────────────

def test_ask_plan_posts_the_card_with_the_plans_the_suggestion_and_i_do_not_know(box):
    configure(box)
    codex_reports(box, "prolite")

    out = run(box, "ask-plan")

    assert out["ok"] and out["asked"], out
    (card,) = questions(box)
    assert card["agent"] == "capitano" and card["id"] == out["question_id"]
    options = card["payload"]["opzioni"]
    assert [o["id"] for o in options] == ["plus", "pro", "pro_max", "unknown"]
    assert card["payload"]["libera"] is False and card["payload"]["scadenza"] is None
    by_id = {o["id"]: o["label"] for o in options}
    assert "suggerito" in by_id["pro"] and "suggerito" not in by_id["plus"]  # JHT_LANG is it in the box
    assert by_id["unknown"] == "Non lo so"
    assert "OpenAI" in card["payload"]["testo"]
    for option in options:
        assert re.fullmatch(r"[a-z0-9][a-z0-9_]{0,23}", option["id"]), option


def test_a_second_ask_plan_posts_nothing_while_the_first_has_no_answer(box):
    configure(box)
    first = run(box, "ask-plan")
    second = run(box, "ask-plan")

    assert first["asked"] and second["ok"] and not second["asked"]
    assert second["question_id"] == first["question_id"] and "open" in second["reason"]
    assert len(questions(box)) == 1


def test_after_an_answer_that_names_no_plan_the_card_comes_back_only_after_an_hour(box):
    configure(box)
    first = run(box, "ask-plan")
    answer(box, first["question_id"], "unknown")

    soon = run(box, "ask-plan")
    assert soon["ok"] and not soon["asked"] and 3000 < soon["seconds_left"] <= 3600
    assert len(questions(box)) == 1

    # asking for a wait of zero stands for the hour having passed
    again = run(box, "ask-plan", "--reask", "0")
    assert again["asked"] and again["question_id"] != first["question_id"]
    assert len(questions(box)) == 2


def ago(minutes: float) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


def test_ask_plan_asks_nothing_once_the_plan_is_declared(box):
    configure(box, plan="plus")

    out = run(box, "ask-plan")

    assert out["ok"] and not out["asked"] and "declared" in out["reason"]
    assert questions(box) == []


def test_ask_plan_says_so_when_the_card_cannot_be_posted(box):
    configure(box)
    box.db.unlink()

    out = run(box, "ask-plan")

    assert not out["ok"] and not out["asked"]
    assert "not posted" in out["reason"] or "cannot be read" in out["reason"]


@pytest.mark.parametrize("lang", LANGS)
def test_the_card_is_in_the_language_the_user_chose(box, lang: str):
    configure(box)
    # the language of the user is i18n-prefs.json, before the environment of the process
    (box.home / "i18n-prefs.json").write_text(json.dumps({"locale": lang}), encoding="utf-8")
    catalog = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))

    out = run(box, "ask-plan", lang="it" if lang != "it" else "de")

    assert out["asked"], out
    (card,) = questions(box)
    assert card["payload"]["oggetto"] == catalog["plan.question_subject"]
    assert card["payload"]["testo"] == catalog["plan.question_text"] % "OpenAI"
    labels = {o["id"]: o["label"] for o in card["payload"]["opzioni"]}
    assert labels["unknown"] == catalog["plan.question_unknown"]


def test_the_card_follows_the_environment_when_there_is_no_choice_saved(box):
    configure(box)
    catalog = json.loads((LOCALES / "hu.json").read_text(encoding="utf-8"))

    run(box, "ask-plan", lang="hu")

    (card,) = questions(box)
    assert card["payload"]["oggetto"] == catalog["plan.question_subject"]


@pytest.mark.parametrize("provider", ["openai", "claude", "kimi"])
def test_every_provider_card_is_a_question_the_tool_accepts(box, provider: str):
    configure(box, provider=provider)

    out = run(box, "ask-plan")

    assert out["asked"], out
    (card,) = questions(box)
    aq.validate_question_payload(card["payload"])
    assert card["payload"]["opzioni"][-1]["id"] == "unknown"


def test_the_id_of_the_card_declares_the_plan(box):
    configure(box)
    done = subprocess.run(
        [sys.executable, "-I", str(ROOT / "shared" / "skills" / "plan_registry.py"), "set", "openai:pro_max"],
        capture_output=True, text=True, env=box.env, timeout=60,
    )

    assert done.returncode == 0, done.stderr
    assert json.loads((box.home / "jht.config.json").read_text())["providers"]["openai"]["plan"] == "pro-max"


def test_the_prefix_of_an_answer_is_the_one_the_question_tool_writes():
    source = FIRST_RUN.read_text(encoding="utf-8")
    assert f'ANSWER_PREFIX = "{aq.ANSWER_PREFIX}"' in source


# ── plan-question-check: the net ─────────────────────────────────────────────

def test_the_net_never_posts_while_the_profile_is_not_imported(box):
    configure(box)

    out = run(box, "plan-question-check", "--after", "0")

    assert out["action"] == "none" and "not imported" in out["reason"]
    assert questions(box) == []


@pytest.mark.parametrize(
    "content",
    [
        "",  # an empty file
        "name: Test Person\n",  # no target role: the Assistente would not call it ready
        "name: Nome Cognome\ntarget_role: Backend engineer\n",  # the template, unedited
        "target_role: Backend engineer\n",  # one signal only
        "name: [unclosed\n",  # not YAML
    ],
)
def test_a_profile_the_product_would_not_call_ready_is_not_an_imported_profile(box, content: str):
    configure(box)
    import_profile(box, minutes_ago=60, content=content)

    out = run(box, "plan-question-check")

    assert out["action"] == "none" and "not imported" in out["reason"]
    assert questions(box) == []


def test_the_net_waits_the_minutes_it_was_given_after_the_import(box):
    configure(box)
    import_profile(box, minutes_ago=2)

    out = run(box, "plan-question-check")

    assert out["action"] == "waiting" and 0 < out["seconds_left"] <= 180
    assert questions(box) == []


def test_the_net_posts_the_card_when_nobody_has_asked(box):
    configure(box)
    codex_reports(box)
    import_profile(box, minutes_ago=6)

    out = run(box, "plan-question-check")

    assert out["action"] == "asked" and out["asked"], out
    (card,) = questions(box)
    assert card["agent"] == "capitano"
    assert [o["id"] for o in card["payload"]["opzioni"]][-1] == "unknown"


def test_the_net_does_not_post_a_second_card_on_the_next_tick(box):
    configure(box)
    import_profile(box, minutes_ago=6)

    run(box, "plan-question-check")
    again = run(box, "plan-question-check")

    assert again["action"] == "none" and "open" in again["reason"]
    assert len(questions(box)) == 1


def test_the_net_does_not_post_over_a_card_the_capitano_already_posted(box):
    configure(box)
    import_profile(box, minutes_ago=60)
    run(box, "ask-plan")

    out = run(box, "plan-question-check")

    assert out["action"] == "none" and len(questions(box)) == 1


def test_the_net_does_nothing_once_the_plan_is_declared_or_the_first_run_is_over(box):
    import_profile(box, minutes_ago=60)
    configure(box, plan="pro")
    # the plan is declared and the first run has not opened: no card, and the Capitano is told to open it
    # (after a short wait for the one who wrote the plan; tests/test_first_run_start_after_the_card.py)
    assert run(box, "plan-question-check")["action"] in {"waiting", "start"}
    assert questions(box) == []

    configure(box)
    steady(box)
    assert run(box, "plan-question-check")["action"] == "none"
    assert questions(box) == []


def test_after_an_i_do_not_know_the_net_asks_again_after_an_hour_and_not_after_five_minutes(box):
    configure(box)
    import_profile(box, minutes_ago=600)
    first = run(box, "ask-plan")
    answer(box, first["question_id"], "unknown", when=ago(10))

    soon = run(box, "plan-question-check")  # the first card from the import is at 5 minutes; this one is not
    assert soon["action"] == "waiting" and 2800 < soon["seconds_left"] <= 3000
    assert len(questions(box)) == 1


def test_an_hour_after_an_i_do_not_know_the_net_asks_again(box):
    configure(box)
    import_profile(box, minutes_ago=600)
    first = run(box, "ask-plan")
    answer(box, first["question_id"], "unknown", when=ago(61))

    later = run(box, "plan-question-check")

    assert later["action"] == "asked" and len(questions(box)) == 2


def test_after_three_cards_the_net_stops_and_nobody_asks_again(box):
    configure(box)
    import_profile(box, minutes_ago=600)
    card = run(box, "ask-plan")
    for expected in (2, 3):
        answer(box, card["question_id"], "unknown", when=ago(61))
        card = run(box, "plan-question-check")
        assert card["action"] == "asked" and len(questions(box)) == expected, card
    answer(box, card["question_id"], "unknown", when=ago(61))

    stopped = run(box, "plan-question-check")
    by_hand = run(box, "ask-plan", "--reask", "0")

    assert stopped["action"] == "stopped" and "3 times" in stopped["reason"]
    assert by_hand["ok"] and not by_hand["asked"] and by_hand["limit"] is True
    assert len(questions(box)) == 3


def test_a_card_is_for_the_provider_it_was_posted_for(box):
    configure(box)
    import_profile(box, minutes_ago=600)
    first = run(box, "ask-plan")
    answer(box, first["question_id"], "pro", when=ago(30))  # an openai plan, named for the card of openai
    configure(box, provider="claude")  # the provider changes before anybody wrote the plan

    out = run(box, "plan-question-check")

    assert out["action"] == "asked", out  # a new card, for the plans of the new provider
    assert "providers" not in json.loads((box.home / "jht.config.json").read_text())  # nothing is written for claude
    ids = [o["id"] for o in questions(box)[-1]["payload"]["opzioni"]]
    assert ids == ["pro", "max5", "max20", "unknown"]
    state = json.loads((box.home / "state" / "first-run.json").read_text())
    assert state["plan_cards"] == {"provider": "claude", "count": 1}  # the count starts again with the provider


def test_a_card_left_open_for_another_provider_does_not_stop_the_new_one(box):
    configure(box)
    run(box, "ask-plan")
    configure(box, provider="kimi")

    out = run(box, "ask-plan")

    assert out["asked"] and len(questions(box)) == 2


def test_what_is_written_to_the_state_while_the_card_is_posted_is_kept(box, monkeypatch):
    import importlib.util

    configure(box)
    for key, value in box.env.items():
        monkeypatch.setenv(key, value)
    spec = importlib.util.spec_from_file_location("first_run_under_test", FIRST_RUN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)

    def post(agent, card):
        state = json.loads(module.STATE_PATH.read_text())
        state["written_meanwhile"] = True  # somebody else (burst, complete) writes the state during the post
        module.STATE_PATH.write_text(json.dumps(state))
        return "aq:capitano:1-abc", ""

    monkeypatch.setattr(module, "_post_plan_card", post)
    import_profile(box, minutes_ago=60)  # the plan is asked after the profile is saved
    module.status()

    assert module.ask_plan()["asked"]

    kept = json.loads(module.STATE_PATH.read_text())
    assert kept["written_meanwhile"] is True and kept["plan_question"]["id"] == "aq:capitano:1-abc"


def test_an_answer_that_names_a_plan_is_written_as_the_user_chose_it_when_nobody_wrote_it(box):
    configure(box)
    import_profile(box, minutes_ago=600)
    first = run(box, "ask-plan")
    answer(box, first["question_id"], "pro_max")

    waiting = run(box, "plan-question-check")
    assert waiting["action"] == "waiting" and waiting["seconds_left"] <= 300

    done = run(box, "plan-question-check", "--after", "0")

    assert done["action"] == "declared" and done["plan"] == "pro-max"
    assert json.loads((box.home / "jht.config.json").read_text())["providers"]["openai"]["plan"] == "pro-max"
    assert len(questions(box)) == 1  # the user is not asked a second time for what they answered


def test_a_net_that_cannot_post_says_failed_and_leaves_no_card(box):
    configure(box)
    import_profile(box, minutes_ago=60)
    box.db.unlink()

    out = run(box, "plan-question-check")

    assert out["action"] == "failed" and "not posted" in out["reason"]


# ── the watchdog calls the net, and the skills name the one way ──────────────

def _net_function() -> str:
    text = WATCHDOG.read_text(encoding="utf-8")
    start = text.index("# --- rete della domanda sul piano")
    return text[start : text.index("# --- fine rete della domanda sul piano")]


def test_the_watchdog_runs_the_net_in_every_tick_of_the_normal_loop():
    text = WATCHDOG.read_text(encoding="utf-8")
    loop = text[text.index("while true; do") :]
    calls = ["\n    maybe_mail_tick\n", "\n    maybe_plan_question\n", "\n    maybe_respawn_bridges\n"]
    assert all(call in loop for call in calls), calls
    assert [loop.index(call) for call in calls] == sorted(loop.index(call) for call in calls)
    # four spaces: inside `if config_ready`, the branch where the agents are kept alive
    assert loop.index(calls[1]) < loop.index("# config non pronta")


def _watchdog_function(tmp_path: Path, tool_output: str, tool_exit: int = 0) -> subprocess.CompletedProcess:
    tool = tmp_path / "first_run.py"
    tool.write_text(
        "import sys\nprint(" + repr(tool_output) + ")\nsys.exit(" + str(tool_exit) + ")\n", encoding="utf-8"
    )
    script = (
        'log() { printf "LOG %s\\n" "$*"; }\n'
        f'FIRST_RUN_TOOL="{tool}"; JHT_HOME="{tmp_path}"\n'
        + _net_function()
        + "\nfor i in 1 2 3; do maybe_plan_question; done\necho DONE-$?\n"
    )
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)


def test_the_watchdog_logs_what_the_net_did_and_never_stops_the_loop(tmp_path: Path):
    asked = _watchdog_function(tmp_path, '{\n  "action": "asked",\n  "question_id": "aq:capitano:1-x"\n}')
    assert asked.stdout.count("LOG plan question:") == 3 and "DONE-0" in asked.stdout

    quiet = _watchdog_function(tmp_path, '{"action": "none"}')
    assert "LOG" not in quiet.stdout and "DONE-0" in quiet.stdout

    broken = _watchdog_function(tmp_path, "", tool_exit=3)
    assert "LOG" not in broken.stdout and "DONE-0" in broken.stdout


def test_the_watchdog_says_a_failure_once_and_not_on_every_tick(tmp_path: Path):
    failed = _watchdog_function(tmp_path, '{"action": "failed", "reason": "the card was not posted: db"}')

    assert failed.stdout.count("LOG plan question NOT posted") == 1 and "DONE-0" in failed.stdout


def test_the_watchdog_says_the_net_has_stopped_once(tmp_path: Path):
    stopped = _watchdog_function(tmp_path, '{"action": "stopped", "reason": "the plan was asked 3 times and the user named none"}')

    assert stopped.stdout.count("LOG plan question STOPPED") == 1 and "DONE-0" in stopped.stdout


def test_the_italian_card_does_not_call_the_agents_workers():
    catalog = json.loads((LOCALES / "it.json").read_text(encoding="utf-8"))

    assert "lavoratori" not in catalog["plan.question_text"] and "dimensiona gli agenti" in catalog["plan.question_text"]


def test_the_watchdog_without_the_tool_does_nothing(tmp_path: Path):
    script = (
        'log() { printf "LOG %s\\n" "$*"; }\n'
        f'FIRST_RUN_TOOL="{tmp_path}/missing.py"; JHT_HOME="{tmp_path}"\n'
        + _net_function()
        + "\nmaybe_plan_question; echo DONE-$?\n"
    )
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)

    assert done.stdout.strip() == "DONE-0"


@pytest.mark.parametrize("lang", LANGS)
def test_the_skill_names_ask_plan_as_the_only_way_and_no_longer_says_ask_in_the_chat(lang: str):
    text = (ROOT / "agents" / "_skills" / "first-run-burst" / f"SKILL{SUFFIX[lang]}.md").read_text(encoding="utf-8")

    assert text.count("first_run.py ask-plan") == 2 and "`ask-plan`" in text
    assert "plan_registry.py list" not in text  # the listing is the card's job now
    assert "plan_registry.py set <provider>:<id>" in text
    assert "pro_max" in text and "pro-max" in text


@pytest.mark.parametrize("lang", LANGS)
def test_the_catalog_has_the_card_in_every_language(lang: str):
    catalog = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))

    for key in ("plan.question_subject", "plan.question_text", "plan.question_suggested", "plan.question_unknown"):
        assert isinstance(catalog.get(key), str) and catalog[key].strip(), (lang, key)
    assert catalog["plan.question_text"].count("%s") == 1
    if lang != "en":  # a card in English for a user who chose another language is the bug this test stands for
        english = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))
        for key in ("plan.question_subject", "plan.question_text", "plan.question_unknown", "plan.select_hint"):
            assert catalog[key] != english[key], (lang, key)
    assert len(catalog["plan.question_subject"]) <= 120
    assert "first_run.py ask-plan" in catalog["plan.select_hint"]


# ── The person already picked: nobody sends them back to the card ──────────────────────────────────

def test_ask_plan_after_a_named_answer_says_the_plan_is_picked_and_not_to_ask_again(box):
    """Between the answer on the card and the plan being written (the net waits for whoever should write it) the
    agent that ran `ask-plan` read «answered without naming a plan, asked again later» and sent the person back to
    «the card above», which they had just answered (collaudo 19c)."""
    configure(box)
    first = run(box, "ask-plan")
    answer(box, first["question_id"], "pro_max")

    again = run(box, "ask-plan")

    assert again["ok"] and not again["asked"] and again["answered"] and again["choice"] == "pro_max", again
    assert "seconds_left" not in again and "without naming" not in again["reason"]
    assert "plan_registry.py set openai:pro_max" in again["reason"] and "Do NOT ask again" in again["reason"]
    assert len(questions(box)) == 1


def test_ask_plan_after_an_i_do_not_know_still_waits_the_hour(box):
    configure(box)
    first = run(box, "ask-plan")
    answer(box, first["question_id"], "unknown")

    soon = run(box, "ask-plan")

    assert not soon["asked"] and not soon.get("answered") and 3000 < soon["seconds_left"] <= 3600, soon


def test_begin_burst_with_the_plan_picked_but_not_written_tells_to_write_it_and_not_to_ask(box):
    configure(box)
    first = run(box, "ask-plan")
    answer(box, first["question_id"], "pro_max")

    refused = run(box, "begin-burst")

    assert not refused["ok"], refused
    assert "plan_registry.py set openai:pro_max" in refused["hint"] and "Do NOT ask again" in refused["hint"]
    assert "ask-plan" not in refused["hint"]


def test_begin_burst_with_no_answer_still_says_to_ask_with_the_card(box):
    configure(box)

    refused = run(box, "begin-burst")

    assert not refused["ok"] and "ask-plan" in refused["hint"], refused
