#!/usr/bin/env python3
"""Record and verify the immutable identity of release assets.

Each platform runner records the tag commit and SHA-256 of the exact byte
stream it uploads.  The release job downloads those sidecars, verifies every
asset again and only then writes the public checksum/provenance files.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
from pathlib import Path

try:
    from scripts.release_manifest import (
        ReleaseManifestError,
        artifact_identity,
        verify_artifact_files,
    )
    from scripts.release_signing import ReleaseSigningError, verify_release_signature
except ModuleNotFoundError:  # direct ``python scripts/release_artifacts.py``
    from release_manifest import (  # type: ignore[no-redef]
        ReleaseManifestError,
        artifact_identity,
        verify_artifact_files,
    )
    from release_signing import (  # type: ignore[no-redef]
        ReleaseSigningError,
        verify_release_signature,
    )


TAG_RE = re.compile(r"^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SCHEMA_VERSION = 1
SIGNED_RELEASE_BASELINE = (0, 3, 6)
SIGNED_UPDATE_FILENAMES = {
    "job-hunter-team-windows-x64-portable.exe",
    "jht-windows-update.ps1",
}


class ReleaseArtifactError(RuntimeError):
    """Raised when an asset cannot be tied to the requested release."""


def _identity(path: Path, directory: Path) -> tuple[int, str]:
    try:
        return artifact_identity(path, directory)
    except ReleaseManifestError as exc:
        raise ReleaseArtifactError(str(exc)) from exc


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


def _stable_tag_version(tag: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", tag)
    if not match:
        raise ReleaseArtifactError(
            "signed release tag must be a stable semantic version"
        )
    return tuple(int(match.group(index)) for index in range(1, 4))


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
    asset = asset.parent.resolve() / asset.name
    source_root = source_root.resolve()
    asset_size, asset_sha256 = _identity(asset, asset.parent)

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
        "size": asset_size,
        "sha256": asset_sha256,
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
        try:
            manifest = json.loads(sidecar.read_text())
        except (OSError, json.JSONDecodeError) as exc:
            raise ReleaseArtifactError(
                f"invalid provenance sidecar: {sidecar}"
            ) from exc

        actual_size, actual_hash = _identity(asset, directory)
        expected = {
            "schema_version": SCHEMA_VERSION,
            "repository": repository,
            "tag": tag,
            "commit": commit,
            "asset": name,
            "size": actual_size,
            "sha256": actual_hash,
        }
        if manifest != expected:
            raise ReleaseArtifactError(
                f"asset provenance mismatch for {name}: {manifest!r} != {expected!r}"
            )
        checksum_lines.append(f"{actual_hash}  {name}")
        verified.append({"asset": name, "size": actual_size, "sha256": actual_hash})

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


def audit_published_release(
    *,
    directory: Path,
    tag: str,
    commit: str,
    repository: str,
    release_public_key: Path | None = None,
    allow_legacy_unsigned: bool = False,
) -> dict[str, object]:
    """Re-verify assets downloaded from the GitHub Release draft."""
    _validate_identity(tag, commit, repository)
    directory = directory.resolve()
    manifest_path = directory / "RELEASE-MANIFEST.json"
    signature_path = directory / "RELEASE-MANIFEST.json.sig"
    tag_version = _stable_tag_version(tag)
    signed: dict[str, object] | None = None
    if tag_version >= SIGNED_RELEASE_BASELINE:
        if release_public_key is None:
            raise ReleaseArtifactError("signed release public key is required")
        try:
            signed = verify_release_signature(
                manifest=manifest_path,
                signature=signature_path,
                public_key=release_public_key,
            )
        except (ReleaseManifestError, ReleaseSigningError) as exc:
            raise ReleaseArtifactError("signed release authority audit failed") from exc
        if (
            signed["tag"] != tag
            or signed["commit"] != commit
            or signed["repository"] != repository
        ):
            raise ReleaseArtifactError("signed release identity mismatch")
    elif not allow_legacy_unsigned:
        raise ReleaseArtifactError("legacy unsigned audit requires explicit opt-in")

    checksums_path = directory / "SHA256SUMS"
    provenance_path = directory / "RELEASE-PROVENANCE.json"
    try:
        release_provenance = json.loads(provenance_path.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ReleaseArtifactError(
            f"invalid public release provenance: {provenance_path}"
        ) from exc

    assets = release_provenance.get("assets")
    if not isinstance(assets, list) or not assets:
        raise ReleaseArtifactError("public release provenance has no assets")
    expected_header = {
        "schema_version": SCHEMA_VERSION,
        "repository": repository,
        "tag": tag,
        "commit": commit,
    }
    if {key: release_provenance.get(key) for key in expected_header} != expected_header:
        raise ReleaseArtifactError("public release provenance identity mismatch")

    expected_names: list[str] = []
    provenance_by_name: dict[str, dict[str, object]] = {}
    for entry in assets:
        if not isinstance(entry, dict):
            raise ReleaseArtifactError(
                "public release provenance asset is not an object"
            )
        name = entry.get("asset")
        if not isinstance(name, str) or Path(name).name != name:
            raise ReleaseArtifactError(f"invalid public release asset name: {name!r}")
        if name in provenance_by_name:
            raise ReleaseArtifactError(f"duplicate public release asset: {name}")
        expected_names.append(name)
        provenance_by_name[name] = entry
    if expected_names != sorted(expected_names):
        raise ReleaseArtifactError(
            "public release assets are not deterministically sorted"
        )

    try:
        checksum_lines = checksums_path.read_text().splitlines()
    except OSError as exc:
        raise ReleaseArtifactError(
            f"missing public checksums: {checksums_path}"
        ) from exc
    checksum_by_name: dict[str, str] = {}
    for line in checksum_lines:
        match = re.fullmatch(r"([0-9a-f]{64})  ([^/\\]+)", line)
        if not match or match.group(2) in checksum_by_name:
            raise ReleaseArtifactError(f"invalid SHA256SUMS line: {line!r}")
        checksum_by_name[match.group(2)] = match.group(1)
    if sorted(checksum_by_name) != expected_names:
        raise ReleaseArtifactError("SHA256SUMS asset set does not match provenance")

    actual_files = {
        path.name
        for path in directory.iterdir()
        if path.is_file()
        and path.name
        not in {
            "SHA256SUMS",
            "RELEASE-PROVENANCE.json",
            "RELEASE-MANIFEST.json",
            "RELEASE-MANIFEST.json.sig",
        }
    }
    if actual_files != set(expected_names):
        raise ReleaseArtifactError(
            "downloaded release asset set differs from provenance: "
            f"expected={expected_names} actual={sorted(actual_files)}"
        )

    for name in expected_names:
        asset = directory / name
        actual_size, actual_sha256 = _identity(asset, directory)
        actual = {
            "asset": name,
            "size": actual_size,
            "sha256": actual_sha256,
        }
        if provenance_by_name[name] != actual:
            raise ReleaseArtifactError(
                f"downloaded asset differs from provenance: {name}"
            )
        if checksum_by_name[name] != actual["sha256"]:
            raise ReleaseArtifactError(
                f"downloaded asset differs from SHA256SUMS: {name}"
            )

    if signed is not None:
        try:
            verify_artifact_files(directory=directory, manifest=signed)
        except (ReleaseManifestError, ReleaseSigningError) as exc:
            raise ReleaseArtifactError("signed release authority audit failed") from exc
        signed_assets = {
            entry["filename"]: {
                "asset": entry["filename"],
                "size": entry["size"],
                "sha256": entry["sha256"],
            }
            for entry in signed["artifacts"]  # type: ignore[union-attr]
        }
        signed_provenance = {
            name: provenance_by_name.get(name) for name in SIGNED_UPDATE_FILENAMES
        }
        if signed_assets != signed_provenance:
            raise ReleaseArtifactError(
                "signed update assets differ from release provenance"
            )
    return release_provenance


def render_release_notes(
    *,
    notes: str,
    provenance: Path,
    output: Path,
    tag: str,
    repository: str,
) -> str:
    """Render the GitHub Release body from verified provenance.

    `RELEASE-PROVENANCE.json` is the existing authority for the published
    asset set.  Iterating it here keeps filenames and hashes out of a second
    release-notes list while still failing closed before the draft is made.
    """
    try:
        release_provenance = json.loads(provenance.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ReleaseArtifactError(
            f"invalid release provenance for notes: {provenance}"
        ) from exc

    commit = str(release_provenance.get("commit", ""))
    _validate_identity(tag, commit, repository)
    expected_header = {
        "schema_version": SCHEMA_VERSION,
        "repository": repository,
        "tag": tag,
        "commit": commit,
    }
    if {key: release_provenance.get(key) for key in expected_header} != expected_header:
        raise ReleaseArtifactError("release provenance identity mismatch for notes")

    assets = release_provenance.get("assets")
    if not isinstance(assets, list) or not assets:
        raise ReleaseArtifactError("release provenance for notes has no assets")

    checksum_lines: list[str] = []
    names: list[str] = []
    for entry in assets:
        if not isinstance(entry, dict):
            raise ReleaseArtifactError("release provenance asset is not an object")
        name = entry.get("asset")
        size = entry.get("size")
        digest = entry.get("sha256")
        if (
            not isinstance(name, str)
            or Path(name).name != name
            or not isinstance(size, int)
            or isinstance(size, bool)
            or size <= 0
            or not isinstance(digest, str)
            or re.fullmatch(r"[0-9a-f]{64}", digest) is None
        ):
            raise ReleaseArtifactError(
                f"invalid release provenance asset for notes: {entry!r}"
            )
        if name in names:
            raise ReleaseArtifactError(f"duplicate release provenance asset: {name}")
        names.append(name)
        checksum_lines.append(f"{digest}  {name}")
    if names != sorted(names):
        raise ReleaseArtifactError("release provenance assets are not sorted for notes")

    curated = notes.strip() or "- Release prepared without curated notes."
    checksums = "\n".join(checksum_lines)
    body = f"""## What's new in {tag}

