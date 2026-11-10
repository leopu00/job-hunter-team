#!/usr/bin/env python3
"""db_role_policy.py — what each ROLE may write with `db_insert.py` and `db_update.py`.

Until now the boundary «the Scout never writes companies, scores, applications or highlights» lived in the prompt (SC-03)
and, only in the native harness, in `agent-harness/runtime/src/db/role-policy.ts`. An agent on a shell (Pi, the TUIs) could
run any entity. This module puts the same table in the Python tools: `db_role_policy.json` is that table written out
(`roles`), with a vitest test that fails when it drifts from the TypeScript one, plus the few writes of the TUI the native
table does not have (`python_only`, each with its reason).

Who is the caller: `JHT_AGENT_NAME`, exported by the launcher in every agent's terminal (`scout-2` → role `scout`). No
variable = the person, the app, a script or a test: nothing is checked. A name that is not a role of the table (a service's
own identity) is not checked either.

⚠️ LIMIT, declared: the variable is the agent's own environment, so this is a brake on an agent that follows a wrong text or
a habit — «run db_insert.py score» read in a page or a message — not a wall against one that sets the variable itself or
opens jobs.db directly. What makes it a wall is the database file's permissions or a broker, which is not this module.

What is checked, per call, before any SQL:
  * the ENTITY (`db_insert` position|company|score|application|highlight, `db_update` position|company|application);
  * for `db_update position|application`, the COLUMNS the flags write, and the STATUS the call moves to;
  * `--notes` only together with the exclusion, where the table says so (scorer, scrittore);
  * for the Scout (`ownRowsOnly`, `touches`): only a position it found itself, and only while it is `new`.
Native-only, not checked here: the status a row comes FROM for the other roles, the narrower columns of later statuses, the
proof that closes a live position, rescore tickets, and the Critic's verdict gate on `ready`: they are bound into the
native tool's UPDATE and need what only it has.

A refusal exits 13, says why on stderr and appends one line to `$JHT_HOME/logs/db-role-refusals.jsonl` (time, role, who,
entity, what was asked: names of flags, never their values). The name is shown as [a-z0-9_-], at most 64 characters, and the
log stops growing at 256 KB (the refusals go on). A name that is not exactly a role plus an optional number (`scout-2-x`)
is not a role of the table and is not checked: the same limit as above. If the table cannot be read, an agent is NOT
refused (the product keeps working) and the stderr and the log say the boundary is off.
"""
from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path

POLICY_FILE = Path(__file__).with_name("db_role_policy.json")
REFUSED_EXIT = 13
# Flags that name the row or the writer, not a column of the entity.
NOT_COLUMNS = {"entity", "id", "name", "position_id"}
# The check log of `maintenance_log.add_cli_args`: it records the round, it is not data of the row.
LOG_FLAGS = {"action", "outcome", "evidence_kind", "evidence_url", "evidence_code", "evidence_hash", "duration_ms"}

_cache: dict = {}


def _validated(data) -> dict:
    """The table or a ValueError: valid JSON that is not the table must open the boundary loudly, not crash a tool halfway."""
    if not isinstance(data, dict) or not isinstance(data.get("roles"), dict) or not data["roles"]:
        raise ValueError("no roles")
    for role, entry in data["roles"].items():
        if not isinstance(entry, dict) or not isinstance(entry.get("insert"), list) or not isinstance(entry.get("update"), list):
            raise ValueError("role %s" % role)
    if not isinstance(data.get("python_only", {}), dict):
        raise ValueError("python_only")
    return data


def policy() -> dict:
    if not _cache:
        _cache.update(_validated(json.loads(POLICY_FILE.read_text(encoding="utf-8"))))
    return _cache


def role_of(name) -> str | None:
    """`scout-2` → `scout`; None when it is not a role of the table (a service's identity, a person)."""
    role = re.sub(r"-\d+$", "", str(name or "").strip().lower())
    return role if role in policy()["roles"] else None


