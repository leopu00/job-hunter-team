"""LinkedIn answers 429: backoff with Retry-After, a cap of requests per window, a cooldown shared by every call, and an
explicit `rate_limited` outcome for the scout (shared/skills/linkedin_access.py). A fake server answers 429.

Before: in `search` any non-200 was a silent `break` (a 429 looked like «no more results», 8 results then nothing), in
`fetch-job` a 429 was `{status: 429, blocked: true}` with no wait and no retry, and nothing remembered it: every pass
of the scout started again and insisted.
"""
import json
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import linkedin_access as la  # noqa: E402

PAGE = "".join('<li><div class="base-card" data-entity-urn="urn:li:jobPosting:%d"><h3>Role %d</h3></div></li>' % (i, i)
               for i in range(1, 4))


class _Server:
    """Answers from a script: a list of (status, headers, body) per path prefix; the last entry repeats."""

    def __init__(self):
        self.script = {}
        self.hits = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):  # noqa: N802
                outer.hits.append(self.path)
                key = "search" if "seeMoreJobPostings" in self.path else "job"
                queue = outer.script.get(key) or [(200, {}, "")]
                status, headers, body = queue.pop(0) if len(queue) > 1 else queue[0]
                self.send_response(status)
                for name, value in headers.items():
                    self.send_header(name, value)
                self.send_header("Content-Type", "text/html")
                data = body.encode()
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def log_message(self, *args):
                pass

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.httpd.server_port}"
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def close(self):
        self.httpd.shutdown()
        self.httpd.server_close()


@pytest.fixture()
def linkedin(tmp_path, monkeypatch):
    server = _Server()
    sleeps = []
    monkeypatch.setattr(la, "RATE_STATE", tmp_path / "state" / "linkedin-rate.json")
    monkeypatch.setattr(la, "GUEST_SEARCH", server.url + "/jobs-guest/jobs/api/seeMoreJobPostings/search")
    monkeypatch.setattr(la, "public_url", lambda job_id: f"{server.url}/jobs/view/{job_id}")
    monkeypatch.setattr(la.time, "sleep", lambda seconds: sleeps.append(seconds))
    monkeypatch.setattr(la.random, "uniform", lambda a, b: 0.0)
    server.sleeps = sleeps
    yield server
    server.close()


def _state():
    return json.loads(la.RATE_STATE.read_text(encoding="utf-8"))


def test_a_429_with_retry_after_waits_that_long_and_the_second_try_goes_through(linkedin):
    pytest.importorskip("bs4"); pytest.importorskip("lxml")
    linkedin.script["search"] = [(429, {"Retry-After": "3"}, ""), (200, {}, PAGE)]
    results, limited = la.search_ex("python", "NL", limit=3)
    assert limited is None and [r["job_id"] for r in results] == ["1", "2", "3"]
    assert linkedin.sleeps[0] == 3.0                     # Retry-After, not a guess (the next one is the courtesy pause between pages)
    assert len(linkedin.hits) == 2


def test_without_retry_after_the_backoff_doubles_then_a_cooldown_starts(linkedin):
    linkedin.script["search"] = [(429, {}, "")]
    results, limited = la.search_ex("python", "NL")
    assert results == [] and limited["rate_limited"] is True and limited["reason"] == "http_429"
    assert linkedin.sleeps == [la.BASE_BACKOFF_S, la.BASE_BACKOFF_S * 2]
    assert len(linkedin.hits) == la.MAX_RETRIES + 1
    assert limited["retry_after_s"] == int(la.COOLDOWN_BASE_S) and limited["retry_at"].endswith("Z")
    assert _state()["cooldown_until"] > 0


def test_during_the_cooldown_linkedin_is_not_called_at_all(linkedin):
    linkedin.script["search"] = [(429, {}, "")]
    la.search_ex("python", "NL")
    before = len(linkedin.hits)
    results, limited = la.search_ex("java", "NL")
    job = la.fetch_job("12345")
    assert results == [] and limited["reason"] == "cooldown" and limited["rate_limited"] is True
    assert job["rate_limited"] is True and job["reason"] == "cooldown" and job["status"] == 429
    assert len(linkedin.hits) == before


