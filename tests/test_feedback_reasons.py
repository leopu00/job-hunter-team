"""JHT-T05: il vocabolario chiuso dei motivi e il suo validatore.

Eseguire con: pytest tests/test_feedback_reasons.py -v
"""
import json
import os
import sys

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(REPO_ROOT, 'shared', 'skills'))
import feedback_reasons as fr  # noqa: E402

CATALOG = json.load(open(os.path.join(REPO_ROOT, 'shared', 'feedback-reasons.json'), encoding='utf-8'))


def test_the_vocabulary_is_the_ten_codes_of_the_catalog():
    assert fr.REASONS == tuple(CATALOG['reasons'])
    assert set(fr.REASONS) == {
        'too_senior', 'too_junior', 'wrong_location', 'salary_low', 'wrong_stack',
        'company', 'scam_or_gone', 'closed', 'already_applied', 'other',
    }
    assert fr.NOTE_MAX == 200 and fr.PROPOSAL_MIN_POSITIONS == 3


def test_every_code_has_a_label_and_every_family_stays_inside_the_vocabulary():
    assert set(fr.LABELS) == set(fr.REASONS)
    assert fr.FACTUAL <= set(fr.REASONS) and fr.PROPOSABLE <= set(fr.REASONS)
    assert set(fr.LEGACY.values()) <= set(fr.REASONS)


@pytest.mark.parametrize('code', ['too_senior', 'other', 'scam_or_gone'])
def test_a_code_is_a_reason(code):
    assert fr.is_reason(code) and fr.safe_reason(code) == code


@pytest.mark.parametrize('value', ['troppo senior', 'Too_Senior', 'too senior', '<script>', 7, None, ''])
def test_free_text_is_not_a_reason(value):
    assert not fr.is_reason(value)


def test_safe_reason_maps_the_old_codes_and_never_passes_text_through():
    assert fr.safe_reason('not_interested') == 'other'
    assert fr.safe_reason('mismatch') == 'other'
    assert fr.safe_reason('conditions') == 'other'
    assert fr.safe_reason('una frase libera dell’utente') == 'other'
    assert fr.safe_reason('  ') is None and fr.safe_reason(None) is None


def test_clean_note_removes_controls_and_invisible_characters_and_keeps_the_words():
    dirty = 'sede‮ ​milano\x00\n\tcentro'
    assert fr.clean_note(dirty) == 'sede milano centro'
    assert fr.clean_note('  a   b  ') == 'a b'
    assert fr.clean_note(None) == ''
    assert fr.clean_note('é') == 'é'


def test_clean_note_does_not_cut_so_that_a_long_note_can_be_refused():
    long = 'x' * (fr.NOTE_MAX + 1)
    assert len(fr.clean_note(long)) == fr.NOTE_MAX + 1


def test_migrated_note_cuts_to_the_maximum_and_empty_is_none():
    assert len(fr.migrated_note('y' * 500)) == fr.NOTE_MAX
    assert fr.migrated_note('  ​ ') is None
