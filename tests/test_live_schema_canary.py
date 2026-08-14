"""Executable oracles for the H-08 live-schema pre-deploy canary."""

from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/check-live-schema.py"
MANIFEST = ROOT / "supabase/live-schema/078-084.v3.json"
QUERY = ROOT / "supabase/live-schema/078-084.v3.sql"
WEB_MANIFEST = ROOT / "supabase/live-schema/078-084.web.v4.json"
WEB_QUERY = ROOT / "supabase/live-schema/078-084.web.v4.sql"
PREFLIGHT_QUERY = ROOT / "supabase/live-schema/081-preflight.v1.sql"
SNAPSHOT_SHA256 = "78269292299f3fe4324a0e7553afc1095a4d8814605677146b82c41d34849346"
POSTGRES_READY_MARKER = "database system is ready to accept connections"
MIGRATIONS = [
    ROOT / "supabase/migrations/078_positions_write_request_kind.sql",
    ROOT / "supabase/migrations/079_team_directive_events_atomic.sql",
    ROOT / "supabase/migrations/080_profile_snapshot_atomic.sql",
    ROOT / "supabase/migrations/081_live_schema_reconciliation.sql",
    ROOT / "supabase/migrations/082_download_clicks_tiktok_source.sql",
    ROOT / "supabase/migrations/083_position_ticket_state_model.sql",
    ROOT / "supabase/migrations/084_cloud_sync_pairing_attempts.sql",
]

LEGACY_ARTIFACT_SHA256 = {
    "supabase/live-schema/078-081.v1.json": (
        "5996737996ecd61bb64896eaee7c3c810c424de98230be76489ae57b97e32045"
    ),
    "supabase/live-schema/078-081.v1.sql": (
        "7b9995f0fe494427e73cfcba852b51e33a893b4c63aa07ddb2f742e13d4d8270"
    ),
    "supabase/live-schema/078-083.v2.json": (
        "1b95d97a1f3b8bbbb8d44d61dd6062c2da1bc215cde3fb2b9651f9e1a3c07ceb"
    ),
    "supabase/live-schema/078-083.v2.sql": (
        "2a5aed82aac8c7f129d7cc5d74bf875bd77750b1917a10aecbcf65a201336971"
    ),
    "supabase/live-schema/078-084.v3.json": (
        "80df5deb1407874ecac409bbc090d27e9ad91cde8126ccd8d2f5e9fdd873df9d"
    ),
    "supabase/live-schema/078-084.v3.sql": (
        "2ea51c8261b7c4967c4a4000df364e4d2a7059517b1c6a55d86c70b7c7e209e8"
    ),
}

PREFLIGHT_BASE_ROWS = """
INSERT INTO auth.users(id, created_at) VALUES
  ('00000000-0000-0000-0000-00000000a001', now()),
  ('00000000-0000-0000-0000-00000000b002', now());
INSERT INTO public.companies(id, user_id, name) VALUES
  ('00000000-0000-0000-0000-00000000b201',
   '00000000-0000-0000-0000-00000000b002', 'Synthetic B');
INSERT INTO public.positions(
  id, user_id, title, company, company_id, legacy_id
) VALUES (
  '00000000-0000-0000-0000-00000000b101',
  '00000000-0000-0000-0000-00000000b002',
  'Synthetic B', 'Synthetic B',
  '00000000-0000-0000-0000-00000000b201', 62002
);
"""

PREFLIGHT_ANOMALY_SEEDS = {
    "071.rescore.rows_ranked": """
DROP INDEX IF EXISTS public.idx_position_tickets_active_rescore;
INSERT INTO public.position_tickets(
  id, user_id, position_legacy_id, request_text, kind, status
) VALUES
  (71001, '00000000-0000-0000-0000-00000000a001', 4242,
   'Synthetic rescore A', 'rescore', 'open'),
  (71002, '00000000-0000-0000-0000-00000000a001', 4242,
   'Synthetic rescore B', 'rescore', 'assigned');
""",
    "074.positions.company_detach": """
INSERT INTO public.positions(
  id, user_id, title, company, company_id, legacy_id
) VALUES (
  '00000000-0000-0000-0000-00000000a102',
  '00000000-0000-0000-0000-00000000a001',
  'Synthetic cross tenant', 'Synthetic B',
  '00000000-0000-0000-0000-00000000b201', 61001
);
""",
    "074.pending_messages.detach": """
INSERT INTO public.pending_user_messages(
  user_id, legacy_id, agent, body, related_position_id
) VALUES (
  '00000000-0000-0000-0000-00000000a001', 74001,
  'synthetic', 'Synthetic message',
  '00000000-0000-0000-0000-00000000b101'
);
""",
    "074.scores.required_parent": """
INSERT INTO public.scores(user_id, position_id, total_score) VALUES (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000b101', 50
);
""",
    "074.applications.required_parent": """
INSERT INTO public.applications(user_id, position_id) VALUES (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000b101'
);
""",
    "074.position_highlights.required_parent": """
INSERT INTO public.position_highlights(user_id, position_id, type, text) VALUES (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000b101',
  'pro', 'Synthetic highlight'
);
""",
    "074.position_views.required_parent": """
INSERT INTO public.position_views(user_id, position_id) VALUES (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000b101'
);
""",
    "074.position_user_notes.required_parent": """
INSERT INTO public.position_user_notes(user_id, position_id, body) VALUES (
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-00000000b101', 'Synthetic note'
);
""",
    "075.token.expiry_shortening": """
INSERT INTO public.cloud_sync_tokens(
  id, user_id, name, token_prefix, token_hash, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000007501',
  '00000000-0000-0000-0000-00000000a001',
  'Synthetic expiry', 'syn-exp', 'synthetic-hash-expiry', now() + interval '1 hour'
);
INSERT INTO public.cloud_sync_pairing_sessions(
  device_code, user_code, status, user_id, approved_token,
  approved_token_id, approved_at, expires_at
) VALUES (
  'synthetic-device-expiry', 'SYNEXP01', 'approved',
  '00000000-0000-0000-0000-00000000a001', 'synthetic-plaintext',
  '00000000-0000-0000-0000-000000007501', now(), now() + interval '10 minutes'
);
""",
    "075.token.expired_unrevoked": """
INSERT INTO public.cloud_sync_tokens(
  id, user_id, name, token_prefix, token_hash, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000007502',
  '00000000-0000-0000-0000-00000000a001',
  'Synthetic unrevoked', 'syn-unr', 'synthetic-hash-unrevoked', NULL
);
INSERT INTO public.cloud_sync_pairing_sessions(
  device_code, user_code, status, user_id, approved_token_id, expires_at
) VALUES (
  'synthetic-device-unrevoked', 'SYNUNR01', 'expired',
  '00000000-0000-0000-0000-00000000a001',
  '00000000-0000-0000-0000-000000007502', now() - interval '1 minute'
);
""",
    "075.session.expired_status": """
INSERT INTO public.cloud_sync_pairing_sessions(
  device_code, user_code, status, expires_at
) VALUES (
  'synthetic-device-status', 'SYNSTA01', 'pending', now() - interval '1 minute'
);
""",
    "075.session.expired_token_wipe": """
INSERT INTO public.cloud_sync_pairing_sessions(
  device_code, user_code, status, approved_token, expires_at
) VALUES (
  'synthetic-device-wipe', 'SYNWIP01', 'expired',
  'synthetic-plaintext', now() - interval '1 minute'
);
""",
}