{curated}

### Windows

Use `job-hunter-team-windows-x64-setup.exe` for the normal per-user installation. `job-hunter-team-windows-x64-portable.exe` is the optional standalone build. Neither Windows file is code-signed, so Windows may show **\"Windows protected your PC\"**: click **More info** → **Run anyway** only for files downloaded from this release and matching the SHA-256 values below. The macOS `.zip` is signed and notarized by Apple; the Linux `.tar.gz` is unsigned as well.

### SHA-256 checksums

These digests come from the verified release provenance for the exact assets attached to this release:

```text
{checksums}
```

`SHA256SUMS` contains the same machine-readable values. `RELEASE-PROVENANCE.json` also records the exact tagged commit and byte size for every attached artifact.

---
See [CHANGELOG.md](https://github.com/{repository}/blob/{tag}/CHANGELOG.md) for the full history.
"""
    try:
        output.write_text(body, encoding="utf-8")
    except OSError as exc:
        raise ReleaseArtifactError(f"cannot write release notes: {output}") from exc
    return body


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

    audit = subparsers.add_parser("audit", help="audit downloaded draft assets")
    audit.add_argument("--directory", type=Path, required=True)
    audit.add_argument("--tag", required=True)
    audit.add_argument("--commit", required=True)
    audit.add_argument("--repository", required=True)
    audit.add_argument("--release-public-key", type=Path)
    audit.add_argument("--allow-legacy-unsigned", action="store_true")

    notes = subparsers.add_parser(
        "notes", help="render a GitHub Release body from verified provenance"
    )
    notes.add_argument("--notes", required=True)
    notes.add_argument("--provenance", type=Path, required=True)
    notes.add_argument("--output", type=Path, required=True)
    notes.add_argument("--tag", required=True)
    notes.add_argument("--repository", required=True)
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
        elif args.command == "verify":
            result = verify_assets(
                directory=args.directory,
                expected_assets=args.expected_asset,
                tag=args.tag,
                commit=args.commit,
                repository=args.repository,
                checksums=args.checksums,
                provenance=args.provenance,
            )
        elif args.command == "audit":
            result = audit_published_release(
                directory=args.directory,
                tag=args.tag,
                commit=args.commit,
                repository=args.repository,
                release_public_key=args.release_public_key,
                allow_legacy_unsigned=args.allow_legacy_unsigned,
            )
        else:
            result = render_release_notes(
                notes=args.notes,
                provenance=args.provenance,
                output=args.output,
                tag=args.tag,
                repository=args.repository,
            )
    except ReleaseArtifactError as exc:
        print(f"release-artifacts: ERROR: {exc}")
        return 1
    print(result if isinstance(result, str) else json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
