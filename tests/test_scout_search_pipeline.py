"""A fake source supplies candidates; real dedup/INSERT/queue retain their contracts.

No model is run: this verifies the concrete tool hand-off, not autonomous source
choice or the model's judgement at the gates.
"""
import json
import sys
from pathlib import Path

from test_linkedin_search_outcomes import command, reply, rows, source
from test_scout_search_scope import profile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared" / "skills"))
import linkedin_access as access
import scout_coverage


def card(location, jid="101"):
    return (f'<div class="base-card" data-entity-urn="urn:li:jobPosting:{jid}">'
            '<h3>Data Analyst</h3><h4>Synthetic Analytics</h4>'
            f'<span class="job-search-card__location">{location}</span></div>')


def test_a_foreign_reply_is_explicit_and_a_local_fake_source_can_feed_the_real_queue(source, profile, monkeypatch, capsys):
    import db_insert
    import db_query
    from scout_dedup import dedup_check
    path, _ = profile
    monkeypatch.setenv("JHT_DB", str(source.home / "jobs.db"))
    source.replies.extend([reply(text=card("Austin, Texas, United States")), reply(text="")])
    assert access.main(command() + ["--profile", str(path)]) == 4
    output = [json.loads(line) for line in capsys.readouterr().out.splitlines()]
    assert output[0]["scope_match"] == "unmatched"
    assert output[-1]["code"] == "scout_search_geo_mismatch"
    entry = {"slug": "linkedin", "country": "it", "portal_language": "it", "access": "search"}
    assert scout_coverage.measure(entry, rows(source))["passes"] == 0
    assert not (source.home / "jobs.db").exists()
    # Supply a different fake source, still through the real search/parser API.
    monkeypatch.setattr(access, "GUEST_SEARCH", "https://alternative.example.invalid/guest")
    source.replies.extend([reply(text=card("Milano, Italia", "202")), reply(text="")])
    assert access.main(command() + ["--profile", str(path)]) == 0
    candidate = json.loads(capsys.readouterr().out)
    assert candidate["scope_match"] == "matched"
    assert dedup_check(candidate["url"], candidate["company"], candidate["title"], candidate["location"]) == {"action": "insert"}
    jd = "Synthetic role in Milano. Hybrid. SQL reporting. No licence required."
    source.replies.append(reply(url=candidate["url"], text='<html><title>Synthetic Analytics hiring Data Analyst in Milano | LinkedIn</title>'
                                     f'<div class="description__text">{jd}</div></html>'))
    job = access.fetch_job("202")
    assert job["status"] == 200 and job["jd_text"] == jd and job["location"] == "Milano"
    assert job["url"] == candidate["url"]
    args = db_insert.build_parser().parse_args([
        "position", "--title", job["title"], "--company", job["company"], "--location", job["location"],
        "--url", candidate["url"], "--source", "linkedin", "--found-by", "scout-1",
        "--jd-text", job["jd_text"], "--requirements", "SQL", "--remote-type", "hybrid"])
    db_insert.insert_position(args)
    capsys.readouterr()
    db_query.next_for_role("analista", as_json=True)
    queue = json.loads(capsys.readouterr().out)
    assert queue["total"] == 1 and len(queue["rows"]) == 1
    assert queue["rows"][0]["company"] == "Synthetic Analytics"
    assert dedup_check(candidate["url"])["action"] == "skip"


def test_unknown_locations_are_preserved_for_verification_and_never_auto_excluded(profile):
    from scout_search_scope import read_scope
    path, _ = profile
    candidates = [{"job_id": "1", "location": ""}, {"job_id": "2", "location": "Nearby Synthetic Town"}]
    assessed, outcome = read_scope(path).assess(candidates, "Milano")
    assert [row["job_id"] for row in assessed] == ["1", "2"]
    assert [row["scope_match"] for row in assessed] == ["unknown", "unmatched"]
    assert outcome["code"] == "scout_search_geo_mismatch" and outcome["status"] == "blocked"
