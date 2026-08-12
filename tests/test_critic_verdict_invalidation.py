"""Regressione O-64: un verdetto non sopravvive al CV che giudicava.

Il contenuto vive su disco, mentre ``applications.written_at`` e' il marker
persistito della sua versione.  Il test modifica davvero il file e poi passa
dal write path canonico: l'UPDATE deve rendere invisibili, nella stessa
transazione, tutti i campi che le UI usano per mostrare il giudizio.

Eseguire con::

    pytest tests/test_critic_verdict_invalidation.py -v
"""

from __future__ import annotations

import os
import importlib.util
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_VARIANTS = (
    pytest.param(REPO_ROOT / "shared" / "skills", id="container"),
    pytest.param(
        REPO_ROOT / "desktop" / "app-payload" / "shared" / "skills",
        id="desktop-payload",
    ),
)


def _run(db: Path, script: Path, *args: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, str(script), *args],
        cwd=REPO_ROOT,
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent)},
        capture_output=True,
        text=True,
    )


def _seed_reviewed_application(
    db: Path, skills: Path, cv_path: Path, *, status: str = "ready"
) -> int:
    code = '''
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema

conn = get_db()
ensure_schema(conn)
position_id = conn.execute(
    "INSERT INTO positions (title, company, status, source) VALUES (?, ?, ?, ?)",
    ("Backend Engineer", "ExampleCo", "ready", "test"),
).lastrowid
conn.execute(
    """INSERT INTO applications (
           position_id, cv_path, status, written_at,
           critic_verdict, critic_score, critic_notes, critic_round,
           reviewed_by, critic_reviewed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
    (position_id, {cv_path!r}, {status!r}, "2026-07-14 16:00:00",
     "PASS", 7.5, "Feedback sulla prima versione", 3,
     "critico-test", "2026-07-14 16:20:00"),
)
conn.commit()
print(position_id)
conn.close()
'''.format(
        skills=str(skills), cv_path=str(cv_path), status=status
    )
    seeded = subprocess.run(
        [sys.executable, "-c", code],
        cwd=REPO_ROOT,
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent)},
        capture_output=True,
        text=True,
    )
    assert seeded.returncode == 0, seeded.stderr
    return int(seeded.stdout.strip())


def _seed_legacy_reviewed_application(db: Path, skills: Path, cv_path: Path) -> int:
    """Crea davvero lo schema pre-O-64: niente critic_round ne' trigger."""
    code = '''
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema

conn = get_db()
ensure_schema(conn)
conn.execute("DROP TRIGGER applications_invalidate_critic_after_rewrite")
conn.execute("ALTER TABLE applications DROP COLUMN critic_round")
position_id = conn.execute(
    "INSERT INTO positions (title, company, status, source) VALUES (?, ?, ?, ?)",
    ("Legacy Backend Engineer", "ExampleCo", "ready", "test"),
).lastrowid
conn.execute(
    """INSERT INTO applications (
           position_id, cv_path, status, written_at,
           critic_verdict, critic_score, critic_notes,
           reviewed_by, critic_reviewed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
    (position_id, {cv_path!r}, "ready", "2026-08-11 00:58:00",
     "PASS", 7.5, "Feedback legacy", "critico-test",
     "2026-07-14 16:20:00"),
)
conn.commit()
print(position_id)
conn.close()
'''.format(
        skills=str(skills), cv_path=str(cv_path)
    )
    seeded = subprocess.run(
        [sys.executable, "-c", code],
        cwd=REPO_ROOT,
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent)},
        capture_output=True,
        text=True,
    )
    assert seeded.returncode == 0, seeded.stderr
    return int(seeded.stdout.strip())


def _application(db: Path, position_id: int) -> sqlite3.Row:
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        row = conn.execute(
            """SELECT status, written_at, cv_pdf_path,
                      critic_verdict, critic_score, critic_notes, critic_round,
                      reviewed_by, critic_reviewed_at
               FROM applications WHERE position_id = ?""",
            (position_id,),
        ).fetchone()
    finally:
        conn.close()
    assert row is not None
    return row


def _ensure_current_schema(db: Path, skills: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "import sys; "
                f"sys.path.insert(0, {str(skills)!r}); "
                "from _db import get_db, ensure_schema; "
                "c=get_db(); ensure_schema(c); c.close()"
            ),
        ],
        cwd=REPO_ROOT,
        env={**os.environ, "JHT_DB": str(db), "JHT_HOME": str(db.parent)},
        capture_output=True,
        text=True,
    )


