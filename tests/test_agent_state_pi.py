"""Pi as a fourth CLI of agent_state / agent_observer: parse_pi, discovery by cwd, identity, context.

Synthetic sessions shaped like Pi's (docs/session-format.md of the pinned Pi, entry types and
stopReason values checked on real Pi sessions: only the structure, no
content). Nothing is started: no Pi, no tmux, no network.
"""
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "shared/skills"))
import agent_state as st
from agent_observer import Observer
from agent_pi_log import block_reason, pi_slug, sessions_root
from agent_session_identity import identity

NOW = 1_790_000_000.0
CREATED = NOW - 300.0
OLD_SESSION = NOW - 5000
T = CREATED + 10


def iso(ts):
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def header(cwd, ts=CREATED + 1):
    return {"type": "session", "version": 3, "id": "00000000-0000-4000-8000-000000000001",
            "timestamp": iso(ts), "cwd": cwd}


def entry(ts, role, **message):
    return {"type": "message", "id": "a1b2c3d4", "parentId": None, "timestamp": iso(ts),
            "message": {"role": role, "content": [], "timestamp": int(ts * 1000), **message}}


def p_user(ts):
    return entry(ts, "user", content="go")


def p_tool(ts, total=1000):
    return entry(ts, "assistant", stopReason="toolUse", model="m-1", usage={"totalTokens": total})


def p_result(ts):
    return entry(ts, "toolResult", toolName="bash", isError=False)


def p_say(ts, total=1200, stop="stop"):
    return entry(ts, "assistant", stopReason=stop, model="m-1", usage={"totalTokens": total})


def p_abort(ts):
    return entry(ts, "assistant", stopReason="aborted", errorMessage="Operation aborted", usage={"totalTokens": 0})


def p_error(ts, text):
    return entry(ts, "assistant", stopReason="error", errorMessage=text, usage={"totalTokens": 0})


def p_change(ts, kind="model_change", **fields):
    return {"type": kind, "id": "e5f6g7h8", "parentId": None, "timestamp": iso(ts), **fields}


def lines(objs):
    return [json.dumps(o) for o in objs]


def state_of(objs, **kw):
    parsed = __import__("agent_pi_log").parse_pi(st, lines(objs))
    v = st.fold(parsed.events, st.Ctx(now=NOW, session_created=kw.pop("session_created", OLD_SESSION),
                                      readable=True, **kw))
    return v["state"], v.get("reason")


