"""
Il database di coordinamento Scout è UNO, e si dichiara invece di improvvisarlo.

Perché esiste (issue #132, run Windows 2026-08-05): il primo Scout non è
riuscito ad aprire il database nel percorso previsto — `$JHT_HOME/data/` non
esisteva e nessuno la creava — e ha proseguito scegliendosi un fallback
scrivibile. Due Scout su due file non si stanno coordinando: credono di farlo,
che è peggio del non coordinarsi affatto, perché nessuno dei due se ne accorge.

Cosa proteggono questi test:
  1. tutti gli agenti risolvono lo STESSO percorso dallo stesso ambiente,
     e la precedenza è dichiarata (env > $JHT_HOME > repo);
  2. il bootstrap crea la cartella mancante — il buco vero del run Windows;
  3. un percorso non scrivibile produce un ERRORE azionabile e un exit code,
     mai un secondo database;
  4. il fallback esiste ma è UNO e sta nell'ambiente condiviso, non nella
     testa di un singolo processo;
  5. la diagnostica dice quale file si sta usando davvero.

Eseguire con: pytest tests/test_scout_coord_db_path.py -v
"""

import importlib.util
import json
import os
import stat
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
SCOUT_COORD = os.path.join(SKILLS_DIR, 'scout_coord.py')


def _load(env):
    """Carica il modulo con un ambiente dato: il path si risolve all'import,
    quindi ogni scenario vuole la sua istanza."""
    old = {k: os.environ.get(k) for k in ('JHT_HOME', 'JHT_SCOUT_COORD_DB')}
    try:
        for k in old:
            os.environ.pop(k, None)
        os.environ.update({k: str(v) for k, v in env.items()})
        spec = importlib.util.spec_from_file_location('scout_coord_under_test',
                                                      SCOUT_COORD)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        return mod
    finally:
        for k, v in old.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v


def _run(env, *args):
    return subprocess.run([sys.executable, SCOUT_COORD, *args],
                          capture_output=True, text=True,
                          env={**os.environ, **{k: str(v) for k, v in env.items()}})


@pytest.fixture
def home(tmp_path):
    h = tmp_path / 'jht_home'
    h.mkdir()
    return h


# ── 1. Un solo percorso, con una precedenza dichiarata ──────────────────

def test_all_agents_resolve_the_same_path(home):
    """Stesso ambiente, stesso file: è tutta la garanzia di coordinamento."""
    a = _load({'JHT_HOME': home})
    b = _load({'JHT_HOME': home})
    assert a.DB_PATH == b.DB_PATH == home / 'data' / 'scout_coordination.db'
    assert a.DB_ORIGIN == a.ORIGIN_JHT_HOME


def test_the_declared_override_wins(home, tmp_path):
    """Il fallback è UNO perché vive nell'ambiente che il launcher passa a
    tutti, non nella scelta del singolo processo."""
    elsewhere = tmp_path / 'shared' / 'coord.db'
    mod = _load({'JHT_HOME': home, 'JHT_SCOUT_COORD_DB': elsewhere})
    assert mod.DB_PATH == elsewhere
    assert mod.DB_ORIGIN == mod.ORIGIN_ENV


def test_without_jht_home_it_stays_in_the_repo(tmp_path):
    """Esecuzione ad-hoc fuori dal container: si resta nel repo, non si
    inventa una home."""
    mod = _load({})
    assert mod.DB_ORIGIN == mod.ORIGIN_REPO
    assert mod.DB_PATH.name == 'scout_coordination.db'


# ── 2. Il bootstrap crea ciò che manca ──────────────────────────────────

def test_bootstrap_creates_the_missing_directory(home):
    """Il buco del run Windows: `$JHT_HOME/data/` non esisteva e sqlite non
    la crea da sé."""
    assert not (home / 'data').exists()
    r = _run({'JHT_HOME': home}, 'bootstrap')
    assert r.returncode == 0, r.stderr
    assert (home / 'data' / 'scout_coordination.db').exists()


def test_a_claim_works_right_after_bootstrap(home):
    _run({'JHT_HOME': home}, 'bootstrap')
    r = _run({'JHT_HOME': home}, 'claim', '42', 'scout-1')
    assert r.returncode == 0, r.stderr
    assert 'CLAIMED' in r.stdout


