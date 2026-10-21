"""JHT-T05: la migrazione dei motivi vecchi non perde il testo dell'utente.

Un `reason` libero (fino a 500 caratteri) diventa il codice `other`; la nota ne
tiene i primi 200, il testo INTERO si ritrova nel commento (tetto 2000, nessun
agente lo legge): al posto del commento se era vuoto, in coda se c'era già.

Eseguire con: pytest tests/test_feedback_reasons_migration.py -v
"""
import os
import sqlite3
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(REPO_ROOT, 'shared', 'skills'))
import _db  # noqa: E402

LONG_REASON = ('Il ruolo è troppo orientato alla vendita e la sede richiede tre giorni '
               'in ufficio a Milano. ') * 6
LONG_REASON = LONG_REASON[:500]


def legacy_db():
    conn = sqlite3.connect(':memory:')
    conn.execute('CREATE TABLE position_feedback (id INTEGER PRIMARY KEY, position_id INTEGER, '
                 'action TEXT, reason TEXT, comment TEXT, score INTEGER, direction TEXT)')
    return conn


def insert(conn, reason, comment=None):
    conn.execute('INSERT INTO position_feedback (position_id, action, reason, comment) '
                 "VALUES (1, 'dislike', ?, ?)", (reason, comment))
    return conn.execute('SELECT MAX(id) FROM position_feedback').fetchone()[0]


def row(conn, row_id):
    return conn.execute('SELECT reason, note, comment FROM position_feedback WHERE id = ?',
                        (row_id,)).fetchone()


def test_a_500_character_reason_with_an_empty_comment_is_found_whole_in_the_comment():
    conn = legacy_db()
    row_id = insert(conn, LONG_REASON, None)
    blank = insert(conn, LONG_REASON, '   ')
    _db._migrate_feedback_reasons_closed(conn)
    for rid in (row_id, blank):
        reason, note, comment = row(conn, rid)
        assert reason == 'other'
        assert len(note) == 200 and LONG_REASON.startswith(note)
        assert comment == LONG_REASON


def test_a_500_character_reason_with_a_full_comment_goes_after_it_with_a_separator():
    conn = legacy_db()
    row_id = insert(conn, LONG_REASON, 'commento già scritto')
    _db._migrate_feedback_reasons_closed(conn)
    reason, note, comment = row(conn, row_id)
    assert reason == 'other' and len(note) == 200
    assert comment == 'commento già scritto' + _db._FEEDBACK_SEPARATOR + LONG_REASON
    assert len(comment) <= 2000


def test_a_comment_near_the_ceiling_keeps_its_start_and_the_cut_is_told(capsys):
    conn = legacy_db()
    comment = 'c' * 1900
    row_id = insert(conn, LONG_REASON, comment)
    _db._migrate_feedback_reasons_closed(conn)
    _reason, _note, kept = row(conn, row_id)
    assert len(kept) == 2000 and kept.startswith(comment)
    assert '1 original reason text(s)' in capsys.readouterr().err


def test_what_already_fits_is_not_told_and_the_migration_is_idempotent(capsys):
    conn = legacy_db()
    row_id = insert(conn, 'troppo junior per me', 'una nota')
    _db._migrate_feedback_reasons_closed(conn)
    first = row(conn, row_id)
    _db._migrate_feedback_reasons_closed(conn)
    assert row(conn, row_id) == first
    assert first[0] == 'other' and first[2] == 'una nota' + _db._FEEDBACK_SEPARATOR + 'troppo junior per me'
    assert capsys.readouterr().err == ''


@pytest.mark.parametrize('old', ['not_interested', 'mismatch', 'conditions'])
def test_the_three_old_codes_have_no_text_to_keep(old):
    conn = legacy_db()
    row_id = insert(conn, old, 'perché sì')
    _db._migrate_feedback_reasons_closed(conn)
    reason, _note, comment = row(conn, row_id)
    assert reason == 'other' and comment == 'perché sì'
