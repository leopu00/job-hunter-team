#!/usr/bin/env python3
"""Build and validate the signed release-manifest payload.

The signature is deliberately handled by ``release_signing.py``.  This module
owns only the canonical, strictly typed bytes that are sent across the
provider-neutral signing boundary and later parsed by the Windows helper.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import stat
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


MAX_MANIFEST_BYTES = 65_536
MAX_ARTIFACTS = 64
MAX_UINT64 = (1 << 64) - 1
SCHEMA_VERSION = 1
PRODUCT = "job-hunter-team"
REPOSITORY = "leopu00/job-hunter-team"
CHANNEL = "stable"

KEY_ID_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SEMVER_RE = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$")
PUBLISHED_AT_RE = re.compile(
    r"^[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])"
    r"T(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]Z$"
)
TOKEN_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
FILENAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

TOP_KEYS = {
    "schema_version",
    "key_id",
    "product",
    "repository",
    "channel",
    "sequence",
    "version",
    "tag",
    "commit",
    "published_at",
    "artifacts",
}
ARTIFACT_KEYS = {
    "role",
    "platform",
    "arch",
    "filename",
    "size",
    "sha256",
    "protocol",
}
ALLOWED_ARTIFACTS = {
    "windows-desktop": {
        "platform": "windows",
        "arch": "x86_64",
        "filename": "job-hunter-team-windows-x64-portable.exe",
        "protocol": "jht-windows-desktop-v1",
    },
    "windows-update-helper": {
        "platform": "windows",
        "arch": "x86_64",
        "filename": "jht-windows-update.ps1",
        "protocol": "jht-windows-update-v1",
    },
}


class ReleaseManifestError(RuntimeError):
    """The signed payload is not canonical or violates the release contract."""


def _object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    value: dict[str, Any] = {}
    for key, item in pairs:
        if key in value:
            raise ReleaseManifestError(f"duplicate JSON key: {key}")
        value[key] = item
    return value


def canonical_bytes(value: dict[str, Any]) -> bytes:
    try:
        encoded = (
            json.dumps(
                value,
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=True,
                allow_nan=False,
            )
            + "\n"
        ).encode("ascii")
    except (TypeError, ValueError, UnicodeEncodeError) as exc:
        raise ReleaseManifestError("manifest is not canonical ASCII JSON") from exc
    if len(encoded) > MAX_MANIFEST_BYTES:
        raise ReleaseManifestError("manifest exceeds 65536 bytes")
    return encoded


def _strict_int(value: Any, *, name: str, minimum: int = 0) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ReleaseManifestError(f"{name} must be an integer")
    if value < minimum or value > MAX_UINT64:
        raise ReleaseManifestError(f"{name} is out of range")
    return value


def _semver_parts(version: str) -> tuple[int, int, int]:
    match = SEMVER_RE.fullmatch(version) if isinstance(version, str) else None
    if not match:
        raise ReleaseManifestError(f"invalid stable semantic version: {version!r}")
    return tuple(int(match.group(index)) for index in range(1, 4))


def version_sequence(version: str) -> int:
    """Return a monotonic uint64 sequence for stable semantic versions."""
    major, minor, patch = _semver_parts(version)
    component_limit = (1 << 21) - 1
    if any(component > component_limit for component in (major, minor, patch)):
        raise ReleaseManifestError("semantic-version component exceeds sequence range")
    sequence = (major << 42) | (minor << 21) | patch
    if sequence == 0:
        raise ReleaseManifestError("release sequence must be positive")
    return sequence


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def artifact_identity(path: Path, directory: Path) -> tuple[int, str]:
    if path.parent != directory or path.is_symlink():
        raise ReleaseManifestError(f"release artifact path is unsafe: {path.name}")
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise ReleaseManifestError(
            f"release artifact is unreadable: {path.name}"
        ) from exc
    digest = hashlib.sha256()
    try:
        identity = os.fstat(descriptor)
        if not stat.S_ISREG(identity.st_mode) or identity.st_size <= 0:
            raise ReleaseManifestError(
                f"release artifact is missing or empty: {path.name}"
            )
        with os.fdopen(descriptor, "rb", closefd=False) as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
        after = os.fstat(descriptor)
        if (
            identity.st_dev,
            identity.st_ino,
            identity.st_size,
            identity.st_mtime_ns,
            identity.st_ctime_ns,
        ) != (
            after.st_dev,
            after.st_ino,
            after.st_size,
            after.st_mtime_ns,
            after.st_ctime_ns,
        ):
            raise ReleaseManifestError(
                f"release artifact changed while hashing: {path.name}"
            )
        return identity.st_size, digest.hexdigest()
    finally:
        os.close(descriptor)


def validate_manifest(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != TOP_KEYS:
        raise ReleaseManifestError("manifest top-level keys differ from schema v1")
    if _strict_int(value["schema_version"], name="schema_version") != SCHEMA_VERSION:
        raise ReleaseManifestError("unsupported manifest schema_version")
    if not isinstance(value["key_id"], str) or not KEY_ID_RE.fullmatch(value["key_id"]):
        raise ReleaseManifestError("manifest key_id is not a DER-SPKI SHA-256")
    if value["product"] != PRODUCT or value["repository"] != REPOSITORY:
        raise ReleaseManifestError("manifest product/repository binding mismatch")
    if value["channel"] != CHANNEL:
        raise ReleaseManifestError("only the stable update channel is accepted")
    sequence = _strict_int(value["sequence"], name="sequence", minimum=1)
    version = value["version"]
    if not isinstance(version, str):
        raise ReleaseManifestError("version must be a string")
    if sequence != version_sequence(version):
        raise ReleaseManifestError("sequence does not match semantic version")
    if value["tag"] != f"v{version}":
        raise ReleaseManifestError("tag/version binding mismatch")
    if not isinstance(value["commit"], str) or not COMMIT_RE.fullmatch(value["commit"]):
        raise ReleaseManifestError("invalid release commit")
    if not isinstance(value["published_at"], str) or not PUBLISHED_AT_RE.fullmatch(
        value["published_at"]
    ):
        raise ReleaseManifestError("published_at must be canonical UTC seconds")
    try:
        parsed_time = datetime.strptime(value["published_at"], "%Y-%m-%dT%H:%M:%SZ")
        parsed_time.replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise ReleaseManifestError("published_at is not a real UTC timestamp") from exc

    artifacts = value["artifacts"]
    if not isinstance(artifacts, list) or len(artifacts) != 2:
        raise ReleaseManifestError("artifacts must contain exactly two entries")
    ordered: list[tuple[str, str, str, str]] = []
    filenames: set[str] = set()
    role_counts: dict[str, int] = {}
    for entry in artifacts:
        if not isinstance(entry, dict) or set(entry) != ARTIFACT_KEYS:
            raise ReleaseManifestError("artifact keys differ from schema v1")
        for field in ("role", "platform", "arch", "protocol"):
            if not isinstance(entry[field], str) or not TOKEN_RE.fullmatch(
                entry[field]
            ):
                raise ReleaseManifestError(f"invalid artifact {field}")
        filename = entry["filename"]
        if not isinstance(filename, str) or not FILENAME_RE.fullmatch(filename):
            raise ReleaseManifestError("invalid artifact filename")
        folded = filename.casefold()
        if folded in filenames:
            raise ReleaseManifestError("duplicate/case-colliding artifact filename")
        filenames.add(folded)
        role_counts[entry["role"]] = role_counts.get(entry["role"], 0) + 1
        _strict_int(entry["size"], name=f"artifact {filename} size", minimum=1)
        if not isinstance(entry["sha256"], str) or not SHA256_RE.fullmatch(
            entry["sha256"]
        ):
            raise ReleaseManifestError(f"invalid SHA-256 for artifact {filename}")
        ordered.append((entry["role"], entry["platform"], entry["arch"], filename))
    if ordered != sorted(ordered) or len(set(ordered)) != len(ordered):
        raise ReleaseManifestError("artifacts are not uniquely sorted by identity")
    if set(role_counts) != set(ALLOWED_ARTIFACTS):
        raise ReleaseManifestError("manifest artifact role set is not exact")
    for role in ALLOWED_ARTIFACTS:
        expected = ALLOWED_ARTIFACTS[role]
        matches = [entry for entry in artifacts if entry["role"] == role]
        if len(matches) != 1:
            raise ReleaseManifestError(f"manifest requires exactly one {role} artifact")
        actual = {field: matches[0][field] for field in expected}
        if actual != expected:
            raise ReleaseManifestError(f"{role} artifact binding mismatch")
    for entry in artifacts:
        expected = ALLOWED_ARTIFACTS[entry["role"]]
        actual = {field: entry[field] for field in expected}
        if actual != expected:
            raise ReleaseManifestError(f"{entry['role']} artifact binding mismatch")
    if any(count != 1 for count in role_counts.values()):
        raise ReleaseManifestError("artifact roles must be unique")
    return value


def parse_manifest_bytes(raw: bytes) -> dict[str, Any]:
    if not raw or len(raw) > MAX_MANIFEST_BYTES:
        raise ReleaseManifestError("manifest size is invalid")
    if raw.startswith(b"\xef\xbb\xbf") or b"\r" in raw or b"\x00" in raw:
        raise ReleaseManifestError("manifest encoding is not ASCII/LF/no-BOM")
    if not raw.endswith(b"\n") or raw.endswith(b"\n\n"):
        raise ReleaseManifestError("manifest must have exactly one final LF")
    try:
        text = raw.decode("ascii")
        value = json.loads(text, object_pairs_hook=_object_without_duplicates)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ReleaseManifestError("manifest is not valid ASCII JSON") from exc
    value = validate_manifest(value)
    if canonical_bytes(value) != raw:
        raise ReleaseManifestError("manifest bytes are not canonical")
    return value


def _atomic_write(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(
        dir=path.parent, prefix=f".{path.name}.", suffix=".tmp"
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def build_manifest(
    *,
    directory: Path,
    artifact_specs: list[tuple[str, str, str, str, str]],
    key_id: str,
    version: str,
    commit: str,
    published_at: str,
) -> dict[str, Any]:
    directory = directory.resolve()
    artifacts: list[dict[str, Any]] = []
    for role, platform, arch, filename, protocol in artifact_specs:
        path = directory / filename
        size, sha256 = artifact_identity(path, directory)
        artifacts.append(
            {
                "role": role,
                "platform": platform,
                "arch": arch,
                "filename": filename,
                "size": size,
                "sha256": sha256,
                "protocol": protocol,
            }
        )
    artifacts.sort(
        key=lambda entry: (
            entry["role"],
            entry["platform"],
            entry["arch"],
            entry["filename"],
        )
    )
    value = {
        "schema_version": SCHEMA_VERSION,
        "key_id": key_id,
        "product": PRODUCT,
        "repository": REPOSITORY,
        "channel": CHANNEL,
        "sequence": version_sequence(version),
        "version": version,
        "tag": f"v{version}",
        "commit": commit,
        "published_at": published_at,
        "artifacts": artifacts,
    }
    return validate_manifest(value)


def verify_artifact_files(
    *, directory: Path, manifest: dict[str, Any]
) -> dict[str, Path]:
    """Verify the exact on-disk byte streams named by a trusted manifest."""
    value = validate_manifest(manifest)
    directory = directory.resolve()
    verified: dict[str, Path] = {}
    for artifact in value["artifacts"]:
        filename = artifact["filename"]
        path = directory / filename
        size, sha256 = artifact_identity(path, directory)
        if size != artifact["size"] or sha256 != artifact["sha256"]:
            raise ReleaseManifestError(
                f"release artifact size/SHA-256 mismatch: {filename}"
            )
        verified[artifact["role"]] = path
    return verified


def enforce_forward_update(
    *,
    manifest: dict[str, Any],
    installed_version: str,
    installed_sequence: int,
    committed_version: str,
    committed_sequence: int,
) -> None:
    """Apply the signed, persistent forward-only floor used by all consumers."""
    value = validate_manifest(manifest)
    installed_sequence = _strict_int(
        installed_sequence, name="installed_sequence", minimum=1
    )
    committed_sequence = _strict_int(
        committed_sequence, name="committed_sequence", minimum=1
    )
    if installed_sequence != version_sequence(installed_version):
        raise ReleaseManifestError("installed sequence/version mismatch")
    if committed_sequence != version_sequence(committed_version):
        raise ReleaseManifestError("committed sequence/version mismatch")
    if installed_sequence < committed_sequence or _semver_parts(
        installed_version
    ) < _semver_parts(committed_version):
        raise ReleaseManifestError("installed version is below committed floor")
    if (
        value["sequence"] <= installed_sequence
        or value["sequence"] <= committed_sequence
        or _semver_parts(value["version"]) <= _semver_parts(installed_version)
        or _semver_parts(value["version"]) <= _semver_parts(committed_version)
    ):
        raise ReleaseManifestError("release is a replay or downgrade")


def _artifact_spec(value: str) -> tuple[str, str, str, str, str]:
    parts = value.split(",")
    if len(parts) != 5:
        raise argparse.ArgumentTypeError(
            "artifact must be role,platform,arch,filename,protocol"
        )
    return tuple(parts)  # type: ignore[return-value]


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    build = subparsers.add_parser("build", help="write canonical release bytes")
    build.add_argument("--directory", type=Path, required=True)
    build.add_argument(
        "--artifact", type=_artifact_spec, action="append", required=True
    )
    build.add_argument("--key-id", required=True)
    build.add_argument("--version", required=True)
    build.add_argument("--commit", required=True)
    build.add_argument("--published-at", required=True)
    build.add_argument("--output", type=Path, required=True)

    validate = subparsers.add_parser("validate", help="validate canonical bytes")
    validate.add_argument("--manifest", type=Path, required=True)
    return parser


def main() -> int:
    args = _parser().parse_args()
    try:
        if args.command == "build":
            value = build_manifest(
                directory=args.directory,
                artifact_specs=args.artifact,
                key_id=args.key_id,
                version=args.version,
                commit=args.commit,
                published_at=args.published_at,
            )
            _atomic_write(args.output, canonical_bytes(value))
        else:
            value = parse_manifest_bytes(args.manifest.read_bytes())
    except (OSError, ReleaseManifestError) as exc:
        print(f"release-manifest: ERROR: {exc}")
        return 1
    print(
        json.dumps(
            {
                "ok": True,
                "key_id": value["key_id"],
                "sequence": value["sequence"],
                "version": value["version"],
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