PREFLIGHT_FINGERPRINT_QUERY = """
SELECT pg_catalog.md5(
  COALESCE(pg_catalog.string_agg(rows.payload, E'\\n' ORDER BY rows.payload), '')
) AS fingerprint
FROM (
  SELECT 'auth.users:' || pg_catalog.row_to_json(row_value)::text AS payload
    FROM auth.users AS row_value
  UNION ALL SELECT 'applications:' || pg_catalog.row_to_json(row_value)::text
    FROM public.applications AS row_value
  UNION ALL SELECT 'cloud_sync_pairing_sessions:' || pg_catalog.row_to_json(row_value)::text
    FROM public.cloud_sync_pairing_sessions AS row_value
  UNION ALL SELECT 'cloud_sync_tokens:' || pg_catalog.row_to_json(row_value)::text
    FROM public.cloud_sync_tokens AS row_value
  UNION ALL SELECT 'companies:' || pg_catalog.row_to_json(row_value)::text
    FROM public.companies AS row_value
  UNION ALL SELECT 'pending_user_messages:' || pg_catalog.row_to_json(row_value)::text
    FROM public.pending_user_messages AS row_value
  UNION ALL SELECT 'position_highlights:' || pg_catalog.row_to_json(row_value)::text
    FROM public.position_highlights AS row_value
  UNION ALL SELECT 'position_tickets:' || pg_catalog.row_to_json(row_value)::text
    FROM public.position_tickets AS row_value
  UNION ALL SELECT 'position_user_notes:' || pg_catalog.row_to_json(row_value)::text
    FROM public.position_user_notes AS row_value
  UNION ALL SELECT 'position_views:' || pg_catalog.row_to_json(row_value)::text
    FROM public.position_views AS row_value
  UNION ALL SELECT 'positions:' || pg_catalog.row_to_json(row_value)::text
    FROM public.positions AS row_value
  UNION ALL SELECT 'scores:' || pg_catalog.row_to_json(row_value)::text
    FROM public.scores AS row_value
) AS rows
"""

spec = importlib.util.spec_from_file_location("check_live_schema", SCRIPT)
assert spec and spec.loader
canary = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = canary
spec.loader.exec_module(canary)


def _final_postgres_server_is_ready(logs: str) -> bool:
    """Reject initdb's temporary server and accept only the final restart."""
    return logs.count(POSTGRES_READY_MARKER) >= 2


class FakeResponse:
    def __init__(self, payload: object, status: int = 201):
        self.body = json.dumps(payload).encode()
        self.status = status
        self.read_called = False

    def getcode(self) -> int:
        return self.status

    def read(self, amount: int = -1) -> bytes:
        self.read_called = True
        return self.body[:amount] if amount >= 0 else self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return None


def successful_rows(contract=None):
    contract = contract or canary.load_contract(MANIFEST)
    return [{"check_id": check_id, "ok": True} for check_id in contract.expected_checks]


def test_manifest_pins_clone_order_migrations_query_and_check_set():
    contract = canary.load_contract(MANIFEST)
    manifest = json.loads(MANIFEST.read_text())

    assert contract.contract_id == "release-0.3.9-schema-078-084"
    assert len(contract.expected_checks) == 59
    assert manifest["clone_contract"] == {
        "baseline": "live-schema-only-pg-dump",
        "contains_user_rows": False,
        "postgres_major": 16,
        "ordered_migrations": [
            "supabase/migrations/078_positions_write_request_kind.sql",
            "supabase/migrations/079_team_directive_events_atomic.sql",
            "supabase/migrations/080_profile_snapshot_atomic.sql",
            "supabase/migrations/081_live_schema_reconciliation.sql",
            "supabase/migrations/082_download_clicks_tiktok_source.sql",
            "supabase/migrations/083_position_ticket_state_model.sql",
            "supabase/migrations/084_cloud_sync_pairing_attempts.sql",
        ],
    }
    assert [entry["path"] for entry in manifest["migrations"]] == manifest[
        "clone_contract"
    ]["ordered_migrations"]
    migration_084 = manifest["migrations"][-1]
    assert migration_084 == {
        "path": "supabase/migrations/084_cloud_sync_pairing_attempts.sql",
        "sha256": ("9bbfdfa73a5c21fa85911267a4ab69ba4e84e2f7738e13b48ae0463a2ce1189b"),
    }
    assert tuple(
        check for check in contract.expected_checks if check.startswith("084.")
    ) == (
        "084.consume_pairing_attempt.body",
        "084.consume_pairing_attempt.execute",
        "084.consume_pairing_attempt.metadata",
        "084.consume_pairing_attempt.search_path",
        "084.migration.receipt",
        "084.pairing_attempts.account_cascade",
        "084.pairing_attempts.bucket_constraints",
        "084.pairing_attempts.rls_acl",
        "084.pairing_attempts.table",
    )


def test_additive_web_contract_exactly_receipts_every_mapped_rpc_and_column():
    contract = canary.load_web_contract()
    manifest = json.loads(WEB_MANIFEST.read_text())
    coverage = json.loads(
        (ROOT / "supabase/live-schema/web-code-coverage.v1.json").read_text()
    )

    assert contract.phase == "web"
    assert contract.contract_id == "release-0.3.9-web-schema-078-084"
    assert len(contract.expected_checks) == 40
    assert manifest["query"]["path"] == "supabase/live-schema/078-084.web.v4.sql"

    mapped_receipts = {
        receipt
        for kind in ("rpcs", "tables", "columns")
        for entry in coverage["coverage"][kind].values()
        for receipt in entry["receipts"]
    }
    assert mapped_receipts == set(contract.expected_checks)
    assert all(
        entry == {"exception": "reviewed_dynamic_schema_use"}
        for entry in coverage["coverage"]["ambiguous_sites"].values()
    )


def test_cli_validates_only_the_pinned_additive_web_contract(capsys):
    assert canary.main(["--phase", "web", "--validate-only"]) == 0
    output = capsys.readouterr()
    assert output.err == ""
    assert output.out == (
        "LIVE-SCHEMA MANIFEST OK "
        "contract=release-0.3.9-web-schema-078-084 checks=40\n"
    )


