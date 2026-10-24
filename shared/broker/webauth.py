"""Website application receipts, fetched and consumed by the broker itself.

The host fixes both the account and the read-only cloud token in broker state.
The agents' socket has no operation in this module: a sync is an admin action,
and the HTTP target is a constant rather than request input.  A received row is
bound to the fixed account, used once by its row id, and translated into the
notary's closed ``web:<host>`` destination.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from . import notary, store

STATE = "web_authorisations"
WEB_URL = "https://jobhunterteam.ai/api/cloud-sync/apply-authorizations"
MAX_TOKEN_BYTES = 4096
MAX_USED_IDS = 20_000
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
SYNC_TOKEN = re.compile(r"^jht_sync_[A-Za-z0-9_-]{16,2048}$")


class WebAuthRefusal(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _read() -> dict:
    data = store.read_state(STATE, {})
    return data if isinstance(data, dict) else {}


def _write(data: dict) -> None:
    store.write_state(STATE, data)


def set_account(account_id: object) -> dict:
    if not isinstance(account_id, str) or not UUID.fullmatch(account_id):
        raise WebAuthRefusal("account_invalid")
    with store.locked(STATE):
        state = _read()
        state["account_id"] = account_id.lower()
        # An account change cannot carry rows recorded for the old account.
        state["used_ids"] = []
        state["last_result"] = "account_set"
        _write(state)
    return {"ok": True, "account_id": account_id.lower()}


def set_token(raw: bytes) -> dict:
    if len(raw) > MAX_TOKEN_BYTES:
        raise WebAuthRefusal("token_too_large")
    try:
        token = raw.decode("utf-8", "strict").strip()
    except UnicodeDecodeError:
        raise WebAuthRefusal("token_not_utf8") from None
    if not SYNC_TOKEN.fullmatch(token):
        raise WebAuthRefusal("token_invalid")
    with store.locked(STATE):
        state = _read()
        state["token"] = token
        state["last_result"] = "token_set"
        _write(state)
    return {"ok": True, "token": "stored"}


def show() -> dict:
    state = _read()
    return {
        "ok": True,
        "account_id": state.get("account_id") if isinstance(state.get("account_id"), str) else None,
        "token": "stored" if isinstance(state.get("token"), str) else "absent",
        "last_result": state.get("last_result") if isinstance(state.get("last_result"), str) else None,
    }


def configured() -> bool:
    state = _read()
    return isinstance(state.get("account_id"), str) and isinstance(state.get("token"), str)


def _instant(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    utc = parsed.astimezone(timezone.utc)
    return utc.strftime("%Y-%m-%dT%H:%M:%S.") + f"{utc.microsecond // 1000:03d}Z"


def _destination(host: object) -> str | None:
    if not isinstance(host, str):
        return None
    try:
        return notary.destination("web:" + host)
    except notary.NotaryRefusal:
        return None


def _fetch(token: str, since: str | None) -> dict:
    target = WEB_URL + ("?" + urlencode({"since": since}) if since else "")
    request = Request(target, headers={"Authorization": "Bearer " + token, "Accept": "application/json"})
    try:
        with urlopen(request, timeout=10) as response:  # nosec B310: fixed HTTPS target above
            if response.status != 200:
                raise WebAuthRefusal("web_sync_unavailable")
            payload = response.read(512 * 1024 + 1)
    except HTTPError as error:
        if error.code == 409:
            try:
                body = json.loads(error.read(4096).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError, OSError):
                body = None
            if isinstance(body, dict) and body.get("error") == "re_pair_required":
                raise WebAuthRefusal("web_repair_required") from None
        raise WebAuthRefusal("web_sync_unavailable") from None
    except (URLError, TimeoutError, OSError):
        raise WebAuthRefusal("web_sync_unavailable") from None
    if len(payload) > 512 * 1024:
        raise WebAuthRefusal("web_response_too_large")
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise WebAuthRefusal("web_response_invalid") from None
    if not isinstance(parsed, dict) or parsed.get("ok") is not True:
        raise WebAuthRefusal("web_response_invalid")
    return parsed


def sync(_pages: int = 0) -> dict:
    """Fetch website receipts and narrow the notary state.  No input from the
    agent socket reaches this function; all retryable state belongs to broker."""
    with store.locked(STATE):
        state = _read()
        account = state.get("account_id")
        token = state.get("token")
        since = state.get("cursor")
    if not isinstance(account, str) or not isinstance(token, str):
        raise WebAuthRefusal("web_not_configured")

    try:
        body = _fetch(token, since if isinstance(since, str) else None)
    except WebAuthRefusal as err:
        with store.locked(STATE):
            state = _read()
            state["last_result"] = err.code
            _write(state)
        raise

    if body.get("account_id") != account:
        with store.locked(STATE):
            state = _read()
            state["last_result"] = "account_mismatch"
            _write(state)
        return {"ok": True, "processed": 0, "status": "account_mismatch"}

    rows = body.get("authorizations")
    if not isinstance(rows, list) or len(rows) > 1000:
        raise WebAuthRefusal("web_response_invalid")
    processed = 0
    skipped: dict[str, int] = {}
    with store.locked(STATE):
        state = _read()
        used = [item for item in state.get("used_ids", []) if isinstance(item, str) and UUID.fullmatch(item)]
        known = set(used)
        for row in rows:
            if not isinstance(row, dict):
                continue
            row_id = row.get("id")
            legacy_id = row.get("legacy_id")
            instant = _instant(row.get("created_at"))
            action = row.get("action")
            status = row.get("status")
            if (not isinstance(row_id, str) or not UUID.fullmatch(row_id) or row_id in known
                    or isinstance(legacy_id, bool) or not isinstance(legacy_id, int)
                    or instant is None or action not in ("position.apply_authorize", "position.apply_revoke")
                    or status not in ("queued", "done")):
                continue
            try:
                if action == "position.apply_authorize":
                    destination = _destination(row.get("host"))
                    if destination is None:
                        continue
                    notary.record(legacy_id, instant, "user_web", destination)
                else:
                    notary.revoke(legacy_id, instant)
            except notary.NotaryRefusal as err:
                known.add(row_id)
                used.append(row_id)
                skipped[err.code] = skipped.get(err.code, 0) + 1
                continue
            known.add(row_id)
            used.append(row_id)
            processed += 1
        state["used_ids"] = used[-MAX_USED_IDS:]
        cursor = body.get("cursor")
        cursor_valid = _instant(cursor) is not None
        if cursor_valid:
            state["cursor"] = cursor
        state["last_result"] = "synced"
        _write(state)
    result = {"ok": True, "processed": processed, "skipped": skipped, "status": "synced"}
    # A full page is followed immediately with the cursor just persisted above;
    # no later polling interval leaves a withdrawal behind a full first page.
    if body.get("has_more") is True and cursor_valid and _pages < 20:
        next_page = sync(_pages + 1)
        result["processed"] += next_page["processed"]
        for code, count in next_page.get("skipped", {}).items():
            result["skipped"][code] = result["skipped"].get(code, 0) + count
    return result
