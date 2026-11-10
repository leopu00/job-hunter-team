"""One request cap and one growing pause PER SOURCE, shared by every Scout (shared/skills/source_rate.py).

Before: only LinkedIn had a cap and a pause; every other source was asked by each of the five Scouts on its own, and a 403
or a 429 from a site was remembered by nobody. Fake sources, fake clock, fake answers: no network, no real portal.
"""
import json
import subprocess
import sys
from pathlib import Path

import pytest

SKILLS = Path(__file__).resolve().parent.parent / "shared" / "skills"
sys.path.insert(0, str(SKILLS))
import source_rate as sr  # noqa: E402


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    for name in ("JHT_SOURCE_MAX_REQUESTS", "JHT_SOURCE_WINDOW_S", "JHT_SOURCE_COOLDOWN_BASE_S", "JHT_SOURCE_COOLDOWN_MAX_S"):
        monkeypatch.delenv(name, raising=False)
    return tmp_path


NOW = 1_800_000_000.0


def test_the_cap_is_per_source_and_counts_every_scout_together(monkeypatch):
    monkeypatch.setenv("JHT_SOURCE_MAX_REQUESTS", "3")
    # three calls from «different Scouts» (same state file) fill the window of one source…
    assert [sr.gate("jobs.example.org", NOW + i) for i in range(3)] == [None, None, None]
    refused = sr.gate("jobs.example.org", NOW + 3)
    assert refused["rate_limited"] and refused["reason"] == "request_cap" and refused["source"] == "jobs.example.org"
    assert refused["retry_after_s"] == 597          # the oldest request leaves the 600 s window at NOW + 600
    # …and another source is not touched
    assert sr.gate("other.example.org", NOW + 3) is None
    # when the oldest request leaves the window the source is asked again
    assert sr.gate("jobs.example.org", NOW + 601) is None


def test_the_names_of_a_source_are_the_same_with_or_without_www_and_case(monkeypatch):
    monkeypatch.setenv("JHT_SOURCE_MAX_REQUESTS", "1")
    assert sr.gate("WWW.Jobs.Example.org", NOW) is None
    assert sr.gate("jobs.example.org", NOW + 1)["reason"] == "request_cap"


@pytest.mark.parametrize("status", [403, 429, 503])
def test_a_403_429_or_503_suspends_the_source_for_everyone_with_a_growing_pause(status):
    first = sr.note_hit("jobs.example.org", status, now=NOW)
    assert first["reason"] == "http_%d" % status and first["retry_after_s"] == 300
    assert sr.gate("jobs.example.org", NOW + 10)["reason"] == "cooldown"
    assert sr.gate("other.example.org", NOW + 10) is None
    # it keeps answering that way after the pause: 10 minutes, then 20, then 40
    assert sr.note_hit("jobs.example.org", status, now=NOW + 400)["retry_after_s"] == 600
    assert sr.note_hit("jobs.example.org", status, now=NOW + 1100)["retry_after_s"] == 1200
    assert sr.note_hit("jobs.example.org", status, now=NOW + 2400)["retry_after_s"] == 2400


def test_the_pause_never_goes_past_the_maximum_and_retry_after_wins_when_longer(monkeypatch):
    monkeypatch.setenv("JHT_SOURCE_COOLDOWN_MAX_S", "1000")
    t = NOW
    waits = []
    for _ in range(6):
        waits.append(sr.note_hit("a.example.org", 429, now=t)["retry_after_s"])
        t += 5000
    assert waits == [300, 600, 1000, 1000, 1000, 1000]
    assert sr.note_hit("b.example.org", 429, retry_after=7200, now=NOW)["retry_after_s"] == 7200


def test_a_200_ends_the_pause_and_six_quiet_hours_reset_the_count():
    sr.note_hit("jobs.example.org", 403, now=NOW)
    sr.note_hit("jobs.example.org", 403, now=NOW + 400)
    sr.note_success("jobs.example.org", now=NOW + 1100)
    assert sr.gate("jobs.example.org", NOW + 1101) is None
    assert sr.note_hit("jobs.example.org", 403, now=NOW + 1200)["retry_after_s"] == 300      # the count started again
    assert sr.note_hit("jobs.example.org", 403, now=NOW + 1500)["retry_after_s"] == 600
    assert sr.note_hit("jobs.example.org", 403, now=NOW + 1500 + 7 * 3600)["retry_after_s"] == 300   # quiet for 7 h


def test_two_processes_see_the_same_state():
    code = ("import sys; sys.path.insert(0, %r); import source_rate as s; "
            "print(s.note_hit('jobs.example.org', 429)['retry_after_s'])") % str(SKILLS)
    out = subprocess.run([sys.executable, "-I", "-c", code], capture_output=True, text=True,
                         env={"JHT_HOME": str(sr.state_path().parents[1]), "PATH": "/usr/bin:/bin"})
    assert out.stdout.strip() == "300"
    assert sr.gate("jobs.example.org")["reason"] == "cooldown"          # this process was told by the other one


