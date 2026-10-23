"""The CLOSER sends only what the broker's register gives it, once, for where the person saw it go.

The suite's default (tests/fixtures/pdf_layout_pass/suite_notary.py) says yes to every flag; here
the gate talks to a real notary, in process, with its own temporary state: the flag in the agents'
database is set by hand exactly as any process in that container could set it, and the register
decides. Synthetic only.

Run with: pytest tests/test_apply_notary_gate.py -v
"""

import io
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared"))
sys.path.insert(0, str(ROOT / "shared" / "skills"))
sys.path.insert(0, str(ROOT / "tests"))

import apply_flow  # noqa: E402
import apply_gate  # noqa: E402
import apply_notary  # noqa: E402
from test_email_application import FakeTransport, box, flow, sql  # noqa: E402,F401

FLAG_AT = "2026-09-13T08:00:00.000Z"  # the instant the box fixture writes with the flag
LATER = "2026-09-13T09:00:00.000Z"


@pytest.fixture
def register(tmp_path, monkeypatch):
    for name in ("secrets", "state"):
        (tmp_path / "broker" / name).mkdir(parents=True, mode=0o700)
    monkeypatch.setenv("JHT_BROKER_SECRETS", str(tmp_path / "broker" / "secrets"))
    monkeypatch.setenv("JHT_BROKER_STATE", str(tmp_path / "broker" / "state"))
    from broker import admin, server

    def socket(op, args):
        return server.handle(json.dumps({"op": op, "args": args, "role": "closer"}).encode())

    def host(*argv):
        out, real = io.StringIO(), sys.stdout
        sys.stdout = out
        try:
            code = admin.main(["apply", *argv])
        finally:
            sys.stdout = real
        return code, json.loads(out.getvalue())

    monkeypatch.setattr(apply_notary, "call", socket)
    return type("R", (), {"socket": staticmethod(socket), "host": staticmethod(host)})


def test_a_flag_written_by_hand_sends_nothing(box, register):
    # the box fixture flags position 1 as `user_web`, the way any process could write it
    verdict = apply_gate.position_verdict(1, db_path=str(box / "jobs.db"))
    assert (verdict.allowed, verdict.reason) == (False, "authorisation_unproven")
    out = flow(box).send()
    assert (out.state, out.reason) == ("denied", "authorisation_unproven")
    assert FakeTransport.sends == []
    queue = apply_gate.application_queue(db_path=str(box / "jobs.db"))
    assert {"position_id": 1, "reason": "authorisation_unproven"} in queue["held"]


def test_a_recorded_authorisation_sends_once(box, register):
    assert register.host("record", "1", FLAG_AT, "web:example.com")[0] == 0
    assert apply_gate.position_verdict(1, db_path=str(box / "jobs.db")).allowed
    out = flow(box).send()
    assert (out.state, out.reason) == ("sent", "sent")
    assert len(FakeTransport.sends) == 1
    # spent: the register holds nothing for it any more, and the same click cannot be recorded again
    assert register.socket("apply.check", {"position_id": 1}) == {"ok": True, "proven": False}
    assert register.host("record", "1", FLAG_AT, "web:example.com")[1]["reason"] == "instant_not_newer"


def test_a_mail_to_another_place_sends_nothing_and_gives_the_slot_back(box, register):
    register.host("record", "1", FLAG_AT, "portal:linkedin")
    out = flow(box).send()
    assert (out.state, out.reason) == ("denied", "destination_not_authorised")
    assert FakeTransport.sends == []
    assert sql(box, "SELECT state FROM apply_cap_reservations") == [("released",)]
    # a mismatch does not spend it
    assert register.socket("apply.check", {"position_id": 1})["proven"] is True


def test_a_withdrawal_in_the_broker_wins_over_the_flag(box, register):
    register.host("record", "1", FLAG_AT, "web:example.com")
    assert register.socket("apply.revoke", {"position_id": 1, "instant": LATER})["status"] == "revoked"
    out = flow(box).send()
    assert (out.state, out.reason) == ("denied", "authorisation_unproven")
    assert FakeTransport.sends == []


@pytest.mark.parametrize("answer", [
    {"ok": False, "reason": "broker_unavailable"},
    {"ok": False, "reason": "unknown_operation"},  # a broker older than the register
    {"ok": True},
    {"ok": True, "proven": "yes"},
    "not a dict",
])
def test_no_clear_yes_is_a_no(box, monkeypatch, answer):
    monkeypatch.setattr(apply_notary, "call", lambda op, args: answer if isinstance(answer, dict) else {})
    assert apply_gate.position_verdict(1, db_path=str(box / "jobs.db")).reason == "authorisation_unproven"
    assert flow(box).send().state == "denied"
    assert FakeTransport.sends == []


def test_the_page_is_judged_where_it_is_after_the_redirects(box, register):
    register.host("record", "1", FLAG_AT, "web:example.com")
    away = apply_flow._default_authorisation_claimer(position_id=1, url="https://example.com.attacker.net/apply")
    assert (away.allowed, away.reason) == (False, "destination_not_authorised")
    for bad in ("file:///etc/passwd", "about:blank", ""):
        assert apply_flow._default_authorisation_claimer(position_id=1, url=bad).reason == "destination_invalid"
    here = apply_flow._default_authorisation_claimer(position_id=1, url="https://jobs.example.com/apply?step=3")
    assert (here.allowed, here.reason) == (True, "authorisation_claimed")
    again = apply_flow._default_authorisation_claimer(position_id=1, url="https://jobs.example.com/apply?step=3")
    assert (again.allowed, again.reason) == (False, "authorisation_unproven")


def test_the_flow_asks_the_broker_right_before_the_click():
    # the browser path cannot run here without a browser: its order is pinned on the source
    source = (ROOT / "shared" / "skills" / "apply_flow.py").read_text(encoding="utf-8").replace("\r\n", "\n")
    cap = source.index("slot = self.cap_reserver(")
    claim = source.index("claim = self.authorisation_claimer(position_id=self.position_id, url=active_page.url)")
    marker = source.index('checkpoint.state = "submit"', claim)
    click = source.index("recipe.submit(active_page)", marker)
    assert cap < claim < marker < click
    assert "self._release_cap_slot(slot)\n                    return self._deny(checkpoint, claim" in source