def caller(environ=None) -> tuple:
    """(role, name) of who runs the tool, or (None, name) when it is not an agent of the table.

    The variable is read BEFORE the table: the person, the app and the tests have none, and a table that is missing or
    broken must not stop them. For an agent, an unreadable table opens the boundary and says so loudly (stderr and the
    refusal log): the product keeps working, and the day the file breaks is not silent."""
    name = str((os.environ if environ is None else environ).get("JHT_AGENT_NAME") or "").strip()
    if not name:
        return None, ""
    try:
        return role_of(name), clean_name(name)
    except Exception:   # a missing file, broken JSON, or valid JSON that is not the table: the boundary opens, loudly
        print("⚠️  ROLE TABLE UNREADABLE (%s): the role boundary is NOT applied to %s" % (POLICY_FILE.name, clean_name(name)), file=sys.stderr)
        _write_log({"ts": _now(), "agent": clean_name(name), "reason": "role table unreadable: boundary not applied", "enforced": False})
        return None, clean_name(name)


def clean_name(name) -> str:
    """The agent's name as it is shown and written down: lower case, [a-z0-9_-], at most 64 characters."""
    return re.sub(r"[^a-z0-9_-]", "?", str(name or "").strip().lower())[:64]


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


LOG_MAX_BYTES = 262144   # an agent that repeats a refused command cannot fill the disk: past this the lines stop, the refusal stays


def _write_log(line: dict) -> None:
    try:
        log = Path(os.environ.get("JHT_HOME") or str(Path.home() / ".jht")) / "logs" / "db-role-refusals.jsonl"
        log.parent.mkdir(parents=True, exist_ok=True)
        if log.exists() and log.stat().st_size >= LOG_MAX_BYTES:
            return
        with open(log, "a", encoding="utf-8") as handle:
            handle.write(json.dumps(line, ensure_ascii=False) + "\n")
    except OSError:
        pass   # the refusal stands even when it cannot be written down


def _extra(role: str) -> dict:
    return policy().get("python_only", {}).get(role, {})


def _entities(role: str, verb: str) -> set:
    return set(policy()["roles"][role][verb]) | set(_extra(role).get(verb, []))


def given_columns(args) -> set:
    """The flags this call writes: every flag with a value, but the ones that only name the row."""
    return {k for k, v in vars(args).items() if k not in NOT_COLUMNS and v is not None and v is not False}


class _Refusal(Exception):
    def __init__(self, entity, flags, reason):
        super().__init__(reason)
        self.entity, self.flags, self.reason = entity, flags, reason


def _refuse(role, name, verb, entity, flags, reason):
    """Signals a refusal from a check; `_answer` turns it into the exit, or into a warning for a role in `warn_only`."""
    raise _Refusal(entity, flags, reason)


def _answer(role: str, name: str, verb: str, refusal: _Refusal) -> None:
    warn = bool(_extra(role).get("warn_only"))
    _write_log({"ts": _now(), "role": role, "agent": name, "tool": "db_" + verb, "entity": refusal.entity,
                "flags": sorted(refusal.flags), "reason": refusal.reason, "enforced": not warn})
    print("⚠️  ROLE %s: %s (%s) may not run db_%s %s: %s" % ("WARNING" if warn else "REFUSED", name or role, role, verb, refusal.entity,
                                                              refusal.reason), file=sys.stderr)
    if not warn:
        sys.exit(REFUSED_EXIT)


def guard_insert(args, environ=None) -> None:
    role, name = caller(environ)
    if role is None:
        return
    try:
        _check_insert(role, name, args)
    except _Refusal as refusal:
        _answer(role, name, "insert", refusal)


def _check_insert(role, name, args) -> None:
    if args.entity not in _entities(role, "insert"):
        allowed = sorted(_entities(role, "insert"))
        _refuse(role, name, "insert", args.entity, [],
                "the %s inserts %s" % (role, ", ".join(allowed) if allowed else "nothing in the database"))


