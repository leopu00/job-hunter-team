"""The web search of the agents on pi: the provider's hosted search tool, added by our extension.

The extension (shared/runtime/pi-harness/web-search.js) is run by node against a fake `pi` that records its handlers and
the entries it appends: it must add the hosted search of OpenAI (Responses API), Anthropic (Messages API, with a cap per
turn by role) and Z.ai (chat completions, only when turned on), leave every other request exactly as pi built it while
SAYING the search is missing (session entry and log), count the searches of the stream and write them, with the
provider, at the end of the turn. Made-up payloads; nothing here reaches a network.
"""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
EXTENSION = ROOT / "shared" / "runtime" / "pi-harness" / "web-search.js"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node required")

DRIVER = r"""
const fs = require("node:fs");
const handlers = {};
const entries = [];
require(process.argv[2])({
  on: (name, fn) => { (handlers[name] ||= []).push(fn); },
  appendEntry: (type, data) => { if (process.env.FAIL_APPEND) throw new Error("disk full"); entries.push([type, data]); },
  sendUserMessage: (text) => { entries.push(["user-message", text]); },
});
const results = [];
for (const step of JSON.parse(fs.readFileSync(0, "utf8"))) {
  const out = [];
  for (const fn of handlers[step.event] || []) out.push(fn(step.event_data, step.ctx));
  results.push(out.length === 1 ? (out[0] === undefined ? null : out[0]) : out);
}
process.stdout.write(JSON.stringify({ results, entries }));
"""

OPENAI = {"model": {"provider": "openai", "api": "openai-responses", "id": "gpt-x"}}
FUNCTION = {"type": "function", "name": "read", "parameters": {"type": "object"}}


def run(steps, tmp_path: Path, env_extra=None):
    import os
    driver = tmp_path / "driver.js"
    driver.write_text(DRIVER, encoding="utf-8")
    env = {**os.environ, "JHT_HOME": str(tmp_path / "home")}
    env.pop("PI_CODING_AGENT_DIR", None)
    env.update(env_extra or {})
    done = subprocess.run(["node", str(driver), str(EXTENSION)], input=json.dumps(steps), capture_output=True,
                          text=True, env=env, timeout=30)
    assert done.returncode == 0, done.stderr
    return json.loads(done.stdout)


def request(payload, ctx=OPENAI):
    return {"event": "before_provider_request", "event_data": {"payload": payload}, "ctx": ctx}


def log_of(tmp_path: Path) -> list[dict]:
    path = tmp_path / "home" / "logs" / "pi-web-search.log"
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()] if path.exists() else []


# --- the tool is added where it exists ---------------------------------------------------------------------------

def test_openai_responses_gets_the_hosted_search_next_to_its_own_tools(tmp_path):
    payload = {"model": "gpt-x", "input": [], "tools": [FUNCTION]}
    before = copy.deepcopy(payload)
    got = run([request(payload)], tmp_path)
    assert got["results"][0]["tools"] == [FUNCTION, {"type": "web_search"}]
    assert {k: v for k, v in got["results"][0].items() if k != "tools"} == {"model": "gpt-x", "input": []}
    assert payload == before, "the original payload is not mutated"


def test_openai_responses_without_a_tools_key_gets_just_the_search(tmp_path):
    """pi declares the function tools of OpenAI models as an `additional_tools` item of the input, not in `tools`."""
    got = run([request({"model": "gpt-x", "input": [{"role": "developer", "type": "additional_tools"}]})], tmp_path)
    assert got["results"][0]["tools"] == [{"type": "web_search"}]
    assert got["results"][0]["input"] == [{"role": "developer", "type": "additional_tools"}]


def test_a_search_already_there_is_not_added_twice(tmp_path):
    payload = {"tools": [{"type": "web_search", "search_context_size": "low"}, FUNCTION]}
    assert run([request(payload)], tmp_path)["results"][0] is None


def test_the_search_is_announced_on_once_per_session(tmp_path):
    got = run([request({"tools": []}), request({"tools": []}), request({"tools": []})], tmp_path)
    assert got["entries"] == [["jht-web-search-status", {"enabled": True, "provider": "openai", "api": "openai-responses"}]]
    assert [line["event"] for line in log_of(tmp_path)] == ["web_search_on"]


# --- everywhere else the request is untouched and the lack is said ---------------------------------------------

