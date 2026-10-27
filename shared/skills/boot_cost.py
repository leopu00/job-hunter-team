#!/usr/bin/env python3
"""boot_cost — what each role's session spends in its first minutes after it starts.

A restart of the containers starts every session again with a cold cache. This reads, only to read, the session
files the provider CLIs already write (Codex `rollout-*.jsonl`, Claude Code project `*.jsonl`) and answers, per
role: how big the context of the first model call is (the prompt, the tools, the skills: what the session
"rereads"), and what the session spent in its first N minutes, split in fresh input, input read from the cache and
output. It prints numbers and role names only: no message text, no path, no identifier of a person.

  boot_cost.py                      # last 24 h, first 10 minutes of every session, as a table
  boot_cost.py --minutes 5 --hours 6 --json
  boot_cost.py --calls capitano     # where one role's fresh input goes: by program name (never an argument)
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import statistics
import stat
import sys
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

ROLES = frozenset({
    "capitano", "sentinella", "assistente", "mentor", "dottore", "mantenitore", "scout", "analista",
    "scorer", "scrittore", "critico", "tesoriere", "closer",
})
CLAUDE_AGENT_PREFIX = "-jht-home-agents-"
# The session folders are written by the agents themselves: a link planted there must not make this read a file
# somewhere else, and a file of any size must not be read whole.
MAX_SESSION_BYTES = 256 * 1024 * 1024


def _jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME") or "/jht_home")


def _ts(raw) -> float:
    if not isinstance(raw, str):
        return 0.0
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return 0.0
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp()


def role_of(agent: str | None) -> str | None:
    """`analista-3` → analista; a name that is not a role is None (not counted, not guessed)."""
    if not isinstance(agent, str):
        return None
    base = re.split(r"[-_]", agent.strip().lower(), maxsplit=1)[0]
    return base if base in ROLES else None


def _int(value) -> int:
    return int(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


_NAME = re.compile(r"[A-Za-z0-9_][A-Za-z0-9_.+-]{0,39}")
_ENV = re.compile(r"[A-Za-z_][A-Za-z0-9_]*=")
_DURATION = re.compile(r"[0-9]+(\.[0-9]+)?[smhd]?")
_SHELLS = frozenset({"bash", "sh", "zsh"})
# Wrappers run the program that follows them; the options that take a value are skipped with their value, or the
# value (a user, a file, a signal) would be read as the program.
_WRAPPERS = {
    "sudo": frozenset({"-u", "-g", "-h", "-p", "-C", "-D", "-R", "-T", "-U", "-r", "-t"}),
    "timeout": frozenset({"-s", "-k", "--signal", "--kill-after"}),
    "env": frozenset({"-u", "-C", "-S", "--unset", "--chdir", "--split-string"}),
    "xargs": frozenset({"-a", "-d", "-E", "-I", "-L", "-n", "-P", "-s", "-l", "-i", "--arg-file", "--delimiter"}),
    "nice": frozenset({"-n", "--adjustment"}),
    "time": frozenset({"-f", "-o", "--format", "--output"}),
    "nohup": frozenset(), "setsid": frozenset(), "exec": frozenset(),
}
_INTERPRETERS = frozenset({"python", "python3", "node", "nodejs", "uv", "uvx", "npx", "tsx"})
_SCRIPT_SUFFIXES = (".py", ".js", ".mjs", ".cjs", ".ts", ".sh")
# The closed vocabulary. What comes out of this module is one of these names, a script that is in the repo, or
# "(other)": a name an agent or a person chose (a file, a user, a tool of theirs) is never printed.
_UTILITIES = frozenset("""
awk base64 basename cat cd chmod comm command cp curl cut date df diff dirname du echo egrep env false file find jht
git grep head jq kill ls mkdir mv node npm pgrep pkill ps pwd readlink realpath rg rm sed sleep sort sqlite3 stat
tail tar tee test tmux touch tr true uniq wc wget xxd yq
""".split()) | _INTERPRETERS | _SHELLS
_TOOLS = frozenset("""
Bash Read Write Edit MultiEdit Grep Glob Task WebFetch WebSearch NotebookEdit TodoWrite
exec wait shell apply_patch update_plan view_image local_shell
""".split())
_SCRIPT_DIRS = ("shared/skills", ".launcher", "cli/bin", "agents/_tools", "agents/_skills/tmux-send")
_known_scripts: frozenset | None = None


def _repo_scripts() -> frozenset:
    """File names of the scripts the product ships (the image's /app, and the repo this file sits in)."""
    global _known_scripts
    if _known_scripts is None:
        roots = [Path("/app")]
        try:
            roots.append(Path(__file__).resolve().parents[2])
        except (NameError, IndexError):  # read from the standard input: no file
            pass
        names = set()
        for root in roots:
            for folder in _SCRIPT_DIRS:
                try:
                    names.update(entry.name for entry in (root / folder).iterdir() if entry.is_file())
                except OSError:
                    continue
        _known_scripts = frozenset(names)
    return _known_scripts


def _vocabulary(name: str | None, is_script: bool) -> str | None:
    if not name:
        return None
    if is_script:
        return name if name in _repo_scripts() and _NAME.fullmatch(name) else "(script)"
    if name in _UTILITIES or (name in _repo_scripts() and name.startswith("jht") and _NAME.fullmatch(name)):
        return name
    return "(other)"


def _stages(command: str) -> list[str]:
    """The stages of a shell line (split on an unquoted ; & | or newline). A heredoc ends the scan: what follows
    `<<` is data, not commands. Quotes keep what is inside them in one stage."""
    stages, current, quote, i = [], [], None, 0
    while i < len(command):
        ch = command[i]
        if quote:
            current.append(ch)
            if ch == "\\" and quote == '"' and i + 1 < len(command):
                i += 1
                current.append(command[i])
            elif ch == quote:
                quote = None
        elif ch == "\\" and i + 1 < len(command):
            current.append(ch + command[i + 1])
            i += 1
        elif ch in "'\"":
            quote = ch
            current.append(ch)
        elif command.startswith("<<", i):
            break
        elif ch in ";&|\n":
            stages.append("".join(current))
            current = []
        else:
            current.append(ch)
        i += 1
    stages.append("".join(current))
    return stages


def _program_of(words: list[str]) -> str | None:
    """The program of one stage, and for an interpreter the script it runs, through the closed vocabulary. An
    interpreter given inline code (`-c`, `-e`) is named by the interpreter alone."""
    interpreter, wrapper, skip = None, None, False
    for word in words:
        if skip:
            skip = False
            continue
        if word.startswith("-") or not word:
            if interpreter and word in {"-c", "-e", "-p"}:
                return _vocabulary(interpreter, False)
            if wrapper and word in _WRAPPERS[wrapper]:
                skip = True
            continue
        if _ENV.match(word) or (wrapper == "timeout" and _DURATION.fullmatch(word)) or word.isdigit():
            continue
        name = word.rsplit("/", 1)[-1]
        if interpreter is None and name in _WRAPPERS:
            wrapper = name
            continue
        if interpreter is None and name in _INTERPRETERS:
            interpreter = name
            continue
        if interpreter:
            if name.endswith(_SCRIPT_SUFFIXES):
                return _vocabulary(name, True)
            continue
        return _vocabulary(name, False)
    return _vocabulary(interpreter, False)


def programs_in(command, _depth: int = 0) -> list[str]:
    """The programs a shell command runs (a list of argv words, or one string), as names only. `bash -lc "<script>"`
    is looked into; nothing after the program name is kept, so no argument, path or text can come out."""
    if isinstance(command, list):
        command = " ".join(shlex.quote(str(w)) for w in command)
    if not isinstance(command, str):
        return []
    names = []
    for stage in _stages(command[:4000]):
        try:
            words = shlex.split(stage)
        except ValueError:
            continue
        if not words:
            continue
        if words[0].rsplit("/", 1)[-1] in _SHELLS:
            inline = next((words[i + 1] for i, w in enumerate(words[:-1]) if w in {"-c", "-lc", "-ic"}), None)
            if inline is not None and _depth < 2:
                names.extend(programs_in(inline, _depth + 1))
                continue
        name = _program_of(words)
        if name:
            names.append(name)
    return names


def _tool_programs(payload: dict) -> list[str]:
    """The programs one Codex tool call runs. Tool calls that are not a shell command are named by the tool."""
    args = payload.get("arguments")
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except ValueError:
            args = None
    if isinstance(args, dict):
        command = args.get("command", args.get("cmd"))
        if command is not None:
            return programs_in(command) or ["(shell)"]
    action = payload.get("action")
    if isinstance(action, dict) and action.get("command") is not None:
        return programs_in(action.get("command")) or ["(shell)"]
    # A free-text input (a tool that takes code, not a command) is named by the tool: its words are not programs.
    name = payload.get("name")
    return [name] if name in _TOOLS else ["(tool)"]



def _regular(path: Path, since_ts: float) -> bool:
    """A regular file (not a link, not a pipe or device) touched since `since_ts`, of a size that can be read."""
    try:
        info = path.lstat()
    except OSError:
        return False
    return stat.S_ISREG(info.st_mode) and info.st_mtime >= since_ts and info.st_size <= MAX_SESSION_BYTES


def _calls_codex(path: Path):
    """(role, [(ts, fresh_in, cached_in, out, programs)]) of one Codex session: `programs` are the ones the tool
    calls since the previous model call ran, whose output this call reads. The first token_count has no `info`."""
    agent, calls, pending = None, [], []
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            payload = e.get("payload") or {}
            if e.get("type") == "session_meta":
                cwd = payload.get("cwd")
                if isinstance(cwd, str) and cwd:
                    agent = Path(cwd).name
                continue
            if e.get("type") == "response_item" and str(payload.get("type", "")).endswith("call"):
                pending.extend(_tool_programs(payload))
                continue
            if e.get("type") != "event_msg" or payload.get("type") != "token_count":
                continue
            last = (payload.get("info") or {}).get("last_token_usage")
            ts = _ts(e.get("timestamp"))
            if not isinstance(last, dict) or ts <= 0:
                continue  # (a token_count without info keeps the programs for the call that follows)
            total_in, cached = _int(last.get("input_tokens")), _int(last.get("cached_input_tokens"))
            out = _int(last.get("output_tokens")) + _int(last.get("reasoning_output_tokens"))
            calls.append((ts, max(0, total_in - cached), cached, out, tuple(pending)))
            pending = []
    return role_of(agent), calls


def _claude_programs(message: dict) -> list[str]:
    names = []
    content = message.get("content")
    for block in content if isinstance(content, list) else []:
        if not isinstance(block, dict) or block.get("type") != "tool_use":
            continue
        given = block.get("input")
        command = given.get("command") if isinstance(given, dict) else None
        if block.get("name") == "Bash" and command is not None:
            names.extend(programs_in(command) or ["(shell)"])
        else:
            name = block.get("name")
            names.append(name if name in _TOOLS else "(tool)")
    return names


def _calls_claude(path: Path, agent: str):
    """Same for a Claude Code session: what it writes to the cache is fresh input, what it reads is cached. A
    response with several content blocks is several lines with the same usage: counted once, by message id."""
    calls, seen, pending = [], {}, []
    with path.open(encoding="utf-8", errors="replace") as f:
        for line in f:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            message = e.get("message")
            usage = message.get("usage") if isinstance(message, dict) else None
            ts = _ts(e.get("timestamp") or e.get("ts"))
            if not isinstance(usage, dict) or ts <= 0:
                continue
            ident = message.get("id")
            if isinstance(ident, str) and ident in seen:
                seen[ident].extend(_claude_programs(message))  # later blocks of the same response
                continue
            fresh = _int(usage.get("input_tokens")) + _int(usage.get("cache_creation_input_tokens"))
            issued = _claude_programs(message)
            calls.append((ts, fresh, _int(usage.get("cache_read_input_tokens")), _int(usage.get("output_tokens")),
                          tuple(pending)))
            pending = issued
            if isinstance(ident, str):
                seen[ident] = pending
    return role_of(agent), calls


def sessions(jht_home: Path, since_ts: float):
    """Yield (role, calls) for every session file touched since `since_ts`. Links are not followed."""
    codex = jht_home / ".codex" / "sessions"
    for rollout in (codex.rglob("rollout-*.jsonl") if codex.is_dir() and not codex.is_symlink() else ()):
        if _regular(rollout, since_ts):
            yield _calls_codex(rollout)
    projects = jht_home / ".claude" / "projects"
    if projects.is_dir() and not projects.is_symlink():
        for folder in projects.iterdir():
            if folder.is_symlink() or not folder.is_dir() or not folder.name.startswith(CLAUDE_AGENT_PREFIX):
                continue
            for jsonl in folder.glob("*.jsonl"):
                if _regular(jsonl, since_ts):
                    yield _calls_claude(jsonl, folder.name[len(CLAUDE_AGENT_PREFIX):])


def measure(jht_home: Path, since_ts: float, minutes: float) -> dict:
    """Per role: how many sessions started in the period, the median context of their first call, and the mean
    of what they spent in their first `minutes` minutes (calls, fresh input, cached input, output)."""
    per_role: dict[str, list[dict]] = defaultdict(list)
    for role, calls in sessions(jht_home, since_ts):
        if role is None or not calls:
            continue
        calls.sort()
        start = calls[0][0]
        if start < since_ts:
            continue  # a session that began before the period: its first minutes are not in it
        window = [c for c in calls if c[0] - start <= minutes * 60]
        per_role[role].append({
            "first_call_context": calls[0][1] + calls[0][2],
            "calls": len(window),
            "fresh_in": sum(c[1] for c in window),
            "cached_in": sum(c[2] for c in window),
            "out": sum(c[3] for c in window),
        })
    roles = {}
    for role, rows in sorted(per_role.items()):
        roles[role] = {
            "sessions": len(rows),
            "first_call_context_median": int(statistics.median(r["first_call_context"] for r in rows)),
            **{key: int(statistics.mean(r[key] for r in rows)) for key in ("calls", "fresh_in", "cached_in", "out")},
        }
    return {"minutes": minutes, "roles": roles}


def measure_calls(jht_home: Path, since_ts: float, minutes: float, role: str) -> dict:
    """Where the fresh input of one role's first `minutes` minutes comes from: each model call's fresh input goes
    to the programs run by the tool calls just before it (split evenly when there were several); the first call
    is the prompt, a call that follows no tool call is "(no tool)". Means per session; names and numbers only."""
    sessions_seen = 0
    by_program: dict[str, list[float]] = defaultdict(lambda: [0.0, 0.0])  # uses, fresh input
    out_total = 0
    for session_role, calls in sessions(jht_home, since_ts):
        if session_role != role or not calls:
            continue
        calls.sort(key=lambda c: c[0])
        start = calls[0][0]
        if start < since_ts:
            continue
        sessions_seen += 1
        for index, call in enumerate(c for c in calls if c[0] - start <= minutes * 60):
            programs = call[4] if len(call) > 4 else ()
            out_total += call[3]
            if index == 0:
                by_program["(prompt)"][0] += 1
                by_program["(prompt)"][1] += call[1]
            elif not programs:
                by_program["(no tool)"][0] += 1
                by_program["(no tool)"][1] += call[1]
            else:
                for name in programs:
                    by_program[name][0] += 1
                    by_program[name][1] += call[1] / len(programs)
    if not sessions_seen:
        return {"minutes": minutes, "role": role, "sessions": 0, "programs": {}, "out": 0}
    total = sum(v[1] for v in by_program.values()) or 1.0
    programs = {
        name: {"uses": round(v[0] / sessions_seen, 1), "fresh_in": int(v[1] / sessions_seen), "share": round(v[1] / total, 3)}
        for name, v in sorted(by_program.items(), key=lambda kv: -kv[1][1])
    }
    return {"minutes": minutes, "role": role, "sessions": sessions_seen, "programs": programs,
            "out": int(out_total / sessions_seen)}


def render_calls(report: dict) -> str:
    lines = [f"{report['role']}: first {report['minutes']:g} minutes, where the fresh input comes from "
             f"({report['sessions']} sessions, means per session)",
             f"{'program':<28}{'uses':>7}{'fresh in':>10}{'share':>8}"]
    for name, r in report["programs"].items():
        lines.append(f"{name:<28}{r['uses']:>7g}{r['fresh_in']:>10}{r['share'] * 100:>7.0f}%")
    if not report["programs"]:
        lines.append("(no session of this role started in the period)")
    else:
        lines.append(f"{'(its own output)':<28}{'':>7}{report['out']:>10}")
    return "\n".join(lines)


def render(report: dict) -> str:
    head = f"{'role':<12}{'sessions':>9}{'first call':>12}{'calls':>7}{'fresh in':>10}{'cached in':>11}{'out':>8}"
    lines = [f"first {report['minutes']:g} minutes of each session (tokens; means per session)", head]
    for role, r in report["roles"].items():
        lines.append(
            f"{role:<12}{r['sessions']:>9}{r['first_call_context_median']:>12}{r['calls']:>7}"
            f"{r['fresh_in']:>10}{r['cached_in']:>11}{r['out']:>8}")
    if not report["roles"]:
        lines.append("(no session started in the period)")
    return "\n".join(lines)


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--minutes", type=float, default=10.0)
    parser.add_argument("--hours", type=float, default=24.0)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--calls", metavar="ROLE", help="where the fresh input of one role's first minutes comes from, by program")
    args = parser.parse_args(argv)
    if args.calls:
        if args.calls.lower() not in ROLES:
            parser.error(f"--calls takes a role: {', '.join(sorted(ROLES))}")
        report = measure_calls(_jht_home(), time.time() - args.hours * 3600, args.minutes, args.calls.lower())
        print(json.dumps(report, indent=2) if args.json else render_calls(report))
        return 0
    report = measure(_jht_home(), time.time() - args.hours * 3600, args.minutes)
    print(json.dumps(report, indent=2) if args.json else render(report))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
