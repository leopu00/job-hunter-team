"""ats_board_search.py: the whole board of a company, for one country, with the reason of every ad left out.

Real run: 11 Swedish Greenhouse boards, 0 candidates, nothing to say why (a check of four of them found some 45 ads in
Sweden). Field data: Truecaller, 16 ads in Sweden, 12 dropped for seniority and 4 for the role, and the filter was right:
the fault was that nobody could see it. These tests use fixtures of the forms the boards really write, no network.
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parents[1] / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import ats_board_search as ab  # noqa: E402

TABLE = {"se": {"greenhouse": {"url": "https://boards-api.greenhouse.io/v1/boards/{slug}/jobs", "slugs": ["truecaller", "mentimeter", "wolt"]},
                "lever": {"url": "https://api.lever.co/v0/postings/{slug}?mode=json", "slugs": ["spotify"]},
                "teamtailor": {"url": "{url}", "urls": {"kambi": "https://kambi.teamtailor.com/jobs", "anyfin": "https://career.anyfin.com/jobs"}}}}


def gh(*jobs):
    return json.dumps({"jobs": [{"id": i, "title": t, "absolute_url": "https://job-boards.greenhouse.io/x/jobs/%d" % i,
                                 "location": {"name": loc}, "updated_at": "2026-11-01T10:00:00-04:00"} for i, (t, loc) in enumerate(jobs, 1)],
                       "meta": {"total": len(jobs)}}).encode()


def answer(body, status=200):
    return lambda url: (status, body)


@pytest.mark.parametrize("location,place", [
    ("Stockholm", "country"), ("Sweden", "country"), ("Stockholm, Sweden ", "country"), ("Solna, Sweden", "country"),
    ("Malmö", "country"), ("Göteborg", "country"), ("Greater Stockholm Area", "country"), ("Remote - Sweden", "country"),
    ("Berlin, Germany; Helsinki, Finland; Stockholm, Sweden", "country"),            # Wolt: three cities in one string
    ("Berlin, Germany; Helsinki, Finland; Tallinn, Estonia", "other"),
    ("Remote", "remote"), ("Remote, Germany", "other"), ("New York, NY", "other"), ("", "other"), ("Lundy Island", "other"),
])
def test_the_country_is_recognised_in_every_form_a_board_writes_the_place(location, place):
    assert ab.place_of(location, "se") == place


def test_lever_gives_the_country_itself_and_it_is_trusted():
    assert ab.place_of("Office 3", "se", "SE") == "country"
    assert ab.place_of("Stockholm", "se", "US") == "country"          # the text still says Stockholm


@pytest.mark.parametrize("title,level", [
    ("Senior Software Engineer", "senior"), ("Sr. Data Analyst", "senior"), ("Staff Engineer (Backend)", "senior"),
    ("Lead Designer", "lead"), ("Head of Growth", "lead"), ("Engineering Director", "lead"), ("Senior Engineering Manager, Lead", "lead"),
    ("Software Engineering Intern", "intern"), ("Praktikant Marknad", "intern"), ("Trainee Sustainability", "intern"),
    ("Junior Marketing Coordinator", "junior"), ("Graduate Engineer", "junior"),
    ("Product Manager", "unknown"), ("Marketing Coordinator", "unknown"), ("Seniority Analyst", "unknown"),
])
def test_the_seniority_is_read_from_the_title_and_most_titles_say_none(title, level):
    assert ab.seniority(title) == level


def test_the_whole_board_comes_back_with_the_seniority_as_a_field_and_the_other_countries_only_counted():
    body = gh(("Marketing Coordinator", "Stockholm"), ("Senior Backend Engineer", "Stockholm, Sweden"),
              ("Data Analyst", "Berlin, Germany; Helsinki, Finland; Stockholm, Sweden"), ("Account Executive", "London, UK"),
              ("Support Agent", "Remote"))
    result = ab.search("greenhouse", "mentimeter", "se", fetcher=answer(body), data=TABLE)
    assert (result["ok"], result["status"], result["provider"], result["board"], result["country"]) == (True, "ok", "greenhouse", "mentimeter", "se")
    assert result["counts"] == {"board_total": 5, "in_country": 3, "remote_unplaced": 1, "returned": 3,
                                "dropped_country": 1, "dropped_role": 0, "dropped_seniority": 0}
    assert [(h["title"], h["seniority"], h["place"]) for h in result["hits"]] == [
        ("Marketing Coordinator", "unknown", "country"), ("Senior Backend Engineer", "senior", "country"), ("Data Analyst", "unknown", "country")]
    assert set(result["hits"][0]) == {"id", "title", "url", "location", "place", "seniority", "posted"}
    assert result["dropped"] == []
    assert ab.search("greenhouse", "mentimeter", "se", include_remote=True, fetcher=answer(body), data=TABLE)["counts"]["returned"] == 4


def test_the_truecaller_case_says_which_ads_went_and_why():
    """16 ads in Sweden: 12 too senior, 4 for another role. The filter is right; the tool must show it."""
    jobs = [("Senior Engineer %d" % i, "Stockholm, Sweden") for i in range(10)] + [("Lead Designer", "Stockholm"), ("Staff Engineer", "Sweden")]
    jobs += [("Sales Operations %d" % i, "Stockholm") for i in range(4)] + [("Barista", "Oslo, Norway")]
    result = ab.search("greenhouse", "truecaller", "se", title_any=["coordinator", "marketing", "hållbarhet"], drop_seniority=["senior", "lead"],
                       fetcher=answer(gh(*jobs)), data=TABLE)
    assert result["counts"]["in_country"] == 16 and result["counts"]["dropped_country"] == 1
    assert (result["counts"]["dropped_seniority"], result["counts"]["dropped_role"], result["counts"]["returned"]) == (12, 4, 0)
    assert result["status"] == "empty" and result["ok"] is True
    assert {d["reason"] for d in result["dropped"]} == {"seniority", "role"}      # both reasons are shown, as a sample of each
    assert len(result["dropped"]) == ab.MAX_DROPPED_PER_REASON + 4
    assert all("location" in d and "title" in d and "seniority" in d for d in result["dropped"])


def test_a_title_word_keeps_the_ad_without_regard_to_case_or_accents():
    body = gh(("Hållbarhetskoordinator", "Stockholm"), ("Plumber", "Stockholm"))
    result = ab.search("greenhouse", "wolt", "se", title_any=["HALLBARHET"], fetcher=answer(body), data=TABLE)
    assert [h["title"] for h in result["hits"]] == ["Hållbarhetskoordinator"] and result["counts"]["dropped_role"] == 1


def test_the_list_of_dropped_ads_is_capped_but_the_counts_are_not():
    body = gh(*[("Senior %d" % i, "Stockholm") for i in range(100)])
    result = ab.search("greenhouse", "wolt", "se", drop_seniority=["senior"], fetcher=answer(body), data=TABLE)
    assert result["counts"]["dropped_seniority"] == 100 and len(result["dropped"]) == ab.MAX_DROPPED_PER_REASON


def test_lever_postings_are_read_with_their_country_and_all_their_places():
    body = json.dumps([
        {"id": "a1", "text": "Junior Producer", "hostedUrl": "https://jobs.lever.co/spotify/a1", "country": "SE", "createdAt": 1792767640768,
         "categories": {"location": "Stockholm", "allLocations": ["Stockholm", "Gothenburg"]}},
        {"id": "a2", "text": "Account Executive", "hostedUrl": "https://jobs.lever.co/spotify/a2", "country": "US", "categories": {"location": "New York, NY"}},
        {"id": "a3", "text": "Remote Engineer", "hostedUrl": "javascript:alert(1)", "categories": {"location": "Remote"}}]).encode()
    result = ab.search("lever", "spotify", "se", fetcher=answer(body), data=TABLE)
    assert [h["title"] for h in result["hits"]] == ["Junior Producer"] and result["hits"][0]["seniority"] == "junior"
    assert result["hits"][0]["location"] == "Stockholm; Gothenburg" and result["hits"][0]["posted"].startswith("202")
    assert result["counts"]["remote_unplaced"] == 1
    assert ab.search("lever", "spotify", "se", include_remote=True, fetcher=answer(body), data=TABLE)["hits"][-1]["url"] is None   # not https: no link


TEAMTAILOR = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel><title>Kambi</title>
<item><title>Linux Platform Engineer - Stockholm / Uppsala</title><pubDate>Thu, 08 Oct 2026 15:10:46 +0200</pubDate>
<link>https://kambi.teamtailor.com/jobs/1-linux</link><remoteStatus>hybrid</remoteStatus><guid>g1</guid>
<tt:locations><tt:location><tt:city>Stockholm</tt:city><tt:country>Sweden</tt:country></tt:location>
<tt:location><tt:city>Uppsala</tt:city><tt:country>Sweden</tt:country></tt:location></tt:locations></item>
<item><title>Junior QA</title><link>https://kambi.teamtailor.com/jobs/2-qa</link><guid>g2</guid>
<tt:locations><tt:location><tt:city>Malta</tt:city><tt:country>Malta</tt:country></tt:location></tt:locations></item>
</channel></rss>"""


