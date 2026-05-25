#!/usr/bin/env python3
"""Pack the per-VPS extraction directories into a single zip archive.

Usage:
    python3 pack_zip.py --root SNAPSHOT_ROOT --out ZIP_PATH
"""
from __future__ import annotations

import argparse
import sys
import zipfile
from pathlib import Path


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--root", required=True, type=Path, help="Snapshot root containing per-VPS subdirs")
    ap.add_argument("--out", required=True, type=Path, help="Output .zip path")
    args = ap.parse_args()

    files: list[Path] = sorted(p for p in args.root.rglob("*") if p.is_file())
    total_bytes = sum(p.stat().st_size for p in files)
    print(f"  packing {len(files)} files ({total_bytes // (1024 * 1024)} MB)...")

    with zipfile.ZipFile(args.out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for p in files:
            zf.write(p, p.relative_to(args.root.parent))

    out_mb = args.out.stat().st_size / (1024 * 1024)
    print(f"  zip: {args.out} ({out_mb:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
