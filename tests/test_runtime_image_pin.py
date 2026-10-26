"""The public runtime identity is content-addressed from release to launch."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
from pathlib import Path

import pytest

from scripts import runtime_image_pin


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "release/runtime-image.v1.json"


def _pin() -> runtime_image_pin.RuntimeImagePin:
    return runtime_image_pin.load_manifest(MANIFEST)


def test_canonical_manifest_pins_every_distributed_consumer() -> None:
    pin = runtime_image_pin.verify_tree(ROOT)
    assert (
        pin.release_version
        == json.loads((ROOT / "package.json").read_text())["version"]
    )
    assert pin.image_ref.startswith("ghcr.io/leopu00/jht@sha256:")
    assert len(pin.digest) == len("sha256:") + 64
    # `release/` resta fuori dal contesto — la riga dice ORA `**/release/`,
    # perche' #177 ha reso le esclusioni valide anche in profondita'. La
    # proprieta' e' la stessa (il pin OCI non deve rientrare nel build e
    # rompere il ciclo digest->commit->digest), la scrittura no, e contare una
    # stringa letterale la legava alla scrittura. Che l'immagine sia davvero
    # senza `release/` lo misura `tests/test_image_context.py` sul layer.
    excludes = (ROOT / ".dockerignore").read_text().splitlines()
    assert [line for line in excludes if line in ("release/", "**/release/")] == [
        "**/release/"
    ]


@pytest.mark.parametrize(
    ("field", "value", "code"),
    [
        ("schema_version", 2, "manifest_schema"),
        ("schema_version", True, "manifest_schema"),
        ("release_version", "latest", "version_invalid"),
        ("repository", "example.invalid/jht", "repository_invalid"),
        ("digest", "sha256:short", "digest_invalid"),
        ("source_revision", "not-a-commit", "source_revision_invalid"),
    ],
)
def test_manifest_rejects_noncanonical_identity(
    tmp_path: Path, field: str, value: object, code: str
) -> None:
    data = json.loads(MANIFEST.read_text())
    data[field] = value
    path = tmp_path / "runtime-image.json"
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    with pytest.raises(runtime_image_pin.RuntimeImagePinError) as raised:
        runtime_image_pin.load_manifest(path)
    assert raised.value.code == code


def test_tree_rejects_a_semver_fallback_even_when_digest_is_still_present(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pin = _pin()
    (tmp_path / "package.json").write_text(
        json.dumps({"version": pin.release_version}) + "\n"
    )
    manifest = tmp_path / runtime_image_pin.MANIFEST_PATH
    manifest.parent.mkdir()
    manifest.write_text(MANIFEST.read_text())
    consumer = tmp_path / "consumer.txt"
    consumer.write_text(f"{pin.image_ref}\nghcr.io/leopu00/jht:{pin.release_version}\n")
    path = Path("consumer.txt")
    monkeypatch.setattr(runtime_image_pin, "PINNED_CONSUMERS", (path,))
    monkeypatch.setattr(
        runtime_image_pin,
        "CONSUMER_VALUE_PATTERNS",
        {path: (rf"^(?P<image>{re.escape(pin.image_ref)})$",)},
    )

    with pytest.raises(runtime_image_pin.RuntimeImagePinError) as raised:
        runtime_image_pin.verify_tree(tmp_path)
    assert raised.value.code == "consumer_mutable_ref"


def test_tree_reads_the_operational_value_not_a_correct_comment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    pin = _pin()
    (tmp_path / "package.json").write_text(
        json.dumps({"version": pin.release_version}) + "\n"
    )
    manifest = tmp_path / runtime_image_pin.MANIFEST_PATH
    manifest.parent.mkdir()
    manifest.write_text(MANIFEST.read_text())
    consumer = tmp_path / "consumer.js"
    consumer.write_text(
        f"// const DEFAULT_RUNTIME_IMAGE = '{pin.image_ref}';\n"
        "const DEFAULT_RUNTIME_IMAGE = 'ghcr.io/leopu00/jht@sha256:" + "f" * 64 + "';\n"
    )
    path = Path("consumer.js")
    monkeypatch.setattr(runtime_image_pin, "PINNED_CONSUMERS", (path,))
    monkeypatch.setattr(
        runtime_image_pin,
        "CONSUMER_VALUE_PATTERNS",
        {path: (r"^const DEFAULT_RUNTIME_IMAGE = '(?P<image>[^']+)';$",)},
    )

    with pytest.raises(runtime_image_pin.RuntimeImagePinError) as raised:
        runtime_image_pin.verify_tree(tmp_path)
    assert raised.value.code == "consumer_digest_drift"


def test_source_attestation_requires_both_platforms_and_exact_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    base_pin = _pin()
    index = {
        "manifests": [
            {
                "digest": "sha256:" + "a" * 64,
                "platform": {"os": "linux", "architecture": "amd64"},
            },
            {
                "digest": "sha256:" + "b" * 64,
                "platform": {"os": "linux", "architecture": "arm64"},
            },
        ]
    }
    raw_index = json.dumps(index).encode()
    pin = runtime_image_pin.RuntimeImagePin(
        release_version=base_pin.release_version,
        repository=base_pin.repository,
        digest=f"sha256:{hashlib.sha256(raw_index).hexdigest()}",
        source_revision=base_pin.source_revision,
    )
    manifests = {
        "sha256:" + "a" * 64: {"config": {"digest": "sha256:" + "c" * 64}},
        "sha256:" + "b" * 64: {"config": {"digest": "sha256:" + "d" * 64}},
    }
    configs = {
        digest: {
            "config": {
                "Labels": {"org.opencontainers.image.revision": pin.source_revision}
            }
        }
        for digest in ("sha256:" + "c" * 64, "sha256:" + "d" * 64)
    }

    monkeypatch.setattr(
        runtime_image_pin, "_anonymous_registry_token", lambda _pin: "token"
    )

    def request(
        _pin: runtime_image_pin.RuntimeImagePin, **kwargs: object
    ) -> tuple[dict[str, str], bytes]:
        kind = kwargs["kind"]
        identity = kwargs["identity"]
        if identity == pin.digest:
            return {}, raw_index
        elif kind == "manifests":
            payload = manifests[identity]
        else:
            payload = configs[identity]
        return {}, json.dumps(payload).encode()

    monkeypatch.setattr(runtime_image_pin, "_registry_request", request)
    runtime_image_pin.verify_source_labels(pin)

    configs["sha256:" + "d" * 64]["config"]["Labels"][
        "org.opencontainers.image.revision"
    ] = ("0" * 40)
    with pytest.raises(runtime_image_pin.RuntimeImagePinError) as raised:
        runtime_image_pin.verify_source_labels(pin)
    assert raised.value.code == "source_revision_mismatch"


def test_publish_refuses_to_overwrite_a_moved_release_tag(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pin = _pin()
    calls: list[list[str]] = []
    monkeypatch.setattr(runtime_image_pin, "verify_source_labels", lambda _pin: None)
    monkeypatch.setattr(
        runtime_image_pin,
        "registry_tag_digest",
        lambda _pin, _tag: "sha256:" + "f" * 64,
    )
    monkeypatch.setattr(
        runtime_image_pin.subprocess,
        "run",
        lambda command, **_kwargs: calls.append(command),
    )

    with pytest.raises(runtime_image_pin.RuntimeImagePinError) as raised:
        runtime_image_pin.publish_release_tag(pin, f"refs/tags/v{pin.release_version}")
    assert raised.value.code == "release_tag_mismatch"
    assert calls == []


def test_publish_requires_the_exact_serialized_release_claim(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pin = _pin()
    calls: list[str] = []
    monkeypatch.setattr(
        runtime_image_pin,
        "verify_source_labels",
        lambda _pin: calls.append("source"),
    )

    with pytest.raises(runtime_image_pin.RuntimeImagePinError) as raised:
        runtime_image_pin.publish_release_tag(pin, "refs/tags/v0.0.0")
    assert raised.value.code == "release_claim_invalid"
    assert calls == []


def test_publish_creates_an_absent_tag_from_the_digest_then_reads_it_back(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    pin = _pin()
    observed = iter((None, pin.digest))
    commands: list[list[str]] = []
    monkeypatch.setattr(runtime_image_pin, "verify_source_labels", lambda _pin: None)
    monkeypatch.setattr(
        runtime_image_pin, "registry_tag_digest", lambda _pin, _tag: next(observed)
    )

    def run(
        command: list[str], **_kwargs: object
    ) -> subprocess.CompletedProcess[bytes]:
        commands.append(command)
        return subprocess.CompletedProcess(command, 0, b"", b"")

    monkeypatch.setattr(runtime_image_pin.subprocess, "run", run)
    assert (
        runtime_image_pin.publish_release_tag(pin, f"refs/tags/v{pin.release_version}")
        == "tag_published"
    )
    assert commands == [
        [
            "docker",
            "buildx",
            "imagetools",
            "create",
            "--tag",
            pin.release_tag_ref,
            pin.image_ref,
        ]
    ]


def test_release_workflow_is_the_only_semver_tag_publisher() -> None:
    docker_workflow = (ROOT / ".github/workflows/docker.yml").read_text()
    release_workflow = (ROOT / ".github/workflows/release.yml").read_text()
    assert 'tags:\n      - "v[0-9]+.[0-9]+.[0-9]*"' not in docker_workflow
    assert "type=semver" not in docker_workflow
    assert "publish-runtime:" in release_workflow
    assert 'runtime_image_pin.py publish --claim "$GITHUB_REF"' in release_workflow
    claim_block = (
        "\nconcurrency:\n"
        "  group: release-runtime-${{ github.ref }}\n"
        "  cancel-in-progress: false\n\n"
        "permissions:\n"
    )
    assert release_workflow.count(claim_block) == 1
    assert "git merge-base --is-ancestor" in release_workflow
    assert release_workflow.index("publish-runtime:") < release_workflow.index(
        "release:\n"
    )
    release_needs = release_workflow.split("  release:\n", 1)[1].split("    steps:", 1)[
        0
    ]
    assert "- publish-runtime" in release_needs


# --- the release moves EVERY pin at once, and a pin left behind is red -------

NEW_DIGEST = "sha256:" + "ab" * 32
NEW_REVISION = "c" * 40


def _tree_copy(tmp_path: Path) -> Path:
    """The files the pin contract names, copied at the same paths: a tree to update without touching the repo."""
    tree = tmp_path / "tree"
    for relative in (
        *runtime_image_pin.PINNED_CONSUMERS,
        runtime_image_pin.MANIFEST_PATH,
        Path("package.json"),
    ):
        (tree / relative).parent.mkdir(parents=True, exist_ok=True)
        (tree / relative).write_bytes((ROOT / relative).read_bytes())
    return tree


def test_the_contract_names_the_enabler_and_the_selftest_too() -> None:
    # they held the August image while verify-tree was green: they were not listed
    names = {str(path) for path in runtime_image_pin.PINNED_CONSUMERS}
    assert {
        "scripts/enable-podman-windows-runtime.ps1",
        "scripts/windows-config-acl-selftest.ps1",
    } <= names


def test_update_moves_the_manifest_and_every_consumer(tmp_path: Path) -> None:
    tree = _tree_copy(tmp_path)
    old = _pin()
    before = {p: (tree / p).read_bytes() for p in runtime_image_pin.PINNED_CONSUMERS}

    done = runtime_image_pin.update_tree(tree, NEW_DIGEST, NEW_REVISION)

    assert done.digest == NEW_DIGEST and done.source_revision == NEW_REVISION
    assert runtime_image_pin.verify_tree(tree) == done
    assert runtime_image_pin.load_manifest(tree / runtime_image_pin.MANIFEST_PATH) == done
    for path in runtime_image_pin.PINNED_CONSUMERS:
        after = (tree / path).read_bytes()
        assert old.digest.encode() not in after, path
        assert NEW_DIGEST.encode() in after, path
        # nothing but the digest moved: same size apart from the digest, same line endings
        assert after.replace(NEW_DIGEST.encode(), old.digest.encode()) == before[path], path


def test_update_keeps_the_crlf_of_a_windows_checkout(tmp_path: Path) -> None:
    tree = _tree_copy(tmp_path)
    old = _pin()
    target = tree / "scripts/enable-podman-windows-runtime.ps1"
    target.write_bytes(target.read_bytes().replace(b"\r\n", b"\n").replace(b"\n", b"\r\n"))
    runtime_image_pin.update_tree(tree, NEW_DIGEST, NEW_REVISION)
    after = target.read_bytes()
    assert after.count(b"\n") == after.count(b"\r\n") > 100
    assert NEW_DIGEST.encode() in after and old.digest.encode() not in after
    assert runtime_image_pin.verify_tree(tree).digest == NEW_DIGEST


def test_a_pin_left_behind_after_the_update_is_red(tmp_path: Path) -> None:
    tree = _tree_copy(tmp_path)
    runtime_image_pin.update_tree(tree, NEW_DIGEST, NEW_REVISION)
    stale = tree / "scripts/enable-podman-windows-runtime.ps1"
    stale.write_bytes(stale.read_bytes().replace(NEW_DIGEST.encode(), _pin().digest.encode()))
    with pytest.raises(runtime_image_pin.RuntimeImagePinError) as raised:
        runtime_image_pin.verify_tree(tree)
    assert raised.value.code == "consumer_digest_drift"


def test_an_update_that_misses_a_consumer_changes_nothing(tmp_path: Path) -> None:
    tree = _tree_copy(tmp_path)
    odd = tree / "scripts/jht-wrapper.sh"
    odd.write_text(odd.read_text().replace("DEFAULT_RUNTIME_IMAGE=", "DEFAULT_RUNTIME_IMAGE_X=", 1))
    snapshot = {p: (tree / p).read_bytes() for p in runtime_image_pin.PINNED_CONSUMERS}
    manifest = (tree / runtime_image_pin.MANIFEST_PATH).read_bytes()
    with pytest.raises(runtime_image_pin.RuntimeImagePinError) as raised:
        runtime_image_pin.update_tree(tree, NEW_DIGEST, NEW_REVISION)
    assert raised.value.code == "consumer_pattern_unmatched"
    assert {p: (tree / p).read_bytes() for p in snapshot} == snapshot
    assert (tree / runtime_image_pin.MANIFEST_PATH).read_bytes() == manifest


@pytest.mark.parametrize(
    ("digest", "revision", "version", "code"),
    [
        ("sha256:short", NEW_REVISION, None, "digest_invalid"),
        (NEW_DIGEST, "main", None, "source_revision_invalid"),
        (NEW_DIGEST, NEW_REVISION, "9.9.9", "release_version_mismatch"),
    ],
)
def test_update_refuses_what_the_manifest_would_refuse(
    tmp_path: Path, digest: str, revision: str, version: str | None, code: str
) -> None:
    tree = _tree_copy(tmp_path)
    with pytest.raises(runtime_image_pin.RuntimeImagePinError) as raised:
        runtime_image_pin.update_tree(tree, digest, revision, version)
    assert raised.value.code == code
    assert runtime_image_pin.verify_tree(tree) == _pin()


def test_from_registry_takes_the_digest_of_master_and_the_commit_of_its_label(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    tree = _tree_copy(tmp_path)
    asked: list[str] = []
    monkeypatch.setattr(
        runtime_image_pin, "registry_tag_digest", lambda _pin, tag: asked.append(tag) or NEW_DIGEST
    )
    monkeypatch.setattr(
        runtime_image_pin,
        "registry_source_revision",
        lambda repository, digest: NEW_REVISION if digest == NEW_DIGEST else "0" * 40,
    )
    assert runtime_image_pin.main(["update", "--root", str(tree), "--from-registry"]) == 0
    assert asked == ["master"]
    pin = runtime_image_pin.verify_tree(tree)
    assert (pin.digest, pin.source_revision) == (NEW_DIGEST, NEW_REVISION)
    assert "tree_updated" in capsys.readouterr().out
    # a commit given by hand that the image does not carry is refused
    assert runtime_image_pin.main(
        ["update", "--root", str(tree), "--from-registry", "--source-revision", "d" * 40]
    ) == 1


def test_update_wants_one_source_for_the_image(tmp_path: Path) -> None:
    tree = _tree_copy(tmp_path)
    assert runtime_image_pin.main(["update", "--root", str(tree)]) == 1
    assert runtime_image_pin.main(["update", "--root", str(tree), "--digest", NEW_DIGEST]) == 1


def _git_tree(tmp_path: Path, files: dict[str, str]) -> Path:
    repo = tmp_path / "repo"
    repo.mkdir()
    for name, text in files.items():
        (repo / name).parent.mkdir(parents=True, exist_ok=True)
        (repo / name).write_text(text)
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "add", "-A"], check=True)
    return repo


def test_the_repository_names_no_image_but_the_manifests() -> None:
    runtime_image_pin.find_stray_pins(ROOT, _pin())


def test_a_copy_of_the_pin_outside_the_contract_is_red(tmp_path: Path) -> None:
    pin = _pin()
    stale = "ghcr.io/leopu00/jht@sha256:" + "e" * 64
    repo = _git_tree(tmp_path, {"docs/new-guide.md": f"pull {stale}\n", "release/runtime-image.v1.json": "{}\n"})
    with pytest.raises(runtime_image_pin.RuntimeImagePinError) as raised:
        runtime_image_pin.find_stray_pins(repo, pin)
    assert raised.value.code == "unlisted_stale_pin"
    # the same file with the manifest's own digest is fine
    (repo / "docs/new-guide.md").write_text(f"pull {pin.image_ref}\n")
    runtime_image_pin.find_stray_pins(repo, pin)


def test_the_cli_gate_runs_the_scan_too(tmp_path: Path) -> None:
    assert runtime_image_pin.main(["verify-tree", "--root", str(ROOT)]) == 0