def test_teamtailor_is_read_from_the_open_positions_feed_of_the_company():
    asked = []
    result = ab.search("teamtailor", "kambi", "se", fetcher=lambda url: (asked.append(url), (200, TEAMTAILOR))[1], data=TABLE)
    assert asked == ["https://kambi.teamtailor.com/jobs.rss"]
    assert [h["title"] for h in result["hits"]] == ["Linux Platform Engineer - Stockholm / Uppsala"]
    assert result["hits"][0]["location"] == "Stockholm, Sweden; Uppsala, Sweden" and result["counts"]["dropped_country"] == 1


def test_a_feed_with_a_dtd_is_not_parsed():
    bomb = b'<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol">]><rss><channel><item><title>&lol;</title></item></channel></rss>'
    result = ab.search("teamtailor", "kambi", "se", fetcher=answer(bomb), data=TABLE)
    assert (result["ok"], result["status"]) == (False, "closed") and result["hits"] == []


@pytest.mark.parametrize("encode", [
    lambda s: s.encode("utf-16"), lambda s: s.encode("utf-16-le"), lambda s: s.encode("utf-16-be"),
    lambda s: b"\xef\xbb\xbf" + s.encode("utf-8"), lambda s: s.encode("utf-8").replace(b"<rss", b"\x00<rss"),
])
def test_a_feed_that_hides_its_dtd_behind_a_bom_or_utf16_is_refused_before_the_parser(encode):
    """Security review: a UTF-16 feed with a DOCTYPE and entities slipped past the check on ASCII bytes and was expanded."""
    feed = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;&a;">]><rss><channel><item><title>&b;</title></item></channel></rss>'
    result = ab.search("teamtailor", "kambi", "se", fetcher=answer(encode(feed)), data=TABLE)
    assert (result["ok"], result["status"], result["hits"]) == (False, "closed", [])


