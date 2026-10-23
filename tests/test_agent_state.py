"""shared/skills/agent_state.py: the state of an agent from its CLI's own events.

Synthetic logs, shaped like the real ones of the three CLIs (record types and
fields read from real Claude, Codex and Kimi logs on 18/10/2026; NOT checked
inside the containers). No CLI is started, no tmux, no network.
"""
import hashlib
import importlib.util
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import sys

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("agent_state_under_test", ROOT / "shared/skills/agent_state.py")
st = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = st
spec.loader.exec_module(st)

NOW = 1_790_000_000.0
CREATED = NOW - 300.0  # the session started five minutes ago


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


# ── Claude lines ────────────────────────────────────────────────────────

def c_prompt(ts, text="go"):
    return {"type": "user", "timestamp": iso(ts), "message": {"role": "user", "content": text}}


def c_result(ts):
    return {"type": "user", "timestamp": iso(ts),
            "message": {"role": "user", "content": [{"type": "tool_result", "content": "ok"}]}}


def c_tool(ts):
    return {"type": "assistant", "timestamp": iso(ts), "message": {"stop_reason": "tool_use", "content": []}}


def c_say(ts):
    return {"type": "assistant", "timestamp": iso(ts), "message": {"stop_reason": "end_turn", "content": []}}


def c_done(ts):
    return {"type": "system", "subtype": "turn_duration", "timestamp": iso(ts), "durationMs": 1000}


def c_interrupt(ts):
    return c_prompt(ts, "[Request interrupted by user]")


def c_error(ts, error, text, status=None, quota=None):
    line = {"type": "assistant", "timestamp": iso(ts), "isApiErrorMessage": True, "error": error,
            "message": {"stop_reason": "stop_sequence", "model": "<synthetic>",
                        "content": [{"type": "text", "text": text}]}}
    if status:
        line["apiErrorStatus"] = status
    if quota:
        line["quotaLimits"] = quota
    return line


def c_limit(ts, kind, reason=None, resets=None):
    quota = {"status": "rejected", "rateLimitType": kind, "resetsAt": resets,
             "overageDisabledReason": reason}
    return c_error(ts, "rate_limit", "You've hit your limit", 429, quota)


def c_meta(ts):
    return [{"type": "mode", "mode": "bypassPermissions"}, {"type": "permission-mode", "permissionMode": "x"},
            {"type": "ai-title", "aiTitle": "t"}]


# ── Codex lines ─────────────────────────────────────────────────────────

def x_meta(cwd="/x"):
    return {"timestamp": iso(CREATED + 1), "type": "session_meta", "payload": {"id": "s", "cwd": cwd}}


def x_event(ts, kind, **payload):
    return {"timestamp": iso(ts), "type": "event_msg", "payload": {"type": kind, **payload}}


def x_item(ts):
    return {"timestamp": iso(ts), "type": "response_item", "payload": {"type": "function_call"}}


def x_count(ts, used):
    return x_event(ts, "token_count", info={}, rate_limits={
        "primary": {"used_percent": used, "window_minutes": 10080, "resets_at": 1791603609}})


# ── Kimi lines ──────────────────────────────────────────────────────────

def k(ts, kind, **payload):
    return {"timestamp": ts, "message": {"type": kind, "payload": payload}}


KIMI_META = {"type": "metadata", "protocol_version": "1.4"}


def k_403(ts, session):
    stamp = datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S.123")
    return (f"{stamp} | ERROR    | kimi_cli.soul.kimisoul:_agent_loop:1049 | {session} - Agent step 1 "
            "failed: APIStatusError: Error code: 403 - {'error': {'message': \"You've reached your "
            "usage limit for this billing cycle.\"}}")


# ── folding ─────────────────────────────────────────────────────────────

def lines(objs):
    return [json.dumps(o) for o in objs]


def ctx(**kw):
    base = dict(now=NOW, session_created=CREATED, readable=True)
    base.update(kw)
    return st.Ctx(**base)


