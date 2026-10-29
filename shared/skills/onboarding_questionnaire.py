#!/usr/bin/env python3
"""
onboarding_questionnaire.py — the Assistente's questionnaire as cards of the app.

The steps, their choices and what each choice writes are DATA (shared/config/onboarding-questionnaire.json); the
words are in the seven catalogs (shared/locales/<lang>.json, keys onb.<step>.object / .text / .opt.<id>). The agent
does not pronounce the questions and does not write the fields: this tool posts one card at a time, reads the
person's OWN answer to it and writes what the choice says into candidate_profile.yml.

    python3 onboarding_questionnaire.py status                 # where the questionnaire stands
    python3 onboarding_questionnaire.py ask                    # post the card of the next step (idempotent)
    python3 onboarding_questionnaire.py apply                  # the person answered the open card: write the choice
    python3 onboarding_questionnaire.py apply --option ID      # they answered in words: record the choice their words name
    python3 onboarding_questionnaire.py answer-text STEP TEXT  # the free text a choice asked for (the title of «other»)

Every command prints one JSON object. The state is in $JHT_HOME/state/questionnaire.json: the steps answered, the
card open, how many cards were posted. It resumes where it stopped. A step the profile already settles is not
asked again as long as its answer is on file.

What the tool refuses, on purpose:
  - an answer that is not the person's own (the expiry's, an invalid row): nothing is written;
  - a choice named in words when the person did not write words: `--option` needs a text answer to the open card;
  - a field the data file is not allowed to write (CLOSED_FIELDS): the data cannot reach contacts, identity or the rest.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any, Iterator

sys.path.insert(0, str(Path(__file__).resolve().parent))

CARD_AGENT = "assistente"
MAX_CARDS_PER_STEP = 5
# The fields a choice may write. The data file is a file of the repository, but what a choice can touch is closed here too.
CLOSED_FIELDS = {
    "set": {"target_role_category_id", "target_specialty", "experience_years", "seniority_target", "target_role"},
    "add": {"location_preferences"},
}
PREFERENCES_KEY = "preferences"
PREFERENCES_TITLE_KEY = "onb.preferences.title"


class QuestionnaireError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _home() -> Path:
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))


def _db_path() -> str:
    return os.environ.get("JHT_DB") or str(_home() / "jobs.db")


def _state_path() -> Path:
    return _home() / "state" / "questionnaire.json"


def _data_path() -> Path:
    override = os.environ.get("JHT_QUESTIONNAIRE_DATA")
    if override:
        return Path(override)
    return Path(__file__).resolve().parents[1] / "config" / "onboarding-questionnaire.json"


def load_steps() -> list[dict[str, Any]]:
    try:
        data = json.loads(_data_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raise QuestionnaireError("data_unreadable") from None
    steps = data.get("steps") if isinstance(data, dict) else None
    if not isinstance(steps, list) or not steps:
        raise QuestionnaireError("data_invalid")
    return steps


def _catalog():
    shared = str(Path(__file__).resolve().parent.parent)
    if shared not in sys.path:
        sys.path.insert(0, shared)
    try:
        from i18n import t  # type: ignore
    except ImportError:
        raise QuestionnaireError("catalog_unavailable") from None
    return t


def _read_state() -> dict[str, Any]:
    try:
        value = json.loads(_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _write_state(state: dict[str, Any]) -> None:
    path = _state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False) + "\n", encoding="utf-8")
    tmp.replace(path)


@contextlib.contextmanager
def _lock() -> Iterator[None]:
    directory = _state_path().parent
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "questionnaire.lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


# ── which step is next ───────────────────────────────────────────────────────

def _answers(state: dict[str, Any]) -> dict[str, str]:
    value = state.get("answers")
    return {k: v for k, v in value.items() if isinstance(k, str) and isinstance(v, str)} if isinstance(value, dict) else {}


def _active(step: dict[str, Any], answers: dict[str, str]) -> bool:
    when = step.get("when")
    if not when:
        return True
    return answers.get(when.get("step")) in (when.get("in") or [])


def _next_step(steps: list[dict[str, Any]], answers: dict[str, str]) -> dict[str, Any] | None:
    for step in steps:
        if _active(step, answers) and step["id"] not in answers:
            return step
    return None


def _progress(steps: list[dict[str, Any]], answers: dict[str, str]) -> dict[str, int]:
    active = [s for s in steps if _active(s, answers)]
    return {"answered": sum(1 for s in active if s["id"] in answers), "total": len(active)}


def _option(step: dict[str, Any], option_id: str) -> dict[str, Any] | None:
    return next((o for o in step.get("options", []) if o.get("id") == option_id), None)


def status() -> dict[str, Any]:
    steps = load_steps()
    state = _read_state()
    answers = _answers(state)
    following = _next_step(steps, answers)
    card = state.get("card") if isinstance(state.get("card"), dict) else None
    return {
        "ok": True, "done": following is None, "next": following["id"] if following else None,
        "answers": answers, "open_card": card.get("question_id") if card else None, **_progress(steps, answers),
        "waiting_text": state.get("waiting_text"),
    }


# ── the card ─────────────────────────────────────────────────────────────────

def _stored_answer(conn: sqlite3.Connection, question_id: str) -> dict[str, Any] | None:
    """The answer to a card as the question tool would believe it, or None while there is none."""
    import agent_questions as aq  # type: ignore

    row = conn.execute(
        "SELECT id, source_id, source_payload FROM pending_user_messages WHERE source_id = ?",
        (aq.ANSWER_PREFIX + question_id,),
    ).fetchone()
    if row is None:
        return None
    try:
        answer, _question = aq.validated_answer(conn, CARD_AGENT, {"id": row[0], "source_id": row[1], "source_payload": row[2]})
    except aq.AnswerRejected:
        return {"scelte": [], "testo": "", "origine": "invalid"}
    return answer


def _card_exists(conn: sqlite3.Connection, question_id: str) -> bool:
    return conn.execute(
        "SELECT 1 FROM pending_user_messages WHERE source_id = ? AND source_action = 'agent_question'", (question_id,)
    ).fetchone() is not None


def _connect() -> sqlite3.Connection:
    try:
        return sqlite3.connect(f"file:{_db_path()}?mode=ro", uri=True, timeout=10)
    except sqlite3.Error:
        raise QuestionnaireError("database_unreadable") from None


def _card_for(step: dict[str, Any], t) -> dict[str, Any]:
    key = step["key"]
    return {
        "subject": t(f"{key}.object"),
        "text": t(f"{key}.text"),
        "options": [{"id": o["id"], "label": t(f"{key}.opt.{o['id']}")} for o in step["options"]],
    }


def ask() -> dict[str, Any]:
    """Post the card of the next step, unless one is open: never a second card while the first has no answer."""
    import first_run  # type: ignore

    steps = load_steps()
    t = _catalog()
    with _lock():
        state = _read_state()
        answers = _answers(state)
        step = _next_step(steps, answers)
        if step is None:
            return {"ok": True, "asked": False, "done": True, **_progress(steps, answers)}
        if state.get("waiting_text"):
            return {"ok": True, "asked": False, "waiting_text": state["waiting_text"],
                    "reason": "the person has to write this one in the chat: answer-text, then ask again"}
        card = state.get("card") if isinstance(state.get("card"), dict) else {}
        if card.get("step") == step["id"] and isinstance(card.get("question_id"), str):
            try:
                with contextlib.closing(_connect()) as conn:
                    if _card_exists(conn, card["question_id"]):
                        given = _stored_answer(conn, card["question_id"])
                        if given is None:
                            return {"ok": True, "asked": False, "open": True, "step": step["id"], "question_id": card["question_id"]}
                        chosen = given.get("scelte") or []
                        if given.get("origine") == "utente" and len(chosen) == 1 and _option(step, chosen[0]) is not None:
                            # the person answered and nobody has written it yet: a second card would ask the same thing twice
                            return {"ok": True, "asked": False, "answered": True, "step": step["id"],
                                    "reason": "the card is answered: apply it first"}
            except sqlite3.Error:
                raise QuestionnaireError("database_unreadable") from None
        cards = card.get("cards", 0) if card.get("step") == step["id"] and isinstance(card.get("cards"), int) else 0
        if cards >= MAX_CARDS_PER_STEP:
            raise QuestionnaireError("too_many_cards")
        posted, _why = first_run._post_plan_card(CARD_AGENT, _card_for(step, t))  # the one way a card is posted
        if posted is None:
            raise QuestionnaireError("card_not_posted")
        state["card"] = {"step": step["id"], "question_id": posted, "cards": cards + 1}
        _write_state(state)
        return {"ok": True, "asked": True, "step": step["id"], "question_id": posted, **_progress(steps, answers)}


# ── writing what a choice says ───────────────────────────────────────────────

def _preferences_block(profile: dict[str, Any], t) -> list[dict[str, Any]]:
    blocks = profile.setdefault("blocks", [])
    if not isinstance(blocks, list):
        raise QuestionnaireError("profile_blocks_invalid")
    block = next((b for b in blocks if isinstance(b, dict) and b.get("key") == PREFERENCES_KEY), None)
    if block is None:
        block = {"key": PREFERENCES_KEY, "kind": "key_points", "title": t(PREFERENCES_TITLE_KEY), "content": []}
        blocks.append(block)
    if block.get("kind") != "key_points" or not isinstance(block.get("content"), list):
        raise QuestionnaireError("profile_blocks_invalid")
    return block["content"]


def write_effect(profile: dict[str, Any], step: dict[str, Any], option: dict[str, Any], t) -> list[str]:
    """Write the effect of a choice into `profile`; the fields the chat still has to ask."""
    effect = option.get("effect") or {}
    to_ask: list[str] = []
    for field, value in (effect.get("set") or {}).items():
        if field not in CLOSED_FIELDS["set"]:
            raise QuestionnaireError("field_not_allowed")
        profile[field] = value
        if field == "target_role_category_id":
            profile.pop("target_specialty", None)  # a specialty belongs to its category: the old one is not kept
    for field, values in (effect.get("add") or {}).items():
        if field not in CLOSED_FIELDS["add"]:
            raise QuestionnaireError("field_not_allowed")
        current = profile.get(field)
        current = [v for v in current if isinstance(v, str)] if isinstance(current, list) else []
        profile[field] = current + [v for v in values if v not in current]
    if effect.get("preference"):
        content = _preferences_block(profile, t)
        heading = t(f"{step['key']}.object")
        item = {"heading": heading, "text": t(f"{step['key']}.opt.{option['id']}")}
        content[:] = [c for c in content if not (isinstance(c, dict) and c.get("heading") == heading)] + [item]
    to_ask.extend(f for f in (effect.get("ask") or []) if isinstance(f, str))
    return to_ask


def _write_choice(step: dict[str, Any], option: dict[str, Any], t) -> list[str]:
    import profile_review  # type: ignore

    try:
        with profile_review.profile_lock():
            profile, _raw = profile_review._read_profile()
            profile = dict(profile or {})
            to_ask = write_effect(profile, step, option, t)
            profile_review.write_profile(profile)
    except profile_review.ProfileReviewError as error:
        raise QuestionnaireError(f"profile_{error.code}") from None
    return to_ask


def apply(option_id: str | None = None) -> dict[str, Any]:
    """The person answered the open card: write their choice. With `option_id` only when they answered in WORDS."""
    steps = load_steps()
    t = _catalog()
    with _lock():
        state = _read_state()
        card = state.get("card") if isinstance(state.get("card"), dict) else None
        if not card or not isinstance(card.get("question_id"), str):
            return {"ok": True, "applied": False, "reason": "no card is open"}
        step = next((s for s in steps if s["id"] == card.get("step")), None)
        if step is None:
            raise QuestionnaireError("step_unknown")
        answers = _answers(state)
        if step["id"] in answers:
            return {"ok": True, "applied": False, "already": True, "step": step["id"]}
        try:
            with contextlib.closing(_connect()) as conn:
                answer = _stored_answer(conn, card["question_id"])
        except sqlite3.Error:
            raise QuestionnaireError("database_unreadable") from None
        if answer is None:
            return {"ok": True, "applied": False, "waiting": True, "step": step["id"]}
        if answer.get("origine") != "utente":
            return {"ok": True, "applied": False, "reason": "the answer is not the person's own", "step": step["id"]}
        chosen = answer.get("scelte") or []
        if len(chosen) == 1 and _option(step, chosen[0]) is not None:
            picked = _option(step, chosen[0])
        elif option_id is not None and not chosen and answer.get("testo") and _option(step, option_id) is not None:
            picked = _option(step, option_id)  # their words name it; the words are on file with the answer
        elif not chosen and answer.get("testo"):
            return {"ok": True, "applied": False, "words": True, "step": step["id"],
                    "reason": "the person answered in words: read them, then apply --option ID with the choice they mean, or ask the card again"}
        else:
            return {"ok": True, "applied": False, "reason": "the answer names no choice of this step", "step": step["id"]}
        to_ask = _write_choice(step, picked, t)
        answers[step["id"]] = picked["id"]
        state["answers"] = answers
        free = picked.get("free_text")
        if free:
            state["waiting_text"] = {"step": step["id"], "field": free.get("field"), "prompt_key": free.get("prompt_key")}
        state["card"] = {"step": step["id"], "question_id": card["question_id"], "cards": card.get("cards", 1), "done": True}
        _write_state(state)
        following = _next_step(steps, answers)
        out = {"ok": True, "applied": True, "step": step["id"], "option": picked["id"], "ask_in_chat": to_ask,
               "next": following["id"] if following else None, "done": following is None and not free, **_progress(steps, answers)}
        if free:
            out["write_in_chat"] = {"field": free.get("field"), "prompt": t(str(free.get("prompt_key")))}
        return out


def answer_text(step_id: str, text: str) -> dict[str, Any]:
    """The text a choice asked the person to write (the title of «other»): written to the field the choice names."""
    import profile_review  # type: ignore

    t = _catalog()
    with _lock():
        state = _read_state()
        waiting = state.get("waiting_text") if isinstance(state.get("waiting_text"), dict) else None
        if not waiting or waiting.get("step") != step_id:
            return {"ok": True, "written": False, "reason": "this step is not waiting for text"}
        value = " ".join(str(text).split())[:120]
        if not value:
            raise QuestionnaireError("text_empty")
        if waiting.get("field") not in CLOSED_FIELDS["set"]:
            raise QuestionnaireError("field_not_allowed")
        try:
            with profile_review.profile_lock():
                profile, _raw = profile_review._read_profile()
                profile = dict(profile or {})
                profile[waiting["field"]] = value
                profile_review.write_profile(profile)
        except profile_review.ProfileReviewError as error:
            raise QuestionnaireError(f"profile_{error.code}") from None
        state.pop("waiting_text", None)
        _write_state(state)
        following = _next_step(load_steps(), _answers(state))
        return {"ok": True, "written": True, "field": waiting["field"], "next": following["id"] if following else None}


# ── command line ─────────────────────────────────────────────────────────────

def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="The Assistente's questionnaire as cards")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("status")
    sub.add_parser("ask")
    apply_parser = sub.add_parser("apply")
    apply_parser.add_argument("--option", default=None)
    text_parser = sub.add_parser("answer-text")
    text_parser.add_argument("step")
    text_parser.add_argument("text")
    args = parser.parse_args(argv)
    try:
        if args.command == "status":
            out = status()
        elif args.command == "ask":
            out = ask()
        elif args.command == "apply":
            out = apply(args.option)
        else:
            out = answer_text(args.step, args.text)
    except QuestionnaireError as error:
        print(json.dumps({"ok": False, "error": error.code}))
        return 1
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
