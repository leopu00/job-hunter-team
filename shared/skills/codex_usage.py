"""The calls Codex made, one per model request, read from its rollouts ($JHT_HOME/.codex/sessions/Y/M/D/rollout-*.jsonl).

A rollout is a jsonl of `{timestamp, type, payload}`. What the cost needs:

  * `turn_context` (payload.model, payload.cwd): the model that answers the turns that follow. It changes between turns
    of one session, so the model of a call is the LAST `turn_context` before it, not one per file.
  * `event_msg` / `token_count` (payload.info.last_token_usage): the tokens of ONE request: `input_tokens` (the cached
    and the written ones are inside it), `cached_input_tokens`, `cache_write_input_tokens`, `output_tokens` (the
    reasoning is inside it when `last_usage_includes_reasoning`), `reasoning_output_tokens`. Codex repeats a
    `token_count` with nothing new (the rate-limit refresh): a call counts once, when the running total
    `total_token_usage` has grown.
  * `session_meta` (payload.cwd): the working folder, whose last part (`.../agents/scout-1`) names the agent.

Pure reading: a missing folder is "no calls", an unreadable file or a half-written last line is skipped.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

from model_pricing import from_codex


def _epoch(stamp):
    try:
        return datetime.fromisoformat(str(stamp).replace("Z", "+00:00")).astimezone(timezone.utc).timestamp()
    except (TypeError, ValueError):
        return None


def _agent(cwd):
    name = Path(cwd).name.lower() if isinstance(cwd, str) and cwd.strip("/") else ""
    return name or None


def read_calls(sessions_root, since_ts=None):
    """One dict per request made at or after `since_ts`, oldest first:
    `{ts, session, agent, model, fresh, cached, written, output, reasoning}` (the kinds of token of model_pricing)."""
    calls = []
    for rollout in sorted(Path(sessions_root).rglob("rollout-*.jsonl")):
        try:
            if since_ts is not None and rollout.stat().st_mtime < since_ts:
                continue
            handle = rollout.open(encoding="utf-8", errors="replace")
        except OSError:
            continue
        agent = model = None
        last_total = None
        with handle:
            for line in handle:
                try:
                    entry = json.loads(line)
                except ValueError:
                    continue
                payload = entry.get("payload") if isinstance(entry, dict) else None
                if not isinstance(payload, dict):
                    continue
                kind = entry.get("type")
                if kind == "session_meta":
                    agent = _agent(payload.get("cwd")) or agent
                elif kind == "turn_context":
                    if isinstance(payload.get("model"), str) and payload["model"]:
                        model = payload["model"]
                    agent = _agent(payload.get("cwd")) or agent
                elif kind == "event_msg" and payload.get("type") == "token_count":
                    info = payload.get("info")
                    last = info.get("last_token_usage") if isinstance(info, dict) else None
                    total = info.get("total_token_usage") if isinstance(info, dict) else None
                    if not isinstance(last, dict):
                        continue
                    running = total.get("total_tokens") if isinstance(total, dict) else None
                    if running is not None and running == last_total:
                        continue  # nothing new since the last count
                    last_total = running
                    moment = _epoch(entry.get("timestamp"))
                    if moment is None or (since_ts is not None and moment < since_ts):
                        continue
                    calls.append({"ts": moment, "session": rollout.stem, "agent": agent, "model": model,
                                  **from_codex({**last, "last_usage_includes_reasoning":
                                                info.get("last_usage_includes_reasoning")})})
    return sorted(calls, key=lambda call: call["ts"])
