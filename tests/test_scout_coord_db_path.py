"""
La coordinazione Scout vive nel database della squadra, e ce n'è UNO.

Storia in due atti.

**Atto I — issue #132** (run Windows 2026-08-05): il primo Scout non è riuscito
ad aprire il database di coordinamento nel percorso previsto — `$JHT_HOME/data/`
non esisteva, sqlite non crea la cartella padre — e ha proseguito scegliendosi
un fallback scrivibile. Due Scout su due file non si coordinano: credono di
farlo, che è peggio, perché nessuno se ne accorge.

**Atto II — [JHT-DB-SCOUT-COORD]** (2026-08-08): il secondo file non serviva.
Le tabelle sono passate dentro `jobs.db` (`scout_coordination`, `scout_claims`),
accanto alle altre di stato interno della squadra. Il percorso da risolvere
torna a essere UNO — `JHT_DB`, che il launcher esporta già a ogni agente — e con
esso sparisce la classe di guasti dell'Atto I.

Cosa proteggono questi test:
  1. tutti gli agenti risolvono lo stesso database, quello della squadra;
  2. un percorso non scrivibile produce un ERRORE azionabile, mai un secondo DB;
  3. la storia del vecchio file viene importata una volta sola e non si perde;
  4. un nome di Scout non valido non entra (il caso `--help`, trovato ATTIVO in
     produzione);
  5. la diagnostica dice quale database si sta usando davvero;
  6. le env opzionali arrivano davvero all'agente, su entrambi i rami di spawn.

Eseguire con: pytest tests/test_scout_coord_db_path.py -v
"""

import importlib.util
import json
import os
import sqlite3
import stat
import subprocess
import sys
import time

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
SCOUT_COORD = os.path.join(SKILLS_DIR, 'scout_coord.py')


def _load(env):
    """Carica il modulo con un ambiente dato: il path si risolve all'import,
    quindi ogni scenario vuole la sua istanza (e `_db` va buttato via, che
    risolve `DB_PATH` all'import a sua volta)."""
    keys = ('JHT_HOME', 'JHT_DB', 'JHT_SCOUT_COORD_DB')
    old = {k: os.environ.get(k) for k in keys}
    try:
        for k in keys:
            os.environ.pop(k, None)
        os.environ.update({k: str(v) for k, v in env.items()})
        sys.modules.pop('_db', None)
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


@pytest.fixture
def env(home):
    """L'ambiente di un agente: JHT_HOME + il database della squadra."""
    return {'JHT_HOME': str(home), 'JHT_DB': str(home / 'jobs.db')}


def _legacy(home, rows=(), claims=()):
    """Un vecchio `scout_coordination.db` come quelli in produzione."""
    (home / 'data').mkdir(parents=True, exist_ok=True)
    path = home / 'data' / 'scout_coordination.db'
    db = sqlite3.connect(path)
    db.executescript("""
        CREATE TABLE coordination (
            id INTEGER PRIMARY KEY AUTOINCREMENT, scout TEXT NOT NULL,
            cerchi TEXT, fonti TEXT, note TEXT,
            started_at TIMESTAMP, superseded_at TIMESTAMP);
        CREATE TABLE claims (
            job_id TEXT PRIMARY KEY, scout TEXT NOT NULL, claimed_at TIMESTAMP);
    """)
    for scout, cerchi, fonti, started, superseded in rows:
        db.execute("INSERT INTO coordination (scout, cerchi, fonti, started_at,"
                   " superseded_at) VALUES (?,?,?,?,?)",
                   (scout, cerchi, fonti, started, superseded))
    for job_id, scout, claimed in claims:
        db.execute("INSERT INTO claims VALUES (?,?,?)", (job_id, scout, claimed))
    db.commit()
    db.close()
    return path


# ── 1. Un solo database: quello della squadra ───────────────────────────

def test_the_coordination_lives_in_the_team_database(env):
    mod = _load(env)
    assert str(mod.DB_PATH) == env['JHT_DB']
    assert mod.DB_ORIGIN == 'jobs_db'
    assert mod.resolve_db_path()[0].name == 'jobs.db'


