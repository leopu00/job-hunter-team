#!/usr/bin/env python3
"""launch_profile.py — the profile as it was when the team started its run (JHT-T355).

A run is replayed from its inputs (`jht run restore <name> --fresh`), and the profile is the first of them. The person keeps
changing it while the team works (a skill, a salary target, a place), so the profile of a snapshot is the one of the END of the run,
not the one the run started from. Here a copy of `$JHT_HOME/profile/` is kept in `$JHT_HOME/profile-at-start/` when a run begins
(first_run.py begin-burst: the profile is ready and the search opens), with `.saved.json` {saved_at, files}. `jht run snapshot` keeps
it, and a fresh restore puts it back as the profile.

    python3 launch_profile.py save [--force]     a copy now; without --force only when there is none yet
    python3 launch_profile.py status             {"saved": bool, "saved_at": ..., "files": n}

Plain files and folders only (a link is never followed); the copy replaces the old one in one rename.
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

COPY_DIR = "profile-at-start"
MARK = ".saved.json"


def _home(home=None) -> Path:
    return Path(home) if home is not None else Path(os.environ.get("JHT_HOME") or "/jht_home")


def _copy_tree(src: Path, dst: Path) -> int:
    count = 0
    dst.mkdir(mode=0o700, exist_ok=True)
    for entry in sorted(src.iterdir()):
        if entry.is_symlink():
            continue
        if entry.is_dir():
            count += _copy_tree(entry, dst / entry.name)
        elif entry.is_file():
            shutil.copyfile(entry, dst / entry.name)
            os.chmod(dst / entry.name, 0o600)
            count += 1
    return count


def status(home=None) -> dict:
    mark = _home(home) / COPY_DIR / MARK
    try:
        data = json.loads(mark.read_text(encoding="utf-8"))
        return {"saved": True, "saved_at": data.get("saved_at"), "files": data.get("files")}
    except (OSError, ValueError):
        return {"saved": False, "saved_at": None, "files": 0}


def save(home=None, force=False, now=None) -> dict:
    """Copy profile/ to profile-at-start/. Without `force` an existing copy is kept: it is the start of the run going on."""
    base = _home(home)
    src = base / "profile"
    if not src.is_dir() or src.is_symlink():
        return {"saved": False, "reason": "no_profile"}
    if not force and status(base)["saved"]:
        return dict(status(base), kept=True)
    tmp = Path(tempfile.mkdtemp(prefix=".profile-at-start-", dir=str(base)))
    try:
        files = _copy_tree(src, tmp)
        stamp = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
        (tmp / MARK).write_text(json.dumps({"saved_at": stamp, "files": files}) + "\n", encoding="utf-8")
        target = base / COPY_DIR
        old = None
        if target.exists():
            old = base / (".profile-at-start-old-%d" % os.getpid())
            os.replace(target, old)
        os.replace(tmp, target)
        if old is not None:
            shutil.rmtree(old, ignore_errors=True)
    except Exception:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    return {"saved": True, "saved_at": stamp, "files": files}


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="launch_profile.py")
    sub = parser.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("save")
    s.add_argument("--force", action="store_true")
    sub.add_parser("status")
    args = parser.parse_args(argv)
    out = save(force=args.force) if args.cmd == "save" else status()
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    sys.exit(main())
