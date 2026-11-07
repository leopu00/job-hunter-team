"""Synthetic source replies exercise the public CLI, runtime log and coverage together."""
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from requests.exceptions import ConnectionError, Timeout

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared" / "skills"))
import linkedin_access as access
import scout_coverage as coverage
from scout_search_outcomes import ERRORS, SearchSourceError

CARD = '<li><div class="base-card" data-entity-urn="urn:li:jobPosting:101"><h3>Data role</h3></div></li>'
EMPTY = '<div class="jobs-search-no-results-banner">No jobs found</div>'
ENTRY = {"slug": "linkedin", "country": "it", "portal_language": "it", "access": "search"}


def reply(status=200, text=EMPTY, url="https://jobs.example.invalid/jobs/view/101"):
    return SimpleNamespace(status_code=status, text=text, url=url)


@pytest.fixture
def source(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setattr(access.time, "sleep", lambda seconds: None)
    responses, urls = [], []

    def get(url, **kwargs):
        urls.append(url)
        answer = responses.pop(0) if responses else reply()
        if isinstance(answer, Exception):
            raise answer
        return answer, None

    monkeypatch.setattr(access, "_get", get)
    return SimpleNamespace(home=tmp_path, replies=responses, urls=urls)


def command():
    return ["search", "--keywords", "data", "--location", "Milano", "--log",
            "--country", "it", "--query-kind", "broad", "--agent", "scout-1"]


def rows(source):
    return [json.loads(line) for line in (source.home / "logs/scout-passes.jsonl").read_text().splitlines()]


@pytest.mark.parametrize("answer,code,state", [
    (Timeout("private query"), "timeout", "blocked"),
    (ConnectionError("private address"), "network", "blocked"),
    (reply(403), "forbidden", "closed"), (reply(410), "gone", "closed"),
    (reply(500), "server", "blocked"), (reply(503), "server", "blocked"),
    (reply(401), "http", "blocked"),
    (reply(text='<html><script src="/cf-chl-check"></script></html>'), "challenge", "closed"),
    (reply(text='<html><title>New layout</title></html>'), "unrecognized", "blocked"),
])
def test_source_errors_are_visible_and_do_not_cover_an_empty_market(source, capsys, answer, code, state):
    source.replies.append(answer)
    assert access.main(command()) == 4
    captured = capsys.readouterr()
    outcome = json.loads(captured.out)
    key = f"scout_search_{code}"
    assert outcome["code"] == key and outcome["message"] == ERRORS[key][1]
    assert outcome["search_outcome"] is True
    runtime = (source.home / "logs/runtime.log").read_text()
    assert len(runtime.splitlines()) == 1 and key in runtime and ERRORS[key][1] in runtime
    assert key in captured.err and "private" not in runtime + captured.out + captured.err
    measured = coverage.measure(ENTRY, rows(source))
    assert measured["state"] == state and measured["passes"] == 0 and measured["queries"] == 0
    assert rows(source)[0]["status"] == outcome["status"] != "empty"


@pytest.mark.parametrize("body", ["", EMPTY])
def test_a_successful_empty_fragment_or_explicit_empty_list_is_a_real_empty_pass(source, capsys, body):
    source.replies.append(reply(text=body))
    assert access.main(command()) == 0 and capsys.readouterr().out == ""
    assert rows(source)[0]["status"] == "empty"
    assert coverage.measure(ENTRY, rows(source))["passes"] == 1
    assert not (source.home / "logs/runtime.log").exists()


def test_an_error_on_page_two_preserves_every_result_and_is_not_silenced(source, capsys):
    source.replies.extend([reply(text=CARD), Timeout("secret")])
    assert access.main(command()) == 4
    lines = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert lines[0] == {"job_id": "101", "url": access.public_url("101"), "title": "Data role",
                        "company": "", "location": "", "source": "linkedin-guest"}
    assert lines[-1]["code"] == "scout_search_timeout"
    assert "start=0" in source.urls[0] and "start=25" in source.urls[1]
    assert rows(source)[0]["returned"] == 1 and rows(source)[0]["status"] == "blocked"


def test_the_list_api_raises_with_partial_results_instead_of_hiding_a_source_failure(source):
    source.replies.extend([reply(text=CARD), reply(503)])
    with pytest.raises(SearchSourceError) as error:
        access.search("data", "Milano")
    assert [row["job_id"] for row in error.value.results] == ["101"]
    assert error.value.outcome["code"] == "scout_search_server"


def test_runtime_log_does_not_follow_a_link_or_print_a_private_exception(source, capsys):
    target = source.home / "untouched"
    target.write_text("keep")
    (source.home / "logs").mkdir()
    (source.home / "logs/runtime.log").symlink_to(target)
    source.replies.append(Timeout("private exception"))
    assert access.main(command()) == 4
    output = capsys.readouterr()
    assert target.read_text() == "keep"
    assert "scout_search_log_unavailable" in output.err
    assert "private exception" not in output.err + output.out


def test_fetch_uses_the_same_error_catalog_and_exit_contract(source, capsys):
    source.replies.append(reply(410))
    assert access.main(["fetch-job", "101"]) == 4
    outcome = json.loads(capsys.readouterr().out)
    assert outcome["code"] == "scout_search_gone" and outcome["http_status"] == 410
    assert "scout_search_gone" in (source.home / "logs/runtime.log").read_text()


def test_a_real_job_page_keeps_its_fields_and_expired_redirect_remains_explicit(source):
    html = ('<html><title>Synthetic hiring Data Analyst in Milano | LinkedIn</title>'
            '<div class="description__text">SQL reporting, fictional role.</div></html>')
    source.replies.append(reply(text=html))
    job = access.fetch_job("101")
    assert (job["title"], job["company"], job["location"]) == ("Data Analyst", "Synthetic", "Milano")
    assert job["jd_text"] == "SQL reporting, fictional role." and job["jd_chars"] == len(job["jd_text"])
    source.replies.append(reply(text="<html><title>12 jobs in Italy</title></html>"))
    assert access.fetch_job("101")["expired"] is True


def test_automatic_logging_keeps_the_three_empty_pass_alert_without_corrupting_jsonl(source, monkeypatch, capsys):
    import scout_pass_log
    seen = []

    def watch(row):
        seen.append(row)
        if len(seen) == 3:
            print("synthetic empty-source alert")

    monkeypatch.setattr(scout_pass_log, "_watch_empty", watch)
    for _ in range(3):
        assert access.main(command()) == 0
    output = capsys.readouterr()
    assert len(seen) == 3 and len(rows(source)) == 3
    assert all(row["status"] == "empty" for row in seen)
    assert output.out == "" and "synthetic empty-source alert" in output.err


@pytest.mark.parametrize("limit", ["0", "-1"])
def test_invalid_limits_cannot_record_a_search_that_never_happened(source, capsys, limit):
    assert access.main(command() + ["--limit", limit]) == 4
    outcome = json.loads(capsys.readouterr().out)
    assert outcome["code"] == "scout_search_input_invalid" and outcome["source_attempted"] is False
    assert source.urls == [] and not (source.home / "logs/scout-passes.jsonl").exists()