def _position_rule(role: str) -> dict | None:
    return policy()["roles"][role].get("position")


def _application_rule(role: str) -> dict | None:
    rule = dict(policy()["roles"][role].get("application") or {})
    extra = _extra(role).get("application") or {}
    if not rule and not extra:
        return None
    fields = set(rule.get("fields", [])) | set(extra.get("fields", [])) | set(extra.get("extra_fields", []))
    statuses = set(rule.get("statuses", [])) | set(extra.get("statuses", []))
    return {"fields": fields, "statuses": statuses}


def guard_update(args, fetch_position=None, environ=None) -> None:
    """Refuse a `db_update` the role may not make. `fetch_position(id)` → (status, found_by) or None, for the Scout's rule."""
    role, name = caller(environ)
    if role is None:
        return
    try:
        _check_update(role, name, args, fetch_position)
    except _Refusal as refusal:
        _answer(role, name, "update", refusal)


def _check_update(role, name, args, fetch_position) -> None:
    entity = args.entity
    flags = given_columns(args)
    if entity not in _entities(role, "update"):
        allowed = sorted(_entities(role, "update"))
        _refuse(role, name, "update", entity, flags, "the %s updates %s" % (role, ", ".join(allowed) if allowed else "nothing in the database"))
    if entity == "company":
        return                                  # an entity the table gives whole (the Analista's registry)
    if entity == "position":
        rule = _position_rule(role)
        if rule is None:
            _refuse(role, name, "update", entity, flags, "the %s has no position update" % role)
        columns = flags - LOG_FLAGS
        if rule["fields"] != "*":
            extra = columns - set(rule["fields"])
            if extra:
                _refuse(role, name, "update", entity, flags,
                        "its columns are %s; not %s" % (", ".join(sorted(rule["fields"])), ", ".join(sorted(extra))))
        status = getattr(args, "status", None)
        if status is not None and status not in rule["moves"]:
            _refuse(role, name, "update", entity, flags,
                    "it moves a position to %s, not to %s" % (", ".join(sorted(rule["moves"])) or "no status", status))
        only = rule.get("onlyWith") or {}
        for flag, with_status in only.items():
            if getattr(args, flag, None) is not None and status != with_status:
                _refuse(role, name, "update", entity, flags, "--%s goes only with --status %s" % (flag.replace("_", "-"), with_status))
        if rule.get("ownRowsOnly"):   # the Scout; the other roles' from-status rules are native-only (see the top of this file)
            row = fetch_position(args.id) if fetch_position else None
            if row is not None:
                current, found_by = row
                if rule.get("touches") and current not in rule["touches"]:
                    _refuse(role, name, "update", entity, flags,
                            "it touches positions in %s; #%s is %s" % (", ".join(rule["touches"]), args.id, current))
                if rule.get("ownRowsOnly") and str(found_by or "").strip().lower() != name.lower():
                    _refuse(role, name, "update", entity, flags, "it updates only the positions it found itself")
        return
    if entity == "application":
        rule = _application_rule(role)
        if rule is None:
            _refuse(role, name, "update", entity, flags, "the %s has no application update" % role)
        columns = flags - LOG_FLAGS
        extra = columns - rule["fields"] - {"status"}
        if extra:
            _refuse(role, name, "update", entity, flags,
                    "its columns are %s; not %s" % (", ".join(sorted(rule["fields"])), ", ".join(sorted(extra))))
        status = getattr(args, "status", None)
        if status is not None and status not in rule["statuses"]:
            _refuse(role, name, "update", entity, flags, "it sets an application to %s, not to %s" % (", ".join(sorted(rule["statuses"])) or "no status", status))


def fetch_position_row(conn, position_id):
    """(status, found_by) of a position, for the Scout's rule; None when there is no such row."""
    row = conn.execute("SELECT status, found_by FROM positions WHERE id = ?", (position_id,)).fetchone()
    if row is None:
        return None
    return (row[0], row[1]) if not hasattr(row, "keys") else (row["status"], row["found_by"])
