"""Snapshot comparison fails closed; acquisition tests live with their reader."""

from copy import deepcopy

import pytest

from source_guard_snapshot import assert_multiset_snapshot


SNAPSHOT = {
    "version": 1,
    "guard": "synthetic.inputs",
    "total": 3,
    "elements": [{"name": "alpha", "count": 2}, {"name": "é", "count": 1}],
}


def test_order_of_acquisition_does_not_change_the_multiset():
    assert_multiset_snapshot(["é", "alpha", "alpha"], SNAPSHOT)


@pytest.mark.parametrize("actual", [[], ["alpha", "é"], ["alpha", "alpha"],
                                        ["alpha", "alpha", "é", "extra"],
                                        ["alpha", "é", "é"]])
def test_drop_add_and_duplicate_substitution_are_rejected(actual):
    with pytest.raises(AssertionError, match="source inventory changed"):
        assert_multiset_snapshot(actual, SNAPSHOT)


@pytest.mark.parametrize("change", [
    {"total": 2}, {"total": True}, {"version": True}, {"guard": ""},
    {"elements": [{"name": "alpha", "count": 0}]},
    {"elements": [{"name": "alpha", "count": True}]},
    {"elements": [{"name": "alpha", "count": 1}, {"name": "alpha", "count": 2}]},
    {"elements": list(reversed(SNAPSHOT["elements"]))},
])
def test_malformed_snapshots_are_rejected(change):
    expected = {**deepcopy(SNAPSHOT), **change}
    with pytest.raises(AssertionError):
        assert_multiset_snapshot(["alpha", "alpha", "é"], expected)


@pytest.mark.parametrize("actual", ["alpha", [""], [None], [1]])
def test_bad_actual_names_are_rejected(actual):
    with pytest.raises(AssertionError):
        assert_multiset_snapshot(actual, SNAPSHOT)


def test_zero_matches_requires_an_explicit_zero_snapshot():
    assert_multiset_snapshot([], {"version": 1, "guard": "synthetic.matches", "total": 0,
                                  "elements": []})
    with pytest.raises(AssertionError, match="source inventory changed"):
        assert_multiset_snapshot(["unexpected"], {
            "version": 1, "guard": "synthetic.matches", "total": 0, "elements": []})
