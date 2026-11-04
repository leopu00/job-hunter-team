"""What each agent WORKED on over a window (JHT-T171): the one answer behind the Agents page's lanes, gantt and totals.

The old lanes drew the SESSION, and a session is open all day, so every bar was full. Here a stretch is work when the
provider wrote tokens in it, or the agent is `lavora` now (the last stretch only). Codex is the only provider of the
0.4.0, so its rollouts are tested first and with the shape of the real ones; Claude and Kimi come after. All the JSONL
here is synthetic.

Run:
    pytest tests/test_agent_work_activity.py -v
"""
import importlib.util
import io
import json
import os
import sys
from contextlib import redirect_stdout
from datetime import datetime, timezone

import pytest

REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SKILLS_DIR = os.path.join(REPO_ROOT, "shared", "skills")
sys.path.insert(0, SKILLS_DIR)

import agent_control  # noqa: E402
import agent_work_activity as activity  # noqa: E402

# A fixed «now»: the end of an hour plus 7 minutes, so the buckets of every window have a known edge.
NOW = 1_800_000_000 - (1_800_000_000 % 3600) + 7 * 60
MIN = 60


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat().replace("+00:00", "Z")


def write_jsonl(path, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row) + "\n" for row in rows), encoding="utf-8")
    os.utime(path, (NOW, NOW))  # the series skips a file older than its window: the file was written «now»


def usage(fresh=0, cached=0, out=0, reasoning=0):
    return {"input_tokens": fresh + cached, "cached_input_tokens": cached, "output_tokens": out,
            "reasoning_output_tokens": reasoning, "total_tokens": fresh + cached + out + reasoning}


def codex_session(agent, events, name="rollout-2026-11-04T10-00-00-aaaa"):
    """A Codex rollout as the real ones are: session_meta with the cwd, a first token_count with no info, then token_count
    events carrying the cumulative total and the last response's usage. `events` = [(ts, last_usage)]; a tuple with a
    third item repeats that cumulative total instead of adding to it."""
    rows = [{"timestamp": iso(NOW - 3 * 3600), "type": "session_meta", "payload": {"cwd": f"/jht_home/agents/{agent}"}},
            {"timestamp": iso(NOW - 3 * 3600), "type": "event_msg", "payload": {"type": "token_count", "info": None}}]
    total = 0
    for event in events:
        ts, last = event[0], event[1]
        if len(event) == 2:
            total += last["total_tokens"]
        rows.append({"timestamp": iso(ts), "type": "event_msg",
                     "payload": {"type": "token_count",
                                 "info": {"total_token_usage": {"total_tokens": total}, "last_token_usage": last,
                                          "model_context_window": 258400}}})
    return name, rows


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("JHT_HOME", str(tmp_path))
    return tmp_path


def codex_file(home, agent, events, name=None):
    fname, rows = codex_session(agent, events) if name is None else codex_session(agent, events, name)
    write_jsonl(home / ".codex" / "sessions" / "2026" / "11" / "04" / f"{fname}.jsonl", rows)


def read(window, states=None, live=None, now=NOW):
    series = activity.load_series(os.path.join(SKILLS_DIR, "token-by-agent-series.py"))
    reply = activity.read_activity(window, now, states, live, series=series)
    assert reply["ok"] is True, reply
    return reply["data"]


def row(data, name):
    return next(r for r in data["agents"] if r["name"] == name)


