"""JHT-T05: la migrazione 094 gira DAVVERO su PostgreSQL, e non perde il testo dell'utente.

Non si legge l'SQL e non si simula Supabase: si avvia un cluster isolato (o si
usa JHT_TEST_POSTGRES_URL, come in CI), si crea lo schema immediatamente prima
della 094, si applica il file con psql — due volte — e si guardano le righe.

Il dubbio vero era la classe di caratteri di controllo dentro regexp_replace
(`'[\\x00-\\x1f]'` può essere rifiutata dal motore regex): applicata a mano fuori
da una transazione la migrazione resterebbe a metà. Qui, se rifiuta, il test è
rosso.

Senza un server PostgreSQL né JHT_TEST_POSTGRES_URL il test viene saltato; in CI
c'è il servizio postgres:16.
"""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import time
import uuid
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "supabase" / "migrations" / "094_feedback_reasons_closed.sql"
USER = "00000000-0000-0000-0000-000000000001"
CODES = (
    "too_senior", "too_junior", "wrong_location", "salary_low", "wrong_stack",
    "company", "scam_or_gone", "closed", "already_applied", "other",
)
LONG_REASON = ("Troppo orientato alla vendita, tre giorni in ufficio a Milano. " * 10)[:500]


def _pg_binaries() -> dict[str, str] | None:
    names = ("postgres", "initdb", "pg_ctl", "psql")
    candidates: list[Path] = []
    postgres = shutil.which("postgres")
    if postgres:
        candidates.append(Path(postgres).parent)
    candidates.extend(Path("/opt/homebrew/opt").glob("postgresql@*/bin"))
    candidates.extend(Path("/usr/local/opt").glob("postgresql@*/bin"))
    candidates.extend(Path("/usr/lib/postgresql").glob("*/bin"))
    for directory in reversed(sorted(set(candidates))):
        paths = {name: directory / name for name in names}
        if all(path.is_file() for path in paths.values()):
            return {name: str(path) for name, path in paths.items()}
    return None


@pytest.fixture(scope="module")
def database(tmp_path_factory):
    """Un database vuoto e a perdere, su un server isolato o su quello di CI."""
    external_url = os.environ.get("JHT_TEST_POSTGRES_URL")
    binaries = _pg_binaries()
    data: Path | None = None
    if external_url:
        parsed = urlparse(external_url)
        psql_client = shutil.which("psql")
        if not psql_client or not parsed.hostname:
            pytest.fail("JHT_TEST_POSTGRES_URL requires psql and a valid host")
        binaries = {"psql": psql_client}
        host, port = parsed.hostname, parsed.port or 5432
        user, password = unquote(parsed.username or "postgres"), unquote(parsed.password or "")
        admin_db = parsed.path.lstrip("/") or "postgres"
    elif binaries is not None:
        root = tmp_path_factory.mktemp("feedback-reasons-postgres")
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", 0))
            port = probe.getsockname()[1]
        data, socket_dir = root / "data", root / "socket"
        socket_dir.mkdir()
        subprocess.run([binaries["initdb"], "-D", str(data), "-A", "trust", "-U", "postgres",
                        "--no-locale", "--encoding=UTF8"], check=True, capture_output=True, text=True)
        subprocess.run([binaries["pg_ctl"], "-D", str(data), "-l", str(root / "postgres.log"),
                        "-o", f"-F -p {port} -k {socket_dir}", "-w", "start"],
                       check=True, capture_output=True, text=True)
        host, user, password, admin_db = str(socket_dir), "postgres", "", "postgres"
    else:
        pytest.skip("no PostgreSQL server tools and no JHT_TEST_POSTGRES_URL")

    env = {**os.environ, "PGHOST": host, "PGPORT": str(port), "PGUSER": user, "PGPASSWORD": password}
    name = "jht_t05_" + uuid.uuid4().hex[:10]

    def psql(sql: str, *, db: str, check: bool = True):
        return subprocess.run([binaries["psql"], "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", db],
                              input=sql, env=env, check=check, capture_output=True, text=True)

    for _ in range(100):
        ready = subprocess.run([binaries["psql"], "-X", "-d", admin_db, "-c", "SELECT 1"],
                               env=env, capture_output=True, text=True)
        if ready.returncode == 0:
            break
        time.sleep(0.1)
    else:
        raise AssertionError(f"PostgreSQL did not start: {ready.stderr}")
    psql(f'CREATE DATABASE "{name}"', db=admin_db)
    try:
        yield lambda sql, check=True: psql(sql, db=name, check=check)
    finally:
        psql(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)', db=admin_db, check=False)
        if data is not None:
            subprocess.run([binaries["pg_ctl"], "-D", str(data), "-m", "fast", "-w", "stop"],
                           check=False, capture_output=True, text=True)


