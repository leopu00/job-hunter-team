#!/usr/bin/env python3
"""Fail-closed pre-deploy canary for the versioned live Supabase schema.

The only remote operation is Supabase Management API's dedicated
``database/query/read-only`` endpoint. The response is reduced to versioned
check identifiers; project identity, credentials and raw catalog rows are
never emitted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, ContextManager, Protocol


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MANIFEST = ROOT / "supabase/live-schema/078-084.v3.json"
WEB_MANIFEST = ROOT / "supabase/live-schema/078-086.web.v6.json"
PREFLIGHT_QUERY = ROOT / "supabase/live-schema/081-preflight.v1.sql"
PREFLIGHT_MANIFEST = ROOT / "supabase/live-schema/081-preflight.v1.json"
CATALOG_ORDERED_MIGRATIONS = [
    "supabase/migrations/078_positions_write_request_kind.sql",
    "supabase/migrations/079_team_directive_events_atomic.sql",
    "supabase/migrations/080_profile_snapshot_atomic.sql",
    "supabase/migrations/081_live_schema_reconciliation.sql",
    "supabase/migrations/082_download_clicks_tiktok_source.sql",
    "supabase/migrations/083_position_ticket_state_model.sql",
    "supabase/migrations/084_cloud_sync_pairing_attempts.sql",
]
# Il contratto web arriva due migrazioni più in là del catalog: verifica
# applications.updated_at (085) e le due RPC dell'esito candidatura (086). Le
# due fasi hanno contratti distinti proprio perché possono coprire finestre
# diverse.
WEB_ORDERED_MIGRATIONS = CATALOG_ORDERED_MIGRATIONS + [
    "supabase/migrations/085_applications_updated_at.sql",
    "supabase/migrations/086_position_outcome.sql",
]
API_ORIGIN = "https://api.supabase.com"
MAX_RESPONSE_BYTES = 64 * 1024
MAX_MANIFEST_BYTES = 64 * 1024
MAX_QUERY_BYTES = 512 * 1024
PROJECT_REF_RE = re.compile(r"^[a-z0-9]{20}$")
ACCESS_TOKEN_RE = re.compile(r"^[A-Za-z0-9._~+/=-]{16,4096}$")
CONTRACT_ID_RE = re.compile(r"^[a-z0-9][a-z0-9.-]{2,80}$")
CHECK_ID_RE = re.compile(r"^[0-9]{3}\.[a-z0-9_.-]{3,120}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MUTATING_SQL_RE = re.compile(
    r"\b(?:ALTER|ANALYZE|CALL|COPY|CREATE|DELETE|DO|DROP|EXECUTE|GRANT|"
    r"INSERT|MERGE|REFRESH|RESET|REVOKE|SET|TRUNCATE|UPDATE|VACUUM)\b",
    re.IGNORECASE,
)
NON_CATALOG_FUNCTION_RE = re.compile(
    r"\b(?!pg_catalog\.)[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*\s*\(",
    re.IGNORECASE,
)
NON_CATALOG_RELATION_RE = re.compile(
    r"\b(?:FROM|JOIN)\s+(?!pg_catalog\.)[a-z_][a-z0-9_]*\." r"[a-z_][a-z0-9_]*\b",
    re.IGNORECASE,
)


class HTTPResponse(Protocol):
    def read(self, amount: int = -1) -> bytes: ...

    def getcode(self) -> int: ...

    def __enter__(self) -> "HTTPResponse": ...

    def __exit__(self, *args: object) -> None: ...


OpenUrl = Callable[..., ContextManager[HTTPResponse]]


class CanaryError(RuntimeError):
    """A sanitized, finite failure classification safe for release logs."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class Contract:
    contract_id: str
    expected_checks: tuple[str, ...]
    query: str
    phase: str = "catalog"


@dataclass(frozen=True)
class CanaryResult:
    contract_id: str
    passed: tuple[str, ...]
    failed: tuple[str, ...]

    @property
    def ok(self) -> bool:
        return not self.failed


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _repo_path(value: object) -> Path:
    if not isinstance(value, str) or not value or "\\" in value:
        raise CanaryError("manifest_invalid")
    candidate = (ROOT / value).resolve()
    try:
        candidate.relative_to(ROOT)
    except ValueError as exc:
        raise CanaryError("manifest_invalid") from exc
    if not candidate.is_file():
        raise CanaryError("manifest_invalid")
    return candidate


