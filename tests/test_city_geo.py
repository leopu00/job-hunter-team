"""JHT-T351: the coordinates of the residence and of an office written with a city only come from the GeoNames list built into the
image (scripts/geonames_reduce.py -> shared/data/cities.tsv.gz, read by shared/skills/city_geo.py), never from a model, and
nothing of the person leaves the container. A Milano-Roma distance can then be measured; a namesake or a small town is asked.

The rows below are a handful of GeoNames rows written for the test (the real file is downloaded at the build only).

Run:
    pytest tests/test_city_geo.py -v
"""
import gzip
import importlib.util
import io
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parent.parent


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


reduce = _load("geonames_reduce", ROOT / "scripts" / "geonames_reduce.py")
geo = _load("city_geo", ROOT / "shared" / "skills" / "city_geo.py")


def _row(gid, name, alternates, lat, lon, country, admin1, population):
    # the 19 columns of the GeoNames «geoname» table
    return "\t".join([str(gid), name, name.encode("ascii", "ignore").decode() or name, alternates, str(lat), str(lon), "P", "PPLA",
                      country, "", admin1, "", "", "", str(population), "", "200", "Europe/Rome", "2026-01-01"])


ROWS = [
    _row(3173435, "Milan", "Milano,Milán,Милан,米兰,Milaan", 45.46427, 9.18951, "IT", "09", 1236837),
    _row(3169070, "Rome", "Roma,Rom,Рим,Ρώμη", 41.89193, 12.51133, "IT", "07", 2318895),
    _row(2988507, "Paris", "Parigi,París,Париж", 48.85341, 2.3488, "FR", "11", 2138551),
    _row(4717560, "Paris", "", 33.66094, -95.55551, "US", "TX", 24782),
    _row(2509954, "Valencia", "València", 39.46975, -0.37739, "ES", "60", 814208),
    _row(3625549, "Valencia", "", 10.16202, -68.00765, "VE", "07", 1385223),
    _row(3172394, "Napoli", "Naples,Neapel", 40.85216, 14.26811, "IT", "04", 909048),
    _row(3171000, "San Marco", "", 45.0, 11.0, "IT", "20", 6000),
    _row(3171001, "San Marco", "", 41.0, 15.0, "IT", "04", 5500),
    _row(2867714, "München", "Munich,Monaco di Baviera,Мюнхен", 48.13743, 11.57549, "DE", "02", 1260391),
]


@pytest.fixture()
def cities(tmp_path, monkeypatch):
    rows = reduce.reduce_lines(ROWS)
    meta = reduce.write(rows, tmp_path / "data", "test", min_rows=1)
    monkeypatch.setenv("JHT_CITIES_FILE", str(tmp_path / "data" / "cities.tsv.gz"))
    geo._index.cache_clear()
    return tmp_path / "data", meta


def test_the_reduction_keeps_latin_names_and_writes_the_same_bytes_with_their_sha256(cities, tmp_path):
    out, meta = cities
    data = (out / "cities.tsv.gz").read_bytes()
    text = gzip.decompress(data).decode("utf-8")
    assert "Milano" in text and "Milán" in text and "Милан" not in text and "米兰" not in text
    assert meta["rows"] == len(ROWS) and meta["licence"].startswith("CC BY 4.0")
    import hashlib
    assert (out / "cities.tsv.gz.sha256").read_text().split()[0] == hashlib.sha256(data).hexdigest() == meta["sha256"]
    again = reduce.write(reduce.reduce_lines(ROWS), tmp_path / "again", "test", min_rows=1)
    assert again["sha256"] == meta["sha256"], "the same input gives the same bytes (no timestamp in the gzip)"


def test_a_download_that_is_not_cities5000_fails_the_build(tmp_path):
    with pytest.raises(ValueError):
        reduce.write(reduce.reduce_lines(ROWS), tmp_path, "test")           # far fewer rows than cities5000
    with pytest.raises(ValueError):
        reduce.reduce_lines(["1\tnot\ta\trow"])
    with pytest.raises(ValueError):
        reduce.reduce_lines([_row(1, "Nowhere", "", 123.0, 7.0, "IT", "", 9000)])


def test_the_zip_path_of_the_command(tmp_path):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("cities5000.txt", "\n".join(ROWS * 4000) + "\n")
    (tmp_path / "cities5000.zip").write_bytes(buffer.getvalue())
    assert reduce.main(["--zip", str(tmp_path / "cities5000.zip"), "--out", str(tmp_path / "out")]) == 0
    assert json.loads((tmp_path / "out" / "cities.json").read_text())["rows"] == len(ROWS) * 4000


@pytest.mark.parametrize("place, name", [
    ("Milano, Italy", "Milan"), ("milano", "Milan"), ("Milan, Italia", "Milan"), ("Roma, IT", "Rome"),
    ("Monaco di Baviera, Germania", "München"), ("Munich", "München"), ("muenchen", None), ("Napoli (NA)", "Napoli"),
    ("Valencia, Spain", "Valencia"), ("Paris, France", "Paris"),
])
def test_a_town_is_found_by_its_name_ascii_or_latin_alternate_never_by_a_near_spelling(cities, place, name):
    found = geo.locate(place)
    if name is None:
        assert found["status"] == "not_found"
    else:
        assert found["status"] == "found" and found["name"] == name, found


