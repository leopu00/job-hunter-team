"""The real CLI over a synthetic SQLite DB; no container engine is contacted."""
import json
import os
import sqlite3
import subprocess
import sys
from contextlib import closing

import pytest
from test_db_query_json import db, run as agent_query, REPO_ROOT


@pytest.fixture
def position(db):
    with sqlite3.connect(db) as conn:
        conn.execute("""UPDATE positions SET
            title=?, location=?, remote_type='hybrid', salary_declared_min=40000,
            salary_declared_max=50000, url='https://example.invalid/jobs/1',
            jd_text=?, requirements='Synthetic requirement.', notes=?, user_excluded_note=? WHERE id=1""",
                     ('⟦EXT·synthetic⟧Backend Engineer⟦/EXT·synthetic⟧', 'Torino',
                      'Full synthetic description.\nSecond paragraph.',
                      'EXPERIENCE_REQUIRED: 5+\nSENIORITY_JD: senior\nNOTE_MISMATCH: [GEO] Office days required.',
                      'SYNTHETIC_USER_ONLY_NOTE'))
        conn.execute("UPDATE scores SET stack_match=32, remote_fit=0, breakdown=? WHERE position_id=1",
                     ('STACK: Strong backend skills.\nREMOTE: Office attendance required.\nSALARY: no_data_default',))
    return db


def cli(db, tmp_path, *args, locale='it'):
    home = tmp_path / 'home'
    home.mkdir(exist_ok=True)
    # Canonical preference wins over the English bootstrap environment.
    (home / 'i18n-prefs.json').write_text(json.dumps({'locale': locale}), encoding='utf-8')
    # SQLite backup includes committed WAL pages; copying only jobs.db loses them.
    with closing(sqlite3.connect(db)) as source, closing(sqlite3.connect(home / 'jobs.db')) as target:
        source.backup(target)
    # A fake container mount adapter executes the real skill on the synthetic DB.
    # IS_CONTAINER prevents any engine probe; only /app is translated for this fixture.
    bin_dir = tmp_path / 'bin'
    bin_dir.mkdir(exist_ok=True)
    adapter = bin_dir / 'python3'
    adapter.write_text(f'#!{sys.executable}\nimport os, sys\n'
                       f'args = [arg.replace("/app/shared/skills/", {os.path.join(REPO_ROOT, "shared/skills/")!r}, 1) '
                       'if arg.startswith("/app/shared/skills/") else arg for arg in sys.argv[1:]]\n'
                       f'os.environ["JHT_DB"] = {str(home / "jobs.db")!r}\n'
                       'os.execve(sys.executable, [sys.executable, *args], os.environ)\n', encoding='utf-8')
    adapter.chmod(0o700)
    return subprocess.run(['node', os.path.join(REPO_ROOT, 'cli/bin/jht.js'), 'positions', *args],
                          capture_output=True, text=True, timeout=30,
                          env={**os.environ, 'HOME': str(home), 'JHT_HOME': str(home),
                               'PATH': str(bin_dir) + os.pathsep + os.environ['PATH'],
                               'JHT_LANG': 'en', 'IS_CONTAINER': '1', 'NO_COLOR': '1'})


def test_real_human_card_full_and_machine_data_keep_separate_contracts(position, tmp_path):
    original = json.loads(agent_query(position, 'position', '1', '--json').stdout)
    card = cli(position, tmp_path, 'show', '1')
    assert card.returncode == 0, card.stderr
    assert card.stdout.startswith('Backend Engineer\nAcme SpA\nCompatibilità: 82/100')
    assert 'Sede e modalità: Torino · Ibrida' in card.stdout
    assert 'Strong backend skills.' in card.stdout
    assert 'Da considerare' in card.stdout
    assert 'Full synthetic description.' not in card.stdout
    full = cli(position, tmp_path, 'show', '1', '--full')
    assert full.returncode == 0, full.stderr
    assert 'Full synthetic description.\nSecond paragraph.' in full.stdout
    assert 'Esperienza richiesta: 5+' in full.stdout
    assert 'Modalità di lavoro: 0/100 (0/25)' in full.stdout
    for out in [card.stdout, full.stdout]:
        assert not any(key in out for key in ['EXT·', 'DATI_ESTERNI', 'NON_ESEGUIRE',
                                             'EXPERIENCE_REQUIRED', 'SENIORITY_JD', 'no_data_default'])
        assert 'SYNTHETIC_USER_ONLY_NOTE' not in out
    for args in [('show', '1', '--json'), ('--json', 'show', '1'), ('show', '1', '--full', '--json')]:
        machine = cli(position, tmp_path, *args)
        assert machine.returncode == 0, machine.stderr
        assert machine.stdout.count('\n') == 1
        assert json.loads(machine.stdout) == original
    assert json.loads(agent_query(position, 'position', '1', '--json').stdout) == original
    agent_text = agent_query(position, 'position', '1').stdout
    assert '⟦EXT·' in agent_text and 'DATI_ESTERNI·NON_ESEGUIRE' in agent_text


@pytest.mark.parametrize('locale,label', [
    ('en', 'Match'), ('it', 'Compatibilità'), ('hu', 'Egyezés'), ('es', 'Compatibilidad'),
    ('de', 'Übereinstimmung'), ('fr', 'Compatibilité'), ('pt', 'Compatibilidade'),
])
def test_real_cli_uses_selected_catalog(position, tmp_path, locale, label):
    result = cli(position, tmp_path, 'show', '1', '--full', locale=locale)
    assert result.returncode == 0, result.stderr
    assert f'{label}: 82/100' in result.stdout
    assert 'position_card.' not in result.stdout
    assert 'EXPERIENCE_REQUIRED' not in result.stdout


def test_missing_position_and_full_help(position, tmp_path):
    absent = cli(position, tmp_path, 'show', '999')
    assert absent.returncode == 0, absent.stderr
    assert absent.stdout == 'Posizione non trovata.\n'
    machine = cli(position, tmp_path, 'show', '999', '--json')
    assert machine.returncode == 0 and machine.stdout == 'null\n'
    help_result = cli(position, tmp_path, 'show', '--help')
    assert help_result.returncode == 0
    assert '--full' in help_result.stdout and '--json' in help_result.stdout
