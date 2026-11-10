"""The pin can name a second image, the CORE one (schema 2): both digests, or the copy is refused. Without one nothing changes."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts import runtime_image_pin as pin_tool
from tests.test_runtime_image_pin import MANIFEST, NEW_DIGEST, NEW_REVISION, _tree_copy

CORE = "sha256:" + "cd" * 32
CORE_LINE = r'^CORE_IMAGE="(?P<core_image>[^"]+)"$'
CORE_DIGEST_LINE = r'^CORE_IMAGE_DIGEST="\$\{JHT_CORE_IMAGE_DIGEST:-(?P<core_digest>(?:sha256:[0-9a-f]{64})?)\}"$'


def _manifest(tmp_path: Path, **changes) -> Path:
    data = json.loads(MANIFEST.read_text())
    data.update(changes)
    data = {key: value for key, value in data.items() if value is not None}
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")
    return path


def test_the_repository_manifest_is_still_schema_1_with_no_core_digest() -> None:
    pin = pin_tool.load_manifest(MANIFEST)
    assert pin.core_digest is None and pin.core_image_ref is None
    assert json.loads(MANIFEST.read_text())["schema_version"] == 1


def test_a_schema_2_manifest_carries_the_core_digest(tmp_path: Path) -> None:
    pin = pin_tool.load_manifest(_manifest(tmp_path, schema_version=2, core_digest=CORE))
    assert pin.core_digest == CORE and pin.core_image_ref == f"ghcr.io/leopu00/jht@{CORE}"
    assert pin.image_ref.endswith(pin.digest)  # `digest` is still the full image


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"schema_version": 1, "core_digest": CORE}, "manifest_schema"),  # a core digest under schema 1
        ({"schema_version": 2}, "manifest_schema"),  # schema 2 without one
        ({"schema_version": 2, "core_digest": "sha256:xyz"}, "core_digest_invalid"),
        ({"schema_version": 2, "core_digest": json.loads(MANIFEST.read_text())["digest"]}, "core_digest_invalid"),  # two images, one digest
        ({"schema_version": 2, "core_digest": 7}, "core_digest_invalid"),
    ],
    ids=["core-under-schema-1", "schema-2-without-core", "malformed", "same-as-full", "not-a-string"],
)
def test_the_manifest_refuses_the_two_digest_shapes_that_do_not_agree(tmp_path: Path, changes, code) -> None:
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.load_manifest(_manifest(tmp_path, **changes))
    assert refused.value.code == code


def test_show_prints_the_core_fields_and_nothing_for_schema_1(capsys: pytest.CaptureFixture) -> None:
    assert pin_tool.main(["--manifest", str(MANIFEST), "show", "--field", "core_digest"]) == 0
    assert capsys.readouterr().out.strip() == ""


def _tree_with_core_consumer(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, line: bool = True) -> Path:
    tree = _tree_copy(tmp_path)
    consumer = Path("scripts/core-consumer.sh")
    (tree / consumer).write_text('CORE_IMAGE="ghcr.io/leopu00/jht@sha256:' + "00" * 32 + '"\n' if line else "# no core\n")
    monkeypatch.setattr(pin_tool, "CORE_CONSUMER_PATTERNS", {consumer: (CORE_LINE,)})
    return tree


def test_an_update_with_a_core_digest_writes_schema_2_and_moves_the_core_consumers(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_core_consumer(tmp_path, monkeypatch)
    done = pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE)
    assert done.core_digest == CORE
    assert json.loads((tree / pin_tool.MANIFEST_PATH).read_text())["schema_version"] == 2
    assert CORE in (tree / "scripts/core-consumer.sh").read_text()
    assert pin_tool.verify_tree(tree) == done


def test_a_copy_with_one_digest_is_refused(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_core_consumer(tmp_path, monkeypatch)
    pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE)
    (tree / "scripts/core-consumer.sh").write_text("# the core constant is gone\n")
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.verify_tree(tree)
    assert refused.value.code == "consumer_core_drift"


def test_a_copy_that_names_a_core_the_manifest_does_not_is_refused(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_core_consumer(tmp_path, monkeypatch)
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.verify_tree(tree)  # schema 1 manifest, but the copy carries a core constant
    assert refused.value.code == "consumer_core_drift"
    with pytest.raises(pin_tool.RuntimeImagePinError) as stopped:
        pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION)  # an update without a core digest does not guess one
    assert stopped.value.code == "consumer_core_drift"


def test_an_update_whose_core_consumer_pattern_misses_changes_nothing(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_core_consumer(tmp_path, monkeypatch, line=False)
    before = (tree / pin_tool.MANIFEST_PATH).read_bytes()
    with pytest.raises(pin_tool.RuntimeImagePinError) as stopped:
        pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE)
    assert stopped.value.code == "consumer_pattern_unmatched"
    assert (tree / pin_tool.MANIFEST_PATH).read_bytes() == before


def test_the_core_digest_must_differ_from_the_full_one_in_an_update(tmp_path: Path) -> None:
    tree = _tree_copy(tmp_path)
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=NEW_DIGEST)
    assert refused.value.code == "core_digest_invalid"


def _tree_with_core_digest_constant(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, value: str = "") -> Path:
    """The installers' shape: the constant is always there, empty while the manifest has no core digest."""
    tree = _tree_copy(tmp_path)
    consumer = Path("scripts/installer-like.sh")
    (tree / consumer).write_text('CORE_IMAGE_DIGEST="${JHT_CORE_IMAGE_DIGEST:-' + value + '}"\n')
    monkeypatch.setattr(pin_tool, "CORE_CONSUMER_PATTERNS", {consumer: (CORE_DIGEST_LINE,)})
    return tree


