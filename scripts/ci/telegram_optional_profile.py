#!/usr/bin/env python3
"""Read-only provider probe of the actual compose files; no container daemon.

The pinned podman-compose emits the real creation plan against an inert engine.
A supplied baseline must match its independently obtained source SHA-256.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile


ROOT = Path(__file__).resolve().parents[2]


def creation_plan(provider: str, compose: Path, directory: Path, words: list[str]) -> set[str]:
    engine = directory / "podman"
    engine.write_text(
        '#!/bin/sh\ncase "$1" in --version) echo "podman version 6.1.3" ;; ps) echo "[]" ;; esac\nexit 0\n',
        encoding="utf-8",
    )
    engine.chmod(0o700)
    env = {"PATH": os.defpath, "HOME": str(directory), "LANG": "C.UTF-8",
           "PODMAN_COMPOSE_WARNING_LOGS": "false", "JHT_IMAGE": "example.invalid/jht:fixture"}
    result = subprocess.run(
        [provider, "--podman-path", str(engine), "--project-name", "jht", "-f", str(compose),
         "--dry-run", *words], cwd=directory, env=env, capture_output=True, text=True, timeout=60,
    )
    if result.returncode:
        raise RuntimeError("provider_failed: " + result.stdout + result.stderr)
    names = re.findall(r"--name[= ](jht(?:-broker|-telegram)?)(?=[\s'\",\]]|$)", result.stdout + result.stderr)
    if len(names) != len(set(names)):
        raise RuntimeError("duplicate_container_creation_plan")
    return set(names)


def check(provider: str, before: Path, expected: str) -> dict:
    if hashlib.sha256(before.read_bytes()).hexdigest() != expected:
        raise RuntimeError("baseline_source_hash_mismatch")
    version = subprocess.run([provider, "--version"], capture_output=True, text=True, timeout=15, check=True)
    if "podman-compose version 1.6.0" not in version.stdout + version.stderr:
        raise RuntimeError("provider_version_mismatch")
    current = ROOT / "docker-compose.yml"
    cases = [
        ("before_default", before, ["up", "-d"], {"jht", "jht-broker", "jht-telegram"}),
        ("after_default", current, ["up", "-d"], {"jht", "jht-broker"}),
        ("after_team_only", current, ["up", "-d", "jht"], {"jht"}),
        ("after_telegram", current, ["--profile", "telegram", "up", "-d", "jht-telegram"], {"jht-telegram"}),
    ]
    observations = {}
    with tempfile.TemporaryDirectory(prefix="telegram-compose-probe-") as temporary:
        for name, compose, words, wanted in cases:
            observed = creation_plan(provider, compose, Path(temporary), words)
            if observed != wanted:
                raise RuntimeError(f"{name}: expected {sorted(wanted)}, observed {sorted(observed)}")
            observations[name] = sorted(observed)
    return {"provider": version.stdout.strip(), "baseline_sha256": expected,
            "current_sha256": hashlib.sha256(current.read_bytes()).hexdigest(),
            "services": observations, "real_containers_started": 0}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", default=shutil.which("podman-compose"), required=not shutil.which("podman-compose"))
    parser.add_argument("--before", type=Path, required=True)
    parser.add_argument("--before-sha256", required=True)
    args = parser.parse_args()
    print(json.dumps(check(args.provider, args.before, args.before_sha256), sort_keys=True))


if __name__ == "__main__":
    main()
