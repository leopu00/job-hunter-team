#!/usr/bin/env python3
"""profile_exclusions.py — the exclusions of the user's profile that act on the score (JHT-T24).

The user can accept a PROPOSAL to exclude a kind of position (the proposals come from the reasons they
gave when they turned positions down, JHT-T05). An accepted exclusion is a rule the CODE applies, never
text an agent reads:

  code              what it matches (frozen when the user accepts, from the structured columns of the
                    positions they had turned down with that reason)           penalty
  company           company_id of those positions                                -30
  wrong_location    loc_country_code of those positions (not fully remote)       -15
  salary_low        the highest salary_estimated_max among them, per currency    -15
  wrong_stack       role_family of those positions (never «Other»)               -15

`db_insert.py score` subtracts the penalties of the exclusions a position matches (at most CAP in all)
and writes one line with the reasons at the top of the breakdown. The Scout only gets them as a search
hint (`db_query.py profile-exclusions`): it never skips a position because of them (SC-04).
too_senior and too_junior are not here: the seniority is not a column yet (JHT-T45).

This file is the ONLY writer of the table. It is the user's decision: it refuses when an agent runs it
(JHT_AGENT_NAME is set), as the user's own commands from the app never carry that variable.

    python3 profile_exclusions.py list [--json]
    python3 profile_exclusions.py accept CODE          derive the parameters from the local judgements
    python3 profile_exclusions.py withdraw CODE        it stops acting on the next score
    python3 profile_exclusions.py reconcile            stdin: JSON [{"reason": CODE, "status": "accepted"|"dismissed"}]

Output: one JSON line on stdout. Exit 0 done, 1 refused, 2 usage.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _db import ensure_schema, get_db  # noqa: E402
from feedback_reasons import ACTING, LABELS  # noqa: E402

CODES = ACTING
# What each code takes off the total, once per matching exclusion; the sum never takes off more than CAP.
PENALTY = {"company": 30, "wrong_location": 15, "salary_low": 15, "wrong_stack": 15}
CAP = 30
ACTIVE, WITHDRAWN = "active", "withdrawn"
# The catch-all of the role-family registry says nothing about the stack.
CATCH_ALL_FAMILY = "Other"


def _latest_rejections(conn, code):
    """The positions whose LAST judgement is a turn-down with this reason (the rule of the proposals)."""
    return [
        row[0]
        for row in conn.execute(
            """
            SELECT f.position_id FROM position_feedback f
             WHERE f.id = (SELECT f2.id FROM position_feedback f2
                            WHERE f2.position_id = f.position_id
                            ORDER BY f2.created_at DESC, f2.id DESC LIMIT 1)
               AND f.action IN ('dislike', 'hide') AND f.reason = ?
            """,
            (code,),
        )
    ]


def derive_params(conn, code):
    """The parameters of the rule, from the structured columns of the positions the user turned down."""
    ids = _latest_rejections(conn, code)
    if not ids:
        return {}
    marks = ",".join("?" for _ in ids)
    where = f"id IN ({marks})"
    if code == "company":
        rows = conn.execute(f"SELECT DISTINCT company_id FROM positions WHERE {where} AND company_id IS NOT NULL", ids)
        values = sorted(r[0] for r in rows)
        return {"company_ids": values} if values else {}
    if code == "wrong_location":
        rows = conn.execute(
            f"SELECT DISTINCT UPPER(TRIM(loc_country_code)) FROM positions WHERE {where} "
            "AND TRIM(COALESCE(loc_country_code, '')) <> '' "
            "AND COALESCE(remote_type, '') <> 'full_remote' AND COALESCE(work_mode, '') <> 'remote'",
            ids,
        )
        values = sorted(r[0] for r in rows)
        return {"country_codes": values} if values else {}
    if code == "salary_low":
        rows = conn.execute(
            f"SELECT UPPER(TRIM(salary_estimated_currency)), MAX(salary_estimated_max) FROM positions WHERE {where} "
            "AND salary_estimated_max IS NOT NULL AND salary_estimated_max > 0 "
            "AND TRIM(COALESCE(salary_estimated_currency, '')) <> '' GROUP BY 1",
            ids,
        )
        ceilings = {r[0]: int(r[1]) for r in rows}
        return {"ceilings": dict(sorted(ceilings.items()))} if ceilings else {}
    if code == "wrong_stack":
        rows = conn.execute(
            f"SELECT DISTINCT TRIM(role_family) FROM positions WHERE {where} "
            "AND TRIM(COALESCE(role_family, '')) <> '' AND TRIM(role_family) <> ?",
            [*ids, CATCH_ALL_FAMILY],
        )
        values = sorted(r[0] for r in rows)
        return {"role_families": values} if values else {}
    return {}


def matches(position, code, params):
    """Whether a position (a mapping of its columns) is of the kind the exclusion describes."""
    if code == "company":
        return position.get("company_id") is not None and position["company_id"] in params.get("company_ids", [])
    if code == "wrong_location":
        country = (position.get("loc_country_code") or "").strip().upper()
        remote = position.get("remote_type") == "full_remote" or position.get("work_mode") == "remote"
        return bool(country) and not remote and country in params.get("country_codes", [])
    if code == "salary_low":
        top = position.get("salary_estimated_max")
        currency = (position.get("salary_estimated_currency") or "").strip().upper()
        ceiling = params.get("ceilings", {}).get(currency)
        return top is not None and ceiling is not None and top <= ceiling
    if code == "wrong_stack":
        family = (position.get("role_family") or "").strip()
        return bool(family) and family in params.get("role_families", [])
    return False


def active(conn):
    """[(code, params)] of the exclusions in force, in a fixed order."""
    if not conn.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='profile_exclusions'").fetchone():
        return []
    found = []
    for code, params in conn.execute(
        "SELECT code, params FROM profile_exclusions WHERE status = ?", (ACTIVE,)
    ):
        if code not in CODES:
            continue
        try:
            parsed = json.loads(params)
        except (TypeError, ValueError):
            continue
        if isinstance(parsed, dict):
            found.append((code, parsed))
    return sorted(found, key=lambda item: CODES.index(item[0]))


def penalty_for(conn, position_id):
    """(points to take off, [codes that matched]) for a position; (0, []) when none does."""
    rules = active(conn)
    if not rules:
        return 0, []
    row = conn.execute(
        "SELECT company_id, loc_country_code, remote_type, work_mode, salary_estimated_max, "
        "salary_estimated_currency, role_family FROM positions WHERE id = ?",
        (position_id,),
    ).fetchone()
    if row is None:
        return 0, []
    names = ("company_id", "loc_country_code", "remote_type", "work_mode", "salary_estimated_max",
             "salary_estimated_currency", "role_family")
    position = dict(zip(names, tuple(row)))
    hit = [code for code, params in rules if matches(position, code, params)]
    return min(CAP, sum(PENALTY[code] for code in hit)), hit


def breakdown_line(points, codes):
    """The line the score carries on top of its breakdown: the fixed phrases and the codes, nothing else."""
    named = ", ".join(f"{LABELS.get(code, code)} ({code})" for code in codes)
    return f"EXCLUSION -{points}: {named}"


# ── the writer ─────────────────────────────────────────────────────────────────

def _refuse(code, **extra):
    print(json.dumps({"ok": False, "code": code, **extra}, sort_keys=True))
    return 1


def accept(conn, code):
    if code not in CODES:
        return _refuse("code_invalid", valid=list(CODES))
    params = derive_params(conn, code)
    if not params:
        return _refuse("no_evidence")
    conn.execute(
        "INSERT INTO profile_exclusions (code, status, params, decided_at) "
        "VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now')) "
        "ON CONFLICT(code) DO UPDATE SET status = excluded.status, params = excluded.params, "
        "decided_at = excluded.decided_at",
        (code, ACTIVE, json.dumps(params, sort_keys=True, separators=(",", ":"))),
    )
    conn.commit()
    print(json.dumps({"ok": True, "code": code, "status": ACTIVE, "params": params}, sort_keys=True))
    return 0


def withdraw(conn, code):
    if code not in CODES:
        return _refuse("code_invalid", valid=list(CODES))
    conn.execute(
        "UPDATE profile_exclusions SET status = ?, decided_at = strftime('%Y-%m-%d %H:%M:%f', 'now') "
        "WHERE code = ?",
        (WITHDRAWN, code),
    )
    conn.commit()
    print(json.dumps({"ok": True, "code": code, "status": WITHDRAWN}, sort_keys=True))
    return 0


def listing(conn):
    rows = []
    for code, status, params, decided_at in conn.execute(
        "SELECT code, status, params, decided_at FROM profile_exclusions"
    ):
        if code in CODES:
            rows.append({"code": code, "status": status, "decided_at": decided_at,
                         "label": LABELS.get(code, code), "params": json.loads(params or "{}")})
    rows.sort(key=lambda r: CODES.index(r["code"]))
    return rows


def reconcile(conn, decisions):
    """The user's decisions kept in the cloud, brought to the local table: accepted -> active (the
    parameters are derived here, from the local judgements), dismissed -> withdrawn. A code the cloud
    decided before and this team cannot turn into a rule (no evidence) is reported, not hidden."""
    unusable = []
    for decision in decisions:
        code, status = decision.get("reason"), decision.get("status")
        if code not in CODES:
            continue  # seniority and the like: not here yet
        if status == "accepted":
            current = conn.execute("SELECT status FROM profile_exclusions WHERE code = ?", (code,)).fetchone()
            if current is not None and current[0] == ACTIVE:
                continue  # already in force: the parameters stay as they were frozen
            params = derive_params(conn, code)
            if not params:
                unusable.append(code)
                continue
            conn.execute(
                "INSERT INTO profile_exclusions (code, status, params, decided_at) "
                "VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now')) "
                "ON CONFLICT(code) DO UPDATE SET status = excluded.status, params = excluded.params, "
                "decided_at = excluded.decided_at",
                (code, ACTIVE, json.dumps(params, sort_keys=True, separators=(",", ":"))),
            )
        elif status == "dismissed":
            conn.execute("UPDATE profile_exclusions SET status = ? WHERE code = ? AND status = ?",
                         (WITHDRAWN, code, ACTIVE))
    conn.commit()
    print(json.dumps({"ok": True, "unusable": sorted(set(unusable))}, sort_keys=True))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="profile_exclusions.py")
    sub = parser.add_subparsers(dest="op", required=True)
    lst = sub.add_parser("list")
    lst.add_argument("--json", action="store_true")
    for name in ("accept", "withdraw"):
        sub.add_parser(name).add_argument("code")
    sub.add_parser("reconcile")
    args = parser.parse_args(argv)

    if args.op != "list" and os.environ.get("JHT_AGENT_NAME", "").strip():
        return _refuse("user_only")
    conn = get_db()
    ensure_schema(conn)
    try:
        if args.op == "list":
            print(json.dumps({"ok": True, "exclusions": listing(conn)}, sort_keys=True))
            return 0
        if args.op == "accept":
            return accept(conn, args.code)
        if args.op == "withdraw":
            return withdraw(conn, args.code)
        raw = sys.stdin.read(65536)
        try:
            decisions = json.loads(raw)
        except ValueError:
            return _refuse("input_invalid")
        if not isinstance(decisions, list) or not all(isinstance(d, dict) for d in decisions):
            return _refuse("input_invalid")
        return reconcile(conn, decisions)
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