def _load_sync_module(skills: Path):
    script = skills / "db_to_supabase.py"
    spec = importlib.util.spec_from_file_location(
        f"db_to_supabase_o64_{abs(hash(script))}", script
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize("skills", SKILL_VARIANTS)
def test_cv_rewrite_atomically_invalidates_previous_critic_verdict(
    tmp_path: Path, skills: Path
) -> None:
    db = tmp_path / "jobs.db"
    cv = tmp_path / "cv.md"
    cv.write_text("prima versione", encoding="utf-8")
    position_id = _seed_reviewed_application(db, skills, cv)

    # La riscrittura reale avviene sul file; written_at ne pubblica la nuova
    # versione al resto del prodotto.
    cv.write_text("seconda versione", encoding="utf-8")
    updated = _run(
        db,
        skills / "db_update.py",
        "application",
        str(position_id),
        "--written-at",
        "2026-08-11 00:58:00",
    )

    assert updated.returncode == 0, updated.stderr
    saved = dict(_application(db, position_id))
    assert saved == {
        "status": "review",
        "written_at": "2026-08-11 00:58:00",
        "cv_pdf_path": None,
        "critic_verdict": None,
        "critic_score": None,
        "critic_notes": None,
        "critic_round": None,
        "reviewed_by": None,
        "critic_reviewed_at": None,
    }


@pytest.mark.parametrize("skills", SKILL_VARIANTS)
def test_non_textual_artifact_update_keeps_current_critic_verdict(
    tmp_path: Path, skills: Path
) -> None:
    db = tmp_path / "jobs.db"
    cv = tmp_path / "cv.md"
    cv.write_text("testo invariato", encoding="utf-8")
    position_id = _seed_reviewed_application(db, skills, cv)

    updated = _run(
        db,
        skills / "db_update.py",
        "application",
        str(position_id),
        "--cv-pdf-path",
        str(tmp_path / "cv-relocated.pdf"),
    )

    assert updated.returncode == 0, updated.stderr
    saved = dict(_application(db, position_id))
    assert saved["status"] == "ready"
    assert saved["critic_verdict"] == "PASS"
    assert saved["critic_score"] == 7.5
    assert saved["critic_notes"] == "Feedback sulla prima versione"
    assert saved["critic_round"] == 3
    assert saved["reviewed_by"] == "critico-test"
    assert saved["critic_reviewed_at"] == "2026-07-14 16:20:00"


@pytest.mark.parametrize("skills", SKILL_VARIANTS)
def test_schema_upgrade_does_not_backfill_existing_stale_rows(
    tmp_path: Path, skills: Path
) -> None:
    db = tmp_path / "jobs.db"
    cv = tmp_path / "cv.md"
    cv.write_text("versione gia' presente", encoding="utf-8")
    position_id = _seed_legacy_reviewed_application(db, skills, cv)

    # Installare davvero colonna e trigger sul vecchio DB non e'
    # autorizzazione a modificare i record reali gia' presenti.
    checked = _ensure_current_schema(db, skills)

    assert checked.returncode == 0, checked.stderr
    saved = dict(_application(db, position_id))
    assert saved["status"] == "ready"
    assert saved["critic_verdict"] == "PASS"
    assert saved["critic_score"] == 7.5
    assert saved["critic_round"] is None

    with sqlite3.connect(db) as conn:
        columns = {row[1] for row in conn.execute("PRAGMA table_info(applications)")}
        triggers = {
            row[0]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'trigger'"
            )
        }
    assert "critic_round" in columns
    assert "applications_invalidate_critic_after_rewrite" in triggers


@pytest.mark.parametrize("skills", SKILL_VARIANTS)
def test_direct_supabase_sync_invalidates_only_outgoing_legacy_payload(
    tmp_path: Path, skills: Path
) -> None:
    db = tmp_path / "jobs.db"
    cv = tmp_path / "cv.md"
    cv.write_text("versione riscritta prima dell'upgrade", encoding="utf-8")
    position_id = _seed_legacy_reviewed_application(db, skills, cv)
    upgraded = _ensure_current_schema(db, skills)
    assert upgraded.returncode == 0, upgraded.stderr

    sync = _load_sync_module(skills)
    patched: list[dict[str, object]] = []
    sync.sb_get = lambda *_args, **_kwargs: [
        {"id": "application-cloud", "position_id": "position-cloud"}
    ]
    sync.sb_patch = lambda _url, _key, _table, _filters, data: patched.append(
        dict(data)
    )

    with sqlite3.connect(db) as conn:
        conn.row_factory = sqlite3.Row
        sync.sync_applications(
            conn,
            "https://cloud.example.test",
            "synthetic-key",
            "synthetic-user",
            {position_id: "position-cloud"},
        )

    assert len(patched) == 1
    assert patched[0]["status"] == "review"
    for field in (
        "critic_verdict",
        "critic_score",
        "critic_notes",
        "critic_round",
        "reviewed_by",
        "critic_reviewed_at",
    ):
        assert patched[0][field] is None

    # La compatibilita' sync non e' un'autorizzazione al backfill locale.
    saved = dict(_application(db, position_id))
    assert saved["status"] == "ready"
    assert saved["critic_verdict"] == "PASS"
    assert saved["critic_score"] == 7.5


@pytest.mark.parametrize("status", ["applied", "response"])
@pytest.mark.parametrize("skills", SKILL_VARIANTS)
def test_post_submission_status_is_not_reopened_but_stale_verdict_is_removed(
    tmp_path: Path, skills: Path, status: str
) -> None:
    db = tmp_path / "jobs.db"
    cv = tmp_path / "cv.md"
    cv.write_text("prima versione", encoding="utf-8")
    position_id = _seed_reviewed_application(db, skills, cv, status=status)

    cv.write_text("copia aggiornata dopo l'invio", encoding="utf-8")
    updated = _run(
        db,
        skills / "db_update.py",
        "application",
        str(position_id),
        "--written-at",
        "2026-08-11 00:58:00",
    )

    assert updated.returncode == 0, updated.stderr
    saved = dict(_application(db, position_id))
    assert saved["status"] == status
    assert saved["critic_verdict"] is None
    assert saved["critic_score"] is None
    assert saved["critic_notes"] is None
    assert saved["critic_round"] is None