@pytest.mark.parametrize(("model", "why"), [
    ({"provider": "openai", "api": "openai-completions"}, "only on its openai-responses API"),
    ({"provider": "openai", "api": "openai-codex-responses"}, "only on its openai-responses API"),
    ({"provider": "anthropic", "api": "openai-completions"}, "only on its anthropic-messages API"),
    ({"provider": "azure-openai-responses", "api": "azure-openai-responses"}, "no hosted web search tool is known"),
    ({"provider": "moonshotai", "api": "openai-completions"}, "Kimi has no hosted search tool"),
    ({"provider": "zai", "api": "openai-completions"}, "JHT_PI_WEB_SEARCH_ZAI=1"),
    ({"provider": "someone-else", "api": "openai-responses"}, "no hosted web search tool is known"),
    ({"provider": "openai"}, "only on its openai-responses API"),
    ({}, "no hosted web search tool is known"),
    (None, "no hosted web search tool is known"),
])
def test_any_other_provider_or_api_keeps_the_request_as_it_is_and_says_so(tmp_path, model, why):
    got = run([request({"tools": [FUNCTION]}, {"model": model}), request({"tools": [FUNCTION]}, {"model": model})], tmp_path)
    assert got["results"] == [None, None], "returning nothing keeps pi's own payload"
    [entry] = got["entries"]
    assert entry[0] == "jht-web-search-status" and entry[1]["enabled"] is False and why in entry[1]["reason"]
    assert [line["event"] for line in log_of(tmp_path)] == ["web_search_unavailable"], "once, not once per request"
    assert log_of(tmp_path)[0]["enabled"] is False


def test_a_context_without_a_model_or_a_payload_that_is_not_an_object_never_breaks_the_request(tmp_path):
    steps = [{"event": "before_provider_request", "event_data": None, "ctx": None},
             {"event": "before_provider_request", "event_data": {"payload": "text"}, "ctx": OPENAI},
             {"event": "before_provider_request", "event_data": {}, "ctx": OPENAI}]
    assert run(steps, tmp_path)["results"] == [None, None, None]


def test_an_unwritable_log_does_not_touch_the_request(tmp_path):
    blocked = tmp_path / "home"
    blocked.write_text("a file where the logs folder should be", encoding="utf-8")
    got = run([request({"tools": []})], tmp_path)
    assert got["results"][0]["tools"] == [{"type": "web_search"}]


def test_a_session_that_refuses_the_entry_still_leaves_the_log(tmp_path):
    got = run([request({"tools": []}, {"model": {"provider": "moonshotai", "api": "openai-completions"}})], tmp_path,
              {"FAIL_APPEND": "1"})
    assert got["results"] == [None] and got["entries"] == []
    assert [line["event"] for line in log_of(tmp_path)] == ["web_search_unavailable"]


# --- counting the searches ---------------------------------------------------------------------------------------

def stream(item_type, event_type="response.output_item.done"):
    return {"event": "provider_stream_event", "event_data": {"data": {"type": event_type, "item": {"type": item_type}}}}


TURN_END = {"event": "turn_end", "event_data": {}}


OPENAI_ON = request({"tools": []})
COUNTS = lambda got: [e for e in got["entries"] if e[0] == "jht-web-search"]  # noqa: E731


def test_each_finished_search_call_is_counted_and_written_at_the_end_of_the_turn(tmp_path):
    steps = [OPENAI_ON, stream("web_search_call"), stream("message"), stream("web_search_call"), TURN_END]
    assert run(steps, tmp_path)["entries"][-1] == ["jht-web-search", {"searches": 2, "provider": "openai"}]


def test_only_a_finished_search_counts_not_one_that_is_starting(tmp_path):
    steps = [OPENAI_ON, stream("web_search_call", "response.output_item.added"),
             stream("web_search_call", "response.web_search_call.completed"), TURN_END]
    assert COUNTS(run(steps, tmp_path)) == []


def test_a_turn_without_searches_writes_nothing_and_the_count_restarts_each_turn(tmp_path):
    steps = [OPENAI_ON, TURN_END, stream("web_search_call"), TURN_END, TURN_END, stream("web_search_call"), TURN_END]
    assert COUNTS(run(steps, tmp_path)) == [["jht-web-search", {"searches": 1, "provider": "openai"}]] * 2


