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
POLICY = os.path.join(SKILLS_DIR, 'enrichment_policy.py')
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

# recheck (soglia 70, oltre 7 giorni): #1 mai verificata, #7 verificata a giugno.
# #3 è IL caso che divideva le due implementazioni: `last_checked` vecchio ma
# `last_open_check` di oggi — il lavoro è stato fatto, dalla lane on-demand, e
# la coda vera lo sa perché guarda MAX(last_checked, last_open_check). Chi
# guarda solo `last_checked` la conta ancora, e sovrastima.
conn.execute("UPDATE positions SET last_checked='2026-06-01 08:00:00' WHERE id=7")
conn.execute("UPDATE positions SET last_checked='2026-06-01 08:00:00', "
             "last_open_check=datetime('now') WHERE id=3")
conn.execute("UPDATE positions SET last_checked=datetime('now') WHERE id=5")

# geocode (soglia 65, non-remote): #1 e #7 senza coordinate; #2 è remota (fuori),
# #6 è sotto soglia (fuori), #4 ha già le coordinate (fuori).
conn.execute("UPDATE positions SET work_mode='remote' WHERE id=2")
conn.execute("UPDATE positions SET office_lat=45.4, office_lon=9.2, "
             "office_geocoded=1 WHERE id=4")

# logo: due aziende con posizioni vive, una col logo già tentato (fuori coda).
conn.execute("INSERT INTO companies (id, name, logo_fetched) VALUES "
             "(1,'ACME',0),(2,'Globex',0),(3,'Initech',1)")
conn.execute("UPDATE positions SET company_id=1 WHERE id IN (1,2,3,4)")
conn.execute("UPDATE positions SET company_id=2 WHERE id IN (5,6)")
conn.execute("UPDATE positions SET company_id=3 WHERE id IN (7,8)")
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


def _queue(home, name):
    """La coda condivisa, come la vede chi la interroga: `{enabled, total, …}`."""
    res = _run([DB_QUERY, name, '--json', '--all'], home)
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def _queue_rows(home, name):
    payload = _queue(home, name)
    if isinstance(payload, dict):
        return payload.get('rows', payload.get('items', []))
    return payload


def _queue_len(home, name):
    return len(_queue_rows(home, name))


def _queue_ids(home, name):
    return {int(r['id']) for r in _queue_rows(home, name)}


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


def test_recheck_count_matches_the_queue(home):
    """Il caso che ha diviso le due implementazioni ([CONSOLE-COUNTS-INLINE-SQL]).

    La #3 è stata verificata OGGI dalla lane on-demand (`last_open_check`) e ha
    un `last_checked` di giugno; la #5 dal pass generico. La coda non le serve
    più — guarda `MAX(last_checked, last_open_check)`. La Console guardava solo
    `last_checked`, quindi la #3 la contava ancora: ogni posizione verificata
    così gonfiava il numero su cui l'utente decide se accendere la cura.

    Il numero atteso non è scritto a mano: si pretende che i DUE contatori
    diano lo stesso, e che la coda escluda proprio quelle due — un test che
    fissasse solo il totale passerebbe anche se sbagliassero insieme.
    """
    served = _queue_ids(home, 'next-for-recheck-due')

    assert _console_counts(home)['recheck'] == len(served)
    assert 3 not in served, "verificata via last_open_check: non è più da rifare"
    assert 5 not in served, "verificata via last_checked: non è più da rifare"
    assert {1, 7} <= served, "mai verificata e verificata a giugno: da rifare"


def test_geocode_count_matches_the_queue(home):
    """Con la soglia di score accesa: è il gate che le due copie applicavano in
    modo diverso (la Console con un EXISTS su `scores`, la coda con la stessa
    condizione ma dietro il flag della policy)."""
    res = _run([POLICY, 'set', 'geocode_missing.min_score', '65'], home)
    assert res.returncode == 0, res.stderr
    missing = _queue_ids(home, 'next-for-geocode-missing')

    assert _console_counts(home)['geocode'] == len(missing)
    assert 2 not in missing, "remota: fuori con non_remote_only"
    assert 4 not in missing, "ha già le coordinate"
    assert 6 not in missing, "score 40, sotto la soglia 65"
    assert {1, 7} <= missing


def test_logo_count_matches_the_queue(home):
    """Coda per AZIENDE, non per posizioni: due implementazioni che contano
    entità diverse sbagliano anche quando il predicato è identico."""
    assert _console_counts(home)['logos'] == _queue_len(home, 'next-for-logo-missing') == 2


@pytest.mark.parametrize('kind,card,queue', [
    ('recheck_weekly', 'recheck', 'next-for-recheck-due'),
    ('geocode_missing', 'geocode', 'next-for-geocode-missing'),
    ('logo', 'logos', 'next-for-logo-missing'),
])
def test_a_queue_switched_off_counts_zero(home, kind, card, queue):
    """Secondo difetto: una coda SPENTA non è una coda vuota per caso, ed è
    quella che l'utente non deve vedere annunciata. Con l'automatismo spento la
    coda serve zero lavori: se la Console mostrasse un numero, chiamerebbe al
    lavoro una squadra che ha l'ordine di non farlo."""
    res = _run([POLICY, 'set', f'{kind}.enabled', 'false'], home)
    assert res.returncode == 0, res.stderr

    assert _queue(home, queue)['enabled'] is False
    assert _console_counts(home)[card] == 0


@pytest.mark.parametrize('card,queue', [
    ('recheck', 'next-for-recheck-due'),
    ('geocode', 'next-for-geocode-missing'),
    ('logo', 'next-for-logo-missing'),
])
def test_saving_mode_empties_the_queues_for_both(home, card, queue):
    """`saving` è un ordine dell'utente sulla spesa: sovrasta la policy e
    spegne ogni enrichment autonomo. La Console la legge dallo stesso file, e
    quindi non può mostrare code che quel file ha già chiuso."""
    (home / 'profile').mkdir(parents=True, exist_ok=True)
    (home / 'profile' / 'capitano-maintenance.json').write_text(
        json.dumps({'mode': 'saving'}), encoding='utf-8')

    assert _queue(home, queue)['enabled'] is False
    counts = _console_counts(home)
    assert counts['recheck'] == counts['geocode'] == counts['logos'] == 0
    # Le code di sola lettura restano: sono liste, non spesa.
    assert counts['harvest'] == _queue_len(home, 'next-for-harvest') == 2


def test_economy_also_empties_them(home):
    res = _run([POLICY, 'set', 'economy', 'true'], home)
    assert res.returncode == 0, res.stderr

    counts = _console_counts(home)
    assert counts['recheck'] == counts['geocode'] == counts['logos'] == 0


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
