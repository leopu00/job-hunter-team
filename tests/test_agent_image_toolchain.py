"""The image check of scripts/ci/agent_image_toolchain.py catches what it claims.

docker.yml runs it on the image just built. Here its in-container part runs
on the host against a fake /app (the real launcher scripts and provider pins,
copied) and a PATH of stubs, and every breakage it exists for must turn its
own tag red: no tmux (the launcher proof of 08/10, rc=127), a tmux that
cannot open a session, a launcher that is not executable or does not parse,
a missing installer, and pins that differ from this checkout or cannot be
read (the product would fall back to `latest`).
"""

import importlib.util
import json
import os
import re
from pathlib import Path
import shutil
import stat
import subprocess

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "ci" / "agent_image_toolchain.py"

spec = importlib.util.spec_from_file_location("agent_image_toolchain", SCRIPT)
toolchain = importlib.util.module_from_spec(spec)
spec.loader.exec_module(toolchain)

pytestmark = pytest.mark.skipif(
    os.name == "nt" or not shutil.which("node") or not shutil.which("bash"),
    reason="needs a POSIX sh, bash and node",
)

TMUX_OK = """#!/bin/sh
case "$*" in
  -V) echo "tmux 3.3a" ;;
  *new-session*|*has-session*|*kill-server*) exit 0 ;;
  *) exit 1 ;;
esac
"""

# What a tmux with a missing library looks like: the binary answers -V, the
# server never comes up.
TMUX_NO_SERVER = """#!/bin/sh
case "$*" in
  -V) echo "tmux 3.3a" ;;
  *kill-server*) exit 1 ;;
  *) echo "tmux: error while loading shared libraries" >&2; exit 127 ;;
esac
"""


