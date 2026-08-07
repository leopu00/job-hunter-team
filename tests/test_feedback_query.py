"""Contratto di `feedback_query.py` — i motivi che l'utente scrive a mano.

Perché questi test esistono: `reason` e `comment` sono l'unico punto in cui
l'utente dice *perché* una posizione non le interessa, con parole sue. Fino
al 2026-07-28 nessuno li contava: dieci volte "troppo senior" restavano dieci
aneddoti separati. La modalità `themes` li raggruppa, e il Mentor ci appoggia
sopra il Pattern F — cioè una frase detta all'utente. Se il raggruppamento
sbaglia, il Mentor parla a vuoto: da qui i test sul conteggio per POSIZIONI
distinte (non per eventi), sull'assorbimento del bigramma e sui voti ritirati.

L'altra metà è il fail-safe: cloud spento o endpoint non ancora deployato
devono produrre un payload neutro con `note`, mai un errore — un agente non
si ferma perché il cloud è giù.

Eseguire con: pytest tests/test_feedback_query.py -v
"""

import json
import os
import subprocess
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
SKILLS_DIR = os.path.join(REPO_ROOT, 'shared', 'skills')
SKILL = os.path.join(SKILLS_DIR, 'feedback_query.py')

sys.path.insert(0, SKILLS_DIR)
import feedback_query as fq  # noqa: E402


def ev(legacy_id, action='dislike', reason=None, comment=None,
       created_at='2026-07-20T10:00:00Z'):
    return {
        'legacy_id': str(legacy_id), 'action': action, 'reason': reason,
        'comment': comment, 'score': None, 'direction': None,
        'created_at': created_at,
    }


def theme(report, key):
    for t in report['themes']:
        if t['key'] == key:
            return t
    return None


def keys(report):
    return {t['key'] for t in report['themes']}


# ── normalizzazione ─────────────────────────────────────────────────────

def test_words_strips_accents_case_and_punctuation():
    """"Troppo Senior!" e "troppo séniore" devono finire sullo stesso binario."""
    assert fq._words('Troppo Senior!') == ['troppo', 'senior']
    assert fq._words('troppo séniore,') == ['troppo', 'seniore']


def test_words_drops_service_words_and_short_tokens():
    got = fq._words('non mi interessa questo stack, e la RAL')
    assert 'questo' not in got  # stopword
    assert 'mi' not in got      # sotto MIN_TOKEN_LEN
    assert 'interessa' in got
    assert 'ral' in got


def test_stopwords_and_weak_words_do_not_overlap():
    """Una parola in entrambe le liste sarebbe scartata prima di poter
    formare un bigramma: "troppo senior" tornerebbe a essere invisibile."""
    assert not (fq.STOPWORDS & fq.WEAK_ALONE)


def test_prefix_cut_collapses_inflections_across_languages():
    assert fq._key('senior') == fq._key('seniority') == fq._key('seniore')
    assert fq._key('salary') == fq._key('salario')


# ── raggruppamento ──────────────────────────────────────────────────────

def test_same_objection_written_four_ways_becomes_one_theme():
    events = [
        ev(1, reason='troppo senior'),
        ev(2, reason='Troppo Senior!'),
        ev(3, reason='richiesta troppo seniore per me'),
        ev(4, reason='troppo senior, cerco altro'),
    ]
    rep = fq.aggregate_themes(events, min_positions=3)
    t = theme(rep, 'tropp senio')
    assert t is not None, keys(rep)
    assert t['positions'] == 4
    assert t['label'] == 'troppo senior'
    assert t['actions'] == {'dislike': 4}
    assert sorted(t['legacy_ids']) == ['1', '2', '3', '4']


def test_bigram_absorbs_the_bare_word():
    """"senior" da solo non deve comparire accanto a "troppo senior":
    è lo stesso fatto raccontato due volte, e la versione muta dice meno."""
    events = [ev(i, reason='troppo senior') for i in range(1, 5)]
    rep = fq.aggregate_themes(events, min_positions=3)
    assert 'tropp senio' in keys(rep)
    assert 'senio' not in keys(rep)


