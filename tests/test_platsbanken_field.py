"""platsbanken_search.py --field: a trade is asked by its field of work (yrkesområde) of the public taxonomy, not by a guessed word.

Run:
    pytest tests/test_platsbanken_field.py -v
"""
import sys
import urllib.parse
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import platsbanken_search as pb  # noqa: E402


def _params(url):
    return dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(url).query))


def test_a_field_is_sent_as_the_occupation_field_concept_and_the_rest_is_unchanged():
    params = _params(pb.url_for(q="sjukskoterska", field="health", city="stockholm"))
    assert params["occupation-field"] == "NYW6_mP6_vwf" and params["q"] == "sjukskoterska" and params["municipality"] == "AvNB_uwa_6n6"
    assert "occupation-field" not in _params(pb.url_for(q="murare"))


@pytest.mark.parametrize("field", sorted(pb.FIELDS))
def test_every_field_is_a_taxonomy_code_and_is_sent(field):
    code = pb.FIELDS[field]
    assert len(code) == 12 and code.count("_") == 2
    assert _params(pb.url_for(field=field))["occupation-field"] == code


@pytest.mark.parametrize("bad", ["Hälso- och sjukvård", "health&limit=1", "j7Cq_ZJe_GkT", "nurse"])
def test_a_field_that_is_not_in_the_list_is_refused_and_nothing_is_sent(bad):
    with pytest.raises(pb.Refused):
        pb.url_for(field=bad)


def test_the_command_line_takes_the_field():
    seen = []
    pb_search = pb.search
    try:
        pb.search = lambda **kw: seen.append(kw) or {"ok": True, "status": "ok", "http": 200, "total": 0, "returned": 0, "hits": []}
        pb.main(["--q", "murare", "--field", "construction"])
    finally:
        pb.search = pb_search
    assert seen and seen[0]["field"] == "construction"
