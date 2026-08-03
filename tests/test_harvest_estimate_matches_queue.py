"""
La stima del banner e la coda del raccolto devono contare LE STESSE righe.

Perché esiste. `mode_banner.py` valuta la condizione di uscita di `harvest` con
una SQL propria, e `db_query.py next-for-harvest` ne ha un'altra: il banner non
importa db_query (deve reggersi anche con un jobs.db a schema ridotto), quindi
i predicati sono duplicati per costruzione. Alla prima integrazione avevano già
divergerato — il banner filtrava solo `status != 'excluded'`, la coda anche
`status = 'scored'`, `is_open` e la scadenza. Su una VPS reale quel disallineo
valeva 122 posizioni `ready` contate come "da raccogliere" dal banner e assenti
dalla coda: il Capitano leggeva un numero di un'altra coda.

La direzione dell'errore era benigna (sovrastimare non produce mai un falso
«raccolto finito»), ed è proprio questo che lo rendeva difficile da notare.

Questo test non confronta le due SQL — le fa girare sullo stesso DB e pretende
lo stesso numero. Se qualcuno cambia i predicati di una sola delle due, fallisce
qui invece che in produzione.
"""

import json
import os
import re
import subprocess
import sys

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
DB_QUERY = os.path.join(SKILLS_DIR, 'db_query.py')
MODE_BANNER = os.path.join(SKILLS_DIR, 'mode_banner.py')

# Una riga per ogni predicato che distingue le due query, così il test fallisce
# se ne cade uno solo: soglia, application già presente, stato, apertura,
# scadenza. Attesi vivi e raccoglibili: solo #1 e #7.
_SEED = """
import sys
sys.path.insert(0, {skills!r})
from _db import get_db, ensure_schema
conn = get_db()
ensure_schema(conn)
rows = [
    (1, 'raccoglibile',      'scored', 1, None,         90),
    (2, 'ready non scored',  'ready',  1, None,         88),
    (3, 'chiusa',            'scored', 0, None,         85),
    (4, 'scaduta',           'scored', 1, '2026-01-01', 84),
    (5, 'ha gia il CV',      'scored', 1, None,         95),
    (6, 'sotto soglia',      'scored', 1, None,         40),
    (7, 'raccoglibile 2',    'scored', 1, None,         80),
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
conn.commit()
conn.close()
"""

EXPECTED_HARVESTABLE = 2


def _run(argv, home):
    env = {**os.environ, 'JHT_HOME': str(home)}
    env.pop('JHT_DB_PATH', None)
    return subprocess.run([sys.executable, *argv], capture_output=True,
                          text=True, env=env)


def _seed(home):
    (home / 'profile').mkdir(parents=True, exist_ok=True)
    res = _run(['-c', _SEED.format(skills=SKILLS_DIR)], home)
    assert res.returncode == 0, res.stderr
    (home / 'profile' / 'capitano-maintenance.json').write_text(
        json.dumps({'mode': 'harvest'}), encoding='utf-8')


def test_banner_estimate_equals_queue_count(tmp_path):
    _seed(tmp_path)

    queue = _run([DB_QUERY, 'next-for-harvest', '--json'], tmp_path)
    assert queue.returncode == 0, queue.stderr
    rows = json.loads(queue.stdout)
    if isinstance(rows, dict):                 # {"rows": [...], "total": N}
        rows = rows.get('rows', rows.get('items', []))
    assert len(rows) == EXPECTED_HARVESTABLE, queue.stdout

    banner = _run([MODE_BANNER, 'json'], tmp_path)
    assert banner.returncode == 0, banner.stderr
    exit_info = json.loads(banner.stdout)['exit']

    # `pending` con il conteggio: mai `done` (ci sono righe), mai `unavailable`
    # (il DB c'è e lo schema è quello vero).
    assert exit_info['kind'] == 'pending', exit_info
    numbers = [int(n) for n in re.findall(r'\d+', exit_info['detail'])]
    assert EXPECTED_HARVESTABLE in numbers, exit_info['detail']


def test_banner_says_done_exactly_when_the_queue_empties(tmp_path):
    _seed(tmp_path)

    # Un CV per ognuna delle due raccoglibili: la coda si svuota e il banner
    # deve dichiarare RACCOLTO FINITO nello stesso istante, non prima.
    drain = ("import sys; sys.path.insert(0, {skills!r});"
             "from _db import get_db;"
             "c=get_db();"
             "c.execute('INSERT INTO applications (position_id) VALUES (1)');"
             "c.execute('INSERT INTO applications (position_id) VALUES (7)');"
             "c.commit(); c.close()").format(skills=SKILLS_DIR)
    assert _run(['-c', drain], tmp_path).returncode == 0

    queue = _run([DB_QUERY, 'next-for-harvest', '--json'], tmp_path)
    rows = json.loads(queue.stdout)
    if isinstance(rows, dict):
        rows = rows.get('rows', rows.get('items', []))
    assert rows == []

    exit_info = json.loads(_run([MODE_BANNER, 'json'], tmp_path).stdout)['exit']
    assert exit_info['kind'] == 'done', exit_info
