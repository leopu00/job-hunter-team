#!/usr/bin/env python3
"""Stage and atomically confirm candidate-profile changes extracted from a CV.

The Assistant writes only the fields extracted from the uploaded document to
``$JHT_AGENT_DIR/profile-review.yml`` and invokes ``stage``.  The canonical
profile is deliberately untouched until the user confirms the review in the
desktop UI.  ``confirm`` is a compare-and-swap: a concurrent profile change
invalidates the review instead of being overwritten.

In the app's chat there is no panel to press: the review is confirmed with a CARD (`ask-confirm` posts it,
with a readable summary and two buttons) and saved only after the person's own answer to that card
(`apply-confirmed`). Nothing the person types as words saves it.

The JSON printed by this helper is a machine contract.  It contains no paths
and never prints profile values on errors; the UI receives the review values
only from ``status`` after a valid, owner-only envelope has been read.
"""

from __future__ import annotations

import argparse
import ast
import contextlib
import copy
import fcntl
import hashlib
import json
import os
import re
import sqlite3
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterator

import yaml

sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from profile_email import profile_email  # noqa: E402


MAX_PROFILE_BYTES = 64 * 1024
MAX_REVIEW_BYTES = 128 * 1024
SCHEMA_VERSION = 2
REVIEW_ID_RE = re.compile(r"^[0-9a-f]{64}$")
FIELDS = (
    "name",
    "email",
    "target_role",
    "location",
    "experience_years",
    "seniority_target",
    "skills",
    "languages",
)


