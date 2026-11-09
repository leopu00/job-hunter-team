"""The usage pi writes in its session files: tokens, cache and cost, per call to the model.

An agent on the pi harness (JHT_AGENT_HARNESS_<ROLE>=pi, see .launcher/spawn-lib.sh) writes one jsonl per session under
`$JHT_HOME/.pi/agent/sessions/--<cwd>--/<timestamp>_<id>.jsonl` (pi's own layout, grouped by working directory). The first
line is the header (`{"type":"session","version":3,"cwd":...}`), then one line per entry; every call to the model is an
assistant message that carries its own `usage`:

  {"type":"message","timestamp":"2026-11-09T10:52:19.587Z","message":{"role":"assistant","model":"...","durationMs":4339,
   "usage":{"input":3,"output":121,"cacheRead":0,"cacheWrite":13772,"reasoning":26,"totalTokens":13896,
            "cost":{"total":0.035888,"totalFromProvider":false}}}}

Read from pi 1.5.0 sessions (the format of its docs/session-format.md, version 3). Things worth knowing:
  * `output` already includes `reasoning`: do not add it again.
  * With OpenAI the prompt cache is automatic; pi books the first sight of a prompt as `cacheWrite` and later hits as
    `cacheRead`. OpenAI charges no premium for a write, and pi prices it anyway, so `cost.total` is an ESTIMATE
    (`totalFromProvider: false`), a little above the invoice, never below it.
  * The `system` message of a session is huge (the whole prompt and the tool schemas): only assistant lines are parsed.

Pure reading: nothing is written, a missing or unreadable folder is "no usage", a half-written last line is skipped.
The state of the agent (running, idle, blocked) is read elsewhere (agent_pi_log.py); this file is for the meters.

Web search: pi does not price the fee of a search call (the hosted `web_search` tool of OpenAI, 10 USD per 1000 calls on
its pricing page, read 09/11). The extension shared/runtime/pi-harness/web-search.js writes, at the end of a turn that
searched, a custom entry `{"type":"custom","customType":"jht-web-search","data":{"searches":n}}` in the same session file,
and once per session a `jht-web-search-status` entry saying whether the search is on for that provider (and why not).
`search_events` reads the first, `web_search_status` the second. The tokens of the search results are already in the
call's own `usage`.
"""

from __future__ import annotations

import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path

SESSIONS = (".pi", "agent", "sessions")
SEARCH_CALL_USD = 0.01  # OpenAI pricing page, 09/11: 10 USD / 1000 calls for the reasoning models
SEARCH_ENTRY = "jht-web-search"
STATUS_ENTRY = "jht-web-search-status"
TOKEN_FIELDS = ("input", "output", "cache_read", "cache_write", "reasoning")


def sessions_root(jht_home) -> Path:
    return Path(jht_home).joinpath(*SESSIONS)


def iter_session_files(root, since_ts=None):
    """The `.jsonl` files under `root` modified at or after `since_ts` (all when None), oldest first."""
    found = []
    for folder, _dirs, names in os.walk(root):  # a missing folder yields nothing
        for name in names:
            if not name.endswith(".jsonl"):
                continue
            path = Path(folder) / name
            try:
                mtime = path.stat().st_mtime
            except OSError:
                continue
            if since_ts is None or mtime >= since_ts:
                found.append((mtime, path))
    return [path for _mtime, path in sorted(found)]


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
        return 0
    return value


def _epoch(stamp) -> float | None:
    try:
        return datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except (TypeError, ValueError):
        return None


def _header(path: Path) -> dict:
    try:
        with path.open(encoding="utf-8", errors="replace") as handle:
            first = json.loads(handle.readline())
    except (OSError, ValueError):
        return {}
    return first if isinstance(first, dict) and first.get("type") == "session" else {}


def agent_of(header) -> str | None:
    """The agent's folder name from the header's working directory (`.../agents/scout-1` -> `scout-1`)."""
    cwd = header.get("cwd") if isinstance(header, dict) else None
    name = Path(cwd).name.lower() if isinstance(cwd, str) and cwd.strip("/") else ""
    return name or None


def _event(entry, session, agent):
    message = entry.get("message") if isinstance(entry, dict) else None
    if entry.get("type") != "message" or not isinstance(message, dict) or message.get("role") != "assistant":
        return None
    usage = message.get("usage")
    if not isinstance(usage, dict):
        return None
    moment = _epoch(entry.get("timestamp"))
    if moment is None:
        return None
    cost = usage.get("cost") if isinstance(usage.get("cost"), dict) else {}
    return {
        "ts": moment, "session": session, "agent": agent, "model": str(message.get("model") or ""),
        "input": _number(usage.get("input")), "output": _number(usage.get("output")),
        "cache_read": _number(usage.get("cacheRead")), "cache_write": _number(usage.get("cacheWrite")),
        "reasoning": _number(usage.get("reasoning")), "cost": float(_number(cost.get("total"))),
        "cost_from_provider": cost.get("totalFromProvider") is True,
        "duration_ms": _number(message.get("durationMs")),
    }


