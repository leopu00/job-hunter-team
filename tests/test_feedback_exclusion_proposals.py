"""JHT-T05: quando l'app PROPONE un'esclusione del profilo.

Stessa tabella di casi (`tests/fixtures/feedback-proposals.json`) per Python
(`feedback_reasons.proposals`) e per TypeScript
(`web/lib/feedback-reasons.ts`, test in `tests/js/tasks/`): le due copie della
regola non possono divergere senza che uno dei due test diventi rosso.
"""
import json
import os
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(REPO_ROOT, 'shared', 'skills'))
import feedback_reasons as fr  # noqa: E402

CASES = json.load(open(os.path.join(REPO_ROOT, 'tests', 'fixtures', 'feedback-proposals.json'), encoding='utf-8'))


@pytest.mark.parametrize('case', CASES, ids=[c['name'] for c in CASES])
def test_the_rule_of_the_proposal(case):
    assert fr.proposals(case['events']) == case['expected']


def test_the_threshold_is_the_one_in_the_catalog():
    assert fr.PROPOSAL_MIN_POSITIONS == 3
    two = [{'legacy_id': str(i), 'action': 'dislike', 'reason': 'too_senior',
            'created_at': '2026-10-01T10:00:00Z'} for i in (1, 2)]
    assert fr.proposals(two) == []
    assert fr.proposals(two, min_positions=2)[0]['positions'] == 2


def test_a_reason_outside_the_vocabulary_is_refused_by_the_writers_and_never_proposed():
    assert not fr.is_reason('troppo senior')
    assert fr.safe_reason('troppo senior') == 'other'
    assert 'other' not in fr.PROPOSABLE and not (fr.FACTUAL & fr.PROPOSABLE)
    assert set(fr.PROPOSABLE) | set(fr.FACTUAL) | {'other'} == set(fr.REASONS)
