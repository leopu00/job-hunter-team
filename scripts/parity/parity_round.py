#!/usr/bin/env python3
"""A parity round, TUI team against API team, from one command.

The round of 27/09 gave no verdict, and the reasons were all in how it was
run, not in the teams:
  - the reference changed under it: the TUI box was updated twice during the
    window, so its first and last hours ran different code;
  - the API side did not start from a known state: its captain drained old
    mailbox messages and re-read an old diary, took a stale "daily overrun"
    as current, and coasted for two hours;
  - the copies were taken by hand, at hours chosen on the fly, and the spend
    cap of the launcher and the one of the key proxy did not agree;
  - the diff and the report were written by hand.

This script does the round the same way every time:

  check   CONFIG                  read only, both sides: same code revision,
                                  same profile, the API side's known state,
                                  a spend cap that agrees with the budget.
  start   CONFIG --hours H --budget-usd X [--yes]
                                  without --yes: the plan, and nothing else.
                                  With --yes: T0 copy of the TUI db (read
                                  only), the seed, the API side put in a
                                  known state (everything old ARCHIVED, never
                                  deleted), the API team started, then the
                                  watch: copies of both dbs at fixed times,
                                  relaunch of the API team when its roles end,
                                  stop at the cap or at the end of the window,
                                  stop and mark the round invalid if the TUI
                                  side changes code; then diff and report.
  report  ROUND_DIR               the report again, from what the round wrote.

The TUI side is only ever READ: its db is copied through SQLite's backup,
in memory, and the bytes come out on stdout. The API side is written only
where the config says (its db, its mailboxes, its launcher config), and only
by `start --yes`.

Hosts, paths and commands come from a config file kept OUTSIDE git (see
round.example.json and README.md): the repository names no machine. The
transport is ssh with the operator's ssh config, or `local` (the tests).
Every copy, diff and report goes to the config's out_dir, 0700/0600.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import io
import json
import os
import re
import shlex
import sqlite3
import subprocess
import sys
import time
from contextlib import redirect_stdout
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
import jobsdb_parity as parity  # noqa: E402

# The snapshot, run by `python3 -` on the host (inside the TUI container
# through its exec prefix): the db read only, copied in memory, checked, and
# written on stdout. Nothing is written on the host.
SNAPSHOT_PY = r"""
import sqlite3, sys
src = sqlite3.connect("file:" + sys.argv[1] + "?mode=ro", uri=True)
mem = sqlite3.connect(":memory:")
src.backup(mem)
assert mem.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
sys.stdout.buffer.write(mem.serialize())
"""

# Spend of the key proxy: a JSON state with spent_usd and cap_usd.
CAP_MARGIN_USD = 0.02
# A cap on the key proxy this much above the budget is not a backstop.
CAP_SLACK_USD = 0.5
HEX = re.compile(r"^[0-9a-f]{7,40}$")


class RoundError(Exception):
    """The round cannot go on; the message says why, without data."""


# ── hosts ────────────────────────────────────────────────────────────────


@dataclass
class Host:
    name: str
    spec: dict[str, Any]
    ssh_config: str | None = None

    def sh(self, command: str, stdin: bytes | None = None, timeout: int = 180) -> subprocess.CompletedProcess:
        if self.spec.get("transport", "ssh") == "local":
            argv = ["bash", "-c", command]
        else:
            argv = ["ssh"]
            if self.ssh_config:
                argv += ["-F", self.ssh_config]
            argv += ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", self.spec["host"], command]
        return subprocess.run(argv, input=stdin, capture_output=True, timeout=timeout)

    def text(self, command: str, timeout: int = 60) -> str:
        res = self.sh(command, timeout=timeout)
        if res.returncode != 0:
            raise RoundError(f"{self.name}: command failed (rc={res.returncode}): {command.split()[0]}")
        return res.stdout.decode("utf-8", "replace").strip()

    def fmt(self, template: str) -> str:
        """`{root}` and the other scalar keys of the host's spec; any other brace (docker's
        `{{.Image}}`, awk's) stays as written."""
        def value(match: re.Match) -> str:
            key = match.group(1)
            v = self.spec.get(key)
            return str(v) if isinstance(v, (str, int, float)) else match.group(0)

        return re.sub(r"(?<!\{)\{(\w+)\}(?!\})", value, template)

    def exec_prefix(self) -> str:
        return self.spec.get("exec_prefix", "").strip()

    def snapshot(self, out: Path) -> None:
        """The host's jobs.db, at this instant, into `out` (read only on the host)."""
        prefix = self.exec_prefix()
        command = f"{prefix + ' ' if prefix else ''}python3 - {shlex.quote(self.spec['db'])}"
        res = self.sh(command, stdin=SNAPSHOT_PY.encode(), timeout=600)
        if res.returncode != 0 or not res.stdout:
            raise RoundError(f"{self.name}: snapshot failed (rc={res.returncode})")
        tmp = out.with_suffix(".part")
        with open(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600), "wb") as fh:
            fh.write(res.stdout)
        conn = sqlite3.connect(f"file:{tmp}?mode=ro", uri=True)
        try:
            if conn.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
                raise RoundError(f"{self.name}: snapshot is not a sound database")
        finally:
            conn.close()
        tmp.replace(out)