def test_a_stream_event_with_no_search_on_counts_nothing(tmp_path):
    """Before any request, or on a provider without the search, an event that looks like a search is not one of ours."""
    moon = request({"tools": []}, {"model": {"provider": "moonshotai", "api": "openai-completions"}})
    steps = [stream("web_search_call"), TURN_END, moon, stream("web_search_call"), TURN_END]
    assert COUNTS(run(steps, tmp_path)) == []


def test_garbage_in_the_stream_is_ignored(tmp_path):
    steps = [OPENAI_ON, {"event": "provider_stream_event", "event_data": None}, {"event": "provider_stream_event", "event_data": {"data": 7}},
             {"event": "provider_stream_event", "event_data": {"data": {"type": "response.output_item.done", "item": None}}},
             {"event": "provider_stream_event", "event_data": {"data": {"type": "message_delta", "usage": "x"}}}, TURN_END]
    assert COUNTS(run(steps, tmp_path)) == []


def test_a_count_that_cannot_be_written_is_logged_not_lost_silently(tmp_path):
    steps = [OPENAI_ON, stream("web_search_call"), TURN_END]
    run(steps, tmp_path, {"FAIL_APPEND": "1"})
    assert log_of(tmp_path)[-1] == {**log_of(tmp_path)[-1], "event": "web_search_count_lost", "searches": 1}


def test_the_extension_has_no_dependency_and_no_network_in_it():
    text = EXTENSION.read_text(encoding="utf-8")
    requires = {line.split('require("')[1].split('")')[0] for line in text.splitlines() if 'require("' in line}
    assert requires <= {"node:fs", "node:path"}
    for word in ("http", "fetch(", "child_process", "XMLHttpRequest", "net."):
        assert word not in text.replace("https://", ""), word


# --- Anthropic: the server tool of the Messages API ---------------------------------------------------------------

ANTHROPIC = {"model": {"provider": "anthropic", "api": "anthropic-messages", "id": "claude-haiku-5-5"}}


def anthropic_event(data):
    return {"event": "provider_stream_event", "event_data": {"data": data}}


def search_block(name="web_search"):
    return anthropic_event({"type": "content_block_start", "index": 1,
                            "content_block": {"type": "server_tool_use", "id": "srvtoolu_1", "name": name}})


def usage(n):
    return anthropic_event({"type": "message_delta", "delta": {"stop_reason": "end_turn"},
                            "usage": {"output_tokens": 9, "server_tool_use": {"web_search_requests": n}}})


STOP = anthropic_event({"type": "message_stop"})


@pytest.mark.parametrize(("agent", "env", "cap"), [
    ("analista-2", {}, 3), ("scout-1", {}, 3), ("mentor", {}, 5), ("capitano", {}, 3), ("", {}, 3),
    ("analista-1", {"JHT_PI_WEB_SEARCH_MAX_USES": "7"}, 7), ("analista-1", {"JHT_PI_WEB_SEARCH_MAX_USES": "99"}, 3),
])
def test_anthropic_gets_its_server_search_with_a_cap_per_turn_by_role(tmp_path, agent, env, cap):
    payload = {"model": "claude-haiku-5-5", "tools": [FUNCTION], "messages": []}
    got = run([request(payload, ANTHROPIC)], tmp_path, {"JHT_AGENT_NAME": agent, **env})
    assert got["results"][0]["tools"] == [FUNCTION, {"type": "web_search_20250305", "name": "web_search", "max_uses": cap}]
    assert got["entries"] == [["jht-web-search-status", {"enabled": True, "provider": "anthropic", "api": "anthropic-messages"}]]


def test_anthropic_without_tools_gets_just_the_search_and_a_search_already_there_is_kept(tmp_path):
    got = run([request({"messages": []}, ANTHROPIC),
               request({"tools": [{"type": "web_search_20260209", "name": "web_search"}]}, ANTHROPIC)], tmp_path)
    assert got["results"][0]["tools"] == [{"type": "web_search_20250305", "name": "web_search", "max_uses": 3}]
    assert got["results"][1] is None


def test_anthropic_counts_the_searches_the_usage_bills(tmp_path):
    """Two searches started, one failed: the usage says 1, and a failed search is not billed."""
    steps = [request({}, ANTHROPIC), search_block(), search_block(), usage(1), STOP, TURN_END]
    assert COUNTS(run(steps, tmp_path)) == [["jht-web-search", {"searches": 1, "provider": "anthropic"}]]


