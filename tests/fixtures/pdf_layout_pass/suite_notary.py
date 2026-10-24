"""Test-only: the broker's register of authorisations, as the suite needs it by default.

Production asks the broker (`shared/skills/apply_notary.py`) whether the person authorised a
position: the suite has no broker, so by default every flag the tests write counts as recorded
and every send gets its claim. The tests of the register itself and of the gate's use of it
(tests/test_apply_notary_gate.py) talk to a real in-process notary instead. Production code reads
no variable for this: the switch lives only in the test tree.
"""

INSTANT = "2026-01-01T00:00:00.000Z"


def call(op, args):
    if op == "apply.check":
        return {"ok": True, "proven": True, "destination": "web:example.com", "origin": "user_local", "instant": INSTANT}
    if op == "apply.claim":
        return {"ok": True, "claimed": True, "origin": "user_local", "instant": INSTANT}
    if op == "apply.revoke":
        return {"ok": True, "status": "revoked"}
    return {"ok": False, "reason": "unknown_operation"}