# ── config ───────────────────────────────────────────────────────────────


@dataclass
class Config:
    raw: dict[str, Any]
    tui: Host
    api: Host
    out_dir: Path

    @classmethod
    def load(cls, path: Path) -> "Config":
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
        ssh_config = raw.get("ssh_config")
        if ssh_config:
            ssh_config = os.path.expanduser(ssh_config)
        for side in ("tui", "api"):
            if side not in raw:
                raise RoundError(f"config: section {side} missing")
        return cls(
            raw=raw,
            tui=Host("tui", raw["tui"], ssh_config),
            api=Host("api", raw["api"], ssh_config),
            out_dir=Path(os.path.expanduser(raw["out_dir"])),
        )

    def get(self, key: str, default: Any = None) -> Any:
        return self.raw.get(key, default)


# ── the checks (read only) ───────────────────────────────────────────────


def extract_revision(text: str) -> str:
    """A revision from what a host printed: a bare sha (an image label), or the hex tag
    among an image's tags (`[localhost/jht-api:811212588e localhost/jht-api:latest]`)."""
    text = text.strip().lower()
    if HEX.match(text):
        return text
    tags = re.findall(r":([0-9a-f]{7,40})(?![0-9a-z])", text)
    return tags[0] if len(set(tags)) == 1 else ""


def revision_tui(cfg: Config) -> str:
    return extract_revision(cfg.tui.text(cfg.tui.fmt(cfg.tui.spec["revision_cmd"])))


def revision_api(cfg: Config) -> str:
    """The API image has no revision label: its tag says it (the deploy tags it with the rev)."""
    return extract_revision(cfg.api.text(cfg.api.fmt(cfg.api.spec["revision_cmd"])))


def same_revision(a: str, b: str) -> bool:
    """A full sha against a short one: one is a prefix of the other, at least 7 hex digits."""
    return bool(HEX.match(a) and HEX.match(b)) and (a.startswith(b) or b.startswith(a))


def profile_sha(host: Host) -> str:
    prefix = host.exec_prefix()
    out = host.text(f"{prefix + ' ' if prefix else ''}sha256sum {shlex.quote(host.spec['profile'])}")
    return out.split()[0]


def tui_identity(cfg: Config) -> str:
    """What must not change during the round: the TUI's code and the container's start."""
    cmd = cfg.tui.spec.get("identity_cmd")
    return cfg.tui.text(cfg.tui.fmt(cmd)) if cmd else revision_tui(cfg)


def proxy_state(cfg: Config) -> dict[str, float]:
    raw = cfg.api.text(f"cat {shlex.quote(cfg.api.fmt(cfg.api.spec['proxy_state']))}")
    state = json.loads(raw)
    return {"spent_usd": float(state["spent_usd"]), "cap_usd": float(state["cap_usd"])}