def state_of(parsed, **kw):
    v = st.fold(parsed.events, ctx(**kw))
    return v["state"], v.get("reason")


T = CREATED + 10  # the first turn started ten seconds after the session


CLAUDE_CASES = {
    # an open turn with a recent event
    "working": ([c_prompt(T), c_tool(NOW - 20)], ("lavora", None)),
    "working-after-a-result": ([c_prompt(T), c_tool(T + 1), c_result(NOW - 5)], ("lavora", None)),
    # a closing event
    "turn-duration": ([c_prompt(T), c_tool(T + 5), c_say(T + 9), c_done(T + 10)], ("idle", None)),
    "interrupted-by-the-user": ([c_prompt(T), c_tool(T + 5), c_interrupt(T + 8)], ("idle", None)),
    # the provider says no
    "five-hour-limit": ([c_prompt(T), c_limit(T + 5, "five_hour", "out_of_credits", NOW + 3600), c_done(T + 6)],
                        ("bloccato", "limite_5h")),
    "weekly-limit": ([c_prompt(T), c_limit(T + 5, "seven_day", "out_of_credits", NOW + 90000), c_done(T + 6)],
                     ("bloccato", "limite_settimanale")),
    "org-spend-cap": ([c_prompt(T), c_limit(T + 5, "five_hour", "org_level_disabled_until", NOW + 3600)],
                      ("bloccato", "limite_spesa_org")),
    "network": ([c_prompt(T), c_error(T + 5, "server_error", "API Error: Can't reach the API server (ENOTFOUND)")],
                ("bloccato", "rete")),
    "computer-slept": ([c_prompt(T), c_error(T + 5, "server_error", "API Error: Your computer went to sleep mid-response.")],
                       ("bloccato", "rete")),
    "other-api-error": ([c_prompt(T), c_error(T + 5, "server_error", "API Error: 529 overloaded")],
                        ("bloccato", "errore_fornitore")),
    # the block ends
    "new-prompt-after-the-limit": ([c_prompt(T), c_limit(T + 5, "five_hour", "out_of_credits", NOW + 3600),
                                    c_done(T + 6), c_prompt(NOW - 30), c_tool(NOW - 20)], ("lavora", None)),
    "limit-lifted-nothing-after": ([c_prompt(T), c_limit(T + 5, "five_hour", "out_of_credits", NOW - 10),
                                    c_done(T + 6)], ("idle", None)),
    # a turn left open and silent
    "open-and-silent-for-a-long-time": ([c_prompt(NOW - 2100), c_tool(NOW - 2000)], ("sconosciuto", "turno_silenzioso")),
}

OLD_SESSION = NOW - 5000  # a session that has been up for a while


@pytest.mark.parametrize("name", CLAUDE_CASES)
def test_claude_cases(name):
    objs, expected = CLAUDE_CASES[name]
    assert state_of(st.parse_claude(lines(objs)), session_created=OLD_SESSION) == expected


CODEX_CASES = {
    "working": ([x_meta(), x_event(T, "task_started"), x_item(NOW - 20)], ("lavora", None)),
    "complete": ([x_meta(), x_event(T, "task_started"), x_item(T + 3), x_event(T + 9, "task_complete")],
                 ("idle", None)),
    "aborted": ([x_meta(), x_event(T, "task_started"), x_event(T + 3, "turn_aborted", reason="interrupted")],
                ("idle", None)),
    # 100% of the window is NOT a block: the real rollouts keep working at 100
    "at-100-percent-and-still-working": ([x_meta(), x_event(T, "task_started"), x_count(NOW - 30, 100.0),
                                          x_item(NOW - 20)], ("lavora", None)),
    "open-and-silent": ([x_meta(), x_event(NOW - 2100, "task_started"), x_item(NOW - 2000)],
                        ("sconosciuto", "turno_silenzioso")),
}


@pytest.mark.parametrize("name", CODEX_CASES)
def test_codex_cases(name):
    objs, expected = CODEX_CASES[name]
    assert state_of(st.parse_codex(lines(objs)), session_created=OLD_SESSION) == expected