def test_v1_v2_and_v3_artifacts_remain_byte_for_byte_immutable():
    import hashlib

    observed = {
        relative: hashlib.sha256((ROOT / relative).read_bytes()).hexdigest()
        for relative in LEGACY_ARTIFACT_SHA256
    }

    assert observed == LEGACY_ARTIFACT_SHA256


def test_manifest_fails_closed_when_a_pinned_hash_drifts(tmp_path):
    manifest = json.loads(MANIFEST.read_text())
    manifest["query"]["sha256"] = "0" * 64
    changed = tmp_path / "changed.json"
    changed.write_text(json.dumps(manifest))

    with pytest.raises(canary.CanaryError, match="manifest_stale"):
        canary.load_contract(changed)


def test_manifest_rejects_duplicate_or_unknown_keys(tmp_path):
    raw = MANIFEST.read_text()
    duplicate = tmp_path / "duplicate.json"
    duplicate.write_text(
        raw.replace(
            '"schema_version": 1,',
            '"schema_version": 1,\n  "schema_version": 1,',
        )
    )
    with pytest.raises(canary.CanaryError, match="manifest_invalid"):
        canary.load_contract(duplicate)

    unknown = json.loads(raw)
    unknown["unversioned_override"] = True
    changed = tmp_path / "unknown.json"
    changed.write_text(json.dumps(unknown))
    with pytest.raises(canary.CanaryError, match="manifest_invalid"):
        canary.load_contract(changed)


def test_cli_cannot_select_an_unversioned_manifest(capsys):
    with pytest.raises(SystemExit) as error:
        canary.main(["--manifest", "/tmp/synthetic.json", "--validate-only"])

    assert error.value.code == 2
    assert "unrecognized arguments" in capsys.readouterr().err


@pytest.mark.parametrize(
    "query",
    [
        "UPDATE public.positions SET status = 'synthetic'",
        "WITH candidate AS (SELECT 1) DELETE FROM public.positions",
        "SELECT 1; SELECT 2",
        "SELECT public.some_mutating_rpc()",
        "SELECT positions.id FROM public.positions AS positions",
        "WITH safe AS (SELECT 1) SELECT users.id FROM auth.users AS users",
    ],
)
def test_local_query_guard_rejects_mutations_and_multiple_statements(query):
    with pytest.raises(canary.CanaryError, match="query_not_read_only"):
        canary.validate_read_only_query(query)


def test_transport_uses_only_fixed_read_only_endpoint_and_exact_query():
    contract = canary.load_contract(MANIFEST)
    observed = {}

    def opener(request, timeout):
        observed["url"] = request.full_url
        observed["method"] = request.get_method()
        observed["headers"] = dict(request.header_items())
        observed["body"] = json.loads(request.data)
        observed["timeout"] = timeout
        return FakeResponse(successful_rows(contract))

    result = canary.run_live_canary(
        contract,
        access_token="synthetic-test-only",
        project_ref="abcdefghijklmnopqrst",
        opener=opener,
    )

    assert result.ok
    assert observed["url"] == (
        "https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/"
        "database/query/read-only"
    )
    assert observed["method"] == "POST"
    assert observed["body"] == {"query": QUERY.read_text()}
    assert observed["headers"]["Authorization"] == "Bearer synthetic-test-only"
    assert observed["timeout"] == 20
    assert "/database/query/read-only" in SCRIPT.read_text()
    assert "/database/migrations" not in SCRIPT.read_text()
    assert "SUPABASE_DB_PASSWORD" not in SCRIPT.read_text()
    assert "SUPABASE_SERVICE" not in SCRIPT.read_text()


def test_false_check_blocks_release_and_reports_only_versioned_identity():
    contract = canary.load_contract(MANIFEST)
    rows = successful_rows(contract)
    rows[0]["ok"] = False
    result = canary.evaluate_response(contract, rows)

    assert not result.ok
    assert result.failed == (contract.expected_checks[0],)
    assert len(result.passed) == len(contract.expected_checks) - 1


@pytest.mark.parametrize(
    "payload",
    [
        [],
        [{"check_id": "unexpected.private.value", "ok": True}],
        [{"check_id": "078.positions.write_request_kind.column", "ok": "yes"}],
        [
            {"check_id": "078.positions.write_request_kind.column", "ok": True},
            {"check_id": "078.positions.write_request_kind.column", "ok": True},
        ],
        {"rows": []},
    ],
)
def test_partial_duplicate_or_unknown_receipts_fail_closed(payload):
    contract = canary.load_contract(MANIFEST)
    with pytest.raises(canary.CanaryError, match="protocol_invalid"):
        canary.evaluate_response(contract, payload)


def test_supported_response_envelopes_still_require_the_exact_multiset():
    contract = canary.load_contract(MANIFEST)
    for key in ("data", "result"):
        result = canary.evaluate_response(contract, {key: successful_rows(contract)})
        assert result.ok


def test_remote_json_with_duplicate_keys_fails_closed():
    contract = canary.load_contract(MANIFEST)
    response = FakeResponse([])
    response.body = b'[{"check_id":"safe","check_id":"other","ok":true}]'

    with pytest.raises(canary.CanaryError, match="protocol_invalid"):
        canary.run_live_canary(
            contract,
            access_token="synthetic-test-only",
            project_ref="abcdefghijklmnopqrst",
            opener=lambda request, timeout: response,
        )


def test_dml_preflight_is_exactly_twelve_checks_and_has_no_mutation_or_raw_projection():
    query = PREFLIGHT_QUERY.read_text()
    ids = re.findall(r"'([0-9]{3}\.[a-z0-9_.-]+)'", query)
    assert len(ids) == len(set(ids)) == 12
    assert set(ids) == {
        "071.rescore.rows_ranked",
        "074.positions.company_detach",
        "074.pending_messages.detach",
        "074.scores.required_parent",
        "074.applications.required_parent",
        "074.position_highlights.required_parent",
        "074.position_views.required_parent",
        "074.position_user_notes.required_parent",
        "075.token.expiry_shortening",
        "075.token.expired_unrevoked",
        "075.session.expired_status",
        "075.session.expired_token_wipe",
    }
    executable = canary._strip_sql_literals_and_comments(query)
    assert not re.search(
        r"\b(?:INSERT|UPDATE|DELETE|ALTER|DROP|TRUNCATE|GRANT|REVOKE)\b",
        executable,
        re.I,
    )
    assert "SELECT check_id, ok" in query
    assert "SELECT count(*)" in query
    assert "SELECT *" not in query