def test_all_agents_resolve_the_same_database(env):
    """Stesso ambiente, stesso file: è tutta la garanzia di coordinamento."""
    assert _load(env).DB_PATH == _load(env).DB_PATH


def test_the_tables_are_the_ones_of_the_team_schema(env):
    assert _run(env, 'bootstrap').returncode == 0
    conn = sqlite3.connect(env['JHT_DB'])
    names = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
    conn.close()
    # Accanto alle tabelle del prodotto, non in un file a parte.
    assert {'scout_coordination', 'scout_claims', 'positions'} <= names


# ── 2. Non scrivibile = errore azionabile, mai un secondo DB ────────────

@pytest.fixture
def readonly_home(tmp_path):
    h = tmp_path / 'readonly_home'
    h.mkdir()
    h.chmod(stat.S_IRUSR | stat.S_IXUSR)
    yield h
    h.chmod(stat.S_IRWXU)


@pytest.mark.skipif(os.geteuid() == 0,
                    reason="root scrive comunque: il permesso non è verificabile")
def test_an_unwritable_database_fails_loudly(readonly_home):
    r = _run({'JHT_HOME': str(readonly_home),
              'JHT_DB': str(readonly_home / 'jobs.db')},
             'claim', '42', 'scout-1')
    assert r.returncode == 3
    assert 'Do NOT create a database of your own' in r.stderr
    assert 'CLAIMED' not in r.stdout


def test_a_claim_creates_what_it_needs(env):
    """Nessun bootstrap prima: il buco del run Windows non deve tornare."""
    r = _run(env, 'claim', '42', 'scout-1')
    assert r.returncode == 0, r.stderr
    assert 'CLAIMED' in r.stdout
    assert os.path.exists(env['JHT_DB'])


# ── 3. La storia del vecchio file non si perde ──────────────────────────

def test_the_legacy_database_is_imported_once(home, env):
    _legacy(home,
            rows=[('scout-1', '1,2', 'remoteok', '2026-07-01 10:00:00', None),
                  ('scout-2', '3,4', 'lever', '2026-07-01 10:02:00',
                   '2026-07-02 08:00:00')],
            claims=[('42', 'scout-1', '2026-07-01 10:05:00')])
    first = _run(env, 'bootstrap')
    assert first.returncode == 0, first.stderr
    assert 'imported from the legacy database: 2 assignments, 1 claims' in first.stdout

    # Secondo giro: idempotente, niente duplicati.
    second = _run(env, 'bootstrap')
    assert 'imported from the legacy database' not in second.stdout
    conn = sqlite3.connect(env['JHT_DB'])
    total = conn.execute("SELECT COUNT(*) FROM scout_coordination").fetchone()[0]
    conn.close()
    assert total == 2


def test_the_legacy_file_is_left_in_place(home, env):
    """Si legge, non si cancella: il dato dell'utente non si butta."""
    legacy = _legacy(home, rows=[('scout-1', '1', 'x', '2026-07-01 10:00:00', None)])
    _run(env, 'bootstrap')
    assert legacy.exists()


def test_a_ghost_assignment_is_imported_but_not_active(home, env):
    """Il caso `--help`, trovato ATTIVO su una squadra in produzione: la
    storia si tiene, ma un partecipante che non esiste non compare nella
    distribuzione in vigore."""
    _legacy(home, rows=[('--help', None, None, '2026-07-03 09:00:00', None),
                        ('scout-1', '1', 'remoteok', '2026-07-01 10:00:00', None)])
    out = _run(env, 'bootstrap')
    assert 'imported as SUPERSEDED' in out.stdout
    show = _run(env, 'show')
    assert 'scout-1' in show.stdout
    assert '--help' not in show.stdout
    # …ma nello storico c'è ancora.
    assert '--help' in _run(env, 'history').stdout


def test_without_a_legacy_database_nothing_is_imported(env):
    out = _run(env, 'bootstrap')
    assert out.returncode == 0
    assert 'imported from the legacy database' not in out.stdout


# ── 4. Un nome di Scout è un nome di Scout ──────────────────────────────

