"""Contratto di `feedback_query.py` — i motivi sono codici, il testo resta all'utente.

JHT-T05. Il motivo di un giudizio è un codice del vocabolario chiuso
(`shared/feedback-reasons.json`): `themes` conta POSIZIONI DISTINTE per codice
e non interpreta più testo. La nota che l'utente scrive non arriva a nessun
agente, in nessuna delle due corsie (la prova con la sentinella sta in
`tests/test_feedback_note_never_reaches_agents.py`).

L'altra metà è il fail-safe: cloud spento o endpoint non ancora deployato
devono produrre un payload neutro con `note`, mai un errore — un agente non
si ferma perché il cloud è giù.

Eseguire con: pytest tests/test_feedback_query.py -v
"""

import json
import os
import subprocess
import sys
from datetime import datetime, timedelta, timezone

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
SKILL = os.path.join(SKILLS_DIR, 'feedback_query.py')

sys.path.insert(0, SKILLS_DIR)
import feedback_query as fq  # noqa: E402

RECENT_AT = (
    datetime.now(timezone.utc) - timedelta(days=1)
).isoformat(timespec='seconds').replace('+00:00', 'Z')


def ev(legacy_id, action='dislike', reason=None, created_at=RECENT_AT):
    return {
        'legacy_id': str(legacy_id), 'action': action, 'reason': reason,
        'score': None, 'direction': None, 'created_at': created_at,
    }


def theme(report, key):
    for t in report['themes']:
        if t['key'] == key:
            return t
    return None


def keys(report):
    return {t['key'] for t in report['themes']}


# ── il conteggio per codice ─────────────────────────────────────────────

def test_the_same_reason_on_three_positions_is_one_theme():
    events = [ev(i, reason='too_senior') for i in (1, 2, 3)]
    rep = fq.aggregate_themes(events)
    assert keys(rep) == {'too_senior'}
    assert theme(rep, 'too_senior')['positions'] == 3
    assert theme(rep, 'too_senior')['label'] == 'too senior'


def test_counts_distinct_positions_not_events():
    events = [ev(1, reason='too_senior'), ev(1, reason='too_senior'),
              ev(1, reason='too_senior'), ev(2, reason='too_senior')]
    rep = fq.aggregate_themes(events, min_positions=1)
    assert theme(rep, 'too_senior')['positions'] == 2


def test_only_the_last_judgement_of_a_position_counts():
    events = [
        ev(1, reason='too_senior', created_at='2026-07-02T10:00:00Z'),
        ev(1, reason='wrong_stack', created_at='2026-07-20T10:00:00Z'),
    ]
    rep = fq.aggregate_themes(events, min_positions=1)
    assert keys(rep) == {'wrong_stack'}


def test_events_without_a_position_are_ignored():
    nameless = ev(9, reason='too_senior')
    nameless['legacy_id'] = None
    events = [ev('', reason='too_senior'), nameless, ev(2, reason='too_senior')]
    rep = fq.aggregate_themes(events, min_positions=1)
    assert theme(rep, 'too_senior')['positions'] == 1


def test_min_positions_filters_the_one_off_remark():
    events = [ev(1, reason='too_senior'), ev(2, reason='too_senior'),
              ev(3, reason='salary_low')]
    rep = fq.aggregate_themes(events, min_positions=2)
    assert keys(rep) == {'too_senior'}


def test_share_is_computed_over_positions_that_carry_a_reason():
    events = [ev(1, reason='too_senior'), ev(2, reason='too_senior'),
              ev(3, reason=None), ev(4, reason=None)]
    rep = fq.aggregate_themes(events, min_positions=1)
    assert rep['positions_with_reason'] == 2
    assert theme(rep, 'too_senior')['share'] == 1.0


def test_a_free_text_reason_from_an_old_row_counts_as_other_and_never_as_text():
    events = [ev(i, reason='troppo senior per me') for i in (1, 2, 3)]
    rep = fq.aggregate_themes(events)
    assert keys(rep) == {'other'}
    assert 'senior' not in json.dumps(rep)