def test_the_constant_is_empty_while_the_manifest_has_no_core_digest(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_core_digest_constant(tmp_path, monkeypatch, "")
    assert pin_tool.verify_tree(tree).core_digest is None
    done = pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION)  # an update without a core digest keeps it empty
    assert done.core_digest is None and 'CORE_IMAGE_DIGEST="${JHT_CORE_IMAGE_DIGEST:-}"' in (tree / "scripts/installer-like.sh").read_text()


def test_the_constant_follows_the_core_digest_and_a_value_without_one_is_refused(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_core_digest_constant(tmp_path, monkeypatch, "")
    done = pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE)
    assert f":-{CORE}}}" in (tree / "scripts/installer-like.sh").read_text()
    assert pin_tool.verify_tree(tree) == done
    (tree / "scripts/installer-like.sh").write_text('CORE_IMAGE_DIGEST="${JHT_CORE_IMAGE_DIGEST:-}"\n')  # a copy left with no value
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.verify_tree(tree)
    assert refused.value.code == "consumer_core_drift"
    other = _tree_with_core_digest_constant(tmp_path / "x", monkeypatch, CORE)  # and a value the manifest does not have
    with pytest.raises(pin_tool.RuntimeImagePinError) as stale:
        pin_tool.verify_tree(other)
    assert stale.value.code == "consumer_core_drift"


