"""Read-only inventory and the Sentinel's existing weighted-token meter."""
import json
import math
import os
import stat
import subprocess
from datetime import datetime

from agent_control import Refusal, parse_session


def session_id(name):
    if not isinstance(name, str):
        return None
    name = name.removeprefix("JHT-")
    try:
        parse_session(name)
    except Refusal:
        return None
    return name.lower()


def read_sessions(run=subprocess.run):
    try:
        result = run(["tmux", "list-panes", "-a", "-F",
                      "#{session_name}\t#{session_created}\t#{pane_pid}\t#{pane_dead}"],
                     capture_output=True, text=True, timeout=4, check=False)
    except (OSError, subprocess.SubprocessError):
        return {}, ["observer_sessions_unavailable"]
    if result.returncode:
        # No tmux server at all is an empty team, not a failure. tmux words it two ways: "no server running" when it
        # finds the socket's folder, and "error connecting to <socket> (No such file or directory)" when it does not
        # (a machine where tmux never ran for this user). A refused connection or a permission error stays an error.
        stderr = result.stderr or ""
        missing_socket = "error connecting to " in stderr and stderr.rstrip().endswith("(No such file or directory)")
        if result.returncode == 1 and (any(s in stderr for s in ("no server running", "no sessions")) or missing_socket):
            return {}, []
        return {}, ["observer_sessions_unavailable"]
    sessions = {}
    owners = {}
    for line in result.stdout.splitlines():
        fields = line.split("\t")
        if len(fields) != 4:
            return {}, ["observer_sessions_invalid"]
        name, created, pid, dead = fields
        uid = session_id(name)
        if uid is None:
            continue
        if not created.isdigit() or not pid.isdigit() or int(pid) < 1 or dead not in {"0", "1"}:
            return {}, ["observer_sessions_invalid"]
        existing = sessions.setdefault(uid, {"session": name, "created": int(created), "pids": []})
        if existing["session"] != name or existing["created"] != int(created):
            return {}, ["observer_sessions_invalid"]
        if dead == "0" and int(pid) not in existing["pids"]:
            if int(pid) in owners and owners[int(pid)] != uid:
                return {}, ["observer_sessions_invalid"]
            owners[int(pid)] = uid
            existing["pids"].append(int(pid))
    return sessions, []


def read_json(path, limit=2 * 1024 * 1024):
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, "rb") as handle:
        if not stat.S_ISREG(os.fstat(handle.fileno()).st_mode):
            raise ValueError("not a regular file")
        raw = handle.read(limit + 1)
        if len(raw) > limit:
            raise ValueError("input too large")
    return json.loads(raw)


def read_usage(home, now):
    out = {"window": "1h", "unit": "weighted_tokens", "generated_at": None,
           "age_seconds": None, "reason": None, "agents": {}}
    try:
        data = read_json(home / "logs" / "role-usage.json")
        generated = data["generated_at"]
        timestamp = datetime.fromisoformat(generated.replace("Z", "+00:00"))
        if timestamp.tzinfo is None or not isinstance(data["agents_1h"], dict):
            raise ValueError("invalid meter")
        out.update(generated_at=generated, age_seconds=round(now - timestamp.timestamp(), 3))
        for name, value in data["agents_1h"].items():
            uid = session_id(name.upper())
            if uid is None or name != uid or uid in out["agents"]:
                raise ValueError("invalid instance")
            out["agents"][uid] = value if isinstance(value, (int, float)) and not isinstance(value, bool) \
                and 0 <= value <= 2**53 - 1 and math.isfinite(value) else None
        if not -60 <= out["age_seconds"] <= 900:
            out["reason"] = "observer_usage_stale"
    except FileNotFoundError:
        out["reason"] = "observer_usage_missing"
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        out["reason"] = "observer_usage_invalid"
    return out


def append_errors(home, codes):
    directory = home / "logs"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.is_symlink():
        raise OSError("unsafe log directory")
    flags = os.O_WRONLY | os.O_CREAT | os.O_APPEND | os.O_NOFOLLOW | os.O_NONBLOCK
    fd = os.open(directory / "runtime.log", flags, 0o600)
    with os.fdopen(fd, "a") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise OSError("unsafe runtime log")
        for code in sorted(set(codes)):
            handle.write(f"{datetime.now().astimezone().isoformat()} {code}\n")
