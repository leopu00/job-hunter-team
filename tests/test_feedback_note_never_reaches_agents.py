"""JHT-T05: la nota dell'utente non arriva a nessun agente, e il motivo è un codice.

Una nota «sentinella» viene scritta in TUTTI i posti dove l'utente può
lasciare del testo (nota del feedback, nota dell'esclusione) e in quelli dove
i dati vecchi lo hanno lasciato (motivo libero, commento). Poi si eseguono
tutte le letture raggiungibili da un agente — le skill `feedback_query`,
`db_query` (compresi `positions --json`, `position --json` e `--field`, che
leggono `SELECT p.*`), la calibrazione e il contesto del local scorer — e la
sentinella non deve comparire in nessuna uscita.

Un test sul sorgente da solo sarebbe cieco a `p.*`: qui si esegue.

Eseguire con: pytest tests/test_feedback_note_never_reaches_agents.py -v
"""

import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
sys.path.insert(0, SKILLS_DIR)

SENTINEL = 'SENTINELLA-nota-privata-7f3a'

RECENT_AT = (
    datetime.now(timezone.utc) - timedelta(days=1)
).isoformat(timespec='seconds').replace('+00:00', 'Z')


def skill(name):
    return os.path.join(SKILLS_DIR, name)


@pytest.fixture
def home(tmp_path):
    """Un jobs.db con la sentinella in ogni posto in cui l'utente può scrivere."""
    db = str(tmp_path / 'jobs.db')
    env = {**os.environ, 'JHT_DB': db, 'JHT_HOME': str(tmp_path), 'PYTHONDONTWRITEBYTECODE': '1'}
    seed = subprocess.run([sys.executable, '-c', f'''
import sys
sys.path.insert(0, {SKILLS_DIR!r})
from _db import get_db, ensure_schema
c = get_db(); ensure_schema(c)
for title, company in (("Backend", "Acme"), ("Data", "Beta"), ("Ops", "Gamma")):
    c.execute("INSERT INTO positions (title, company, status) VALUES (?, ?, 'scored')", (title, company))
c.commit(); c.close()
'''], capture_output=True, text=True, env=env)
    assert seed.returncode == 0, seed.stderr

    # La nota scritta dall'utente, per le due vie nuove.
    rec = subprocess.run([sys.executable, skill('feedback_record.py'), 'set', '1', 'dislike',
                          '--reason', 'too_senior', '--note', SENTINEL],
                         capture_output=True, text=True, env=env)
    assert rec.returncode == 0, rec.stdout + rec.stderr
    exc = subprocess.run([sys.executable, skill('user_exclude.py'), 'exclude', '2',
                          '--reason', 'wrong_stack', '--note', SENTINEL],
                         capture_output=True, text=True, env=env)
    assert exc.returncode == 0, exc.stdout + exc.stderr

    # I dati vecchi: motivo libero, commento, nota di esclusione lunga.
    conn = sqlite3.connect(db)
    conn.execute("INSERT INTO position_feedback (position_id, action, reason, comment) "
                 "VALUES (3, 'dislike', ?, ?)", (SENTINEL, SENTINEL))
    conn.execute("UPDATE positions SET user_excluded_note = ? WHERE id = 3", (SENTINEL * 5,))
    conn.commit()
    conn.close()
    return db, env


def run(env, name, *args):
    done = subprocess.run([sys.executable, skill(name), *args], capture_output=True,
                          text=True, env=env, cwd=REPO_ROOT, timeout=60)
    return done


READERS = [
    ('feedback_query.py', ['check', '1']),
    ('feedback_query.py', ['check', '3']),
    ('feedback_query.py', ['recent', '--legacy-ids', '1,2,3']),
    ('feedback_query.py', ['themes', '--legacy-ids', '1,2,3', '--min-positions', '1']),
    ('db_query.py', ['positions', '--json']),
    ('db_query.py', ['positions']),
    ('db_query.py', ['position', '1', '--json']),
    ('db_query.py', ['position', '2', '--json']),
    ('db_query.py', ['position', '3', '--json']),
    ('db_query.py', ['position', '2']),
    ('db_query.py', ['position', '2', '--field', 'status']),
    ('db_query.py', ['position', '2', '--field', 'user_excluded_reason']),
    ('db_query.py', ['position', '2', '--field', 'user_excluded_note']),
    ('db_query.py', ['recent-activity', '--json']),
    ('db_query.py', ['dashboard', '--json']),
    ('db_query.py', ['next-for-calibration']),
]


