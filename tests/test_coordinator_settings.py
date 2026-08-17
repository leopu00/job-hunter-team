"""
Le impostazioni del Capitano si cambiano anche da riga di comando — e scrivono
lo STESSO file che scrive la Console del gioco.

Perché esiste ([JHT-CLI-AGENT-PARITY]): la modalità di lavoro governa cosa fa
la squadra tutto il giorno, e fino al 2026-08-08 si poteva cambiare solo
aprendo l'ufficio. La regola del progetto dice l'opposto — «se per configurare
una feature devi aprire la dashboard, è un bug» — e per un agente LLM, che è il
pubblico dichiarato di AI-AGENT-INTEGRATION.md, quella decisione era
irraggiungibile.

Il rischio di questo lavoro non è la scrittura in sé: è la DIVERGENZA. Ora due
scrittori producono lo stesso file, e finché `game/` resta congelato non si
possono unificare. Il test più importante qui sotto è quindi l'ultimo: dato lo
stesso input, il payload del gioco e la skill del CLI devono lasciare su disco
lo stesso JSON.

Eseguire con: pytest tests/test_coordinator_settings.py -v
"""

import base64
import json
import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
SKILL = os.path.join(SKILLS_DIR, 'coordinator_settings.py')
GAME_SAVE = os.path.join(REPO_ROOT, 'game', 'scripts', 'backend', 'payloads',
                         'coordinator_save.py')


@pytest.fixture
def home(tmp_path):
    h = tmp_path / 'jht_home'
    (h / 'profile').mkdir(parents=True)
    return h


@pytest.fixture
def env(home):
    return {**os.environ, 'JHT_HOME': str(home), 'JHT_DB': str(home / 'jobs.db')}


def _run(env, *args):
    return subprocess.run([sys.executable, SKILL, *args],
                          capture_output=True, text=True, env=env)


def _mode_file(home):
    path = home / 'profile' / 'capitano-maintenance.json'
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding='utf-8'))


# ── Il contratto del file ───────────────────────────────────────────────

def test_search_removes_the_file_because_absence_is_the_default(home, env):
    _run(env, 'set-mode', 'care')
    assert _mode_file(home) is not None
    r = _run(env, 'set-mode', 'search')
    assert r.returncode == 0, r.stderr
    # Lasciare `{"mode": "search"}` dichiarerebbe un ordine che non c'è.
    assert _mode_file(home) is None


def test_care_carries_its_orders_with_the_documented_defaults(home, env):
    assert _run(env, 'set-mode', 'care').returncode == 0
    orders = _mode_file(home)['orders']
    assert orders == {'stop_search': True, 'discard_expired_rotating': True,
                      'cv_min_score': 90, 'pre_check_liveness_for_cv': True}


def test_the_other_modes_declare_only_themselves(home, env):
    _run(env, 'set-mode', 'care')
    assert _run(env, 'set-mode', 'saving').returncode == 0
    data = _mode_file(home)
    assert data['mode'] == 'saving'
    # Gli `orders` sono della cura: sotto un'altra modalità sarebbero ordini
    # che quella modalità non conosce — e `stop_search` lo legge chiunque.
    assert 'orders' not in data


def test_orders_are_refused_outside_care(env):
    r = _run(env, 'set-mode', 'saving', '--cv-min-score', '90')
    assert r.returncode == 1
    assert 'only belong to `care`' in r.stdout


def test_an_unreadable_deadline_is_refused_at_the_door(env):
    r = _run(env, 'set-mode', 'saving', '--until', 'venerdì sera')
    assert r.returncode == 1
    assert 'ISO 8601' in json.loads(r.stdout)['error']


# ── La scadenza, che dalla Console non si scrive ────────────────────────

def test_the_deadline_is_written_and_reported(home, env):
    assert _run(env, 'set-mode', 'saving',
                '--until', '2099-01-01T00:00:00Z').returncode == 0
    assert _mode_file(home)['mode_until'] == '2099-01-01T00:00:00Z'
    state = json.loads(_run(env, 'show', '--json').stdout)
    assert state['mode'] == 'saving'
    assert state['effective_mode'] == 'saving'
    assert state['expired'] is False


def test_an_expired_mode_is_reported_as_already_back_to_search(env):
    _run(env, 'set-mode', 'saving', '--until', '2020-01-01T00:00:00Z')
    state = json.loads(_run(env, 'show', '--json').stdout)
    # Il file dice ancora `saving`, la squadra è già tornata in `search`:
    # tenerli distinti è ciò che evita all'operatore di confondersi.
    assert state['mode'] == 'saving'
    assert state['effective_mode'] == 'search'
    assert state['expired'] is True


def test_changing_a_setting_does_not_silently_drop_the_deadline(home, env):
    """La differenza deliberata con la Console, che riscrive da zero: un
    comando che non parla di scadenze non ne cancella una."""
    _run(env, 'set-mode', 'care', '--until', '2099-01-01T00:00:00Z')
    _run(env, 'set-mode', 'care', '--cv-min-score', '70')
    data = _mode_file(home)
    assert data['mode_until'] == '2099-01-01T00:00:00Z'
    assert data['orders']['cv_min_score'] == 70


def test_clear_until_removes_only_the_deadline(home, env):
    _run(env, 'set-mode', 'care', '--until', '2099-01-01T00:00:00Z')
    assert _run(env, 'clear-until').returncode == 0
    data = _mode_file(home)
    assert 'mode_until' not in data
    assert data['mode'] == 'care'


# ── Il test che conta: CLI e Console scrivono lo stesso file ────────────

@pytest.mark.parametrize('settings,expected_mode', [
    ({'maintenance': {'mode': 'care'}}, 'care'),
    ({'maintenance': {'mode': 'saving'}}, 'saving'),
    ({'maintenance': {'mode': 'harvest'}}, 'harvest'),
])
def test_the_game_payload_and_the_cli_agree(tmp_path, settings, expected_mode):
    """Due scrittori, un file. Finché `game/` è congelato non si possono
    unificare, quindi almeno si prova che non divergono: stesso input →
    stesso JSON su disco.
    """
    def write_with_game(home):
        src = open(GAME_SAVE, encoding='utf-8').read()
        payload = base64.b64encode(
            json.dumps(settings).encode('utf-8')).decode('ascii')
        # Il payload è un template con `%s` (vedi F04 in CLAUDE.md).
        code = src % (payload,)
        r = subprocess.run([sys.executable, '-c', code],
                           capture_output=True, text=True,
                           env={**os.environ, 'JHT_HOME': str(home),
                                'JHT_DB': str(home / 'jobs.db'),
                                'PYTHONPATH': SKILLS_DIR})
        assert r.returncode == 0, r.stderr
        return r

    game_home = tmp_path / 'game_home'
    (game_home / 'profile').mkdir(parents=True)
    write_with_game(game_home)

    cli_home = tmp_path / 'cli_home'
    (cli_home / 'profile').mkdir(parents=True)
    cli_env = {**os.environ, 'JHT_HOME': str(cli_home),
               'JHT_DB': str(cli_home / 'jobs.db')}
    assert _run(cli_env, 'set-mode', expected_mode).returncode == 0

    assert _mode_file(cli_home) == _mode_file(game_home)
