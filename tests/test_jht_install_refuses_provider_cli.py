"""`jht-install` does not install the provider's CLI (codex, claude, kimi): it is part of the image, and nobody in
the team updates, installs or replaces it (JHT-T195). Any other package goes through as before."""
import os
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "agents" / "_tools" / "jht-install"


@pytest.fixture()
def box(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    calls = tmp_path / "calls"
    for tool in ("npm", "uv", "pip3"):
        (bin_dir / tool).write_text(f'#!/bin/sh\necho "{tool} $*" >> "{calls}"\nexit 0\n', encoding="utf-8")
        (bin_dir / tool).chmod(0o755)

    def run(*args):
        env = {**os.environ, "PATH": f"{bin_dir}:/usr/bin:/bin", "JHT_DEPS_PREFIX": str(tmp_path / "deps")}
        done = subprocess.run(["bash", str(INSTALL), *args], capture_output=True, text=True, env=env, timeout=60)
        return done, (calls.read_text(encoding="utf-8").splitlines() if calls.exists() else [])

    return run


@pytest.mark.parametrize("lane,package", [
    ("node", "@openai/codex"),
    ("node", "@openai/codex@0.164.0"),
    ("node", "@openai/codex@latest"),
    ("npm", "codex"),
    ("node", "@anthropic-ai/claude-code"),
    ("node", "@Anthropic-AI/Claude-Code@2.0.1"),
    ("node", "claude-code"),
    ("py", "kimi-cli"),
    ("py", "kimi-cli==1.2.3"),
    ("python", "kimi"),
    ("py", "kimi-cli[extra]>=1"),
])
def test_the_providers_cli_is_refused_with_the_apt_exit_and_nothing_is_run(box, lane, package):
    done, calls = box(lane, package)
    assert done.returncode == 3, done.stderr
    assert "part of the image" in done.stderr and "Captain" in done.stderr
    assert calls == []


def test_one_provider_cli_among_other_packages_stops_the_whole_install(box):
    done, calls = box("node", "left-pad", "@openai/codex")
    assert done.returncode == 3 and calls == []


@pytest.mark.parametrize("lane,package,tool", [
    ("node", "@playwright/test", "npm"),
    ("node", "yt-dlp", "npm"),
    ("node", "codex-helper-not-the-cli", "npm"),
    ("py", "faster-whisper", "uv"),
    ("py", "kimi-utils", "uv"),
])
def test_any_other_package_is_installed_as_before(box, lane, package, tool):
    done, calls = box(lane, package)
    assert done.returncode == 0, done.stderr
    assert calls == [f"{tool} " + (f"pip install --user {package}" if tool == "uv" else f"install -g {package}")]


def test_apt_still_refuses_as_before(box):
    done, calls = box("apt", "ffmpeg")
    assert done.returncode == 3 and calls == []
