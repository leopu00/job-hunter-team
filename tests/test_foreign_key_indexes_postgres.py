"""Migration 092: every foreign key of the cloud schema has an index under it.

The rule is the Supabase advisor's (lint 0001, unindexed_foreign_keys): a
foreign key is covered when some valid index on the same table starts with
the key's columns, in the key's order. Without it, a DELETE of the parent
(a position, a company, an account) scans the child table to check it.

The database is the one tests/test_rls_postgres.py builds: every migration
replayed in order on PostgreSQL 16, as the migration gate does.
"""

from __future__ import annotations

import subprocess

from test_rls_postgres import database  # noqa: F401  (fixture)


# The eight the advisor reported on the hosted project on 08/10, before 092.
REPORTED = {
    "applications_position_tenant_fkey",
    "cloud_sync_pairing_sessions_approved_token_id_fkey",
    "cloud_sync_pairing_sessions_user_id_fkey",
    "pending_user_messages_position_tenant_fkey",
    "position_highlights_position_tenant_fkey",
    "position_tickets_position_tenant_fkey",
    "positions_company_tenant_fkey",
    "scores_position_tenant_fkey",
}

FOREIGN_KEYS = """
SELECT c.conname,
       EXISTS (
         SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid
            AND i.indisvalid
            AND (string_to_array(i.indkey::text, ' ')::smallint[])[1:cardinality(c.conkey)] = c.conkey
       )
  FROM pg_constraint c
  JOIN pg_namespace n ON n.oid = c.connamespace
 WHERE c.contype = 'f' AND n.nspname = 'public'
 ORDER BY 1;
"""


def test_every_public_foreign_key_has_an_index_that_starts_with_its_columns(database):  # noqa: F811
    result = subprocess.run(
        ["psql", "-X", "-q", "-A", "-t", "-F", "|", "-v", "ON_ERROR_STOP=1", "--dbname", database],
        input=FOREIGN_KEYS, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    covered = dict(line.split("|") for line in result.stdout.split())

    # The eight must exist here, or "all covered" would be about other keys.
    assert REPORTED <= covered.keys(), sorted(REPORTED - covered.keys())
    assert sorted(name for name, ok in covered.items() if ok != "t") == []
