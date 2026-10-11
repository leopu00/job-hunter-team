#!/usr/bin/env python3
"""Audit the separately approved Windows desktop 0.3.10 distribution.

This is not the full-product release protocol. Its installer identity is
independently pinned here; neither downloaded checksums nor provenance can
grant authority to different bytes. The original release auditor is unchanged.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import stat


REPOSITORY = "leopu00/job-hunter-team"
TAG = "desktop-windows-v0.3.10"
SOURCE = "450945129f025a25d18adfd72c1da65b7ec4d319"
INSTALLER = "job-hunter-team-windows-x64-setup-0.3.10.exe"
PROVENANCE = "DESKTOP-RELEASE-PROVENANCE.json"
CHECKSUMS = "SHA256SUMS"
APPROVED = {
    "filename": INSTALLER,
    "size_bytes": 295179599,
    "sha256": "abd5a07362e09bd22c4c4995bb55147bf362e3b3252ca35ab2f987f8cd01146a",
}


class DesktopAuditError(ValueError):
    """The candidate differs from the independently approved distribution."""


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def provenance() -> dict:
    return {
        "schema": "jht.desktop-release.v1",
        "repository": REPOSITORY,
        "tag": TAG,
        "source_commit": SOURCE,
        "source_base_commit": "8227b1cb0158e631d78542c8c75f09ac2b7b9ea9",
        "fix_commit": "c03add105b9d189928882072d1cd64f377634207",
        "scope": "windows-desktop-installer-only",
        "desktop_version": "0.3.10",
        "windows_numeric_version": "0.3.10.0",
        "root_package_version": "0.3.9",
        "build": {
            "engine": "Godot 4.7.stable.official.5b4e0cb0f",
            "nsis": "3.12",
            "method": "local export; existing tester-approved bytes, no CI rebuild",
        },
        "runtime": {
            "schema_version": 1,
            "repository": "ghcr.io/leopu00/jht",
            "release_version": "0.3.9",
            "digest": "sha256:07b154bee43f32d2e6313c54f28e389836556e2b5cbe1b76d03398684c38b598",
            "source_revision": "5357f76210a17c0b71b355c3d33a0699d0e0aff9",
        },
        "assets": [dict(APPROVED)],
        "verified_scope": [
            "Windows native ACL causal baseline fail and candidate pass",
            "Windows G3 installer RESUME, normal privilege, existing root ACL unchanged",
        ],
        "not_verified": [
            "clean installation",
            "portable 0.3.10 execution",
            "G4 runtime and team",
            "Internet SmartScreen or code signing",
            "macOS or Linux 0.3.10",
        ],
        "channel": {"prerelease": True, "make_latest": False},
    }


def provenance_bytes() -> bytes:
    return (json.dumps(provenance(), indent=2, sort_keys=True) + "\n").encode()


def checksum_bytes() -> bytes:
    sidecar_hash = hashlib.sha256(provenance_bytes()).hexdigest()
    entries = {PROVENANCE: sidecar_hash, INSTALLER: APPROVED["sha256"]}
    return "".join(f"{entries[name]}  {name}\n" for name in sorted(entries)).encode()


def audit_directory(directory: Path) -> dict:
    directory = Path(directory)
    if directory.is_symlink() or not directory.is_dir():
        raise DesktopAuditError("audit directory must be a real directory")
    paths = list(directory.iterdir())
    expected = {INSTALLER, PROVENANCE, CHECKSUMS}
    if {path.name for path in paths} != expected:
        raise DesktopAuditError("downloaded inventory must contain exactly the three desktop assets")
    for path in paths:
        if not stat.S_ISREG(path.lstat().st_mode):
            raise DesktopAuditError("all desktop assets must be regular files, without links")
    installer = directory / INSTALLER
    if installer.stat().st_size != APPROVED["size_bytes"] or sha256(installer) != APPROVED["sha256"]:
        raise DesktopAuditError("installer differs from independently approved Windows PASS bytes")
    # Canonical exact bytes also reject duplicate keys, extra fields, changed
    # scope/source/runtime and self-consistent forged checksum/provenance sets.
    if (directory / PROVENANCE).read_bytes() != provenance_bytes():
        raise DesktopAuditError("desktop provenance differs from the reviewed identity")
    if (directory / CHECKSUMS).read_bytes() != checksum_bytes():
        raise DesktopAuditError("desktop checksums differ from the reviewed identity")
    return {"tag": TAG, "source_commit": SOURCE, "assets": sorted(expected), "installer": dict(APPROVED)}


def audit_release_api(payload: dict, *, draft: bool) -> None:
    if (payload.get("tag_name") != TAG or payload.get("draft") is not draft
            or payload.get("prerelease") is not True):
        raise DesktopAuditError("release tag, draft state or prerelease channel mismatch")
    rows = payload.get("assets")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise DesktopAuditError("release assets must be an array of objects")
    expected_bytes = {
        INSTALLER: (APPROVED["size_bytes"], APPROVED["sha256"]),
        PROVENANCE: (len(provenance_bytes()), hashlib.sha256(provenance_bytes()).hexdigest()),
        CHECKSUMS: (len(checksum_bytes()), hashlib.sha256(checksum_bytes()).hexdigest()),
    }
    names = [row.get("name") for row in rows]
    if (any(not isinstance(name, str) for name in names)
            or len(names) != len(expected_bytes) or set(names) != set(expected_bytes)):
        raise DesktopAuditError("API inventory must contain exactly the three distinct desktop assets")
    for row in rows:
        size, digest = expected_bytes[row["name"]]
        if type(row.get("size")) is not int or row["size"] != size or row.get("state") != "uploaded":
            raise DesktopAuditError("API asset size or upload state mismatch")
        # Some GitHub asset API versions omit digest; full readback remains
        # mandatory. If supplied, it must agree with the independent identity.
        if row.get("digest") not in (None, "sha256:" + digest):
            raise DesktopAuditError("API asset digest mismatch")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, required=True)
    parser.add_argument("--release-api", type=Path, help="Separate saved GitHub API response; never place in asset directory")
    parser.add_argument("--published", action="store_true", help="Require public instead of draft state in supplied API response")
    args = parser.parse_args()
    try:
        result = audit_directory(args.directory)
        if args.release_api:
            audit_release_api(json.loads(args.release_api.read_text()), draft=not args.published)
        print(json.dumps(result, sort_keys=True))
    except (DesktopAuditError, OSError, ValueError, TypeError) as exc:
        parser.exit(1, f"desktop-release audit failed: {exc}\n")


if __name__ == "__main__":
    main()
