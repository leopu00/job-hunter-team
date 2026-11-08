"""Identity recorded by a running CLI, never its launch arguments or role defaults.

Only structured session records are accepted. A provider that does not record
its model/effort yields unknown fields. No terminal capture or key injection.
"""
import re


MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}\Z")
EFFORTS = frozenset({"none", "minimal", "low", "medium", "high", "xhigh", "max"})


def identity(provider, lines, since, state):
    out = {"provider": provider, "model": None, "effort": None, "at": None,
           "source": "session_log", "reason": "identity_not_recorded"}
    for record in state._objects(lines):
        at = state._iso(record.get("timestamp"))
        if at is None or at < since:
            continue
        payload = record.get("payload")
        if provider == "codex" and record.get("type") in {"session_meta", "event_msg", "turn_context", "response_item"} \
                and not isinstance(payload, dict):
            raise ValueError("invalid structured session payload")
        if provider == "codex" and record.get("type") == "turn_context" and isinstance(payload, dict):
            model, effort = payload.get("model"), payload.get("effort")
        elif provider == "claude" and record.get("type") == "assistant":
            message = record.get("message")
            if not isinstance(message, dict):
                continue
            model, effort = message.get("model"), record.get("effortLevel")
        else:
            continue
        if not isinstance(model, str) or not MODEL.fullmatch(model):
            continue
        if out["at"] is not None and at < out["at"]:
            continue
        valid_effort = isinstance(effort, str) and effort in EFFORTS
        out.update(model=model, effort=effort if valid_effort else None,
                   at=at, reason=None if valid_effort else "effort_not_recorded")
    return out