def test_namesakes_are_asked_and_a_small_place_is_not_found(cities):
    assert geo.locate("Valencia, Spain")["country"] == "es"
    valencia = geo.locate("Valencia")
    assert valencia["status"] == "ambiguous" and {c["country"] for c in valencia["candidates"]} == {"es", "ve"}
    assert geo.locate("Paris")["status"] == "ambiguous", "two countries and no country written: ask"
    assert geo.locate("San Marco, Italia")["status"] == "ambiguous", "two of near size in the same country"
    assert geo.locate("Bra, Italia")["status"] == "not_found"
    assert geo.locate("")["status"] == "not_found"


def test_milano_roma_can_be_measured(cities):
    spec = importlib.util.spec_from_file_location("score_place_pay", ROOT / "shared" / "skills" / "score_place_pay.py")
    if not spec or not Path(spec.origin).is_file():
        pytest.skip("the Scorer's part is not under this branch")
    score = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(score)
    a, b = geo.locate("Milano, Italy"), geo.locate("Roma, Italy")
    assert 470 < score.km_between(a["lat"], a["lon"], b["lat"], b["lon"]) < 490


def test_no_list_in_the_image_is_said_never_guessed(monkeypatch, tmp_path):
    monkeypatch.setenv("JHT_CITIES_FILE", str(tmp_path / "missing.tsv.gz"))
    assert geo.locate("Milano, Italy") == {"status": "no_data"}


def _apply(home, request, cities_file):
    send = home / "send"
    send.write_text("#!/bin/sh\ncat > /dev/null\n", encoding="utf-8")
    send.chmod(0o755)
    env = {"PATH": os.environ.get("PATH", ""), "JHT_HOME": str(home), "JHT_SEND_BIN": str(send), "JHT_CITIES_FILE": str(cities_file)}
    done = subprocess.run([sys.executable, str(ROOT / "shared" / "skills" / "profile_apply.py")], input=json.dumps(request),
                          capture_output=True, text=True, env=env, timeout=60)
    return json.loads(done.stdout)


def test_the_residence_gets_its_coordinates_from_the_list_and_never_from_the_request(cities, tmp_path):
    out, _meta = cities
    home = tmp_path / "jht"
    (home / "profile").mkdir(parents=True)
    # the model wrote coordinates of its own: they are replaced by the list's
    answer = _apply(home, {"set": {"residence": {"place": "Milano, Italy", "lat": 1.0, "lon": 2.0}}}, out / "cities.tsv.gz")
    doc = yaml.safe_load((home / "profile" / "candidate_profile.yml").read_text(encoding="utf-8"))
    assert answer["residence_geo"]["status"] == "found"
    assert (doc["residence"]["lat"], doc["residence"]["lon"]) == (45.46427, 9.18951)
    answer = _apply(home, {"set": {"residence.place": "Valencia", "residence.lat": 39.0}}, out / "cities.tsv.gz")
    doc = yaml.safe_load((home / "profile" / "candidate_profile.yml").read_text(encoding="utf-8"))
    assert answer["residence_geo"]["status"] == "ambiguous" and doc["residence"]["lat"] is None and doc["residence"]["lon"] is None
    answer = _apply(home, {"set": {"name": "Ada"}}, out / "cities.tsv.gz")
    assert "residence_geo" not in answer, "no lookup when the residence is not written"


def test_an_office_with_a_city_only_gets_the_centre_of_the_city_not_verified(cities, monkeypatch):
    enrich = _load("position_enrich", ROOT / "shared" / "skills" / "position_enrich.py")
    calls = []

    class Done:
        returncode = 0
    monkeypatch.setattr(enrich, "_skill", lambda *args: calls.append(args) or Done())
    pos = {"id": 7, "loc_city": "Roma", "loc_country_code": "it"}
    assert enrich.city_step(pos, "Roma", dry_run=False) == {"done": True, "precision": "city"}
    args = calls[0]
    assert args[args.index("--location-precision") + 1] == "city" and args[args.index("--office-verified") + 1] == "false"
    assert float(args[args.index("--office-lat") + 1]) == pytest.approx(41.89193)
    assert enrich.city_step({**pos, "loc_country_code": ""}, "Valencia", dry_run=False) is None, "a namesake stays NULL"
    assert enrich.city_step(pos, "Bra", dry_run=False) is None, "a town the list does not know stays NULL"
    assert set(enrich.CITY_FALLBACK) <= set(enrich.REASONS) and "network_error" not in enrich.CITY_FALLBACK


def test_the_image_builds_the_list_and_says_where_it_comes_from():
    dockerfile = (ROOT / "Dockerfile").read_text(encoding="utf-8")
    runtime = dockerfile[dockerfile.index("FROM ${BASE} AS runtime"):]
    assert re.search(r"RUN python3 scripts/geonames_reduce\.py --fetch --out shared/data", runtime)
    assert "sha256sum -c cities.tsv.gz.sha256" in runtime
    notice = (ROOT / "NOTICE.md").read_text(encoding="utf-8")
    assert "GeoNames" in notice and "creativecommons.org/licenses/by/4.0" in notice
    assert "GeoNames" in (ROOT / "README.md").read_text(encoding="utf-8")
    ignored = (ROOT / ".gitignore").read_text(encoding="utf-8")
    assert "shared/data/cities.tsv.gz" in ignored