def test_anthropic_without_the_usage_counts_the_search_blocks_and_each_request_of_the_turn(tmp_path):
    steps = [request({}, ANTHROPIC), search_block(), search_block("code_execution"), STOP,
             request({}, ANTHROPIC), search_block(), usage(2), STOP, TURN_END]
    assert COUNTS(run(steps, tmp_path)) == [["jht-web-search", {"searches": 3, "provider": "anthropic"}]]


def test_anthropic_a_request_cut_before_its_stop_still_counts_at_the_end_of_the_turn(tmp_path):
    steps = [request({}, ANTHROPIC), search_block(), usage(1), TURN_END]
    assert COUNTS(run(steps, tmp_path)) == [["jht-web-search", {"searches": 1, "provider": "anthropic"}]]


def test_anthropic_a_reply_with_no_search_counts_nothing(tmp_path):
    steps = [request({}, ANTHROPIC), anthropic_event({"type": "content_block_start", "index": 0,
                                                      "content_block": {"type": "tool_use", "name": "bash"}}),
             usage(0), STOP, TURN_END]
    assert COUNTS(run(steps, tmp_path)) == []


# --- Z.ai: on only when turned on ------------------------------------------------------------------------------

ZAI = {"model": {"provider": "zai", "api": "openai-completions", "id": "glm-5.3"}}
ZAI_TOOL = {"type": "web_search", "web_search": {"enable": True, "search_engine": "search-prime", "search_result": True, "count": 5}}


def test_zai_gets_its_search_when_turned_on_and_counts_one_per_response(tmp_path):
    chunk = lambda extra: {"event": "provider_stream_event", "event_data": {"data": {"choices": [], **extra}}}  # noqa: E731
    steps = [request({"tools": [FUNCTION]}, ZAI), chunk({"web_search": [{"title": "t", "link": "l"}]}),
             chunk({"web_search": [{"title": "t", "link": "l"}]}), chunk({}), TURN_END,
             request({"tools": [FUNCTION]}, ZAI), chunk({"web_search": []}), TURN_END]
    got = run(steps, tmp_path, {"JHT_PI_WEB_SEARCH_ZAI": "1"})
    assert got["results"][0]["tools"] == [FUNCTION, ZAI_TOOL]
    assert COUNTS(got) == [["jht-web-search", {"searches": 1, "provider": "zai"}]]
    assert [line["event"] for line in log_of(tmp_path)] == ["web_search_on"]


# --- the off switch, and the withdrawal after a refusal -----------------------------------------------------------

def response(status):
    return {"event": "after_provider_response", "event_data": {"status": status, "headers": {}}, "ctx": ANTHROPIC}


def test_the_off_switch_adds_no_search_for_any_provider_and_says_why(tmp_path):
    got = run([request({"tools": []}), request({"tools": []}, ANTHROPIC)], tmp_path, {"JHT_PI_WEB_SEARCH": "0"})
    assert got["results"] == [None, None]
    [entry] = got["entries"]
    assert entry[1]["enabled"] is False and "JHT_PI_WEB_SEARCH=0" in entry[1]["reason"]


@pytest.mark.parametrize("status", [400, 403, 404, 422])
def test_a_refused_request_that_carried_the_search_withdraws_it_for_the_session(tmp_path, status):
    """The organization has the search off, or the model does not take it: one request fails, the next go as pi built them."""
    steps = [request({"tools": [FUNCTION]}, ANTHROPIC), response(status),
             request({"tools": [FUNCTION]}, ANTHROPIC), request({"tools": [FUNCTION]}, ANTHROPIC)]
    got = run(steps, tmp_path)
    assert got["results"][0]["tools"][-1]["name"] == "web_search"
    assert got["results"][2:] == [None, None]
    assert got["entries"][-1][1]["enabled"] is False and f"HTTP {status}" in got["entries"][-1][1]["reason"]
    assert [line["event"] for line in log_of(tmp_path)] == ["web_search_on", "web_search_withdrawn"]
    assert log_of(tmp_path)[-1]["status"] == status


def test_after_a_refusal_the_agent_is_asked_once_to_repeat_its_step_without_the_search(tmp_path):
    settled = {"event": "agent_settled", "event_data": {}}
    steps = [settled, request({"tools": []}, ANTHROPIC), response(400), settled, request({"tools": []}, ANTHROPIC), settled]
    got = run(steps, tmp_path)
    asked = [e for e in got["entries"] if e[0] == "user-message"]
    assert len(asked) == 1 and "HTTP 400" in asked[0][1] and "without searching the web" in asked[0][1]
    assert got["results"][4] is None, "the step asked again goes without the tool"
    assert [line["event"] for line in log_of(tmp_path)][-1] == "web_search_retry_asked"


