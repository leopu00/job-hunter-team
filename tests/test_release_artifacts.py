"""Release assets must be traceable to the exact tagged commit."""

from __future__ import annotations

import hashlib
import json
import subprocess
from pathlib import Path

import pytest

from scripts.release_artifacts import (
    ReleaseArtifactError,
    audit_published_release,
    record_asset,
    verify_assets,
)
from scripts.release_manifest import build_manifest, canonical_bytes
from scripts.release_signing import public_key_id, sign_offline


REPOSITORY = "leopu00/job-hunter-team"
TAG = "v0.3.4"
ROOT = Path(__file__).resolve().parents[1]


def _tagged_repo(tmp_path: Path, *, tag: str = TAG) -> tuple[Path, str]:
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q", repo], check=True)
    configured_name = subprocess.run(
        ["git", "config", "user.name"], capture_output=True, text=True, check=False
    ).stdout.strip()
    configured_email = subprocess.run(
        ["git", "config", "user.email"], capture_output=True, text=True, check=False
    ).stdout.strip()
    subprocess.run(
        [
            "git",
            "-C",
            repo,
            "config",
            "user.name",
            configured_name or "github-actions[bot]",
        ],
        check=True,
    )
    subprocess.run(
        [
            "git",
            "-C",
            repo,
            "config",
            "user.email",
            configured_email or "41898282+github-actions[bot]@users.noreply.github.com",
        ],
        check=True,
    )
    (repo / "source.txt").write_text("tagged source\n")
    subprocess.run(["git", "-C", repo, "add", "source.txt"], check=True)
    subprocess.run(["git", "-C", repo, "commit", "-qm", "tagged source"], check=True)
    subprocess.run(["git", "-C", repo, "tag", "-a", tag, "-m", tag], check=True)
    commit = subprocess.check_output(
        ["git", "-C", repo, "rev-parse", "HEAD"], text=True
    ).strip()
    return repo, commit


def _record(
    *, repo: Path, commit: str, asset: Path, sidecar: Path, tag: str = TAG
) -> dict[str, object]:
    return record_asset(
        asset=asset,
        output=sidecar,
        tag=tag,
        commit=commit,
        repository=REPOSITORY,
        source_root=repo,
    )


def test_verifies_tag_identity_and_writes_public_checksums(tmp_path: Path) -> None:
    repo, commit = _tagged_repo(tmp_path)
    assets = tmp_path / "release-assets"
    assets.mkdir()
    names = ["job-hunter-team.exe", "job-hunter-team.zip"]
    for name in names:
        asset = assets / name
        asset.write_bytes(f"asset:{name}".encode())
        _record(
            repo=repo,
            commit=commit,
            asset=asset,
            sidecar=assets / f"{name}.provenance.json",
        )

    checksums = assets / "SHA256SUMS"
    provenance = assets / "RELEASE-PROVENANCE.json"
    result = verify_assets(
        directory=assets,
        expected_assets=names,
        tag=TAG,
        commit=commit,
        repository=REPOSITORY,
        checksums=checksums,
        provenance=provenance,
    )

    assert result["tag"] == TAG
    assert result["commit"] == commit
    expected_lines = [
        f"{hashlib.sha256((assets / name).read_bytes()).hexdigest()}  {name}"
        for name in sorted(names)
    ]
    assert checksums.read_text().splitlines() == expected_lines
    assert f'"commit": "{commit}"' in provenance.read_text()

    for sidecar in assets.glob("*.provenance.json"):
        sidecar.unlink()
    with pytest.raises(ReleaseArtifactError, match="explicit opt-in"):
        audit_published_release(
            directory=assets, tag=TAG, commit=commit, repository=REPOSITORY
        )
    audited = audit_published_release(
        directory=assets,
        tag=TAG,
        commit=commit,
        repository=REPOSITORY,
        allow_legacy_unsigned=True,
    )
    assert audited == result
    (assets / names[0]).write_bytes(b"changed after draft upload")
    with pytest.raises(ReleaseArtifactError, match="differs from provenance"):
        audit_published_release(
            directory=assets,
            tag=TAG,
            commit=commit,
            repository=REPOSITORY,
            allow_legacy_unsigned=True,
        )


def test_rejects_asset_changed_after_runner_recorded_it(tmp_path: Path) -> None:
    repo, commit = _tagged_repo(tmp_path)
    assets = tmp_path / "release-assets"
    assets.mkdir()
    asset = assets / "job-hunter-team.exe"
    sidecar = assets / "job-hunter-team.exe.provenance.json"
    asset.write_bytes(b"original")
    _record(repo=repo, commit=commit, asset=asset, sidecar=sidecar)
    asset.write_bytes(b"different")

    with pytest.raises(ReleaseArtifactError, match="provenance mismatch"):
        verify_assets(
            directory=assets,
            expected_assets=[asset.name],
            tag=TAG,
            commit=commit,
            repository=REPOSITORY,
            checksums=assets / "SHA256SUMS",
            provenance=assets / "RELEASE-PROVENANCE.json",
        )


def test_rejects_build_checkout_that_is_not_the_tag_commit(tmp_path: Path) -> None:
    repo, commit = _tagged_repo(tmp_path)
    (repo / "source.txt").write_text("newer source\n")
    subprocess.run(["git", "-C", repo, "commit", "-qam", "newer source"], check=True)
    asset = tmp_path / "job-hunter-team.exe"
    asset.write_bytes(b"built from newer source")

    with pytest.raises(ReleaseArtifactError, match="build checkout"):
        _record(
            repo=repo,
            commit=commit,
            asset=asset,
            sidecar=tmp_path / "asset.provenance.json",
        )


