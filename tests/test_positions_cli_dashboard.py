"""The real CLI dashboard over synthetic data, reusing the card's runtime adapter."""
import json
import sqlite3

import pytest
from test_db_query_json import db, run as agent_query
from test_positions_cli_card import position, cli


@pytest.fixture
def dashboard(position):
    with sqlite3.connect(position) as conn:
        company = conn.execute("INSERT INTO companies (name, verdict) VALUES (?, ?)",
                               ('Example Systems', 'GO')).lastrowid
        conn.execute("UPDATE positions SET title=?, company_id=? WHERE id=1",
                     ('DevOps Engineer Associate Middleware Platform', company))
        conn.execute("INSERT INTO scores (position_id, total_score) VALUES (2, 0)")
        conn.execute("UPDATE positions SET status='excluded' WHERE id=2")
        conn.execute("INSERT INTO applications (position_id, status, critic_verdict) VALUES (2, 'review', 'NEEDS_WORK')")
    return position


def test_dashboard_counts_full_titles_and_machine_contract(dashboard, tmp_path):
    original = json.loads(agent_query(dashboard, 'dashboard', '--json').stdout)
    shown = cli(dashboard, tmp_path, 'dashboard')
    assert shown.returncode == 0, shown.stderr
    assert shown.stdout.startswith('La tua ricerca di lavoro\nOfferte trovate: 2\nDa valutare: 0\nValutate: 2')
    assert '#1 · DevOps Engineer Associate Middleware Platform' in shown.stdout
    assert 'jht positions show 1' in shown.stdout and 'jht positions show 2' in shown.stdout
    assert '0/100 · Esclusa · Esito della revisione: Da rivedere' in shown.stdout
    assert '1 su 2: offerte con un riferimento' in shown.stdout
    assert 'Tutte le fasi' not in shown.stdout
    full = cli(dashboard, tmp_path, 'dashboard', '--full')
    assert full.returncode == 0, full.stderr
    assert 'Valutazioni delle aziende\nPositiva: 1' in full.stdout
    assert '1/2 (50%)' in full.stdout
    for args in [('dashboard', '--json'), ('--json', 'dashboard'), ('dashboard', '--full', '--json')]:
        machine = cli(dashboard, tmp_path, *args)
        assert machine.returncode == 0, machine.stderr
        assert machine.stdout.count('\n') == 1
        assert json.loads(machine.stdout) == original
    assert json.loads(agent_query(dashboard, 'dashboard', '--json').stdout) == original
    assert 'DASHBOARD (Schema V2)' in agent_query(dashboard, 'dashboard').stdout


@pytest.mark.parametrize('locale,title', [
    ('en', 'Your job search'), ('it', 'La tua ricerca di lavoro'), ('hu', 'Az álláskeresésed'),
    ('es', 'Tu búsqueda de empleo'), ('de', 'Deine Jobsuche'), ('fr', 'Ta recherche d’emploi'),
    ('pt', 'A tua procura de emprego'),
])
def test_real_dashboard_uses_selected_catalog(dashboard, tmp_path, locale, title):
    shown = cli(dashboard, tmp_path, 'dashboard', '--full', locale=locale)
    assert shown.returncode == 0, shown.stderr
    assert shown.stdout.startswith(title + '\n')
    assert not any(token in shown.stdout for token in ['position_card.', 'CompanyID', 'Schema V2', 'NO_GO'])
