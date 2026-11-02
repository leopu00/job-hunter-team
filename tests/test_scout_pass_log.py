"""scout_pass_log.py / scout_pass_report.py: the measure of what the Scout's searches return and where they end.

It is read by people who are not the user, so the first duty is that nothing of the profile can reach the file: the
tests try to write free text through every field. The second is that it never slows or stops the Scout.
"""
import importlib.util
import json
import os
import subprocess
import sys
import threading
import time
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
SKILLS = REPO_ROOT / "shared" / "skills"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


plog = _load("scout_pass_log_under_test", SKILLS / "scout_pass_log.py")
report = _load("scout_pass_report_under_test", SKILLS / "scout_pass_report.py")


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    monkeypatch.setenv("JHT_AGENT_NAME", "scout-1")
    return tmp_path


def _run(*argv):
    return plog.main(list(argv))


def _lines(home: Path):
    path = home / "logs" / "scout-passes.jsonl"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


def test_a_pass_and_a_candidate_are_one_short_line_each(home):
    assert _run("pass", "--source", "greenhouse", "--country", "nl", "--returned", "25", "--query-kind", "role",
                "--query", "backend engineer amsterdam") == 0
    assert _run("candidate", "--source", "greenhouse", "--country", "nl", "--outcome", "language", "--opened") == 0
    first, second = _lines(home)
    assert first["kind"] == "pass" and first["returned"] == 25 and first["query_kind"] == "role"
    assert first["agent"] == "scout-1" and first["source"] == "greenhouse" and first["country"] == "nl"
    assert second == {**second, "kind": "candidate", "outcome": "language", "opened": True}


def test_the_query_is_never_stored_only_its_hash(home):
    _run("pass", "--source", "linkedin", "--returned", "10", "--query", "Rust Engineer Berlin")
    _run("pass", "--source", "linkedin", "--returned", "10", "--query", "  rust   ENGINEER berlin ")
    raw = (home / "logs" / "scout-passes.jsonl").read_text(encoding="utf-8")
    assert "rust" not in raw.lower() and "berlin" not in raw.lower()
    one, two = _lines(home)
    assert one["query_hash"] == two["query_hash"] and len(one["query_hash"]) == 10, "same query, same hash"


@pytest.mark.parametrize("argv", [
    ["pass", "--source", "Greenhouse Jobs", "--returned", "1"],            # a space, a capital
    ["pass", "--source", "https://example.com/careers?q=python", "--returned", "1"],
    ["pass", "--source", "x" * 41, "--returned", "1"],
    ["pass", "--source", "greenhouse", "--country", "netherlands", "--returned", "1"],
    ["pass", "--source", "greenhouse", "--country", "n l", "--returned", "1"],
    ["pass", "--source", "greenhouse", "--returned", "-3"],
    ["pass", "--source", "greenhouse", "--returned", "10000000"],
    ["pass", "--source", "greenhouse", "--returned", "1", "--query-kind", "senior python developer"],
    ["candidate", "--source", "greenhouse", "--outcome", "needs fluent German"],
    ["candidate", "--source", "greenhouse", "--outcome", "inserted", "--country", "de-DE"],
])
def test_a_free_text_in_any_field_is_refused_and_nothing_is_written(home, argv):
    with pytest.raises(SystemExit) as stopped:
        rc = _run(*argv)
        raise SystemExit(rc)
    assert stopped.value.code == 2
    assert _lines(home) == []


def test_the_agent_id_is_the_agents_own_or_unknown_never_free_text(home, monkeypatch):
    monkeypatch.setenv("JHT_AGENT_NAME", "Mario Rossi, ingegnere a Milano")
    _run("pass", "--source", "linkedin", "--returned", "1")
    assert _lines(home)[0]["agent"] == "unknown"
    _run("pass", "--source", "linkedin", "--returned", "1", "--agent", "scout-2")
    assert _lines(home)[1]["agent"] == "scout-2"