def test_release_workflows_separate_build_from_signed_publication() -> None:
    prepare = (ROOT / ".github/workflows/release.yml").read_text()
    publish = (ROOT / ".github/workflows/publish-signed-release.yml").read_text()
    assert "release_artifacts.py record" in prepare
    assert "release_artifacts.py verify" in prepare
    assert "${{ matrix.artifact_path }}.provenance.json" in prepare
    assert "release-assets/SHA256SUMS" in prepare
    assert "release-assets/RELEASE-PROVENANCE.json" in prepare
    assert "name: release-candidate" in prepare
    assert "softprops/action-gh-release" not in prepare
    assert "gh release" not in prepare
    assert "name: release-candidate" in publish
    assert "release_signing.py sign-offline" not in publish
    assert publish.index("release_artifacts.py audit") < publish.index(
        "softprops/action-gh-release"
    )


def test_public_audit_verifies_detached_authority_and_signed_assets(
    tmp_path: Path,
) -> None:
    signed_tag = "v0.3.6"
    repo, commit = _tagged_repo(tmp_path, tag=signed_tag)
    assets = tmp_path / "release-assets"
    assets.mkdir()
    names = [
        "job-hunter-team-windows-x64-portable.exe",
        "jht-windows-update.ps1",
    ]
    for name in names:
        asset = assets / name
        asset.write_bytes(f"signed:{name}".encode())
        _record(
            repo=repo,
            commit=commit,
            asset=asset,
            sidecar=assets / f"{name}.provenance.json",
            tag=signed_tag,
        )
    verify_assets(
        directory=assets,
        expected_assets=names,
        tag=signed_tag,
        commit=commit,
        repository=REPOSITORY,
        checksums=assets / "SHA256SUMS",
        provenance=assets / "RELEASE-PROVENANCE.json",
    )
    private = tmp_path / "private.pem"
    public = tmp_path / "public.pem"
    subprocess.run(
        [
            "openssl",
            "genpkey",
            "-algorithm",
            "RSA",
            "-pkeyopt",
            "rsa_keygen_bits:3072",
            "-out",
            private,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        ["openssl", "pkey", "-in", private, "-pubout", "-out", public],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    manifest = build_manifest(
        directory=assets,
        artifact_specs=[
            (
                "windows-desktop",
                "windows",
                "x86_64",
                names[0],
                "jht-windows-desktop-v1",
            ),
            (
                "windows-update-helper",
                "windows",
                "x86_64",
                names[1],
                "jht-windows-update-v1",
            ),
        ],
        key_id=public_key_id(public),
        version=signed_tag.removeprefix("v"),
        commit=commit,
        published_at="2026-08-07T12:34:56Z",
    )
    manifest_path = assets / "RELEASE-MANIFEST.json"
    signature_path = assets / "RELEASE-MANIFEST.json.sig"
    manifest_path.write_bytes(canonical_bytes(manifest))
    sign_offline(
        manifest=manifest_path,
        signature=signature_path,
        private_key=private,
        public_key=public,
        expected_tag=signed_tag,
        expected_commit=commit,
        expected_manifest_sha256=hashlib.sha256(manifest_path.read_bytes()).hexdigest(),
        minimum_sequence=0,
    )
    for sidecar in assets.glob("*.provenance.json"):
        sidecar.unlink()
    with pytest.raises(ReleaseArtifactError, match="public key is required"):
        audit_published_release(
            directory=assets,
            tag=signed_tag,
            commit=commit,
            repository=REPOSITORY,
        )
    audited = audit_published_release(
        directory=assets,
        tag=signed_tag,
        commit=commit,
        repository=REPOSITORY,
        release_public_key=public,
    )
    assert audited["commit"] == commit

    provenance_path = assets / "RELEASE-PROVENANCE.json"
    provenance = json.loads(provenance_path.read_text())
    extra = assets / "extra.bin"
    extra.write_bytes(b"unsigned extra")
    extra_hash = hashlib.sha256(extra.read_bytes()).hexdigest()
    provenance["assets"].append(
        {"asset": extra.name, "size": extra.stat().st_size, "sha256": extra_hash}
    )
    provenance["assets"].sort(key=lambda item: item["asset"])
    provenance_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")
    checksum_path = assets / "SHA256SUMS"
    checksums = checksum_path.read_text().splitlines()
    checksums.append(f"{extra_hash}  {extra.name}")
    checksum_path.write_text("\n".join(sorted(checksums)) + "\n")
    assert (
        audit_published_release(
            directory=assets,
            tag=signed_tag,
            commit=commit,
            repository=REPOSITORY,
            release_public_key=public,
        )["commit"]
        == commit
    )
    extra.unlink()
    provenance["assets"] = [
        item for item in provenance["assets"] if item["asset"] != extra.name
    ]
    provenance_path.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n")
    checksum_path.write_text(
        "\n".join(line for line in checksums if not line.endswith(f"  {extra.name}"))
        + "\n"
    )

    signature = bytearray(signature_path.read_bytes())
    signature[-1] ^= 1
    signature_path.write_bytes(signature)
    with pytest.raises(ReleaseArtifactError, match="authority audit failed"):
        audit_published_release(
            directory=assets,
            tag=signed_tag,
            commit=commit,
            repository=REPOSITORY,
            release_public_key=public,
        )
