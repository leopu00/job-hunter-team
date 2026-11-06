"""JHT-T187: a Scout that gets nothing three times from the same source and does not move on is told about, once.

Real scout_pass_log.py and scout_empty_alert.py over made-up pass lines; the notify tool is a fake that records its arguments.
"""
import importlib.util
import json
import sys
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parent.parent
SKILLS = REPO / "shared" / "skills"
sys.path.insert(0, str(SKILLS))


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ea = _load("scout_empty_alert_test", SKILLS / "scout_empty_alert.py")
plog = _load("scout_pass_log_empty_alert_test", SKILLS / "scout_pass_log.py")

NOW = 1_800_000_000.0
LOCALES = REPO / "shared" / "locales"
LANGS = ("en", "it", "de", "fr", "es", "pt", "hu")


class Done:
    returncode, stdout, stderr = 0, "notified 7\n", ""


@pytest.fixture(autouse=True)
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.delenv("JHT_SCOUT_EMPTY_ROUNDS", raising=False)
    tool = tmp_path / "jht-notify-user"
    tool.write_text("#!/bin/sh\n")
    import web_action_notice
    monkeypatch.setattr(web_action_notice, "notify_tool", lambda: tool)
    monkeypatch.setattr(web_action_notice, "user_language", lambda: "it")
    return tmp_path


def line(i, source="indeed", country="de", returned=0, agent="scout-1", status=None, ago=0):
    row = {"v": 1, "kind": "pass", "ts": NOW - ago + i * 60, "agent": agent, "source": source, "country": country,
           "returned": returned, "query_kind": "role", "query_hash": "h%d" % i}
    if status:
        row["status"] = status
    return row


def write(home, rows):
    path = home / "logs"
    path.mkdir(parents=True, exist_ok=True)
    (path / "scout-passes.jsonl").write_text("".join(json.dumps(r) + "\n" for r in rows), encoding="utf-8")


def alerts(home):
    path = home / "logs" / "scout-alerts.jsonl"
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def run_recorder(calls):
    def run(cmd, **kwargs):
        calls.append(cmd)
        return Done()
    return run


def test_three_empty_passes_on_the_same_source_raise_one_alert_and_tell_the_user_once(home):
    write(home, [line(i) for i in range(3)])
    calls = []
    alert = ea.check("scout-1", NOW + 200, run=run_recorder(calls))
    assert alert["passes"] == 3 and (alert["source"], alert["country"], alert["notified"]) == ("indeed", "de", True)
    assert alerts(home)[0]["kind"] == "empty_streak"
    cmd = calls[0]
    assert cmd[cmd.index("--source-action") + 1] == "scout_empty_alert"
    assert cmd[cmd.index("--kind") + 1] == "alert"
    assert cmd[-1].startswith("Uno degli Scout") and "{" not in cmd[-1]                 # the sentence of the catalog, in the user's language
    assert "indeed" not in cmd[-1] and "3" not in cmd[-1]                                # no source name in the user's message
    # the same streak again, or its fourth pass: not a new alert
    assert ea.check("scout-1", NOW + 201, run=run_recorder(calls)) is None
    write(home, [line(i) for i in range(4)])
    assert ea.check("scout-1", NOW + 300, run=run_recorder(calls)) is None
    assert len(alerts(home)) == 1 and len(calls) == 1


def test_two_empty_passes_or_a_pass_that_returned_something_are_no_streak(home):
    write(home, [line(0), line(1)])
    assert ea.check("scout-1", NOW) is None
    write(home, [line(0), line(1, returned=12), line(2)])
    assert ea.check("scout-1", NOW) is None


def test_changing_source_in_between_is_not_a_streak(home):
    write(home, [line(0), line(1, source="stepstone"), line(2)])
    assert ea.check("scout-1", NOW) is None
    write(home, [line(0), line(1, country="at"), line(2)])
    assert ea.check("scout-1", NOW) is None


