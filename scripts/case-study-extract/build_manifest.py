#!/usr/bin/env python3
"""Generate a manifest.json describing a per-VPS extraction.

Writes summary metadata (extraction timestamp, cutoff, VPS info, file
inventory with sizes and SHA-256) so we have a reproducible reference for
what was captured.

Usage:
    python3 build_manifest.py --out OUTDIR --label LABEL --host HOST [--cutoff ISO]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import platform
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def file_sha256(p: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with p.open("rb") as f:
        while True:
            buf = f.read(chunk)
            if not buf:
                break
            h.update(buf)
    return h.hexdigest()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True, type=Path)
    ap.add_argument("--label", required=True, help='Human label, e.g. "codex-vps1"')
    ap.add_argument("--host", required=True)
    ap.add_argument("--cutoff", default=None)
    args = ap.parse_args()

    inventory: list[dict] = []
    total_bytes = 0
    for p in sorted(args.out.rglob("*")):
        if p.is_file() and p.name != "manifest.json":
            size = p.stat().st_size
            total_bytes += size
            inventory.append(
                {
                    "path": str(p.relative_to(args.out)),
                    "size_bytes": size,
                    "sha256": file_sha256(p),
                }
            )

    git_sha = ""
    try:
        git_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True
        ).stdout.strip()
    except Exception:
        pass

    manifest = {
        "label": args.label,
        "vps_host": args.host,
        "extracted_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "extracted_by": platform.node(),
        "git_sha_at_extraction": git_sha,
        "cutoff": args.cutoff,
        "constraints": {
            "read_only_on_vps": True,
            "no_agent_spawn": True,
            "secrets_redacted": ["jht.config.json", "cloud.json (excluded entirely)"],
            "pii_redacted_in": ["profile/candidate_profile.yml (anonymize_profile.py)"],
            "excluded_dirs": ["agents/ (workspaces + venvs)"],
        },
        "summary": {
            "file_count": len(inventory),
            "total_bytes": total_bytes,
            "total_mb": round(total_bytes / (1024 * 1024), 2),
        },
        "inventory": inventory,
    }

    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(
        f"  manifest: {len(inventory)} files · {manifest['summary']['total_mb']} MB"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
