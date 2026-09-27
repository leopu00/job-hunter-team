"""Migration 089: two producers of agents_status never erase each other.

The TUI team (cli/src/lib/agents-status.js) and the JHT API executor's traces
(agents-status-traces.js) publish into the same column, each with a PATCH of
its own key only. Without the merge in the database, the second PATCH would
replace the column and the first source's agents would lose their tags until
its next write: the desktop would blink between two half teams.

The migration runs here as it is written, and the PATCH is the one the module
builds (`agentsStatusPatch`, run for real with node): a copy of either would
test the copy.

In CI PostgreSQL 16 is the service behind JHT_TEST_POSTGRES_URL; locally a
postgres:16-alpine container, when there is one.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import urlparse, urlunparse

import pytest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase/migrations/089_team_state_agents_status.sql"
AGENTS_STATUS = ROOT / "cli/src/lib/agents-status.js"
IMAGE = "postgres:16-alpine"
USER_1 = "00000000-0000-0000-0000-000000000001"
CONSTRAINT = "team_state_agents_status_shape"
STAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")

BOOTSTRAP = """
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
END $$;
CREATE TABLE public.team_state (
  user_id UUID PRIMARY KEY,
  last_heartbeat_at TIMESTAMPTZ
);
INSERT INTO public.team_state (user_id) VALUES ('{user}');
"""


def _run(argv, *, input_text=None, check=True):
    return subprocess.run(argv, input=input_text, text=True, capture_output=True, check=check, timeout=60)


def _psql_argv(client, target):
    return [*client, "-X", "-q", "-v", "ON_ERROR_STOP=1", *target, "-At", "-F", "|"]


def _patch(source: str, agents: dict) -> dict:
    """The PATCH body the producer sends, asked of the module."""
    if not shutil.which("node"):
        pytest.skip("node non disponibile")
    script = f"""
      const mod = await import({AGENTS_STATUS.as_uri()!r});
      process.stdout.write(JSON.stringify(mod.agentsStatusPatch({json.dumps(source)}, {json.dumps(agents)})));
    """
    return json.loads(_run(["node", "--input-type=module", "-e", script]).stdout)


@pytest.fixture(scope="module")
def pg():
    bootstrap = BOOTSTRAP.format(user=USER_1) + MIGRATION.read_text(encoding="utf-8")

    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    if external_url:
        client = shutil.which("psql")
        parsed = urlparse(external_url)
        if not client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL richiede psql e un host valido")
        database = f"jht_agents_status_{uuid.uuid4().hex[:12]}"

        def run_on(url, sql, *, check=True):
            return _run(_psql_argv([client], ["-d", url]), input_text=sql, check=check)

        run_on(external_url, f'CREATE DATABASE "{database}";')
        database_url = urlunparse(parsed._replace(path=f"/{database}"))

        def psql(sql, *, check=True):
            return run_on(database_url, sql, check=check)

        try:
            psql(bootstrap)
            yield psql
        finally:
            run_on(external_url, f'DROP DATABASE IF EXISTS "{database}" WITH (FORCE);', check=False)
        return

    if not shutil.which("docker"):
        pytest.skip("docker non disponibile")
    if _run(["docker", "image", "inspect", IMAGE], check=False).returncode:
        pytest.skip(f"immagine locale {IMAGE} non disponibile")
    name = f"jht-agents-status-{uuid.uuid4().hex[:10]}"
    started = _run(
        ["docker", "run", "--detach", "--rm", "--name", name, "-e", "POSTGRES_PASSWORD=synthetic-test-only", IMAGE],
        check=False,
    )
    if started.returncode:
        pytest.skip(f"PostgreSQL test non avviabile: {started.stderr.strip()}")

    def psql(sql, *, check=True):
        return _run(
            _psql_argv(["docker", "exec", "-i", name, "psql"], ["-U", "postgres", "-d", "postgres"]),
            input_text=sql,
            check=check,
        )

    try:
        stable = 0
        for _ in range(100):
            stable = stable + 1 if psql("SELECT 1;", check=False).returncode == 0 else 0
            if stable == 2:
                break
            time.sleep(0.1)
        else:
            pytest.fail("PostgreSQL 16 non è diventato ready")
        psql(bootstrap)
        yield psql
    finally:
        _run(["docker", "rm", "--force", name], check=False)


def _write(pg, body: dict, *, check=True):
    """The producer's PATCH as PostgREST runs it: SET the column to the body's value."""
    raw = body["agents_status"]
    value = "NULL" if raw is None else "'" + json.dumps(raw).replace("'", "''") + "'::jsonb"
    return pg(f"UPDATE public.team_state SET agents_status = {value} WHERE user_id = '{USER_1}';", check=check)


def _read(pg) -> dict | None:
    out = pg(f"SELECT agents_status FROM public.team_state WHERE user_id = '{USER_1}';").stdout.strip()
    return json.loads(out) if out else None


def test_two_producers_keep_each_other(pg):
    _write(pg, {"agents_status": None})
    _write(pg, _patch("tui", {"capitano": {"status": "working", "since": "x"}}))
    _write(pg, _patch("api", {"scout-2": {"status": "idle", "since": "y"}}))
    both = _read(pg)
    assert both["tui"]["agents"] == {"capitano": {"status": "working", "since": "x"}}
    assert both["api"]["agents"] == {"scout-2": {"status": "idle", "since": "y"}}

    _write(pg, _patch("tui", {"capitano": {"status": "idle", "since": "z"}}))
    again = _read(pg)
    assert again["tui"]["agents"]["capitano"]["status"] == "idle"
    assert again["api"] == both["api"], "a TUI write changed the API's source"


def test_each_source_is_stamped_by_the_database(pg):
    _write(pg, {"agents_status": None})
    _write(pg, _patch("tui", {}))
    first = _read(pg)["tui"]["at"]
    assert STAMP.match(first), first
    pg("SELECT pg_sleep(0.01);")
    _write(pg, _patch("tui", {}))
    assert _read(pg)["tui"]["at"] > first, "an unchanged map must still refresh its at (the keepalive)"


def test_the_heartbeat_does_not_touch_the_statuses(pg):
    _write(pg, {"agents_status": None})
    _write(pg, _patch("tui", {"capitano": {"status": "working", "since": "x"}}))
    before = _read(pg)
    pg(f"UPDATE public.team_state SET last_heartbeat_at = now() WHERE user_id = '{USER_1}';")
    assert _read(pg) == before


def test_a_null_key_removes_its_source_and_null_removes_all(pg):
    _write(pg, {"agents_status": None})
    _write(pg, _patch("tui", {}))
    _write(pg, _patch("api", {}))
    _write(pg, {"agents_status": {"api": None}})
    assert set(_read(pg)) == {"tui"}
    _write(pg, {"agents_status": None})
    assert _read(pg) is None


def test_the_check_refuses_what_is_not_an_object(pg):
    refused = _write(pg, {"agents_status": [1]}, check=False)
    assert refused.returncode != 0
    assert CONSTRAINT in refused.stderr, refused.stderr