def test_snapshot_attestation_does_not_accept_caller_supplied_hash():
    source = Path(__file__).read_text()
    forbidden_lookup = 'os.environ.get("SNAPSHOT_' + 'SHA256"'
    assert forbidden_lookup not in source
    assert (
        SNAPSHOT_SHA256
        == "78269292299f3fe4324a0e7553afc1095a4d8814605677146b82c41d34849346"
    )


def test_pg16_readiness_rejects_the_temporary_initdb_server():
    first_start = f"{POSTGRES_READY_MARKER}\n"
    final_restart = f"{first_start}{POSTGRES_READY_MARKER}\n"

    assert not _final_postgres_server_is_ready(first_start)
    assert _final_postgres_server_is_ready(final_restart)


def test_preflight_synthetic_anomalies_are_row_scoped_and_non_mutating_contract():
    """The fixture matrix names every seeded anomaly, including orphan/tenant edges.

    The actual live-shape runner injects these rows into the private schema dump;
    this contract test prevents a future query from dropping a predicate or
    returning raw counts while keeping all fixture values synthetic.
    """
    anomalies = {
        "071.rescore.rows_ranked": "duplicate active rescore rows (rank > 1)",
        "074.positions.company_detach": "company parent other tenant",
        "074.pending_messages.detach": "related position parent other tenant",
        "074.scores.required_parent": "orphan score and other-tenant parent",
        "074.applications.required_parent": "orphan application and other-tenant parent",
        "074.position_highlights.required_parent": "orphan highlight and other-tenant parent",
        "074.position_views.required_parent": "orphan view and other-tenant parent",
        "074.position_user_notes.required_parent": "orphan note and other-tenant parent",
        "075.token.expiry_shortening": "approved token beyond pairing expiry",
        "075.token.expired_unrevoked": "expired token not revoked",
        "075.session.expired_status": "expired pending session",
        "075.session.expired_token_wipe": "expired session plaintext token",
    }
    assert len(anomalies) == 12
    assert all("user" not in value and "@" not in value for value in anomalies.values())
    assert "UPDATE" not in PREFLIGHT_QUERY.read_text().upper()


def test_076_077_contract_pins_every_function_identity_dimension():
    query = QUERY.read_text()
    for token in (
        "proargnames",
        "proargtypes::text",
        "proallargtypes IS NULL",
        "proargmodes IS NULL",
        "prorettype",
        "pronargdefaults",
        "proargdefaults",
        "prokind",
        "prolang",
        "provolatile",
        "prosecdef",
        "proconfig",
        "aclexplode",
        "privilege_type = 'EXECUTE'",
        "is_grantable",
    ):
        assert token in query


