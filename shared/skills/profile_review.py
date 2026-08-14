#!/usr/bin/env python3
"""Stage and atomically confirm candidate-profile changes extracted from a CV.

The Assistant writes only the fields extracted from the uploaded document to
``$JHT_AGENT_DIR/profile-review.yml`` and invokes ``stage``.  The canonical
profile is deliberately untouched until the user confirms the review in the
desktop UI.  ``confirm`` is a compare-and-swap: a concurrent profile change
invalidates the review instead of being overwritten.

The JSON printed by this helper is a machine contract.  It contains no paths
and never prints profile values on errors; the UI receives the review values
only from ``status`` after a valid, owner-only envelope has been read.
"""

from __future__ import annotations

import argparse
import contextlib
import copy
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any, Iterator

import yaml


MAX_PROFILE_BYTES = 64 * 1024
MAX_REVIEW_BYTES = 128 * 1024
SCHEMA_VERSION = 1
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
    direct = _text(profile.get("email"))
    if direct:
        return direct
    candidate = profile.get("candidate")
    contacts = candidate.get("contacts") if isinstance(candidate, dict) else None
    if isinstance(contacts, dict) and _text(contacts.get("email")):
        return _text(contacts.get("email"))
    positioning = profile.get("positioning")
    contacts = positioning.get("contacts") if isinstance(positioning, dict) else None
    return _text(contacts.get("email")) if isinstance(contacts, dict) else ""


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


def _review_id(base_hash: str, profile: dict[str, Any]) -> str:
    canonical = json.dumps(
        {"base_hash": base_hash, "profile": profile},
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
    expected = _review_id(str(envelope.get("base_hash", "")), envelope["profile"])
    if expected != envelope["review_id"]:
        raise ProfileReviewError("review_invalid")
    if not isinstance(envelope.get("changes"), list) or not isinstance(envelope.get("missing"), list):
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
        before = _view(base)
        after = _view(merged)
        changes = [
            {"field": field, "value": after[field]}
            for field in FIELDS
            if before[field] != after[field]
        ]
        if not changes:
            raise ProfileReviewError("no_changes")
        required = _required(after)
        base_hash = _hash(base_raw)
        envelope = {
            "schema_version": SCHEMA_VERSION,
            "review_id": _review_id(base_hash, merged),
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
    _, current_raw = _read_profile()
    return _public_review(envelope, stale=_hash(current_raw) != envelope["base_hash"])


def confirm(review_id: str) -> dict[str, Any]:
    if not REVIEW_ID_RE.fullmatch(review_id):
        raise ProfileReviewError("review_id_invalid")
    with profile_lock():
        envelope = _read_envelope()
        if envelope["review_id"] != review_id:
            raise ProfileReviewError("review_mismatch")
        _, current_raw = _read_profile()
        if _hash(current_raw) != envelope["base_hash"]:
            raise ProfileReviewError("profile_changed")
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


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("stage")
    sub.add_parser("status")
    confirm_parser = sub.add_parser("confirm")
    confirm_parser.add_argument("review_id")
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "stage":
            result: Any = stage()
        elif args.command == "status":
            result = status()
        else:
            result = confirm(args.review_id)
    except ProfileReviewError as exc:
        print(json.dumps({"ok": False, "error": exc.code}))
        return 1
    print(json.dumps({"ok": True, "review" if args.command != "confirm" else "receipt": result}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
