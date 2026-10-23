"""Every PostgreSQL test that can run on the shared server makes the cluster's roles in turn (T78).

In CI all the PostgreSQL tests share one server (JHT_TEST_POSTGRES_URL) and run under pytest-xdist:
two bootstraps that create `anon` at once collide on pg_authid's unique index, and neither
`EXCEPTION WHEN duplicate_object` nor `IF NOT EXISTS` prevents it (see tests/pg_roles.py). A file
that creates roles and can run on that server goes through roles_in_turn(); a file that only starts
its own throwaway cluster has no one to collide with. That the lock really makes a bootstrap wait is
shown on a real server by test_web_action_door_postgres.py.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from pg_roles import LOCK_ROLES, roles_in_turn

TESTS = Path(__file__).resolve().parent
CREATES_ROLES = re.compile(r"\bCREATE ROLE\b")


def _on_the_shared_server() -> list[Path]:
    return sorted(
        path for path in TESTS.glob("test_*.py")
        if path.name != Path(__file__).name
        and CREATES_ROLES.search(text := path.read_text(encoding="utf-8"))
        and "JHT_TEST_POSTGRES_URL" in text
    )


def test_the_census_finds_the_files_that_share_the_server():
    names = {path.name for path in _on_the_shared_server()}
    # the ones known on 23/10: if one goes, the census must be looked at, not silently shrink
    assert {"test_f06_pairing_attempts_postgres.py", "test_manual_application_rpc_pg16.py",
            "test_team_state_agents_status_postgres.py", "test_tenant_delete_postgres.py",
            "test_web_action_door_postgres.py"} <= names, names


@pytest.mark.parametrize("path", _on_the_shared_server(), ids=lambda path: path.name)
def test_a_file_on_the_shared_server_makes_its_roles_in_turn(path):
    assert "roles_in_turn(" in path.read_text(encoding="utf-8"), (
        f"{path.name} creates roles and can run on the shared server: put its role statements in "
        "roles_in_turn() (tests/pg_roles.py), or two bootstraps under xdist collide on CREATE ROLE"
    )


def test_the_roles_come_after_the_lock_in_a_transaction_of_their_own():
    sql = roles_in_turn("CREATE ROLE x;")
    assert sql.split() == ["BEGIN;", *LOCK_ROLES.split(), "CREATE", "ROLE", "x;", "COMMIT;"]
