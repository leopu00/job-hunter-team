"""The pin can name a third image, the EXTRAS one (schema 3): three digests, or the copy is refused. Without one nothing changes."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from scripts import runtime_image_pin as pin_tool
from runtime_pin_tree import schema1_manifest_data
from tests.test_runtime_image_pin import MANIFEST, NEW_DIGEST, NEW_REVISION, _tree_copy
from tests.test_runtime_image_pin_core import CORE, _manifest

EXTRAS = "sha256:" + "ef" * 32
CORE_CONSTANT = r'^CORE_IMAGE_DIGEST="(?P<core_digest>(?:sha256:[0-9a-f]{64})?)"$'
EXTRAS_CONSTANT = r'^EXTRAS_IMAGE_DIGEST="(?P<extras_digest>(?:sha256:[0-9a-f]{64})?)"$'


def test_the_wrappers_carry_the_extras_digest_their_manifest_has_whatever_the_schema() -> None:
    pin = pin_tool.load_manifest(MANIFEST)
    root = MANIFEST.parent.parent
    sh = (root / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
    ps = (root / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")
    if pin.extras_digest is None:
        assert pin.extras_image_ref is None
        assert 'EXTRAS_IMAGE_DIGEST=""' in sh and "$ExtrasImageDigest = ''" in ps
    else:
        assert pin.extras_image_ref == f"{pin.repository}@{pin.extras_digest}"
        assert f'EXTRAS_IMAGE_DIGEST="{pin.extras_digest}"' in sh and f"$ExtrasImageDigest = '{pin.extras_digest}'" in ps
    assert all(any("extras_digest" in p for p in patterns) for path, patterns in pin_tool.CORE_CONSUMER_PATTERNS.items() if "wrapper" in str(path))


def test_a_schema_3_manifest_carries_three_digests(tmp_path: Path) -> None:
    pin = pin_tool.load_manifest(_manifest(tmp_path, schema_version=3, core_digest=CORE, extras_digest=EXTRAS))
    assert pin.extras_digest == EXTRAS and pin.extras_image_ref == f"ghcr.io/leopu00/jht@{EXTRAS}"
    assert pin.extras_release_tag == f"{pin.release_version}-extras"
    assert pin.core_digest == CORE and pin.image_ref.endswith(pin.digest)


@pytest.mark.parametrize(
    ("changes", "code"),
    [
        ({"schema_version": 2, "core_digest": CORE, "extras_digest": EXTRAS}, "manifest_schema"),  # extras under schema 2
        ({"schema_version": 3, "core_digest": CORE}, "manifest_schema"),  # schema 3 without extras
        ({"schema_version": 3, "extras_digest": EXTRAS}, "manifest_shape"),  # extras without core
        ({"schema_version": 3, "core_digest": CORE, "extras_digest": "sha256:xyz"}, "extras_digest_invalid"),
        ({"schema_version": 3, "core_digest": CORE, "extras_digest": 7}, "extras_digest_invalid"),
        ({"schema_version": 3, "core_digest": CORE, "extras_digest": CORE}, "extras_digest_invalid"),  # same as the core
        ({"schema_version": 3, "core_digest": CORE, "extras_digest": schema1_manifest_data()["digest"]}, "extras_digest_invalid"),
    ],
    ids=["extras-under-schema-2", "schema-3-without-extras", "extras-without-core", "malformed", "not-a-string", "same-as-core", "same-as-full"],
)
def test_the_manifest_refuses_the_shapes_that_do_not_agree(tmp_path: Path, changes, code) -> None:
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.load_manifest(_manifest(tmp_path, **changes))
    assert refused.value.code == code


def _tree_with_constants(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, core: str = "", extras: str = "") -> Path:
    """The wrappers' shape: both constants are always there, empty while the manifest has no such digest."""
    tree = _tree_copy(tmp_path)
    consumer = Path("scripts/wrapper-like.sh")
    (tree / consumer).write_text(f'CORE_IMAGE_DIGEST="{core}"\nEXTRAS_IMAGE_DIGEST="{extras}"\n')
    monkeypatch.setattr(pin_tool, "CORE_CONSUMER_PATTERNS", {consumer: (CORE_CONSTANT, EXTRAS_CONSTANT)})
    return tree


def test_an_update_with_three_digests_writes_schema_3_and_moves_both_constants(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_constants(tmp_path, monkeypatch)
    done = pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE, extras_digest=EXTRAS)
    assert done.extras_digest == EXTRAS
    assert json.loads((tree / pin_tool.MANIFEST_PATH).read_text())["schema_version"] == 3
    assert (tree / "scripts/wrapper-like.sh").read_text() == f'CORE_IMAGE_DIGEST="{CORE}"\nEXTRAS_IMAGE_DIGEST="{EXTRAS}"\n'
    assert pin_tool.verify_tree(tree) == done


def test_without_an_extras_digest_the_constant_stays_empty_and_the_manifest_schema_2(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_constants(tmp_path, monkeypatch)
    done = pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE)
    assert done.extras_digest is None and 'EXTRAS_IMAGE_DIGEST=""' in (tree / "scripts/wrapper-like.sh").read_text()
    assert json.loads((tree / pin_tool.MANIFEST_PATH).read_text())["schema_version"] == 2


def test_a_copy_that_lost_or_invented_the_extras_digest_is_refused(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_constants(tmp_path, monkeypatch)
    pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE, extras_digest=EXTRAS)
    (tree / "scripts/wrapper-like.sh").write_text(f'CORE_IMAGE_DIGEST="{CORE}"\nEXTRAS_IMAGE_DIGEST=""\n')
    with pytest.raises(pin_tool.RuntimeImagePinError) as lost:
        pin_tool.verify_tree(tree)
    assert lost.value.code == "consumer_core_drift"
    other = _tree_with_constants(tmp_path / "x", monkeypatch, core="", extras=EXTRAS)
    with pytest.raises(pin_tool.RuntimeImagePinError) as invented:
        pin_tool.verify_tree(other)
    assert invented.value.code == "consumer_core_drift"


