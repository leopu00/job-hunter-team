"""The Dockerfile builds two images from one file: `core` (what the Assistente, the broker
and Pi need in the first minutes) and `full` (core plus the tools that arrive later).

Plain `docker build .` stays the image of before (`full`). These tests read the file and
keep the shape that makes the two images safe: a stable prefix with the heavy layers, ONE
runtime stage built on each prefix, and a tier that comes from the prefix, not from a
build argument or from compose."""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCKERFILE = (ROOT / "Dockerfile").read_text(encoding="utf-8")

# What only the full image carries: browsers, X and the live screen, the CV PDF toolchain, the media tools.
TOOLS = ("chromium", "openbox", "xvfb", "x11vnc", "python3-websockify", "pandoc", "wkhtmltopdf", "ffmpeg",
         "tesseract-ocr", "playwright")


def stage(name: str) -> str:
    """The text of one stage, from its FROM to the next FROM."""
    start = re.search(rf"^FROM .* AS {re.escape(name)}\s*$", DOCKERFILE, re.M)
    assert start, f"stage {name} missing"
    nxt = re.search(r"^FROM ", DOCKERFILE[start.end():], re.M)
    return DOCKERFILE[start.start(): start.end() + (nxt.start() if nxt else len(DOCKERFILE))]


def code(text: str) -> str:
    return "\n".join(line for line in text.splitlines() if not line.lstrip().startswith("#"))


def test_three_stages_in_this_order():
    names = re.findall(r"^FROM .* AS (\S+)\s*$", DOCKERFILE, re.M)
    assert names == ["prefix-core", "prefix-full", "runtime"]
    assert re.search(r"^FROM prefix-core AS prefix-full\s*$", DOCKERFILE, re.M)
    assert re.search(r"^FROM \$\{BASE\} AS runtime\s*$", DOCKERFILE, re.M)


def test_the_default_is_still_the_full_image():
    """`docker build .` with no target and no argument: the last stage (runtime) on prefix-full."""
    assert re.search(r"^ARG BASE=prefix-full\s*$", DOCKERFILE, re.M)
    # the ARG that FROM uses lives before the first FROM
    assert DOCKERFILE.index("ARG BASE=") < DOCKERFILE.index("\nFROM ")
    assert DOCKERFILE.rstrip().splitlines()[-1].startswith(("CMD", "ENTRYPOINT"))


def test_the_core_prefix_has_no_tool_and_the_tools_prefix_has_them_all():
    core, full = code(stage("prefix-core")), code(stage("prefix-full"))
    for tool in TOOLS:
        assert not re.search(rf"(?<![\w/-]){re.escape(tool)}(?![\w-])", core), f"{tool} in the core prefix"
        assert re.search(rf"(?<![\w/-]){re.escape(tool)}(?![\w-])", full), f"{tool} missing from the tools prefix"
    for need in ("python3", "tmux", "git", "tini", "poppler-utils", "npm ci --prefix cli", "pip3 install --no-cache-dir -r requirements.txt"):
        assert need in core, need


def test_the_tier_is_the_env_of_the_prefix_and_never_a_build_argument():
    assert re.search(r"^ENV JHT_IMAGE_TIER=core\b", stage("prefix-core"), re.M)
    assert re.search(r"^ENV JHT_IMAGE_TIER=full\s*$", stage("prefix-full"), re.M)
    runtime = code(stage("runtime"))
    assert "JHT_IMAGE_TIER=" not in runtime, "the runtime stage must inherit the tier from its BASE"
    assert not re.search(r"ARG\s+\w*TIER", DOCKERFILE), "a tier build argument could say core over the tools of full"
    # compose must not declare it either: the tier belongs to the image
    for compose in ROOT.glob("docker-compose*.yml"):
        assert "JHT_IMAGE_TIER" not in compose.read_text(encoding="utf-8"), compose.name


def test_heavy_layers_sit_below_the_code():
    """The apt and pip layers of both prefixes come before `COPY . .`: an update never downloads them again."""
    copy_all = DOCKERFILE.index("COPY . .")
    assert copy_all > DOCKERFILE.index("playwright install chromium")
    assert copy_all > DOCKERFILE.index("pip3 install --no-cache-dir -r requirements.txt")
    assert DOCKERFILE.count("COPY . .") == 1 and "COPY . ." in stage("runtime")
    assert "COPY . ." not in stage("prefix-core") + stage("prefix-full")


def test_playwright_belongs_to_the_tools_requirements():
    core = (ROOT / "requirements.txt").read_text(encoding="utf-8")
    tools = (ROOT / "requirements-tools.txt").read_text(encoding="utf-8")
    assert not re.search(r"^playwright==", core, re.M)
    assert re.search(r"^playwright==\d+\.\d+\.\d+\s*$", tools, re.M)
    assert "COPY requirements-tools.txt" in stage("prefix-full") and "requirements-tools.txt" not in stage("prefix-core")


def test_the_runtime_gates_know_both_tiers():
    runtime = stage("runtime")
    assert "BUILD GATE FAILED: JHT_IMAGE_TIER must be core or full" in runtime
    # the absence of the tools in core and their presence in full are checked in the same RUN
    gate = runtime[runtime.index('RUN case "$JHT_IMAGE_TIER" in'):]
    assert "core)" in gate.split("esac")[0] and "full)" in gate.split("esac")[0]
    # the tool gates of before are still there, for the full image
    for gate_text in ("--only playwright_browser", "--only cv_pdf_render", "Xvfb :98 -screen", "--only manual_login_browser"):
        assert gate_text in runtime, gate_text
