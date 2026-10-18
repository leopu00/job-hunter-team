#!/usr/bin/env python3
"""agent_state.py — what each agent is doing, derived from the events of its CLI.

The state of an agent is never read from "its session is alive": it comes from
the log its CLI writes while it works. Three CLIs, one rule:

  Claude  $JHT_HOME/.claude/projects/<cwd, / and . as ->/<session>.jsonl
  Codex   $JHT_HOME/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl   (cwd in session_meta)
  Kimi    $JHT_HOME/.kimi/sessions/<md5(cwd)>/<session>/wire.jsonl, and kimi.log

The cwd of an agent is its own folder, $JHT_HOME/agents/<name> (start-agent.sh),
so a log belongs to an agent by where it ran, not by what it says.

Each CLI is first reduced to the same few events (turn_start, activity,
turn_end, blocked, approval_open/close), then ONE function (fold) decides:

  spento               no tmux session
  sconosciuto          the logs cannot be read or are not understood, the
                       session is too young to have one, or a turn is open and
                       silent for 10 min with a quiet CPU
  avviato_mai_partito  alive for a while, logs readable, no turn event since
                       the session started
  bloccato(reason)     the last event is an error or a limit
  lavora               a turn is open and has a recent event (or a busy CPU)
  aspetta_umano        the turn is closed and a question to the user has no
                       reply yet, or the CLI waits for an approval
  idle                 the last turn ended with a real closing event

"idle" and "lavora" are never a default: an agent with no event of its own since
the session started is avviato_mai_partito (or sconosciuto), whatever the pane
shows. Events older than the session are ignored: a previous run's turns say
nothing about this one.

Reasons are a closed list (REASONS); the sentence for each is the catalog's
(shared/agent-state/catalog.json), never a text the agent or the CLI wrote.

CLI:
    python3 agent_state.py          # {session-lower: {state, reason?, since, until?}}
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Iterable

# ── vocabulary ──────────────────────────────────────────────────────────

STATES = (
    "spento", "idle", "lavora", "bloccato", "aspetta_umano", "sconosciuto",
    "avviato_mai_partito",
)

# Reasons this module can emit, per state.
REASONS = {
    "bloccato": (
        "limite_5h", "limite_settimanale", "limite_spesa_org", "limite_fornitore",
        "rete", "errore_fornitore",
    ),
    "sconosciuto": (
        "fonti_illeggibili", "formato_non_riconosciuto", "turno_silenzioso",
        "avvio_in_corso",
    ),
}

# In the catalog, waiting for a CLI that does not show them in the logs yet.
NOT_EMITTED_REASONS = ("pausa_pacing", "accesso_scaduto")

# ── thresholds ──────────────────────────────────────────────────────────

# A session younger than this has had no time to write a first event.
START_GRACE_S = 180.0
# An open turn with an event newer than this is work; older, only a busy CPU says so.
RECENT_S = 600.0
# Same threshold as the game's activity LED (calibrated on real vitals).
CPU_BUSY_PCT = 8.0
# The vitals row must be this fresh to be believed.
CPU_FRESH_S = 60.0
# Slack when comparing a log's clock with the session's.
CLOCK_SLACK_S = 5.0
# How much of a log's end is read.
TAIL_BYTES = 2 * 1024 * 1024
# A question older than this is not a wait any more.
QUESTION_MAX_AGE_S = 7 * 86400.0
# Kimi: a step that dies before it produces anything, within this time.
KIMI_FAST_FAIL_S = 3.0


# ── events ──────────────────────────────────────────────────────────────

@dataclass
class Ev:
    ts: float
    kind: str                  # turn_start | activity | turn_end | blocked | approval_open | approval_close
    reason: str | None = None  # blocked
    until: float | None = None  # blocked: when the limit lifts (epoch s)
    ref: str | None = None     # approval id


@dataclass
class Parsed:
    events: list[Ev] = field(default_factory=list)
    lines: int = 0       # JSON objects read
    recognised: int = 0  # of which this CLI's own record types


def _iso(value) -> float | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _objects(lines: Iterable[str]):
    for line in lines:
        line = line.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            yield obj


# ── Claude ──────────────────────────────────────────────────────────────

CLAUDE_TYPES = frozenset({
    "user", "assistant", "system", "attachment", "mode", "permission-mode",
    "queue-operation", "last-prompt", "ai-title", "custom-title", "agent-name",
    "file-history-snapshot", "file-history-delta", "api-request",
    "api-request-blob", "api-request-shape", "cost-state", "bridge-session",
    "isolation-latch", "atis-latch", "frame-link", "pr-link",
})
_NETWORK = re.compile(
    r"ENOTFOUND|reach the API|Connection lost|went to sleep|timed out", re.I)


def _claude_block(e: dict) -> tuple[str, float | None]:
    """The reason (and when it lifts) of an API error line."""
    if e.get("error") == "rate_limit" or e.get("apiErrorStatus") == 429:
        q = e.get("quotaLimits") if isinstance(e.get("quotaLimits"), dict) else {}
        until = q.get("resetsAt")
        until = float(until) if isinstance(until, (int, float)) else None
        if q.get("overageDisabledReason") == "org_level_disabled_until":
            return "limite_spesa_org", until
        kind = str(q.get("rateLimitType") or "")
        if kind == "five_hour":
            return "limite_5h", until
        if kind.startswith("seven_day"):
            return "limite_settimanale", until
        return "limite_fornitore", until
    text = "".join(
        c.get("text", "") for c in (e.get("message") or {}).get("content", [])
        if isinstance(c, dict)) if isinstance(e.get("message"), dict) else ""
    return ("rete" if _NETWORK.search(text) else "errore_fornitore"), None


def parse_claude(lines: Iterable[str]) -> Parsed:
    out = Parsed()
    for e in _objects(lines):
        out.lines += 1
        kind = e.get("type")
        if kind in CLAUDE_TYPES:
            out.recognised += 1
        ts = _iso(e.get("timestamp"))
        if ts is None:
            continue
        msg = e.get("message") if isinstance(e.get("message"), dict) else {}
        if kind == "user":
            content = msg.get("content")
            if e.get("isMeta") or e.get("isSidechain"):
                out.events.append(Ev(ts, "activity"))
            elif isinstance(content, list) and content and isinstance(content[0], dict) \
                    and content[0].get("type") == "tool_result":
                out.events.append(Ev(ts, "activity"))
            else:
                text = content if isinstance(content, str) else "".join(
                    c.get("text", "") for c in content or [] if isinstance(c, dict))
                # An interrupt is the turn's closing: no turn_duration follows it.
                out.events.append(Ev(ts, "turn_end" if text.startswith("[Request interrupted")
                                     else "turn_start"))
        elif kind == "assistant":
            if e.get("isApiErrorMessage"):
                reason, until = _claude_block(e)
                out.events.append(Ev(ts, "blocked", reason=reason, until=until))
            else:
                out.events.append(Ev(ts, "activity"))
        elif kind == "system" and e.get("subtype") == "turn_duration":
            out.events.append(Ev(ts, "turn_end"))
    return out


# ── Codex ───────────────────────────────────────────────────────────────

CODEX_TYPES = frozenset({
    "session_meta", "event_msg", "response_item", "turn_context", "compacted",
    "token_usage_record", "world_state", "inter_agent_communication_metadata",
})


def parse_codex(lines: Iterable[str]) -> Parsed:
    """Turns are task_started .. task_complete | turn_aborted.

    No limit is read here: a token_count at used_percent 100 is followed by
    more turns in the real rollouts, so it does not say the agent is stopped.
    """
    out = Parsed()
    for e in _objects(lines):
        out.lines += 1
        kind = e.get("type")
        if kind in CODEX_TYPES:
            out.recognised += 1
        ts = _iso(e.get("timestamp"))
        if ts is None:
            continue
        payload = e.get("payload") if isinstance(e.get("payload"), dict) else {}
        if kind == "event_msg":
            sub = payload.get("type")
            if sub == "task_started":
                out.events.append(Ev(ts, "turn_start"))
            elif sub in ("task_complete", "turn_aborted"):
                out.events.append(Ev(ts, "turn_end"))
            else:
                out.events.append(Ev(ts, "activity"))
        elif kind == "response_item":
            out.events.append(Ev(ts, "activity"))
    return out


# ── Kimi ────────────────────────────────────────────────────────────────

KIMI_TYPES = frozenset({
    "TurnBegin", "TurnEnd", "StepBegin", "StepInterrupted", "ContentPart",
    "ToolCall", "ToolCallPart", "ToolResult", "StatusUpdate", "SteerInput",
    "Notification", "SubagentEvent", "ApprovalRequest", "ApprovalResponse",
})
_KIMI_PROGRESS = frozenset({"ContentPart", "ToolCall", "ToolCallPart", "ToolResult", "StatusUpdate"})

# kimi.log, one line per failed step:
#   2026-08-09 20:03:46.790 | ERROR | kimi_cli.soul.kimisoul:_agent_loop:1049 | <session> - Agent step 1 failed: ...
_KIMI_LOG = re.compile(
    r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(?:\.\d+)?) \| ERROR\s+\| \S+ \| (\S+) - Agent step \d+ failed: (.*)$")


def kimi_log_failures(lines: Iterable[str]) -> list[tuple[float, str, str]]:
    """[(epoch, session, reason)] of the failed steps in kimi.log. The log's
    clock is the machine's local one, as the wire's epoch seconds are read."""
    found = []
    for line in lines:
        m = _KIMI_LOG.match(line.rstrip("\n"))
        if not m:
            continue
        try:
            ts = datetime.strptime(m.group(1)[:19], "%Y-%m-%d %H:%M:%S").timestamp()
        except ValueError:
            continue
        text = m.group(3)
        if re.search(r"usage limit|quota", text, re.I):
            reason = "limite_fornitore"
        elif _NETWORK.search(text) or re.search(r"ConnectError|Connection|DNS", text):
            reason = "rete"
        else:
            reason = "errore_fornitore"
        found.append((ts, m.group(2), reason))
    return found


def parse_kimi(lines: Iterable[str], session: str = "",
               failures: list[tuple[float, str, str]] | None = None) -> Parsed:
    """A turn that ends right after a step that produced nothing is a failed
    turn only if kimi.log names a failed step of this session at that moment;
    otherwise it is an interrupt, a plain end."""
    out = Parsed()
    step_ts: float | None = None
    step_progress = False
    fast_fail = False
    for e in _objects(lines):
        out.lines += 1
        ts = e.get("timestamp")
        msg = e.get("message") if isinstance(e.get("message"), dict) else {}
        kind = msg.get("type")
        if kind in KIMI_TYPES:
            out.recognised += 1
        if not isinstance(ts, (int, float)) or kind is None:
            continue
        ts = float(ts)
        payload = msg.get("payload") if isinstance(msg.get("payload"), dict) else {}
        if kind == "TurnBegin":
            out.events.append(Ev(ts, "turn_start"))
            step_ts, step_progress, fast_fail = None, False, False
        elif kind == "StepBegin":
            out.events.append(Ev(ts, "activity"))
            step_ts, step_progress = ts, False
        elif kind in _KIMI_PROGRESS:
            step_progress = True
            out.events.append(Ev(ts, "activity"))
        elif kind == "StepInterrupted":
            if step_ts is not None and not step_progress and ts - step_ts <= KIMI_FAST_FAIL_S:
                fast_fail = True
        elif kind == "TurnEnd":
            out.events.append(Ev(ts, "turn_end"))
            if fast_fail:
                hit = next((f for f in failures or ()
                            if f[1] == session and abs(f[0] - ts) <= 5.0), None)
                if hit:
                    out.events.append(Ev(ts, "blocked", reason=hit[2]))
            fast_fail = False
        elif kind == "ApprovalRequest":
            out.events.append(Ev(ts, "approval_open", ref=str(payload.get("id"))))
        elif kind == "ApprovalResponse":
            out.events.append(Ev(ts, "approval_close", ref=str(payload.get("request_id"))))
        elif kind in KIMI_TYPES:
            out.events.append(Ev(ts, "activity"))
    return out


# ── the one rule ────────────────────────────────────────────────────────

@dataclass
class Ctx:
    now: float
    session_created: float | None      # tmux session_created; None = no session
    cpu_pct: float | None = None       # the agent's CPU, from agent-vitals.jsonl
    cpu_age_s: float | None = None
    question: dict | None = None       # {"ts": epoch, "body": str}, unanswered
    readable: bool = True              # at least one log root could be listed
    unrecognised: bool = False         # the logs found are in a format not understood


def verdict(state: str, reason: str | None = None, since: float | None = None,
            until: float | None = None, **extra) -> dict:
    out: dict = {"state": state}
    if reason:
        out["reason"] = reason
    if since is not None:
        out["since"] = since
    if until is not None:
        out["until"] = until
    out.update(extra)
    return out


def fold(events: list[Ev], ctx: Ctx) -> dict:
    created = ctx.session_created
    if created is None:
        return verdict("spento")
    age = ctx.now - created
    if not ctx.readable:
        return verdict("sconosciuto", "fonti_illeggibili", created)
    mine = [e for e in events if e.ts >= created - CLOCK_SLACK_S]
    if not mine:
        if ctx.unrecognised:
            return verdict("sconosciuto", "formato_non_riconosciuto", created)
        if age < START_GRACE_S:
            return verdict("sconosciuto", "avvio_in_corso", created)
        return verdict("avviato_mai_partito", None, created)

    last = mine[-1]
    # an error or a limit, and nothing that is not a turn's closing after it
    block = next((e for e in reversed(mine) if e.kind == "blocked"), None)
    if block is not None:
        after = mine[mine.index(block) + 1:]
        resumed = any(e.kind not in ("turn_end", "blocked") for e in after)
        lifted = block.until is not None and ctx.now >= block.until
        if not resumed and not lifted:
            return verdict("bloccato", block.reason, block.ts, block.until)

    if any(e.kind == "approval_open" for e in mine):
        closed = {e.ref for e in mine if e.kind == "approval_close"}
        pending = [e for e in mine if e.kind == "approval_open" and e.ref not in closed]
        if pending:
            return verdict("aspetta_umano", None, pending[-1].ts)

    last_start = next((e for e in reversed(mine) if e.kind == "turn_start"), None)
    last_end = next((e for e in reversed(mine) if e.kind == "turn_end"), None)
    # a turn is open until its closing event; a block with nothing after it,
    # once lifted, leaves the CLI waiting for input
    if last.kind in ("turn_start", "activity", "approval_close"):
        silent_s = ctx.now - last.ts
        busy = (ctx.cpu_pct is not None and ctx.cpu_pct > CPU_BUSY_PCT
                and ctx.cpu_age_s is not None and ctx.cpu_age_s <= CPU_FRESH_S)
        started = last_start.ts if last_start else mine[0].ts
        if silent_s < RECENT_S or busy:
            return verdict("lavora", None, started)
        return verdict("sconosciuto", "turno_silenzioso", last.ts)

    closed_at = last_end.ts if last_end else last.ts
    q = ctx.question
    if q and last_start is not None and q["ts"] >= last_start.ts - CLOCK_SLACK_S \
            and ctx.now - q["ts"] <= QUESTION_MAX_AGE_S:
        return verdict("aspetta_umano", None, q["ts"], question=q.get("body"))
    return verdict("idle", None, closed_at)


# ── reading the files ───────────────────────────────────────────────────

def tail_lines(path: Path, limit: int = TAIL_BYTES) -> list[str]:
    """The last lines of a file, the first (possibly cut) one dropped."""
    with path.open("rb") as f:
        size = f.seek(0, os.SEEK_END)
        f.seek(max(0, size - limit))
        data = f.read()
    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    if size > limit and lines:
        lines = lines[1:]
    return lines


def claude_slug(cwd: str) -> str:
    return re.sub(r"[/.]", "-", cwd)


@dataclass
class Sources:
    """Where the three CLIs keep their logs, under one JHT_HOME."""
    home: Path

    @property
    def claude(self) -> Path:
        return self.home / ".claude" / "projects"

    @property
    def codex(self) -> Path:
        return self.home / ".codex" / "sessions"

    @property
    def kimi(self) -> Path:
        return self.home / ".kimi" / "sessions"

    @property
    def kimi_logs(self) -> Path:
        return self.home / ".kimi" / "logs"


def _newer(paths: Iterable[Path], since: float) -> list[Path]:
    keep = []
    for p in paths:
        try:
            if p.stat().st_mtime >= since:
                keep.append(p)
        except OSError:
            continue
    return sorted(keep, key=lambda p: p.stat().st_mtime, reverse=True)


def collect(src: Sources, cwd: str, created: float) -> tuple[list[Ev], bool, bool]:
    """(events, readable, unrecognised) of the agent whose cwd is `cwd`, from
    the logs written since its session started. Events of the CLI with the
    newest one."""
    since = created - CLOCK_SLACK_S
    candidates: list[Parsed] = []
    listed = False
    seen_lines = 0
    seen_known = 0

    def take(parsed: Parsed):
        nonlocal seen_lines, seen_known
        seen_lines += parsed.lines
        seen_known += parsed.recognised
        if parsed.events:
            candidates.append(parsed)

    # Claude
    try:
        root = src.claude / claude_slug(cwd)
        if src.claude.is_dir():
            listed = True
        if root.is_dir():
            for f in _newer(root.glob("*.jsonl"), since)[:2]:
                take(parse_claude(tail_lines(f)))
    except OSError:
        pass
    # Codex: only the date folders from the session's day on
    try:
        if src.codex.is_dir():
            listed = True
            day0 = datetime.fromtimestamp(since).strftime("%Y/%m/%d")
            files = [p for p in src.codex.glob("*/*/*/rollout-*.jsonl")
                     if "/".join(p.parts[-4:-1]) >= day0]
            for f in _newer(files, since)[:4]:
                head = next(_objects(f.open(encoding="utf-8", errors="replace")), {})
                if (head.get("payload") or {}).get("cwd") == cwd:
                    take(parse_codex(tail_lines(f)))
                    break
    except OSError:
        pass
    # Kimi
    try:
        if src.kimi.is_dir():
            listed = True
            root = src.kimi / hashlib.md5(cwd.encode()).hexdigest()
            if root.is_dir():
                failures: list[tuple[float, str, str]] = []
                for log in _newer(src.kimi_logs.glob("kimi.*.log"), since)[:2]:
                    failures += kimi_log_failures(tail_lines(log))
                for wire in _newer(root.glob("*/wire.jsonl"), since)[:1]:
                    take(parse_kimi(tail_lines(wire), wire.parent.name, failures))
    except OSError:
        pass

    unrecognised = seen_lines >= 5 and seen_known == 0
    if not candidates:
        return [], listed, unrecognised
    best = max(candidates, key=lambda p: p.events[-1].ts)
    return best.events, listed, False


def agent_dir(home: Path, uid: str) -> Path | None:
    """$JHT_HOME/agents/<name>; a writer's critic is critico-S<N> on disk."""
    for name in (uid, re.sub(r"-s(\d+)$", r"-S\1", uid)):
        p = home / "agents" / name
        if p.is_dir():
            return p
    return None