def test_plain_ascii_and_blank_before_the_declaration_are_still_read():
    assert ab.search("teamtailor", "kambi", "se", fetcher=answer(b"\n  " + TEAMTAILOR), data=TABLE)["counts"]["in_country"] == 1


@pytest.mark.parametrize("url", [
    "https://127.0.0.1/jobs", "https://10.0.0.5/jobs", "https://[::1]/jobs", "https://localhost/jobs", "https://intranet/jobs",
    "https://kambi.localhost/jobs", "https://jobs.example.local/jobs", "https://kambi.teamtailor.com:8443/jobs",
    "https://user:pw" + "@" + "kambi.teamtailor.com/jobs", "https://192.0.2.1.5/jobs", "https://kambi.teamtailor.com./jobs", "https://-bad.teamtailor.com/jobs",
])
def test_a_teamtailor_address_that_is_not_a_public_domain_name_is_refused(url):
    """Security review: the table may one day carry a wrong address; an IP literal, a local name or another port is not asked."""
    data = {"se": {"teamtailor": {"url": "{url}", "urls": {"kambi": url}}}}
    with pytest.raises(ab.Refused):
        ab.url_for("teamtailor", "kambi", data)


@pytest.mark.parametrize("url", ["https://career.hemnet.se/jobs", "https://careers.tobii.com/jobs", "https://jobs.bokio.se/jobs", "https://xn--jobb-5qa.example.se/jobs"])
def test_the_companys_own_domains_of_the_table_are_accepted(url):
    data = {"se": {"teamtailor": {"url": "{url}", "urls": {"kambi": url}}}}
    assert ab.url_for("teamtailor", "kambi", data) == url + ".rss"