def test_a_flag_is_not_a_scout_name(env):
    r = _run(env, 'assign', '--help', '--cerchi', '1')
    assert r.returncode == 3
    assert 'is not a Scout name' in r.stderr
    conn = sqlite3.connect(env['JHT_DB']) if os.path.exists(env['JHT_DB']) else None
    if conn:
        rows = conn.execute("SELECT COUNT(*) FROM scout_coordination").fetchone()[0]
        conn.close()
        assert rows == 0


def test_a_real_scout_name_goes_through(env):
    r = _run(env, 'assign', 'scout-3', '--cerchi', '5', '--fonti', 'greenhouse')
    assert r.returncode == 0, r.stderr
    assert 'scout-3' in _run(env, 'show').stdout


# ── 5. La diagnostica dice quale database si sta usando ─────────────────

def test_doctor_reports_the_database_actually_in_use(env):
    _run(env, 'bootstrap')
    _run(env, 'claim', '42', 'scout-1')
    r = _run(env, 'doctor', '--json')
    assert r.returncode == 0, r.stderr
    rep = json.loads(r.stdout)
    assert rep['path'] == env['JHT_DB']
    assert rep['origin'] == 'jobs_db'
    assert rep['writable'] is True
    assert rep['claims'] == 1


def test_doctor_names_the_legacy_database_when_there_is_one(home, env):
    _legacy(home, rows=[('scout-1', '1', 'x', '2026-07-01 10:00:00', None)])
    _run(env, 'bootstrap')
    rep = json.loads(_run(env, 'doctor', '--json').stdout)
    assert rep['legacy_db'] and rep['legacy_db'].endswith('scout_coordination.db')


def test_doctor_reports_counts_not_content(env):
    _run(env, 'bootstrap')
    _run(env, 'assign', 'scout-1', '--cerchi', '1,2', '--fonti', 'remoteok')
    r = _run(env, 'doctor')
    assert 'remoteok' not in r.stdout
    assert 'active assignments: 1' in r.stdout


# ── 6. Il pre-spawn e le env opzionali ──────────────────────────────────

def _start_agent_src():
    with open(os.path.join(REPO_ROOT, '.launcher', 'start-agent.sh'),
              encoding='utf-8') as f:
        return f.read()


def test_start_agent_bootstraps_the_db_before_a_scout():
    src = _start_agent_src()
    assert '"$ROLE" = "scout"' in src
    assert 'scout_coord.py' in src
    assert '"$COORD_SCRIPT" bootstrap' in src


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
def test_optional_env_reaches_the_agent(tmp_path, flavor, expected):
    """Entrambi i rami di spawn: una tmux nuova non eredita niente, e sul ramo
    PowerShell (WSL) una env di bash non attraversa proprio."""
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
def test_an_unset_optional_env_is_not_exported_empty(tmp_path):
    """Una stringa vuota renderebbe indistinguibile «non dichiarata» da
    «dichiarata male» — e `set -u` non deve far saltare lo spawn."""
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
    assert r.returncode == 0, r.stderr
    assert 'DONE' in r.stdout
    assert not calls.exists()


def test_both_spawn_branches_send_the_optional_env():
    src = _start_agent_src()
    assert 'send_optional_env bash' in src
    assert 'send_optional_env powershell' in src


# ── 7. Il bug del 2026-08-08: import a ogni comando + chiave mutabile ────
#
# `import_legacy` stava in `get_db()` → ripartiva a OGNI comando, e
# `cmd_assign` mutava `started_at` (metà della chiave di dedup): la riga
# importata cambiava chiave e al giro dopo rientrava come SECONDA attiva.
# In parallelo, senza vincolo sotto il controllo-poi-inserisci, 4 bootstrap
# producevano 20 righe invece di 5. I test di sezione 3 non lo vedevano
# perché non incrociavano mai bootstrap → assign → show né i processi.