@pytest.mark.parametrize("text", ['{"sources": {"x": {"cooldown_until": 1e999, "strikes": "no", "requests": "no"}}}',
                                  '{"sources": []}', "[]", "not json", '{"sources": {"x": 3}}'])
def test_an_absurd_state_file_never_stops_a_scout(text):
    path = sr.state_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    assert sr.gate("x", NOW) is None


def test_the_state_keeps_only_what_still_matters():
    sr.gate("old.example.org", NOW)
    sr.gate("new.example.org", NOW + 5000)     # the first request has left the window: nothing to remember about it
    assert set(json.loads(sr.state_path().read_text())["sources"]) == {"new.example.org"}
    assert sr.status(now=NOW + 5001) == {"new.example.org": {"requests_in_window": 1, "max_requests": 30, "strikes": 0}}


def test_status_says_who_is_suspended_until_when():
    sr.note_hit("jobs.example.org", 403, now=NOW)
    row = sr.status("jobs.example.org", now=NOW + 1)["jobs.example.org"]
    assert row["strikes"] == 1 and row["suspended_until"].endswith("Z")


def test_guarded_fetch_makes_no_request_while_the_source_is_suspended(capsys):
    calls = []

    def fetch(url):
        calls.append(url)
        return 403, b""

    assert sr.guarded_fetch("jobs.example.org", fetch, "https://jobs.example.org/a") == (403, b"")
    assert json.loads(capsys.readouterr().err)["reason"] == "http_403"
    assert sr.guarded_fetch("jobs.example.org", fetch, "https://jobs.example.org/b") == (429, b"")   # refused, not asked
    assert json.loads(capsys.readouterr().err)["reason"] == "cooldown"
    assert calls == ["https://jobs.example.org/a"]


def test_guarded_fetch_ends_the_pause_on_a_200():
    sr.note_hit("jobs.example.org", 429, now=1.0)           # long past: the pause is over, the strike is still there
    assert sr.guarded_fetch("jobs.example.org", lambda url: (200, b"{}"), "https://jobs.example.org/a") == (200, b"{}")
    assert sr.status("jobs.example.org")["jobs.example.org"]["strikes"] == 0


# ── the tools that ask a source ─────────────────────────────────────────────────────────────────────

def test_ats_boards_share_the_pause_of_their_host(monkeypatch):
    import ats_board_search as ab
    asked = []
    monkeypatch.setattr(ab, "_get", lambda url: asked.append(url) or (403, b""))
    url = "https://boards-api.example.org/v1/boards/acme/jobs"
    assert ab.fetch(url) == (403, b"")
    assert ab.fetch(url) == (429, b"")
    assert len(asked) == 1
    with pytest.raises(ab.Refused):
        ab.fetch("http://boards-api.example.org/v1/boards/acme/jobs")      # the rule on https stays first


def test_platsbanken_shares_one_pause(monkeypatch):
    import platsbanken_search as ps
    asked = []
    monkeypatch.setattr(ps, "_get", lambda url: asked.append(url) or (429, b""))
    url = ps.BASE + "?q=x"
    assert ps.fetch(url) == (429, b"")
    assert ps.fetch(url) == (429, b"")
    assert len(asked) == 1
    with pytest.raises(ps.Refused):
        ps.fetch("https://evil.example/search?q=x")


def test_the_page_fetcher_refuses_a_suspended_site_without_asking_and_exits_3(monkeypatch, capsys):
    import web_scrape_robust as w
    monkeypatch.setattr(w, "check_url", lambda url: url)
    monkeypatch.setattr(w, "resolve_public_address", lambda host, port: None)
    asked = []
    monkeypatch.setattr(w, "fetch_level1", lambda url, timeout=0: asked.append(url) or
                        {"level": 1, "status": 403, "html": "", "blocked": True, "elapsed_ms": 1})
    first = w.fetch("https://jobs.example.org/a", max_level=1, retries_per_level=0)
    assert first["status"] == 403 and first["reason"] == "http_403" and first["retry_after_s"] == 300
    second = w.fetch("https://jobs.example.org/b", max_level=1, retries_per_level=0)
    assert second["rate_limited"] and second["status"] == 429 and second["reason"] == "cooldown"
    assert len(asked) == 1
    assert w.fetch("https://other.example.org/a", max_level=1, retries_per_level=0)["status"] == 403   # another site is asked
    assert w.main(["https://jobs.example.org/c", "--level", "1"]) == 3
    assert json.loads(capsys.readouterr().out)["rate_limited"] is True