@pytest.mark.parametrize("http,status", [(403, "closed"), (429, "closed"), (401, "closed"), (404, "gone"), (410, "gone"), (500, "closed"), (0, "closed")])
def test_a_board_that_does_not_answer_is_closed_or_gone_for_the_pass_and_nothing_is_retried(http, status):
    calls = []
    result = ab.search("greenhouse", "wolt", "se", fetcher=lambda url: (calls.append(url), (http, b""))[1], data=TABLE)
    assert (result["ok"], result["status"], result["http"]) == (False, status, http) and len(calls) == 1
    assert result["counts"]["returned"] == 0 and result["hits"] == []


def test_an_answer_that_is_not_a_board_is_closed():
    for body in (b"<html>captcha</html>", b"[]", b'{"jobs": "x"}', b""):
        assert ab.search("greenhouse", "wolt", "se", fetcher=answer(body), data=TABLE)["status"] in ("closed", "empty")
    assert ab.search("greenhouse", "wolt", "se", fetcher=answer(b"<html>captcha</html>"), data=TABLE)["status"] == "closed"


def test_an_empty_board_is_empty_not_closed():
    result = ab.search("greenhouse", "wolt", "se", fetcher=answer(gh()), data=TABLE)
    assert (result["ok"], result["status"]) == (True, "empty")


@pytest.mark.parametrize("kwargs", [
    {"provider": "workable", "board": "wolt", "country": "se"},
    {"provider": "greenhouse", "board": "not-in-the-table", "country": "se"},
    {"provider": "greenhouse", "board": "../etc", "country": "se"},
    {"provider": "greenhouse", "board": "wolt?x=1", "country": "se"},
    {"provider": "lever", "board": "wolt", "country": "se"},                      # a Greenhouse board asked as Lever
    {"provider": "greenhouse", "board": "wolt", "country": "xx"},
    {"provider": "greenhouse", "board": "wolt", "country": "swe"},
    {"provider": "greenhouse", "board": "wolt", "country": "se", "drop_seniority": ["boss"]},
    {"provider": "greenhouse", "board": "wolt", "country": "se", "title_any": ["w"] * 9},
    {"provider": "greenhouse", "board": "wolt", "country": "se", "title_any": ["x" * 41]},
])
def test_a_value_outside_the_closed_lists_is_refused_before_anything_is_sent(kwargs):
    def never(url):
        raise AssertionError("nothing may be sent")
    with pytest.raises(ab.Refused):
        ab.search(fetcher=never, data=TABLE, **kwargs)


def test_the_address_comes_from_the_table_and_only_on_the_known_host():
    assert ab.url_for("greenhouse", "wolt", TABLE) == "https://boards-api.greenhouse.io/v1/boards/wolt/jobs"
    assert ab.url_for("lever", "spotify", TABLE) == "https://api.lever.co/v0/postings/spotify?mode=json"
    assert ab.url_for("teamtailor", "anyfin", TABLE) == "https://career.anyfin.com/jobs.rss"
    bad = {"se": {"greenhouse": {"url": "https://evil.example/{slug}", "slugs": ["wolt"]}}}
    with pytest.raises(ab.Refused):
        ab.url_for("greenhouse", "wolt", bad)
    plain = {"se": {"teamtailor": {"url": "{url}", "urls": {"kambi": "http://kambi.teamtailor.com/jobs"}}}}
    with pytest.raises(ab.Refused):
        ab.url_for("teamtailor", "kambi", plain)


def test_texts_from_the_board_are_cut_and_cleaned():
    body = gh(("Marketing\x00Coordinator " + "x" * 500, "Stockholm\x1b[31m"))
    hit = ab.search("greenhouse", "wolt", "se", fetcher=answer(body), data=TABLE)["hits"][0]
    assert "\x00" not in hit["title"] and len(hit["title"]) == ab.FIELD and "\x1b" not in hit["location"]


def test_every_board_of_the_real_table_has_an_address_the_tool_accepts():
    boards = ab.table()
    assert boards, "the table has no ats_boards"
    for provider in ab.PROVIDERS:
        known = ab.known_boards(provider)
        assert known, provider
        for slug in known:
            assert ab.url_for(provider, slug).startswith("https://")


def _run(*argv, home):
    env = {"PATH": "/usr/bin:/bin", "JHT_HOME": str(home), "JHT_AGENT_NAME": "scout-1", "PYTHONDONTWRITEBYTECODE": "1"}
    return subprocess.run([sys.executable, "-I", str(SKILLS / "ats_board_search.py"), *argv], capture_output=True, text=True, timeout=60, env=env)


