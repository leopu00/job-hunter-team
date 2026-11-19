"""The same ad that a second source writes in other words is a duplicate (banco of the Scouts, 19/11: four doubles in four trades).

Four causes, one test each, with synthetic ads (not the texts of real ads):
  * the place was written in another way («Coriano (Rimini)» / «Rimini (sede di lavoro…)», «Rivalta di Torino» / «Torino (RSA…)»),
    and the text, equal at 90%, was not compared because the first word of the place differed;
  * the Scout saved a summary of the ad, so the text in common is 60-70%, and the company was written two ways;
  * a URL refused as a duplicate came back with another company and title and went in;
  * a log that cannot be read must never stop an INSERT.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))

import city_names  # noqa: E402
import db_insert  # noqa: E402


def words(start, count):
    """`count` distinct invented words, so two texts share exactly the words they are built to share."""
    return [f"voce{n}" for n in range(start, start + count)]


def text(*parts):
    return " ".join(" ".join(p) for p in parts)


@pytest.fixture
def home(tmp_path):
    return tmp_path


def _insert(home, n, company, title, location, jd, url=None):
    env = {**os.environ, "JHT_HOME": str(home), "JHT_AGENT_NAME": "user", "JHT_DB": str(home / "jobs.db")}
    env.pop("JHT_TEST_SKIP", None)
    cmd = [sys.executable, str(SKILLS / "db_insert.py"), "position", "--title", title, "--company", company,
           "--url", url or "https://source%d.example/ad/%d" % (n, n), "--source", "source%d" % n, "--found-by", "user",
           "--location", location, "--remote-type", "onsite"]
    if jd is not None:
        cmd += ["--jd-text", jd]
    return subprocess.run(cmd, capture_output=True, text=True, env=env, timeout=60)


def _count(home):
    return sqlite3.connect(str(home / "jobs.db")).execute("SELECT COUNT(*) FROM positions").fetchone()[0]


def _refused(result, why):
    return result.returncode == 1 and why in result.stdout


# ── the place ────────────────────────────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("a, b, shared", [
    ("Coriano (Rimini), Emilia-Romagna", "Rimini (sede di lavoro indicata nell'annuncio; Coriano nel titolo della fonte)", True),
    ("Rivalta di Torino, Piedmont, Italy", "Torino (RSA Gran Torino)", True),
    ("Turin, Piedmont", "Torino (RSA)", True),
    ("Milano", "Sesto San Giovanni (Milano)", True),
    ("Muscoline (BS), Lombardia, Italy", "Muscoline (BS)", True),
    ("Bari, Puglia", "Bari, Puglia, Italia", True),
    ("Rimini", "Bellaria", False),
    ("Brescia", "Castel Mella", False),
    ("Rimini, Emilia-Romagna", "Bellaria-Igea Marina, Rimini", False),   # the region/country after the comma is not the place
    ("Bergamo", "Brescia", False),
    ("", "Roma", False),
    (None, None, False),
])
def test_two_ways_of_writing_one_place(a, b, shared):
    assert city_names.share_a_place(a, b) is shared
    assert city_names.share_a_place(b, a) is shared


def test_a_province_code_is_not_a_place():
    assert city_names.place_names("Muscoline (BS), Lombardia") == [("muscoline",)]
    assert not city_names.share_a_place("Alfa (BS)", "Beta (BS)")


# ── the four cases of the banco ────────────────────────────────────────────────────────────────────────────────────────

def test_cook_same_ad_two_sources_two_places_written_two_ways(home):
    base = words(0, 120)
    second = words(0, 105) + words(500, 15)            # ~88% in common
    assert _insert(home, 1, "Alfa Lavoro (per conto di un cliente della ristorazione)", "Cuoco con esperienza",
                   "Coriano (Rimini), Emilia-Romagna", text(base)).returncode == 0
    again = _insert(home, 2, "Alfa Italy", "Cuoco", "Rimini (sede di lavoro indicata nell'annuncio; Coriano nel titolo della fonte)",
                    text(second))
    assert _refused(again, "DUPLICATE (testo dell'annuncio+city-norm)"), again.stdout + again.stderr
    assert _count(home) == 1


def test_nurse_same_ad_linkedin_and_aggregator_other_company_spelling(home):
    base = words(1000, 160)
    second = words(1000, 150) + words(2000, 10)
    assert _insert(home, 1, "Cooperativa Beta Impresa Sociale", "Infermiere/Infermiera - RSA - Borgo",
                   "Rivalta di Borgo, Piedmont, Italy", text(base)).returncode == 0
    again = _insert(home, 2, "COOPERATIVA BETA Onlus", "Infermiere/Infermiera - RSA - Borgo", "Borgo (RSA Il Girasole)", text(second))
    assert _refused(again, "DUPLICATE"), again.stdout + again.stderr
    assert _count(home) == 1


def test_mason_the_summary_of_the_scout_against_the_full_text_with_the_same_title(home):
    summary = words(3000, 68) + words(3500, 32)          # 100 words: what the Scout saved
    full = words(3000, 68) + words(4000, 75)             # the aggregator's text: the same 68 words and its own boilerplate
    shingles_a, shingles_b = db_insert._jd_shingles(text(summary)), db_insert._jd_shingles(text(full))
    overlap = len(shingles_a & shingles_b) / min(len(shingles_a), len(shingles_b))
    assert 0.6 <= overlap < 0.7, overlap                   # the case: under the 70% of two other titles, over the 60% of the same title
    assert _insert(home, 1, "Gamma Italia (per conto di un'azienda cliente edile)", "muratore (f/m/nb)", "Bari, Puglia",
                   text(summary)).returncode == 0
    again = _insert(home, 2, "Gamma Italy", "Muratore (f/m/nb)", "Bari, Puglia, Italia", text(full))
    assert _refused(again, "DUPLICATE (testo dell'annuncio+city-norm)"), again.stdout + again.stderr
    assert _count(home) == 1


def test_the_same_overlap_with_another_title_is_another_ad(home):
    summary = words(3000, 68) + words(3500, 32)
    full = words(3000, 68) + words(4000, 75)
    assert _insert(home, 1, "Gamma Italia", "Muratore", "Bari, Puglia", text(summary)).returncode == 0
    other = _insert(home, 2, "Gamma Italia", "Carpentiere", "Bari, Puglia, Italia", text(full))
    assert other.returncode == 0 and _count(home) == 2, other.stdout


def test_the_same_title_under_sixty_percent_is_another_ad(home):
    first = words(5000, 100)
    second = words(5000, 50) + words(6000, 60)             # about half in common
    assert _insert(home, 1, "Gamma Italia", "Muratore", "Bari", text(first)).returncode == 0
    assert _insert(home, 2, "Delta Italia", "Muratore", "Bari", text(second)).returncode == 0
    assert _count(home) == 2


def test_the_same_text_in_another_town_is_another_offer_even_when_the_towns_are_close(home):
    ad = text(words(7000, 120))
    assert _insert(home, 1, "Epsilon", "Addetto cucina", "Rimini", ad).returncode == 0
    assert _insert(home, 2, "Epsilon", "Addetto cucina", "Bellaria", ad).returncode == 0
    assert _count(home) == 2


def test_warehouse_a_url_refused_as_a_duplicate_stays_refused_under_other_names(home):
    url = "https://source9.example/ad/second"
    assert _insert(home, 1, "Zeta Italia (per azienda cliente del territorio)", "Magazziniere / Carrellista", "Muscoline (BS), Lombardia, Italy",
                   None).returncode == 0
    refused = _insert(home, 2, "Zeta Italia (per azienda cliente del territorio)", "Magazziniere / Carrellista", "Muscoline (BS)", None, url=url)
    assert _refused(refused, "DUPLICATE (azienda+titolo+city-norm)"), refused.stdout
    renamed = _insert(home, 3, "Zeta Italia (filiale di Gavardo, inserimento tramite agenzia)", "Magazziniere / Carrellista (m/f/nb), turni",
                      "Muscoline (BS)", None, url=url)
    assert _refused(renamed, "DUPLICATE (URL gia' rifiutato come doppione)"), renamed.stdout + renamed.stderr
    assert "already exists as #1" in renamed.stdout and _count(home) == 1


def test_another_url_with_other_names_is_still_inserted(home):
    assert _insert(home, 1, "Zeta Italia (A)", "Magazziniere", "Muscoline", None).returncode == 0
    assert _refused(_insert(home, 2, "Zeta Italia (A)", "Magazziniere", "Muscoline", None, url="https://source9.example/ad/x"), "DUPLICATE")
    other = _insert(home, 3, "Zeta Italia (B)", "Magazziniere turni", "Muscoline", None, url="https://source9.example/ad/y")
    assert other.returncode == 0 and _count(home) == 2, other.stdout


# ── the log that remembers the refusals is never a reason to stop an INSERT ─────────────────────────────────────────────

def _skip_line(url, existing_id, ts="2999-01-01T00:00:00+00:00", level=2):
    import json
    return json.dumps({"ts": ts, "scout": "scout-1", "level": level, "existing_id": existing_id, "skipped_url": url,
                       "company": "x", "title": "y"}) + "\n"


def _seed(home):
    assert _insert(home, 1, "Eta Italia", "Magazziniere", "Brescia", None).returncode == 0
    (home / "logs").mkdir(exist_ok=True)
    return home / "logs" / "scout-dedup.log"


def test_the_refusal_is_read_from_the_log(home, monkeypatch):
    log = _seed(home)
    monkeypatch.setenv("JHT_HOME", str(home))
    conn = sqlite3.connect(str(home / "jobs.db")); conn.row_factory = sqlite3.Row
    log.write_text(_skip_line("https://x.example/a", 1))
    assert db_insert._urls_refused_before("https://x.example/a") == [(1, "2999-01-01 00:00:00")]
    assert db_insert.check_duplicate(conn, "https://x.example/a", "Other", "Other", "Roma")[1] == "URL gia' rifiutato come doppione"


def test_no_log_no_effect(home, monkeypatch):
    _seed(home)
    monkeypatch.setenv("JHT_HOME", str(home))
    assert db_insert._urls_refused_before("https://x.example/a") == []
    ok = _insert(home, 2, "Theta", "Cuoco", "Roma", None, url="https://x.example/a")
    assert ok.returncode == 0, ok.stdout + ok.stderr


def test_a_log_that_cannot_be_read_has_no_effect(home, monkeypatch):
    log = _seed(home)
    log.mkdir()                                            # a directory where the file should be: open() fails
    monkeypatch.setenv("JHT_HOME", str(home))
    assert db_insert._urls_refused_before("https://x.example/a") == []
    ok = _insert(home, 2, "Theta", "Cuoco", "Roma", None, url="https://x.example/a")
    assert ok.returncode == 0, ok.stdout + ok.stderr


def test_a_log_with_broken_lines_keeps_the_good_ones(home, monkeypatch):
    log = _seed(home)
    monkeypatch.setenv("JHT_HOME", str(home))
    log.write_bytes(b"not json\n" + b'{"ts": 1, "level": 2}\n' + b"\xff\xfe\n" + _skip_line("https://x.example/a", 1).encode() + b"{trunc")
    assert db_insert._urls_refused_before("https://x.example/a") == [(1, "2999-01-01 00:00:00")]


def test_a_log_over_the_cap_is_read_only_in_its_tail(home, monkeypatch):
    log = _seed(home)
    monkeypatch.setenv("JHT_HOME", str(home))
    filler = _skip_line("https://filler.example/z", 1) * ((db_insert.SKIP_LOG_READ_BYTES // 150) + 50)
    log.write_text(_skip_line("https://x.example/old", 1) + filler + _skip_line("https://x.example/new", 1))
    assert log.stat().st_size > db_insert.SKIP_LOG_READ_BYTES
    assert db_insert._urls_refused_before("https://x.example/old") == []          # beyond the cap: no effect, no error
    assert db_insert._urls_refused_before("https://x.example/new") == [(1, "2999-01-01 00:00:00")]
    ok = _insert(home, 2, "Theta", "Cuoco", "Roma", None, url="https://x.example/old")
    assert ok.returncode == 0, ok.stdout + ok.stderr


def test_a_refusal_of_another_database_does_not_count(home, monkeypatch):
    log = _seed(home)
    monkeypatch.setenv("JHT_HOME", str(home))
    conn = sqlite3.connect(str(home / "jobs.db")); conn.row_factory = sqlite3.Row
    log.write_text(_skip_line("https://x.example/a", 1, ts="2000-01-01T00:00:00+00:00")   # older than the row it names
                   + _skip_line("https://x.example/b", 99)                                  # a row that is not there
                   + _skip_line("https://x.example/c", 1, level=1)                          # an exact-URL skip: level 1 decides by itself
                   + _skip_line("https://x.example/d", 1, level=4))                         # a refusal by text: a shared form, can be a false positive
    for url in ("https://x.example/a", "https://x.example/b", "https://x.example/c", "https://x.example/d"):
        assert db_insert.check_duplicate(conn, url, "Other", "Other", "Roma") == (None, None), url
