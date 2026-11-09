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
from collections import Counter
import json
import os
import re
import shlex
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


# A pi that behaves like the real one where the check looks: --version prints the pin, and an
# option it does not know is reported on stderr with an exit status of 0 (so are the real
# 1.5.0's). KNOWN is every option jht_pi_args gives it.
PI_STUB = r"""#!/bin/bash
known=" --tui-mode -nc --append-system-prompt -na -ns --skill --tools --no-mcp -ne --provider --model --thinking --help --version "
for arg in "$@"; do
  case "$arg" in
    --version) echo "{version}"; exit 0 ;;
    -*) case "$known" in *" $arg "*) ;; *) echo "Error: Unknown option: $arg" >&2 ;; esac ;;
  esac
done
exit 0
"""


def _executable(path: Path, text: str) -> None:
    path.write_text(text, encoding="utf-8")
    path.chmod(path.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)


def _launcher_pi_version() -> str:
    text = (ROOT / ".launcher/spawn-lib.sh").read_text(encoding="utf-8")
    return re.search(r'^JHT_PI_VERSION="([^"]+)"', text, re.MULTILINE).group(1)


@pytest.fixture
def image(tmp_path):
    """A fake /app and bin: everything the check looks for, all healthy."""
    app = tmp_path / "app"
    for rel in (".launcher/start-agent.sh", ".launcher/entrypoint.sh", ".launcher/spawn-lib.sh", ".launcher/agent-environment.sh",
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
    for stub in ("npm", "python3", "pip3", "jht", "git", "curl", "rg", "fdfind"):
        _executable(bin_dir / stub, "#!/bin/sh\nexit 0\n")
    _executable(bin_dir / "tmux", TMUX_OK)
    _executable(bin_dir / "pi", PI_STUB.replace("{version}", _launcher_pi_version()))
    return app, bin_dir


def _check(app: Path, bin_dir: Path, pins: str | None = None) -> subprocess.CompletedProcess:
    env = {
        "PATH": str(bin_dir),
        "JHT_APP": str(app),
        "JHT_EXPECTED_PINS": pins if pins is not None else toolchain.expected_pins(),
        "HOME": str(app.parent),
        "TMPDIR": str(app.parent),
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


def test_a_healthy_image_reports_the_pi_the_launcher_demands(image):
    app, bin_dir = image
    result = _check(app, bin_dir)
    assert f"pi: {_launcher_pi_version()}" in result.stdout


def test_a_missing_pi_is_caught(image):
    app, bin_dir = image
    (bin_dir / "pi").unlink()
    result = _check(app, bin_dir)
    assert "pi" in _tags(result)
    assert "pi does not run" in result.stdout


def test_a_pi_of_another_version_than_the_launcher_pin_is_caught(image):
    app, bin_dir = image
    _executable(bin_dir / "pi", PI_STUB.replace("{version}", "1.3.0"))
    result = _check(app, bin_dir)
    assert _tags(result) == {"pi-version"}


def test_a_pi_that_refuses_a_launcher_flag_is_caught(image):
    app, bin_dir = image
    text = (bin_dir / "pi").read_text(encoding="utf-8").replace(" --no-mcp ", " ")
    _executable(bin_dir / "pi", text)
    result = _check(app, bin_dir)
    assert _tags(result) == {"pi-flags"}
    assert "--no-mcp" in result.stdout


def test_a_pi_that_accepts_any_flag_proves_nothing_and_is_caught(image):
    app, bin_dir = image
    _executable(bin_dir / "pi", f"#!/bin/sh\n[ \"$1\" = --version ] && echo {_launcher_pi_version()}\nexit 0\n")
    result = _check(app, bin_dir)
    assert _tags(result) == {"pi-flags-probe"}


@pytest.mark.parametrize("tool, other", [("rg", None), ("fdfind", "fd")])
def test_pi_tools_missing_from_the_path_are_caught(image, tool, other):
    app, bin_dir = image
    (bin_dir / tool).unlink()
    assert _tags(_check(app, bin_dir)) == {"pi-tools"}
    if other:
        _executable(bin_dir / other, "#!/bin/sh\nexit 0\n")
        assert _tags(_check(app, bin_dir)) == set(), "fd is an accepted name for fdfind"


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
    project_doc_max_bytes=*|notice.hide_rate_limit_model_nudge=*|check_for_update_on_startup=*) [ "$loads_config" = yes ] || continue ;;
  esac
  case "$arg" in
    --jht-not-a-flag) [ "$mode" = accepts-anything ] || { echo "error: unexpected argument '$arg' found" >&2; exit 2; } ;;
    --search) [ "$mode" = no-search ] && { echo "error: unexpected argument '--search' found" >&2; exit 2; } ;;
    project_doc_max_bytes=not_a_number) [ "$mode" = loads-anything ] || { echo "Error: failed to load bootstrap configuration" >&2; exit 1; } ;;
    project_doc_max_bytes=*) [ "$mode" = no-budget ] && { echo "Error: unknown key project_doc_max_bytes" >&2; exit 1; } ;;
    notice.hide_rate_limit_model_nudge=*) [ "$mode" = no-notice ] && { echo "Error: unknown key notice.hide_rate_limit_model_nudge" >&2; exit 1; } ;;
    check_for_update_on_startup=*) [ "$mode" = no-update ] && { echo "Error: unknown key check_for_update_on_startup" >&2; exit 1; } ;;
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
        ("no-notice", "config"),
        ("no-update", "config"),
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


@pytest.mark.parametrize(
    ("role", "role_models", "effort", "search"),
    [("scout", None, "high", True), ("scorer", None, "high", False),
     ("scorer", {"scorer": {"effort": "medium"}}, "medium", False)],
)
def test_the_flags_checked_are_the_ones_the_launcher_passes(tmp_path, role, role_models, effort, search):
    """Exercise the actual role/config/launcher/builder chain against the image's independent contract."""
    from test_agent_model_override import _command, _spawn_command

    command = shlex.split(_command(_spawn_command(tmp_path, role, role_models)))
    assert command[0] == "codex"
    flags, overrides = [], []
    index = 1
    while index < len(command):
        value = command[index]
        if value in ("--model", "-c"):
            assert index + 1 < len(command) and command[index + 1]
            if value == "--model":
                assert not command[index + 1].startswith("-")
            else:
                overrides.append(command[index + 1])
            index += 2
        else:
            flags.append(value)
            index += 1
    assert command.count("--model") == 1
    expected = [value.replace("model_reasoning_effort=high", f"model_reasoning_effort={effort}")
                for value in toolchain.CODEX_OVERRIDES]
    assert Counter(overrides) == Counter(expected)
    assert "project_doc_max_bytes=131072" in overrides
    assert f"model_reasoning_effort={effort}" in overrides
    expected_flags = [flag for flag in toolchain.CODEX_FLAGS if search or flag != "--search"]
    assert Counter(flags) == Counter(expected_flags)