def read_cpu(home: Path, uid: str, now: float) -> tuple[float | None, float | None]:
    path = home / "logs" / "agent-vitals.jsonl"
    try:
        lines = tail_lines(path, 64 * 1024)
    except OSError:
        return None, None
    for e in reversed(list(_objects(lines))):
        ts = _iso(e.get("ts"))
        agents = e.get("agents") if isinstance(e.get("agents"), dict) else {}
        if ts is not None and uid in agents and isinstance(agents[uid], dict):
            cpu = agents[uid].get("cpu_pct")
            return (float(cpu) if isinstance(cpu, (int, float)) else None), now - ts
    return None, None


def read_questions(db_path: str, now: float) -> dict[str, dict]:
    """{agent: {"ts", "body"}} of the newest question of each agent that has no
    reply. Read-only: a database that cannot be read means no answer, not an error."""
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=1.0)
        try:
            rows = con.execute(
                "SELECT agent, body, created_at FROM pending_user_messages "
                "WHERE kind = 'question' AND author = 'agent' AND user_reply IS NULL "
                "ORDER BY id").fetchall()
        finally:
            con.close()
    except sqlite3.Error:
        return {}
    out: dict[str, dict] = {}
    for agent, body, created_at in rows:
        try:
            ts = datetime.strptime(str(created_at)[:19], "%Y-%m-%d %H:%M:%S") \
                .replace(tzinfo=timezone.utc).timestamp()
        except ValueError:
            continue
        out[str(agent).lower()] = {"ts": ts, "body": str(body)}
    return out