def test_the_command_refuses_with_exit_2_and_a_clean_message(tmp_path):
    done = _run("--provider", "greenhouse", "--board", "nope", "--country", "se", home=tmp_path)
    assert done.returncode == 2 and "refused" in done.stderr and done.stdout == ""


def test_the_pass_is_written_to_the_log_with_the_status_the_board_gave(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_AGENT_NAME", "scout-1")
    monkeypatch.setattr(ab, "fetch", answer(gh(("Junior Producer", "Stockholm"), ("Plumber", "Oslo, Norway"))))
    monkeypatch.setattr(ab, "table", lambda: TABLE)
    assert ab.main(["--provider", "greenhouse", "--board", "wolt", "--country", "se", "--log", "--query-kind", "broad", "--title-any", "junior"]) == 0
    monkeypatch.setattr(ab, "fetch", answer(b"", 403))
    assert ab.main(["--provider", "greenhouse", "--board", "wolt", "--country", "se", "--log"]) == 3
    lines = [json.loads(l) for l in (tmp_path / "logs" / "scout-passes.jsonl").read_text().splitlines()]
    passes = [l for l in lines if l["kind"] == "pass"]
    assert [(l["source"], l["country"], l["returned"], l["query_kind"], l.get("status")) for l in passes] == [
        ("greenhouse", "se", 2, "broad", None), ("greenhouse", "se", 0, "other", "closed")]       # what the board GAVE: all its ads
    assert "query_hash" in passes[0]
    assert [(l["outcome"], l["count"]) for l in lines if l["kind"] == "candidate"] == [("area", 1)]


def test_every_ad_read_is_accounted_for_by_a_reason_or_left_for_the_scout_to_log(tmp_path, monkeypatch):
    """Field data of 02/11: 1080 ads read on a portal, 3 counted. Here the tool itself says why it left the others out, in ONE
    line per reason, and what is still unexplained in the report is exactly the ads handed back to the Scout."""
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_AGENT_NAME", "scout-1")
    jobs = ([("Marketing Coordinator %d" % i, "Stockholm") for i in range(3)] + [("Senior Engineer %d" % i, "Sweden") for i in range(5)] +
            [("Barista %d" % i, "Stockholm, Sweden") for i in range(4)] + [("Sales %d" % i, "London, UK") for i in range(10)] + [("Anywhere", "Remote")])
    monkeypatch.setattr(ab, "fetch", answer(gh(*jobs)))
    monkeypatch.setattr(ab, "table", lambda: TABLE)
    assert ab.main(["--provider", "greenhouse", "--board", "wolt", "--country", "se", "--log", "--title-any", "coordinator,engineer",
                    "--drop-seniority", "senior"]) == 0
    lines = [json.loads(l) for l in (tmp_path / "logs" / "scout-passes.jsonl").read_text().splitlines()]
    assert {l["outcome"]: l["count"] for l in lines if l["kind"] == "candidate"} == {"area": 11, "role": 4, "seniority": 5}
    assert all("opened" in l and l["opened"] is False for l in lines if l["kind"] == "candidate")
    env = {"PATH": "/usr/bin:/bin", "JHT_HOME": str(tmp_path), "PYTHONDONTWRITEBYTECODE": "1"}
    done = subprocess.run([sys.executable, "-I", str(SKILLS / "scout_pass_report.py"), "--json", "--no-tokens"], env=env, capture_output=True,
                          text=True, timeout=60)
    assert done.returncode == 0, done.stderr
    (group,) = json.loads(done.stdout)["summary"]
    assert group["returned"] == 23 and group["unexplained"] == 3                    # the 3 coordinators the Scout still has to log
    assert group["dropped"]["area"] == 11 and group["dropped"]["role"] == 4 and group["dropped"]["seniority"] == 5


def test_a_pass_without_ads_left_out_writes_no_candidate_line(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_AGENT_NAME", "scout-1")
    monkeypatch.setattr(ab, "fetch", answer(gh(("Marketing Coordinator", "Stockholm"))))
    monkeypatch.setattr(ab, "table", lambda: TABLE)
    assert ab.main(["--provider", "greenhouse", "--board", "wolt", "--country", "se", "--log"]) == 0
    lines = [json.loads(l) for l in (tmp_path / "logs" / "scout-passes.jsonl").read_text().splitlines()]
    assert [l["kind"] for l in lines] == ["pass"]