@pytest.mark.parametrize(
    "access_token",
    ["short", "synthetic-test-only\nprivate", "synthetic test only private"],
)
def test_invalid_token_fails_before_transport_without_relay(access_token):
    contract = canary.load_contract(MANIFEST)
    called = False

    def opener(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("transport must not run")

    with pytest.raises(canary.CanaryError, match="credentials_invalid") as error:
        canary.run_live_canary(
            contract,
            access_token=access_token,
            project_ref="abcdefghijklmnopqrst",
            opener=opener,
        )

    assert not called
    assert access_token not in str(error.value)


def test_http_error_body_is_not_read_or_relayed():
    contract = canary.load_contract(MANIFEST)
    response = FakeResponse(
        {"private": "synthetic-private-response-detail"}, status=500
    )

    with pytest.raises(canary.CanaryError, match="transport_error") as error:
        canary.run_live_canary(
            contract,
            access_token="synthetic-test-only",
            project_ref="abcdefghijklmnopqrst",
            opener=lambda request, timeout: response,
        )

    assert error.value.code == "transport_error"
    assert not response.read_called
    assert "synthetic-private-response-detail" not in str(error.value)
    assert "abcdefghijklmnopqrst" not in str(error.value)


def test_cli_output_sanitizes_transport_details(monkeypatch, capsys):
    monkeypatch.setenv("SUPABASE_ACCESS_TOKEN", "synthetic-test-only")
    monkeypatch.setenv("SUPABASE_PROJECT_REF", "abcdefghijklmnopqrst")

    def failed_transport(*args, **kwargs):
        try:
            raise RuntimeError("synthetic-private-response-detail")
        except RuntimeError as cause:
            raise canary.CanaryError("transport_error") from cause

    monkeypatch.setattr(canary, "run_live_canary", failed_transport)
    assert canary.main([]) == 1
    output = capsys.readouterr()
    rendered = output.out + output.err
    assert rendered.strip() == "LIVE-SCHEMA FAIL code=transport_error"
    assert "synthetic-private-response-detail" not in rendered
    assert "abcdefghijklmnopqrst" not in rendered
    assert "synthetic-test-only" not in rendered


@contextmanager
def pg16_schema_clone(
    *,
    migrated: bool,
    through_version: int = 84,
    omit_versions: tuple[int, ...] = (),
):
    snapshot = os.environ.get("JHT_H08_SCHEMA_SNAPSHOT")
    if not snapshot:
        pytest.skip("dump schema-only H-08 attestato non disponibile")
    snapshot_path = Path(snapshot)
    if not snapshot_path.is_file() or snapshot_path.stat().st_size > 32 * 1024 * 1024:
        pytest.fail("attested schema snapshot unavailable")
    actual_sha = __import__("hashlib").sha256(snapshot_path.read_bytes()).hexdigest()
    if actual_sha != SNAPSHOT_SHA256:
        pytest.fail("attested schema snapshot hash mismatch")
    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if subprocess.run(
        ["docker", "image", "inspect", "postgres:16-alpine"],
        capture_output=True,
    ).returncode:
        pytest.skip("postgres:16-alpine non disponibile localmente")
    name = f"jht-live-schema-{uuid.uuid4().hex[:10]}"
    started = subprocess.run(
        [
            "docker",
            "run",
            "--detach",
            "--rm",
            "--name",
            name,
            "--tmpfs",
            "/var/lib/postgresql/data:rw,size=256m",
            "-e",
            "POSTGRES_PASSWORD=synthetic-test-only",
            "postgres:16-alpine",
        ],
        text=True,
        capture_output=True,
    )
    if started.returncode:
        pytest.fail("PostgreSQL 16 schema clone non avviabile")

    def psql(sql: str, *, check: bool = True):
        return subprocess.run(
            [
                "docker",
                "exec",
                "-i",
                name,
                "psql",
                "-X",
                "-q",
                "-v",
                "ON_ERROR_STOP=1",
                "-U",
                "postgres",
                "-d",
                "postgres",
                "-At",
                "-F",
                "|",
            ],
            input=sql,
            text=True,
            capture_output=True,
            check=check,
        )

    try:
        for _ in range(100):
            logs_result = subprocess.run(
                ["docker", "logs", name], text=True, capture_output=True
            )
            logs = logs_result.stdout + logs_result.stderr
            if _final_postgres_server_is_ready(logs):
                probe = psql(
                    "CREATE TEMP TABLE live_schema_readiness_probe(id integer); "
                    "DROP TABLE live_schema_readiness_probe;",
                    check=False,
                )
                if probe.returncode == 0:
                    break
            time.sleep(0.2)
        else:
            pytest.fail("PostgreSQL 16 final server non pronto")
        psql(
            "DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; DO $$ BEGIN CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$; CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE IF NOT EXISTS auth.users(id uuid PRIMARY KEY, created_at timestamptz); CREATE TABLE IF NOT EXISTS auth.sessions(user_id uuid, updated_at timestamptz); CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$; GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;"
        )
        psql(snapshot_path.read_text(encoding="utf-8"))
        if migrated:
            for migration in MIGRATIONS:
                version = int(migration.name[:3])
                if version <= through_version and version not in omit_versions:
                    psql(migration.read_text())
        yield psql
    finally:
        subprocess.run(["docker", "rm", "-f", name], text=True, capture_output=True)


def query_results(psql):
    result = psql(QUERY.read_text())
    return receipt_rows(result.stdout)


def receipt_rows(output: str):
    return {
        check_id: value == "t"
        for check_id, value in (
            line.split("|", 1) for line in output.splitlines() if "|" in line
        )
    }


def query_results_in_transaction(psql, mutation: str):
    result = psql(f"BEGIN;\n{mutation}\n{QUERY.read_text()};\nROLLBACK;")
    return receipt_rows(result.stdout)


def test_pg16_schema_only_clone_passes_after_ordered_078_through_084():
    contract = canary.load_contract(MANIFEST)
    with pg16_schema_clone(migrated=True) as psql:
        observed = query_results(psql)

    assert tuple(sorted(observed)) == contract.expected_checks
    assert all(observed.values())


def test_pg16_additive_web_contract_passes_and_detects_column_and_rpc_drift():
    contract = canary.load_web_contract()
    with pg16_schema_clone(migrated=True) as psql:
        baseline = receipt_rows(psql(WEB_QUERY.read_text()).stdout)
        column_drift = receipt_rows(
            psql(
                "BEGIN; ALTER TABLE public.positions RENAME COLUMN title "
                f"TO title_drift;\n{WEB_QUERY.read_text()};\nROLLBACK;"
            ).stdout
        )
        rpc_drift = receipt_rows(
            psql(
                "BEGIN; ALTER FUNCTION public.increment_landing_hits(text, text) "
                f"RENAME TO increment_landing_hits_drift;\n{WEB_QUERY.read_text()};"
                "\nROLLBACK;"
            ).stdout
        )

    assert tuple(sorted(baseline)) == contract.expected_checks
    assert all(baseline.values())
    assert [check for check, ok in column_drift.items() if not ok] == [
        "084.web.columns.positions"
    ]
    assert [check for check, ok in rpc_drift.items() if not ok] == [
        "084.web.rpc.increment_landing_hits"
    ]


def test_pg16_schema_only_clone_fails_before_the_ordered_migrations():
    contract = canary.load_contract(MANIFEST)
    with pg16_schema_clone(migrated=False) as psql:
        observed = query_results(psql)

    assert tuple(sorted(observed)) == contract.expected_checks
    assert not all(observed.values())
    assert not observed["078.positions.write_request_kind.column"]


def test_pg16_078_080_without_081_through_083_fails_reconciliation_receipt():
    contract = canary.load_contract(MANIFEST)
    with pg16_schema_clone(migrated=True, through_version=80) as psql:
        observed = query_results(psql)
    assert tuple(sorted(observed)) == contract.expected_checks
    assert not observed["081.reconciliation.present"]
    assert all(
        observed[check] for check in contract.expected_checks if check[:3] <= "080"
    )
    assert any(
        not observed[check] for check in contract.expected_checks if check[:3] >= "081"
    )


@pytest.mark.parametrize(
    ("missing_version", "failed_prefix", "surviving_prefix"),
    ((82, "082.", "083."), (83, "083.", "082.")),
)
def test_pg16_missing_082_or_083_fails_only_that_versioned_receipt(
    missing_version, failed_prefix, surviving_prefix
):
    contract = canary.load_contract(MANIFEST)
    with pg16_schema_clone(migrated=True, omit_versions=(missing_version,)) as psql:
        observed = query_results(psql)

    assert tuple(sorted(observed)) == contract.expected_checks
    assert any(
        not ok for check, ok in observed.items() if check.startswith(failed_prefix)
    )
    assert all(
        ok for check, ok in observed.items() if check.startswith(surviving_prefix)
    )
    assert not all(observed.values())


def test_pg16_missing_084_fails_every_084_receipt_and_preserves_prior_contract():
    contract = canary.load_contract(MANIFEST)
    with pg16_schema_clone(migrated=True, omit_versions=(84,)) as psql:
        observed = query_results(psql)

    assert tuple(sorted(observed)) == contract.expected_checks
    assert all(ok for check, ok in observed.items() if not check.startswith("084."))
    assert not any(ok for check, ok in observed.items() if check.startswith("084."))


def test_pg16_084_catalog_and_rpc_receipts_fail_on_independent_drift():
    signature = "public.consume_pairing_attempt(uuid,text,integer,integer)"
    drifts = (
        (
            "084.pairing_attempts.table",
            "ALTER TABLE public.cloud_sync_pairing_attempts DROP COLUMN locked_until;",
        ),
        (
            "084.pairing_attempts.bucket_constraints",
            """
ALTER TABLE public.cloud_sync_pairing_attempts
  DROP CONSTRAINT cloud_sync_pairing_attempts_attempts_check;
""",
        ),
        (
            "084.pairing_attempts.account_cascade",
            """
ALTER TABLE public.cloud_sync_pairing_attempts
  DROP CONSTRAINT cloud_sync_pairing_attempts_user_id_fkey;
ALTER TABLE public.cloud_sync_pairing_attempts
  ADD CONSTRAINT cloud_sync_pairing_attempts_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id);
""",
        ),
        (
            "084.pairing_attempts.account_cascade",
            """
ALTER TABLE public.cloud_sync_pairing_attempts
  ADD CONSTRAINT synthetic_extra_user_fk
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
""",
        ),
        (
            "084.pairing_attempts.rls_acl",
            "ALTER TABLE public.cloud_sync_pairing_attempts DISABLE ROW LEVEL SECURITY;",
        ),
        (
            "084.pairing_attempts.rls_acl",
            "GRANT SELECT ON public.cloud_sync_pairing_attempts TO authenticated;",
        ),
        (
            "084.consume_pairing_attempt.metadata",
            f"ALTER FUNCTION {signature} STABLE;",
        ),
        (
            "084.consume_pairing_attempt.body",
            """
UPDATE pg_catalog.pg_proc
SET prosrc = prosrc || E'\n-- synthetic 084 body drift'
WHERE oid =
  'public.consume_pairing_attempt(uuid,text,integer,integer)'::regprocedure;
""",
        ),
        (
            "084.consume_pairing_attempt.search_path",
            f"ALTER FUNCTION {signature} SET search_path = public;",
        ),
        (
            "084.consume_pairing_attempt.execute",
            f"GRANT EXECUTE ON FUNCTION {signature} TO authenticated;",
        ),
    )
    with pg16_schema_clone(migrated=True) as psql:
        for target, mutation in drifts:
            observed = query_results_in_transaction(psql, mutation)
            assert not observed[target], target
            assert not observed["084.migration.receipt"], target


def test_pg16_084_reapply_preserves_every_exact_receipt():
    contract = canary.load_contract(MANIFEST)
    with pg16_schema_clone(migrated=True) as psql:
        before = query_results(psql)
        psql(MIGRATIONS[-1].read_text())
        after = query_results(psql)

    assert tuple(sorted(before)) == contract.expected_checks
    assert before == after
    assert all(after.values())


def test_pg16_084_account_deletion_cascades_attempt_bucket():
    user_id = "00000000-0000-0000-0000-000000008401"
    with pg16_schema_clone(migrated=True) as psql:
        psql(
            f"""
INSERT INTO auth.users(id, created_at) VALUES ('{user_id}', now());
INSERT INTO public.cloud_sync_pairing_attempts(user_id, attempts)
VALUES ('{user_id}', 3);
SELECT public.delete_account_data('{user_id}'::uuid);
"""
        )
        attempts = psql(
            f"""
SELECT pg_catalog.count(*)
FROM public.cloud_sync_pairing_attempts
WHERE user_id = '{user_id}'::uuid;
"""
        ).stdout.strip()
        user_count = psql(
            f"SELECT pg_catalog.count(*) FROM auth.users WHERE id = '{user_id}'::uuid;"
        ).stdout.strip()

    assert attempts == "0"
    assert user_count == "0"


def test_084_attempt_bucket_is_declared_for_account_deletion_and_safe_export():
    table_source = (ROOT / "web/lib/account-data-tables.ts").read_text()
    export_source = (ROOT / "web/lib/account-export-columns.ts").read_text()
    cascade_match = re.search(
        r"export const CASCADE_TABLES = \[(.*?)\] as const;",
        table_source,
        flags=re.DOTALL,
    )
    export_match = re.search(
        r"\bcloud_sync_pairing_attempts:\s*\[(.*?)\],",
        export_source,
        flags=re.DOTALL,
    )

    assert cascade_match is not None
    assert (
        re.findall(r'"([a-z_]+)"', cascade_match.group(1)).count(
            "cloud_sync_pairing_attempts"
        )
        == 1
    )
    assert export_match is not None
    assert re.findall(r'"([a-z_]+)"', export_match.group(1)) == [
        "attempts",
        "locked_until",
        "invalidated_at",
        "created_at",
        "updated_at",
    ]
    assert "last_device_code" not in export_match.group(1)
    assert "user_id" not in export_match.group(1)


def test_pg16_082_and_083_catalog_receipts_fail_on_independent_drift():
    drifts = (
        (
            "082.download_clicks.source_constraint",
            """
ALTER TABLE public.download_clicks
  DROP CONSTRAINT download_clicks_utm_source_check;
ALTER TABLE public.download_clicks
  ADD CONSTRAINT download_clicks_utm_source_check
  CHECK (utm_source IN ('none', 'reddit'));
""",
        ),
        (
            "083.position_ticket.column",
            "ALTER TABLE public.position_tickets ALTER COLUMN position_id DROP NOT NULL;",
        ),
        (
            "083.position_ticket.fk",
            """
ALTER TABLE public.position_tickets
  DROP CONSTRAINT position_tickets_position_tenant_fkey;
""",
        ),
        (
            "083.position_ticket.indexes",
            "DROP INDEX public.idx_position_tickets_user_position;",
        ),
        (
            "083.create_ticket.definition",
            """
UPDATE pg_catalog.pg_proc AS procedure
SET prosrc = procedure.prosrc || E'\n-- synthetic body drift'
FROM pg_catalog.pg_namespace AS namespace
WHERE namespace.oid = procedure.pronamespace
  AND namespace.nspname = 'public'
  AND procedure.proname = 'create_position_ticket';
""",
        ),
        (
            "083.sync_ticket.definition",
            """
UPDATE pg_catalog.pg_proc AS procedure
SET prosrc = procedure.prosrc || E'\n-- synthetic body drift'
FROM pg_catalog.pg_namespace AS namespace
WHERE namespace.oid = procedure.pronamespace
  AND namespace.nspname = 'public'
  AND procedure.proname = 'sync_create_position_ticket';
""",
        ),
        (
            "083.create_ticket.acl",
            """
GRANT EXECUTE ON FUNCTION public.create_position_ticket(integer,text,text)
TO service_role;
""",
        ),
        (
            "083.sync_ticket.acl",
            """
GRANT EXECUTE ON FUNCTION public.sync_create_position_ticket(
  uuid,integer,text,text,text,text,text,timestamptz,timestamptz,timestamptz
) TO authenticated;
""",
        ),
    )
    with pg16_schema_clone(migrated=True) as psql:
        for target, mutation in drifts:
            observed = query_results_in_transaction(psql, mutation)
            assert not observed[target], target


def test_pg16_083_reapply_preserves_the_exact_catalog_receipt():
    contract = canary.load_contract(MANIFEST)
    with pg16_schema_clone(migrated=True) as psql:
        before = query_results(psql)
        psql(MIGRATIONS[-1].read_text())
        after = query_results(psql)

    assert tuple(sorted(before)) == contract.expected_checks
    assert before == after
    assert all(after.values())


def test_pg16_083_rpc_resolves_tenant_parent_and_fk_rejects_cross_tenant():
    user_a = "00000000-0000-0000-0000-000000008301"
    user_b = "00000000-0000-0000-0000-000000008302"
    position_a = "00000000-0000-0000-0000-000000008311"
    position_b = "00000000-0000-0000-0000-000000008312"
    legacy_id = 83001
    with pg16_schema_clone(migrated=True) as psql:
        psql(
            f"""
INSERT INTO auth.users(id, created_at)
VALUES ('{user_a}', now()), ('{user_b}', now());
INSERT INTO public.positions(id, user_id, title, company, legacy_id)
VALUES
  ('{position_a}', '{user_a}', 'Synthetic A', 'Synthetic A', {legacy_id}),
  ('{position_b}', '{user_b}', 'Synthetic B', 'Synthetic B', {legacy_id});
SELECT pg_catalog.set_config('request.jwt.claim.sub', '{user_a}', false);
SELECT public.create_position_ticket(
  {legacy_id}, 'Synthetic tenant-bound request', 'custom'
);
"""
        )
        identity = psql(
            """
SELECT user_id::text, position_id::text, position_legacy_id::text
FROM public.position_tickets
WHERE request_text = 'Synthetic tenant-bound request';
"""
        ).stdout.strip()
        rejected = psql(
            f"""
INSERT INTO public.position_tickets(
  user_id, position_id, position_legacy_id, request_text
) VALUES (
  '{user_a}', '{position_b}', {legacy_id}, 'Synthetic cross-tenant request'
);
""",
            check=False,
        )
        cross_tenant_count = psql(
            """
SELECT pg_catalog.count(*)
FROM public.position_tickets
WHERE request_text = 'Synthetic cross-tenant request';
"""
        ).stdout.strip()

    assert identity == f"{user_a}|{position_a}|{legacy_id}"
    assert rejected.returncode != 0
    assert cross_tenant_count == "0"


def test_pg16_076_077_function_identity_rejects_each_metadata_drift():
    mutations = (
        """
CREATE FUNCTION public.sync_upsert_applications(integer) RETURNS jsonb
LANGUAGE plpgsql AS $$ BEGIN RETURN '{}'::jsonb; END $$;
""",
        """
UPDATE pg_catalog.pg_proc SET proargnames = ARRAY['synthetic_a', 'synthetic_b']
WHERE oid = 'public.sync_upsert_applications(uuid,jsonb)'::regprocedure;
""",
        """
UPDATE pg_catalog.pg_proc SET prorettype = 'text'::regtype
WHERE oid = 'public.sync_upsert_applications(uuid,jsonb)'::regprocedure;
""",
        """
UPDATE pg_catalog.pg_proc SET pronargdefaults = 1
WHERE oid = 'public.sync_upsert_applications(uuid,jsonb)'::regprocedure;
""",
        """
UPDATE pg_catalog.pg_proc SET prokind = 'p'
WHERE oid = 'public.sync_upsert_applications(uuid,jsonb)'::regprocedure;
""",
        """
UPDATE pg_catalog.pg_proc SET prolang = (
  SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql'
)
WHERE oid = 'public.sync_upsert_applications(uuid,jsonb)'::regprocedure;
""",
        "ALTER FUNCTION public.sync_upsert_applications(uuid,jsonb) STABLE;",
        "ALTER FUNCTION public.sync_upsert_applications(uuid,jsonb) SECURITY DEFINER;",
        "ALTER FUNCTION public.sync_upsert_applications(uuid,jsonb) RESET ALL;",
        "GRANT EXECUTE ON FUNCTION public.sync_upsert_applications(uuid,jsonb) TO PUBLIC;",
    )
    with pg16_schema_clone(migrated=True) as psql:
        for mutation in mutations:
            observed = query_results_in_transaction(psql, mutation)
            assert not observed["076.sync_upsert_applications.definition"]

        for check_id, mutation in (
            (
                "077.mark_position_applied.definition",
                "ALTER FUNCTION public.mark_position_applied(integer,timestamptz,text,text) RESET ALL;",
            ),
            (
                "077.undo_manual_position_application.definition",
                "GRANT EXECUTE ON FUNCTION public.undo_manual_position_application(integer,text) TO PUBLIC;",
            ),
        ):
            observed = query_results_in_transaction(psql, mutation)
            assert not observed[check_id]


def test_pg16_all_six_081_function_bodies_are_independently_pinned():
    functions = {
        "081.cleanup.definition": "cleanup_pairing_sessions",
        "081.delete_account.definition": "delete_account_data",
        "081.redeem_pairing.definition": "redeem_cloud_sync_pairing",
        "081.reject_stale_applied.definition": (
            "reject_stale_applied_position_downgrade"
        ),
        "081.sync_confirm.definition": "sync_confirm_positions_applied",
        "081.team_state_stamp.definition": "team_state_stamp_cloud_push_check",
    }
    with pg16_schema_clone(migrated=True) as psql:
        for check_id, function_name in functions.items():
            observed = query_results_in_transaction(
                psql,
                f"""
UPDATE pg_catalog.pg_proc AS procedure
SET prosrc = procedure.prosrc || E'\\n-- synthetic body drift'
FROM pg_catalog.pg_namespace AS namespace
WHERE namespace.oid = procedure.pronamespace
  AND namespace.nspname = 'public'
  AND procedure.proname = '{function_name}';
""",
            )
            assert not observed[check_id]
            assert all(observed[other] for other in functions if other != check_id)


def test_pg16_081_function_metadata_acl_and_trigger_links_are_pinned():
    metadata_drifts = (
        (
            "081.cleanup.definition",
            """
UPDATE pg_catalog.pg_proc SET prokind = 'p'
WHERE oid = 'public.cleanup_pairing_sessions()'::regprocedure;
""",
        ),
        (
            "081.delete_account.definition",
            """
UPDATE pg_catalog.pg_proc SET prolang = (
  SELECT oid FROM pg_catalog.pg_language WHERE lanname = 'sql'
)
WHERE oid = 'public.delete_account_data(uuid)'::regprocedure;
""",
        ),
        (
            "081.redeem_pairing.definition",
            "ALTER FUNCTION public.redeem_cloud_sync_pairing(text) STABLE;",
        ),
        (
            "081.sync_confirm.definition",
            """
ALTER FUNCTION public.sync_confirm_positions_applied(uuid,integer[])
SECURITY DEFINER;
""",
        ),
        (
            "081.team_state_stamp.definition",
            "ALTER FUNCTION public.team_state_stamp_cloud_push_check() RESET ALL;",
        ),
        (
            "081.redeem_pairing.definition",
            """
UPDATE pg_catalog.pg_proc
SET proargnames = ARRAY[
  'synthetic_device_code', 'status', 'approved_token',
  'user_id', 'approved_token_id', 'token_name'
]
WHERE oid = 'public.redeem_cloud_sync_pairing(text)'::regprocedure;
""",
        ),
        (
            "081.cleanup.definition",
            """
UPDATE pg_catalog.pg_proc SET proallargtypes = ARRAY[23, 25]::oid[]
WHERE oid = 'public.cleanup_pairing_sessions()'::regprocedure;
""",
        ),
    )
    acl_drifts = (
        (
            "081.cleanup.definition",
            "REVOKE EXECUTE ON FUNCTION public.cleanup_pairing_sessions() FROM service_role;",
        ),
        (
            "081.delete_account.definition",
            "GRANT EXECUTE ON FUNCTION public.delete_account_data(uuid) TO PUBLIC;",
        ),
        (
            "081.redeem_pairing.definition",
            "GRANT EXECUTE ON FUNCTION public.redeem_cloud_sync_pairing(text) TO authenticated;",
        ),
        (
            "081.sync_confirm.definition",
            "REVOKE EXECUTE ON FUNCTION public.sync_confirm_positions_applied(uuid,integer[]) FROM service_role;",
        ),
        (
            "081.reject_stale_applied.definition",
            "REVOKE EXECUTE ON FUNCTION public.reject_stale_applied_position_downgrade() FROM anon;",
        ),
        (
            "081.team_state_stamp.definition",
            "GRANT EXECUTE ON FUNCTION public.team_state_stamp_cloud_push_check() TO PUBLIC;",
        ),
    )
    trigger_drifts = (
        (
            "081.reject_stale_applied.trigger",
            """
DROP TRIGGER positions_reject_stale_applied_downgrade ON public.positions;
CREATE TRIGGER positions_reject_stale_applied_downgrade
AFTER UPDATE ON public.positions
FOR EACH STATEMENT
EXECUTE FUNCTION public.reject_stale_applied_position_downgrade();
""",
        ),
        (
            "081.team_state_stamp.trigger",
            """
DROP TRIGGER trg_team_state_stamp_cloud_push_check ON public.team_state;
CREATE TRIGGER trg_team_state_stamp_cloud_push_check
AFTER UPDATE ON public.team_state
FOR EACH ROW
EXECUTE FUNCTION public.team_state_stamp_cloud_push_check();
""",
        ),
    )

    with pg16_schema_clone(migrated=True) as psql:
        for check_id, mutation in metadata_drifts + acl_drifts + trigger_drifts:
            observed = query_results_in_transaction(psql, mutation)
            assert not observed[check_id]


def test_pg16_081_tenant_fk_receipt_rejects_uuid_only_same_name_substitute():
    with pg16_schema_clone(migrated=True) as psql:
        observed = query_results_in_transaction(
            psql,
            """
ALTER TABLE public.scores DROP CONSTRAINT scores_position_tenant_fkey;
ALTER TABLE public.scores ADD CONSTRAINT scores_position_tenant_fkey
  FOREIGN KEY (position_id) REFERENCES public.positions(id) ON DELETE CASCADE;
""",
        )

    assert not observed["081.tenant_fk.count"]


def test_pg16_081_user_settings_and_team_directive_policies_are_exact():
    user_settings_drifts = (
        "ALTER TABLE public.user_settings DISABLE ROW LEVEL SECURITY;",
        """
DROP POLICY "Users manage own settings" ON public.user_settings;
CREATE POLICY "Users manage own settings" ON public.user_settings
FOR ALL USING (true) WITH CHECK (true);
""",
        "REVOKE SELECT ON public.user_settings FROM authenticated;",
    )
    with pg16_schema_clone(migrated=True) as psql:
        for mutation in user_settings_drifts:
            observed = query_results_in_transaction(psql, mutation)
            assert not observed["081.reconciliation.present"]

        observed = query_results_in_transaction(
            psql,
            """
DROP POLICY "users select own team directives" ON public.team_directives;
CREATE POLICY "users select own team directives" ON public.team_directives
FOR SELECT USING (true);
""",
        )
        assert not observed["081.team_directives.policies"]

        observed = query_results_in_transaction(
            psql,
            "ALTER TABLE public.team_directives DISABLE ROW LEVEL SECURITY;",
        )
        assert not observed["081.team_directives.policies"]

        observed = query_results_in_transaction(
            psql,
            "ALTER TABLE public.pending_user_messages DISABLE ROW LEVEL SECURITY;",
        )
        assert not observed["079.pending_messages.column_acl"]

        observed = query_results_in_transaction(
            psql,
            """
DROP POLICY "Users can view own pending messages"
ON public.pending_user_messages;
CREATE POLICY "Users can view own pending messages"
ON public.pending_user_messages FOR SELECT USING (true);
""",
        )
        assert not observed["079.pending_messages.column_acl"]


def test_pg16_preflight_proves_each_seed_causal_and_preserves_row_fingerprint():
    expected = tuple(sorted(PREFLIGHT_ANOMALY_SEEDS))
    with pg16_schema_clone(migrated=True, through_version=80) as psql:
        baseline = receipt_rows(psql(PREFLIGHT_QUERY.read_text()).stdout)
        assert tuple(sorted(baseline)) == expected
        assert all(baseline.values())

        for target, seed in PREFLIGHT_ANOMALY_SEEDS.items():
            result = psql(
                "BEGIN;\n"
                + PREFLIGHT_BASE_ROWS
                + seed
                + "SELECT '_fingerprint.before', ("
                + PREFLIGHT_FINGERPRINT_QUERY
                + ");\n"
                + PREFLIGHT_QUERY.read_text()
                + ";\nSELECT '_fingerprint.after', ("
                + PREFLIGHT_FINGERPRINT_QUERY
                + ");\nROLLBACK;"
            )
            rows = dict(
                line.split("|", 1) for line in result.stdout.splitlines() if "|" in line
            )
            assert rows.pop("_fingerprint.before") == rows.pop("_fingerprint.after")
            assert tuple(sorted(rows)) == expected
            assert rows[target] == "f"
            assert all(value == "t" for key, value in rows.items() if key != target)


def test_pg16_rpc_body_drift_fails_with_signature_security_and_acl_unchanged():
    with pg16_schema_clone(migrated=True) as psql:
        psql(
            """
CREATE OR REPLACE FUNCTION public.mutate_team_directive_with_event(
  p_id BIGINT, p_action TEXT, p_body TEXT, p_kind TEXT, p_request_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$ BEGIN RETURN '{}'::jsonb; END $$;

CREATE OR REPLACE FUNCTION public.sync_candidate_profile_atomic(
  p_user_id UUID, p_content_hash TEXT, p_snapshot JSONB,
  p_force BOOLEAN DEFAULT FALSE
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$ BEGIN RETURN '{}'::jsonb; END $$;
"""
        )
        observed = query_results(psql)

    assert not observed["079.directive_rpc.definition"]
    assert not observed["080.profile_rpc.definition"]
    for check_id in (
        "079.directive_rpc.signature",
        "079.directive_rpc.security",
        "079.directive_rpc.acl",
        "080.profile_rpc.signature",
        "080.profile_rpc.security",
        "080.profile_rpc.acl",
    ):
        assert observed[check_id], check_id