def test_bare_word_survives_when_the_bigram_covers_little():
    events = [
        ev(1, reason='troppo senior'), ev(2, reason='troppo senior'),
        ev(3, reason='senior architect'), ev(4, reason='senior lead'),
        ev(5, reason='ruolo senior'), ev(6, reason='profilo senior'),
    ]
    rep = fq.aggregate_themes(events, min_positions=3)
    assert 'senio' in keys(rep)
    t = theme(rep, 'senio')
    assert t['positions'] == 6


def test_weak_word_alone_is_never_a_theme():
    """"troppo" da solo non è un motivo: senza il sostantivo non dice niente."""
    events = [
        ev(1, reason='troppo senior'), ev(2, reason='troppo lontano'),
        ev(3, reason='troppo poco pagato'), ev(4, reason='troppo grande'),
    ]
    rep = fq.aggregate_themes(events, min_positions=3)
    assert 'tropp' not in keys(rep)


def test_counts_distinct_positions_not_events():
    """Giudicare due volte lo stesso annuncio resta un'opinione sola."""
    events = [
        ev(1, reason='troppo senior', created_at='2026-07-20T10:00:00Z'),
        ev(1, reason='troppo senior', created_at='2026-07-19T10:00:00Z'),
        ev(1, reason='troppo senior', created_at='2026-07-18T10:00:00Z'),
        ev(2, reason='troppo senior'),
    ]
    rep = fq.aggregate_themes(events, min_positions=2)
    t = theme(rep, 'tropp senio')
    assert t['positions'] == 2
    assert t['events'] == 4
    assert rep['positions_with_text'] == 2


def test_events_without_a_position_are_ignored():
    """Un evento non attribuibile a una posizione gonfierebbe un conteggio
    che ragiona proprio per posizioni distinte."""
    orphan = ev(1, reason='troppo senior')
    orphan['legacy_id'] = ''
    events = [ev(1, reason='troppo senior'), ev(2, reason='troppo senior'),
              orphan]
    rep = fq.aggregate_themes(events, min_positions=2)
    assert rep['positions_with_text'] == 2
    assert theme(rep, 'tropp senio')['positions'] == 2


def test_min_positions_filters_the_one_off_remark():
    events = [
        ev(1, reason='troppo senior'), ev(2, reason='troppo senior'),
        ev(3, reason='troppo senior'), ev(4, reason='azienda antipatica'),
    ]
    rep = fq.aggregate_themes(events, min_positions=3)
    assert 'tropp senio' in keys(rep)
    assert not [k for k in keys(rep) if 'antip' in k]


def test_share_is_computed_over_positions_that_carry_text():
    events = [
        ev(1, reason='troppo senior'), ev(2, reason='troppo senior'),
        ev(3, reason='troppo senior'), ev(4, reason='stack legacy'),
        ev(5, action='like'), ev(6, action='star'),  # senza testo
    ]
    rep = fq.aggregate_themes(events, min_positions=3)
    assert rep['positions_with_text'] == 4
    assert theme(rep, 'tropp senio')['share'] == 0.75


def test_comment_is_aggregated_too_and_field_can_narrow_it():
    events = [
        ev(i, reason=None, comment='richiedono 5+ anni in java legacy')
        for i in range(1, 4)
    ]
    both = fq.aggregate_themes(events, min_positions=3, field='both')
    assert [k for k in keys(both) if 'legac' in k]
    only_reason = fq.aggregate_themes(events, min_positions=3, field='reason')
    assert only_reason['themes'] == []
    assert only_reason['events_with_text'] == 0


def test_no_bigram_is_invented_across_the_reason_comment_boundary():
    """L'utente non ha mai scritto "senior chiedono": sono due frasi."""
    events = [ev(i, reason='troppo senior', comment='chiedono otto anni')
              for i in range(1, 4)]
    rep = fq.aggregate_themes(events, min_positions=3)
    assert 'tropp senio' in keys(rep)
    assert 'senio chied' not in keys(rep)


def test_examples_keep_the_users_own_words():
    events = [ev(i, reason='troppo senior per il mio profilo')
              for i in range(1, 4)]
    rep = fq.aggregate_themes(events, min_positions=3)
    assert theme(rep, 'tropp senio')['examples'][0] == \
        'troppo senior per il mio profilo'