class TestCodex:
    def test_a_codex_response_lands_in_its_bucket_with_the_weighted_tokens(self, home):
        # 800 fresh + 300 output + 100 reasoning = 1200 weighted (the cached part is not counted), 4 minutes ago.
        codex_file(home, "scout-1", [(NOW - 4 * MIN, usage(fresh=800, cached=5000, out=300, reasoning=100))])
        data = read("15m")
        scout = row(data, "scout-1")
        assert scout["total_kt"] == 1.2
        assert sum(1 for v in scout["kt"] if v > 0) == 1
        index = scout["kt"].index(1.2)
        # the bucket is the one that holds the event, counted from the aligned start of the window
        assert data["since"] + index * data["bucket_s"] <= NOW - 4 * MIN < data["since"] + (index + 1) * data["bucket_s"]

    def test_the_first_token_count_of_a_session_has_no_info_and_counts_nothing(self, home):
        codex_file(home, "scout-1", [])
        assert read("1h")["agents"] == []

    def test_a_token_count_repeated_with_the_same_total_counts_once(self, home):
        """Measured on the real rollouts of a team: 3% of the token_count events repeat the same cumulative total, and
        adding every one of them gave +4% of kT. Only a change of the total is a new response."""
        response = usage(fresh=1000, out=500)
        codex_file(home, "analista-1", [
            (NOW - 20 * MIN, response),
            (NOW - 20 * MIN + 1, response, "repeat"),
            (NOW - 20 * MIN + 2, response, "repeat"),
            (NOW - 10 * MIN, usage(fresh=2000, out=100)),
            (NOW - 10 * MIN + 1, usage(fresh=2000, out=100), "repeat"),
        ])
        assert row(read("1h"), "analista-1")["total_kt"] == 3.6

    def test_a_rollout_with_no_cumulative_total_still_counts_every_response(self, home):
        """An older rollout writes only last_token_usage: there is nothing to compare, so nothing is dropped."""
        fname, rows = codex_session("scout-2", [(NOW - 5 * MIN, usage(fresh=1000)), (NOW - 4 * MIN, usage(fresh=1000))])
        for r in rows:
            info = (r["payload"] or {}).get("info")
            if isinstance(info, dict):
                info.pop("total_token_usage")
        write_jsonl(home / ".codex" / "sessions" / "2026" / "11" / "04" / f"{fname}.jsonl", rows)
        assert row(read("1h"), "scout-2")["total_kt"] == 2.0

    def test_a_response_from_a_rollout_with_no_agent_is_unattributed_and_never_a_row(self, home):
        fname, rows = codex_session("scout-1", [(NOW - 3 * MIN, usage(fresh=2000))])
        rows[0]["payload"] = {}  # no cwd: whose is it?
        write_jsonl(home / ".codex" / "sessions" / "2026" / "11" / "04" / f"{fname}.jsonl", rows)
        data = read("1h")
        assert data["agents"] == []
        assert data["unattributed_kt"] == 2.0

    def test_two_agents_in_the_same_folders_are_told_apart_by_their_cwd(self, home):
        codex_file(home, "scout-1", [(NOW - 3 * MIN, usage(fresh=1000))], name="rollout-a")
        codex_file(home, "scorer-2", [(NOW - 2 * MIN, usage(fresh=4000))], name="rollout-b")
        data = read("1h")
        assert [r["name"] for r in data["agents"]] == ["scorer-2", "scout-1"]  # by total, the biggest first
        assert row(data, "scout-1")["total_kt"] == 1.0 and row(data, "scorer-2")["total_kt"] == 4.0


class TestClaude:
    def claude_file(self, home, agent, rows, name="s1"):
        write_jsonl(home / ".claude" / "projects" / f"-jht-home-agents-{agent}" / f"{name}.jsonl", rows)

    def message(self, ts, mid, out):
        return {"timestamp": iso(ts), "message": {"id": mid, "usage": {"input_tokens": 100, "output_tokens": out}}}

    def test_a_message_written_in_several_lines_counts_once(self, home):
        self.claude_file(home, "capitano", [self.message(NOW - 5 * MIN, "m1", 400), self.message(NOW - 5 * MIN, "m1", 900),
                                            self.message(NOW - 4 * MIN, "m2", 200)])
        # m1 counts once, with the largest it had (100 + 900), m2 is 100 + 200
        assert row(read("1h"), "capitano")["total_kt"] == 1.3

    def test_a_resumed_session_that_copies_the_history_does_not_count_it_twice(self, home):
        shared = [self.message(NOW - 8 * MIN, "m1", 900)]
        self.claude_file(home, "capitano", shared, name="first")
        self.claude_file(home, "capitano", shared + [self.message(NOW - 2 * MIN, "m2", 200)], name="resumed")
        assert row(read("1h"), "capitano")["total_kt"] == 1.3


