"""The journal row and the right to recreate a session come from the DECISION, not from what the model types.

On a 31/10 round of a beta VPS the Dottore recreated three coordinators that were 3 hours old and 12-23% used and wrote
86/96/86 as their context_pct: the number and the decision were typed by the model, and the next day the same model
wrote the right number. `session_context.py --age-h` leaves the decision; `doctor_journal.py` writes the row from it
and lets only a `refresh` recreate.

Run:
    pytest tests/test_doctor_journal.py -v
"""

import json
import sys
from pathlib import Path

import pytest

SKILLS_DIR = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS_DIR))
import doctor_journal  # noqa: E402
import session_context  # noqa: E402


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    return tmp_path


def _decide(monkeypatch, session, pct, age_h=3.0, capsys=None):
    monkeypatch.setattr(session_context, "pct_from_log", lambda *_a, **_k: pct)
    assert session_context.main([session, "--provider", "codex", "--age-h", str(age_h)]) == 0
    out = json.loads(capsys.readouterr().out) if capsys else None
    return out


def _rows(home: Path):
    path = home / "logs" / "doctor-retrospective.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def test_the_31_october_round_three_coordinators_at_12_23_and_20_percent_are_not_recreated(home, monkeypatch, capsys):
    # the used shares on the /status cards of that round (31K, 59K and 51.8K of 258K)
    for session, pct in (("ASSISTENTE", 12.0), ("MENTOR", 23.0), ("SENTINELLA", 20.0)):
        out = _decide(monkeypatch, session, pct, capsys=capsys)
        assert out["decision"]["action"] == "skip" and out["decision_saved"] is True
        assert doctor_journal.main(["may-recreate", session]) == 1, "a session below the gate is not recreated"
        row = doctor_journal.append_entry(session, "20261031T213551Z", "2026-10-31", "mid", session.lower(), 2.95, {}, {})
        assert row["action"] == "skipped_lowctx"
        assert row["context_pct"] == pct, "the number is the decision's, not 86/96/86"
    assert [row["action"] for row in _rows(home)] == ["skipped_lowctx"] * 3


def test_a_session_over_the_gate_may_be_recreated_and_its_row_says_recreated_with_the_used_share(home, monkeypatch, capsys):
    _decide(monkeypatch, "CAPITANO", 61.0, capsys=capsys)
    assert doctor_journal.main(["may-recreate", "CAPITANO"]) == 0
    row = doctor_journal.append_entry("CAPITANO", "r1", "2026-10-31", "mid", "capitano", 7.47, {"a": 1}, {"b": 2})
    assert (row["action"], row["context_pct"], row["decision_reason"]) == ("recreated", 61.0, "context")
    assert row["analytics"] == {"a": 1} and row["interview"] == {"b": 2}


def test_a_session_that_could_not_be_measured_is_neither_recreated_nor_logged_as_low_context(home, monkeypatch, capsys):
    _decide(monkeypatch, "MENTOR", None, capsys=capsys)
    assert doctor_journal.may_recreate("MENTOR") is False
    row = doctor_journal.append_entry("MENTOR", "r1", "2026-11-01", "mid", "mentor", 5.0, {}, {})
    assert row["action"] == "skipped_unmeasured" and row["context_pct"] is None


def test_the_ttl_decision_lets_a_low_context_session_be_recreated(home, monkeypatch, capsys):
    out = _decide(monkeypatch, "SCORER-2", 4.0, age_h=30.0, capsys=capsys)
    assert out["decision"]["reason"] == "ttl"
    assert doctor_journal.may_recreate("SCORER-2") is True
    assert doctor_journal.append_entry("SCORER-2", "r1", "d", "mid", "scorer", 30.0, {}, {})["action"] == "recreated"


def test_the_model_cannot_write_a_recreated_row_without_a_refresh_decision(home, monkeypatch, capsys):
    # no decision at all
    with pytest.raises(ValueError, match="no recent decision"):
        doctor_journal.append_entry("MENTOR", "r1", "d", "mid", "mentor", 1.0, {}, {})
    # a skip decision cannot be turned into a recreation, by the override either
    _decide(monkeypatch, "MENTOR", 20.0, capsys=capsys)
    for forged in ("recreated", "skipped_lowctx", "resume_confirmed"):
        with pytest.raises(ValueError, match="override"):
            doctor_journal.append_entry("MENTOR", "r1", "d", "mid", "mentor", 1.0, {}, {}, override=forged)
    assert _rows(home) == []


