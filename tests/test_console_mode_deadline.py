"""
La scadenza della modalità deve sopravvivere alla Console, e la Console deve
mostrarla ([MODE-DEADLINE-UNREACHABLE-AND-ERASED]).

Perché esiste. `mode_until` (2026-08, [SAVING-MODE-HAS-NO-DEADLINE]) è la
condizione di uscita che impedisce a una modalità di durare per inerzia: la
scrive `jht coordinator set-mode --until`, la valutano in lettura
`enrichment_policy.current_mode()` e `mode_banner`. I due payload della Console
del gioco erano gli unici lettori ignari, e in due modi opposti:

  * `coordinator_save.py` riscriveva `capitano-maintenance.json` da zero, e chi
    toccava un'altra impostazione dalla Console si vedeva CANCELLARE la
    scadenza senza avviso — `saving` tornava a durare per inerzia;
  * `coordinator_state.py` leggeva `mode` grezzo, quindi dopo la scadenza la
    Console mostrava ancora `saving` mentre il motore era già in `search`.

Il test fa girare i payload veri (come `test_console_counts_match_queues.py`) e
confronta con `mode_deadline` / `enrichment_policy`: la regola sta in un solo
posto, e qui si pretende che i lettori arrivino tutti alla stessa conclusione.
"""

import base64
import json
import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
PAYLOADS = os.path.join(REPO_ROOT, 'game', 'scripts', 'backend', 'payloads')
CONSOLE_STATE = os.path.join(PAYLOADS, 'coordinator_state.py')
CONSOLE_SAVE = os.path.join(PAYLOADS, 'coordinator_save.py')

FUTURE = '2099-01-01T00:00:00Z'
PAST = '2020-01-01T00:00:00Z'


def _env(home):
    env = {**os.environ, 'JHT_HOME': str(home), 'PYTHONPATH': SKILLS_DIR}
    env.pop('JHT_DB_PATH', None)
    return env


@pytest.fixture
def home(tmp_path):
    (tmp_path / 'profile').mkdir(parents=True, exist_ok=True)
    return tmp_path


def _mode_file(home):
    return home / 'profile' / 'capitano-maintenance.json'


def _write_mode_file(home, payload):
    _mode_file(home).write_text(json.dumps(payload), encoding='utf-8')


def _save(home, maintenance, enrichment=None):
    """Il payload della Console, eseguito come lo esegue il gioco.

    Il file è un template: il JSON delle impostazioni arriva base64 al posto
    del `%s` (mai interpolato in una shell). Qui si sostituisce lo stesso
    valore, così il test copre il codice che gira davvero.
    """
    settings = {'maintenance': maintenance, 'enrichment': enrichment or {}}
    encoded = base64.b64encode(
        json.dumps(settings).encode('utf-8')).decode('ascii')
    source = open(CONSOLE_SAVE, encoding='utf-8').read() % encoded
    script = home / '_coordinator_save.py'
    script.write_text(source, encoding='utf-8')
    res = subprocess.run([sys.executable, str(script)], capture_output=True,
                         text=True, env=_env(home))
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def _state(home):
    res = subprocess.run([sys.executable, CONSOLE_STATE], capture_output=True,
                         text=True, env=_env(home))
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


# ── La Console non cancella la scadenza ───────────────────────────────────

def test_save_preserves_an_existing_deadline(home):
    """Il caso del ticket: la scadenza c'è, l'utente tocca un'ALTRA cosa."""
    _write_mode_file(home, {'mode': 'saving', 'mode_until': FUTURE})

    _save(home, {'mode': 'saving'}, {'economy': True})

    assert json.loads(_mode_file(home).read_text(encoding='utf-8')) == {
        'mode': 'saving', 'mode_until': FUTURE}


def test_save_preserves_the_deadline_across_a_mode_change(home):
    """`mode_until` non è di una modalità: dice fino a quando vale l'ordine.

    Stessa regola di `coordinator_settings.write_mode` (`jht coordinator`): una
    chiave che il comando non nomina resta dov'è. Due superfici che scrivono lo
    stesso file non possono avere due contratti.
    """
    _write_mode_file(home, {'mode': 'saving', 'mode_until': FUTURE})

    _save(home, {'mode': 'care', 'cv_min_score': 80})

    written = json.loads(_mode_file(home).read_text(encoding='utf-8'))
    assert written['mode_until'] == FUTURE
    assert written['orders']['cv_min_score'] == 80


def test_choosing_search_takes_the_deadline_with_it(home):
    """`search` cancella il file: una scadenza verso il posto in cui si è già
    non è un ordine, è un residuo."""
    _write_mode_file(home, {'mode': 'saving', 'mode_until': FUTURE})

    _save(home, {'mode': 'search'})

    assert not _mode_file(home).exists()


def test_a_broken_mode_file_does_not_stop_the_save(home):
    """Un file illeggibile non ha una scadenza da preservare, ma nemmeno il
    diritto di bloccare la Console: l'utente sta proprio riscrivendolo."""
    _mode_file(home).write_text('{not json', encoding='utf-8')

    _save(home, {'mode': 'saving'})

    assert json.loads(_mode_file(home).read_text(encoding='utf-8')) == {
        'mode': 'saving'}