def leftovers(cfg: Config) -> dict[str, int]:
    """What an old round left on the API side that its roles would read: files per glob."""
    root = cfg.api.spec["root"]
    counts = {}
    for pattern in cfg.api.spec.get("known_state_globs", []):
        # nullglob drops a pattern that matches nothing, but a plain path is kept as
        # written whether it exists or not: count what exists. bash explicitly (the
        # remote login shell may not know shopt), and the echo inside the chain: a
        # count that did not run must print nothing, and nothing is refused below.
        script = (f'cd {shlex.quote(root)} && shopt -s nullglob && n=0 && '
                  f'for f in {pattern}; do if [ -e "$f" ]; then n=$((n+1)); fi; done && echo "$n"')
        out = cfg.api.sh(f"bash -c {shlex.quote(script)}", timeout=60)
        text = out.stdout.decode("utf-8", "replace").strip()
        if out.returncode != 0 or not text.isdigit():
            raise RoundError(f"api: leftovers of {pattern} could not be counted (rc={out.returncode})")
        counts[pattern] = int(text)
    return counts


def running_roles(cfg: Config) -> int:
    return int(cfg.api.text(cfg.api.fmt(cfg.api.spec["running_roles_cmd"])) or 0)


@dataclass
class Check:
    ok: bool
    facts: dict[str, Any] = field(default_factory=dict)
    problems: list[str] = field(default_factory=list)


def check(cfg: Config, budget_usd: float | None = None, known_state: bool = True) -> Check:
    facts: dict[str, Any] = {}
    problems: list[str] = []

    tui_rev, api_rev = revision_tui(cfg), revision_api(cfg)
    facts["revision"] = {"tui": tui_rev, "api": api_rev}
    if not same_revision(tui_rev, api_rev):
        problems.append("the two sides do not run the same code revision")

    tui_profile, api_profile = profile_sha(cfg.tui), profile_sha(cfg.api)
    facts["profile_same"] = tui_profile == api_profile
    if tui_profile != api_profile:
        problems.append("the two sides do not have the same candidate profile")

    state = proxy_state(cfg)
    facts["proxy"] = state
    left = round(state["cap_usd"] - state["spent_usd"], 4)
    facts["proxy_left_usd"] = left
    if budget_usd is not None:
        if left < budget_usd - CAP_MARGIN_USD:
            problems.append(f"the key proxy has {left} USD left, less than the budget {budget_usd}: it would stop the round first")
        elif left > budget_usd + CAP_SLACK_USD:
            problems.append(f"the key proxy has {left} USD left, far above the budget {budget_usd}: it is no backstop")

    roles = running_roles(cfg)
    facts["api_roles_running"] = roles
    if roles:
        problems.append(f"{roles} API role(s) already running")

    if known_state:
        left_over = leftovers(cfg)
        facts["leftovers"] = left_over
        for pattern, n in left_over.items():
            if n:
                problems.append(f"{n} file(s) of an earlier round the roles would read: {pattern}")

    return Check(ok=not problems, facts=facts, problems=problems)


# ── the round ────────────────────────────────────────────────────────────