def test_parked_and_fresh_are_the_models_to_say_and_carry_the_measured_share_when_there_is_one(home, monkeypatch, capsys):
    parked = doctor_journal.append_entry("SCOUT-2", "r1", "d", "mid", "scout", 5.0, {}, {}, override="skipped_parked")
    assert parked["action"] == "skipped_parked" and parked["context_pct"] is None
    _decide(monkeypatch, "SCOUT-3", 70.0, capsys=capsys)
    # parked despite a refresh decision: the row says parked, and still carries the number the script measured
    row = doctor_journal.append_entry("SCOUT-3", "r1", "d", "mid", "scout", 5.0, {}, {}, override="skipped_parked")
    assert (row["action"], row["context_pct"]) == ("skipped_parked", 70.0)


def test_a_decision_older_than_half_an_hour_or_made_for_another_session_does_not_count(home, monkeypatch):
    doctor_journal.save_decision("MENTOR", {"action": "refresh", "reason": "context", "used_pct": 80.0}, now=1_000.0)
    assert doctor_journal.may_recreate("MENTOR", now=1_000.0 + 60) is True
    assert doctor_journal.may_recreate("MENTOR", now=1_000.0 + 31 * 60) is False
    assert doctor_journal.may_recreate("ASSISTENTE", now=1_000.0 + 60) is False


def test_a_decision_that_cannot_be_written_means_no_recreation(home, monkeypatch, capsys):
    monkeypatch.setattr(doctor_journal, "decision_path", lambda *_a, **_k: (_ for _ in ()).throw(OSError("read-only")))
    out = _decide(monkeypatch, "CAPITANO", 90.0, capsys=capsys)
    assert out["decision"]["action"] == "refresh" and out["decision_saved"] is False
    assert doctor_journal.may_recreate("CAPITANO") is False


def test_the_resume_row_and_the_command_line(home, monkeypatch, capsys):
    _decide(monkeypatch, "CAPITANO", 61.0, capsys=capsys)
    (home / "an.json").write_text('{"produced": {}}', encoding="utf-8")
    (home / "iv.json").write_text('{"summary_denso": "x"}', encoding="utf-8")
    assert doctor_journal.main(["append", "CAPITANO", "--round-id", "r1", "--day", "2026-10-31", "--timing", "mid",
                                "--role", "capitano", "--age-h", "7.47", "--analytics-file", str(home / "an.json"),
                                "--interview-file", str(home / "iv.json")]) == 0
    assert doctor_journal.main(["resume", "CAPITANO", "--round-id", "r1", "--timing", "mid", "--role", "capitano"]) == 0
    rows = _rows(home)
    assert [(row["action"], row.get("context_pct")) for row in rows] == [("recreated", 61.0), ("resume_confirmed", None)]
    assert rows[1]["resume_msg_sent"] is True
    # a timing the Dottore does not have, or a name that is not a session, is refused
    assert doctor_journal.main(["append", "CAPITANO", "--round-id", "r", "--day", "d", "--timing", "noon", "--role", "c"]) == 2
    assert doctor_journal.main(["may-recreate", "../etc"]) == 1, "a name that is not a session never has a decision"


def test_the_skill_of_the_round_asks_the_script_in_every_language():
    skills = sorted((SKILLS_DIR.parent.parent / "agents" / "_skills" / "session-refresh").glob("SKILL*.md"))
    assert len(skills) == 7
    for skill in skills:
        text = skill.read_text(encoding="utf-8")
        assert 'doctor_journal.py append "$S"' in text, skill.name
        assert 'doctor_journal.py may-recreate "$S" || exit 1' in text, skill.name
        assert 'doctor_journal.py resume "$S"' in text, skill.name
        # the guard comes before the line that kills the session, and the hand-typed journal row is gone
        assert text.index("may-recreate") < text.index("kill-session"), skill.name
        assert '"context_pct": 0' not in text and "<<'PY'" not in text, skill.name
        # a TTL session records its decision too
        assert text.count('--age-h "$AGE_H"') >= 2, skill.name
