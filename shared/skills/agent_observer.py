#!/usr/bin/env python3
"""One source for agents, team status and the lightweight terminal monitor.

Each refresh reads tmux and /proc once. CLI logs are bounded tails, shared
with agent_state, cached for 15s. Tokens come ONLY from role-usage.json.
NDJSON stream is request paced: one input line buys one sample. EOF exits.
"""
import argparse
import json
import sys
import time

import agent_state as state
from agent_observer_inputs import append_errors, read_sessions, read_usage
from agent_process_usage import ProcessMeter, read_processes
from agent_session_logs import codex_index, inspect_session

# Wire values of the agent state (agent_state.py, the desktop and the CLI view read them as they are): they are not
# user-facing copy, the views turn them into words in the person's language.
STATE_UNKNOWN, STATE_OFF = "sconosciuto", "spento"


class Observer:
    def __init__(self, home=None, sessions=read_sessions, processes=read_processes, meter=None):
        self.home = home or state.jht_home()
        self.sessions, self.processes = sessions, processes
        self.meter = meter or ProcessMeter()
        self.cache, self.logged = {}, set()
        self.index, self.index_at = {}, None
        self.index_errors = []
        self.log_failed = False
        self.pending_logs = set()

    def metadata(self, uid, session, now, monotonic):
        key = (uid, session["created"])
        cached = self.cache.get(key)
        if cached and monotonic - cached[0] < 15:
            return cached[1]
        cwd = state.agent_dir(self.home, uid)
        errors = list(self.index_errors)
        if cwd is None:
            result = {"identity": None, "state": STATE_UNKNOWN, "reason": "fonti_illeggibili"}
            errors.append("observer_session_logs_unavailable")
        else:
            try:
                events, readable, unrecognised, _, identity = inspect_session(
                    state, state.Sources(self.home), str(cwd), session["created"], index=self.index, errors=errors)
            except (OSError, ValueError, TypeError, KeyError, AttributeError):
                events, readable, unrecognised, identity = [], False, True, None
                errors.append("observer_session_logs_invalid")
            cpu, age = state.read_cpu(self.home, uid, now)
            verdict = state.fold(events, state.Ctx(now=now, session_created=session["created"],
                                                  readable=readable, unrecognised=unrecognised,
                                                  cpu_pct=cpu, cpu_age_s=age))
            result = {**verdict, "identity": identity}
        if errors:
            result.update(state=STATE_UNKNOWN, reason="fonti_illeggibili", identity=None)
        result["errors"] = sorted(set(errors))
        result["observed_at"] = now
        self.cache[key] = (monotonic, result)
        return result

    def sample(self, now=None, monotonic=None):
        now = time.time() if now is None else now
        monotonic = time.monotonic() if monotonic is None else monotonic
        sessions, errors = self.sessions()
        if sessions and (self.index_at is None or monotonic - self.index_at >= 15):
            since = min(s["created"] for s in sessions.values()) - state.CLOCK_SLACK_S
            self.index_errors = []
            self.index = codex_index(state, state.Sources(self.home), since, self.index_errors)
            self.index_at = monotonic
        processes, proc_errors = self.processes()
        meter = self.meter.sample(sessions, processes, monotonic, bool(proc_errors))
        usage = read_usage(self.home, now)
        if usage["reason"]:
            errors.append(usage["reason"])
        errors.extend(proc_errors)
        rows = []
        for uid in sorted(set(sessions) | set(usage["agents"])):
            live = uid in sessions
            metadata = self.metadata(uid, sessions[uid], now, monotonic) if live else {
                "state": STATE_OFF if not errors or not any(e.startswith("observer_sessions_") for e in errors)
                else STATE_UNKNOWN, "identity": None}
            tokens = usage["agents"].get(uid) if not usage["reason"] else None
            errors.extend(metadata.get("errors", []))
            reason = usage["reason"] or ("observer_usage_unattributed" if tokens is None else None)
            rows.append({"id": uid, "name": uid.upper(),
                         "session": sessions[uid]["session"] if live else uid.upper(),
                         "running": live if not any(e.startswith("observer_sessions_") for e in errors) else None,
                         **metadata, "process": meter.get(uid),
                         "usage": {"tokens": tokens, "reason": reason}})
        self.cache = {k: v for k, v in self.cache.items() if k[0] in sessions and k[1] == sessions[k[0]]["created"]}
        errors = sorted(set(errors))
        self.log(errors)
        return {"ok": not any(e.startswith("observer_sessions_") for e in errors),
                "at": now, "running": sum(r["running"] is True for r in rows), "total": len(rows),
                "usage": {k: v for k, v in usage.items() if k != "agents"},
                "sampling": {"guest_cpus": self.meter.cpus, "metadata_interval_seconds": 15},
                "errors": errors, "agents": rows}

    def log(self, errors):
        fresh = set(errors) - self.logged
        self.pending_logs.update(fresh)
        if self.pending_logs:
            try:
                append_errors(self.home, self.pending_logs)
                self.pending_logs.clear()
                self.log_failed = False
            except OSError:
                self.log_failed = True
        if self.log_failed and "observer_log_unavailable" not in errors:
            errors.append("observer_log_unavailable")
        self.logged = set(errors)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stream", action="store_true")
    args = parser.parse_args()
    observer = Observer()
    try:
        if args.stream:
            for _ in sys.stdin:
                print(json.dumps(observer.sample(), allow_nan=False), flush=True)
        else:
            result = observer.sample()
            print(json.dumps(result, allow_nan=False))
            return 0 if result["ok"] else 1
    except (BrokenPipeError, KeyboardInterrupt):
        return 0
    return 0


if __name__ == "__main__":
    sys.exit(main())
