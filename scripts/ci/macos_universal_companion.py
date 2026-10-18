#!/usr/bin/env python3
"""Put the existing-team companion into the macOS universal target.

The desktop crate has two binaries: jht-desktop (the shell) and
jht-existing-team (src/bin/, the read-only companion of the CLI). The
bundler copies every binary of the crate into Contents/MacOS. For
`--target universal-apple-darwin` the Tauri CLI builds both architectures
but runs `lipo` on the main binary only, so the bundle step stops with
«Failed to copy binary … universal-apple-darwin/release/jht-existing-team
does not exist».

Run as the `beforeBundleCommand` of the universal build (see
desktop/src-tauri/tauri.macos-universal.conf.json): it makes the universal
companion from the two per-architecture ones with `lipo`, building a missing
one with cargo, and checks that it holds both slices.
"""
import os
import subprocess
import sys
from pathlib import Path

BINARY = "jht-existing-team"
ARCHES = {"aarch64-apple-darwin": "arm64", "x86_64-apple-darwin": "x86_64"}
TAURI_DIR = Path(__file__).resolve().parents[2] / "desktop" / "src-tauri"


def main() -> int:
    target = Path(os.environ.get("CARGO_TARGET_DIR") or TAURI_DIR / "target")
    slices = []
    for triple in ARCHES:
        built = target / triple / "release" / BINARY
        if not built.is_file():
            subprocess.run(
                ["cargo", "build", "--release", "--locked", "--bin", BINARY, "--target", triple,
                 "--manifest-path", str(TAURI_DIR / "Cargo.toml")],
                check=True,
            )
        if not built.is_file():
            print(f"{BINARY}: {built} missing after cargo build", file=sys.stderr)
            return 1
        slices.append(str(built))
    universal = target / "universal-apple-darwin" / "release" / BINARY
    universal.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(["lipo", "-create", *slices, "-output", str(universal)], check=True)
    archs = set(subprocess.run(["lipo", "-archs", str(universal)], check=True,
                               capture_output=True, text=True).stdout.split())
    if archs != set(ARCHES.values()):
        print(f"{BINARY}: universal slices {sorted(archs)}, expected {sorted(ARCHES.values())}",
              file=sys.stderr)
        return 1
    print(f"{BINARY}: universal ({' '.join(sorted(archs))}) at {universal}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