def test_retracted_vote_is_left_out_by_default():
    events = [
        ev(1, reason='too_senior', created_at='2026-07-01T10:00:00Z'),
        ev(1, action='clear', created_at='2026-07-02T10:00:00Z'),
        ev(2, reason='too_senior'),
    ]
    rep = fq.aggregate_themes(events, min_positions=1)
    assert theme(rep, 'too_senior')['positions'] == 1
    assert rep['positions_cleared'] == 1


def test_a_new_vote_after_a_clear_counts_again():
    events = [
        ev(1, reason='too_senior', created_at='2026-07-01T10:00:00Z'),
        ev(1, action='clear', created_at='2026-07-02T10:00:00Z'),
        ev(1, reason='too_senior', created_at='2026-07-03T10:00:00Z'),
    ]
    rep = fq.aggregate_themes(events, min_positions=1)
    assert theme(rep, 'too_senior')['positions'] == 1
    assert rep['positions_cleared'] == 0


# ── finestra e ordine ───────────────────────────────────────────────────

def test_window_filter_drops_old_events_and_keeps_unparsable_dates():
    events = [
        ev(1, created_at='2020-01-01T00:00:00Z'),
        ev(2, created_at=None),
    ]
    kept = fq._within_window(events, days=30)
    assert [e['legacy_id'] for e in kept] == ['2']
    assert len(fq._within_window(events, days=0)) == 2


def test_events_are_sorted_newest_first_even_if_the_source_is_not():
    events = [
        ev(1, created_at='2026-07-01T10:00:00Z'),
        ev(2, created_at='2026-07-20T10:00:00Z'),
    ]
    assert [e['legacy_id'] for e in fq._sorted_desc(events)] == ['2', '1']


# ── lettura dal cloud + fail-safe ───────────────────────────────────────

def test_fetch_events_reads_the_bulk_endpoint(monkeypatch):
    seen = {}

    def fake_get(path, timeout=10.0):
        seen['path'] = path
        return True, {'feedback': [
            {'position_legacy_id': 42, 'action': 'dislike',
             'reason': 'too_senior', 'note': 'ruolo da lead', 'score': 2,
             'direction': None, 'created_at': RECENT_AT},
        ]}

    monkeypatch.setattr(fq, '_api_get', fake_get)
    events, note = fq.fetch_events(days=30, limit=100)
    assert note is None
    assert seen['path'].startswith('/api/positions/feedback?')
    assert 'days=30' in seen['path'] and 'limit=100' in seen['path']
    assert events[0]['legacy_id'] == '42'  # sempre stringa, come `check`
    assert events[0]['reason'] == 'too_senior'
    assert 'note' not in events[0] and 'comment' not in events[0]


def test_cloud_down_returns_a_neutral_payload_not_an_error(monkeypatch):
    monkeypatch.setattr(fq, '_api_get', lambda *a, **k: (False, 'cloud-disabled'))
    rep = fq.themes_report(days=30)
    assert rep['ok'] is True
    assert rep['themes'] == []
    assert 'cloud-disabled' in rep['note']
    rec = fq.recent_feedback(days=30)
    assert rec['ok'] is True and rec['count'] == 0 and 'note' in rec


def test_missing_bulk_endpoint_degrades_to_no_signal(monkeypatch):
    """Cloud vivo ma route non ancora deployata: nessun segnale, non un crash."""
    monkeypatch.setattr(fq, '_api_get', lambda *a, **k: (False, 'http-404: '))
    rep = fq.themes_report(days=30)
    assert rep['ok'] is True
    assert rep['note'] == fq.NO_SIGNAL_REMOTE_UNAVAILABLE