# ── voti ritirati (mig 059 `clear`) ─────────────────────────────────────

def test_retracted_vote_is_left_out_by_default():
    events = [
        ev(1, action='clear', created_at='2026-07-21T10:00:00Z'),
        ev(1, reason='troppo senior', created_at='2026-07-20T10:00:00Z'),
        ev(2, reason='troppo senior'), ev(3, reason='troppo senior'),
    ]
    rep = fq.aggregate_themes(events, min_positions=2)
    assert rep['positions_cleared'] == 1
    assert theme(rep, 'tropp senio')['positions'] == 2

    with_cleared = fq.aggregate_themes(events, min_positions=2,
                                       include_cleared=True)
    assert theme(with_cleared, 'tropp senio')['positions'] == 3


def test_a_new_vote_after_a_clear_counts_again():
    """`clear` conta solo se è l'ULTIMO evento: chi ci ripensa due volte
    ha comunque espresso un giudizio."""
    events = [
        ev(1, reason='troppo senior', created_at='2026-07-22T10:00:00Z'),
        ev(1, action='clear', created_at='2026-07-21T10:00:00Z'),
        ev(2, reason='troppo senior'), ev(3, reason='troppo senior'),
    ]
    rep = fq.aggregate_themes(events, min_positions=3)
    assert rep['positions_cleared'] == 0
    assert theme(rep, 'tropp senio')['positions'] == 3


# ── finestra temporale e ordinamento ────────────────────────────────────

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
             'reason': 'troppo senior', 'comment': None, 'score': 2,
             'direction': None, 'created_at': '2026-07-20T10:00:00Z'},
        ]}

    monkeypatch.setattr(fq, '_api_get', fake_get)
    events, note = fq.fetch_events(days=30, limit=100)
    assert note is None
    assert seen['path'].startswith('/api/positions/feedback?')
    assert 'days=30' in seen['path'] and 'limit=100' in seen['path']
    assert events[0]['legacy_id'] == '42'  # sempre stringa, come `check`
    assert events[0]['reason'] == 'troppo senior'


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
    assert rep['ok'] is True and 'http-404' in rep['note']


def test_legacy_ids_fallback_reads_one_position_at_a_time(monkeypatch):
    calls = []

    def fake_check(legacy_id):
        calls.append(str(legacy_id))
        return {
            'ok': True, 'legacy_id': str(legacy_id), 'count': 1,
            'latest_action': 'dislike', 'latest_direction': None,
            'actions': [{'action': 'dislike', 'created_at': '2026-07-20T10:00:00Z',
                         'reason': 'troppo senior', 'comment': None,
                         'score': None, 'direction': None}],
        }

    monkeypatch.setattr(fq, 'check_position', fake_check)
    rep = fq.themes_report(days=30, min_positions=2, legacy_ids=['7', '8'])
    assert calls == ['7', '8']
    assert theme(rep, 'tropp senio')['positions'] == 2


def test_legacy_ids_fallback_all_unreadable_is_still_neutral(monkeypatch):
    monkeypatch.setattr(fq, 'check_position', lambda lid: {
        'ok': True, 'legacy_id': str(lid), 'latest_action': None,
        'latest_direction': None, 'count': 0, 'actions': [],
        'note': 'no-signal (cloud-disabled)'})
    rep = fq.themes_report(days=30, legacy_ids=['7'])
    assert rep['ok'] is True and 'note' in rep
    assert rep['note'] == 'no-signal (no readable positions)'


def test_recent_truncates_long_comments(monkeypatch):
    monkeypatch.setattr(fq, '_api_get', lambda *a, **k: (True, {'feedback': [
        {'position_legacy_id': '1', 'action': 'dislike', 'reason': 'x' * 40,
         'comment': 'y' * 900, 'score': None, 'direction': None,
         'created_at': '2026-07-20T10:00:00Z'}]}))
    rec = fq.recent_feedback(days=30, text_chars=50)
    assert len(rec['items'][0]['comment']) == 51  # 50 + ellissi
    assert rec['items'][0]['reason'] == 'x' * 40  # sotto soglia: intatto
    assert rec['with_text'] == 1
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