CASES = {
    "working": ([header("/x"), p_user(T), p_tool(NOW - 20)], ("lavora", None)),
    "working-after-a-result": ([header("/x"), p_user(T), p_tool(T + 1), p_result(NOW - 5)], ("lavora", None)),
    "answered": ([header("/x"), p_user(T), p_tool(T + 3), p_result(T + 4), p_say(T + 9)], ("idle", None)),
    "cut-by-the-length": ([header("/x"), p_user(T), p_say(T + 9, stop="length")], ("idle", None)),
    "esc": ([header("/x"), p_user(T), p_tool(T + 3), p_abort(T + 4)], ("idle", None)),
    "setting-the-model-is-not-work": ([header("/x"), p_change(NOW - 20), p_change(NOW - 19, "thinking_level_change",
                                                                               thinkingLevel="high")],
                                      ("avviato_mai_partito", None)),
    "network": ([header("/x"), p_user(T), p_error(T + 3, "Connection error.")], ("bloccato", "rete")),
    "limit": ([header("/x"), p_user(T), p_error(T + 3, "429 Rate limit reached for requests")],
              ("bloccato", "limite_fornitore")),
    # Z.ai on an empty balance (made-up body in its shape): a 429 too, but it needs a top-up, not a wait
    "credit": ([header("/x"), p_user(T), p_error(T + 3, '429 {"code":"1113","message":"Insufficient balance or no resource '
                                                         'package. Please recharge."}')],
               ("bloccato", "credito_esaurito")),
    "login-refused": ([header("/x"), p_user(T), p_error(T + 3, 'OpenAI API error (401): {"error":{"message":"Incorrect API key provided."}}')],
                      ("bloccato", "accesso_scaduto")),
    "no-key-inside-a-run": ([header("/x"), p_user(T), p_tool(T + 2), p_error(T + 3, "No API key found for openai.")],
                            ("bloccato", "accesso_scaduto")),
    "other-error": ([header("/x"), p_user(T), p_error(T + 3, "400: bad request")], ("bloccato", "errore_fornitore")),
    # Pi retries a transient error inside the same turn: the next message lifts the block
    "retry-went-on": ([header("/x"), p_user(T), p_error(T + 3, "Connection error."),
                       p_error(T + 6, "Connection error."), p_tool(NOW - 10)], ("lavora", None)),
    "retry-answered": ([header("/x"), p_user(T), p_error(T + 3, "Connection error."), p_say(T + 9)], ("idle", None)),
    "new-prompt-after-the-block": ([header("/x"), p_user(T), p_error(T + 3, "Connection error."),
                                    p_user(NOW - 30), p_tool(NOW - 20)], ("lavora", None)),
    "open-and-silent": ([header("/x"), p_user(NOW - 2100), p_tool(NOW - 2000)], ("sconosciuto", "turno_silenzioso")),
    # entries Pi writes without work: compaction, usage, labels, an extension's state
    "side-entries-do-not-reopen-the-turn": ([header("/x"), p_user(T), p_say(T + 9),
                                             {"type": "compaction", "timestamp": iso(NOW - 10), "summary": "s"},
                                             {"type": "usage", "timestamp": iso(NOW - 9), "kind": "cache_warm"},
                                             {"type": "custom", "timestamp": iso(NOW - 8), "customType": "x"}],
                                            ("idle", None)),
}


@pytest.mark.parametrize("name", CASES)
def test_pi_cases(name):
    objs, expected = CASES[name]
    assert state_of(objs) == expected


def test_a_busy_cpu_keeps_a_long_tool_alive():
    objs = [header("/x"), p_user(NOW - 2100), p_tool(NOW - 2000)]
    assert state_of(objs, cpu_pct=40.0, cpu_age_s=10.0) == ("lavora", None)


def test_the_reason_of_an_error_line():
    assert block_reason("Connection error.") == "rete"
    assert block_reason("fetch failed") == "rete"
    assert block_reason("You've hit your usage limit") == "limite_fornitore"
    assert block_reason("rate limit exceeded") == "limite_fornitore"
    assert block_reason("400: request exceeds the available context size") == "errore_fornitore"
    assert block_reason(None) == "errore_fornitore"
    assert block_reason("No API key found for openai.") == "accesso_scaduto"
    assert block_reason('Authentication failed for "openai". Credentials may have expired') == "accesso_scaduto"
    assert block_reason("OpenAI API error (401): Incorrect API key provided") == "accesso_scaduto"
    # the refusals of the two providers that run on a key (made-up bodies in the shape they answer with): the
    # number may be cut off, the sentence is what is left
    assert block_reason("Authentication Fails (no such user)") == "accesso_scaduto"
    assert block_reason("Invalid Authentication") == "accesso_scaduto"
    assert block_reason("The API Key appears to be invalid or may have expired.") == "accesso_scaduto"
    assert block_reason("token expired or incorrect") == "accesso_scaduto"
    # a spent quota is not a login problem, and no limit that frees itself either: it needs a top-up
    assert block_reason('OpenAI API error (429): {"type":"insufficient_quota","code":"insufficient_quota"}') == "credito_esaurito"
    # the two 429 of OpenAI as Pi records them (live capture, 09/11): a spent quota stops at once, a rate limit is retried
    assert block_reason('OpenAI API error (429): {"message":"You exceeded your current quota, please check your plan '
                        'and billing details.","type":"insufficient_quota","param":null,"code":"insufficient_quota"}') \
        == "credito_esaurito"
    assert block_reason('Retry failed after 3 attempts: OpenAI API error (429): {"message":"Rate limit reached for '
                        'gpt-test on tokens per min (TPM): Limit 30000, Used 29500, Requested 2000.",'
                        '"type":"tokens","code":"rate_limit_exceeded"}') == "limite_fornitore"


