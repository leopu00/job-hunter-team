"""platsbanken_search.py: Platsbanken through the public JobTech API.

The portal is third-party: what is tested is that nothing but a closed set of parameters reaches the URL, that no redirect
is followed and nothing retried, that a hostile ad cannot make the output large or carry anything but the fixed fields, and
that the answer maps to the words of the pass log. No test touches the network: a local server stands in for the portal.
"""
import http.server
import importlib.util
import json
import sys
import threading
import time
import urllib.parse
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS = REPO_ROOT / "shared" / "skills"
sys.path.insert(0, str(SKILLS))


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ps = _load("platsbanken_search_under_test", SKILLS / "platsbanken_search.py")

AD = {"id": "31674256", "headline": "Junior Frontend Utvecklare", "employer": {"name": "Example AB", "workplace": "Distans", "email": "x@example.com"},
      "workplace_address": {"municipality": "Stockholm", "region": "Stockholms län", "street_address": "Storgatan 1"},
      "working_hours_type": {"label": "Heltid"}, "publication_date": "2026-11-02T14:49:20", "application_deadline": "2026-12-02T23:59:59",
      "experience_required": False, "webpage_url": "https://arbetsformedlingen.se/platsbanken/annonser/31674256",
      "application_details": {"url": "https://example.com/careers", "email": "jobs@example.com"},
      "must_have": {"languages": [{"label": "Svenska"}, {"label": "Engelska"}]}, "nice_to_have": {"languages": []},
      "description": {"text": "Vi söker en junior utvecklare. " * 100}, "salary_description": "secret", "logo_url": "https://example.com/logo.png"}


def _answer(*ads):
    return json.dumps({"total": {"value": len(ads)}, "hits": list(ads)}).encode()


def _query(url):
    return urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)


# ── the URL ──────────────────────────────────────────────────────────────────────────────────────────────────────────
def test_the_url_carries_the_closed_parameters_and_all_words_must_match_by_default():
    url = ps.url_for(q="junior utvecklare", city="stockholm", no_experience=True, trainee=True, remote=True, published_minutes=1440, limit=100)
    assert url.startswith(ps.BASE + "?")
    q = _query(url)
    assert q["q"] == ["junior utvecklare"] and q["x-feature-freetext-bool-method"] == ["and"]
    assert q["municipality"] == ["AvNB_uwa_6n6"] and q["experience"] == ["false"] and q["trainee"] == ["true"] and q["remote"] == ["true"]
    assert q["published-after"] == ["1440"] and q["limit"] == ["100"] and q["sort"] == ["pubdate-desc"]
    assert "x-feature-freetext-bool-method" not in _query(ps.url_for(q="a", any_word=True))
    assert _query(ps.url_for(city="uppsala"))["region"] == ["zBon_eET_fFU"]


def test_a_query_cannot_add_parameters_to_the_call():
    q = _query(ps.url_for(q="x&limit=1000&offset=99999#frag"))
    assert q["limit"] == ["50"] and q["offset"] == ["0"] and "frag" not in q
    assert q["q"] == ["x&limit=1000&offset=99999#frag"]


@pytest.mark.parametrize("kwargs", [
    {"q": "x" * 101}, {"q": "bad\x00text"}, {"q": "esc\x1b[31m"}, {"city": "atlantis"}, {"city": "../../etc"},
    {"limit": 0}, {"limit": 101}, {"limit": True}, {"limit": "5"}, {"offset": -1}, {"offset": 2001},
    {"published_minutes": ps.MAX_MINUTES + 1}, {"published_minutes": -5}, {"sort": "random"}])
def test_a_value_outside_the_closed_lists_is_refused_before_anything_is_sent(kwargs):
    with pytest.raises(ps.Refused):
        ps.url_for(**kwargs)


def test_only_the_jobsearch_api_is_ever_asked():
    with pytest.raises(ps.Refused):
        ps.fetch("https://evil.example/search?q=x")
    with pytest.raises(ps.Refused):
        ps.fetch(ps.BASE.replace("jobsearch.api.jobtechdev.se", "evil.example") + "?q=x")


# ── the answer ───────────────────────────────────────────────────────────────────────────────────────────────────────
def test_an_ad_is_cut_to_the_fixed_fields_and_nothing_else_leaves():
    result = ps.parse(200, _answer(AD))
    assert result["ok"] and result["status"] == "ok" and result["returned"] == 1 and result["total"] == 1
    hit = result["hits"][0]
    assert set(hit) == {"id", "headline", "employer", "url", "apply_url", "municipality", "region", "published", "deadline",
                        "experience_required", "working_hours", "languages_required", "languages_nice", "remote_hint", "snippet"}
    assert hit["languages_required"] == ["Svenska", "Engelska"] and hit["experience_required"] is False
    assert len(hit["snippet"]) == ps.SNIPPET
    flat = json.dumps(result)
    for private in ("x@example.com", "jobs@example.com", "Storgatan", "secret", "logo_url"):
        assert private not in flat


def test_a_hostile_ad_cannot_make_the_output_big_or_carry_control_characters_or_a_script_link():
    hostile = dict(AD, headline="A" * 200_000 + "\x00\x1b[31m", employer={"name": "E\x07" * 5000},
                   webpage_url="javascript:alert(1)", application_details={"url": "file:///etc/passwd"},
                   must_have={"languages": [{"label": "L" * 5000}] * 100}, description={"text": "\x00" * 100000})
    result = ps.parse(200, _answer(hostile))
    hit = result["hits"][0]
    assert len(hit["headline"]) == ps.FIELD and len(hit["employer"]) == ps.FIELD
    assert hit["url"] is None and hit["apply_url"] is None
    assert len(hit["languages_required"]) == 10 and all(len(x) <= 60 for x in hit["languages_required"])
    assert not any(c in value for value in (hit["headline"], hit["employer"], hit["snippet"]) for c in "\x00\x07\x1b")
    assert hit["headline"] == "A" * ps.FIELD and hit["employer"].replace(" ", "").replace("E", "") == ""
    assert len(json.dumps(result)) < 5000