def test_a_long_retry_after_is_not_waited_inside_the_call(linkedin):
    linkedin.script["job"] = [(429, {"Retry-After": "120"}, "")]
    job = la.fetch_job("777")
    assert linkedin.sleeps == [] and len(linkedin.hits) == 1
    assert job["rate_limited"] is True and job["reason"] == "http_429" and "blocked" not in job
    assert job["retry_after_s"] >= 120      # the cooldown is at least what LinkedIn asked for (the base is 300)


def test_retry_after_as_an_http_date(linkedin):
    now = datetime.now(timezone.utc).timestamp()
    seconds = la.parse_retry_after("Wed, 21 Oct 2037 07:28:00 GMT", now=datetime(2037, 10, 21, 7, 27, 0, tzinfo=timezone.utc).timestamp())
    assert seconds == 60.0
    assert la.parse_retry_after("17") == 17.0 and la.parse_retry_after("") is None and la.parse_retry_after(None) is None
    assert la.parse_retry_after("soon") is None and la.parse_retry_after("-5") == 0.0
    assert la.parse_retry_after("999999999") == la.RETRY_AFTER_MAX_S and now > 0


def test_the_cap_of_requests_per_window_stops_before_linkedin_does(linkedin, monkeypatch):
    monkeypatch.setattr(la, "MAX_REQUESTS", 3)
    linkedin.script["job"] = [(200, {}, "<html><title>x</title></html>")]
    pytest.importorskip("bs4"); pytest.importorskip("lxml")
    for i in range(3):
        assert not la.fetch_job(str(1000 + i)).get("rate_limited")
    fourth = la.fetch_job("2000")
    assert fourth["rate_limited"] is True and fourth["reason"] == "request_cap"
    assert 1 <= fourth["retry_after_s"] <= la.WINDOW_S
    assert len(linkedin.hits) == 3                       # the fourth never left


def test_the_cap_window_slides(linkedin, monkeypatch):
    monkeypatch.setattr(la, "MAX_REQUESTS", 2)
    la.RATE_STATE.parent.mkdir(parents=True)
    old = datetime.now(timezone.utc).timestamp() - la.WINDOW_S - 5
    la.RATE_STATE.write_text(json.dumps({"requests": [old, old + 1]}), encoding="utf-8")
    pytest.importorskip("bs4"); pytest.importorskip("lxml")
    linkedin.script["job"] = [(200, {}, "<html><title>x</title></html>")]
    assert not la.fetch_job("1").get("rate_limited") and not la.fetch_job("2").get("rate_limited")
    assert la.fetch_job("3")["reason"] == "request_cap"


def test_results_already_collected_survive_a_429_on_the_next_page(linkedin):
    pytest.importorskip("bs4"); pytest.importorskip("lxml")
    linkedin.script["search"] = [(200, {}, PAGE), (429, {"Retry-After": "600"}, "")]
    results, limited = la.search_ex("python", "NL", limit=25)
    assert [r["job_id"] for r in results] == ["1", "2", "3"] and limited["reason"] == "http_429"
    assert la.search("python", "NL", limit=25) == []     # the plain `search` still returns a list (cooldown now)


def test_999_is_treated_like_a_429(linkedin):
    linkedin.script["job"] = [(999, {}, "")]
    job = la.fetch_job("55")
    assert job["rate_limited"] is True


