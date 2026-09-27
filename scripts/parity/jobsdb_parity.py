#!/usr/bin/env python3
"""TUI team against API team, measured on jobs.db (parity tests B0 and B3).

The metre is not "the role runs" but "it does the same things as its TUI
twin", and it is read in the database, not in the logs. Both sides start from
the same seed, so what each one did afterwards can be compared row by row:

  seed     --from <tui jobs.db> --out <seed.db>
           A consistent copy of the TUI database at one instant, read only
           (the source is opened with mode=ro and copied with SQLite's backup).
  prepare  --seed <seed.db> --out <api jobs.db> [--force]
           The API side's database, always a fresh copy of the seed: never a
           database with a history nobody remembers, never rows deleted by
           hand (B0). Refuses a seed that holds positions of a mock run.
  diff     --tui <jobs.db> --api <jobs.db> [--seed <seed.db>] [--json]
           Field by field, by role: the rows only one side wrote, the rows
           both wrote and where they differ, and — with the seed — the seed
           rows each side changed and whether the changes agree. Then the B2
           checks: mock rows, office coordinates, agent instances.

Rows are matched by what they mean, never by id (the two sides number rows
independently): a position by its URL, a company by its name, a score, an
application or a highlight by its position. Timestamps and ids are not
compared, agents are compared by role (SCOUT-2 and scout-1 are both scout),
and free text a model writes (notes, summaries, critiques) is compared as
present or absent, since two runs never write the same sentence.

Exit status: 0 the two sides agree, 1 they differ, 2 the command failed.
Private data never goes into the repository: seeds and copies live outside
git, and the tests use synthetic rows only.
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

MOCK_SOURCE = "mock"

# Columns never compared: identities of the row, and moments.
IGNORED = {
    "id", "company_id", "position_id", "cloud_id",
    "created_at", "updated_at", "found_at", "analyzed_at", "scored_at", "written_at",
    "applied_at", "response_at", "critic_reviewed_at", "last_checked", "last_open_check",
    "write_requested_at", "geocode_requested_at", "salary_precise_requested_at",
    "expires_at", "deadline", "logo_fetched", "ts", "duration_ms",
    # Paths and drive ids of the CV files: where each side keeps them, not what it decided.
    "cv_path", "cl_path", "cv_pdf_path", "cl_pdf_path", "cv_drive_id", "cl_drive_id", "logo",
}
# Columns that name an agent: compared by role.
AGENTS = {"found_by", "last_actor", "analyzed_by", "scored_by", "written_by", "reviewed_by", "by_agent"}
# Free text a model writes: compared as present or absent.
PROSE = {
    "jd_text", "requirements", "jd_summary", "notes", "culture_notes", "red_flags", "breakdown",
    "critic_notes", "location_notes", "text", "rejection_note", "before", "after",
    "evidence_url", "evidence_hash", "evidence_code",
}
# Links compared as the same advert (url_key), not as spelled.
URLS = {"url", "website"}
# Numbers compared within a tolerance.
TOLERANCE = {"office_lat": 0.01, "office_lon": 0.01}


def role_of(agent: Any) -> str | None:
    """`SCOUT-2`, `scout-1`, `scout` → `scout`. Empty → None."""
    if agent is None:
        return None
    text = str(agent).strip().lower()
    if not text:
        return None
    return re.sub(r"[-_ ]?\d+$", "", text) or text


# Query parameters that say where a click came from, never which advert it is.
TRACKING = re.compile(r"^(utm_.*|fbclid|gclid|msclkid|mc_[a-z]+|ref|refid|referrer|trk|trackingid|src|from)$", re.I)


# Fragments that only move the page, never name an advert.
PAGE_ANCHORS = {"apply", "top", "content", "main", "description", "job-description", "jobdescription"}


def url_key(url: Any) -> str | None:
    """The same advert under small spelling differences: scheme, host case, www, trailing slash, tracking
    parameters, parameter order, an in-page anchor.

    The rest stays, because boards name the advert there and dropping it merges
    different positions into one (measured on the TUI's database): the query
    (Indeed's `jk`, an `id`) and the fragment (a careers page with one
    `#<role>` per opening).
    """
    if not url:
        return None
    parts = urlsplit(str(url).strip())
    host = parts.netloc.lower().removeprefix("www.")
    path = parts.path.rstrip("/")
    query = urlencode(sorted((k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True) if not TRACKING.match(k)))
    fragment = "" if parts.fragment.strip().lower() in PAGE_ANCHORS else parts.fragment
    return urlunsplit(("", host, path, query, fragment)).lstrip("/") or None


def _norm(value: Any) -> str:
    return " ".join(str(value or "").split()).casefold()


# ── reading a database ────────────────────────────────────────────────────


def connect_ro(path: Path) -> sqlite3.Connection:
    if not path.is_file():
        raise SystemExit(f"jobsdb_parity: {path} is not a file")
    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def _tables(conn: sqlite3.Connection) -> set[str]:
    return {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}


def _rows(conn: sqlite3.Connection, table: str) -> list[dict[str, Any]]:
    if table not in _tables(conn):
        return []
    return [dict(r) for r in conn.execute(f'SELECT * FROM "{table}" ORDER BY rowid')]


@dataclass
class Snapshot:
    """One database, with every row filed under the key that means the same thing on the other side."""

    name: str
    tables: dict[str, dict[str, dict[str, Any]]] = field(default_factory=dict)
    columns: dict[str, set[str]] = field(default_factory=dict)
    duplicates: Counter = field(default_factory=Counter)
    positions_total: int = 0
    mock_positions: int = 0
    with_office_coords: int = 0
    agents: dict[str, set[str]] = field(default_factory=lambda: defaultdict(set))


def _position_key(row: dict[str, Any]) -> str:
    return url_key(row.get("url")) or f"title:{_norm(row.get('title'))}|company:{_norm(row.get('company'))}"


def load(path: Path, name: str) -> Snapshot:
    conn = connect_ro(path)
    try:
        snap = Snapshot(name)
        positions = _rows(conn, "positions")
        by_id: dict[Any, str] = {}

        def file(table: str, key: str, row: dict[str, Any]) -> None:
            bucket = snap.tables.setdefault(table, {})
            if key in bucket:
                # Two rows that mean the same thing: the later one wins, and it is said.
                snap.duplicates[table] += 1
            bucket[key] = row
            snap.columns.setdefault(table, set()).update(row.keys())
            for column in AGENTS & row.keys():
                if row.get(column):
                    snap.agents[role_of(row[column]) or "?"].add(str(row[column]).strip().lower())

        for row in positions:
            key = _position_key(row)
            by_id[row["id"]] = key
            file("positions", key, row)
        snap.positions_total = len(positions)
        snap.mock_positions = sum(1 for r in positions if r.get("source") == MOCK_SOURCE)
        snap.with_office_coords = sum(1 for r in positions if r.get("office_lat") is not None and r.get("office_lon") is not None)

        for row in _rows(conn, "companies"):
            file("companies", f"company:{_norm(row.get('name'))}", row)
        for table in ("scores", "applications"):
            for row in _rows(conn, table):
                file(table, by_id.get(row.get("position_id"), f"position#{row.get('position_id')}"), row)
        for row in _rows(conn, "position_highlights"):
            pos = by_id.get(row.get("position_id"), f"position#{row.get('position_id')}")
            file("position_highlights", f"{pos}|{row.get('type')}|{_norm(row.get('text'))[:80]}", row)

        # Transitions and maintenance events are histories: compared as per-position sequences.
        transitions: dict[str, list[str]] = defaultdict(list)
        for row in _rows(conn, "position_state_transitions"):
            pos = by_id.get(row.get("position_id"), f"position#{row.get('position_id')}")
            transitions[pos].append(f"{row.get('from_state')}→{row.get('to_state')} by {role_of(row.get('by_agent'))}")
        for pos, steps in transitions.items():
            file("position_state_transitions", pos, {"steps": " ; ".join(steps)})
        events: dict[str, Counter] = defaultdict(Counter)
        for row in _rows(conn, "maintenance_events"):
            target = row.get("target_id")
            pos = by_id.get(int(target), f"position#{target}") if str(target or "").isdigit() else f"{row.get('target_type')}#{target}"
            events[pos][f"{row.get('action')}:{row.get('outcome')} by {role_of(row.get('by_agent'))}"] += 1
            if row.get("by_agent"):
                snap.agents[role_of(row["by_agent"]) or "?"].add(str(row["by_agent"]).strip().lower())
        for pos, counts in events.items():
            file("maintenance_events", pos, {"events": " ; ".join(f"{k} ×{n}" for k, n in sorted(counts.items()))})
        return snap
    finally:
        conn.close()


# ── comparing ─────────────────────────────────────────────────────────────

# Which role a row is filed under in the report.
ROLE_OF_ROW: dict[str, Callable[[dict[str, Any]], str | None]] = {
    "positions": lambda r: role_of(r.get("found_by")),
    "companies": lambda r: role_of(r.get("analyzed_by")),
    "scores": lambda r: role_of(r.get("scored_by")),
    "applications": lambda r: role_of(r.get("written_by")),
    "position_highlights": lambda r: "analista",
    "position_state_transitions": lambda r: None,
    "maintenance_events": lambda r: None,
}


def _comparable(table: str, column: str) -> bool:
    return column not in IGNORED and not (table == "positions" and column in {"company"})


def _value(column: str, value: Any) -> Any:
    if column in URLS:
        return url_key(value)
    if column in AGENTS:
        return role_of(value)
    if column in PROSE:
        return "present" if str(value or "").strip() else "absent"
    if isinstance(value, str):
        return " ".join(value.split())
    return value


def _same(column: str, a: Any, b: Any) -> bool:
    if column in TOLERANCE and a is not None and b is not None:
        try:
            return abs(float(a) - float(b)) <= TOLERANCE[column]
        except (TypeError, ValueError):
            return False
    return _value(column, a) == _value(column, b)


def field_diffs(table: str, a: dict[str, Any], b: dict[str, Any], columns: Iterable[str]) -> dict[str, tuple[Any, Any]]:
    out: dict[str, tuple[Any, Any]] = {}
    for column in columns:
        if not _comparable(table, column):
            continue
        if not _same(column, a.get(column), b.get(column)):
            out[column] = (_value(column, a.get(column)), _value(column, b.get(column)))
    return out


@dataclass
class TableReport:
    table: str
    only_tui: list[str] = field(default_factory=list)
    only_api: list[str] = field(default_factory=list)
    both: int = 0
    differing: dict[str, dict[str, tuple[Any, Any]]] = field(default_factory=dict)
    # With a seed: seed rows that at least one side changed, and how.
    changed_tui_only: list[str] = field(default_factory=list)
    changed_api_only: list[str] = field(default_factory=list)
    changed_both_differently: dict[str, dict[str, tuple[Any, Any]]] = field(default_factory=dict)
    changed_both_same: int = 0
    by_role: dict[str, Counter] = field(default_factory=lambda: defaultdict(Counter))
    columns_only_tui: list[str] = field(default_factory=list)
    columns_only_api: list[str] = field(default_factory=list)

    @property
    def agrees(self) -> bool:
        return not (
            self.only_tui or self.only_api or self.differing or self.changed_tui_only
            or self.changed_api_only or self.changed_both_differently
        )


def compare(tui: Snapshot, api: Snapshot, seed: Snapshot | None = None) -> list[TableReport]:
    reports: list[TableReport] = []
    for table in ROLE_OF_ROW:
        t_rows = tui.tables.get(table, {})
        a_rows = api.tables.get(table, {})
        s_rows = seed.tables.get(table, {}) if seed else {}
        rep = TableReport(table)
        t_cols, a_cols = tui.columns.get(table, set()), api.columns.get(table, set())
        rep.columns_only_tui = sorted(c for c in t_cols - a_cols if _comparable(table, c))
        rep.columns_only_api = sorted(c for c in a_cols - t_cols if _comparable(table, c))
        common = sorted(t_cols & a_cols) if t_cols and a_cols else sorted(t_cols | a_cols)
        role = ROLE_OF_ROW[table]

        for key in sorted(set(t_rows) | set(a_rows)):
            t, a, s = t_rows.get(key), a_rows.get(key), s_rows.get(key)
            if s is not None:
                # A seed row: what matters is what each side did to it.
                t_changed = field_diffs(table, s, t, common) if t is not None else {"(row)": ("present", "deleted")}
                a_changed = field_diffs(table, s, a, common) if a is not None else {"(row)": ("present", "deleted")}
                if not t_changed and not a_changed:
                    continue
                who = role(t or a or s) or "?"
                if t_changed and not a_changed:
                    rep.changed_tui_only.append(key)
                    rep.by_role[who]["seed row changed by TUI only"] += 1
                elif a_changed and not t_changed:
                    rep.changed_api_only.append(key)
                    rep.by_role[who]["seed row changed by API only"] += 1
                else:
                    diff = field_diffs(table, t or {}, a or {}, common) if t is not None and a is not None else {"(row)": ("?", "?")}
                    if diff:
                        rep.changed_both_differently[key] = diff
                        rep.by_role[who]["seed row changed differently"] += 1
                    else:
                        rep.changed_both_same += 1
                        rep.by_role[who]["seed row changed the same way"] += 1
                continue
            if t is not None and a is None:
                rep.only_tui.append(key)
                rep.by_role[role(t) or "?"]["only TUI"] += 1
            elif a is not None and t is None:
                rep.only_api.append(key)
                rep.by_role[role(a) or "?"]["only API"] += 1
            else:
                rep.both += 1
                diff = field_diffs(table, t, a, common)
                who = role(t) or role(a) or "?"
                if diff:
                    rep.differing[key] = diff
                    rep.by_role[who]["both, different"] += 1
                else:
                    rep.by_role[who]["both, same"] += 1
        reports.append(rep)
    return reports


def b2_checks(tui: Snapshot, api: Snapshot) -> dict[str, Any]:
    def coords(s: Snapshot) -> dict[str, Any]:
        share = round(100 * s.with_office_coords / s.positions_total, 1) if s.positions_total else None
        return {"positions": s.positions_total, "with_office_coordinates": s.with_office_coords, "percent": share}

    def instances(s: Snapshot) -> dict[str, list[str]]:
        return {r: sorted(v) for r, v in sorted(s.agents.items())}

    return {
        "mock_positions": {"tui": tui.mock_positions, "api": api.mock_positions},
        "office_coordinates": {"tui": coords(tui), "api": coords(api)},
        "agent_instances": {"tui": instances(tui), "api": instances(api)},
        "duplicate_keys": {"tui": dict(tui.duplicates), "api": dict(api.duplicates)},
    }


# ── reporting ─────────────────────────────────────────────────────────────


def _sample(keys: list[str], n: int = 5) -> str:
    shown = ", ".join(keys[:n])
    return shown + (f" … (+{len(keys) - n})" if len(keys) > n else "")


def render_text(reports: list[TableReport], checks: dict[str, Any], seeded: bool) -> str:
    lines: list[str] = []
    for rep in reports:
        status = "same" if rep.agrees else "DIFFERENT"
        lines.append(f"== {rep.table}: {status}")
        if rep.columns_only_tui or rep.columns_only_api:
            lines.append(f"   columns only TUI: {rep.columns_only_tui}  only API: {rep.columns_only_api}")
        lines.append(f"   only TUI {len(rep.only_tui)} · only API {len(rep.only_api)} · both {rep.both} ({len(rep.differing)} different)")
        if seeded:
            lines.append(
                f"   seed rows changed: TUI only {len(rep.changed_tui_only)} · API only {len(rep.changed_api_only)} · "
                f"both, same {rep.changed_both_same} · both, different {len(rep.changed_both_differently)}"
            )
        for role, counts in sorted(rep.by_role.items()):
            lines.append(f"   [{role}] " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())))
        if rep.only_tui:
            lines.append(f"   only TUI: {_sample(rep.only_tui)}")
        if rep.only_api:
            lines.append(f"   only API: {_sample(rep.only_api)}")
        field_counts = Counter(c for d in list(rep.differing.values()) + list(rep.changed_both_differently.values()) for c in d)
        if field_counts:
            lines.append("   fields that differ: " + ", ".join(f"{c} {n}" for c, n in field_counts.most_common()))
            for key, diff in list({**rep.differing, **rep.changed_both_differently}.items())[:5]:
                shown = "; ".join(f"{c}: TUI={v[0]!r} API={v[1]!r}" for c, v in diff.items())
                lines.append(f"     {key}: {shown}")
    lines.append("== B2 checks")
    mock = checks["mock_positions"]
    lines.append(f"   mock positions: TUI {mock['tui']} · API {mock['api']}")
    oc = checks["office_coordinates"]
    lines.append(
        "   office coordinates: "
        f"TUI {oc['tui']['with_office_coordinates']}/{oc['tui']['positions']} ({oc['tui']['percent']}%) · "
        f"API {oc['api']['with_office_coordinates']}/{oc['api']['positions']} ({oc['api']['percent']}%)"
    )
    for side in ("tui", "api"):
        inst = checks["agent_instances"][side]
        lines.append(f"   agents {side.upper()}: " + "; ".join(f"{r}: {', '.join(v)}" for r, v in inst.items()))
    dup = checks["duplicate_keys"]
    if dup["tui"] or dup["api"]:
        lines.append(f"   rows sharing a key (the later kept): TUI {dup['tui']} · API {dup['api']}")
    return "\n".join(lines)


def render_json(reports: list[TableReport], checks: dict[str, Any]) -> str:
    def table(rep: TableReport) -> dict[str, Any]:
        return {
            "agrees": rep.agrees,
            "only_tui": rep.only_tui,
            "only_api": rep.only_api,
            "both": rep.both,
            "differing": {k: {c: list(v) for c, v in d.items()} for k, d in rep.differing.items()},
            "seed_changed_tui_only": rep.changed_tui_only,
            "seed_changed_api_only": rep.changed_api_only,
            "seed_changed_both_same": rep.changed_both_same,
            "seed_changed_both_differently": {k: {c: list(v) for c, v in d.items()} for k, d in rep.changed_both_differently.items()},
            "by_role": {r: dict(c) for r, c in rep.by_role.items()},
            "columns_only_tui": rep.columns_only_tui,
            "columns_only_api": rep.columns_only_api,
        }

    return json.dumps({"tables": {r.table: table(r) for r in reports}, "b2": checks}, indent=2, ensure_ascii=False, default=str)


# ── seed and prepare (B0) ─────────────────────────────────────────────────


def seed(source: Path, out: Path, force: bool = False) -> int:
    if out.exists() and not force:
        raise SystemExit(f"jobsdb_parity: {out} exists (use --force to replace it)")
    src = connect_ro(source)
    try:
        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(out.name + ".partial")
        tmp.unlink(missing_ok=True)
        dst = sqlite3.connect(tmp)
        try:
            src.backup(dst)
            check = dst.execute("PRAGMA integrity_check").fetchone()[0]
            if check != "ok":
                raise SystemExit(f"jobsdb_parity: the copy failed its integrity check: {check}")
            dst.execute("PRAGMA journal_mode = DELETE")
        finally:
            dst.close()
        tmp.replace(out)
        out.chmod(0o600)
    finally:
        src.close()
    return 0


def prepare(seed_path: Path, out: Path, force: bool = False) -> int:
    snap = load(seed_path, "seed")
    if snap.mock_positions:
        raise SystemExit(
            f"jobsdb_parity: the seed holds {snap.mock_positions} position(s) of a mock run: it is not a seed"
        )
    if out.exists() and not force:
        raise SystemExit(f"jobsdb_parity: {out} exists (use --force: the API side always starts from the seed)")
    for suffix in ("", "-wal", "-shm"):
        Path(f"{out}{suffix}").unlink(missing_ok=True)
    return seed(seed_path, out, force=True)


# ── command line ──────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="jobsdb_parity", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("seed", help="copy a jobs.db at one instant, read only")
    p.add_argument("--from", dest="source", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--force", action="store_true")
    p = sub.add_parser("prepare", help="the API side's jobs.db, fresh from the seed")
    p.add_argument("--seed", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    p.add_argument("--force", action="store_true")
    p = sub.add_parser("diff", help="compare the TUI's jobs.db with the API's")
    p.add_argument("--tui", type=Path, required=True)
    p.add_argument("--api", type=Path, required=True)
    p.add_argument("--seed", type=Path)
    p.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    try:
        if args.command == "seed":
            return seed(args.source, args.out, args.force)
        if args.command == "prepare":
            return prepare(args.seed, args.out, args.force)
        tui = load(args.tui, "tui")
        api = load(args.api, "api")
        base = load(args.seed, "seed") if args.seed else None
        reports = compare(tui, api, base)
        checks = b2_checks(tui, api)
        print(render_json(reports, checks) if args.json else render_text(reports, checks, base is not None))
        return 0 if all(r.agrees for r in reports) else 1
    except SystemExit as exc:
        if isinstance(exc.code, str):
            print(exc.code, file=sys.stderr)
            return 2
        raise
    except sqlite3.Error as exc:
        print(f"jobsdb_parity: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
