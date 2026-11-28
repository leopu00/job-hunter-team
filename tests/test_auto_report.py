"""Automatic notifications observe team brakes and acknowledge only delivered changes."""
import importlib.util
import json
import sqlite3
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def report(tmp_path, monkeypatch):
    monkeypatch.setenv('JHT_HOME', str(tmp_path))
    sys.path.insert(0, str(ROOT / 'shared' / 'skills'))
    spec = importlib.util.spec_from_file_location('panorama_test', ROOT / 'shared/skills/auto_report.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    import standby
    import working_hours
    import agent_pause
    import team_roster
    monkeypatch.setattr(standby, 'is_active', lambda **_: False)
    monkeypatch.setattr(working_hours, 'is_within_working_hours', lambda: True)
    monkeypatch.setattr(agent_pause, 'is_paused', lambda *_, **__: False)
    monkeypatch.setattr(team_roster, 'is_contained', lambda *_: False)
    monkeypatch.setattr(module, '_count_tmux_sessions', lambda: (2, ['ASSISTENTE', 'ANALISTA-1']))
    monkeypatch.setattr(module, '_read_bridge_state', lambda: {})
    monkeypatch.setattr(module, 'build_png', lambda *_: False)
    sent = []
    monkeypatch.setattr(module, 'send_to_telegram', lambda *args, **kwargs: sent.append(args) or True)
    with sqlite3.connect(module.DB_PATH) as db:
        db.executescript('CREATE TABLE positions (id INTEGER PRIMARY KEY, status TEXT);'
                         'CREATE TABLE applications (id INTEGER PRIMARY KEY, status TEXT);'
                         "INSERT INTO positions VALUES(1, 'new');")
    return module, sent


def configure(module, **options):
    (module.JHT_HOME / 'jht.config.json').write_text(json.dumps({'team': {'auto_report': options}}))


def test_same_counts_silent_but_status_transition_with_same_total_delivered(report):
    module, sent = report
    assert module.send() == 0
    assert len(sent) == 1
    assert module.send(force=True) == 0
    assert len(sent) == 1
    with sqlite3.connect(module.DB_PATH) as db:
        db.execute("UPDATE positions SET status='scored' WHERE id=1")
    assert module.send(force=True) == 0
    assert len(sent) == 2
    assert module._load_last()['snapshot']['positions'] == {'scored': 1}
    with sqlite3.connect(module.DB_PATH) as db:
        db.execute("INSERT INTO applications VALUES(1, 'ready')")
    assert module.send(force=True) == 0
    assert len(sent) == 3


@pytest.mark.parametrize('flag', ['.team-halted.flag', '.daily-halt.flag', '.weekly-halt.flag',
                                   'logs/daily-halt.flag', 'logs/weekly-halt.flag'])
def test_pause_blocks_even_force_before_render_or_db(report, monkeypatch, flag):
    module, sent = report
    path = module.JHT_HOME / flag
    path.parent.mkdir(exist_ok=True)
    path.touch()
    monkeypatch.setattr(module, '_read_pipeline', lambda: pytest.fail('paused team must not query'))
    assert module.send(force=True) == 0
    assert not sent
    assert not module.STATE_PATH.exists()


@pytest.mark.parametrize('sessions', [[], ['ASSISTENTE', 'CAPITANO', 'SENTINELLA-WORKER']])
def test_no_workers_means_stopped(report, monkeypatch, sessions):
    module, sent = report
    monkeypatch.setattr(module, '_count_tmux_sessions', lambda: (len(sessions), sessions))
    assert module.send(force=True) == 0
    assert not sent


@pytest.mark.parametrize('reason', ['standby', 'hours', 'individual', 'contained'])
def test_canonical_brakes_while_sessions_remain_open(report, monkeypatch, reason):
    module, sent = report
    import standby, working_hours, agent_pause, team_roster
    if reason == 'standby':
        monkeypatch.setattr(standby, 'is_active', lambda **_: True)
    elif reason == 'hours':
        monkeypatch.setattr(working_hours, 'is_within_working_hours', lambda: False)
    elif reason == 'individual':
        monkeypatch.setattr(agent_pause, 'is_paused', lambda *_, **__: True)
    else:
        monkeypatch.setattr(team_roster, 'is_contained', lambda *_: True)
    assert module.send() == 0
    assert not sent


def test_disable_and_interval_changes_take_effect_without_restart(report, monkeypatch):
    module, sent = report
    configure(module, enabled=False)
    assert module.send(force=True) == 0
    assert not sent
    configure(module, enabled=True, interval_min=120)
    clock = [100000.0]
    monkeypatch.setattr(module.time, 'time', lambda: clock[0])
    assert module.send() == 0
    with sqlite3.connect(module.DB_PATH) as db:
        db.execute("UPDATE positions SET status='checked'")
    clock[0] += 600
    assert module.send() == 0
    assert len(sent) == 1
    configure(module, enabled=True, interval_min=5)
    assert module.send() == 0
    assert len(sent) == 2


@pytest.mark.parametrize('raw', ['bad', '[]', 'null', '{"team":[]}',
                                 '{"team":{"auto_report":{"interval_min":0}}}',
                                 '{"team":{"auto_report":{"enabled":"false"}}}'])
def test_bad_config_uses_default_and_loop_survives(report, raw):
    module, sent = report
    (module.JHT_HOME / 'jht.config.json').write_text(raw)
    assert module.settings() == {'enabled': True, 'interval_min': 120}
    assert module.send() == 0
    assert len(sent) == 1


@pytest.mark.parametrize('raw', ['bad', '[]', 'null', '{"ts":100000000000}',
                                 '{"snapshot":{"positions":null,"applications":{}}}'])
def test_lost_summary_sends_once_and_repairs(report, raw):
    module, sent = report
    module.STATE_PATH.parent.mkdir()
    module.STATE_PATH.write_text(raw)
    assert module.send() == 0
    assert len(sent) == 1
    assert module._load_last()['snapshot']['positions'] == {'new': 1}
    assert module.send(force=True) == 0
    assert len(sent) == 1


def test_failed_delivery_and_preview_do_not_acknowledge(report, monkeypatch):
    module, sent = report
    monkeypatch.setattr(module, 'send_to_telegram', lambda *_, **__: False)
    assert module.send() == 4
    assert not module.STATE_PATH.exists()
    monkeypatch.setattr(module, 'send_to_telegram', lambda *_, **__: True)
    assert module.send(dry_run=True) == 0
    assert not module.STATE_PATH.exists()
    assert module.send() == 0
    assert module.STATE_PATH.exists()


def test_unavailable_db_does_not_acknowledge_false_empty_snapshot(report):
    module, sent = report
    module.DB_PATH.unlink()
    assert module.send() == 0
    assert not sent
    assert not module.STATE_PATH.exists()


@pytest.mark.parametrize('lang', ['en', 'it', 'de', 'es', 'fr', 'pt', 'hu'])
def test_chat_sets_and_reads_back_both_preferences_in_every_language(lang):
    path = ROOT / 'agents/assistente' / ('assistente.md' if lang == 'en' else f'assistente.{lang}.md')
    section = path.read_text().split('[AUTO-REPORT-PREFERENCES]')[1]
    for command in ('jht config set team.auto_report.enabled false',
                    'jht config set team.auto_report.interval_min N',
                    'jht config get team.auto_report'):
        assert command in section