def q(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


BOOTSTRAP = """
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TABLE public.positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_excluded_reason text
);
CREATE TABLE public.position_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  position_legacy_id text NOT NULL,
  action text NOT NULL,
  reason text,
  comment text CHECK (comment IS NULL OR length(comment) <= 2000)
);
"""


def row(db, legacy_id):
    out = db(f"SELECT reason, coalesce(note, '<null>'), coalesce(comment, '<null>') "
             f"FROM public.position_feedback WHERE position_legacy_id = {q(legacy_id)}").stdout.strip()
    return out.split("|", 2)


@pytest.fixture(scope="module")
def migrated(database):
    database(BOOTSTRAP)
    database(f"INSERT INTO auth.users VALUES ({q(USER)})")
    rows = [
        ("1", "dislike", "troppo\tsenior\x01 " + LONG_REASON, None),          # reason lungo, comment vuoto
        ("2", "dislike", LONG_REASON, "già scritto"),                          # reason lungo, comment pieno
        ("3", "dislike", "too_senior", "una nota"),                            # codice valido
        ("4", "dislike", "mismatch", "perché sì"),                             # vecchio codice
        ("5", "dislike", LONG_REASON, "c" * 1900),                             # non entra in 2000
    ]
    for legacy, action, reason, comment in rows:
        database("INSERT INTO public.position_feedback (user_id, position_legacy_id, action, reason, comment) "
                 f"VALUES ({q(USER)}, {q(legacy)}, {q(action)}, {q(reason)}, "
                 f"{'NULL' if comment is None else q(comment)})")
    database("INSERT INTO public.positions (user_excluded_reason) VALUES ('mismatch'), ('too_junior')")
    first = database(MIGRATION.read_text(encoding="utf-8"))
    snapshot = database("SELECT position_legacy_id, reason, note, comment FROM public.position_feedback "
                        "ORDER BY position_legacy_id").stdout
    second = database(MIGRATION.read_text(encoding="utf-8"))
    again = database("SELECT position_legacy_id, reason, note, comment FROM public.position_feedback "
                     "ORDER BY position_legacy_id").stdout
    return {"db": database, "first": first, "snapshot": snapshot, "second": second, "again": again}


def test_the_migration_applies_with_no_error_and_a_second_time_changes_nothing(migrated):
    assert migrated["snapshot"] == migrated["again"]


def test_every_reason_is_a_code_of_the_vocabulary_and_the_old_exclusions_too(migrated):
    db = migrated["db"]
    reasons = db("SELECT DISTINCT reason FROM public.position_feedback").stdout.split()
    assert set(reasons) <= set(CODES), reasons
    assert db("SELECT user_excluded_reason FROM public.positions ORDER BY 1").stdout.split() == ["other", "too_junior"]


def test_a_long_reason_with_no_comment_is_found_whole_in_the_comment_and_cut_in_the_note(migrated):
    reason, note, comment = row(migrated["db"], "1")
    assert reason == "other"
    assert len(note) == 200 and "\x01" not in note and "\t" not in note
    assert comment == ("troppo\tsenior\x01 " + LONG_REASON).strip()


def test_a_long_reason_with_a_comment_goes_after_it_behind_a_separator(migrated):
    reason, note, comment = row(migrated["db"], "2")
    assert reason == "other" and len(note) == 200
    assert comment == "già scritto\n---\n" + LONG_REASON


def test_a_valid_code_and_an_old_code_keep_what_they_had(migrated):
    assert row(migrated["db"], "3") == ["too_senior", "una nota", "una nota"]
    reason, _note, comment = row(migrated["db"], "4")
    assert reason == "other" and comment == "perché sì"


def test_what_does_not_fit_in_2000_is_cut_there_and_the_migration_says_so(migrated):
    _reason, _note, comment = row(migrated["db"], "5")
    assert len(comment) == 2000 and comment.startswith("c" * 1900)
    assert "did not fit" in migrated["first"].stderr