def test_a_line_cannot_carry_more_than_the_closed_fields(home):
    _run("pass", "--source", "linkedin", "--country", "multi", "--returned", "3", "--query", "x")
    _run("candidate", "--source", "linkedin", "--outcome", "inserted")
    pass_line, candidate_line = _lines(home)
    assert set(pass_line) == {"v", "kind", "ts", "agent", "source", "country", "returned", "query_kind", "query_hash"}
    assert set(candidate_line) == {"v", "kind", "ts", "agent", "source", "country", "outcome", "opened"}


def test_an_unwritable_log_is_a_warning_not_a_failure(tmp_path, monkeypatch, capsys):
    blocker = tmp_path / "home-is-a-file"
    blocker.write_text("x", encoding="utf-8")
    monkeypatch.setenv("JHT_HOME", str(blocker))
    assert _run("pass", "--source", "linkedin", "--returned", "1") == 0
    assert "could not write" in capsys.readouterr().err


def test_concurrent_scouts_never_tear_a_line(home):
    def work(agent):
        for _ in range(150):
            plog.append(plog.build(plog.parser().parse_args(
                ["candidate", "--source", "linkedin", "--outcome", "duplicate", "--agent", agent])))
    threads = [threading.Thread(target=work, args=("scout-%d" % i,)) for i in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    rows = _lines(home)  # every line must parse
    assert len(rows) == 600


def test_it_is_light_one_append_is_well_under_a_few_milliseconds(home):
    row = plog.build(plog.parser().parse_args(["candidate", "--source", "linkedin", "--outcome", "inserted"]))
    started = time.perf_counter()
    for _ in range(300):
        plog.append(row)
    per_line = (time.perf_counter() - started) / 300
    assert per_line < 0.01, "an append took %.1f ms" % (per_line * 1000)


def test_the_log_rolls_over_once_it_is_big(home, monkeypatch):
    monkeypatch.setattr(plog, "ROTATE_BYTES", 2000)
    row = plog.build(plog.parser().parse_args(["candidate", "--source", "linkedin", "--outcome", "inserted"]))
    for _ in range(60):
        plog.append(row)
    assert (home / "logs" / "scout-passes.jsonl.1").exists()
    assert (home / "logs" / "scout-passes.jsonl").stat().st_size <= 2000 + 400


# ── the report ───────────────────────────────────────────────────────────────
T0 = 1_780_000_000.0


def _pass(ts, agent="scout-1", source="greenhouse", country="nl", returned=10, **extra):
    return {"v": 1, "kind": "pass", "ts": ts, "agent": agent, "source": source, "country": country,
            "returned": returned, "query_kind": "role", **extra}


def _cand(ts, outcome, agent="scout-1", source="greenhouse", country="nl", opened=True):
    return {"v": 1, "kind": "candidate", "ts": ts, "agent": agent, "source": source, "country": country,
            "outcome": outcome, "opened": opened}


def test_the_report_folds_a_pass_and_its_candidates_into_one_row():
    rows = [_pass(T0, returned=4),
            _cand(T0 + 10, "language"), _cand(T0 + 20, "language"), _cand(T0 + 30, "duplicate", opened=False),
            _cand(T0 + 40, "inserted")]
    out = report.fold(rows)
    (row,) = out["passes"]
    assert row["returned"] == 4 and row["opened"] == 3 and row["inserted"] == 1 and row["dropped"] == 3
    assert row["outcomes"]["language"] == 2 and row["outcomes"]["duplicate"] == 1
    (group,) = out["summary"]
    assert group["passes"] == 1 and group["inserted"] == 1 and group["dropped"]["language"] == 2
    assert group["tokens_kt"] is None and group["kt_per_inserted"] is None, "no usage logs: the budget is null"


def test_the_budget_of_a_pass_is_the_agents_usage_between_its_lines():
    rows = [_pass(T0), _cand(T0 + 60, "inserted"), _pass(T0 + 100, source="linkedin", country="multi"),
            _cand(T0 + 160, "dead_link", source="linkedin", country="multi")]
    events = {"scout-1": [(T0 - 10, 5000.0), (T0 + 30, 7000.0), (T0 + 120, 9000.0), (T0 + 400, 99000.0)],
              "scout-2": [(T0 + 30, 1_000_000.0)]}
    out = report.fold(rows, events)
    first, second = out["passes"]
    # the first window opens one second before its line (nothing came before), the second from the previous line
    assert first["tokens_kt"] == 7.0
    assert second["tokens_kt"] == 9.0, "(T0+60, T0+160]: only the 9000 at T0+120; another agent's usage is not counted"
    by_source = {g["source"]: g for g in out["summary"]}
    assert by_source["greenhouse"]["kt_per_inserted"] == 7.0
    assert by_source["linkedin"]["kt_per_inserted"] is None, "nothing inserted: no price per position, not a division"


def test_a_candidate_without_its_pass_is_counted_apart_not_invented_into_one():
    rows = [_cand(T0, "inserted"), _pass(T0 + 5, source="linkedin", country="multi"),
            _cand(T0 + 6, "inserted", source="greenhouse")]  # a different source than the open pass
    out = report.fold(rows)
    # the first has no pass before it; the last is from another source than the open pass: both are orphans
    assert out["orphan"] == {"greenhouse/nl": {"inserted": 2, "opened": 2}}
    assert out["passes"][0]["inserted"] == 0


def test_two_scouts_do_not_mix_their_passes():
    rows = [_pass(T0, agent="scout-1"), _pass(T0 + 1, agent="scout-2", source="linkedin", country="multi"),
            _cand(T0 + 2, "inserted", agent="scout-1"), _cand(T0 + 3, "seniority", agent="scout-2",
                                                              source="linkedin", country="multi")]
    out = report.fold(rows)
    mine, theirs = out["passes"]
    assert mine["inserted"] == 1 and mine["outcomes"]["seniority"] == 0
    assert theirs["inserted"] == 0 and theirs["outcomes"]["seniority"] == 1


def test_the_days_are_the_local_days_of_the_machine():
    out = report.fold([_pass(T0), _cand(T0 + 1, "inserted")])
    assert out["summary"][0]["day"] == time.strftime("%Y-%m-%d", time.localtime(T0))


def test_a_log_with_foreign_or_broken_lines_is_read_not_raised(tmp_path):
    path = tmp_path / "scout-passes.jsonl"
    path.write_text("\n".join(["not json", "[]", json.dumps({"kind": "other", "ts": T0}),
                               json.dumps(_pass(T0)), json.dumps(_cand(T0 + 1, "inserted")), ""]), encoding="utf-8")
    rows = report.read_rows(path)
    assert [r["kind"] for r in rows] == ["pass", "candidate"]
    assert report.read_rows(tmp_path / "missing.jsonl") == []


def test_end_to_end_the_two_commands_in_a_clean_home(tmp_path):
    env = {**os.environ, "JHT_HOME": str(tmp_path), "JHT_AGENT_NAME": "scout-1", "PYTHONDONTWRITEBYTECODE": "1"}

    def run(script, *argv):
        done = subprocess.run([sys.executable, "-I", str(SKILLS / script), *argv], env=env, capture_output=True,
                              text=True, timeout=60)
        assert done.returncode == 0, done.stderr
        return done.stdout

    run("scout_pass_log.py", "pass", "--source", "greenhouse", "--country", "nl", "--returned", "5")
    run("scout_pass_log.py", "candidate", "--source", "greenhouse", "--country", "nl", "--outcome", "language",
        "--opened")
    run("scout_pass_log.py", "candidate", "--source", "greenhouse", "--country", "nl", "--outcome", "inserted",
        "--opened")
    data = json.loads(run("scout_pass_report.py", "--json", "--no-tokens"))
    (group,) = data["summary"]
    assert (group["passes"], group["returned"], group["opened"], group["inserted"]) == (1, 5, 2, 1)
    assert group["dropped"]["language"] == 1
    assert "greenhouse" in run("scout_pass_report.py", "--no-tokens")
    assert "no passes" in run("scout_pass_report.py", "--no-tokens", "--log", str(tmp_path / "none.jsonl"))