def test_the_cooldown_grows_when_it_happens_again_and_a_success_resets_it(linkedin, monkeypatch):
    linkedin.script["job"] = [(429, {"Retry-After": "600"}, "")]
    first = la.fetch_job("1")
    assert first["retry_after_s"] == 600           # max(Retry-After 600, base 300)
    state = _state(); state["cooldown_until"] = 0; la.RATE_STATE.write_text(json.dumps(state), encoding="utf-8")
    linkedin.script["job"] = [(429, {}, "")]
    second = la.fetch_job("2")
    assert second["retry_after_s"] == int(la.COOLDOWN_BASE_S * 2)
    assert _state()["strikes"] == 2
    state = _state(); state["cooldown_until"] = 0; la.RATE_STATE.write_text(json.dumps(state), encoding="utf-8")
    pytest.importorskip("bs4"); pytest.importorskip("lxml")
    linkedin.script["job"] = [(200, {}, "<html><title>x</title></html>")]
    assert not la.fetch_job("3").get("rate_limited")
    assert _state()["strikes"] == 0 and _state()["cooldown_until"] == 0


def test_another_error_is_not_a_rate_limit(linkedin):
    linkedin.script["job"] = [(403, {}, "")]
    job = la.fetch_job("9")
    assert job == {"job_id": "9", "url": f"{linkedin.url}/jobs/view/9", "status": 403, "blocked": True}
    assert not la.RATE_STATE.exists() or not _state().get("cooldown_until")


def test_the_command_line_says_it_in_the_last_line_and_the_exit_code(linkedin, capsys):
    pytest.importorskip("bs4"); pytest.importorskip("lxml")
    linkedin.script["search"] = [(200, {}, PAGE), (429, {"Retry-After": "600"}, "")]
    code = la.main(["search", "--keywords", "python", "--location", "NL", "--limit", "25"])
    lines = [json.loads(line) for line in capsys.readouterr().out.strip().splitlines()]
    assert code == la.RATE_LIMITED_EXIT == 3
    assert [x["job_id"] for x in lines[:-1]] == ["1", "2", "3"] and lines[-1]["rate_limited"] is True
    assert lines[-1]["retry_after_s"] >= 600
    code = la.main(["fetch-job", "12345"])
    out = json.loads(capsys.readouterr().out)
    assert code == 3 and out["rate_limited"] is True and out["reason"] == "cooldown"


def test_a_corrupt_state_file_is_the_old_behaviour_not_a_crash(linkedin):
    la.RATE_STATE.parent.mkdir(parents=True)
    la.RATE_STATE.write_text("not json", encoding="utf-8")
    linkedin.script["job"] = [(404, {}, "")]
    assert la.fetch_job("5")["status"] == 404


@pytest.mark.parametrize("raw", [
    '{"cooldown_until": Infinity}',
    '{"cooldown_until": 32503680000}',                       # a year 3000
    '{"cooldown_until": "x", "strikes": "x", "last_429": "y"}',
    '{"strikes": NaN, "last_429": Infinity, "requests": [Infinity, "z", 1]}',
    '{"requests": "no", "strikes": 1e999}',
])
def test_a_state_with_absurd_values_does_not_stop_the_scout_nor_hide_a_429(linkedin, raw):
    la.RATE_STATE.parent.mkdir(parents=True)
    la.RATE_STATE.write_text(raw, encoding="utf-8")
    linkedin.script["job"] = [(200, {}, "<html></html>")]
    assert la.fetch_job("5").get("rate_limited") is not True, "an absurd cooldown is dropped, not obeyed"
    linkedin.script["job"] = [(429, {}, "")] * 3
    out = la.fetch_job("6")
    assert out["rate_limited"] is True and out["reason"] == "http_429" and 1 <= out["retry_after_s"] <= la.COOLDOWN_MAX_S


@pytest.mark.parametrize("value,expected", [("abc", 7.0), ("", 7.0), ("nan", 7.0), ("inf", 7.0), ("-3", 7.0), ("12", 12.0)])
def test_the_limits_from_the_environment_never_crash_the_import(monkeypatch, value, expected):
    monkeypatch.setenv("JHT_LINKEDIN_TEST_VALUE", value)
    assert la._env_number("JHT_LINKEDIN_TEST_VALUE", 7.0) == expected