def kimi_turn(begin, steps_end, *, progress=True, fast=False):
    """A wire: TurnBegin, a step (with or without output), TurnEnd."""
    out = [KIMI_META, k(begin, "TurnBegin", user_input="x"), k(begin + 0.1, "StepBegin", n=1)]
    if progress:
        out.append(k(begin + 1, "StatusUpdate"))
    if fast:
        out.append(k(begin + 1.5, "StepInterrupted"))
    return out


KIMI_SESSION = "00000000-0000-4000-8000-000000000001"


def test_kimi_working_idle_and_failed_turn():
    working = kimi_turn(T, None) + [k(NOW - 20, "ToolCall")]
    assert state_of(st.parse_kimi(lines(working))) == ("lavora", None)

    done = kimi_turn(T, None) + [k(T + 9, "TurnEnd")]
    assert state_of(st.parse_kimi(lines(done))) == ("idle", None)

    # a step that dies at once, and the log names the failed step: blocked
    failed = kimi_turn(T, None, progress=False, fast=True) + [k(T + 1.6, "TurnEnd")]
    failures = st.kimi_log_failures([k_403(T + 1.6, KIMI_SESSION)])
    assert failures and failures[0][2] == "limite_fornitore"
    assert state_of(st.parse_kimi(lines(failed), KIMI_SESSION, failures)) == ("bloccato", "limite_fornitore")

    # the same wire with no line in kimi.log is an interrupt, a plain end
    assert state_of(st.parse_kimi(lines(failed), KIMI_SESSION, [])) == ("idle", None)
    # a failure of ANOTHER session does not count
    other = st.kimi_log_failures([k_403(T + 1.6, "00000000-0000-4000-8000-000000000002")])
    assert state_of(st.parse_kimi(lines(failed), KIMI_SESSION, other)) == ("idle", None)


def test_kimi_pending_approval_waits_for_the_user():
    wire = kimi_turn(T, None) + [k(T + 5, "ApprovalRequest", id="a1")]
    assert state_of(st.parse_kimi(lines(wire))) == ("aspetta_umano", None)
    wire.append(k(T + 8, "ApprovalResponse", request_id="a1", response="approve"))
    assert state_of(st.parse_kimi(lines(wire))) == ("lavora", None)


def test_the_limit_carries_the_time_it_lifts():
    objs = [c_prompt(T), c_limit(T + 5, "five_hour", "out_of_credits", NOW + 3600), c_done(T + 6)]
    v = st.fold(st.parse_claude(lines(objs)).events, ctx())
    assert v["until"] == NOW + 3600 and v["since"] == pytest.approx(T + 5, abs=0.01)


# ── what the CPU and the user's questions add ───────────────────────────

LONG_TURN = [c_prompt(NOW - 2100), c_tool(NOW - 2000)]  # open, silent for 33 min


def test_a_busy_cpu_keeps_a_long_tool_alive_but_only_a_fresh_reading():
    events = st.parse_claude(lines(LONG_TURN)).events
    old = dict(session_created=OLD_SESSION)
    assert st.fold(events, ctx(cpu_pct=40.0, cpu_age_s=20.0, **old))["state"] == "lavora"
    assert st.fold(events, ctx(cpu_pct=40.0, cpu_age_s=300.0, **old))["reason"] == "turno_silenzioso"
    assert st.fold(events, ctx(cpu_pct=2.0, cpu_age_s=20.0, **old))["reason"] == "turno_silenzioso"
    assert st.fold(events, ctx(**old))["reason"] == "turno_silenzioso"