def question_for(uid: str, questions: dict[str, dict]) -> dict | None:
    """A question names the role (capitano, scout); an instance answers to its
    role only when it is the first one."""
    if uid in questions:
        return questions[uid]
    m = re.match(r"^(.+)-1$", uid)
    return questions.get(m.group(1)) if m else None


def derive(uid: str, home: Path, created: float | None, now: float,
           questions: dict[str, dict] | None = None) -> dict:
    if created is None:
        return verdict("spento")
    cwd = agent_dir(home, uid)
    if cwd is None:
        return verdict("sconosciuto", "fonti_illeggibili", created)
    events, readable, unrecognised = collect(Sources(home), str(cwd), created)
    cpu, cpu_age = read_cpu(home, uid, now)
    ctx = Ctx(now=now, session_created=created, cpu_pct=cpu, cpu_age_s=cpu_age,
              question=question_for(uid, questions or {}), readable=readable,
              unrecognised=unrecognised)
    return fold(events, ctx)


# ── tmux and main ───────────────────────────────────────────────────────

def tmux_sessions() -> dict[str, float]:
    """{session name lower: created epoch}; {} when tmux is not there."""
    try:
        out = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}\t#{session_created}"],
            capture_output=True, text=True, timeout=4).stdout
    except Exception:
        return {}
    sessions = {}
    for line in out.splitlines():
        name, _, created = line.partition("\t")
        try:
            sessions[name.strip().lower()] = float(created)
        except ValueError:
            continue
    return sessions


def jht_home() -> Path:
    return Path(os.environ.get("JHT_HOME", str(Path.home() / ".jht")))


def main() -> None:
    home = jht_home()
    now = time.time()
    db = os.environ.get("JHT_DB") or str(home / "jobs.db")
    questions = read_questions(db, now)
    out = {}
    for uid, created in tmux_sessions().items():
        if agent_dir(home, uid) is None:  # not an agent of the team
            continue
        v = derive(uid, home, created, now, questions)
        if "since" in v:
            v["since"] = round(v["since"], 3)
        out[uid] = v
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    main()