def test_a_claim_alone_also_creates_the_directory(home):
    """Anche senza bootstrap non si deve fallire per una cartella mancante:
    il pre-spawn è una rete, non l'unica strada."""
    r = _run({'JHT_HOME': home}, 'claim', '42', 'scout-1')
    assert r.returncode == 0, r.stderr
    assert (home / 'data' / 'scout_coordination.db').exists()


# ── 3. Non scrivibile = errore azionabile, mai un secondo DB ────────────

@pytest.fixture
def readonly_home(tmp_path):
    h = tmp_path / 'readonly_home'
    h.mkdir()
    h.chmod(stat.S_IRUSR | stat.S_IXUSR)
    yield h
    h.chmod(stat.S_IRWXU)


@pytest.mark.skipif(os.geteuid() == 0,
                    reason="root scrive comunque: il permesso non è verificabile")
def test_an_unwritable_path_fails_loudly(readonly_home):
    r = _run({'JHT_HOME': readonly_home}, 'claim', '42', 'scout-1')
    assert r.returncode == 3
    # Azionabile: dice dove, perché, e cosa fare — inclusa la sola deroga
    # ammessa, che è dichiarare UN percorso per tutta la squadra.
    assert 'scout_coordination.db' in r.stderr
    assert 'JHT_SCOUT_COORD_DB' in r.stderr
    assert 'Do NOT create a database of your own' in r.stderr
    assert 'CLAIMED' not in r.stdout


@pytest.mark.skipif(os.geteuid() == 0,
                    reason="root scrive comunque: il permesso non è verificabile")
def test_the_declared_fallback_unblocks_an_unwritable_home(readonly_home, tmp_path):
    """La via d'uscita c'è, ed è una sola: un percorso dichiarato che vale
    per tutti gli agenti."""
    fallback = tmp_path / 'fallback' / 'coord.db'
    env = {'JHT_HOME': readonly_home, 'JHT_SCOUT_COORD_DB': fallback}
    assert _run(env, 'bootstrap').returncode == 0
    r = _run(env, 'claim', '42', 'scout-1')
    assert r.returncode == 0, r.stderr
    assert fallback.exists()


# ── 4. La diagnostica dice quale file si sta usando ─────────────────────

def test_doctor_reports_the_database_actually_in_use(home):
    _run({'JHT_HOME': home}, 'bootstrap')
    _run({'JHT_HOME': home}, 'claim', '42', 'scout-1')
    r = _run({'JHT_HOME': home}, 'doctor', '--json')
    assert r.returncode == 0, r.stderr
    rep = json.loads(r.stdout)
    assert rep['path'] == str(home / 'data' / 'scout_coordination.db')
    assert rep['origin'] == 'jht_home'
    assert rep['writable'] is True
    assert rep['claims'] == 1
    assert rep['env_override'] is False


def test_doctor_does_not_create_what_it_is_inspecting(home):
    """Un doctor che crea la cartella mancante risponde "tutto bene" alla
    domanda sbagliata."""
    r = _run({'JHT_HOME': home}, 'doctor', '--json')
    assert r.returncode == 3
    assert not (home / 'data').exists()
    assert json.loads(r.stdout)['writable'] is False


def test_doctor_reports_counts_not_content(home):
    """Diagnostica senza contenuto: i conteggi bastano a capire QUALE DB è,
    le righe no."""
    _run({'JHT_HOME': home}, 'bootstrap')
    _run({'JHT_HOME': home}, 'assign', 'scout-1', '--cerchi', '1,2',
         '--fonti', 'remoteok')
    r = _run({'JHT_HOME': home}, 'doctor')
    assert 'scout-1' not in r.stdout
    assert 'remoteok' not in r.stdout
    assert 'active assignments: 1' in r.stdout


# ── 5. Il pre-spawn è agganciato davvero ────────────────────────────────