def _executable(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


@pytest.fixture
def image(tmp_path):
    """A fake /app and bin: everything the check looks for, all healthy."""
    app = tmp_path / "app"
    for rel in (".launcher/start-agent.sh", ".launcher/entrypoint.sh", ".launcher/spawn-lib.sh",
                "shared/runtime/provider-pins.js", "shared/config/provider-versions.json"):
        (app / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / rel, app / rel)
    for rel in (".launcher/start-agent.sh", ".launcher/entrypoint.sh"):
        (app / rel).chmod(0o755)
    (app / ".launcher/spawn-lib.sh").chmod(0o644)

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for real in ("bash", "node"):
        (bin_dir / real).symlink_to(shutil.which(real))
    for stub in ("npm", "python3", "pip3", "jht", "git", "curl"):
        _executable(bin_dir / stub, "#!/bin/sh\nexit 0\n")
    _executable(bin_dir / "tmux", TMUX_OK)
    return app, bin_dir


def _check(app: Path, bin_dir: Path, pins: str | None = None) -> subprocess.CompletedProcess:
    env = {
        "PATH": str(bin_dir),
        "JHT_APP": str(app),
        "JHT_EXPECTED_PINS": pins if pins is not None else toolchain.expected_pins(),
        "HOME": str(app.parent),
    }
    return subprocess.run(["/bin/sh", "-c", toolchain.INSIDE], capture_output=True, text=True, env=env, timeout=60)


def _tags(result: subprocess.CompletedProcess) -> set[str]:
    return {line.split("]")[0][len("FAIL ["):] for line in result.stdout.splitlines() if line.startswith("FAIL [")}


def test_a_healthy_image_passes_with_the_pins_of_this_checkout(image):
    app, bin_dir = image
    result = _check(app, bin_dir)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "checks done: 0 failed" in result.stdout
    assert "tmux: tmux 3.3a" in result.stdout


def test_the_expected_pins_are_the_three_of_the_manifest():
    pins = json.loads((ROOT / "shared/config/provider-versions.json").read_text(encoding="utf-8"))["pins"]
    assert toolchain.expected_pins().split() == [
        f"{target}={pins[target]['version']}" for target in ("claude", "codex", "kimi")
    ]


def test_no_tmux_is_caught(image):
    app, bin_dir = image
    (bin_dir / "tmux").unlink()
    result = _check(app, bin_dir)
    assert result.returncode != 0
    assert _tags(result) == {"tmux"}


def test_a_tmux_that_cannot_open_a_session_is_caught(image):
    app, bin_dir = image
    _executable(bin_dir / "tmux", TMUX_NO_SERVER)
    result = _check(app, bin_dir)
    assert result.returncode != 0
    assert _tags(result) == {"tmux-session"}


def test_a_launcher_that_is_not_executable_is_caught(image):
    app, bin_dir = image
    (app / ".launcher/start-agent.sh").chmod(0o644)
    result = _check(app, bin_dir)
    assert _tags(result) == {"launcher"}


def test_a_missing_sourced_library_is_caught(image):
    app, bin_dir = image
    (app / ".launcher/spawn-lib.sh").unlink()
    result = _check(app, bin_dir)
    assert _tags(result) == {"launcher"}


def test_a_launcher_that_does_not_parse_is_caught(image):
    app, bin_dir = image
    with (app / ".launcher/start-agent.sh").open("a", encoding="utf-8") as handle:
        handle.write("\nif then fi (\n")
    result = _check(app, bin_dir)
    assert _tags(result) == {"launcher-syntax"}


@pytest.mark.parametrize("tool", ["npm", "pip3", "jht"])
def test_a_missing_installer_is_caught(image, tool):
    app, bin_dir = image
    (bin_dir / tool).unlink()
    result = _check(app, bin_dir)
    assert _tags(result) == {"tool"}
    assert f"{tool} is not on PATH" in result.stdout


def test_pins_that_differ_from_this_checkout_are_caught(image):
    app, bin_dir = image
    result = _check(app, bin_dir, pins=toolchain.expected_pins().replace("codex=", "codex=9"))
    assert _tags(result) == {"pin"}


def test_an_unreadable_pin_manifest_is_caught(image):
    app, bin_dir = image
    (app / "shared/config/provider-versions.json").write_text("{", encoding="utf-8")
    result = _check(app, bin_dir)
    assert _tags(result) == {"pin"}


# ── --install codex: the pinned CLI and the flags of the launcher ────────────
#
# A fake codex that behaves like the real one (clap refuses an unknown flag
# before --help; `features list` loads the -c overrides and refuses a value it
# cannot parse), with one behaviour broken per test through FAKE_CODEX.
FAKE_CODEX = r"""#!/bin/sh
mode="${FAKE_CODEX:-real}"
case "$*" in
  --version) echo "codex-cli 0.147.0"; exit 0 ;;
esac
# Like clap: flags are checked always, -c values only when the config loads.
loads_config=no
case " $* " in *" features list "*) loads_config=yes ;; esac
for arg in "$@"; do
  case "$arg" in
    project_doc_max_bytes=*) [ "$loads_config" = yes ] || continue ;;
  esac
  case "$arg" in
    --jht-not-a-flag) [ "$mode" = accepts-anything ] || { echo "error: unexpected argument '$arg' found" >&2; exit 2; } ;;
    --search) [ "$mode" = no-search ] && { echo "error: unexpected argument '--search' found" >&2; exit 2; } ;;
    project_doc_max_bytes=not_a_number) [ "$mode" = loads-anything ] || { echo "Error: failed to load bootstrap configuration" >&2; exit 1; } ;;
    project_doc_max_bytes=*) [ "$mode" = no-budget ] && { echo "Error: unknown key project_doc_max_bytes" >&2; exit 1; } ;;
  esac
done
exit 0
"""


@pytest.fixture
def installer(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for tool in ("sh", "mktemp", "tail"):
        (bin_dir / tool).symlink_to(shutil.which(tool))
    _executable(bin_dir / "codex", FAKE_CODEX)
    _executable(bin_dir / "jht", "#!/bin/sh\n[ \"$*\" = 'providers update codex' ] || exit 9\nexit \"${FAKE_JHT_EXIT:-0}\"\n")
    return bin_dir


def _install(bin_dir: Path, **env: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["/bin/sh", "-c", toolchain.INSTALL, "sh", "codex", *toolchain.CODEX_OVERRIDES, "--", *toolchain.CODEX_FLAGS],
        capture_output=True, text=True, timeout=60,
        env={"PATH": str(bin_dir), "TMPDIR": str(bin_dir.parent), **env},
    )


def test_a_cli_that_takes_the_launcher_flags_passes(installer):
    result = _install(installer)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "VERSION: codex-cli 0.147.0" in result.stdout
    assert _tags(result) == set()


@pytest.mark.parametrize(
    ("mode", "tag"),
    [
        ("no-search", "flags"),
        ("no-budget", "config"),
        ("accepts-anything", "flags-probe"),
        ("loads-anything", "config-probe"),
    ],
)
def test_a_refused_flag_or_a_probe_that_proves_nothing_is_caught(installer, mode, tag):
    result = _install(installer, FAKE_CODEX=mode)
    assert result.returncode != 0
    assert _tags(result) == {tag}


def test_a_failed_install_is_caught(installer):
    result = _install(installer, FAKE_JHT_EXIT="1")
    assert result.returncode != 0
    assert _tags(result) == {"install"}


def test_the_flags_checked_are_the_ones_the_launcher_passes():
    """Once e104f0e10 and 7f891f9d3 are merged, the launcher and the check agree."""
    spawn_lib = (ROOT / ".launcher" / "spawn-lib.sh").read_text(encoding="utf-8")
    start_agent = (ROOT / ".launcher" / "start-agent.sh").read_text(encoding="utf-8")
    budget = re.search(r"^JHT_CODEX_PROJECT_DOC_MAX_BYTES=(\d+)$", spawn_lib, re.MULTILINE)
    if budget:
        assert f"project_doc_max_bytes={budget.group(1)}" in toolchain.CODEX_OVERRIDES
    if 'CLI_ARGS="$CLI_ARGS --search"' in start_agent:
        assert "--search" in toolchain.CODEX_FLAGS
    assert 'CLI_ARGS="--yolo ' in start_agent
    assert "-c model_reasoning_effort=$effort" in start_agent
