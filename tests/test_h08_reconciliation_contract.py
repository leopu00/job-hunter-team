"""Static fail-closed contract for the H-08 history reconciliation.

The PostgreSQL oracle exercises effects on the private schema-only snapshot;
these tests independently bind every timestamp alias to immutable repository
bytes and keep the forward migration inside its explicit allowlist.
"""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
MANIFEST = ROOT / "supabase" / "migration-anchors.v1.json"
RECONCILIATION = MIGRATIONS / "081_live_schema_reconciliation.sql"


def _manifest() -> dict:
    return json.loads(MANIFEST.read_text())


def _function_definition(sql: str, name: str) -> str:
    marker = f"CREATE OR REPLACE FUNCTION public.{name}"
    if marker not in sql:
        marker = f"CREATE OR REPLACE FUNCTION {name}"
    start = sql.index(marker)
    end = sql.index("\n$$;", start) + len("\n$$;")
    return sql[start:end]


def test_anchor_manifest_is_exactly_the_timestamped_noop_set():
    manifest = _manifest()
    assert manifest["schema_version"] == 1
    anchors = manifest["anchors"]
    assert len(anchors) == 54

    expected_paths = {
        path.relative_to(ROOT).as_posix()
        for path in MIGRATIONS.glob("[0-9]" * 14 + "_*.sql")
    }
    declared_paths = {anchor["path"] for anchor in anchors}
    assert declared_paths == expected_paths
    assert len({anchor["version"] for anchor in anchors}) == 54

    for anchor in anchors:
        assert set(anchor) == {
            "version",
            "remote_name",
            "path",
            "blob_sha256",
            "statement_md5",
            "canonical_versions",
        }
        assert re.fullmatch(r"\d{14}", anchor["version"])
        assert re.fullmatch(r"[0-9a-f]{64}", anchor["blob_sha256"])
        assert re.fullmatch(r"[0-9a-f]{32}", anchor["statement_md5"])
        assert re.fullmatch(r"\d{3}", anchor["canonical_versions"][0])

        path = ROOT / anchor["path"]
        assert path.name == (
            f'{anchor["version"]}_{anchor["remote_name"]}.sql'
        )
        raw = path.read_bytes()
        assert hashlib.sha256(raw).hexdigest() == anchor["blob_sha256"]

        # Anchors reconcile ledger identity only. Removing comments and
        # whitespace must leave no SQL for a migration runner to execute.
        executable = re.sub(r"--[^\n]*", "", raw.decode()).strip()
        assert executable == ""


def test_live_only_aliases_are_owned_only_by_forward_migration_081():
    anchors = _manifest()["anchors"]
    live_only = {
        anchor["remote_name"]
        for anchor in anchors
        if anchor["canonical_versions"] == ["081"]
    }
    assert live_only == {
        "add_role_family_to_positions",
        "add_structured_location_columns",
    }
    assert RECONCILIATION.is_file()
    reconciliation = RECONCILIATION.read_text()
    assert "idx_positions_role_family" in reconciliation
    # These belonged to the timestamped location DDL but migration 053 later
    # removed them as unused. Reconciliation targets the final catalog.
    for retired_index in (
        "idx_positions_loc_country_code",
        "idx_positions_work_mode",
        "idx_positions_loc_continent",
    ):
        assert retired_index not in reconciliation


def test_081_has_only_the_selected_072_and_075_function_bodies():
    sql = RECONCILIATION.read_text()
    created = set(
        re.findall(
            r"create\s+or\s+replace\s+function\s+"
            r"(?:public\.)?([a-z_]+)",
            sql,
            flags=re.IGNORECASE,
        )
    )
    assert {
        "reject_stale_applied_position_downgrade",
        "sync_confirm_positions_applied",
        "team_state_stamp_cloud_push_check",
        "delete_account_data",
        "redeem_cloud_sync_pairing",
        "cleanup_pairing_sessions",
    } <= created
    assert {
        "mark_position_applied",
        "sync_upsert_applications",
        "undo_manual_position_application",
    }.isdisjoint(created)

    # This is deliberately not migration 018's dynamic rewrite. Only the
    # three policies introduced later by migration 054 may be replaced.
    dropped_policies = re.findall(
        r'drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+'
        r"on\s+public\.team_directives",
        sql,
        flags=re.IGNORECASE,
    )
    assert dropped_policies == [
        "users insert own team directives",
        "users select own team directives",
        "users update own team directives",
    ]


def test_081_function_bodies_equal_their_final_canonical_sources():
    reconciliation = RECONCILIATION.read_text()
    sources = {
        "reject_stale_applied_position_downgrade": "072_application_state_invariant.sql",
        "sync_confirm_positions_applied": "072_application_state_invariant.sql",
        "team_state_stamp_cloud_push_check": "073_cloud_push_observation.sql",
        "delete_account_data": "074_tenant_edges_and_atomic_account_delete.sql",
        "redeem_cloud_sync_pairing": "075_cloud_sync_pairing_oneshot.sql",
        "cleanup_pairing_sessions": "075_cloud_sync_pairing_oneshot.sql",
    }
    for function, source_name in sources.items():
        source = (MIGRATIONS / source_name).read_text()
        assert _function_definition(reconciliation, function) == (
            _function_definition(source, function)
        )


def test_late_account_tables_remain_in_export_and_cascade_census():
    account_tables = (ROOT / "web/lib/account-data-tables.ts").read_text()
    export_columns = (ROOT / "web/lib/account-export-columns.ts").read_text()
    for table in (
        "team_directive_request_ledger",
        "candidate_profile_sync_state",
        "user_settings",
    ):
        assert f'"{table}"' in account_tables
        assert re.search(rf"\b{table}:\s*\[", export_columns)
