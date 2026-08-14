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


REPOSITORY = "leopu00/job-hunter-team"
TAG = "v0.3.4"
ROOT = Path(__file__).resolve().parents[1]


def _tagged_repo(tmp_path: Path) -> tuple[Path, str]:
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
    subprocess.run(["git", "-C", repo, "tag", "-a", TAG, "-m", TAG], check=True)
    commit = subprocess.check_output(
        ["git", "-C", repo, "rev-parse", "HEAD"], text=True
    ).strip()
    return repo, commit


def _record(
    *, repo: Path, commit: str, asset: Path, sidecar: Path
) -> dict[str, object]:
    return record_asset(
        asset=asset,
        output=sidecar,
        tag=TAG,
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
    audited = audit_published_release(
        directory=assets, tag=TAG, commit=commit, repository=REPOSITORY
    )
    assert audited == result
    (assets / names[0]).write_bytes(b"changed after draft upload")
    with pytest.raises(ReleaseArtifactError, match="differs from provenance"):
        audit_published_release(
            directory=assets, tag=TAG, commit=commit, repository=REPOSITORY
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


def test_release_workflow_verifies_and_publishes_integrity_files() -> None:
    workflow = (ROOT / ".github/workflows/release.yml").read_text()
    assert "release_artifacts.py record" in workflow
    assert "release_artifacts.py verify" in workflow
    assert "${{ matrix.artifact_path }}.provenance.json" in workflow
    assert "release-assets/SHA256SUMS" in workflow
    assert "release-assets/RELEASE-PROVENANCE.json" in workflow
    assert "release-assets/RUNTIME-IMAGE.json" in workflow
    assert "--expected-asset RUNTIME-IMAGE.json" in workflow
    assert "release_artifacts.py notes" in workflow
    assert "body_path: release-assets/RELEASE-NOTES.md" in workflow
    assert "draft: true" in workflow
    assert workflow.index("release_artifacts.py verify") < workflow.index(
        "release_artifacts.py notes"
    ) < workflow.index(
        "softprops/action-gh-release"
    )


def test_release_notes_render_every_verified_asset_without_a_second_list(
    tmp_path: Path,
) -> None:
    # Nomi volutamente sintetici: il renderer deve consumare l'autorità
    # RELEASE-PROVENANCE, non conoscere Windows/macOS/Linux in proprio.
    assets = [
        {
            "asset": "custom-alpha.bin",
            "size": 11,
            "sha256": "a" * 64,
        },
        {
            "asset": "custom-beta.pkg",
            "size": 22,
            "sha256": "b" * 64,
        },
    ]
    provenance = tmp_path / "RELEASE-PROVENANCE.json"
    provenance.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "repository": REPOSITORY,
                "tag": TAG,
                "commit": "c" * 40,
                "assets": assets,
            }
        )
    )
    output = tmp_path / "RELEASE-NOTES.md"

    from scripts import release_artifacts

    body = release_artifacts.render_release_notes(
        notes="- Curated change",
        provenance=provenance,
        output=output,
        tag=TAG,
        repository=REPOSITORY,
    )

    assert output.read_text(encoding="utf-8") == body
    assert "### SHA-256 checksums" in body
    assert "- Curated change" in body
    for asset in assets:
        line = f'{asset["sha256"]}  {asset["asset"]}'
        assert body.count(line) == 1


def test_release_notes_reject_invalid_provenance_instead_of_publishing_it(
    tmp_path: Path,
) -> None:
    provenance = tmp_path / "RELEASE-PROVENANCE.json"
    provenance.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "repository": REPOSITORY,
                "tag": TAG,
                "commit": "c" * 40,
                "assets": [
                    {"asset": "asset.bin", "size": 1, "sha256": "not-a-hash"}
                ],
            }
        )
    )

    from scripts import release_artifacts

    with pytest.raises(ReleaseArtifactError, match="provenance"):
        release_artifacts.render_release_notes(
            notes="notes",
            provenance=provenance,
            output=tmp_path / "RELEASE-NOTES.md",
            tag=TAG,
            repository=REPOSITORY,
        )