@pytest.mark.parametrize("status", [200, 429, 500, 529])
def test_a_rate_limit_or_a_server_error_withdraws_nothing(tmp_path, status):
    steps = [request({"tools": []}, ANTHROPIC), response(status), request({"tools": []}, ANTHROPIC)]
    got = run(steps, tmp_path)
    assert got["results"][2]["tools"][-1]["name"] == "web_search"
    assert "web_search_withdrawn" not in [line["event"] for line in log_of(tmp_path)]


def test_a_refusal_of_a_request_without_our_tool_is_not_ours_to_answer(tmp_path):
    moon = request({"tools": []}, {"model": {"provider": "moonshotai", "api": "openai-completions"}})
    steps = [moon, response(400), request({"tools": [{"type": "web_search_20250305", "name": "web_search"}]}, ANTHROPIC),
             response(400), request({"tools": []}, ANTHROPIC)]
    got = run(steps, tmp_path)
    assert got["results"][2] is None, "a tool the request already had is not added by us"
    assert got["results"][4]["tools"][-1]["name"] == "web_search", "no refusal of ours: the search stays"
    assert "web_search_withdrawn" not in [line["event"] for line in log_of(tmp_path)]


# --- the person's data in a query: checked in memory, only the outcome written ------------------------------------

# A made-up person: none of these values may reach the session, the log or the output.
PERSON_PROFILE = """\
# synthetic profile for the test
candidate:
  name: "Noemì Brambillone"
  target_role: impiegata amministrativa
contacts:
  email: noemi.brambillone@example.com  # a comment
  phone: "+39 345 123 4567"
experience:
  - name: Acme Ricambi
    role: back office
"""
SECRETS = ("noemì", "noemi", "brambillone", "example.com", "1234567", "345 123")
CHECKS = lambda got: [e[1] for e in got["entries"] if e[0] == "jht-web-search-check"]  # noqa: E731


def with_profile(tmp_path: Path, text: str = PERSON_PROFILE) -> None:
    profile = tmp_path / "home" / "profile"
    profile.mkdir(parents=True, exist_ok=True)
    (profile / "candidate_profile.yml").write_text(text, encoding="utf-8")


