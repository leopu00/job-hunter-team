"""location_choice: a location field keeps only one of its own suggestions.

Origin: 1888 (14/09), Lever "Current location" stopped for a human though the
profile says where the candidate lives. Pure matching here; the recipes'
synthetic autocompletes are in the Lever and Greenhouse suites.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "shared" / "skills"))

import location_choice as lc  # noqa: E402

MILANS = ["Milan, Lombardy, Italy", "Milan, Tennessee, United States", "Milano Marittima, Emilia-Romagna, Italy"]


@pytest.mark.parametrize(
    ("wanted", "suggestions", "expected"),
    [
        ("Milan, Italy", MILANS, "Milan, Lombardy, Italy"),
        ("milan,  ITALY", MILANS, "Milan, Lombardy, Italy"),
        ("Milan, United States", MILANS, "Milan, Tennessee, United States"),
        ("Milan, Tennessee, United States", MILANS, "Milan, Tennessee, United States"),  # a saved exact option
        ("Milan", MILANS, None),  # no country: two Milans are the CLOSER's choice
        ("Milan", ["Milan, Lombardy, Italy"], None),  # no country: even one Milan is not certain
        ("Milan, Germany", MILANS, None),
        ("Milano, Italy", MILANS, None),  # another city name is not the same city
        ("São Paulo, Brazil", ["Sao Paulo, State of São Paulo, Brazil"], "Sao Paulo, State of São Paulo, Brazil"),
        ("Milan, Italy", ["Milan, Lombardy, Italy", "Milan, Veneto, Italy"], None),
        ("Milan, Italy", [], None),
        ("", MILANS, None),
    ],
)
def test_pick_only_the_certain_place(wanted, suggestions, expected):
    assert lc.pick(wanted, suggestions) == expected


def test_parts_are_first_and_last():
    assert lc.parts("Milan, Lombardy, Italy") == ("milan", "italy")
    assert lc.parts("Milan") == ("milan", "")
    assert lc.parts(" , ") == ("", "")


def test_queries_type_the_whole_value_then_the_city():
    assert lc.queries("Milan, Italy") == ["Milan, Italy", "Milan"]
    assert lc.queries("Milan") == ["Milan"]
    assert lc.queries("  ") == []