class TestWork:
    def test_a_session_that_is_open_but_wrote_nothing_is_not_work(self, home):
        """The bug of the old lanes: every session is open all day, so every bar was full."""
        data = read("24h", states={"sentinella": "idle"}, live={"sentinella"})
        sentinel = row(data, "sentinella")
        assert sentinel["work"] == [0] * data["buckets"]
        assert sentinel["worked_buckets"] == 0 and sentinel["total_kt"] == 0

    def test_work_is_a_bucket_with_tokens_and_only_that_one(self, home):
        codex_file(home, "scout-1", [(NOW - 40 * MIN, usage(fresh=500)), (NOW - 39 * MIN, usage(fresh=500)),
                                     (NOW - 12 * MIN, usage(fresh=500))])
        data = read("1h", states={"scout-1": "idle"})
        scout = row(data, "scout-1")
        assert scout["work"] == [1 if v > 0 else 0 for v in scout["kt"]]
        # three responses (two a minute apart, one 27 minutes later) are two or three 2-minute buckets of 30, never the whole hour
        assert 2 <= scout["worked_buckets"] <= 3 and scout["worked_buckets"] == sum(1 for v in scout["kt"] if v > 0)

    def test_lavora_marks_the_last_bucket_only(self, home):
        codex_file(home, "scout-1", [(NOW - 40 * MIN, usage(fresh=500))])
        data = read("1h", states={"scout-1": "lavora"})
        work = row(data, "scout-1")["work"]
        assert work[-1] == 1
        assert sum(work[:-1]) == 1  # the one bucket of the response, not the stretch before «now»
        assert row(data, "scout-1")["state"] == "lavora"

    def test_without_states_nothing_is_said_about_now(self, home):
        codex_file(home, "scout-1", [(NOW - 40 * MIN, usage(fresh=500))])
        data = read("1h", states=None)
        assert data["states"] is False and row(data, "scout-1")["state"] is None
        assert row(data, "scout-1")["work"][-1] == 0

    def test_an_agent_that_exists_but_wrote_no_token_has_its_row_with_zeros(self, home):
        codex_file(home, "scout-1", [(NOW - 3 * MIN, usage(fresh=500))])
        data = read("1h", live={"scout-1", "mentor"})
        assert {r["name"] for r in data["agents"]} == {"scout-1", "mentor"}
        assert row(data, "mentor")["total_kt"] == 0 and row(data, "mentor")["avg_kt_h"] == 0


class TestWindows:
    @pytest.mark.parametrize("window", list(activity.WINDOWS))
    def test_every_window_is_whole_aligned_buckets_that_end_after_now(self, window):
        span, bucket = activity.WINDOWS[window]
        since, end, bucket_s, count = activity.bucket_edges(NOW, window)
        assert bucket_s == bucket and count * bucket == span and end - since == span
        assert end % bucket == 0 and since % bucket == 0
        assert end - bucket < NOW <= end  # the last bucket is the one «now» is in

    def test_the_windows_are_the_six_of_the_page(self):
        assert list(activity.WINDOWS) == ["5m", "15m", "1h", "5h", "24h", "7d"]
        assert [activity.WINDOWS[w][0] for w in activity.WINDOWS] == [300, 900, 3600, 18000, 86400, 604800]

    def test_the_same_response_is_the_same_bucket_whatever_the_moment_of_the_question(self, home):
        codex_file(home, "scout-1", [(NOW - 25 * MIN, usage(fresh=1000))])
        first = read("1h", now=NOW)
        later = read("1h", now=NOW + 30)  # inside the same 2-minute bucket: nothing moves
        assert first["since"] == later["since"] and row(first, "scout-1")["kt"] == row(later, "scout-1")["kt"]
        moved = read("1h", now=NOW + 5 * MIN)  # three buckets later: the window slid by whole buckets
        shift = (moved["since"] - first["since"]) // first["bucket_s"]
        assert shift > 0
        assert row(moved, "scout-1")["kt"][: first["buckets"] - shift] == row(first, "scout-1")["kt"][shift:]

    def test_the_long_windows_are_read_from_the_same_rollouts_and_add_up(self, home):
        events = [(NOW - 30 * MIN, usage(fresh=1000)), (NOW - 4 * 3600, usage(fresh=2000)), (NOW - 30 * 3600, usage(fresh=4000))]
        codex_file(home, "scout-1", events)
        totals = {w: row(read(w), "scout-1")["total_kt"] for w in ("1h", "5h", "24h", "7d") if read(w)["agents"]}
        assert totals == {"1h": 1.0, "5h": 3.0, "24h": 3.0, "7d": 7.0}

    def test_the_average_is_the_total_over_the_hours_of_the_window(self, home):
        codex_file(home, "scout-1", [(NOW - 2 * 3600, usage(fresh=6000))])
        data = read("5h")
        assert row(data, "scout-1")["total_kt"] == 6.0 and row(data, "scout-1")["avg_kt_h"] == 1.2

    def test_a_window_the_page_does_not_have_is_refused(self, home):
        for bad in ("2h", "", None, 3600, "1H"):
            assert activity.read_activity(bad, NOW, None, series=object()) == {"ok": False, "error": "agent_control_invalid"}