def anthropic_search(query: str, index: int = 1, pieces: int = 3) -> list[dict]:
    """A server search block whose query arrives in pieces of input_json_delta, as the Messages API streams it."""
    payload = json.dumps({"query": query})
    size = -(-len(payload) // pieces)
    return ([anthropic_event({"type": "content_block_start", "index": index, "content_block": {
                "type": "server_tool_use", "id": f"srvtoolu_{index}", "name": "web_search", "input": {}}})]
            + [anthropic_event({"type": "content_block_delta", "index": index, "delta": {
                "type": "input_json_delta", "partial_json": payload[i:i + size]}}) for i in range(0, len(payload), size)]
            + [anthropic_event({"type": "content_block_stop", "index": index})])


def everything_written(tmp_path: Path, got: dict) -> str:
    path = tmp_path / "home" / "logs" / "pi-web-search.log"
    return (json.dumps(got) + (path.read_text(encoding="utf-8") if path.exists() else "")).lower()


def test_a_query_with_the_person_s_name_is_counted_by_kind_and_nothing_of_it_is_written(tmp_path):
    with_profile(tmp_path)
    query = "Noemi BRAMBILLONE impiegata Verona"
    steps = [request({"tools": []}, ANTHROPIC), *anthropic_search(query), usage(1), STOP, TURN_END]
    got = run(steps, tmp_path, {"JHT_AGENT_NAME": "analista-2"})
    assert CHECKS(got) == [{"queries": 1, "person_data": 1, "kinds": ["name"]}]
    breach = [e for e in log_of(tmp_path) if e["event"] == "web_search_person_data"]
    assert breach == [{**breach[0], "kinds": ["name"], "role": "analista-2"}]
    written = everything_written(tmp_path, got)
    for secret in (*SECRETS, query.lower(), "impiegata verona"):
        assert secret not in written, secret


def test_the_phone_behind_any_prefix_and_the_email_in_any_case_are_found_a_clean_query_is_not(tmp_path):
    with_profile(tmp_path)
    steps = [request({"tools": []}, ANTHROPIC),
             *anthropic_search("contatto 0039 345-123 4567", 1), *anthropic_search("noemi.brambillone@example.com cv".upper(), 2),
             *anthropic_search("Synergie Italia Verona recensioni", 3), usage(3), STOP, TURN_END]
    got = run(steps, tmp_path)
    # the email carries the name too: both kinds are said, the breach counted once per query
    assert CHECKS(got) == [{"queries": 3, "person_data": 2, "kinds": ["name", "email", "phone"]}]
    assert COUNTS(got) == [["jht-web-search", {"searches": 3, "provider": "anthropic"}]]
    for secret in SECRETS:
        assert secret not in everything_written(tmp_path, got), secret


def test_one_word_of_the_name_or_a_name_from_a_list_of_the_profile_is_not_the_person(tmp_path):
    """The surname alone can be a company or a street; Acme Ricambi is a past employer, not the person."""
    with_profile(tmp_path)
    steps = [request({"tools": []}, ANTHROPIC), *anthropic_search("Brambillone srl Verona"),
             *anthropic_search("Acme Ricambi sede", 2), STOP, TURN_END]
    assert CHECKS(run(steps, tmp_path)) == [{"queries": 2, "person_data": 0, "kinds": []}]


def test_openai_s_search_call_carries_its_query_and_it_is_checked_too(tmp_path):
    with_profile(tmp_path)
    call = {"event": "provider_stream_event", "event_data": {"data": {"type": "response.output_item.done", "item": {
        "type": "web_search_call", "action": {"type": "search", "query": "noemi brambillone linkedin"}}}}}
    got = run([OPENAI_ON, call, TURN_END], tmp_path)
    assert CHECKS(got) == [{"queries": 1, "person_data": 1, "kinds": ["name"]}]
    assert "brambillone" not in everything_written(tmp_path, got)


@pytest.mark.parametrize("profile", [None, "too big", "a folder", "not yaml: [\x00"])
def test_without_a_readable_profile_the_check_says_unavailable_and_the_search_goes_on(tmp_path, profile):
    if profile == "too big":
        with_profile(tmp_path, PERSON_PROFILE + "#" * (300 * 1024))
    elif profile == "a folder":
        (tmp_path / "home" / "profile" / "candidate_profile.yml").mkdir(parents=True)
    elif profile is not None:
        with_profile(tmp_path, profile)
    steps = [request({"tools": []}, ANTHROPIC), *anthropic_search("noemi brambillone"), STOP, TURN_END,
             request({"tools": []}, ANTHROPIC)]
    got = run(steps, tmp_path)
    expected = [{"queries": 1, "check": "unavailable"}] if profile in (None, "too big", "a folder") else \
        [{"queries": 1, "person_data": 0, "kinds": []}]
    assert CHECKS(got) == expected
    assert got["results"][-1]["tools"][-1]["name"] == "web_search", "the search is still added"
    if profile in (None, "too big", "a folder"):
        assert [e["event"] for e in log_of(tmp_path)].count("web_search_check_unavailable") == 1


def test_a_turn_without_queries_writes_no_check_and_a_broken_query_block_breaks_nothing(tmp_path):
    with_profile(tmp_path)
    broken = [anthropic_event({"type": "content_block_start", "index": 1, "content_block": {
                  "type": "server_tool_use", "id": "s", "name": "web_search", "input": {}}}),
              anthropic_event({"type": "content_block_delta", "index": 1, "delta": {
                  "type": "input_json_delta", "partial_json": "{\"query\": \"noemi"}}),
              anthropic_event({"type": "content_block_stop", "index": 1})]
    got = run([request({"tools": []}, ANTHROPIC), STOP, TURN_END, *broken, STOP, TURN_END], tmp_path)
    assert CHECKS(got) == []


def test_a_search_input_longer_than_the_cap_is_dropped_not_kept_growing(tmp_path):
    """The streamed input of a block is kept up to 4096 characters; beyond, it is let go and its query not checked."""
    with_profile(tmp_path)
    steps = [request({"tools": []}, ANTHROPIC), *anthropic_search("noemi brambillone " + "x" * 5000, pieces=8),
             *anthropic_search("noemi brambillone", 2), STOP, TURN_END]
    assert CHECKS(run(steps, tmp_path)) == [{"queries": 1, "person_data": 1, "kinds": ["name"]}]
