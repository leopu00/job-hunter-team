"""The cluster's roles, made by test bootstraps that may run at the same time on one server.

Roles belong to the whole PostgreSQL cluster, not to the database a test creates for itself. In CI
every PostgreSQL test shares one server, and with pytest-xdist two bootstraps can run at once: both
see no `anon` and both create it, and the second fails on pg_authid's unique index («duplicate key
value violates unique constraint "pg_authid_rolname_index"»). `EXCEPTION WHEN duplicate_object` does
not catch that one (it is a unique_violation), and `IF NOT EXISTS` looks before the other commits.

roles_in_turn() puts a file's own role statements, unchanged, in a transaction that first locks
pg_authid, a catalog shared by every database of the cluster: the bootstraps take turns, and each
one looks for the roles only after the previous one committed. An advisory lock would not do: its
keys are per database. Proof: test_web_action_door_postgres.py, a bootstrap waits on that lock.
"""

from __future__ import annotations

LOCK_ROLES = "LOCK TABLE pg_catalog.pg_authid IN SHARE ROW EXCLUSIVE MODE;"


def roles_in_turn(statements: str) -> str:
    """`statements` (the role DDL of one bootstrap) in a transaction of its own, after the lock."""
    return f"\nBEGIN;\n{LOCK_ROLES}\n{statements.strip()}\nCOMMIT;\n"