def _load_manifest(path: Path) -> dict[str, object]:
    """Read one small, unambiguous JSON document.

    Duplicate keys are invalid instead of inheriting ``json.loads``'s
    last-value-wins behaviour. That keeps the hash pins seen by reviewers the
    same ones consumed by the release gate.
    """

    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise CanaryError("manifest_invalid") from exc
    if len(raw) > MAX_MANIFEST_BYTES:
        raise CanaryError("manifest_invalid")

    def object_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise CanaryError("manifest_invalid")
            result[key] = value
        return result

    try:
        document = json.loads(raw.decode("utf-8"), object_pairs_hook=object_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CanaryError("manifest_invalid") from exc
    if not isinstance(document, dict):
        raise CanaryError("manifest_invalid")
    return document


def _decode_json(raw: bytes, error_code: str) -> object:
    def object_pairs(pairs: list[tuple[str, object]]) -> dict[str, object]:
        result: dict[str, object] = {}
        for key, value in pairs:
            if key in result:
                raise CanaryError(error_code)
            result[key] = value
        return result

    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=object_pairs)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise CanaryError(error_code) from exc


def _strip_sql_literals_and_comments(sql: str) -> str:
    """Keep executable tokens while blanking strings and comments.

    This is deliberately a small lexer, not a SQL parser. The remote endpoint
    is independently read-only; this local guard prevents even attempting a
    mutating statement if the versioned query is edited incorrectly.
    """

    output: list[str] = []
    index = 0
    state = "normal"
    while index < len(sql):
        char = sql[index]
        next_char = sql[index + 1] if index + 1 < len(sql) else ""
        if state == "normal":
            if char == "'":
                state = "string"
                output.append(" ")
            elif char == "-" and next_char == "-":
                state = "line_comment"
                output.extend((" ", " "))
                index += 1
            elif char == "/" and next_char == "*":
                state = "block_comment"
                output.extend((" ", " "))
                index += 1
            else:
                output.append(char)
        elif state == "string":
            output.append("\n" if char == "\n" else " ")
            if char == "'" and next_char == "'":
                output.append(" ")
                index += 1
            elif char == "'":
                state = "normal"
        elif state == "line_comment":
            output.append("\n" if char == "\n" else " ")
            if char == "\n":
                state = "normal"
        else:
            output.append("\n" if char == "\n" else " ")
            if char == "*" and next_char == "/":
                output.append(" ")
                index += 1
                state = "normal"
        index += 1
    if state in {"string", "block_comment"}:
        raise CanaryError("query_not_read_only")
    return "".join(output)


def validate_read_only_query(
    query: str, *, allow_public_relations: bool = False
) -> None:
    if not isinstance(query, str) or not query.strip():
        raise CanaryError("query_not_read_only")
    executable = _strip_sql_literals_and_comments(query)
    if not re.match(r"^\s*(?:WITH|SELECT)\b", executable, re.IGNORECASE):
        raise CanaryError("query_not_read_only")
    if (
        ";" in executable
        or "\\" in executable
        or MUTATING_SQL_RE.search(executable)
        or NON_CATALOG_FUNCTION_RE.search(executable)
        or (not allow_public_relations and NON_CATALOG_RELATION_RE.search(executable))
    ):
        raise CanaryError("query_not_read_only")


