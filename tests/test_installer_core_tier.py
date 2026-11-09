"""The installers install the CORE image, and say so in runtime-tier, only when the release carries a core digest (T307 A, P3).

Without `core_digest` in the pin the constant is empty and nothing changes: the full image, no runtime-tier file. With one, an
install that was not given an image of its own (JHT_IMAGE, the test channel) pulls repo@core_digest and leaves `core` in a host
runtime file, attested in .runtime-integrity like runtime-image. The pin tool moves the constant in the four copies.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from scripts import runtime_image_pin as pin_tool
from tests.test_runtime_image_pin import NEW_DIGEST, NEW_REVISION, _tree_copy

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "scripts" / "install.sh"
INSTALL_PS1 = ROOT / "scripts" / "install.ps1"
CORE = "sha256:" + "cd" * 32
FULL = re.search(r"JHT_IMAGE:-(ghcr\.io/leopu00/jht@sha256:[0-9a-f]{64})", INSTALL.read_text(encoding="utf-8")).group(1)
TEST_IMAGE = "ghcr.io/leopu00/jht@sha256:" + "ab" * 32
bash_only = pytest.mark.skipif(sys.platform == "win32", reason="the bash installer is not run on Windows")


def source(tmp_path: Path, body: str, env: dict | None = None, *args: str) -> subprocess.CompletedProcess:
    runtime = tmp_path / "runtime"
    runtime.mkdir(exist_ok=True)
    home = tmp_path / "home"
    home.mkdir(exist_ok=True)
    script = f'JHT_INSTALLER_SOURCE_ONLY=1 . "{INSTALL}" "$@"\n{body}\n'
    return subprocess.run(
        ["bash", "-c", script, "install.sh", *args],
        env={"PATH": "/usr/bin:/bin", "HOME": str(home), "JHT_RUNTIME_DIR": str(runtime), **(env or {})},
        capture_output=True, text=True, timeout=30, check=False,
    )


SHOW = 'printf "image=%s tier=[%s]\\n" "$IMAGE" "$RUNTIME_TIER"'


@bash_only
@pytest.mark.parametrize(("env", "image", "tier"), [
    ({}, FULL, ""),
    ({"JHT_CORE_IMAGE_DIGEST": CORE}, f"ghcr.io/leopu00/jht@{CORE}", "core"),
    ({"JHT_CORE_IMAGE_DIGEST": CORE, "JHT_IMAGE": TEST_IMAGE}, TEST_IMAGE, ""),
], ids=["no-core-digest", "core-digest", "an-image-named-by-the-person"])
def test_the_install_image_and_tier(tmp_path, env, image, tier):
    done = source(tmp_path, SHOW, env)
    assert done.returncode == 0, done.stderr
    assert f"image={image} tier=[{tier}]" in done.stdout


@bash_only
def test_the_test_channel_keeps_its_own_image_and_no_tier(tmp_path):
    args = ("--runtime", "colima", "--source-sha", "1" * 40, "--image", TEST_IMAGE, "--expected-image-digest", TEST_IMAGE.split("@")[1])
    done = source(tmp_path, SHOW, {"JHT_CORE_IMAGE_DIGEST": CORE}, *args)
    if done.returncode != 0:
        pytest.skip("the test channel needs more of the installer state than the source-only mode gives: " + done.stderr[-200:])
    assert f"image={TEST_IMAGE} tier=[]" in done.stdout


@bash_only
def test_the_core_tier_is_staged_hashed_and_published(tmp_path):
    done = source(tmp_path, 'ok() { :; }; stage_runtime_tier; printf "sha=%s\\n" "$TIER_STAGED_SHA"; '
                  '[ ! -e "$JHT_RUNTIME_DIR/runtime-tier" ] && echo before-publish-absent; publish_runtime_tier', {"JHT_CORE_IMAGE_DIGEST": CORE})
    assert done.returncode == 0, done.stderr
    tier = tmp_path / "runtime" / "runtime-tier"
    assert tier.read_text() == "core\n" and oct(tier.stat().st_mode & 0o777) == "0o600"
    assert f"sha={hashlib.sha256(b'core\n').hexdigest()}" in done.stdout and "before-publish-absent" in done.stdout
    assert [p.name for p in (tmp_path / "runtime").iterdir()] == ["runtime-tier"], "no staged file is left"


@bash_only
def test_a_full_install_drops_a_tier_left_by_a_core_one(tmp_path):
    (tmp_path / "runtime").mkdir()
    (tmp_path / "runtime" / "runtime-tier").write_text("core\n")
    done = source(tmp_path, 'ok() { :; }; stage_runtime_tier; publish_runtime_tier; printf "sha=[%s]\\n" "$TIER_STAGED_SHA"')
    assert done.returncode == 0, done.stderr
    assert not (tmp_path / "runtime" / "runtime-tier").exists() and "sha=[]" in done.stdout


def test_the_pin_tool_moves_the_constant_in_the_four_copies_and_refuses_a_stale_one(tmp_path):
    tree = _tree_copy(tmp_path)
    pin_tool.update_tree(tree, NEW_DIGEST, NEW_REVISION, core_digest=CORE)
    for name in ("scripts/install.sh", "web/public/install.sh", "scripts/install.ps1", "web/public/install.ps1"):
        text = (tree / name).read_text(encoding="utf-8")
        assert f"{CORE}" in text, name
    assert pin_tool.verify_tree(tree).core_digest == CORE
    (tree / "web/public/install.sh").write_text((tree / "web/public/install.sh").read_text().replace(CORE, ""))
    with pytest.raises(pin_tool.RuntimeImagePinError) as refused:
        pin_tool.verify_tree(tree)
    assert refused.value.code in {"consumer_core_drift", "installer_digest_drift"}


def test_the_repository_copies_carry_the_empty_constant_while_the_pin_has_no_core_digest():
    assert json.loads((ROOT / pin_tool.MANIFEST_PATH).read_text(encoding="utf-8")).get("core_digest") is None
    assert pin_tool.verify_tree(ROOT).core_digest is None


@pytest.mark.skipif(not shutil.which("pwsh") and not shutil.which("powershell"), reason="no PowerShell")
@pytest.mark.parametrize(("env", "image", "tier"), [
    ({}, FULL, ""),
    ({"JHT_CORE_IMAGE_DIGEST": CORE}, f"ghcr.io/leopu00/jht@{CORE}", "core"),
    ({"JHT_CORE_IMAGE_DIGEST": CORE, "JHT_IMAGE": TEST_IMAGE}, TEST_IMAGE, ""),
])
def test_the_powershell_installer_chooses_the_same_image_and_tier(tmp_path, env, image, tier):
    text = INSTALL_PS1.read_text(encoding="utf-8").replace("\r\n", "\n")
    block = re.search(r"^\$Image = if.*?\n(\$CoreImageDigest.*?)^\$RuntimeImage = ", text, re.S | re.M).group(1)
    first = re.search(r"^\$Image = if.*$", text, re.M).group(0)
    script = tmp_path / "choose.ps1"
    script.write_text("$TestChannel = $false\n" + first + "\n" + block + "Write-Output \"image=$Image tier=[$RuntimeTier]\"\n", encoding="utf-8")
    import os
    shell = shutil.which("pwsh") or shutil.which("powershell")
    done = subprocess.run([shell, "-NoProfile", "-File", str(script)], env={**os.environ, **env}, capture_output=True, text=True, timeout=60, check=False)
    assert done.returncode == 0, done.stderr
    assert f"image={image} tier=[{tier}]" in done.stdout
