#!/usr/bin/env python3
"""Gate the macOS universal bundle on what is really shipped.

The universal binary next to the bundle is not the proof: what the person
installs is the .app, and with `--bundles dmg` Tauri deletes the .app once the
dmg is made. So every .app found under the bundle folder, and the one inside
every dmg (mounted read-only), must carry both binaries of the desktop crate,
jht-desktop and the jht-existing-team companion: present, executable, both
slices arm64 and x86_64, and signed as the workflow expects (`codesign
--verify --deep --strict`, plus the kind of signature).

Usage: verify_macos_universal_bundle.py <bundle dir> --signature adhoc|developer-id [--require-dmg]
"""
import argparse
import os
import subprocess
import sys
import tempfile
from pathlib import Path

BINARIES = ("jht-desktop", "jht-existing-team")
SLICES = {"arm64", "x86_64"}
SIGNATURE = {"adhoc": "Signature=adhoc", "developer-id": "Authority=Developer ID Application"}


def run(argv):
    return subprocess.run(argv, capture_output=True, text=True)


def check_app(app: Path, signature: str) -> list:
    problems = []
    for name in BINARIES:
        binary = app / "Contents" / "MacOS" / name
        if not binary.is_file():
            problems.append(f"{app.name}: {name} missing")
            continue
        if not os.access(binary, os.X_OK):
            problems.append(f"{app.name}: {name} not executable")
        archs = set(run(["lipo", "-archs", str(binary)]).stdout.split())
        if archs != SLICES:
            problems.append(f"{app.name}: {name} slices {sorted(archs)}, expected {sorted(SLICES)}")
        verify = run(["codesign", "--verify", "--strict", str(binary)])
        if verify.returncode:
            problems.append(f"{app.name}: {name} codesign --verify: {verify.stderr.strip()}")
    verify = run(["codesign", "--verify", "--deep", "--strict", str(app)])
    if verify.returncode:
        problems.append(f"{app.name}: codesign --verify --deep: {verify.stderr.strip()}")
    details = run(["codesign", "-dvv", str(app)]).stderr
    if SIGNATURE[signature] not in details:
        problems.append(f"{app.name}: expected «{SIGNATURE[signature]}» in codesign -dvv")
    return problems


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--signature", choices=sorted(SIGNATURE), required=True)
    parser.add_argument("--require-dmg", action="store_true")
    args = parser.parse_args()

    problems, checked = [], []
    for app in sorted((args.bundle / "macos").glob("*.app")):
        problems += check_app(app, args.signature)
        checked.append(str(app))
    dmgs = sorted((args.bundle / "dmg").glob("*.dmg"))
    if args.require_dmg and not dmgs:
        problems.append(f"no dmg under {args.bundle / 'dmg'}")
    for dmg in dmgs:
        with tempfile.TemporaryDirectory() as mount:
            attach = run(["hdiutil", "attach", "-nobrowse", "-readonly", "-noautoopen",
                          "-mountpoint", mount, str(dmg)])
            if attach.returncode:
                problems.append(f"{dmg.name}: hdiutil attach: {attach.stderr.strip()}")
                continue
            try:
                apps = sorted(Path(mount).glob("*.app"))
                if not apps:
                    problems.append(f"{dmg.name}: no .app inside")
                for app in apps:
                    problems += [f"{dmg.name}/{p}" for p in check_app(app, args.signature)]
                    checked.append(f"{dmg.name}/{app.name}")
            finally:
                run(["hdiutil", "detach", mount, "-force"])
    if not checked and not problems:
        problems.append(f"nothing to check under {args.bundle}")
    for line in checked:
        print(f"checked {line}")
    for problem in problems:
        print(f"FAIL {problem}", file=sys.stderr)
    if problems:
        return 1
    print(f"OK: {', '.join(BINARIES)} universal ({' '.join(sorted(SLICES))}), signature {args.signature}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
