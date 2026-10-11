"""Adversarial checks for the separate desktop-only audit, using synthetic bytes."""

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location(
    "desktop_release_audit", Path(__file__).parents[1] / "scripts/desktop_release_audit.py"
)
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


@pytest.fixture
def candidate(tmp_path, monkeypatch):
    # Only test-local installer bytes change; public CLI exposes no identity override.
    content = b"synthetic tester-approved installer\n"
    monkeypatch.setattr(audit, "APPROVED", {
        "filename": audit.INSTALLER, "size_bytes": len(content),
        "sha256": hashlib.sha256(content).hexdigest(),
    })
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / audit.INSTALLER).write_bytes(content)
    (assets / audit.PROVENANCE).write_bytes(audit.provenance_bytes())
    (assets / audit.CHECKSUMS).write_bytes(audit.checksum_bytes())
    return assets


def release_api(directory):
    return {"tag_name": audit.TAG, "draft": True, "prerelease": True, "assets": [
        {"name": p.name, "size": p.stat().st_size, "state": "uploaded",
         "digest": "sha256:" + audit.sha256(p)} for p in directory.iterdir()
    ]}


def test_exact_candidate_and_draft_api(candidate):
    assert audit.audit_directory(candidate)["source_commit"] == audit.SOURCE
    audit.audit_release_api(release_api(candidate), draft=True)


@pytest.mark.parametrize("change", ["extra", "missing", "directory", "symlink", "corrupt-installer"])
def test_rejects_inventory_and_payload_changes(candidate, change):
    installer = candidate / audit.INSTALLER
    if change == "extra":
        (candidate / "portable.exe").write_bytes(b"unexpected")
    elif change == "missing":
        (candidate / audit.CHECKSUMS).unlink()
    elif change == "directory":
        installer.unlink()
        installer.mkdir()
    elif change == "symlink":
        outside = candidate.parent / "outside.exe"
        installer.rename(outside)
        installer.symlink_to(outside)
    else:
        installer.write_bytes(b"x" * installer.stat().st_size)
    with pytest.raises(audit.DesktopAuditError):
        audit.audit_directory(candidate)


@pytest.mark.parametrize("field,value", [
    ("source_commit", "0" * 40), ("tag", "v0.3.10"), ("scope", "full-product"),
    ("desktop_version", "0.3.9"), ("root_package_version", "0.3.10"),
    ("runtime", {"release_version": "0.3.10"}), ("extra", "unknown"),
])
def test_self_consistent_forged_metadata_cannot_redefine_approval(candidate, field, value):
    metadata = audit.provenance()
    metadata[field] = value
    raw = (json.dumps(metadata, indent=2, sort_keys=True) + "\n").encode()
    (candidate / audit.PROVENANCE).write_bytes(raw)
    # An attacker repairs the downloaded checksum too; pinned identity still rejects it.
    (candidate / audit.CHECKSUMS).write_text(
        hashlib.sha256(raw).hexdigest() + "  " + audit.PROVENANCE + "\n"
        + audit.APPROVED["sha256"] + "  " + audit.INSTALLER + "\n"
    )
    with pytest.raises(audit.DesktopAuditError):
        audit.audit_directory(candidate)


def test_checksum_change_and_duplicate_json_key_rejected(candidate):
    (candidate / audit.CHECKSUMS).write_text("0" * 64 + "  " + audit.INSTALLER + "\n")
    with pytest.raises(audit.DesktopAuditError):
        audit.audit_directory(candidate)
    (candidate / audit.CHECKSUMS).write_bytes(audit.checksum_bytes())
    raw = audit.provenance_bytes().replace(b'{\n', b'{\n  "tag": "forged",\n', 1)
    (candidate / audit.PROVENANCE).write_bytes(raw)
    with pytest.raises(audit.DesktopAuditError):
        audit.audit_directory(candidate)


@pytest.mark.parametrize("change", ["tag", "draft", "prerelease", "extra", "duplicate", "size", "digest", "state"])
def test_api_rejects_wrong_channel_and_asset_identity(candidate, change):
    payload = release_api(candidate)
    if change in ("tag", "draft", "prerelease"):
        payload[{"tag": "tag_name"}.get(change, change)] = {"tag": "v0.3.10", "draft": False, "prerelease": False}[change]
    elif change == "extra":
        payload["assets"].append({"name": "mac.zip"})
    elif change == "duplicate":
        payload["assets"][0] = payload["assets"][1]
    else:
        payload["assets"][0][change] = {"size": 0, "digest": "sha256:" + "0" * 64, "state": "new"}[change]
    with pytest.raises(audit.DesktopAuditError):
        audit.audit_release_api(payload, draft=True)


def test_published_readback_requires_same_prerelease_and_bytes(candidate):
    payload = release_api(candidate)
    payload["draft"] = False
    audit.audit_release_api(payload, draft=False)
    payload["prerelease"] = False
    with pytest.raises(audit.DesktopAuditError):
        audit.audit_release_api(payload, draft=False)


def test_original_full_release_audit_still_rejects_extra_desktop_assets(tmp_path):
    from scripts.release_artifacts import audit_published_release, ReleaseArtifactError

    directory = tmp_path / "original"
    directory.mkdir()
    content = b"original release payload"
    digest = hashlib.sha256(content).hexdigest()
    (directory / "original.exe").write_bytes(content)
    (directory / "SHA256SUMS").write_text(digest + "  original.exe\n")
    source = "8227b1cb0158e631d78542c8c75f09ac2b7b9ea9"
    (directory / "RELEASE-PROVENANCE.json").write_text(json.dumps({
        "schema_version": 1, "repository": audit.REPOSITORY,
        "tag": "v0.3.9", "commit": source,
        "assets": [{"asset": "original.exe", "size": len(content), "sha256": digest}],
    }))
    kwargs = {"directory": directory, "tag": "v0.3.9", "commit": source, "repository": audit.REPOSITORY}
    audit_published_release(**kwargs)
    (directory / audit.INSTALLER).write_bytes(b"forbidden addition")
    with pytest.raises(ReleaseArtifactError, match="asset set differs"):
        audit_published_release(**kwargs)
