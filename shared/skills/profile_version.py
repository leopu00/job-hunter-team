#!/usr/bin/env python3
"""profile_version.py — which version of the profile the search was built on, and whether it has changed since.

The burst starts with the least profile (a role, a place, a language) while the questionnaire goes on. The Scout built its
circles from that profile; when the questionnaire ends and the profile holds the specialty, the areas, the work mode, the
Scout has to read them and widen or narrow its circles at its next round, without starting from zero: the pass log and the
positions it inserted stay where they are.

The version is a hash of the fields the search depends on, in four groups, so that the Scout is told WHICH changed:

  roles      the target role(s) and their priority list, the category and specialty, the seniority sought
  places     where: the location, the preferred places, the geography, relocation, citizenship, work authorization
  languages  the languages the person speaks, with their level
  mode       the work mode (remote, hybrid, on site)

Everything else in the profile (name, email, experience, skills text, summaries) changes without changing the version: a
card of the questionnaire that does not touch the search does not wake anybody. The file the version is read from is the
profile itself, whoever wrote it (the Assistente writes the YAML directly), so nothing has to call this when it writes.

  current                  the version now, with the hash of each group (and null when the profile cannot be read)
  sync                     the same, and `state/profile-version` written when it differs from what is there
  check --agent A          sync; then compare with the version A has seen: {changed, first, version, groups}.
                           The first time an agent asks it has nothing to compare with: it is taken to have built its
                           circles on the profile as it is now (`first: true`, `changed: false`) and the version is
                           recorded as seen. Every later call says `changed: true` until A has acknowledged.
  ack --agent A            A has read the profile again and rebuilt its circles: the version now is the one it has seen

What it prints is the version, the group names and booleans: never a value of the profile.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import tempfile
import time
from pathlib import Path

GROUPS = ("roles", "places", "languages", "mode")
AGENT = re.compile(r"^[a-z][a-z0-9_-]{0,39}$")


def home() -> Path:
    return Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht"))


def profile_path() -> Path:
    return home() / "profile" / "candidate_profile.yml"


def version_path() -> Path:
    return home() / "state" / "profile-version"


def seen_path(agent: str) -> Path:
    return home() / "state" / "profile-seen" / f"{agent}.json"


def _text(value) -> str:
    return re.sub(r"\s+", " ", value.strip().lower()) if isinstance(value, str) else ""


def _first(*values):
    """The first of the places the value can be in that holds something."""
    for value in values:
        if value is None or value == "" or value == [] or value == {}:
            continue
        return value
    return None


def _canon(value):
    """A value as it counts for the hash: texts lowered and gathered, numbers and booleans as they are, mappings by key."""
    if isinstance(value, str):
        return _text(value)
    if isinstance(value, bool) or isinstance(value, (int, float)):
        return value
    if isinstance(value, list):
        return [_canon(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _canon(item) for key, item in sorted(value.items(), key=lambda kv: str(kv[0]))}
    return None


def _sorted(value):
    """A list whose order carries no meaning (places, languages): sorted by its canonical form."""
    items = value if isinstance(value, list) else ([] if value is None else [value])
    return sorted((_canon(item) for item in items), key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))


def _languages(value):
    items = value if isinstance(value, list) else []
    out = []
    for item in items:
        if isinstance(item, dict):
            name = _first(item.get("language"), item.get("name"), item.get("code"))
            out.append({"language": _text(name) if isinstance(name, str) else "", "level": _canon(item.get("level"))})
        elif isinstance(item, str):
            out.append({"language": _text(item), "level": None})
    return sorted(out, key=lambda item: json.dumps(item, sort_keys=True, ensure_ascii=False))


def groups_of(profile) -> dict:
    """{group: value} of the fields the search depends on; the value is what is hashed."""
    if not isinstance(profile, dict):
        return {}
    cand = profile.get("candidate") if isinstance(profile.get("candidate"), dict) else {}
    pers = profile.get("personal") if isinstance(profile.get("personal"), dict) else {}
    prefs = profile.get("preferences") if isinstance(profile.get("preferences"), dict) else {}
    pos = profile.get("positioning") if isinstance(profile.get("positioning"), dict) else {}
    return {
        "roles": {
            "target_role": _canon(_first(profile.get("target_role"), cand.get("target_role"))),
            "target_roles": _canon(_first(profile.get("target_roles"), cand.get("target_roles"))),
            "target_roles_priority": _canon(_first(profile.get("target_roles_priority"), cand.get("target_roles_priority"))),
            "category": _canon(profile.get("target_role_category_id")),
            "specialty": _canon(profile.get("target_specialty")),
            "seniority": _canon(_first(profile.get("seniority_target"), pos.get("seniority_target"))),
        },
        "places": {
            "location": _canon(_first(profile.get("location"), pers.get("location"))),
            "preferred": _sorted(_first(profile.get("location_preferences"), prefs.get("location_preferences"))),
            "geography": _sorted(prefs.get("geography")),
            "relocation": _canon(_first(prefs.get("relocation"), profile.get("relocation"))),
            "citizenship": _sorted(_first(cand.get("citizenship"), profile.get("citizenship"))),
            "work_authorization": _canon(prefs.get("work_authorization")),
        },
        "languages": _languages(_first(cand.get("languages"), profile.get("languages"))),
        "mode": _canon(_first(prefs.get("work_mode"), profile.get("work_mode"))),
    }


def _hash(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()[:16]


def read_profile(path: Path | None = None):
    """The profile as a mapping, None when it is missing, unreadable, empty or not a mapping."""
    try:
        import yaml
        data = yaml.safe_load((path or profile_path()).read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001 — a half-written file raises many things: no version, never a guess
        return None
    return data if isinstance(data, dict) and data else None


def current(path: Path | None = None) -> dict:
    """{version, groups: {name: hash}} of the profile now; version is None when the profile cannot be read."""
    data = read_profile(path)
    if data is None:
        return {"version": None, "groups": {}}
    groups = {name: _hash(value) for name, value in groups_of(data).items()}
    return {"version": _hash(groups), "groups": groups}


def _read_json(path: Path):
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else None
    except (OSError, ValueError):
        return None


def _write_json(path: Path, value: dict) -> bool:
    """Atomically, so a reader never sees half a file; False when it cannot be written."""
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(value, handle, sort_keys=True)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.unlink(tmp)
            except OSError:
                pass
            raise
        return True
    except OSError:
        return False


def sync(path: Path | None = None) -> dict:
    """The version now; `state/profile-version` is written when it differs from the one there."""
    now = current(path)
    if now["version"] is None:
        return now
    stored = _read_json(version_path())
    if not stored or stored.get("version") != now["version"]:
        _write_json(version_path(), {"version": now["version"], "groups": now["groups"], "changed_at": time.time()})
    return now


def check(agent: str, path: Path | None = None) -> dict:
    """What `agent` has to know: nothing changed, the first look, or the groups that changed since it last acknowledged."""
    now = sync(path)
    if now["version"] is None:
        return {"ok": True, "version": None, "changed": False, "first": False, "groups": [], "reason": "the profile cannot be read"}
    seen = _read_json(seen_path(agent))
    if not seen or not isinstance(seen.get("version"), str):
        _write_json(seen_path(agent), {"version": now["version"], "groups": now["groups"], "at": time.time()})
        return {"ok": True, "version": now["version"], "changed": False, "first": True, "groups": []}
    if seen["version"] == now["version"]:
        return {"ok": True, "version": now["version"], "changed": False, "first": False, "groups": []}
    before = seen.get("groups") if isinstance(seen.get("groups"), dict) else {}
    changed = [name for name in GROUPS if before.get(name) != now["groups"].get(name)]
    return {"ok": True, "version": now["version"], "changed": True, "first": False, "groups": changed}


def ack(agent: str, path: Path | None = None) -> dict:
    now = sync(path)
    if now["version"] is None:
        return {"ok": False, "reason": "the profile cannot be read"}
    if not _write_json(seen_path(agent), {"version": now["version"], "groups": now["groups"], "at": time.time()}):
        return {"ok": False, "reason": "the acknowledgement cannot be written"}
    return {"ok": True, "version": now["version"], "acknowledged": True}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="profile_version", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("current")
    sub.add_parser("sync")
    for name in ("check", "ack"):
        sub.add_parser(name).add_argument("--agent", required=True)
    args = ap.parse_args(argv)
    if args.cmd in ("check", "ack"):
        agent = args.agent.strip().lower()
        if not AGENT.match(agent):
            print(json.dumps({"ok": False, "reason": "agent name not valid"}))
            return 2
    if args.cmd == "current":
        out = current()
    elif args.cmd == "sync":
        out = sync()
    elif args.cmd == "check":
        out = check(agent)
    else:
        out = ack(agent)
    print(json.dumps(out, sort_keys=True, ensure_ascii=False))
    return 0 if out.get("ok", True) else 1


if __name__ == "__main__":
    sys.exit(main())
