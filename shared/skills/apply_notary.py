"""The CLOSER's side of the broker's register of authorisations to apply.

The flag in the agents' database says that the person asked for an application; the broker,
which keeps its own state under its own uid, is where that is proven. This module only asks:
`check` (read only, for the queue) and `claim` (right before the send, once, for the destination
the application is about to go to). Recording an authorisation is not possible from here.

Any answer that is not a clear yes is a no: no broker, an old broker without the register, an
answer that cannot be read.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import Any

_SHARED = str(Path(__file__).resolve().parents[1])
CODE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")


def call(op: str, args: dict[str, Any]) -> dict[str, Any]:
    """One request to the broker (`shared/broker/client.py`): its answer, or a fixed code."""
    if _SHARED not in sys.path:
        sys.path.insert(0, _SHARED)
    try:
        from broker.client import call as broker_call
    except ImportError:
        return {"ok": False, "reason": "broker_client_missing"}
    try:
        answer = broker_call(op, args)
    except Exception:  # noqa: BLE001 - the gate answers no, whatever went wrong
        return {"ok": False, "reason": "broker_unreachable"}
    return answer if isinstance(answer, dict) else {"ok": False, "reason": "broker_bad_answer"}


def _code(value: Any, default: str) -> str:
    return value if isinstance(value, str) and CODE.match(value) else default


def destination_of_url(url: Any) -> str | None:
    """The closed destination of a page, computed as the broker computes it; None if it has none."""
    if _SHARED not in sys.path:
        sys.path.insert(0, _SHARED)
    from broker import notary

    try:
        return notary.destination_of_url(url)
    except notary.NotaryRefusal:
        return None


def destination_of_address(address: Any) -> str | None:
    if _SHARED not in sys.path:
        sys.path.insert(0, _SHARED)
    from broker import notary

    try:
        return notary.destination_of_address(address)
    except notary.NotaryRefusal:
        return None


def check(position_id: int) -> tuple[bool, str, dict[str, Any]]:
    """(proven, reason, what the broker holds): read only, nothing is spent."""
    answer = call("apply.check", {"position_id": position_id})
    if answer.get("ok") is not True:
        # an old broker answers `unknown_operation`: it has no register, so nothing is proven
        return False, _code(answer.get("reason"), "broker_bad_answer"), {}
    if answer.get("proven") is not True:
        return False, "not_authorised", {}
    held = {key: answer.get(key) for key in ("destination", "origin", "instant") if isinstance(answer.get(key), str)}
    return True, "proven", held


def claim(position_id: int, destination: str | None) -> tuple[bool, str, dict[str, Any]]:
    """(claimed, reason, what was claimed): yes once, for that destination, right before the send."""
    if not destination:
        return False, "destination_invalid", {}
    answer = call("apply.claim", {"position_id": position_id, "destination": destination})
    if answer.get("ok") is not True:
        return False, _code(answer.get("reason"), "broker_bad_answer"), {}
    if answer.get("claimed") is not True:
        return False, _code(answer.get("reason"), "not_authorised"), {}
    held = {key: answer.get(key) for key in ("origin", "instant") if isinstance(answer.get(key), str)}
    return True, "claimed", held


def revoke(position_id: int, instant: str) -> tuple[bool, str]:
    """The person withdrew: the broker narrows. (done, status or reason)."""
    answer = call("apply.revoke", {"position_id": position_id, "instant": instant})
    if answer.get("ok") is not True:
        return False, _code(answer.get("reason"), "broker_bad_answer")
    return True, _code(answer.get("status"), "revoked")