def stamp(now: float) -> str:
    return dt.datetime.fromtimestamp(now, dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")


class Round:
    """One round's directory: copies, diffs, the timeline, the report."""

    def __init__(self, cfg: Config, round_id: str):
        self.cfg = cfg
        self.id = round_id
        self.dir = cfg.out_dir / round_id
        self.dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.dir, 0o700)

    def event(self, now: float, kind: str, **data: Any) -> None:
        line = json.dumps({"ts": dt.datetime.fromtimestamp(now, dt.timezone.utc).isoformat(), "event": kind, **data}, ensure_ascii=False)
        fd = os.open(self.dir / "timeline.jsonl", os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")

    def snap(self, now: float, label: str) -> dict[str, Any]:
        """Both dbs at one instant, the API's spend, and the diff from the seed."""
        tui, api = self.dir / f"tui-{label}.db", self.dir / f"api-{label}.db"
        self.cfg.tui.snapshot(tui)
        self.cfg.api.snapshot(api)
        spend = proxy_state(self.cfg)
        summary = self.diff(label)
        self.event(now, "snapshot", label=label, spent_usd=spend["spent_usd"], **summary)
        return summary

    def diff(self, label: str) -> dict[str, Any]:
        seed = self.dir / "seed-T0.db"
        args = ["diff", "--tui", str(self.dir / f"tui-{label}.db"), "--api", str(self.dir / f"api-{label}.db"), "--seed", str(seed)]
        for suffix, extra in ((".txt", []), (".json", ["--json"])):
            out = io.StringIO()
            with redirect_stdout(out):
                code = parity.main(args + extra)
            path = self.dir / f"diff-{label}{suffix}"
            fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                fh.write(out.getvalue())
        data = json.loads((self.dir / f"diff-{label}.json").read_text(encoding="utf-8"))
        return {"diff_rc": code, "counts": diff_counts(data)}


def diff_counts(data: dict[str, Any]) -> dict[str, dict[str, int]]:
    """Per table: rows only one side wrote, and seed rows each side changed."""
    counts = {}
    for table, rep in data.get("tables", {}).items():
        row = {}
        for key, value in rep.items():
            if isinstance(value, list):
                row[key] = len(value)
            elif isinstance(value, int):
                row[key] = value
        counts[table] = row
    return counts


def api_known_state(cfg: Config, rnd: Round, api_db: Path, budget_usd: float) -> str:
    """The script that puts the API side in a known state. Moves, never deletes."""
    spec = cfg.api.spec
    root = spec["root"]
    archive = f"{root}/archivio-{rnd.id}"
    owner = spec.get("owner", "")
    config_path = f"{root}/{spec['launcher_config']}"
    launcher = dict(cfg.get("launcher_config", {}))
    launcher["session"] = rnd.id
    launcher["sessionUsd"] = budget_usd
    lines = [
        "set -eu",
        "shopt -s nullglob",
        f"cd {shlex.quote(root)}",
        f"A={shlex.quote(archive)}",
        'mkdir -p "$A"',
        'chmod 0700 "$A"',
        # the db directory: archived whole, a fresh one with the prepared db
        f"db_dir={shlex.quote(spec['db_dir'])}",
        '[ -d "$db_dir" ] && mv "$db_dir" "$A/db"',
        'mkdir -p "$db_dir"; chmod 0700 "$db_dir"',
        f'cat > "$db_dir/{Path(spec["db"]).name}"',
    ]
    if owner:
        lines.append(f'chown -R {shlex.quote(owner)} "$db_dir"')
    for pattern in spec.get("known_state_globs", []):
        lines += [
            f"for f in {pattern}; do",
            # nullglob leaves a plain path as written: one already archived is not there
            '  [ -e "$f" ] || continue',
            '  d="$A/state/$(dirname "$f")"; mkdir -p "$d"; mv -n "$f" "$d/"',
            '  [ ! -e "$f" ] || { echo "not moved: $f" >&2; exit 1; }',
            "done",
        ]
    stop = spec.get("stop_file")
    if stop:
        lines += [
            f'if [ -e {shlex.quote(stop)} ]; then mv -n {shlex.quote(stop)} "$A/"; fi',
            f'[ ! -e {shlex.quote(stop)} ] || {{ echo "stop file not moved" >&2; exit 1; }}',
        ]
    # The old launcher config is moved aside, never truncated: a move that failed or
    # was skipped (a copy of that name already there) leaves it in place, and then
    # nothing is written over it (noclobber refuses the write as well).
    lines += [
        f'if [ -e {shlex.quote(config_path)} ]; then mv -n {shlex.quote(config_path)} {shlex.quote(config_path + ".usata-" + rnd.id)}; fi',
        f'[ ! -e {shlex.quote(config_path)} ] || {{ echo "launcher config not moved aside" >&2; exit 1; }}',
        "set -C",
        f"cat > {shlex.quote(config_path)} <<'JSON'",
        json.dumps(launcher, ensure_ascii=False),
        "JSON",
    ]
    if owner:
        lines.append(f"chown {shlex.quote(owner)} {shlex.quote(config_path)}")
    return "\n".join(lines) + "\n"


def install_known_state(cfg: Config, rnd: Round, api_db: Path, budget_usd: float) -> None:
    # The db travels on stdin, after the script: `bash -c` runs the script, `cat` reads the db.
    script = api_known_state(cfg, rnd, api_db, budget_usd)
    res = cfg.api.sh(f"bash -c {shlex.quote(script)}", stdin=api_db.read_bytes(), timeout=600)
    if res.returncode != 0:
        raise RoundError(f"api: known state failed (rc={res.returncode}): {res.stderr.decode('utf-8', 'replace')[-300:]}")


@dataclass
class Clock:
    now: Callable[[], float] = time.time
    sleep: Callable[[float], None] = time.sleep


def plan(cfg: Config, hours: float, budget_usd: float) -> str:
    api = cfg.api.spec
    every = cfg.get("snapshot_every_min", 60)
    return "\n".join([
        f"Parity round: {hours} h, budget {budget_usd} USD on the API side.",
        "1. check (read only): same code revision, same profile, key proxy left ≈ budget, no API role running.",
        f"2. T0: copy of the TUI db (read only); seed; the API db prepared from it (a seed with mock rows is refused).",
        f"3. API known state under {api['root']}/archivio-<round>/ (moved, never deleted): the db dir, "
        + ", ".join(api.get("known_state_globs", [])) + ", the stop file, the launcher config (session = round, sessionUsd = budget).",
        "4. check again: nothing left over, the budget agrees with the key proxy.",
        "5. start: " + " ; ".join(cfg.api.fmt(c) for c in api.get("start_cmds", [])),
        f"6. watch every {cfg.get('tick_s', 60)} s: copies of both dbs every {every} min on the clock; relaunch when no API role runs"
        f" (at most every {cfg.get('relaunch_min_s', 600)} s); STOP at the budget, at the end, or if the TUI side changes code.",
        "7. stop: " + " ; ".join(cfg.api.fmt(c) for c in api.get("stop_cmds", [])) + "; last copies; diff from the seed; REPORT.md.",
        "Nothing is written on the TUI side. Run again with --yes to do it.",
    ])


def run(cfg: Config, hours: float, budget_usd: float, clock: Clock | None = None, round_id: str | None = None) -> Round:
    clock = clock or Clock()
    start = clock.now()
    rnd = Round(cfg, round_id or f"round-{stamp(start)}")
    rnd.event(start, "round", hours=hours, budget_usd=budget_usd)

    first = check(cfg, budget_usd, known_state=False)
    rnd.event(clock.now(), "check", phase="before", ok=first.ok, problems=first.problems, facts=first.facts)
    if not first.ok:
        raise RoundError("check failed before the round: " + "; ".join(first.problems))
    identity = tui_identity(cfg)
    rnd.event(clock.now(), "tui_identity", value=identity)

    # T0: the seed, and the API db from it.
    t0 = rnd.dir / "tui-T0.db"
    cfg.tui.snapshot(t0)
    seed = rnd.dir / "seed-T0.db"
    if parity.seed(t0, seed, force=True) != 0:
        raise RoundError("seed failed")
    api_db = rnd.dir / "api-prepared.db"
    if parity.prepare(seed, api_db, force=True) != 0:
        raise RoundError("prepare refused the seed")
    install_known_state(cfg, rnd, api_db, budget_usd)
    rnd.event(clock.now(), "known_state", archive=f"archivio-{rnd.id}")

    second = check(cfg, budget_usd, known_state=True)
    rnd.event(clock.now(), "check", phase="after_known_state", ok=second.ok, problems=second.problems, facts=second.facts)
    if not second.ok:
        raise RoundError("check failed after the known state: " + "; ".join(second.problems))

    spent0 = proxy_state(cfg)["spent_usd"]
    every = cfg.get("snapshot_every_min", 60) * 60
    tick = cfg.get("tick_s", 60)
    relaunch_gap = cfg.get("relaunch_min_s", 600)
    max_misses = cfg.get("max_consecutive_misses", 10)
    reason, valid, misses = "end_of_window", True, 0
    # From the first start command on, whatever happens (a start command or the T0
    # copy failing, Ctrl-C) ends in the finally: the API team stopped, the report.
    try:
        started = last_start = clock.now()
        rnd.event(started, "start", spent_usd=spent0)
        for command in cfg.api.spec.get("start_cmds", []):
            cfg.api.text(cfg.api.fmt(command), timeout=300)
        rnd.snap(clock.now(), "T0")
        end = started + hours * 3600
        next_snap = (started // every + 1) * every
        while True:
            clock.sleep(tick)
            now = clock.now()
            if now >= end:
                break
            try:
                current = tui_identity(cfg)
                if current != identity:
                    rnd.event(now, "tui_changed", before=identity, after=current)
                    reason, valid = "tui_changed", False
                    break
                spent = proxy_state(cfg)["spent_usd"] - spent0
                if spent >= budget_usd - CAP_MARGIN_USD:
                    rnd.event(now, "budget_reached", spent_usd=round(spent, 4))
                    reason = "budget"
                    break
                if now >= next_snap:
                    rnd.snap(now, f"T{int((now - started) // 60):04d}m")
                    next_snap += every
                if running_roles(cfg) == 0 and now - last_start >= relaunch_gap:
                    for command in cfg.api.spec.get("relaunch_cmds", cfg.api.spec.get("start_cmds", [])[-1:]):
                        cfg.api.text(cfg.api.fmt(command), timeout=300)
                    last_start = now
                    rnd.event(now, "relaunch")
                misses = 0
            except (RoundError, subprocess.TimeoutExpired, OSError, ValueError) as exc:
                # A box that does not answer for a minute is not a reason to lose the round;
                # one that stays silent is: past max_consecutive_misses the round stops.
                misses += 1
                rnd.event(now, "unreachable", error=str(exc)[:200], misses=misses)
                if misses >= max_misses:
                    reason, valid = "unreachable", False
                    break
    except BaseException as exc:  # Ctrl-C included: the API side is stopped all the same
        reason, valid = f"interrupted: {type(exc).__name__}", False
        rnd.event(clock.now(), "interrupted", error=str(exc)[:200])
        raise
    finally:
        now = clock.now()
        for command in cfg.api.spec.get("stop_cmds", []):
            try:
                cfg.api.text(cfg.api.fmt(command), timeout=300)
            except (RoundError, subprocess.TimeoutExpired, OSError) as exc:
                rnd.event(now, "stop_failed", command=command.split()[0], error=str(exc)[:200])
                valid = False
        rnd.event(now, "stop", reason=reason, valid=valid)
        try:
            rnd.snap(clock.now(), "Tend")
        except (RoundError, subprocess.TimeoutExpired, OSError, ValueError) as exc:
            rnd.event(clock.now(), "last_copy_failed", error=str(exc)[:200])
        write_report(rnd)
    return rnd


# ── the report ───────────────────────────────────────────────────────────


def read_timeline(round_dir: Path) -> list[dict[str, Any]]:
    path = round_dir / "timeline.jsonl"
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def write_report(rnd: Round) -> Path:
    text = render_report(rnd.dir)
    path = rnd.dir / "REPORT.md"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(text)
    return path


def render_report(round_dir: Path) -> str:
    events = read_timeline(round_dir)
    head = next((e for e in events if e["event"] == "round"), {})
    checks = [e for e in events if e["event"] == "check"]
    stop = next((e for e in events if e["event"] == "stop"), None)
    snaps = [e for e in events if e["event"] == "snapshot"]
    start = next((e for e in events if e["event"] == "start"), None)

    problems: list[str] = []
    if not checks or not all(c.get("ok") for c in checks):
        problems.append("a check before the start failed")
    if any(e["event"] == "tui_changed" for e in events):
        problems.append("the TUI side changed code or restarted during the window")
    if stop is None:
        problems.append("the round did not stop cleanly (no stop event)")
    elif not stop.get("valid", True) and stop.get("reason") != "tui_changed":
        problems.append(f"the round ended on: {stop.get('reason')}")
    verdict = "VALID" if not problems else "NOT VALID: " + "; ".join(problems)

    rev = (checks[0]["facts"].get("revision") if checks else {}) or {}
    lines = [
        f"# Parity round {round_dir.name}",
        "",
        f"**Verdict: {verdict}**",
        "",
        f"- Window: {head.get('hours')} h from {start['ts'] if start else '—'}; budget {head.get('budget_usd')} USD (API side).",
        f"- Code: TUI {rev.get('tui', '—')} · API {rev.get('api', '—')}.",
        f"- Stop: {stop.get('reason') if stop else '—'} at {stop['ts'] if stop else '—'}.",
        "",
        "## Timeline",
        "",
        "| UTC | Event | Detail |",
        "| --- | --- | --- |",
    ]
    for e in events:
        detail = {k: v for k, v in e.items() if k not in ("ts", "event", "facts", "counts")}
        lines.append(f"| {e['ts'][:19]} | {e['event']} | {json.dumps(detail, ensure_ascii=False)[:160]} |")
    lines += ["", "## Copies and diffs from the seed", "", "| Copy | API spend (USD) | Diff rc | Per table |", "| --- | --- | --- | --- |"]
    spent0 = start.get("spent_usd") if start else None
    for s in snaps:
        spend = round(s["spent_usd"] - spent0, 4) if spent0 is not None else s["spent_usd"]
        tables = "; ".join(
            f"{t}: " + ", ".join(f"{k} {v}" for k, v in sorted(c.items()) if v)
            for t, c in sorted(s.get("counts", {}).items())
            if any(c.values())
        ) or "no difference"
        lines.append(f"| {s['label']} | {spend} | {s['diff_rc']} | {tables} |")
    lines += [
        "",
        "Full diffs: `diff-<copy>.txt` and `.json` next to this file. Reading them: docs of",
        "`scripts/parity/jobsdb_parity.py` (scout rows differ by nature; the seed rows tell parity).",
        "",
    ]
    return "\n".join(lines)


# ── main ─────────────────────────────────────────────────────────────────


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="parity_round", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="command", required=True)
    p = sub.add_parser("check", help="read only: are the two sides ready for a clean round")
    p.add_argument("config", type=Path)
    p.add_argument("--budget-usd", type=float)
    p = sub.add_parser("start", help="the plan, or with --yes the round")
    p.add_argument("config", type=Path)
    p.add_argument("--hours", type=float, required=True)
    p.add_argument("--budget-usd", type=float, required=True)
    p.add_argument("--yes", action="store_true", help="do it (without: print the plan)")
    p = sub.add_parser("report", help="the report again from a round's directory")
    p.add_argument("round_dir", type=Path)
    args = parser.parse_args(argv)

    os.umask(0o077)
    try:
        if args.command == "report":
            print(render_report(args.round_dir))
            return 0
        cfg = Config.load(args.config)
        if args.command == "check":
            result = check(cfg, args.budget_usd)
            print(json.dumps({"ok": result.ok, "problems": result.problems, "facts": result.facts}, indent=2, ensure_ascii=False))
            return 0 if result.ok else 1
        if not args.yes:
            print(plan(cfg, args.hours, args.budget_usd))
            return 0
        rnd = run(cfg, args.hours, args.budget_usd)
        print(rnd.dir / "REPORT.md")
        return 0
    except RoundError as exc:
        print(f"parity_round: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