def test_an_extras_digest_needs_a_core_digest_and_three_different_ones_in_an_update(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_constants(tmp_path, monkeypatch)
    for kwargs in ({"extras_digest": EXTRAS}, {"core_digest": CORE, "extras_digest": CORE}, {"core_digest": CORE, "extras_digest": NEW_DIGEST}):
        with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
            pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, **kwargs)
        assert refused.value.code == "extras_digest_invalid"


def test_an_update_without_an_extras_digest_does_not_drop_the_one_the_manifest_has(tmp_path: Path, monkeypatch) -> None:
    tree = _tree_with_constants(tmp_path, monkeypatch)
    pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE, extras_digest=EXTRAS)
    before = (tree / pin_tool.MANIFEST_PATH).read_bytes()
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE)
    assert refused.value.code == "extras_digest_dropped"
    assert (tree / pin_tool.MANIFEST_PATH).read_bytes() == before
    done = pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE, drop_extras=True)  # asked for out loud
    assert done.extras_digest is None


def test_show_prints_the_extras_fields(capsys: pytest.CaptureFixture, tmp_path: Path) -> None:
    manifest = _manifest(tmp_path, schema_version=3, core_digest=CORE, extras_digest=EXTRAS)
    assert pin_tool.main(["--manifest", str(manifest), "show", "--field", "extras_image_ref"]) == 0
    assert capsys.readouterr().out.strip() == f"ghcr.io/leopu00/jht@{EXTRAS}"
    assert pin_tool.main(["--manifest", str(_manifest(tmp_path)), "show", "--field", "extras_digest"]) == 0  # schema 1: nothing to print
    assert capsys.readouterr().out.strip() == ""


def test_the_extras_image_is_published_and_verified_with_its_own_tag(monkeypatch) -> None:
    pin = pin_tool.RuntimeImagePin("0.4.0", "ghcr.io/leopu00/jht", NEW_DIGEST, NEW_REVISION, CORE, EXTRAS)
    seen: list[tuple[str, str]] = []
    monkeypatch.setattr(pin_tool, "verify_source_labels", lambda pin: None)
    monkeypatch.setattr(pin_tool, "_publish_one_tag", lambda pin, tag, digest: seen.append((tag, digest)) or "tag_published")
    assert pin_tool.publish_release_tag(pin, "refs/tags/v0.4.0") == "tag_published"
    assert seen == [("0.4.0", NEW_DIGEST), ("0.4.0-core", CORE), ("0.4.0-extras", EXTRAS)]


def test_the_source_labels_of_the_extras_image_are_checked_too(monkeypatch) -> None:
    pin = pin_tool.RuntimeImagePin("0.4.0", "ghcr.io/leopu00/jht", NEW_DIGEST, NEW_REVISION, CORE, EXTRAS)
    asked: list[str] = []
    monkeypatch.setattr(pin_tool, "_platform_revisions", lambda pin, digest=None: asked.append(digest) or iter([NEW_REVISION]))
    pin_tool.verify_source_labels(pin)
    assert asked == [NEW_DIGEST, CORE, EXTRAS]
    monkeypatch.setattr(pin_tool, "_platform_revisions", lambda pin, digest=None: iter(["f" * 40] if digest == EXTRAS else [NEW_REVISION]))
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.verify_source_labels(pin)
    assert refused.value.code == "source_revision_mismatch"


@pytest.mark.parametrize("tag", ["0.4.0-extras", "master-extras"])
def test_only_the_known_extras_tags_are_read_from_the_registry(tag, monkeypatch) -> None:
    pin = pin_tool.RuntimeImagePin("0.4.0", "ghcr.io/leopu00/jht", NEW_DIGEST, NEW_REVISION, CORE, EXTRAS)
    monkeypatch.setattr(pin_tool, "_anonymous_registry_token", lambda pin: "t")
    monkeypatch.setattr(pin_tool, "_registry_request", lambda pin, **kw: ({"docker-content-digest": EXTRAS}, b""))
    assert pin_tool.registry_tag_digest(pin, tag) == EXTRAS
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.registry_tag_digest(pin, "0.4.0-other")
    assert refused.value.code == "tag_invalid"


def test_verify_tag_compares_the_extras_tag_with_the_extras_digest(tmp_path: Path, monkeypatch, capsys) -> None:
    manifest = _manifest(tmp_path, schema_version=3, core_digest=CORE, extras_digest=EXTRAS)
    tags = {"0.4.0": schema1_manifest_data()["digest"], "0.4.0-core": CORE, "0.4.0-extras": EXTRAS}
    version = pin_tool.load_manifest(manifest).release_version
    tags = {tag.replace("0.4.0", version): digest for tag, digest in tags.items()}
    monkeypatch.setattr(pin_tool, "registry_tag_digest", lambda pin, tag: tags.get(tag))
    monkeypatch.setattr(pin_tool, "verify_source_labels", lambda pin: None)
    assert pin_tool.main(["--manifest", str(manifest), "verify-tag", "--tag", "release"]) == 0
    tags[f"{version}-extras"] = CORE  # the extras tag moved to another image
    assert pin_tool.main(["--manifest", str(manifest), "verify-tag", "--tag", "release"]) == 1
    assert "tag_digest_mismatch" in capsys.readouterr().err
