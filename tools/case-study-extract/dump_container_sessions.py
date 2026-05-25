#!/usr/bin/env python3
"""Dump CLI session logs (wire.jsonl / rollout-*.jsonl) from inside the
container.

Codex uses /jht_home/.codex/sessions/<sid>/rollout-*.jsonl.
Kimi  uses /jht_home/.kimi/sessions/<top>/<sub>/wire.jsonl.

These are large (100-200 MB) but contain per-turn token_usage breakdowns —
the only authoritative source for token consumption when the bridge's
token-meter.csv was reset by a container restart (Kimi case).

Read-only. We tar the sessions directory inside the container, docker cp it
to host /tmp, scp to local, then untar. We auto-detect which provider's
sessions exist (codex or kimi).

If --cutoff is given, individual session files newer than the cutoff (by
mtime as captured in the tar metadata) are dropped during local extraction.

Usage:
    python3 dump_container_sessions.py --host IP --key KEYPATH --out OUTDIR [--cutoff ISO]
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def ssh_run(host: str, key: Path, command: str) -> str:
    result = subprocess.run(
        ["ssh", "-i", str(key), "-o", "BatchMode=yes", "-o", "ConnectTimeout=15", f"root@{host}", command],
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def scp_get(host: str, key: Path, remote: str, local: Path) -> None:
    subprocess.run(
        ["scp", "-i", str(key), "-o", "BatchMode=yes", f"root@{host}:{remote}", str(local)],
        check=True,
    )


def detect_provider(host: str, key: Path) -> str | None:
    """Return 'codex' or 'kimi' based on which container dir is populated.

    Avoid nested-shell variable interpolation pitfalls by checking each
    provider with a simple, non-templated `docker exec find` command.
    """
    for p in ("codex", "kimi"):
        try:
            count = ssh_run(
                host,
                key,
                f"docker exec jht find /jht_home/.{p}/sessions -type f 2>/dev/null | head -3 | wc -l",
            ).strip()
            if int(count) > 0:
                return p
        except (subprocess.CalledProcessError, ValueError):
            continue
    return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", required=True)
    ap.add_argument("--key", required=True, type=Path)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--cutoff", help='ISO timestamp; session files newer than this are dropped')
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    provider = detect_provider(args.host, args.key)
    if not provider:
        print("  ! no codex / kimi sessions found in container — skipping")
        return 0
    print(f"  detected provider: {provider}")

    container_path = f"/jht_home/.{provider}/sessions"

    # 1. Build tar inside container, copy to host /tmp
    print(f"  building tar of {container_path}...")
    ssh_run(
        args.host,
        args.key,
        f'docker exec jht tar czf /tmp/sessions.tar.gz -C /jht_home/.{provider} sessions',
    )
    ssh_run(args.host, args.key, "docker cp jht:/tmp/sessions.tar.gz /tmp/sessions.tar.gz")
    ssh_run(args.host, args.key, "docker exec jht rm /tmp/sessions.tar.gz")

    size_kb = int(ssh_run(args.host, args.key, "stat -c%s /tmp/sessions.tar.gz").strip()) // 1024
    print(f"  tar size: {size_kb} KB")

    # 2. Download
    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as f:
        tmp_tar = Path(f.name)
    scp_get(args.host, args.key, "/tmp/sessions.tar.gz", tmp_tar)
    ssh_run(args.host, args.key, "rm -f /tmp/sessions.tar.gz")

    # 3. Extract with optional cutoff filter (by mtime in tar metadata)
    out_dir = args.out / "sessions"
    out_dir.mkdir(exist_ok=True)
    (args.out / "PROVIDER").write_text(provider)

    cutoff_epoch: float | None = None
    if args.cutoff:
        # Accept "YYYY-MM-DD HH:MM:SS" or ISO 8601 (with or without timezone)
        c = args.cutoff.replace("T", " ").rstrip("Z")
        try:
            dt = datetime.fromisoformat(c)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            cutoff_epoch = dt.timestamp()
        except ValueError:
            print(f"  ! invalid cutoff format: {args.cutoff}")
            return 1

    kept = 0
    dropped = 0
    with tarfile.open(tmp_tar, "r:gz") as tar:
        for member in tar.getmembers():
            if cutoff_epoch is not None and member.isfile() and member.mtime >= cutoff_epoch:
                dropped += 1
                continue
            try:
                tar.extract(member, out_dir, filter="data")
            except TypeError:
                tar.extract(member, out_dir)
            if member.isfile():
                kept += 1
    tmp_tar.unlink()

    print(f"  extracted {kept} session files{f' (dropped {dropped} newer than cutoff)' if dropped else ''}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