def test_the_folder_name_is_pis():
    assert pi_slug("/jht_home/agents/scout-1") == "--jht_home-agents-scout-1--"
    assert pi_slug("/Users/x/Work") == "--Users-x-Work--"
    assert pi_slug("C:\\Users\\x") == "--C--Users-x--"


# ── from the files ──────────────────────────────────────────────────────

class Box:
    def __init__(self, tmp_path, uid="scout-1"):
        self.home = tmp_path / "jht"
        self.uid = uid
        self.cwd = self.home / "agents" / uid
        self.cwd.mkdir(parents=True)
        self.src = st.Sources(self.home)

    def pi(self, objs, cwd=None, folder=None, name="2026-11-09T10-00-00-000Z_aaa", mtime=None, with_header=True):
        cwd = cwd or str(self.cwd)
        d = sessions_root(self.src) / (folder or pi_slug(cwd))
        d.mkdir(parents=True, exist_ok=True)
        p = d / f"{name}.jsonl"
        body = ([header(cwd)] if with_header else []) + objs
        p.write_text("\n".join(json.dumps(o) for o in body) + "\n")
        t = mtime if mtime is not None else NOW - 5
        os.utime(p, (t, t))
        return p

    def derive(self, created=CREATED):
        return st.derive(self.uid, self.home, created, NOW)


def test_pi_is_read_from_the_agents_own_folder(tmp_path):
    working = Box(tmp_path / "w")
    working.pi([p_user(T), p_tool(NOW - 20)])
    assert working.derive()["state"] == "lavora"
    idle = Box(tmp_path / "i")
    idle.pi([p_user(T), p_say(T + 9)])
    assert idle.derive()["state"] == "idle"


def test_another_agents_session_is_not_mine(tmp_path):
    box = Box(tmp_path)
    other = box.home / "agents" / "scout-2"
    other.mkdir()
    box.pi([p_user(T), p_tool(NOW - 5)], cwd=str(other))
    assert box.derive()["state"] == "avviato_mai_partito"


def test_a_folder_with_the_same_name_but_another_cwd_is_not_mine(tmp_path):
    """/a/b-c and /a/b/c share a folder name: the header says whose it is."""
    box = Box(tmp_path)
    box.pi([p_user(T), p_tool(NOW - 5)], cwd=str(box.cwd) + "-x", folder=pi_slug(str(box.cwd)))
    assert box.derive()["state"] == "avviato_mai_partito"


def test_the_session_of_a_previous_run_says_nothing_about_this_one(tmp_path):
    box = Box(tmp_path)
    box.pi([p_user(CREATED - 3600), p_say(CREATED - 3590)], mtime=CREATED - 3590)
    assert box.derive()["state"] == "avviato_mai_partito"


def test_the_newest_session_of_the_agent_wins(tmp_path):
    """/new in the TUI opens another file: the one written last speaks."""
    box = Box(tmp_path)
    box.pi([p_user(T), p_say(T + 9)], name="2026-11-09T10-00-00-000Z_old", mtime=T + 9)
    box.pi([p_user(NOW - 30), p_tool(NOW - 20)], name="2026-11-09T10-04-00-000Z_new")
    assert box.derive()["state"] == "lavora"


def test_pi_header_only_is_started_but_never_ran(tmp_path):
    box = Box(tmp_path)
    box.pi([])
    assert box.derive()["state"] == "avviato_mai_partito"
    assert (box.derive(created=NOW - 30)["state"], box.derive(created=NOW - 30)["reason"]) == \
        ("sconosciuto", "avvio_in_corso")


def test_a_pi_session_in_a_format_that_is_not_understood(tmp_path):
    box = Box(tmp_path)
    box.pi([{"kind": "future", "n": i, "timestamp": iso(NOW - 10)} for i in range(8)], with_header=False)
    v = box.derive()
    assert (v["state"], v["reason"]) == ("sconosciuto", "formato_non_riconosciuto")