def test_start_agent_bootstraps_the_db_before_a_scout():
    """Il gancio in start-agent.sh esiste ed è per lo Scout: senza, la
    verifica pre-spawn resta una buona intenzione."""
    src = _start_agent_src()
    assert '"$ROLE" = "scout"' in src
    assert 'scout_coord.py' in src
    assert '"$COORD_SCRIPT" bootstrap' in src


# ── 6. La deroga deve ARRIVARE all'agente ───────────────────────────────
#
# Il bootstrap pre-spawn gira nel processo del launcher e la variabile la
# vede; l'agente vive in una tmux nuova, che non eredita niente e riceve solo
# una lista ESPLICITA di export — e sul ramo PowerShell (WSL, la piattaforma
# dell'incidente) una env di bash non attraversa proprio. Una deroga che non
# raggiunge chi la deve usare non è una deroga: è uno Scout che esce 3.

def _start_agent_src():
    with open(os.path.join(REPO_ROOT, '.launcher', 'start-agent.sh'),
              encoding='utf-8') as f:
        return f.read()


def _extract_propagation(src):
    """La lista + la funzione VERE, ritagliate dal sorgente per eseguirle."""
    start = src.index('OPTIONAL_AGENT_ENV=(')
    end = src.index('send_env_vars() {')
    return src[start:end]


@pytest.mark.skipif(sys.platform == 'win32', reason='sandbox POSIX')
@pytest.mark.parametrize('flavor,expected', [
    ('bash', "export JHT_SCOUT_COORD_DB='/shared/coord.db'"),
    ('powershell', "$env:JHT_SCOUT_COORD_DB='/shared/coord.db'"),
])
def test_the_declared_fallback_reaches_the_agent(tmp_path, flavor, expected):
    """Entrambi i rami: la variabile arriva davvero nel pane dell'agente."""
    calls = tmp_path / 'tmux.calls'
    script = f"""
set -euo pipefail
SESSION=SCOUT-1
tmux() {{ printf '%s\\n' "$*" >> {calls}; }}
{_extract_propagation(_start_agent_src())}
send_optional_env {flavor}
"""
    r = subprocess.run(['bash', '-c', script], capture_output=True, text=True,
                       env={**os.environ, 'JHT_SCOUT_COORD_DB': '/shared/coord.db'})
    assert r.returncode == 0, r.stderr
    assert expected in calls.read_text(encoding='utf-8')


@pytest.mark.skipif(sys.platform == 'win32', reason='sandbox POSIX')
def test_an_undeclared_fallback_is_not_exported_empty(tmp_path):
    """Senza deroga non si esporta niente: una stringa vuota renderebbe
    indistinguibile «non dichiarata» da «dichiarata male»."""
    calls = tmp_path / 'tmux.calls'
    script = f"""
set -euo pipefail
SESSION=SCOUT-1
tmux() {{ printf '%s\\n' "$*" >> {calls}; }}
{_extract_propagation(_start_agent_src())}
send_optional_env bash
echo DONE
"""
    env = {k: v for k, v in os.environ.items() if k != 'JHT_SCOUT_COORD_DB'}
    r = subprocess.run(['bash', '-c', script], capture_output=True, text=True, env=env)
    # `set -u` è attivo nello script vero: la variabile assente non deve
    # far esplodere lo spawn dell'agente.
    assert r.returncode == 0, r.stderr
    assert 'DONE' in r.stdout
    assert not calls.exists()


def test_both_spawn_branches_send_the_optional_env():
    """Il ramo bash e quello PowerShell hanno DUE liste di export separate:
    dimenticarne una è come non aver fatto niente sulla piattaforma sbagliata."""
    src = _start_agent_src()
    assert 'send_optional_env bash' in src
    assert 'send_optional_env powershell' in src
    assert 'OPTIONAL_AGENT_ENV=(JHT_SCOUT_COORD_DB)' in src


def test_compose_passes_the_fallback_into_the_container():
    """In Docker mode la deroga la dichiara l'operatore sull'host: senza il
    pass-through nel compose, nel container non esisterebbe."""
    with open(os.path.join(REPO_ROOT, 'docker-compose.yml'), encoding='utf-8') as f:
        compose = f.read()
    assert 'JHT_SCOUT_COORD_DB=${JHT_SCOUT_COORD_DB:-}' in compose