def test_an_unanswered_question_after_a_closed_turn_waits_for_the_user():
    closed = st.parse_claude(lines([c_prompt(T), c_tool(T + 5), c_done(T + 20)])).events
    q = {"ts": T + 15, "body": "procedo con la candidatura?"}
    v = st.fold(closed, ctx(question=q))
    assert (v["state"], v["question"]) == ("aspetta_umano", "procedo con la candidatura?")
    # the agent is still working: working, not waiting
    open_turn = st.parse_claude(lines([c_prompt(T), c_tool(NOW - 5)])).events
    assert st.fold(open_turn, ctx(question=q))["state"] == "lavora"
    # a question from a turn before the last one is not this wait
    older = {"ts": T - 100, "body": "old"}
    assert st.fold(closed, ctx(question=older))["state"] == "idle"
    # a week old is no wait
    stale = {"ts": NOW - 8 * 86400, "body": "x"}
    assert st.fold(closed, ctx(question=stale))["state"] == "idle"


def test_a_question_after_a_closed_turn_waits_for_the_user_in_every_cli():
    q = {"ts": T + 15, "body": "procedo?"}
    closed = {
        "claude": st.parse_claude(lines([c_prompt(T), c_tool(T + 5), c_done(T + 20)])),
        "codex": st.parse_codex(lines([x_meta(), x_event(T, "task_started"), x_item(T + 5),
                                       x_event(T + 20, "task_complete")])),
        "kimi": st.parse_kimi(lines(kimi_turn(T, None) + [k(T + 20, "TurnEnd")])),
    }
    for cli, parsed in closed.items():
        assert st.fold(parsed.events, ctx(question=q))["state"] == "aspetta_umano", cli
        assert st.fold(parsed.events, ctx(question={"ts": T - 100, "body": "old"}))["state"] == "idle", cli


# ── never idle, never working by default ────────────────────────────────

def test_no_session_is_off():
    assert st.fold([], ctx(session_created=None))["state"] == "spento"


def test_a_session_with_no_event_is_never_idle_or_working():
    young = st.fold([], ctx(session_created=NOW - 30))
    assert (young["state"], young["reason"]) == ("sconosciuto", "avvio_in_corso")
    old = st.fold([], ctx())
    assert old["state"] == "avviato_mai_partito"


def test_events_of_a_previous_run_say_nothing_about_this_one():
    previous = [c_prompt(CREATED - 86400), c_tool(CREATED - 86390), c_done(CREATED - 86380)]
    events = st.parse_claude(lines(previous)).events
    assert st.fold(events, ctx())["state"] == "avviato_mai_partito"


def test_logs_that_cannot_be_read_or_understood_are_unknown():
    assert st.fold([], ctx(readable=False))["reason"] == "fonti_illeggibili"
    assert st.fold([], ctx(unrecognised=True))["reason"] == "formato_non_riconosciuto"


# ── from the files: attribution, the session's start, the 15/10 case ────

class Box:
    """A JHT_HOME with one agent, and the files each CLI would have written."""

    def __init__(self, tmp_path, uid="assistente"):
        self.home = tmp_path / "jht"
        self.uid = uid
        self.cwd = self.home / "agents" / uid
        self.cwd.mkdir(parents=True)
        self.src = st.Sources(self.home)

    def claude(self, objs, name="s1", mtime=None):
        d = self.src.claude / st.claude_slug(str(self.cwd))
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{name}.jsonl"
        p.write_text("\n".join(json.dumps(o) for o in objs) + "\n")
        self._touch(p, mtime)

    def codex(self, objs, cwd=None, name="rollout-2026-10-18T10-00-00-aaa", mtime=None):
        day = datetime.fromtimestamp(NOW).strftime("%Y/%m/%d")
        d = self.src.codex / day
        d.mkdir(parents=True, exist_ok=True)
        meta = {"timestamp": iso(CREATED + 1), "type": "session_meta",
                "payload": {"id": "s", "cwd": cwd or str(self.cwd)}}
        p = d / f"{name}.jsonl"
        p.write_text("\n".join(json.dumps(o) for o in [meta] + objs) + "\n")
        self._touch(p, mtime)

    def kimi(self, objs, log_lines=()):
        d = self.src.kimi / hashlib.md5(str(self.cwd).encode()).hexdigest() / KIMI_SESSION
        d.mkdir(parents=True, exist_ok=True)
        (d / "wire.jsonl").write_text("\n".join(json.dumps(o) for o in objs) + "\n")
        if log_lines:
            self.src.kimi_logs.mkdir(parents=True, exist_ok=True)
            (self.src.kimi_logs / "kimi.2026-10-18_10-00-00_1.log").write_text("\n".join(log_lines) + "\n")
        self._touch(d / "wire.jsonl", None)

    def _touch(self, path, mtime):
        import os
        t = mtime if mtime is not None else NOW - 5
        os.utime(path, (t, t))

    def derive(self, created=CREATED, questions=None):
        return st.derive(self.uid, self.home, created, NOW, questions)


