#!/usr/bin/env python3
"""Record and verify the immutable identity of release assets.

Each platform runner records the tag commit and SHA-256 of the exact byte
stream it uploads.  The release job downloads those sidecars, verifies every
asset again and only then writes the public checksum/provenance files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path


TAG_RE = re.compile(r"^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SCHEMA_VERSION = 1


class ReleaseArtifactError(RuntimeError):
    """Raised when an asset cannot be tied to the requested release."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _git(root: Path, *args: str) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(root), *args], text=True, stderr=subprocess.PIPE
        ).strip()
    except subprocess.CalledProcessError as exc:
        detail = exc.stderr.strip() or str(exc)
        raise ReleaseArtifactError(f"git {' '.join(args)} failed: {detail}") from exc


def _validate_identity(tag: str, commit: str, repository: str) -> None:
    if not TAG_RE.fullmatch(tag):
        raise ReleaseArtifactError(f"invalid release tag: {tag}")
    if not COMMIT_RE.fullmatch(commit):
        raise ReleaseArtifactError(f"invalid release commit: {commit}")
    if not repository or "/" not in repository:
        raise ReleaseArtifactError(f"invalid repository identity: {repository}")


def record_asset(
    *,
    asset: Path,
    output: Path,
    tag: str,
    commit: str,
    repository: str,
    source_root: Path,
) -> dict[str, object]:
    _validate_identity(tag, commit, repository)
    asset = asset.resolve()
    source_root = source_root.resolve()
    if not asset.is_file() or asset.stat().st_size == 0:
        raise ReleaseArtifactError(f"release asset is missing or empty: {asset}")

    head = _git(source_root, "rev-parse", "HEAD")
    tag_commit = _git(source_root, "rev-list", "-n", "1", tag)
    if head != commit:
        raise ReleaseArtifactError(
            f"build checkout {head} does not match requested commit {commit}"
        )
    if tag_commit != commit:
        raise ReleaseArtifactError(
            f"tag {tag} resolves to {tag_commit}, not requested commit {commit}"
        )

    manifest: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "repository": repository,
        "tag": tag,
        "commit": commit,
        "asset": asset.name,
        "size": asset.stat().st_size,
        "sha256": _sha256(asset),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return manifest


def verify_assets(
    *,
    directory: Path,
    expected_assets: list[str],
    tag: str,
    commit: str,
    repository: str,
    checksums: Path,
    provenance: Path,
) -> dict[str, object]:
    _validate_identity(tag, commit, repository)
    directory = directory.resolve()
    expected_assets = sorted(expected_assets)
    if not expected_assets or len(set(expected_assets)) != len(expected_assets):
        raise ReleaseArtifactError("expected asset names must be unique and non-empty")
    for name in expected_assets:
        if Path(name).name != name:
            raise ReleaseArtifactError(f"asset name must be a basename: {name}")

    expected_sidecars = {f"{name}.provenance.json" for name in expected_assets}
    actual_sidecars = {path.name for path in directory.glob("*.provenance.json")}
    if actual_sidecars != expected_sidecars:
        raise ReleaseArtifactError(
            "provenance sidecars differ from the expected asset set: "
            f"expected={sorted(expected_sidecars)} actual={sorted(actual_sidecars)}"
        )

    verified: list[dict[str, object]] = []
    checksum_lines: list[str] = []
    for name in expected_assets:
        asset = directory / name
        sidecar = directory / f"{name}.provenance.json"
        if not asset.is_file() or asset.stat().st_size == 0:
            raise ReleaseArtifactError(f"release asset is missing or empty: {asset}")
        try:
            manifest = json.loads(sidecar.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise ReleaseArtifactError(f"invalid provenance sidecar: {sidecar}") from exc

        actual_hash = _sha256(asset)
        expected = {
            "schema_version": SCHEMA_VERSION,
            "repository": repository,
            "tag": tag,
            "commit": commit,
            "asset": name,
            "size": asset.stat().st_size,
            "sha256": actual_hash,
        }
        if manifest != expected:
            raise ReleaseArtifactError(
                f"asset provenance mismatch for {name}: {manifest!r} != {expected!r}"
            )
        checksum_lines.append(f"{actual_hash}  {name}")
        verified.append(
            {"asset": name, "size": asset.stat().st_size, "sha256": actual_hash}
        )

    checksums.write_text("\n".join(checksum_lines) + "\n")
    release_provenance: dict[str, object] = {
        "schema_version": SCHEMA_VERSION,
        "repository": repository,
        "tag": tag,
        "commit": commit,
        "assets": verified,
    }
    provenance.write_text(
        json.dumps(release_provenance, indent=2, sort_keys=True) + "\n"
    )
    return release_provenance


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    record = subparsers.add_parser("record", help="record one runner-built asset")
    record.add_argument("--asset", type=Path, required=True)
    record.add_argument("--output", type=Path, required=True)
    record.add_argument("--tag", required=True)
    record.add_argument("--commit", required=True)
    record.add_argument("--repository", required=True)
    record.add_argument("--source-root", type=Path, default=Path.cwd())

    verify = subparsers.add_parser("verify", help="verify all downloaded assets")
    verify.add_argument("--directory", type=Path, required=True)
    verify.add_argument("--expected-asset", action="append", required=True)
    verify.add_argument("--tag", required=True)
    verify.add_argument("--commit", required=True)
    verify.add_argument("--repository", required=True)
    verify.add_argument("--checksums", type=Path, required=True)
    verify.add_argument("--provenance", type=Path, required=True)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "record":
            result = record_asset(
                asset=args.asset,
                output=args.output,
                tag=args.tag,
                commit=args.commit,
                repository=args.repository,
                source_root=args.source_root,
            )
        else:
            result = verify_assets(
                directory=args.directory,
                expected_assets=args.expected_asset,
                tag=args.tag,
                commit=args.commit,
                repository=args.repository,
                checksums=args.checksums,
                provenance=args.provenance,
            )
    except ReleaseArtifactError as exc:
        print(f"release-artifacts: ERROR: {exc}")
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