def test_wrong_types_in_an_ad_are_read_not_raised():
    for weird in (None, 5, "text", [], {"employer": "x", "workplace_address": 3, "must_have": [], "description": "no"}):
        ps.shape(weird)
    assert ps.parse(200, b'{"hits": "nope", "total": 7}')["status"] == "empty"
    assert ps.parse(200, b'not json')["status"] == "closed"
    assert ps.parse(200, json.dumps({"hits": [AD] * 300}).encode())["returned"] == 100


@pytest.mark.parametrize("http,word", [(403, "closed"), (429, "closed"), (401, "closed"), (410, "gone"), (500, "closed"), (0, "closed"), (302, "closed")])
def test_what_the_portal_says_maps_to_the_words_of_the_pass_log(http, word):
    result = ps.parse(http, b"")
    assert (result["ok"], result["status"], result["returned"]) == (False, word, 0)
    assert word in ("closed", "gone")


def test_no_ads_is_empty_and_it_is_still_an_answer():
    assert ps.parse(200, _answer()) == {"ok": True, "status": "empty", "http": 200, "total": 0, "returned": 0, "hits": []}


# ── the real transport, against a local server standing in for the portal ────────────────────────────────────────────
class _Portal:
    def __init__(self, behaviour):
        self.hits = 0
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                outer.hits += 1
                behaviour(self)

            def log_message(self, *a):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d/search" % self.server.server_address[1]

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def portal(monkeypatch):
    made = []

    def make(behaviour):
        p = _Portal(behaviour)
        made.append(p)
        monkeypatch.setattr(ps, "BASE", p.base)
        return p
    yield make
    for p in made:
        p.close()


def _reply(code, body=b"", headers=()):
    def behave(h):
        h.send_response(code)
        for k, v in headers:
            h.send_header(k, v)
        h.send_header("Content-Length", str(len(body)))
        h.end_headers()
        h.wfile.write(body)
    return behave


def test_a_normal_answer_goes_through_one_request(portal):
    p = portal(_reply(200, _answer(AD), [("Content-Type", "application/json")]))
    result = ps.search(q="junior")
    assert result["ok"] and result["returned"] == 1 and p.hits == 1


def test_a_redirect_is_an_answer_not_a_road_and_nothing_is_retried(portal):
    other = portal(_reply(200, _answer(AD)))
    target = other.base
    p = portal(_reply(302, b"", [("Location", target + "?q=elsewhere")]))
    result = ps.search(q="junior")
    assert result["status"] == "closed" and result["http"] == 302
    assert p.hits == 1 and other.hits == 0


@pytest.mark.parametrize("code,word", [(403, "closed"), (429, "closed"), (410, "gone")])
def test_a_refusal_is_reported_once_and_not_retried(portal, code, word):
    p = portal(_reply(code))
    result = ps.search(q="junior")
    assert result["status"] == word and p.hits == 1


def test_a_portal_that_never_answers_is_closed_after_the_timeout(portal, monkeypatch):
    monkeypatch.setattr(ps, "TIMEOUT_S", 0.5)
    release = threading.Event()
    p = portal(lambda h: release.wait(5))
    started = time.time()
    result = ps.search(q="junior")
    release.set()
    assert result["status"] == "closed" and result["http"] == 0 and time.time() - started < 3 and p.hits == 1


def test_a_huge_answer_is_not_read_past_the_cap(portal, monkeypatch):
    monkeypatch.setattr(ps, "MAX_BYTES", 2000)
    portal(_reply(200, b"[" + b"1," * 5000 + b"1]"))
    assert ps.search(q="junior")["status"] == "closed"


# ── the command ──────────────────────────────────────────────────────────────────────────────────────────────────────
def _lines(home):
    path = home / "logs" / "scout-passes.jsonl"
    return [json.loads(l) for l in path.read_text().splitlines()] if path.exists() else []


def test_the_command_logs_the_pass_with_the_status_and_exits_3_when_the_portal_is_closed(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_AGENT_NAME", "scout-1")
    answers = iter([(200, _answer(AD, AD)), (403, b""), (410, b"")])
    real = ps.search
    monkeypatch.setattr(ps, "search", lambda **kw: real(fetcher=lambda url: next(answers), **kw))
    assert ps.main(["--q", "junior utvecklare", "--city", "malmo", "--query-kind", "role_language", "--log"]) == 0
    assert json.loads(capsys.readouterr().out)["returned"] == 2
    assert ps.main(["--q", "developer", "--query-kind", "role", "--log"]) == 3
    assert ps.main(["--q", "developer", "--query-kind", "synonym", "--log"]) == 3
    ok, closed, gone = _lines(tmp_path)
    assert (ok["source"], ok["country"], ok["returned"], ok["query_kind"], "status" in ok) == ("arbetsformedlingen", "se", 2, "role_language", False)
    assert (closed["status"], closed["returned"], gone["status"]) == ("closed", 0, "gone")
    assert ok["query_hash"] != closed["query_hash"]
    assert "junior utvecklare" not in json.dumps(_lines(tmp_path))


def test_the_command_refuses_a_bad_parameter_without_sending_or_logging(tmp_path, monkeypatch, capsys):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(ps, "fetch", lambda url: (_ for _ in ()).throw(AssertionError("must not be sent")))
    assert ps.main(["--q", "x", "--city", "atlantis", "--log"]) == 2
    assert ps.main(["--q", "x", "--limit", "500", "--log"]) == 2
    assert not _lines(tmp_path)