def test_each_cli_is_read_from_the_agents_own_folder(tmp_path):
    for cli, write, expected in (
        ("claude", lambda b: b.claude([c_prompt(T), c_tool(NOW - 20)]), "lavora"),
        ("codex", lambda b: b.codex([x_event(T, "task_started"), x_item(NOW - 20)]), "lavora"),
        ("kimi", lambda b: b.kimi(kimi_turn(T, None) + [k(NOW - 20, "ToolCall")]), "lavora"),
        ("claude", lambda b: b.claude([c_prompt(T), c_done(T + 9)]), "idle"),
        ("codex", lambda b: b.codex([x_event(T, "task_started"), x_event(T + 9, "task_complete")]), "idle"),
        ("kimi", lambda b: b.kimi(kimi_turn(T, None) + [k(T + 9, "TurnEnd")]), "idle"),
    ):
        box = Box(tmp_path / f"{cli}-{expected}-{len(list(tmp_path.iterdir()))}")
        write(box)
        assert box.derive()["state"] == expected, cli


def test_another_agents_log_is_not_mine(tmp_path):
    box = Box(tmp_path)
    other = box.home / "agents" / "scout-1"
    other.mkdir()
    d = box.src.claude / st.claude_slug(str(other))
    d.mkdir(parents=True)
    (d / "x.jsonl").write_text(json.dumps(c_prompt(NOW - 10)) + "\n" + json.dumps(c_tool(NOW - 5)) + "\n")
    box.src.claude.mkdir(parents=True, exist_ok=True)
    assert box.derive()["state"] == "avviato_mai_partito"
    # and a Codex rollout of another cwd
    box.codex([x_event(T, "task_started"), x_item(NOW - 5)], cwd=str(other))
    assert box.derive()["state"] == "avviato_mai_partito"


def test_a_codex_agent_that_wrote_less_recently_than_the_others_is_still_found(tmp_path):
    """The Mentor answered once, then the busy agents wrote their rollouts after it: it ran."""
    box = Box(tmp_path, uid="mentor")
    box.codex([x_event(T, "task_started"), x_event(T + 9, "task_complete")], name="rollout-mentor", mtime=T + 9)
    for n in range(6):
        other = box.home / "agents" / f"scout-{n}"
        other.mkdir()
        box.codex([x_event(T, "task_started"), x_item(NOW - 5)], cwd=str(other), name=f"rollout-scout-{n}")
    v = box.derive()
    assert v["state"] == "idle", v


def test_the_15_october_case_started_but_never_ran(tmp_path):
    """The assistant was alive, its first message stayed in the composer: the
    CLI wrote its metadata and nothing else."""
    cases = {
        "claude": lambda b: b.claude(c_meta(CREATED)),
        "codex": lambda b: b.codex([]),
        "kimi": lambda b: b.kimi([KIMI_META]),
        # a run of the day before is on disk, the new session has written nothing
        "claude-old-run": lambda b: b.claude([c_prompt(CREATED - 86400), c_tool(CREATED - 86390),
                                              c_done(CREATED - 86380)] + c_meta(CREATED), mtime=NOW - 5),
        "no-file-at-all": lambda b: b.src.claude.mkdir(parents=True),
    }
    for name, write in cases.items():
        box = Box(tmp_path / name)
        write(box)
        v = box.derive()
        assert v["state"] == "avviato_mai_partito", (name, v)
        young = box.derive(created=NOW - 30)
        assert (young["state"], young["reason"]) == ("sconosciuto", "avvio_in_corso"), (name, young)