def test_an_error_is_not_an_empty_answer(home):
    write(home, [line(0), line(1, status="blocked"), line(2)])
    assert ea.check("scout-1", NOW) is None
    write(home, [line(i, status="closed") for i in range(3)])
    assert ea.check("scout-1", NOW) is None


def test_each_scout_has_its_own_streak(home):
    write(home, [line(0), line(1, agent="scout-2"), line(2), line(3, agent="scout-2"), line(4, agent="scout-2")])
    assert ea.check("scout-1", NOW) is None
    assert ea.check("scout-2", NOW + 400, run=run_recorder([]))["passes"] == 3


def test_passes_spread_over_days_are_not_one_loop(home):
    write(home, [line(0, ago=3 * 86400), line(1, ago=2 * 86400), line(2)])
    assert ea.check("scout-1", NOW) is None


def test_the_number_of_passes_can_be_set_and_a_nonsense_one_is_three(home, monkeypatch):
    monkeypatch.setenv("JHT_SCOUT_EMPTY_ROUNDS", "2")
    write(home, [line(0), line(1)])
    assert ea.check("scout-1", NOW, run=run_recorder([]))["passes"] == 2
    for raw in ("1", "50", "x", ""):
        monkeypatch.setenv("JHT_SCOUT_EMPTY_ROUNDS", raw)
        assert ea.rounds() == 3


def test_a_notify_tool_that_fails_does_not_stop_the_alert_and_says_so(home):
    write(home, [line(i) for i in range(3)])

    def broken(cmd, **kwargs):
        raise OSError("no tool")

    alert = ea.check("scout-1", NOW, run=broken)
    assert alert["notified"] is False and len(alerts(home)) == 1


def test_list_says_whether_the_scout_moved_on(home):
    write(home, [line(i) for i in range(3)])
    ea.check("scout-1", NOW + 200, run=run_recorder([]))
    assert ea.recent(24, NOW + 300)[0]["resolved"] is False
    write(home, [line(i) for i in range(3)] + [line(5, source="stepstone")])
    out = ea.recent(24, NOW + 400)
    assert out[0]["resolved"] is True and set(out[0]) == {"agent", "source", "country", "passes", "at", "resolved"}
    assert ea.recent(24, NOW + 30 * 3600) == []


def test_logging_the_third_empty_pass_prints_where_to_go_and_writes_the_alert(home, capsys, monkeypatch):
    monkeypatch.setenv("JHT_AGENT_NAME", "scout-1")
    monkeypatch.setattr(ea.subprocess, "run", run_recorder([]))
    args = ["pass", "--source", "indeed", "--country", "de", "--returned", "0", "--query-kind", "role"]
    for i in range(3):
        assert plog.main(args + ["--query", "q%d" % i]) == 0
    out = capsys.readouterr().out
    assert out.count("ALERT") == 1 and "scout_coverage.py next" in out
    assert len(alerts(home)) == 1


def test_a_pass_with_something_in_it_is_logged_in_silence(home, capsys, monkeypatch):
    monkeypatch.setenv("JHT_AGENT_NAME", "scout-1")
    assert plog.main(["pass", "--source", "indeed", "--country", "de", "--returned", "9"]) == 0
    assert capsys.readouterr().out == "" and alerts(home) == []


def test_the_sentence_is_in_every_language_and_the_user_message_names_no_source():
    english = json.loads((LOCALES / "en.json").read_text(encoding="utf-8"))["scout_empty_notice.streak"]
    for lang in LANGS:
        text = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8")).get("scout_empty_notice.streak")
        assert isinstance(text, str) and text.strip() and "{" not in text, lang
        assert lang == "en" or text != english, lang


def test_the_sentence_promises_only_what_is_done_the_doctor_reads_the_file_and_the_scout_gets_the_line():
    """The Captain is not told by this tool: no language may say he was."""
    for lang, captain in zip(LANGS, ("Captain", "Capitano", "Kapitän", "Capitaine", "Capitán", "Capitão", "Kapitány")):
        text = json.loads((LOCALES / f"{lang}.json").read_text(encoding="utf-8"))["scout_empty_notice.streak"]
        assert captain not in text, lang