@pytest.mark.parametrize('name,args', READERS, ids=[' '.join([n, *a]) for n, a in READERS])
def test_the_sentinel_note_is_in_no_output_an_agent_can_run(home, name, args):
    _db, env = home
    done = run(env, name, *args)
    assert SENTINEL not in done.stdout + done.stderr, f'{name} {args}: {done.stdout[:300]}'


def test_the_readers_do_run_on_this_database(home):
    """La sentinella assente deve voler dire «filtrata», non «il comando è fallito»."""
    _db, env = home
    pos = json.loads(run(env, 'db_query.py', 'position', '2', '--json').stdout)
    assert pos['user_excluded_reason'] == 'wrong_stack' and 'user_excluded_note' not in pos
    every = json.loads(run(env, 'db_query.py', 'positions', '--json').stdout)
    assert len(every) == 3 and all('user_excluded_note' not in p for p in every)
    check = json.loads(run(env, 'feedback_query.py', 'check', '1').stdout)
    assert check['actions'][0]['reason'] == 'too_senior'
    legacy = json.loads(run(env, 'feedback_query.py', 'check', '3').stdout)
    assert legacy['actions'][0]['reason'] == 'other'
    assert run(env, 'db_query.py', 'position', '2', '--field', 'status').stdout.strip() == 'excluded'


def test_field_refuses_a_column_that_is_not_on_the_allow_list(home):
    _db, env = home
    done = run(env, 'db_query.py', 'position', '2', '--field', 'user_excluded_note')
    assert done.returncode != 0 and done.stdout.strip() == ''


def test_the_user_still_has_the_note(home):
    """Il filtro è sulle uscite verso gli agenti: la nota resta salvata per l'utente."""
    db, _env = home
    conn = sqlite3.connect(db)
    assert conn.execute('SELECT note FROM position_feedback WHERE position_id = 1').fetchone()[0] == SENTINEL
    assert conn.execute('SELECT user_excluded_note FROM positions WHERE id = 2').fetchone()[0] == SENTINEL
    conn.close()


def test_the_cloud_lane_gives_no_text_either(monkeypatch):
    """Le righe del cloud portano nota e commento: nessuna esce da feedback_query."""
    import feedback_query as fq

    rows = [{'position_legacy_id': str(i), 'action': 'dislike', 'reason': SENTINEL,
             'comment': SENTINEL, 'note': SENTINEL, 'score': None, 'direction': None,
             'created_at': RECENT_AT} for i in (1, 2, 3)]
    monkeypatch.setattr(fq, '_api_get', lambda *a, **k: (True, {'feedback': rows}))
    monkeypatch.setattr(fq, '_local_events', lambda _id: None)
    for payload in (fq.recent_feedback(days=30),
                    fq.themes_report(days=30, min_positions=1),
                    fq.check_position('1')):
        assert SENTINEL not in json.dumps(payload)


def test_the_local_scorer_prompt_gets_codes_only(monkeypatch):
    import feedback_query as fq
    import local_scorer

    rows = [{'position_legacy_id': str(i), 'action': 'dislike', 'reason': 'too_senior',
             'comment': SENTINEL, 'note': SENTINEL, 'score': None, 'direction': None,
             'created_at': RECENT_AT} for i in (1, 2, 3)]
    monkeypatch.setattr(fq, '_api_get', lambda *a, **k: (True, {'feedback': rows}))
    payload = fq.themes_report(days=30, min_positions=1, exclude_legacy_ids=['42'])
    themes, _audit = local_scorer._feedback_context_from_payload(payload, 42)
    prompt = local_scorer.build_prompt('target_role: fixture', {'id': 42, 'title': 'T'}, themes)
    assert SENTINEL not in prompt
    assert '"key": "too_senior"' in prompt


def test_every_positions_column_is_either_allowed_to_agents_or_user_only():
    """Una colonna nuova di `positions` non esce verso gli agenti finché qualcuno
    non la mette nell'elenco: questo test fallisce finché non lo decide."""
    import db_query
    from _db import ensure_schema
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)
    columns = {r[1] for r in conn.execute('PRAGMA table_info(positions)')}
    undecided = columns - db_query.AGENT_POSITION_COLUMNS - db_query.USER_ONLY_POSITION_COLUMNS
    assert not undecided, f'colonne di positions da classificare: {sorted(undecided)}'
    assert not (db_query.AGENT_POSITION_COLUMNS & db_query.USER_ONLY_POSITION_COLUMNS)
    assert 'user_excluded_note' in db_query.USER_ONLY_POSITION_COLUMNS


def test_the_agent_facing_sql_never_names_the_free_text_columns():
    source = open(skill('feedback_query.py'), encoding='utf-8').read()
    select = source[source.index('SELECT action'):source.index('FROM position_feedback')]
    assert 'comment' not in select and 'note' not in select