def test_pi_says_the_tokens_of_its_last_call_and_not_the_share(tmp_path):
    box = Box(tmp_path)
    box.pi([p_user(T), p_tool(T + 5, 40000), p_result(T + 6), p_tool(NOW - 20, 52000), p_abort(NOW - 10)])
    v = box.derive()
    assert v["context"] == {"at": round(NOW - 20, 3), "tokens": 52000, "window": None, "pct": None}


def test_a_call_with_no_count_is_no_context(tmp_path):
    box = Box(tmp_path)
    box.pi([p_user(T), p_tool(NOW - 20, 0)])
    assert "context" not in box.derive()


# ── identity ────────────────────────────────────────────────────────────

def test_identity_is_the_model_and_the_level_pi_recorded():
    records = lines([header("/x"), p_change(T - 1), p_change(T, "thinking_level_change", thinkingLevel="high"),
                     p_user(T + 1), p_tool(T + 2)])
    records[1] = json.dumps(p_change(T - 1, modelId="gpt-test", provider="openai"))
    got = identity("pi", records, CREATED - 5, st)
    # the last assistant message names the model that answered
    assert (got["provider"], got["model"], got["effort"], got["reason"]) == ("pi", "m-1", "high", None)


def test_identity_off_is_none_and_a_level_on_the_message_wins():
    base = [header("/x"), p_change(T - 1, modelId="gpt-test"), p_change(T, "thinking_level_change", thinkingLevel="off")]
    got = identity("pi", lines(base), CREATED - 5, st)
    assert (got["model"], got["effort"]) == ("gpt-test", "none")
    msg = p_tool(T + 2)
    msg["message"]["thinkingLevel"] = "low"
    got = identity("pi", lines(base + [msg]), CREATED - 5, st)
    assert (got["model"], got["effort"]) == ("m-1", "low")


def test_identity_without_a_level_is_not_recorded():
    got = identity("pi", lines([header("/x"), p_change(T - 1, modelId="gpt-test")]), CREATED - 5, st)
    assert (got["model"], got["effort"], got["reason"]) == ("gpt-test", None, "effort_not_recorded")


# ── through the observer ────────────────────────────────────────────────

def test_the_observer_reads_a_pi_agent(tmp_path):
    box = Box(tmp_path)
    box.pi([p_change(T - 1, modelId="gpt-test"), p_change(T - 1, "thinking_level_change", thinkingLevel="medium"),
            p_user(T), p_tool(NOW - 20)])
    observer = Observer(box.home, sessions=lambda: ({"scout-1": {"session": "JHT-SCOUT-1", "created": int(CREATED),
                                                               "pids": []}}, []),
                        processes=lambda: ({}, ["observer_processes_unavailable"]))
    row = next(r for r in observer.sample(now=NOW, monotonic=100.0)["agents"] if r["id"] == "scout-1")
    assert row["state"] == "lavora"
    assert row["identity"]["provider"] == "pi" and row["identity"]["model"] == "m-1"
    assert row["identity"]["effort"] == "medium"


def test_a_key_the_provider_refuses_is_a_blocked_agent_with_the_login_reason_in_the_row(tmp_path):
    """The Assistant of a team on glm with a wrong key (made-up key, made-up answer of the engine): the row the
    CLI reads says «bloccato» and why, so that `jht agents` can name the key and the command that puts it right."""
    box = Box(tmp_path, uid="assistente")
    box.pi([p_user(T), p_error(T + 3, '401 {"error":{"code":"1002","message":"Authentication Fails (made-up key)"}}')])
    observer = Observer(box.home, sessions=lambda: ({"assistente": {"session": "ASSISTENTE", "created": int(CREATED),
                                                                    "pids": []}}, []),
                        processes=lambda: ({}, ["observer_processes_unavailable"]))
    row = next(r for r in observer.sample(now=NOW, monotonic=100.0)["agents"] if r["id"] == "assistente")
    assert (row["state"], row["reason"]) == ("bloccato", "accesso_scaduto")
    assert json.loads(json.dumps(row))["reason"] == "accesso_scaduto"