def test_no_log_root_to_read_is_unknown_not_idle(tmp_path):
    box = Box(tmp_path)  # no .claude, .codex or .kimi at all
    v = box.derive()
    assert (v["state"], v["reason"]) == ("sconosciuto", "fonti_illeggibili")


def test_an_agent_with_no_folder_is_unknown(tmp_path):
    box = Box(tmp_path)
    v = st.derive("ghost", box.home, CREATED, NOW)
    assert (v["state"], v["reason"]) == ("sconosciuto", "fonti_illeggibili")


def test_a_log_in_a_format_that_is_not_understood(tmp_path):
    box = Box(tmp_path)
    d = box.src.claude / st.claude_slug(str(box.cwd))
    d.mkdir(parents=True)
    (d / "s.jsonl").write_text("\n".join(json.dumps({"kind": "future", "n": i}) for i in range(8)) + "\n")
    import os
    os.utime(d / "s.jsonl", (NOW - 5, NOW - 5))
    v = box.derive()
    assert (v["state"], v["reason"]) == ("sconosciuto", "formato_non_riconosciuto")


def test_a_writers_critic_folder_is_found_with_the_capital_s(tmp_path):
    box = Box(tmp_path, uid="critico-S2")
    box.claude([c_prompt(T), c_tool(NOW - 5)])
    assert st.derive("critico-s2", box.home, CREATED, NOW)["state"] == "lavora"


def test_a_kimi_limit_goes_through_the_log_of_the_machine(tmp_path):
    box = Box(tmp_path)
    failed = kimi_turn(T, None, progress=False, fast=True) + [k(T + 1.6, "TurnEnd")]
    box.kimi(failed, [k_403(T + 1.6, KIMI_SESSION)])
    v = box.derive()
    assert (v["state"], v["reason"]) == ("bloccato", "limite_fornitore")