def test_a_schema_2_manifest_with_no_core_consumers_listed_is_refused(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_copy(tmp_path)
    manifest = json.loads((tree / pin_tool.MANIFEST_PATH).read_text())
    manifest.update(schema_version=2, core_digest=CORE)
    (tree / pin_tool.MANIFEST_PATH).write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    monkeypatch.setattr(pin_tool, "CORE_CONSUMER_PATTERNS", {})
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.verify_tree(tree)  # nothing would check the copies: it must not pass for verified
    assert refused.value.code == "core_consumers_missing"


def test_an_update_without_a_core_digest_does_not_drop_the_one_the_manifest_has(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_core_digest_constant(tmp_path, monkeypatch, "")
    pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE)
    other = "sha256:" + "ef" * 32
    before = (tree / pin_tool.MANIFEST_PATH).read_bytes()
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.update_tree(tree, other, NEW_REVISION)
    assert refused.value.code == "core_digest_dropped"
    assert (tree / pin_tool.MANIFEST_PATH).read_bytes() == before  # all or nothing
    done = pin_tool.update_tree(tree, other, NEW_REVISION, drop_core=True)  # said out loud, it goes back to schema 1
    assert done.core_digest is None and json.loads((tree / pin_tool.MANIFEST_PATH).read_text())["schema_version"] == 1


# ── the release checks cover the core image too ──────────────────────────────────


def _pin_with_core():
    from tests.test_runtime_image_pin import _pin

    full = _pin()
    return pin_tool.RuntimeImagePin(full.release_version, full.repository, full.digest, full.source_revision, CORE)


def test_verify_source_looks_at_both_images_and_each_must_carry_the_pinned_commit(monkeypatch) -> None:
    pin = _pin_with_core()
    asked: list[str] = []
    labels = {pin.digest: [pin.source_revision] * 2, CORE: [pin.source_revision] * 2}
    monkeypatch.setattr(pin_tool, "_platform_revisions", lambda _pin, digest=None: asked.append(digest) or iter(labels[digest]))
    pin_tool.verify_source_labels(pin)
    assert asked == [pin.digest, CORE]
    labels[CORE] = [pin.source_revision, "0" * 40]  # one platform of the core built from another commit
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.verify_source_labels(pin)
    assert refused.value.code == "source_revision_mismatch"


def test_verify_source_without_a_core_digest_asks_only_for_the_full_image(monkeypatch) -> None:
    from tests.test_runtime_image_pin import _pin

    pin = _pin()
    asked: list[str] = []
    monkeypatch.setattr(pin_tool, "_platform_revisions", lambda _pin, digest=None: asked.append(digest) or iter([pin.source_revision]))
    pin_tool.verify_source_labels(pin)
    assert asked == [pin.digest]


def test_the_core_release_tag_is_the_version_with_a_suffix_and_only_the_known_tags_are_asked(monkeypatch) -> None:
    pin = _pin_with_core()
    assert pin.core_release_tag == f"{pin.release_version}-core"
    seen: list[str] = []
    monkeypatch.setattr(pin_tool, "_anonymous_registry_token", lambda _pin: "t")
    monkeypatch.setattr(pin_tool, "_registry_request", lambda _pin, **kw: seen.append(kw["identity"]) or ({"docker-content-digest": CORE}, b""))
    for tag in (pin.release_version, "master", pin.core_release_tag, "master-core"):
        assert pin_tool.registry_tag_digest(pin, tag) == CORE
    for tag in ("latest", "latest-core", f"{pin.release_version}-other", "9.9.9-core"):
        with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
            pin_tool.registry_tag_digest(pin, tag)
        assert refused.value.code == "tag_invalid", tag


def test_publish_tags_the_core_image_from_its_own_digest_and_never_moves_a_tag(monkeypatch) -> None:
    pin = _pin_with_core()
    commands: list[list[str]] = []
    state = {pin.release_version: None, pin.core_release_tag: None}
    monkeypatch.setattr(pin_tool, "verify_source_labels", lambda _pin: None)
    monkeypatch.setattr(pin_tool, "registry_tag_digest", lambda _pin, tag: state[tag])

    def run(command, **_kwargs):
        commands.append(command)
        tag = command[command.index("--tag") + 1].rsplit(":", 1)[1]
        state[tag] = command[-1].rsplit("@", 1)[1]
        import subprocess

        return subprocess.CompletedProcess(command, 0, b"", b"")

    monkeypatch.setattr(pin_tool.subprocess, "run", run)
    assert pin_tool.publish_release_tag(pin, f"refs/tags/v{pin.release_version}") == "tag_published"
    assert [c[-1] for c in commands] == [pin.image_ref, f"{pin.repository}@{CORE}"]
    assert [c[c.index("--tag") + 1] for c in commands] == [f"{pin.repository}:{pin.release_version}", f"{pin.repository}:{pin.core_release_tag}"]
    commands.clear()
    assert pin_tool.publish_release_tag(pin, f"refs/tags/v{pin.release_version}") == "tag_verified"  # both exist: nothing created
    assert commands == []
    state[pin.core_release_tag] = "sha256:" + "ee" * 32  # a core tag that moved elsewhere is refused, not overwritten
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.publish_release_tag(pin, f"refs/tags/v{pin.release_version}")
    assert refused.value.code == "release_tag_mismatch" and commands == []


def test_verify_tag_refuses_a_core_tag_that_points_elsewhere(tmp_path: Path, monkeypatch, capsys) -> None:
    manifest = _manifest(tmp_path, schema_version=2, core_digest=CORE)
    pin = pin_tool.load_manifest(manifest)
    digests = {"master": pin.digest, "master-core": "sha256:" + "ee" * 32}
    monkeypatch.setattr(pin_tool, "registry_tag_digest", lambda _pin, tag: digests[tag])
    monkeypatch.setattr(pin_tool, "verify_source_labels", lambda _pin: None)
    assert pin_tool.main(["--manifest", str(manifest), "verify-tag", "--tag", "master"]) == 1
    assert "tag_digest_mismatch" in capsys.readouterr().err
    digests["master-core"] = CORE
    assert pin_tool.main(["--manifest", str(manifest), "verify-tag", "--tag", "master"]) == 0