def load_contract(
    manifest_path: Path = DEFAULT_MANIFEST, *, phase: str = "catalog"
) -> Contract:
    manifest = _load_manifest(manifest_path)
    if (
        set(manifest)
        != {
            "schema_version",
            "contract_id",
            "clone_contract",
            "migrations",
            "query",
            "expected_checks",
        }
        or manifest.get("schema_version") != 1
    ):
        raise CanaryError("manifest_invalid")

    contract_id = manifest.get("contract_id")
    if not isinstance(contract_id, str) or not CONTRACT_ID_RE.fullmatch(contract_id):
        raise CanaryError("manifest_invalid")

    ordered = WEB_ORDERED_MIGRATIONS if phase == "web" else CATALOG_ORDERED_MIGRATIONS
    clone = manifest.get("clone_contract")
    if not isinstance(clone, dict) or clone != {
        "baseline": "live-schema-only-pg-dump",
        "contains_user_rows": False,
        "postgres_major": 16,
        "ordered_migrations": ordered,
    }:
        raise CanaryError("manifest_invalid")

    migrations = manifest.get("migrations")
    if not isinstance(migrations, list) or len(migrations) != len(ordered):
        raise CanaryError("manifest_invalid")
    migration_paths: list[str] = []
    for entry in migrations:
        if not isinstance(entry, dict) or set(entry) != {"path", "sha256"}:
            raise CanaryError("manifest_invalid")
        digest = entry.get("sha256")
        if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
            raise CanaryError("manifest_invalid")
        path = _repo_path(entry.get("path"))
        if _sha256(path) != digest:
            raise CanaryError("manifest_stale")
        migration_paths.append(path.relative_to(ROOT).as_posix())
    if migration_paths != clone["ordered_migrations"]:
        raise CanaryError("manifest_invalid")

    query_entry = manifest.get("query")
    if not isinstance(query_entry, dict) or set(query_entry) != {"path", "sha256"}:
        raise CanaryError("manifest_invalid")
    query_digest = query_entry.get("sha256")
    if not isinstance(query_digest, str) or not SHA256_RE.fullmatch(query_digest):
        raise CanaryError("manifest_invalid")
    query_path = _repo_path(query_entry.get("path"))
    if _sha256(query_path) != query_digest:
        raise CanaryError("manifest_stale")
    try:
        query_raw = query_path.read_bytes()
        if len(query_raw) > MAX_QUERY_BYTES:
            raise CanaryError("manifest_invalid")
        query = query_raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise CanaryError("manifest_invalid") from exc
    validate_read_only_query(query)

    checks = manifest.get("expected_checks")
    if (
        not isinstance(checks, list)
        or not checks
        or checks != sorted(checks)
        or len(checks) != len(set(checks))
        or any(
            not isinstance(check, str) or not CHECK_ID_RE.fullmatch(check)
            for check in checks
        )
    ):
        raise CanaryError("manifest_invalid")
    query_checks = re.findall(r"'([0-9]{3}\.[a-z0-9_.-]+)'", query)
    if sorted(query_checks) != checks or len(query_checks) != len(set(query_checks)):
        raise CanaryError("manifest_invalid")

    return Contract(contract_id, tuple(checks), query, phase)


def load_web_contract() -> Contract:
    """Load the one pinned additive web-surface contract."""

    return load_contract(WEB_MANIFEST, phase="web")