def _scan(jht_home, since_ts, needle):
    """(entry, session, agent) for every line of the sessions touched since `since_ts` that contains `needle` and parses.
    The huge system line is never parsed: it holds neither needle."""
    for path in iter_session_files(sessions_root(jht_home), since_ts):
        header = _header(path)
        session, agent = str(header.get("id") or path.stem), agent_of(header)
        try:
            handle = path.open(encoding="utf-8", errors="replace")
        except OSError:
            continue
        with handle:
            for line in handle:
                if needle not in line:
                    continue
                try:
                    entry = json.loads(line)
                except ValueError:  # the line pi is writing right now
                    continue
                if isinstance(entry, dict):
                    yield entry, session, agent


def usage_events(jht_home, since_ts=None) -> list[dict]:
    """One event per call to the model whose assistant message is stamped at or after `since_ts`, oldest first."""
    events = []
    for entry, session, agent in _scan(jht_home, since_ts, '"usage"'):
        event = _event(entry, session, agent)
        if event and (since_ts is None or event["ts"] >= since_ts):
            events.append(event)
    return sorted(events, key=lambda event: event["ts"])


def _custom(jht_home, since_ts, kind):
    for entry, session, agent in _scan(jht_home, since_ts, kind):
        data = entry.get("data")
        moment = _epoch(entry.get("timestamp"))
        if entry.get("type") == "custom" and entry.get("customType") == kind and isinstance(data, dict) \
                and moment is not None and (since_ts is None or moment >= since_ts):
            yield moment, session, agent, data


def search_events(jht_home, since_ts=None) -> list[dict]:
    """One event per turn that searched the web: `{ts, session, agent, searches, cost}`, the cost being the fee pi does not
    price (`SEARCH_CALL_USD` each), oldest first."""
    events = []
    for moment, session, agent, data in _custom(jht_home, since_ts, SEARCH_ENTRY):
        count = int(_number(data.get("searches")))
        if count:
            events.append({"ts": moment, "session": session, "agent": agent, "searches": count,
                           "cost": round(count * SEARCH_CALL_USD, 6)})
    return sorted(events, key=lambda event: event["ts"])


def web_search_status(jht_home, since_ts=None) -> dict:
    """The latest `jht-web-search-status` of each agent: `{agent: {enabled, provider, api, reason?, ts}}`. An agent that
    never started with the extension is absent; one with `enabled: false` is running WITHOUT web search, and says why."""
    latest: dict = {}
    for moment, _session, agent, data in _custom(jht_home, since_ts, STATUS_ENTRY):
        if agent not in latest or moment >= latest[agent]["ts"]:
            latest[agent] = {"ts": moment, "enabled": data.get("enabled") is True,
                             "provider": str(data.get("provider") or ""), "api": str(data.get("api") or ""),
                             **({"reason": str(data["reason"])} if data.get("reason") else {})}
    return latest


def totals(events) -> dict:
    """Sum of tokens, cost and calls of `events`."""
    out = {name: 0 for name in TOKEN_FIELDS}
    out.update(cost=0.0, calls=0)
    for event in events:
        for name in TOKEN_FIELDS:
            out[name] += event[name]
        out["cost"] += event["cost"]
        out["calls"] += 1
    out["cost"] = round(out["cost"], 6)
    return out


# ── by role and model ───────────────────────────────────────────────────

_INSTANCE = re.compile(r"-s?\d+$", re.IGNORECASE)


def role_of(agent) -> str:
    """`scout-2` -> `scout`, `critico-S1` -> `critico`; an agent with no name is `?unknown`."""
    return _INSTANCE.sub("", str(agent or "").strip().lower()) or "?unknown"


def exact_cost(event):
    """The cost of one call by OUR shared price list (shared/skills/model_prices.py), or None while it is not there.
    pi's own `cost` is an estimate: it prices the cache write, which OpenAI does not charge. What OpenAI bills is the
    uncached input (pi's `input` plus its `cache_write`, which for OpenAI is the part of the prompt that was not cached
    yet), the cached input, and the output (the reasoning is already inside it)."""
    try:
        import model_prices
    except ImportError:
        return None
    return model_prices.call_cost(event["model"], event["input"] + event["cache_write"], event["cache_read"],
                                  event["output"])


def breakdown(events, searches=()) -> dict:
    """`{role: {model: {calls, input, cache_read, cache_write, output, reasoning, pi_cost, exact_cost, searches,
    search_fee}}}`: the tokens of each kind, pi's own estimate and OUR exact cost (None while the price list is missing
    or the model is not in it), apart for every role and every model. `reasoning` is part of `output`, shown apart."""
    out: dict = {}

    def cell(agent, model):
        return out.setdefault(role_of(agent), {}).setdefault(model or "?unknown", {
            "calls": 0, "input": 0, "cache_read": 0, "cache_write": 0, "output": 0, "reasoning": 0,
            "pi_cost": 0.0, "exact_cost": 0.0, "searches": 0, "search_fee": 0.0})

    for e in events:
        c = cell(e["agent"], e["model"])
        c["calls"] += 1
        for name in ("input", "cache_read", "cache_write", "output", "reasoning"):
            c[name] += e[name]
        c["pi_cost"] = round(c["pi_cost"] + e["cost"], 6)
        exact = exact_cost(e)
        c["exact_cost"] = None if exact is None or c["exact_cost"] is None else round(c["exact_cost"] + exact, 6)
    for e in searches:  # the search fee is not tied to a model in the session: it goes to the role's last model cell
        models = out.get(role_of(e["agent"]), {})
        c = cell(e["agent"], next(reversed(models)) if models else None)
        c["searches"] += e["searches"]
        c["search_fee"] = round(c["search_fee"] + e["cost"], 6)
    return out
