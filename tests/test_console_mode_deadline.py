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


def _save(home, maintenance, enrichment=None, expect_ok=True):
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
    assert (res.returncode == 0) is expect_ok, res.stderr or res.stdout
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


# ── La Console può DARE una scadenza, non solo perderla ───────────────────

def test_save_accepts_an_absolute_deadline(home):
    _save(home, {'mode': 'saving', 'mode_until': FUTURE})

    assert json.loads(_mode_file(home).read_text(encoding='utf-8')) == {
        'mode': 'saving', 'mode_until': FUTURE}


def test_the_console_can_prefill_its_field_from_the_state(home):
    """Il campo «fino a quando» si precompila col delta, non con la data: è
    quello che il gioco può rimandare indietro senza discutere di fusi."""
    _save(home, {'mode': 'saving', 'mode_until_hours': 30})

    left = _state(home)['maintenance']['mode_until_sec']

    assert 29 * 3600 < left <= 30 * 3600


def test_save_accepts_a_duration_and_dates_it_here(home):
    """La durata viaggia relativa e diventa un istante NEL container: fra host e
    container il fuso può differire (la lezione di `burn_intent`), e la scadenza
    la valutano i lettori del container."""
    _save(home, {'mode': 'saving', 'mode_until_hours': 48})

    written = json.loads(_mode_file(home).read_text(encoding='utf-8'))
    state = _state(home)['maintenance']
    assert written['mode_until'] == state['mode_until']
    assert state['expired'] is False
    assert state['mode_until_in'] in ('2d 0h', '1d 23h')


def test_save_can_take_the_deadline_away(home):
    """`null` esplicito: togliere la scadenza è una scelta, e va distinta dal
    non parlarne (che invece la preserva)."""
    _write_mode_file(home, {'mode': 'saving', 'mode_until': FUTURE})

    _save(home, {'mode': 'saving', 'mode_until': None})

    assert json.loads(_mode_file(home).read_text(encoding='utf-8')) == {
        'mode': 'saving'}


def test_zero_hours_means_no_deadline_not_an_instant_one(home):
    _write_mode_file(home, {'mode': 'saving', 'mode_until': FUTURE})

    _save(home, {'mode': 'saving', 'mode_until_hours': 0})

    assert 'mode_until' not in json.loads(
        _mode_file(home).read_text(encoding='utf-8'))


def test_an_unreadable_date_is_refused_before_anything_is_written(home):
    """Una data che il lettore non digerisce sarebbe una modalità senza fine:
    il difetto di partenza. Meglio rifiutare il salvataggio INTERO che scrivere
    metà delle impostazioni con una promessa che nessuno mantiene."""
    out = _save(home, {'mode': 'saving', 'mode_until': 'venerdì'},
                expect_ok=False)

    assert out['ok'] is False
    assert 'ISO 8601' in out['error']
    assert not _mode_file(home).exists()
    assert not (home / 'profile' / 'enrichment-policy.json').exists()


# ── La Console mostra la modalità in vigore, non quella scritta ────────────

def _current_mode(home):
    """La modalità secondo il freno di spesa: l'altro lettore della stessa
    chiave. È il confronto che conta — un payload che decide da sé quando una
    scadenza è passata farebbe divergere UI e enforcement."""
    res = subprocess.run(
        [sys.executable, '-c',
         'import json, enrichment_policy;'
         ' print(json.dumps(enrichment_policy.current_mode()))'],
        capture_output=True, text=True, env=_env(home))
    assert res.returncode == 0, res.stderr
    return json.loads(res.stdout)


def test_state_keeps_a_mode_whose_deadline_is_still_ahead(home):
    _write_mode_file(home, {'mode': 'saving', 'mode_until': FUTURE})

    maintenance = _state(home)['maintenance']

    assert maintenance['mode'] == 'saving' == _current_mode(home)
    assert maintenance['expired'] is False
    assert maintenance['mode_until'] == FUTURE
    assert maintenance['mode_until_valid'] is True
    assert maintenance['mode_until_in']    # «quanto manca», non vuoto
    assert maintenance['mode_until_sec'] > 0


def test_state_reports_search_once_the_deadline_has_passed(home):
    """Il caso del ticket: il file dice ancora `saving`, il motore è già in
    `search`, e finora la Console mostrava il file."""
    _write_mode_file(home, {'mode': 'saving', 'mode_until': PAST})

    maintenance = _state(home)['maintenance']

    assert maintenance['mode'] == 'search' == _current_mode(home)
    assert maintenance['expired'] is True
    # Il grezzo resta, altrimenti la Console non può dire COSA è scaduto.
    assert maintenance['mode_raw'] == 'saving'
    assert maintenance['mode_until'] == PAST


def test_an_expired_care_mode_takes_its_orders_with_it(home):
    """«cura fino a venerdì» è UN ordine con una fine: `stop_search` che
    sopravvive alla scadenza significherebbe tornare a `search` e non cercare
    comunque, cioè non tornare affatto."""
    _write_mode_file(home, {'mode': 'care', 'mode_until': PAST,
                            'orders': {'stop_search': False,
                                       'cv_min_score': 40}})

    maintenance = _state(home)['maintenance']

    assert maintenance['mode'] == 'search'
    assert maintenance['enabled'] is False
    assert maintenance['stop_search'] is True      # il default, non l'ordine
    assert maintenance['cv_min_score'] == 90


def test_an_unreadable_deadline_does_not_end_the_mode(home):
    """Direzione sicura di `mode_deadline`: l'ignoto è un ordine ancora attivo.
    La Console lo dice (`mode_until_valid` False) invece di inventare una fine.
    """
    _write_mode_file(home, {'mode': 'saving', 'mode_until': 'venerdì'})

    maintenance = _state(home)['maintenance']

    assert maintenance['mode'] == 'saving' == _current_mode(home)
    assert maintenance['expired'] is False
    assert maintenance['mode_until_valid'] is False


def test_no_deadline_at_all_stays_silent(home):
    _write_mode_file(home, {'mode': 'saving'})

    maintenance = _state(home)['maintenance']

    assert maintenance['mode'] == 'saving'
    assert maintenance['mode_until'] is None
    assert maintenance['mode_until_valid'] is None
    assert maintenance['mode_until_in'] == ''
