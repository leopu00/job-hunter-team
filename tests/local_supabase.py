"""JHT_TEST_SUPABASE_DB_URL may point only at a Supabase stack on this machine.

The tests that read it open transactions as the database owner, switch to
anon, authenticated and service_role, and roll back. Aimed at the hosted
project by mistake (a copied DB_URL, a pooler string) they would run there
with the owner's rights. So the URL is used only when the host it names is
this machine, and the test is skipped otherwise.

libpq lets the query string override the host of the URL (`?host=`,
`?hostaddr=`) or replace the whole target (`?service=`): such a URL is not
trusted either, and neither is a list of hosts.
"""

from __future__ import annotations

import os
from urllib.parse import parse_qs, urlparse

import pytest


ENV = "JHT_TEST_SUPABASE_DB_URL"
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})
TARGET_OVERRIDES = frozenset({"host", "hostaddr", "service"})


def is_local_database_url(url: str) -> bool:
    try:
        parsed = urlparse(url)
        hostname = parsed.hostname
    except ValueError:
        return False
    if parsed.scheme not in {"postgres", "postgresql"}:
        return False
    if "," in parsed.netloc:
        return False
    if TARGET_OVERRIDES & {key.lower() for key in parse_qs(parsed.query, keep_blank_values=True)}:
        return False
    return hostname in LOCAL_HOSTS


def local_supabase_db_url() -> str:
    """The URL of the local stack, or a skip that says why there is none."""
    url = os.environ.get(ENV)
    if not url:
        pytest.skip(f"{ENV} non impostata: serve lo stack Supabase locale")
    if not is_local_database_url(url):
        pytest.skip(f"{ENV} non punta a localhost o 127.0.0.1: questi test non girano su un database remoto")
    return url