def test_legacy_ids_fallback_reads_one_position_at_a_time(monkeypatch):
    calls = []

    def fake_check(legacy_id):
        calls.append(str(legacy_id))
        return {
            'ok': True, 'legacy_id': str(legacy_id), 'count': 1,
            'latest_action': 'dislike', 'latest_direction': None,
            'actions': [{'action': 'dislike', 'created_at': RECENT_AT,
                         'reason': 'too_senior', 'score': None,
                         'direction': None}],
        }

    monkeypatch.setattr(fq, 'check_position', fake_check)
    rep = fq.themes_report(days=30, min_positions=2, legacy_ids=['7', '8'])
    assert calls == ['7', '8']
    assert theme(rep, 'too_senior')['positions'] == 2


def test_legacy_ids_fallback_all_unreadable_is_still_neutral(monkeypatch):
    monkeypatch.setattr(fq, 'check_position', lambda lid: {
        'ok': True, 'legacy_id': str(lid), 'latest_action': None,
        'latest_direction': None, 'count': 0, 'actions': [],
        'note': fq.NO_SIGNAL_CLOUD_DISABLED})
    rep = fq.themes_report(days=30, legacy_ids=['7'])
    assert rep['ok'] is True and 'note' in rep
    assert rep['note'] == fq.NO_SIGNAL_NO_READABLE_POSITIONS


def test_themes_exclude_current_position_but_keep_future_learning(monkeypatch):
    events = [
        ev(42, action='star', reason='other'),
        ev(41, action='dislike', reason='wrong_location'),
    ]
    monkeypatch.setattr(fq, 'fetch_events', lambda **_kwargs: (events, None))

    rep = fq.themes_report(days=30, min_positions=1, exclude_legacy_ids=['42'])

    assert rep['excluded_legacy_ids'] == ['42']
    assert all('42' not in item['legacy_ids'] for item in rep['themes'])
    assert keys(rep) == {'wrong_location'}


def test_recent_carries_the_reason_code_and_no_text(monkeypatch):
    monkeypatch.setattr(fq, '_api_get', lambda *a, **k: (True, {'feedback': [
        {'position_legacy_id': '1', 'action': 'dislike', 'reason': 'x' * 40,
         'comment': 'y' * 900, 'note': 'z' * 200, 'score': None,
         'direction': None, 'created_at': RECENT_AT}]}))
    rec = fq.recent_feedback(days=30)
    item = rec['items'][0]
    assert item['reason'] == 'other'  # un testo libero non è un codice
    assert not ({'comment', 'note', 'display_comment', 'display_reason'} & set(item))
    assert rec['with_reason'] == 1
    assert rec['by_action'] == {'dislike': 1}


# ── CLI ─────────────────────────────────────────────────────────────────

def run_cli(*args, home=None):
    env = {**os.environ}
    if home:
        env['JHT_HOME'] = str(home)
    return subprocess.run([sys.executable, SKILL, *args],
                          capture_output=True, text=True, env=env, cwd=REPO_ROOT)


@pytest.mark.parametrize('cmd', ['recent', 'themes'])
def test_cli_exits_zero_without_cloud(cmd, tmp_path):
    """Senza cloud.json l'agente deve poter proseguire: exit 0, ok=true."""
    res = run_cli(cmd, '--days', '30', home=tmp_path)
    assert res.returncode == 0, res.stderr
    payload = json.loads(res.stdout)
    assert payload['ok'] is True
    assert payload['note'].startswith('no-signal')


def test_cli_check_still_works(tmp_path):
    res = run_cli('check', '42', home=tmp_path)
    assert res.returncode == 0, res.stderr
    payload = json.loads(res.stdout)
    assert payload['legacy_id'] == '42'
    assert payload['latest_action'] is None


def test_cli_themes_attests_current_position_exclusion(tmp_path):
    res = run_cli(
        'themes',
        '--days', '30',
        '--exclude-legacy-id', '42',
        home=tmp_path,
    )
    assert res.returncode == 0, res.stderr
    payload = json.loads(res.stdout)
    assert payload['excluded_legacy_ids'] == ['42']
