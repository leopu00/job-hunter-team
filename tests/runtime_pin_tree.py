"""Trees and pins for the tests of the runtime image pin that must not depend on the schema the repository is at today.

The manifest of the repository moves with the release: schema 1 (the full image), 2 (and the core image), 3 (and the extras image).
A test that copies the tree to update it, or that reads the pin as a value to compare, would be red the day the repository changes
schema if it took the real manifest as its starting point. These helpers make the starting point explicit: a tree, or a pin, at
schema 1 whatever the repository is at (made with the tool itself, so the copy is one the gate accepts), and a tree at the schema
the repository has (for the tests that are about the repository as it is).
"""

from __future__ import annotations

import json
from pathlib import Path

from scripts import runtime_image_pin

ROOT = Path(__file__).resolve().parents[1]
# The consumers of the contract as the tool names them, taken at import: a test may replace the table for its own case, and the
# copy of a tree must still be made from the real files.
REAL_CORE_CONSUMER_PATTERNS = dict(runtime_image_pin.CORE_CONSUMER_PATTERNS)


def tree_copy(tmp_path: Path) -> Path:
    """The files the pin contract names, copied at the same paths, as the repository has them."""
    tree = tmp_path / "tree"
    for relative in (
        *runtime_image_pin.PINNED_CONSUMERS,
        *(path for path in REAL_CORE_CONSUMER_PATTERNS if path not in runtime_image_pin.PINNED_CONSUMERS),
        *(digest for _, digest in runtime_image_pin.INSTALLER_DIGESTS),
        runtime_image_pin.MANIFEST_PATH,
        Path("package.json"),
    ):
        (tree / relative).parent.mkdir(parents=True, exist_ok=True)
        (tree / relative).write_bytes((ROOT / relative).read_bytes())
    return tree


def schema1_tree(tmp_path: Path) -> Path:
    """A copy of the tree at schema 1: the same full image and commit, no core and no extras digest anywhere."""
    tree = tree_copy(tmp_path)
    pin = runtime_image_pin.load_manifest(tree / runtime_image_pin.MANIFEST_PATH)
    replaced = runtime_image_pin.CORE_CONSUMER_PATTERNS
    runtime_image_pin.CORE_CONSUMER_PATTERNS = REAL_CORE_CONSUMER_PATTERNS
    try:
        runtime_image_pin.update_tree(tree, pin.digest, pin.source_revision, drop_core=True, drop_extras=True)
    finally:
        runtime_image_pin.CORE_CONSUMER_PATTERNS = replaced
    assert runtime_image_pin.load_manifest(tree / runtime_image_pin.MANIFEST_PATH).core_digest is None
    return tree


def schema1_pin() -> runtime_image_pin.RuntimeImagePin:
    """The pin of the repository reduced to its full image: what a release before the core image names."""
    real = runtime_image_pin.load_manifest(ROOT / runtime_image_pin.MANIFEST_PATH)
    return runtime_image_pin.RuntimeImagePin(real.release_version, real.repository, real.digest, real.source_revision)


def schema1_manifest_data() -> dict:
    """The manifest of the repository as a release at schema 1 would write it (no core, no extras digest)."""
    data = json.loads((ROOT / runtime_image_pin.MANIFEST_PATH).read_text(encoding="utf-8"))
    for key in ("core_digest", "extras_digest"):
        data.pop(key, None)
    data["schema_version"] = runtime_image_pin.SCHEMA_VERSION
    return data