def test_the_cpu_and_the_question_are_read_from_the_box(tmp_path):
    box = Box(tmp_path)
    box.claude([c_prompt(NOW - 2100), c_tool(NOW - 2000)])
    logs = box.home / "logs"
    logs.mkdir()
    (logs / "agent-vitals.jsonl").write_text(
        json.dumps({"ts": iso(NOW - 10), "agents": {"assistente": {"cpu_pct": 55.0}}}) + "\n")
    assert box.derive(created=OLD_SESSION)["state"] == "lavora"
    (logs / "agent-vitals.jsonl").write_text(
        json.dumps({"ts": iso(NOW - 10), "agents": {"assistente": {"cpu_pct": 1.0}}}) + "\n")
    assert box.derive(created=OLD_SESSION)["reason"] == "turno_silenzioso"

    box2 = Box(tmp_path / "q")
    box2.claude([c_prompt(T), c_tool(T + 5), c_done(T + 20)])
    db = tmp_path / "jobs.db"
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE pending_user_messages (id INTEGER PRIMARY KEY, agent TEXT, body TEXT, kind TEXT, "
                "author TEXT, user_reply TEXT, created_at TEXT)")
    stamp = datetime.fromtimestamp(T + 15, tz=timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    con.execute("INSERT INTO pending_user_messages (agent, body, kind, author, user_reply, created_at) "
                "VALUES ('assistente', 'procedo?', 'question', 'agent', NULL, ?)", (stamp,))
    con.execute("INSERT INTO pending_user_messages (agent, body, kind, author, user_reply, created_at) "
                "VALUES ('assistente', 'gia risposta', 'question', 'agent', 'si', ?)", (stamp,))
    con.commit()
    con.close()
    questions = st.read_questions(str(db), NOW)
    assert questions["assistente"]["body"] == "procedo?"
    assert box2.derive(questions=questions)["state"] == "aspetta_umano"
    assert st.read_questions(str(tmp_path / "missing.db"), NOW) == {}


# ── the vocabulary ──────────────────────────────────────────────────────

def test_every_reason_the_module_emits_is_declared():
    emitted = {st.verdict(*a)["reason"] for a in (("bloccato", r) for r in st.REASONS["bloccato"])}
    assert emitted == set(st.REASONS["bloccato"])
    source = (ROOT / "shared/skills/agent_state.py").read_text(encoding="utf-8")
    import re
    quoted = set(re.findall(r'"((?:limite|rete|errore|fonti|formato|turno|avvio)[a-z0-9_]*)"', source))
    declared = {r for rs in st.REASONS.values() for r in rs}
    assert quoted <= declared, quoted - declared
    assert declared <= quoted, declared - quoted


# ── how full the context is (the panel's health in small) ─────────────

def x_tokens(ts, total, window=258400):
    return x_event(ts, "token_count", info={
        "total_token_usage": {"input_tokens": total * 3, "total_tokens": total * 3},
        "last_token_usage": {"input_tokens": total - 500, "cached_input_tokens": 1000,
                             "output_tokens": 500, "reasoning_output_tokens": 100, "total_tokens": total},
        "model_context_window": window}, rate_limits=None)


def c_usage(ts, sidechain=False, **usage):
    line = {"type": "assistant", "timestamp": iso(ts),
            "message": {"stop_reason": "tool_use", "content": [], "usage": usage}}
    if sidechain:
        line["isSidechain"] = True
    return line


def test_codex_says_the_context_of_its_last_call_against_its_own_window(tmp_path):
    box = Box(tmp_path)
    box.codex([x_event(T, "task_started"),
               x_event(T + 1, "token_count", info=None, rate_limits={}),  # the first one has no reading
               x_tokens(T + 5, 51680), x_item(T + 6), x_tokens(NOW - 20, 129200)])
    v = box.derive()
    assert v["state"] == "lavora"
    assert v["context"] == {"at": round(NOW - 20, 3), "tokens": 129200, "window": 258400, "pct": 50.0}


def test_kimi_says_the_share_of_its_context(tmp_path):
    box = Box(tmp_path)
    box.kimi(kimi_turn(T, None) + [k(NOW - 30, "StatusUpdate", context_usage=0.1234,
                                     token_usage={"input_other": 10, "output": 5})])
    assert box.derive()["context"] == {"at": NOW - 30, "tokens": None, "window": None, "pct": 12.3}


def test_claude_says_the_tokens_and_not_the_window_so_the_share_is_not_known(tmp_path):
    box = Box(tmp_path)
    box.claude([c_prompt(T),
                c_usage(T + 5, input_tokens=4, cache_creation_input_tokens=2000,
                        cache_read_input_tokens=80000, output_tokens=300),
                # a subagent's call fills its own context, not the agent's
                c_usage(NOW - 10, sidechain=True, input_tokens=5, cache_read_input_tokens=900000)])
    assert box.derive()["context"] == {"at": T + 5, "tokens": 82304, "window": None, "pct": None}


def test_no_reading_or_a_previous_runs_reading_is_no_context(tmp_path):
    box = Box(tmp_path / "none")
    box.codex([x_event(T, "task_started"), x_item(NOW - 20)])
    assert "context" not in box.derive()
    old = Box(tmp_path / "old")
    old.claude([c_prompt(CREATED - 3600), c_usage(CREATED - 3590, input_tokens=9, output_tokens=1),
                c_prompt(T), c_tool(NOW - 20)])
    assert "context" not in old.derive()
    # a count that is not one is dropped, never shown
    odd = Box(tmp_path / "odd")
    odd.codex([x_event(T, "task_started"), x_event(NOW - 20, "token_count", info={
        "last_token_usage": {"total_tokens": True}, "model_context_window": "big"})])
    assert "context" not in odd.derive()
    assert st._context(NOW, 300000, 258400)["pct"] == 100.0
    assert st._context(NOW, share=1.7) is None
