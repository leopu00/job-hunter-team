#!/usr/bin/env python3
"""Dump host-side JHT files from a VPS via tar+scp (read-only).

Captures:
- /root/.jht/logs/                (sentinel, bridge, throttle, messages, etc.)
- /root/.jht/profile/             (candidate_profile.yml — anonymize later)
- /root/.jht/state/, data/, runtime/, user/
- /root/.jht/jht.config.json      (later sanitized of secrets)
- /root/.jht/host.env
- /root/.jht/handoff-*.txt        (agent end-of-run snapshots)
- /root/.jht/.*-handoff.md, .*-snapshot.txt  (in-run snapshots)
- /root/.jht/tg-bridge-state-*.json
- /root/.jht/rate_budget*.png     (bridge-generated charts)
- /root/.jht/handover.md
- /root/Documents/Job Hunter Team/  (cv, critiche, allegati, output)

NEVER captured:
- /root/.jht/cloud.json (contains live sync token)
- /root/.jht/agents/    (workspaces + venvs, 400-600 MB, useless for case study)
- *.bak files (assumed stale duplicates of current state)

If --cutoff is given, *.jsonl log files are post-filtered locally to drop
entries with timestamp >= cutoff. Deliverables and other files are NOT
mtime-filtered by this script (logs are the main source of "noise" from
involuntary restarts; the rest is run-end stable).

Usage:
    python3 dump_host_files.py --host IP --key KEYPATH --out OUTDIR [--cutoff ISO]
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tarfile
import tempfile
from pathlib import Path

# Tar include patterns (relative to /root) — host side
INCLUDE = [
    ".jht/logs",
    ".jht/profile",
    ".jht/state",
    ".jht/data",
    ".jht/runtime",
    ".jht/user",
    ".jht/config",
    ".jht/jht.config.json",
    ".jht/host.env",
    ".jht/handover.md",
    "Documents/Job Hunter Team",
]
INCLUDE_GLOBS = [
    ".jht/handoff-*.txt",
    ".jht/.*-handoff.md",
    ".jht/.*-snapshot.txt",
    ".jht/tg-bridge-state-*.json",
    ".jht/rate_budget*.png",
]
# Tar exclude patterns (precedence over include)
EXCLUDE = [
    "*.bak",
    "*.bak-*",
    ".jht/cloud.json",
    ".jht/agents",
]


def ssh_run(host: str, key: Path, command: str) -> str:
    cmd = [
        "ssh",
        "-i",
        str(key),
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=15",
        f"root@{host}",
        command,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    return result.stdout


def scp_get(host: str, key: Path, remote: str, local: Path) -> None:
    subprocess.run(
        ["scp", "-i", str(key), "-o", "BatchMode=yes", f"root@{host}:{remote}", str(local)],
        check=True,
    )


def build_tar_cmd() -> str:
    """Build the remote tar invocation string."""
    excludes = " ".join(f'--exclude="{e}"' for e in EXCLUDE)
    # Use shell glob expansion for INCLUDE_GLOBS by running in bash -c.
    # Tar paths are relative to /root (we cd there first).
    paths = " ".join(INCLUDE) + " " + " ".join(INCLUDE_GLOBS)
    return (
        "cd /root && "
        f"bash -c 'tar czf /tmp/jht-host-snapshot.tar.gz {excludes} {paths} "
        "2>/tmp/tar-warnings.log || true'"
    )


def filter_jsonl_by_cutoff(jsonl_path: Path, cutoff: str) -> tuple[int, int]:
    """Drop JSONL lines with ts >= cutoff. Return (kept, dropped)."""
    if not jsonl_path.exists():
        return (0, 0)
    kept_lines: list[str] = []
    kept = 0
    dropped = 0
    with jsonl_path.open() as f:
        for line in f:
            stripped = line.strip()
            if not stripped:
                continue
            try:
                obj = json.loads(stripped)
            except json.JSONDecodeError:
                kept_lines.append(line)
                kept += 1
                continue
            ts = obj.get("ts") or obj.get("timestamp") or obj.get("created_at")
            if isinstance(ts, str) and ts >= cutoff:
                dropped += 1
                continue
            kept_lines.append(line)
            kept += 1
    if dropped > 0:
        jsonl_path.write_text("".join(kept_lines))
    return (kept, dropped)


def sanitize_config(out_dir: Path) -> None:
    """Redact secrets from jht.config.json if present."""
    cfg_path = out_dir / ".jht" / "jht.config.json"
    if not cfg_path.exists():
        return
    try:
        data = json.loads(cfg_path.read_text())
    except json.JSONDecodeError:
        return
    redacted_keys = ("token", "api_key", "apiKey", "password", "secret", "bot_token", "auth_token")

    def walk(node):
        if isinstance(node, dict):
            for k in list(node.keys()):
                if any(rk in k.lower() for rk in redacted_keys):
                    node[k] = "<redacted>"
                else:
                    walk(node[k])
        elif isinstance(node, list):
            for x in node:
                walk(x)

    walk(data)
    cfg_path.write_text(json.dumps(data, indent=2))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", required=True)
    ap.add_argument("--key", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--cutoff", help='ISO timestamp for JSONL log filtering')
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    # 1. Build tar on the VPS (host-side, no container access needed).
    tar_cmd = build_tar_cmd()
    print(f"  building tar on remote...")
    ssh_run(args.host, args.key, tar_cmd)

    # 2. Get size for sanity
    size_line = ssh_run(args.host, args.key, "ls -la /tmp/jht-host-snapshot.tar.gz | awk '{print $5}'").strip()
    print(f"  tar size: {int(size_line) // 1024} KB")

    # 3. Download and extract
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as f:
        tmp_tar = Path(f.name)
    print(f"  downloading...")
    scp_get(args.host, args.key, "/tmp/jht-host-snapshot.tar.gz", tmp_tar)

    print(f"  extracting → {args.out}")
    with tarfile.open(tmp_tar, "r:gz") as tar:
        # Python 3.12+: filter='data' to suppress security warning
        try:
            tar.extractall(args.out, filter="data")
        except TypeError:
            tar.extractall(args.out)
    tmp_tar.unlink()
    ssh_run(args.host, args.key, "rm -f /tmp/jht-host-snapshot.tar.gz /tmp/tar-warnings.log")

    # 4. Sanitize config secrets
    sanitize_config(args.out)
    print(f"  sanitized jht.config.json (secrets redacted)")

    # 5. Filter JSONL logs by cutoff (drop newer entries)
    if args.cutoff:
        logs_dir = args.out / ".jht" / "logs"
        if logs_dir.exists():
            for jsonl in sorted(logs_dir.glob("*.jsonl")):
                kept, dropped = filter_jsonl_by_cutoff(jsonl, args.cutoff)
                if dropped > 0:
                    print(f"  filtered {jsonl.name}: kept={kept} dropped={dropped}")

    # 6. Summary
    n_files = sum(1 for _ in args.out.rglob("*") if _.is_file())
    print(f"  total files extracted: {n_files}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