class TestTheOp:
    """The op as the app asks for it: agent_control.py activity WINDOW, and one JSON request on stdin."""

    @pytest.fixture(autouse=True)
    def team(self, home, monkeypatch):
        codex_file(home, "scout-1", [(NOW - 3 * MIN, usage(fresh=3000, out=1000))])  # inside even the 5-minute window
        monkeypatch.setattr(agent_control, "_agent_states", lambda: {"scout-1": {"state": "lavora"}, "mentor": {"state": "idle"}})
        monkeypatch.setattr(agent_control, "_now", lambda: float(NOW))
        monkeypatch.setattr(agent_control, "_sessions", lambda: {"SCOUT-1": (1, 1), "MENTOR": (1, 1)})
        monkeypatch.setattr(agent_control, "TOKEN_SERIES", __import__("pathlib").Path(SKILLS_DIR) / "token-by-agent-series.py")
        monkeypatch.setattr(agent_control, "WORK_ACTIVITY", __import__("pathlib").Path(SKILLS_DIR) / "agent_work_activity.py")

    def ask(self, window):
        out = io.StringIO()
        with redirect_stdout(out):
            code = agent_control.main(["activity", window])
        assert code == 0
        return json.loads(out.getvalue())

    def test_it_answers_for_every_window_in_one_closed_shape(self):
        for window in activity.WINDOWS:
            reply = self.ask(window)
            assert reply["ok"] is True
            data = reply["data"]
            assert set(data) == {"window", "now", "since", "end", "bucket_s", "buckets", "agents", "unattributed_kt", "states"}
            names = [a["name"] for a in data["agents"]]
            assert names == ["scout-1", "mentor"]
            for a in data["agents"]:
                assert set(a) == {"name", "state", "kt", "work", "total_kt", "avg_kt_h", "worked_buckets"}
                assert len(a["kt"]) == len(a["work"]) == data["buckets"]

    def test_the_agent_working_now_and_the_idle_one_are_told_apart(self):
        data = self.ask("15m")["data"]
        scout = next(a for a in data["agents"] if a["name"] == "scout-1")
        mentor = next(a for a in data["agents"] if a["name"] == "mentor")
        assert scout["state"] == "lavora" and scout["work"][-1] == 1 and scout["total_kt"] == 4.0
        assert mentor["state"] == "idle" and sum(mentor["work"]) == 0

    def test_a_bad_window_is_a_closed_error_not_a_crash(self):
        assert self.ask("90m") == {"ok": False, "error": "agent_control_invalid"}

    def test_it_is_a_read_on_stdin_too(self, monkeypatch):
        monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps({"op": "activity", "window": "1h"}) + "\n"))
        out = io.StringIO()
        with redirect_stdout(out):
            assert agent_control.main([]) == 0
        assert json.loads(out.getvalue())["data"]["window"] == "1h"

    def test_an_image_without_the_module_says_so_in_a_closed_code(self, monkeypatch):
        monkeypatch.setattr(agent_control, "WORK_ACTIVITY", __import__("pathlib").Path("/nonexistent/agent_work_activity.py"))
        assert self.ask("1h") == {"ok": False, "error": "agents_unavailable"}
