"""
I numeri che la Console mostra accanto a una modalità devono essere quelli
della coda che quella modalità fa lavorare.

Perché esiste. `coordinator_state.py` conta il backlog di `harvest` e il
feedback non consumato di `calibration` con SQL **inline**, invece di chiamare
`db_query.py`. È una scelta motivata — durante un rolling deploy il gioco può
essere più nuovo dell'immagine del container, e un payload che importasse gli
helper si romperebbe a metà aggiornamento — ma paga quella robustezza con una
duplicazione, e le duplicazioni divergono: era già successo fra la stima del
banner e la coda del raccolto (vedi `test_harvest_estimate_matches_queue.py`),
dove il disallineo valeva 122 posizioni su una VPS reale.

Qui si chiude l'altro asse. La Console è la superficie su cui l'utente sceglie
la modalità: se dice «N posizioni con score alto sono ancora senza CV» e la
coda ne serve un numero diverso, il click viene deciso su un dato che nessuno
lavorerà.

Il test non confronta le SQL — le fa girare sullo stesso database e pretende lo
stesso numero, incluso il giro completo del watermark di calibrazione (che è la
parte con più stato, quindi quella che diverge più facilmente).
"""

import json
import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_QUERY = os.path.join(SKILLS_DIR, 'db_query.py')
CONSOLE_STATE = os.path.join(REPO_ROOT, 'game', 'scripts', 'backend',
                             'payloads', 'coordinator_state.py')

# Il payload apre con `sys.path.insert(0, '/app/shared/skills')`: dentro il
# container è la via giusta, fuori quel path non esiste e l'import prosegue
# lungo il resto di sys.path — da cui il PYTHONPATH qui sotto. Se un giorno il
# payload smettesse di reggersi su questo, il test lo direbbe subito.
_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)

# harvest: due raccoglibili (#1, #7) fra distrattori che ogni predicato esclude.
# #8 sta appena SOTTO la soglia (72 contro 75) ed è il solo distrattore che
# esiste per il valore della soglia e non per un predicato booleano: senza di
# lui una soglia che deriva di qualche punto passa inosservata, perché fra 40 e
# 80 non c'è niente da contare. È il caso che il test ha mancato al primo giro.
rows = [
    (1, 'raccoglibile',     'scored', 1, None,         90),
    (2, 'ready non scored', 'ready',  1, None,         88),
    (3, 'chiusa',           'scored', 0, None,         85),
    (4, 'scaduta',          'scored', 1, '2026-01-01', 84),
    (5, 'ha gia il CV',     'scored', 1, None,         95),
    (6, 'sotto soglia',     'scored', 1, None,         40),
    (7, 'raccoglibile 2',   'scored', 1, None,         80),
    (8, 'appena sotto',     'scored', 1, None,         72),
]
for pid, title, status, is_open, expires_at, score in rows:
    conn.execute(
        "INSERT INTO positions (id, title, company, found_at, status, "
        "is_open, expires_at, url) VALUES (?,?,?,?,?,?,?,?)",
        (pid, title, 'ACME', '2026-07-01', status, is_open, expires_at,
         'http://example.invalid/%d' % pid))
    conn.execute("INSERT INTO scores (position_id, total_score) VALUES (?,?)",
                 (pid, score))
conn.execute("INSERT INTO applications (position_id) VALUES (5)")

# calibration: un'esclusione dell'utente + un ticket, con timestamp espliciti
# perché il taglio del watermark sia deterministico.
conn.execute("UPDATE positions SET user_excluded_at='2026-08-01 10:00:00', "
             "user_excluded_reason='non mi interessa' WHERE id=6")
conn.execute("INSERT INTO position_tickets (position_id, created_at, status, "
             "request_text) VALUES (7,'2026-08-01 11:00:00','open','guarda')")
conn.commit()
conn.close()
"""


def _env(home, with_skills_path=False):
    env = {**os.environ, 'JHT_HOME': str(home)}
    env.pop('JHT_DB_PATH', None)
    if with_skills_path:
        env['PYTHONPATH'] = SKILLS_DIR
    return env


def _run(argv, home, with_skills_path=False):
    return subprocess.run([sys.executable, *argv], capture_output=True,
                          text=True, env=_env(home, with_skills_path))


def _queue_len(home, name):
    res = _run([DB_QUERY, name, '--json'], home)
    assert res.returncode == 0, res.stderr
    rows = json.loads(res.stdout)
    if isinstance(rows, dict):
        rows = rows.get('rows', rows.get('items', []))
    return len(rows)


def _console_counts(home):
    res = _run([CONSOLE_STATE], home, with_skills_path=True)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)['queue_counts']


@pytest.fixture
def home(tmp_path):
    (tmp_path / 'profile').mkdir(parents=True, exist_ok=True)
    res = _run(['-c', _SEED.format(skills=SKILLS_DIR)], tmp_path)
    assert res.returncode == 0, res.stderr
    return tmp_path


def test_harvest_count_matches_the_queue(home):
    assert _console_counts(home)['harvest'] == _queue_len(home, 'next-for-harvest') == 2


def test_calibration_count_matches_the_queue(home):
    assert _console_counts(home)['calibration'] == _queue_len(home, 'next-for-calibration') == 2


def test_both_follow_the_watermark_together(home):
    """Il watermark è lo stato condiviso fra le due implementazioni: se una lo
    legge e l'altra no, la Console continua a segnalare feedback che la coda
    non serve più (o il contrario, che è peggio: feedback perso in silenzio)."""
    consumed = _run([DB_QUERY, 'calibration-consume'], home)
    assert consumed.returncode == 0, consumed.stderr
    assert json.loads(consumed.stdout)['advanced'] is True

    assert _console_counts(home)['calibration'] == _queue_len(home, 'next-for-calibration') == 0

    # Feedback NUOVO, posteriore al watermark: deve riaffiorare in entrambi.
    add = ("import sys; sys.path.insert(0, {skills!r});"
           "from _db import get_db;"
           "c=get_db();"
           "c.execute(\"INSERT INTO position_tickets (position_id, created_at,"
           " status, request_text) VALUES (1,'2026-08-02 09:00:00','open',"
           "'ripensaci')\");"
           "c.commit(); c.close()").format(skills=SKILLS_DIR)
    assert _run(['-c', add], home).returncode == 0

    assert _console_counts(home)['calibration'] == _queue_len(home, 'next-for-calibration') == 1
