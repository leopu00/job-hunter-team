"""Detached release authority and Windows updater contract tests."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import subprocess
from pathlib import Path

import pytest

import scripts.release_signing as release_signing

from scripts.release_manifest import (
    ReleaseManifestError,
    build_manifest,
    canonical_bytes,
    enforce_forward_update,
    parse_manifest_bytes,
    verify_artifact_files,
    version_sequence,
)
from scripts.release_signing import (
    ReleaseSigningError,
    public_key_id,
    render_helper,
    sign_offline,
    verify_release_signature,
)


ROOT = Path(__file__).resolve().parents[1]
COMMIT = "1" * 40
PUBLISHED_AT = "2026-08-07T12:34:56Z"
DESKTOP = "job-hunter-team-windows-x64-portable.exe"
HELPER = "jht-windows-update.ps1"
SPECS = [
    (
        "windows-desktop",
        "windows",
        "x86_64",
        DESKTOP,
        "jht-windows-desktop-v1",
    ),
    (
        "windows-update-helper",
        "windows",
        "x86_64",
        HELPER,
        "jht-windows-update-v1",
    ),
]
EXTRA_ARTIFACTS = [
    {
        "role": "windows-installer",
        "platform": "windows",
        "arch": "x86_64",
        "filename": "job-hunter-team-windows-x64-setup.exe",
        "protocol": "jht-windows-installer-v1",
    },
    {
        "role": "linux-desktop",
        "platform": "linux",
        "arch": "x86_64",
        "filename": "job-hunter-team-linux-x64.tar.gz",
        "protocol": "jht-linux-desktop-v1",
    },
    {
        "role": "macos-desktop",
        "platform": "macos",
        "arch": "universal2",
        "filename": "job-hunter-team.zip",
        "protocol": "jht-macos-desktop-v1",
    },
]


@pytest.fixture(scope="module")
def rsa_keys(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path, Path]:
    directory = tmp_path_factory.mktemp("release-rsa")
    private = directory / "private.pem"
    public = directory / "public.pem"
    wrong_private = directory / "wrong-private.pem"
    wrong_public = directory / "wrong-public.pem"
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
    subprocess.run(
        [
            "openssl",
            "genpkey",
            "-algorithm",
            "RSA",
            "-pkeyopt",
            "rsa_keygen_bits:3072",
            "-out",
            wrong_private,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    subprocess.run(
        ["openssl", "pkey", "-in", wrong_private, "-pubout", "-out", wrong_public],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    return private, public, wrong_public


def _bundle(directory: Path, public: Path, version: str = "0.3.7") -> tuple[dict, Path]:
    directory.mkdir(parents=True, exist_ok=True)
    (directory / DESKTOP).write_bytes(b"synthetic desktop bytes\n")
    (directory / HELPER).write_bytes(b"synthetic helper bytes\n")
    manifest = build_manifest(
        directory=directory,
        artifact_specs=SPECS,
        key_id=public_key_id(public),
        version=version,
        commit=COMMIT,
        published_at=PUBLISHED_AT,
    )
    path = directory / "RELEASE-MANIFEST.json"
    path.write_bytes(canonical_bytes(manifest))
    return manifest, path


def _sign(directory: Path, manifest: Path, private: Path, public: Path) -> Path:
    signature = directory / "RELEASE-MANIFEST.json.sig"
    value = parse_manifest_bytes(manifest.read_bytes())
    sign_offline(
        manifest=manifest,
        signature=signature,
        private_key=private,
        public_key=public,
        expected_tag=value["tag"],
        expected_commit=value["commit"],
        expected_manifest_sha256=hashlib.sha256(manifest.read_bytes()).hexdigest(),
        minimum_sequence=value["sequence"] - 1,
    )
    return signature


def test_canonical_signed_manifest_and_bundle_verify(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path]
) -> None:
    private, public, _ = rsa_keys
    manifest, path = _bundle(tmp_path, public)
    signature = _sign(tmp_path, path, private, public)

    verified = verify_release_signature(
        manifest=path, signature=signature, public_key=public
    )
    assert verified == manifest
    assert len(signature.read_bytes()) == 384
    assert verify_artifact_files(directory=tmp_path, manifest=verified) == {
        "windows-desktop": tmp_path / DESKTOP,
        "windows-update-helper": tmp_path / HELPER,
    }
    assert path.read_bytes().endswith(b"\n")
    assert b" " not in path.read_bytes()


@pytest.mark.parametrize("size", [0, 383, 385])
def test_unsigned_or_wrong_length_signature_fails_before_parse(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path], size: int
) -> None:
    _, public, _ = rsa_keys
    _, manifest = _bundle(tmp_path, public)
    signature = tmp_path / "RELEASE-MANIFEST.json.sig"
    signature.write_bytes(b"x" * size)
    with pytest.raises(ReleaseSigningError, match="exactly 384 bytes"):
        verify_release_signature(
            manifest=manifest, signature=signature, public_key=public
        )


def test_wrong_key_and_manifest_tamper_are_rejected(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path]
) -> None:
    private, public, wrong_public = rsa_keys
    _, manifest = _bundle(tmp_path, public)
    signature = _sign(tmp_path, manifest, private, public)
    with pytest.raises(ReleaseSigningError, match="verification failed"):
        verify_release_signature(
            manifest=manifest, signature=signature, public_key=wrong_public
        )
    manifest.write_bytes(manifest.read_bytes().replace(b'"stable"', b'"stablE"'))
    with pytest.raises(ReleaseSigningError, match="verification failed"):
        verify_release_signature(
            manifest=manifest, signature=signature, public_key=public
        )


@pytest.mark.parametrize("extra", EXTRA_ARTIFACTS, ids=lambda item: item["role"])
def test_correctly_signed_manifest_with_extra_role_is_rejected(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path, Path],
    extra: dict[str, object],
) -> None:
    private, public, _ = rsa_keys
    manifest, path = _bundle(tmp_path, public)
    entry = dict(extra)
    entry.update(size=1, sha256="3" * 64)
    manifest["artifacts"].append(entry)
    manifest["artifacts"].sort(
        key=lambda item: (
            item["role"],
            item["platform"],
            item["arch"],
            item["filename"],
        )
    )
    path.write_bytes(canonical_bytes(manifest))
    signature = tmp_path / "RELEASE-MANIFEST.json.sig"
    subprocess.run(
        [
            "openssl",
            "dgst",
            "-sha256",
            "-sign",
            str(private),
            "-out",
            str(signature),
            str(path),
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    with pytest.raises(ReleaseSigningError, match="exactly two"):
        verify_release_signature(manifest=path, signature=signature, public_key=public)


def test_asset_tamper_is_rejected_after_signature_verification(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path]
) -> None:
    private, public, _ = rsa_keys
    _, manifest_path = _bundle(tmp_path, public)
    signature = _sign(tmp_path, manifest_path, private, public)
    verified = verify_release_signature(
        manifest=manifest_path, signature=signature, public_key=public
    )
    (tmp_path / DESKTOP).write_bytes(b"tampered desktop bytes\n")
    with pytest.raises(ReleaseManifestError, match="size/SHA-256 mismatch"):
        verify_artifact_files(directory=tmp_path, manifest=verified)


@pytest.mark.parametrize(
    ("mutation", "message"),
    [
        (
            lambda value: value.update(schema_version="1"),
            "schema_version must be an integer",
        ),
        (lambda value: value.update(channel="preview"), "stable update channel"),
        (lambda value: value.update(tag="v9.9.9"), "tag/version binding"),
        (lambda value: value.update(commit="F" * 40), "invalid release commit"),
        (lambda value: value.update(extra=True), "top-level keys"),
        (
            lambda value: value["artifacts"].append(
                copy.deepcopy(value["artifacts"][0])
            ),
            "exactly two",
        ),
        (lambda value: value["artifacts"][0].update(protocol=1), "artifact protocol"),
        (
            lambda value: value["artifacts"][0].update(platform="linux"),
            "binding mismatch",
        ),
        (
            lambda value: value["artifacts"][0].update(role="aaa-unknown"),
            "artifact role set is not exact",
        ),
        (lambda value: value["artifacts"][0].update(size=True), "must be an integer"),
    ],
)
def test_schema_binding_and_types_are_fail_closed(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path, Path],
    mutation,
    message: str,
) -> None:
    _, public, _ = rsa_keys
    manifest, _ = _bundle(tmp_path, public)
    mutation(manifest)
    with pytest.raises(ReleaseManifestError, match=message):
        parse_manifest_bytes(canonical_bytes(manifest))


def test_duplicate_json_key_and_noncanonical_bytes_are_rejected(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path]
) -> None:
    _, public, _ = rsa_keys
    _, manifest = _bundle(tmp_path, public)
    raw = manifest.read_bytes()
    duplicate = raw.replace(b'{"artifacts"', b'{"schema_version":1,"artifacts"', 1)
    with pytest.raises(ReleaseManifestError, match="duplicate JSON key"):
        parse_manifest_bytes(duplicate)
    value = json.loads(raw)
    noncanonical = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    with pytest.raises(ReleaseManifestError, match="not canonical"):
        parse_manifest_bytes(noncanonical)


def test_replay_downgrade_and_mismatched_floor_are_rejected(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path]
) -> None:
    _, public, _ = rsa_keys
    manifest, _ = _bundle(tmp_path, public, "0.3.7")
    enforce_forward_update(
        manifest=manifest,
        installed_version="0.3.6",
        installed_sequence=version_sequence("0.3.6"),
        committed_version="0.3.6",
        committed_sequence=version_sequence("0.3.6"),
    )
    with pytest.raises(ReleaseManifestError, match="replay or downgrade"):
        enforce_forward_update(
            manifest=manifest,
            installed_version="0.3.7",
            installed_sequence=version_sequence("0.3.7"),
            committed_version="0.3.6",
            committed_sequence=version_sequence("0.3.6"),
        )
    with pytest.raises(ReleaseManifestError, match="below committed floor"):
        enforce_forward_update(
            manifest=manifest,
            installed_version="0.3.6",
            installed_sequence=version_sequence("0.3.6"),
            committed_version="0.3.7",
            committed_sequence=version_sequence("0.3.7"),
        )


def test_helper_is_rendered_only_with_explicit_spki(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path]
) -> None:
    _, public, _ = rsa_keys
    template = ROOT / "scripts" / HELPER
    output = tmp_path / HELPER
    assert template.read_text().count("__JHT_RELEASE_PUBLIC_KEYS_SPKI_PEM__") == 1
    render_helper(template=template, output=output, public_key=public)
    rendered = output.read_text()
    assert "__JHT_RELEASE_PUBLIC_KEYS_SPKI_PEM__" not in rendered
    assert "-----BEGIN PUBLIC KEY-----" in rendered


def test_helper_rotation_bridge_embeds_one_or_two_distinct_keys(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path]
) -> None:
    _, public, next_public = rsa_keys
    template = ROOT / "scripts" / HELPER
    output = tmp_path / HELPER
    render_helper(
        template=template,
        output=output,
        public_key=public,
        additional_public_keys=(next_public,),
    )
    assert output.read_text().count("-----BEGIN PUBLIC KEY-----") == (
        template.read_text().count("-----BEGIN PUBLIC KEY-----") + 2
    )
    with pytest.raises(ReleaseSigningError, match="duplicate key"):
        render_helper(
            template=template,
            output=output,
            public_key=public,
            additional_public_keys=(public,),
        )


@pytest.mark.parametrize(
    ("override", "message"),
    [
        ({"expected_tag": "v0.3.8"}, "identity was not authorized"),
        ({"expected_commit": "2" * 40}, "identity was not authorized"),
        ({"expected_manifest_sha256": "0" * 64}, "authorized signing request"),
        ({"minimum_sequence": version_sequence("0.3.7")}, "does not advance"),
    ],
)
def test_offline_signer_requires_explicit_operator_authorization(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path, Path],
    override: dict[str, object],
    message: str,
) -> None:
    private, public, _ = rsa_keys
    _, manifest = _bundle(tmp_path, public)
    arguments: dict[str, object] = {
        "manifest": manifest,
        "signature": tmp_path / "RELEASE-MANIFEST.json.sig",
        "private_key": private,
        "public_key": public,
        "expected_tag": "v0.3.7",
        "expected_commit": COMMIT,
        "expected_manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
        "minimum_sequence": version_sequence("0.3.6"),
    }
    arguments.update(override)
    with pytest.raises(ReleaseSigningError, match=message):
        sign_offline(**arguments)  # type: ignore[arg-type]
    assert not (tmp_path / "RELEASE-MANIFEST.json.sig").exists()


def test_production_sources_never_accept_a_private_key_secret() -> None:
    signing = (ROOT / "scripts" / "release_signing.py").read_text()
    workflow = (ROOT / ".github" / "workflows" / "release.yml").read_text()
    assert "JHT_RELEASE_SIGNING_PRIVATE" not in signing + workflow
    assert "PRIVATE KEY-----" not in workflow
    assert "sign-offline" not in workflow
    assert "gcloud" not in signing
    assert os.environ.get("JHT_RELEASE_SIGNING_PRIVATE_KEY", "") == ""


def test_verify_never_parses_different_bytes_than_it_verified(
    tmp_path: Path,
    rsa_keys: tuple[Path, Path, Path],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    private, public, _ = rsa_keys
    first_dir = tmp_path / "first"
    second_dir = tmp_path / "second"
    _, first = _bundle(first_dir, public, "0.3.7")
    _, second = _bundle(second_dir, public, "0.3.8")
    second_signature = _sign(second_dir, second, private, public)
    signature = first_dir / "RELEASE-MANIFEST.json.sig"
    signature.write_bytes(second_signature.read_bytes())
    replacement = second.read_bytes()
    original_run = release_signing.subprocess.run
    swapped = False

    def swapping_run(command, *args, **kwargs):
        nonlocal swapped
        if "-verify" in command and not swapped:
            first.write_bytes(replacement)
            swapped = True
        return original_run(command, *args, **kwargs)

    monkeypatch.setattr(release_signing.subprocess, "run", swapping_run)
    with pytest.raises(ReleaseSigningError, match="verification failed"):
        verify_release_signature(manifest=first, signature=signature, public_key=public)
    assert swapped


def test_failed_signing_preserves_existing_signature(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path]
) -> None:
    _, public, _ = rsa_keys
    wrong_private = tmp_path / "wrong-private.pem"
    subprocess.run(
        [
            "openssl",
            "genpkey",
            "-algorithm",
            "RSA",
            "-pkeyopt",
            "rsa_keygen_bits:3072",
            "-out",
            wrong_private,
        ],
        check=True,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    _, manifest = _bundle(tmp_path / "bundle", public)
    signature = tmp_path / "bundle" / "RELEASE-MANIFEST.json.sig"
    signature.write_bytes(b"trusted-sentinel")
    with pytest.raises(ReleaseSigningError, match="verification failed"):
        sign_offline(
            manifest=manifest,
            signature=signature,
            private_key=wrong_private,
            public_key=public,
            expected_tag="v0.3.7",
            expected_commit=COMMIT,
            expected_manifest_sha256=hashlib.sha256(manifest.read_bytes()).hexdigest(),
            minimum_sequence=version_sequence("0.3.6"),
        )
    assert signature.read_bytes() == b"trusted-sentinel"


def test_offline_signer_rejects_symlink_and_broad_private_key_permissions(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path]
) -> None:
    private, public, _ = rsa_keys
    _, manifest = _bundle(tmp_path / "bundle", public)
    arguments = {
        "manifest": manifest,
        "signature": tmp_path / "signature",
        "public_key": public,
        "expected_tag": "v0.3.7",
        "expected_commit": COMMIT,
        "expected_manifest_sha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
        "minimum_sequence": version_sequence("0.3.6"),
    }
    linked = tmp_path / "linked-private.pem"
    linked.symlink_to(private)
    with pytest.raises(ReleaseSigningError, match="unavailable"):
        sign_offline(private_key=linked, **arguments)

    original_mode = private.stat().st_mode & 0o777
    private.chmod(0o640)
    try:
        with pytest.raises(ReleaseSigningError, match="permissions are too broad"):
            sign_offline(private_key=private, **arguments)
    finally:
        private.chmod(original_mode)


@pytest.mark.parametrize("algorithm,bits", [("RSA", 2048), ("RSA-PSS", 3072)])
def test_incompatible_public_key_never_reaches_helper(
    tmp_path: Path, algorithm: str, bits: int
) -> None:
    private = tmp_path / "private.pem"
    public = tmp_path / "public.pem"
    subprocess.run(
        [
            "openssl",
            "genpkey",
            "-algorithm",
            algorithm,
            "-pkeyopt",
            f"rsa_keygen_bits:{bits}",
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
    with pytest.raises(ReleaseSigningError, match="RSA-3072|rsaEncryption"):
        render_helper(
            template=ROOT / "scripts" / HELPER,
            output=tmp_path / HELPER,
            public_key=public,
        )


def test_manifest_builder_rejects_artifact_symlink(
    tmp_path: Path, rsa_keys: tuple[Path, Path, Path]
) -> None:
    _, public, _ = rsa_keys
    outside = tmp_path / "outside.exe"
    outside.write_bytes(b"outside")
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / DESKTOP).symlink_to(outside)
    (bundle / HELPER).write_bytes(b"helper")
    with pytest.raises(ReleaseManifestError, match="path is unsafe"):
        build_manifest(
            directory=bundle,
            artifact_specs=SPECS,
            key_id=public_key_id(public),
            version="0.3.7",
            commit=COMMIT,
            published_at=PUBLISHED_AT,
        )


def test_release_workflow_stops_before_unsigned_publication() -> None:
    prepare = (ROOT / ".github" / "workflows" / "release.yml").read_text()
    publish = (
        ROOT / ".github" / "workflows" / "publish-signed-release.yml"
    ).read_text()
    combined = prepare + publish
    assert "scripts/release-keys/production-spki.pem" in combined
    assert "RELEASE-MANIFEST.json.sig" in publish
    assert "sign-offline" not in combined
    assert "gcloud" not in combined
    assert "credentials_json" not in combined
    assert "PRIVATE KEY-----" not in combined
    assert "softprops/action-gh-release" not in prepare
    assert "gh release" not in prepare
    assert prepare.index("release_manifest.py build") < prepare.index(
        "name: release-candidate"
    )
    assert public_key_id(ROOT / "scripts/release-keys/production-spki.pem") == (
        "3ab73bd9203a2e4f5d01a61bfecbb2bd891663164732a647af8c9164da97a0b2"
    )
    assert prepare.index("Embed the pinned Windows release trust root") < (
        prepare.index("Export native game")
    )
    assert prepare.index("Fail closed before the Windows trust root is embedded") < (
        prepare.index("Embed the pinned Windows release trust root")
    )
    assert 'test "$trust_rc" -eq 1' in prepare
    assert '"WINDOWS-UPDATE-TRUST-TEST FAIL"' in prepare
    assert 'grep -Fq "SCRIPT ERROR"' in prepare
    assert publish.index("name: signed-release-candidate") < publish.index(
        "  installer:"
    )
    assert publish.index("  installer:") < publish.index("  publish:")
    assert "-AuthorityDirectory release-assets -Smoke" in publish
    assert publish.index("release_artifacts.py audit") < publish.index(
        "softprops/action-gh-release"
    )
    assert publish.index("softprops/action-gh-release") < publish.index(
        "Re-download and audit"
    )
    assert publish.index("Re-download and audit") < publish.index(
        'gh release edit "$RELEASE_TAG" --draft=false'
    )