def load_preflight_contract() -> Contract:
    manifest = _load_manifest(PREFLIGHT_MANIFEST)
    if (
        set(manifest) != {"schema_version", "contract_id", "query", "expected_checks"}
        or manifest.get("schema_version") != 1
    ):
        raise CanaryError("preflight_invalid")
    query_entry = manifest.get("query")
    checks = manifest.get("expected_checks")
    if (
        manifest.get("contract_id") != "release-0.3.9-dml-preflight-071-075"
        or not isinstance(query_entry, dict)
        or set(query_entry) != {"path", "sha256"}
        or query_entry.get("path") != "supabase/live-schema/081-preflight.v1.sql"
        or not isinstance(query_entry.get("sha256"), str)
        or not SHA256_RE.fullmatch(query_entry["sha256"])
        or not isinstance(checks, list)
    ):
        raise CanaryError("preflight_invalid")
    if _sha256(PREFLIGHT_QUERY) != query_entry.get("sha256"):
        raise CanaryError("preflight_stale")
    if (
        checks != sorted(checks)
        or len(checks) != 12
        or len(set(checks)) != 12
        or any(not isinstance(c, str) or not CHECK_ID_RE.fullmatch(c) for c in checks)
    ):
        raise CanaryError("preflight_invalid")
    try:
        query_raw = PREFLIGHT_QUERY.read_bytes()
        if len(query_raw) > MAX_QUERY_BYTES:
            raise CanaryError("preflight_invalid")
        query = query_raw.decode("utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise CanaryError("preflight_invalid") from exc
    validate_read_only_query(query, allow_public_relations=True)
    observed = tuple(sorted(re.findall(r"'([0-9]{3}\.[a-z0-9_.-]+)'", query)))
    expected = tuple(checks)
    if observed != expected:
        raise CanaryError("preflight_invalid")
    return Contract(str(manifest["contract_id"]), expected, query, "preflight")


def _rows_from_response(payload: object) -> list[object]:
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        # The beta endpoint has returned both the direct row array and these
        # two envelopes across Management API client generations. Anything
        # else is a protocol failure, never an inferred success.
        for key in ("data", "result"):
            rows = payload.get(key)
            if isinstance(rows, list) and set(payload) == {key}:
                return rows
    raise CanaryError("protocol_invalid")


def evaluate_response(contract: Contract, payload: object) -> CanaryResult:
    expected = set(contract.expected_checks)
    observed: dict[str, bool] = {}
    for row in _rows_from_response(payload):
        if not isinstance(row, dict) or set(row) != {"check_id", "ok"}:
            raise CanaryError("protocol_invalid")
        check_id = row.get("check_id")
        ok = row.get("ok")
        if (
            not isinstance(check_id, str)
            or check_id not in expected
            or not isinstance(ok, bool)
            or check_id in observed
        ):
            raise CanaryError("protocol_invalid")
        observed[check_id] = ok
    if set(observed) != expected:
        raise CanaryError("protocol_invalid")
    passed = tuple(check for check in contract.expected_checks if observed[check])
    failed = tuple(check for check in contract.expected_checks if not observed[check])
    return CanaryResult(contract.contract_id, passed, failed)


def run_live_canary(
    contract: Contract,
    *,
    access_token: str,
    project_ref: str,
    opener: OpenUrl = urllib.request.urlopen,
) -> CanaryResult:
    if not ACCESS_TOKEN_RE.fullmatch(access_token) or not PROJECT_REF_RE.fullmatch(
        project_ref
    ):
        raise CanaryError("credentials_invalid")
    endpoint = f"{API_ORIGIN}/v1/projects/{project_ref}/database/query/read-only"

    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, req, fp, code, msg, headers, newurl):
            raise CanaryError("redirect_rejected")

    if opener is urllib.request.urlopen:
        opener = urllib.request.build_opener(NoRedirect()).open

    request = urllib.request.Request(
        endpoint,
        data=json.dumps({"query": contract.query}).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {access_token}",
            "Content-Type": "application/json",
            "User-Agent": "jht-live-schema-canary/1",
        },
        method="POST",
    )
    try:
        with opener(request, timeout=20) as response:
            if response.getcode() != 201:
                raise CanaryError("transport_error")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except CanaryError:
        raise
    except (OSError, TimeoutError, urllib.error.URLError) as exc:
        # Do not relay exception strings: they may contain the URL, project
        # ref, proxy details or a response body from the remote service.
        raise CanaryError("transport_error") from exc
    if len(raw) > MAX_RESPONSE_BYTES:
        raise CanaryError("protocol_invalid")
    payload = _decode_json(raw, "protocol_invalid")
    return evaluate_response(contract, payload)


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="verify local hashes and query safety without claiming the live gate",
    )
    parser.add_argument(
        "--phase", choices=("catalog", "preflight", "web"), default="catalog"
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    try:
        # The release entrypoint is deliberately pinned. Supporting an
        # arbitrary manifest path here would let a caller select an easier
        # contract while still printing the canonical PASS banner.
        if args.phase == "catalog":
            contract = load_contract(DEFAULT_MANIFEST)
        elif args.phase == "preflight":
            contract = load_preflight_contract()
        else:
            contract = load_web_contract()
        if args.validate_only:
            print(
                f"LIVE-SCHEMA MANIFEST OK contract={contract.contract_id} "
                f"checks={len(contract.expected_checks)}"
            )
            return 0
        result = run_live_canary(
            contract,
            access_token=os.environ.get("SUPABASE_ACCESS_TOKEN", ""),
            project_ref=os.environ.get("SUPABASE_PROJECT_REF", ""),
        )
        if result.ok:
            print(
                f"LIVE-SCHEMA PASS contract={result.contract_id} "
                f"checks={len(result.passed)} endpoint=read-only"
            )
            return 0
        print(
            f"LIVE-SCHEMA FAIL contract={result.contract_id} "
            f"passed={len(result.passed)} failed={len(result.failed)} "
            f"checks={','.join(result.failed)}",
            file=sys.stderr,
        )
        return 1
    except CanaryError as exc:
        print(f"LIVE-SCHEMA FAIL code={exc.code}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
