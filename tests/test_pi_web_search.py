"""The web search of the agents on pi: the hosted `web_search` tool of OpenAI's Responses API, added by our extension.

The extension (shared/runtime/pi-harness/web-search.js) is run by node against a fake `pi` that records its handlers and
the entries it appends: it must add the tool only for provider `openai` on the Responses API, leave every other request
exactly as pi built it while SAYING the search is missing (session entry and log), count the finished searches of the
stream and write them at the end of the turn. Made-up payloads; nothing here reaches a network.
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

@pytest.mark.parametrize("model", [
    {"provider": "openai", "api": "openai-completions"},
    {"provider": "openai", "api": "openai-codex-responses"},
    {"provider": "azure-openai-responses", "api": "azure-openai-responses"},
    {"provider": "anthropic", "api": "anthropic-messages"},
    {"provider": "someone-else", "api": "openai-responses"},
    {"provider": "openai"},
    {},
    None,
])
def test_any_other_provider_or_api_keeps_the_request_as_it_is_and_says_so(tmp_path, model):
    got = run([request({"tools": [FUNCTION]}, {"model": model}), request({"tools": [FUNCTION]}, {"model": model})], tmp_path)
    assert got["results"] == [None, None], "returning nothing keeps pi's own payload"
    [entry] = got["entries"]
    assert entry[0] == "jht-web-search-status" and entry[1]["enabled"] is False and "Responses API of OpenAI" in entry[1]["reason"]
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
    got = run([request({"tools": []}, {"model": {"provider": "anthropic", "api": "anthropic-messages"}})], tmp_path,
              {"FAIL_APPEND": "1"})
    assert got["results"] == [None] and got["entries"] == []
    assert [line["event"] for line in log_of(tmp_path)] == ["web_search_unavailable"]


# --- counting the searches ---------------------------------------------------------------------------------------

def stream(item_type, event_type="response.output_item.done"):
    return {"event": "provider_stream_event", "event_data": {"data": {"type": event_type, "item": {"type": item_type}}}}


TURN_END = {"event": "turn_end", "event_data": {}}


def test_each_finished_search_call_is_counted_and_written_at_the_end_of_the_turn(tmp_path):
    steps = [request({"tools": []}), stream("web_search_call"), stream("message"), stream("web_search_call"), TURN_END]
    assert run(steps, tmp_path)["entries"][-1] == ["jht-web-search", {"searches": 2}]


def test_only_a_finished_search_counts_not_one_that_is_starting(tmp_path):
    steps = [stream("web_search_call", "response.output_item.added"), stream("web_search_call", "response.web_search_call.completed"), TURN_END]
    assert run(steps, tmp_path)["entries"] == []


def test_a_turn_without_searches_writes_nothing_and_the_count_restarts_each_turn(tmp_path):
    steps = [TURN_END, stream("web_search_call"), TURN_END, TURN_END, stream("web_search_call"), TURN_END]
    assert run(steps, tmp_path)["entries"] == [["jht-web-search", {"searches": 1}], ["jht-web-search", {"searches": 1}]]


def test_garbage_in_the_stream_is_ignored(tmp_path):
    steps = [{"event": "provider_stream_event", "event_data": None}, {"event": "provider_stream_event", "event_data": {"data": 7}},
             {"event": "provider_stream_event", "event_data": {"data": {"type": "response.output_item.done", "item": None}}}, TURN_END]
    assert run(steps, tmp_path)["entries"] == []


def test_a_count_that_cannot_be_written_is_logged_not_lost_silently(tmp_path):
    steps = [stream("web_search_call"), TURN_END]
    run(steps, tmp_path, {"FAIL_APPEND": "1"})
    assert log_of(tmp_path)[-1] == {**log_of(tmp_path)[-1], "event": "web_search_count_lost", "searches": 1}


def test_the_extension_has_no_dependency_and_no_network_in_it():
    text = EXTENSION.read_text(encoding="utf-8")
    requires = {line.split('require("')[1].split('")')[0] for line in text.splitlines() if 'require("' in line}
    assert requires <= {"node:fs", "node:path"}
    for word in ("http", "fetch(", "child_process", "XMLHttpRequest", "net."):
        assert word not in text.replace("https://", ""), word