def test_bootstrap_assign_show_leaves_one_active_row(home, env):
    """La sequenza esatta del bug: bootstrap (importa) → assign → show.
    Prima: DUE righe attive per lo stesso Scout, con territori che si
    contraddicevano. Adesso: UNA, con il territorio nuovo — e sotto c'è
    l'indice UNIQUE che presidia la chiave di dedup."""
    _legacy(home, rows=[('scout-1', '1,2', 'remoteok', '2026-07-01 10:00:00', None)])
    assert _run(env, 'bootstrap').returncode == 0
    r = _run(env, 'assign', 'scout-1', '--cerchi', '9')
    assert r.returncode == 0, r.stderr
    show = _run(env, 'show').stdout
    assert show.count('scout-1') == 1
    assert 'remoteok' not in show   # il territorio vecchio non è rientrato
    conn = sqlite3.connect(env['JHT_DB'])
    active = conn.execute(
        "SELECT COUNT(*) FROM scout_coordination "
        "WHERE scout='scout-1' AND superseded_at IS NULL").fetchone()[0]
    idx = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='index' "
        "AND name='idx_scout_coordination_scout_started_unique'").fetchone()
    conn.close()
    assert active == 1
    assert idx is not None


def test_everyday_commands_do_not_rerun_the_import(home, env):
    """L'import è del solo bootstrap: gli altri comandi non lo rilanciano.
    Prima viveva in `get_db()` e ripartiva a ogni invocazione."""
    _legacy(home, rows=[('scout-1', '1,2', 'remoteok', '2026-07-01 10:00:00', None)])
    assert _run(env, 'bootstrap').returncode == 0
    count = "SELECT COUNT(*) FROM scout_coordination"
    before = sqlite3.connect(env['JHT_DB']).execute(count).fetchone()[0]
    for args in (('show',), ('history',), ('claim', '7', 'scout-1'),
                 ('check-claim', '7'), ('doctor',)):
        r = _run(env, *args)
        assert r.returncode == 0, r.stderr
    after = sqlite3.connect(env['JHT_DB']).execute(count).fetchone()[0]
    assert before == after == 1


def test_concurrent_bootstraps_import_the_legacy_once(home, env, tmp_path):
    """4 bootstrap SINCRONIZZATI su un legacy da 200 righe → 200 righe.

    Lo schema esiste già (primo bootstrap senza legacy) ma l'import è ancora
    da fare: è la finestra reale dei bootstrap pre-spawn, uno per Scout.
    I processi partono da una BARRIERA (un file "go") — senza, quattro
    background lanciati alla buona non fanno contesa e il test passa anche
    col difetto vivo (verde falso, visto sul campo il 2026-08-08). Il legacy
    è grosso apposta (200 righe) per allargare la finestra fra controllo e
    inserimento.

    Onestà del test: la corsa resta probabilistica. La garanzia
    deterministica è l'indice UNIQUE `(scout, started_at)` — verificato a
    vista dal test sopra — con `INSERT OR IGNORE` che traduce il conflitto
    del perdente in «già importata da un pari» invece che in un exit 3."""
    assert _run(env, 'bootstrap').returncode == 0
    _legacy(home, rows=[(f'scout-{i}', str(i), 'x',
                         f'2026-07-01 {10 + i // 3600:02d}:'
                         f'{(i // 60) % 60:02d}:{i % 60:02d}', None)
                        for i in range(1, 201)])
    go = tmp_path / 'go'
    child = (
        "import os, sys, time, subprocess\n"
        "go = os.environ['JHT_TEST_GO']\n"
        "while not os.path.exists(go):\n"
        "    time.sleep(0.005)\n"
        "r = subprocess.run([sys.executable, os.environ['JHT_TEST_COORD'],\n"
        "                    'bootstrap'])\n"
        "sys.exit(r.returncode)\n"
    )
    spawn_env = {**os.environ, **{k: str(v) for k, v in env.items()},
                 'JHT_TEST_GO': str(go), 'JHT_TEST_COORD': SCOUT_COORD}
    procs = [subprocess.Popen([sys.executable, '-c', child],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                              text=True, env=spawn_env)
             for _ in range(4)]
    time.sleep(1)   # tutti e quattro alla barriera
    go.touch()
    for p in procs:
        _, err = p.communicate(timeout=60)
        assert p.returncode == 0, err
    conn = sqlite3.connect(env['JHT_DB'])
    total = conn.execute("SELECT COUNT(*) FROM scout_coordination").fetchone()[0]
    conn.close()
    assert total == 200
