"""The guard of JHT_TEST_SUPABASE_DB_URL: only this machine's Supabase stack.

tests/local_supabase.py keeps the tests that run as the database owner on
the local stack from opening a transaction on a remote database, the hosted
project above all. Here are the URLs it lets through and those it refuses,
and the skip that a refused URL turns into.
"""

from __future__ import annotations

import pytest

import local_supabase
from local_supabase import is_local_database_url, local_supabase_db_url


@pytest.mark.parametrize("url", [
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    "postgresql://postgres:postgres@localhost:54322/postgres",
    "postgres://postgres:postgres@[::1]:54322/postgres",
    "postgresql://postgres:postgres@LOCALHOST:54322/postgres?sslmode=disable",
])
def test_the_local_stack_is_let_through(url):
    assert is_local_database_url(url)


@pytest.mark.parametrize("url", [
    # The hosted project, directly and through the pooler.
    "postgresql://db.example-project.supabase.co:5432/postgres",
    "postgresql://aws-0-eu-central-1.pooler.supabase.com:6543/postgres",
    # A local-looking URL whose query string sends libpq elsewhere.
    "postgresql://postgres@127.0.0.1:54322/postgres?host=db.example-project.supabase.co",
    "postgresql://postgres@127.0.0.1:54322/postgres?hostaddr=203.0.113.7",
    "postgresql://postgres@localhost/postgres?service=production",
    # Several hosts, one of them remote.
    "postgresql://postgres@127.0.0.1:54322,db.example-project.supabase.co:5432/postgres",
    # No host: libpq would take PGHOST, which can name anything.
    "postgresql:///postgres",
    # Not a database URL, or a host that only starts like the local one.
    "http://127.0.0.1:54321",
    "postgresql://127.0.0.1.example.com:5432/postgres",
    "",
])
def test_anything_else_is_refused(url):
    assert not is_local_database_url(url)


def test_a_remote_url_skips_the_test_instead_of_running_it(monkeypatch):
    monkeypatch.setenv(local_supabase.ENV, "postgresql://db.example-project.supabase.co:5432/postgres")
    with pytest.raises(pytest.skip.Exception, match="non punta a localhost"):
        local_supabase_db_url()


def test_an_unset_url_skips_the_test(monkeypatch):
    monkeypatch.delenv(local_supabase.ENV, raising=False)
    with pytest.raises(pytest.skip.Exception, match="non impostata"):
        local_supabase_db_url()


def test_a_local_url_is_returned_as_it_is(monkeypatch):
    url = "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    monkeypatch.setenv(local_supabase.ENV, url)
    assert local_supabase_db_url() == url