class ProfileReviewError(RuntimeError):
    """Expected fail-closed outcome with a stable public error code."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def _home() -> Path:
    return Path(os.environ.get("JHT_HOME", "/jht_home"))


def _profile_dir() -> Path:
    return _home() / "profile"


def _profile_path() -> Path:
    return _profile_dir() / "candidate_profile.yml"


def _review_path() -> Path:
    return _profile_dir() / "pending-profile-review.json"


def _patch_path() -> Path:
    agent_dir = Path(os.environ.get("JHT_AGENT_DIR", str(_home() / "agents" / "assistente")))
    return agent_dir / "profile-review.yml"


def _open_readonly(path: Path, max_bytes: int = MAX_PROFILE_BYTES) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        fd = os.open(path, flags)
    except FileNotFoundError as exc:
        raise ProfileReviewError("missing") from exc
    except OSError as exc:
        raise ProfileReviewError("unreadable") from exc
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_size > max_bytes:
            raise ProfileReviewError("invalid_file")
        chunks: list[bytes] = []
        remaining = max_bytes + 1
        while remaining > 0:
            chunk = os.read(fd, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        raw = b"".join(chunks)
        if len(raw) > max_bytes:
            raise ProfileReviewError("too_large")
        return raw
    finally:
        os.close(fd)


def _decode_mapping(raw: bytes, code: str) -> dict[str, Any]:
    try:
        value = yaml.safe_load(raw.decode("utf-8"))
    except (UnicodeDecodeError, yaml.YAMLError) as exc:
        raise ProfileReviewError(code) from exc
    if value is None:
        return {}
    if not isinstance(value, dict) or any(not isinstance(key, str) for key in value):
        raise ProfileReviewError(code)
    try:
        json.dumps(value, ensure_ascii=False, allow_nan=False)
    except (TypeError, ValueError) as exc:
        raise ProfileReviewError(code) from exc
    return value


def _read_profile() -> tuple[dict[str, Any], bytes | None]:
    try:
        raw = _open_readonly(_profile_path())
    except ProfileReviewError as exc:
        if exc.code == "missing":
            return {}, None
        raise ProfileReviewError("profile_unreadable") from exc
    return _decode_mapping(raw, "profile_invalid"), raw


def read_profile() -> dict[str, Any]:
    """Read the canonical profile with the same fail-closed rules as confirm."""

    profile, _ = _read_profile()
    return profile


def _hash(raw: bytes | None) -> str:
    if raw is None:
        return "missing"
    return hashlib.sha256(raw).hexdigest()


def _deep_merge(base: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    merged = copy.deepcopy(base)
    for key, value in patch.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = copy.deepcopy(value)
    return merged


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _skills(profile: dict[str, Any]) -> list[str]:
    raw = profile.get("skills")
    values: list[Any] = []
    if isinstance(raw, dict):
        for group in raw.values():
            if isinstance(group, list):
                values.extend(group)
    elif isinstance(raw, list):
        values = raw
    return [_text(value) for value in values if _text(value)]


def _languages(profile: dict[str, Any]) -> list[str]:
    raw = profile.get("languages")
    if not isinstance(raw, list):
        raw = [raw] if raw is not None else []
    values: list[str] = []
    for item in raw:
        if isinstance(item, dict):
            name = _text(item.get("language", item.get("name")))
            level = _text(item.get("level"))
            if name:
                values.append(name + (f" ({level})" if level else ""))
        elif _text(item):
            values.append(_text(item))
    return values


def _email(profile: dict[str, Any]) -> str:
    return profile_email(profile) or ""


def _seniority(profile: dict[str, Any]) -> str:
    direct = _text(profile.get("seniority_target"))
    if direct:
        return direct
    positioning = profile.get("positioning")
    return _text(positioning.get("seniority_target")) if isinstance(positioning, dict) else ""


def _view(profile: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": _text(profile.get("name")),
        "email": _email(profile),
        "target_role": _text(profile.get("target_role")),
        "location": _text(profile.get("location")),
        "experience_years": profile.get("experience_years"),
        "seniority_target": _seniority(profile),
        "skills": _skills(profile)[:12],
        "languages": _languages(profile)[:8],
    }


def _required(view: dict[str, Any]) -> dict[str, bool]:
    return {
        "name": bool(_text(view.get("name"))),
        "email": bool(_text(view.get("email"))),
        "target_role": bool(_text(view.get("target_role"))),
        "location": bool(_text(view.get("location"))),
        # Keep the persisted badge contract identical to web/profile-completion
        # and profile_status.py: zero is valid and only null means missing.
        "experience_years": view.get("experience_years") is not None,
        "seniority_target": bool(_text(view.get("seniority_target"))),
        "skills": isinstance(view.get("skills"), list) and len(view["skills"]) >= 2,
        "languages": isinstance(view.get("languages"), list) and len(view["languages"]) >= 1,
    }


_MISSING = object()


def _changes(
    before: Any, after: Any, path: tuple[str, ...] = ()
) -> list[dict[str, Any]]:
    """Return every persisted difference in a deterministic, displayable form.

    Dictionaries are expanded recursively so nested CV fields cannot hide behind
    one of the eight badge rows.  Lists stay whole: showing the final ordered
    value is the only unambiguous review for experience/education entries.
    """

    if isinstance(after, dict) and (isinstance(before, dict) or before is _MISSING):
        prior = before if isinstance(before, dict) else {}
        if not after and prior != after:
            return [{"field": ".".join(path), "value": {}}]
        changes: list[dict[str, Any]] = []
        for key in sorted(after):
            changes.extend(
                _changes(prior.get(key, _MISSING), after[key], (*path, key))
            )
        return changes
    if before is not _MISSING and before == after:
        return []
    return [{"field": ".".join(path), "value": copy.deepcopy(after)}]


def _review_id(
    base_hash: str, profile: dict[str, Any], changes: list[dict[str, Any]]
) -> str:
    canonical = json.dumps(
        {"base_hash": base_hash, "changes": changes, "profile": profile},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def _public_review(envelope: dict[str, Any], stale: bool) -> dict[str, Any]:
    return {
        "review_id": envelope["review_id"],
        "changes": envelope["changes"],
        "required": envelope["required"],
        "missing": envelope["missing"],
        "stale": stale,
    }


def _atomic_bytes(path: Path, raw: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(path.parent, 0o700)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    tmp = Path(tmp_name)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb", closefd=True) as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp, path)
        dir_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(dir_fd)
        finally:
            os.close(dir_fd)
    finally:
        if tmp.exists():
            tmp.unlink()


def write_profile(profile: dict[str, Any]) -> str:
    """Persist a validated mapping atomically and return its byte receipt."""

    if not isinstance(profile, dict):
        raise ProfileReviewError("profile_invalid")
    try:
        raw = yaml.safe_dump(profile, allow_unicode=True, sort_keys=False).encode("utf-8")
    except (TypeError, ValueError, yaml.YAMLError) as exc:
        raise ProfileReviewError("profile_invalid") from exc
    if len(raw) > MAX_PROFILE_BYTES:
        raise ProfileReviewError("too_large")
    _atomic_bytes(_profile_path(), raw)
    persisted = _open_readonly(_profile_path())
    if persisted != raw:
        raise ProfileReviewError("receipt_mismatch")
    return hashlib.sha256(persisted).hexdigest()


@contextlib.contextmanager
def profile_lock() -> Iterator[None]:
    directory = _profile_dir()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    os.chmod(directory, 0o700)
    lock_path = directory / ".profile-write.lock"
    flags = os.O_RDWR | os.O_CREAT
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(lock_path, flags, 0o600)
    try:
        os.fchmod(fd, 0o600)
        fcntl.flock(fd, fcntl.LOCK_EX)
        yield
    finally:
        fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def _read_envelope() -> dict[str, Any]:
    raw = _open_readonly(_review_path(), MAX_REVIEW_BYTES)
    try:
        envelope = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProfileReviewError("review_invalid") from exc
    if not isinstance(envelope, dict) or envelope.get("schema_version") != SCHEMA_VERSION:
        raise ProfileReviewError("review_invalid")
    if not REVIEW_ID_RE.fullmatch(str(envelope.get("review_id", ""))):
        raise ProfileReviewError("review_invalid")
    if not isinstance(envelope.get("profile"), dict):
        raise ProfileReviewError("review_invalid")
    changes = envelope.get("changes")
    if not isinstance(changes, list) or not changes:
        raise ProfileReviewError("review_invalid")
    fields: set[str] = set()
    for item in changes:
        if (
            not isinstance(item, dict)
            or set(item) != {"field", "value"}
            or not isinstance(item["field"], str)
            or not item["field"]
            or item["field"] in fields
        ):
            raise ProfileReviewError("review_invalid")
        fields.add(item["field"])
    if not isinstance(envelope.get("missing"), list):
        raise ProfileReviewError("review_invalid")
    expected = _review_id(
        str(envelope.get("base_hash", "")), envelope["profile"], changes
    )
    if expected != envelope["review_id"]:
        raise ProfileReviewError("review_invalid")
    return envelope


def stage() -> dict[str, Any]:
    with profile_lock():
        base, base_raw = _read_profile()
        patch = _decode_mapping(_open_readonly(_patch_path()), "patch_invalid")
        if not patch:
            raise ProfileReviewError("patch_empty")
        merged = _deep_merge(base, patch)
        encoded = json.dumps(merged, ensure_ascii=False, allow_nan=False).encode("utf-8")
        if len(encoded) > MAX_PROFILE_BYTES:
            raise ProfileReviewError("too_large")
        after = _view(merged)
        changes = _changes(base, merged)
        if not changes:
            raise ProfileReviewError("no_changes")
        required = _required(after)
        base_hash = _hash(base_raw)
        envelope = {
            "schema_version": SCHEMA_VERSION,
            "review_id": _review_id(base_hash, merged, changes),
            "base_hash": base_hash,
            "profile": merged,
            "changes": changes,
            "required": required,
            "missing": [field for field in FIELDS if not required[field]],
        }
        _atomic_bytes(
            _review_path(),
            (json.dumps(envelope, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8"),
        )
        _patch_path().unlink()
        return _public_review(envelope, stale=False)


def status() -> dict[str, Any] | None:
    try:
        envelope = _read_envelope()
    except ProfileReviewError as exc:
        if exc.code == "missing":
            return None
        raise
    current, current_raw = _read_profile()
    stale = _hash(current_raw) != envelope["base_hash"]
    if not stale and _changes(current, envelope["profile"]) != envelope["changes"]:
        raise ProfileReviewError("review_invalid")
    return _public_review(envelope, stale=stale)


def confirm(review_id: str) -> dict[str, Any]:
    if not REVIEW_ID_RE.fullmatch(review_id):
        raise ProfileReviewError("review_id_invalid")
    with profile_lock():
        envelope = _read_envelope()
        if envelope["review_id"] != review_id:
            raise ProfileReviewError("review_mismatch")
        current, current_raw = _read_profile()
        if _hash(current_raw) != envelope["base_hash"]:
            raise ProfileReviewError("profile_changed")
        # The click is valid only for the complete set shown by status.  This
        # comparison runs under the same lock as the write, so neither omitted
        # nested fields nor a concurrent base change can cross the boundary.
        if _changes(current, envelope["profile"]) != envelope["changes"]:
            raise ProfileReviewError("review_invalid")
        if os.environ.get("JHT_PROFILE_REVIEW_FAIL_BEFORE_REPLACE") == "1":
            raise ProfileReviewError("write_failed")
        profile_hash = write_profile(envelope["profile"])
        _review_path().unlink()
        view = _view(envelope["profile"])
        required = _required(view)
        return {
            "review_id": review_id,
            "profile_hash": profile_hash,
            "required": required,
            "ready": all(required.values()),
        }


# -- The confirmation card ---------------------------------------------------------------------------------
#
# The panel with «Confirm and save» exists in some views of the app and not in the chat of the first run, where
# the person was sent to look for a button that is not there (TEST 15). In the chat the review is confirmed with
# a card: `ask-confirm` posts it (a readable summary, the fields the CV did not say marked as deduced, two
# buttons), and `apply-confirmed` saves the review only when the person's OWN answer to that card says confirm.
# The card is remembered in state/profile-confirm-card.json: one card per review, none while the last is open.

CARD_AGENT = "assistente"
CONFIRM_OPTION = "confirm"
CORRECT_OPTION = "correct"
MAX_CARDS_PER_REVIEW = 5
_SUMMARY_FIELDS = (
    ("target_role", "profile_confirm.role"),
    ("seniority_target", "profile_confirm.seniority"),
    ("location", "profile_confirm.location"),
    ("experience_years", "profile_confirm.years"),
    ("skills", "profile_confirm.skills"),
    ("languages", "profile_confirm.languages"),
)
_MISSING_LABEL = {
    "name": "profile_confirm.name",
    "email": "profile_confirm.email",
    **dict(_SUMMARY_FIELDS),
}
_MAX_SUMMARY_VALUE = 120


def _db_path() -> str:
    return os.environ.get("JHT_DB") or str(_home() / "jobs.db")


def _card_state_path() -> Path:
    return _home() / "state" / "profile-confirm-card.json"


def _read_card_state() -> dict[str, Any]:
    try:
        value = json.loads(_card_state_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def _write_card_state(state: dict[str, Any]) -> None:
    _atomic_bytes(_card_state_path(), (json.dumps(state, ensure_ascii=False) + "\n").encode("utf-8"))


@contextlib.contextmanager
def _card_lock() -> Iterator[None]:
    """One asker at a time: the Assistente can call twice in the same second."""
    directory = _card_state_path().parent
    directory.mkdir(parents=True, exist_ok=True)
    with (directory / "profile-confirm-card.lock").open("a") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def _catalog() -> tuple[Any, Any]:
    shared = str(Path(__file__).resolve().parent.parent)  # shared/ is not on the path when this runs from skills/
    if shared not in sys.path:
        sys.path.insert(0, shared)
    try:
        from i18n import t, tf  # type: ignore
    except ImportError:
        raise ProfileReviewError("catalog_unavailable") from None
    return t, tf


def _parsed(value: Any, edges: str) -> Any:
    """The structure a text holds (`{'region': 'EU'}`, as str() writes it, or JSON), or None while it is not one."""
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not (text.startswith(edges[0]) and text.endswith(edges[1])) or len(text) > 600:
        return None
    try:
        return ast.literal_eval(text)
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        return None


def _flat_record(value: Any) -> dict[str, Any] | None:
    """A record of plain values, from a dict or from the text of one: the profile file may hold either.
    Anything else, nested or longer than a card line, is not one."""
    value = _parsed(value, "{}")
    if not isinstance(value, dict) or not value or len(value) > 12:
        return None
    if any(not isinstance(k, str) or not isinstance(v, (str, int, float, bool)) for k, v in value.items()):
        return None
    return value


def _flat_records(value: Any) -> list[dict[str, Any]] | None:
    """A list of flat records (the profile schema keeps work_authorization so), from a list or from its text; each
    item may itself be the text of a record. None when any item is not one."""
    value = _parsed(value, "[]")
    if not isinstance(value, list) or not value or len(value) > 6:
        return None
    records = [_flat_record(item) for item in value]
    return None if any(record is None for record in records) else records  # type: ignore[return-value]


def _field_label(t: Any, name: str) -> str:
    """A profile field named for the person: the catalog's words for the ones it has (a nested name by its last part),
    else the name without underscores."""
    for candidate in (name, name.rsplit(".", 1)[-1]):
        key = f"profile_confirm.field.{candidate}"
        label = t(key)
        if label and label != key:
            return label
    spaced = name.replace("_", " ").replace(".", " ").strip()
    return spaced[:1].upper() + spaced[1:]


def _record_words(name: str, record: dict[str, Any], t: Any) -> str:
    """A record said in words, not as the program holds it: what the person is allowed first and where in brackets
    (work authorization), any other as `Name: value` pairs."""
    if name.rsplit(".", 1)[-1] == "work_authorization" and set(record) == {"region", "status"}:
        region = _text(record["region"])
        if region.isalpha() and len(region) <= 3:  # a region code is written in capitals, whatever the Assistant wrote
            region = region.upper()
        return f"{_text(record['status'])} ({region})"
    return ", ".join(f"{_field_label(t, str(k))}: {_text(v)}" for k, v in record.items())


def _short(value: Any) -> str:
    if isinstance(value, (list, tuple)):
        text = ", ".join(_text(item) for item in value if _text(item))
    elif isinstance(value, dict):
        text = ", ".join(f"{str(k).replace('_', ' ')}: {_text(v)}" for k, v in sorted(value.items(), key=lambda kv: str(kv[0])))
    else:
        text = _text(value)
    text = " ".join(text.split())
    return text if len(text) <= _MAX_SUMMARY_VALUE else text[: _MAX_SUMMARY_VALUE - 1] + "…"


def _value_at(profile: dict[str, Any], path: str) -> Any:
    node: Any = profile
    for part in path.split("."):
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node


def _inferred_names(raw: str, review: dict[str, Any]) -> list[str]:
    """The fields the person's CV did not say, as the caller names them. A name that is neither one of the eight
    fields nor a field of the review is refused: a typo must not silently drop the mark."""
    names = [item.strip() for item in raw.split(",") if item.strip()]
    known = set(FIELDS) | {change["field"] for change in review["changes"]}
    # a record the review expanded (`work_authorization.region`, `work_authorization.status`) can be named as a whole
    known |= {".".join(parts[:i]) for field in list(known) for parts in [field.split(".")] for i in range(1, len(parts))}
    if any(name not in known for name in names):
        raise ProfileReviewError("inferred_unknown")
    return names


def summary_text(envelope: dict[str, Any], inferred: list[str]) -> str:
    """What the card says: the fields of the review in plain words, the deduced ones marked as such."""
    t, tf = _catalog()
    view = _view(envelope["profile"])
    mark = f" ({t('profile_confirm.deduced')})"
    lines = [t("profile_confirm.intro"), ""]
    for field, label in _SUMMARY_FIELDS:
        value = view.get(field)
        if field == "experience_years":
            shown = tf("profile_confirm.years_value", value) if value is not None else ""
        elif field in ("skills", "languages"):
            shown = _short(value[:6] if field == "skills" else value[:4])
        else:
            shown = _short(value)
        if shown:
            lines.append(f"- {t(label)}: {shown}" + (mark if field in inferred else ""))
    shown_fields = {field for field, _ in _SUMMARY_FIELDS}
    for name in inferred:  # a deduced preference the eight fields do not carry: said by its own name
        if name in shown_fields or name in FIELDS:
            continue
        raw = _value_at(envelope["profile"], name)
        records = _flat_records(raw) or ([_flat_record(raw)] if _flat_record(raw) else [])
        value = _short("; ".join(_record_words(name, record, t) for record in records) if records else raw)
        if value:
            lines.append(f"- {_field_label(t, name)}: {value}{mark}")
    missing = [t(_MISSING_LABEL[field]) for field in envelope.get("missing", []) if field in _MISSING_LABEL]
    if missing:
        lines += ["", tf("profile_confirm.missing", ", ".join(missing))]
    lines += ["", t("profile_confirm.outro")]
    return "\n".join(lines)


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
        answer, _question = aq.validated_answer(
            conn, CARD_AGENT, {"id": row[0], "source_id": row[1], "source_payload": row[2]}
        )
    except aq.AnswerRejected:
        return {"scelte": [], "origine": "invalid"}
    return answer


def _card_is_open(conn: sqlite3.Connection, question_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM pending_user_messages WHERE source_id = ? AND source_action = 'agent_question'", (question_id,)
    ).fetchone()
    return row is not None and _stored_answer(conn, question_id) is None


def ask_confirm(inferred_raw: str = "") -> dict[str, Any]:
    """Post the confirmation card for the review waiting, unless a card for it is already open.

    Never a second card while the first has no answer; a new one when the last was answered with «correct»,
    expired or is gone (the person wrote «yes, save» in words and the card is no longer to be found)."""
    import first_run  # type: ignore

    t, _tf = _catalog()
    with _card_lock():
        review = status()
        if review is None:
            raise ProfileReviewError("no_review")
        if review["stale"]:
            raise ProfileReviewError("stale")
        envelope = _read_envelope()
        inferred = _inferred_names(inferred_raw, review)
        state = _read_card_state()
        same = state.get("review_id") == review["review_id"]
        question_id = state.get("question_id") if same else None
        try:
            with contextlib.closing(sqlite3.connect(f"file:{_db_path()}?mode=ro", uri=True, timeout=10)) as conn:
                if isinstance(question_id, str):
                    answer = _stored_answer(conn, question_id)
                    if answer is None and _card_is_open(conn, question_id):
                        return {"asked": False, "open": True, "question_id": question_id, "review_id": review["review_id"]}
                    if answer is not None and answer.get("origine") == "utente" and answer.get("scelte") == [CONFIRM_OPTION]:
                        return {"asked": False, "confirmed": True, "question_id": question_id, "review_id": review["review_id"]}
        except sqlite3.Error:
            raise ProfileReviewError("database_unreadable") from None
        cards = state.get("cards", 0) if same and isinstance(state.get("cards"), int) else 0
        if cards >= MAX_CARDS_PER_REVIEW:
            raise ProfileReviewError("too_many_cards")
        card = {
            "subject": t("profile_confirm.subject"),
            "text": summary_text(envelope, inferred),
            "options": [
                {"id": CONFIRM_OPTION, "label": t("profile_confirm.confirm")},
                {"id": CORRECT_OPTION, "label": t("profile_confirm.correct")},
            ],
        }
        posted, why = first_run._post_plan_card(CARD_AGENT, card)  # the one way a card is posted
        if posted is None:
            raise ProfileReviewError("card_not_posted")
        _write_card_state({"review_id": review["review_id"], "question_id": posted, "cards": cards + 1})
        return {"asked": True, "question_id": posted, "review_id": review["review_id"]}


def apply_confirmed() -> dict[str, Any]:
    """Save the review that the person confirmed with the card. Nothing else saves it from the chat.

    The answer is read the way the question tool believes answers (checked, rebuilt), and it must be the person's
    own (`utente`): not the expiry, not the system. The card must be the one of the review waiting."""
    import agent_questions as aq  # type: ignore

    state = _read_card_state()
    question_id = state.get("question_id")
    if not isinstance(question_id, str):
        raise ProfileReviewError("no_card")
    review = status()
    if review is None:
        raise ProfileReviewError("no_review")
    if review["stale"]:
        raise ProfileReviewError("stale")
    if state.get("review_id") != review["review_id"]:
        raise ProfileReviewError("card_outdated")
    try:
        with contextlib.closing(sqlite3.connect(f"file:{_db_path()}?mode=ro", uri=True, timeout=10)) as conn:
            answer = _stored_answer(conn, question_id)
    except sqlite3.Error:
        raise ProfileReviewError("database_unreadable") from None
    if answer is None:
        raise ProfileReviewError("not_answered")
    if answer.get("origine") != "utente":
        raise ProfileReviewError("not_confirmed")
    if answer.get("scelte") == [CORRECT_OPTION]:
        raise ProfileReviewError("wants_correction")
    if answer.get("scelte") != [CONFIRM_OPTION]:
        raise ProfileReviewError("not_confirmed")
    receipt = confirm(review["review_id"])
    receipt["missing"] = review["missing"]
    return receipt


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("stage")
    sub.add_parser("status")
    confirm_parser = sub.add_parser("confirm")
    confirm_parser.add_argument("review_id")
    ask_parser = sub.add_parser("ask-confirm")
    ask_parser.add_argument(
        "--inferred", default="", help="comma-separated fields the CV did not say (deduced), marked as such on the card"
    )
    sub.add_parser("apply-confirmed")
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "stage":
            result: Any = stage()
        elif args.command == "status":
            result = status()
        elif args.command == "ask-confirm":
            result = ask_confirm(args.inferred)
        elif args.command == "apply-confirmed":
            result = apply_confirmed()
        else:
            result = confirm(args.review_id)
    except ProfileReviewError as exc:
        print(json.dumps({"ok": False, "error": exc.code}))
        return 1
    key = {"confirm": "receipt", "apply-confirmed": "receipt", "ask-confirm": "card"}.get(args.command, "review")
    print(json.dumps({"ok": True, key: result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
