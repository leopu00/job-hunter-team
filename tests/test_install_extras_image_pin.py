"""The image of the tools that come on request, pinned by the test channel: `install.sh ... --extras-image-digest sha256:<64>`.

The installer does not pull it. It writes the canonical ref in a host runtime file (`runtime-extras-image`) attested in an integrity file of
its own (`.runtime-extras-integrity`, never the main manifest: the app compares the exact keys of that one), and the host wrapper reads it
back, after the same checks as the main image pin, for `jht screen on` and the other tools. Production installs have none.
"""
from __future__ import annotations

import hashlib
import os
import re
import shlex
import subprocess
from pathlib import Path

import pytest

from test_install_test_channel import DIGEST, INSTALLER, OTHER_DIGEST, PINNED, ROOT, SHA, TAG, RAW, _channel, _env, _fake_bin, _install

EXTRAS = "sha256:" + "e" * 64
EXTRAS_REF = f"ghcr.io/leopu00/jht@{EXTRAS}"
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
FUNCTIONS = ("runtime_stat", "runtime_sha256", "runtime_node_safe", "runtime_extras_pin_value", "runtime_extras_pin_trusted", "runtime_extras_digest")


def _extras_args(digest: str = EXTRAS) -> list[str]:
    return ["--extras-image-digest", digest]


def _installed(tmp_path: Path, *extra: str) -> tuple[dict[str, str], Path]:
    env = _env(tmp_path, _fake_bin(tmp_path, f"{PINNED}\n"))
    done = _install(env, *_channel(), *extra)
    assert done.returncode == 0, done.stdout + done.stderr
    (tmp_path / "docker.log").unlink()
    return env, Path(env["JHT_RUNTIME_DIR"])


@pytest.mark.parametrize(
    "args",
    [
        _extras_args(),  # no test channel at all
        _channel() + _extras_args("sha256:short"),
        _channel() + _extras_args("sha256:" + "E" * 64),
        _channel() + _extras_args("ghcr.io/leopu00/jht@" + EXTRAS),
    ],
)
def test_the_option_is_refused_before_any_io_outside_the_test_channel_or_when_malformed(tmp_path, args):
    env = _env(tmp_path, _fake_bin(tmp_path, f"{PINNED}\n"))
    done = subprocess.run(["bash", str(INSTALLER), *args], env=env, capture_output=True, text=True, timeout=30)
    assert done.returncode == 2, done.stdout + done.stderr
    assert not (tmp_path / "curl.log").exists() and not (tmp_path / "docker.log").exists()
    assert not Path(env["JHT_RUNTIME_DIR"]).exists()


def test_the_channel_pins_the_extras_ref_attests_it_apart_and_does_not_pull_it(tmp_path):
    env, runtime = _installed(tmp_path, *_extras_args())
    pin = runtime / "runtime-extras-image"
    assert pin.read_text(encoding="utf-8") == EXTRAS_REF + "\n" and pin.stat().st_mode & 0o777 == 0o600
    integrity = runtime / ".runtime-extras-integrity"
    assert integrity.read_text(encoding="utf-8") == f"runtime-extras-image={hashlib.sha256(pin.read_bytes()).hexdigest()}\n"
    assert integrity.stat().st_mode & 0o777 == 0o600
    # the main manifest keeps its keys: the app compares them exactly
    keys = {line.split("=", 1)[0] for line in (runtime / ".runtime-integrity").read_text(encoding="utf-8").splitlines()}
    assert not any("extras" in key for key in keys)
    assert "runtime-image" in keys
    # the extras image comes only when a tool is asked for
    assert not (tmp_path / "docker.log").exists() or EXTRAS not in (tmp_path / "docker.log").read_text(encoding="utf-8")


def test_a_channel_install_without_the_option_has_no_extras_pin(tmp_path):
    _, runtime = _installed(tmp_path)
    assert not (runtime / "runtime-extras-image").exists() and not (runtime / ".runtime-extras-integrity").exists()


def test_a_reinstall_without_the_option_drops_the_extras_pin_and_a_production_install_too(tmp_path):
    env, runtime = _installed(tmp_path, *_extras_args())
    done = _install(env, *_channel())
    assert done.returncode == 0, done.stdout + done.stderr
    assert not (runtime / "runtime-extras-image").exists() and not (runtime / ".runtime-extras-integrity").exists()
    again = _install(env, *_channel(), *_extras_args(OTHER_DIGEST))
    assert again.returncode == 0 and (runtime / "runtime-extras-image").read_text(encoding="utf-8") == f"ghcr.io/leopu00/jht@{OTHER_DIGEST}\n"
    prod = _install({**env, "JHT_RAW_BASE": RAW})
    assert prod.returncode == 0, prod.stdout + prod.stderr
    assert not (runtime / "runtime-extras-image").exists() and not (runtime / ".runtime-extras-integrity").exists()


def _functions() -> str:
    text = WRAPPER.read_text(encoding="utf-8")
    out = []
    for name in FUNCTIONS:
        match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.S | re.M)
        assert match, name
        out.append(match.group(0))
    return "\n".join(out)


def _digest(runtime: Path, constant: str = "") -> subprocess.CompletedProcess:
    script = (
        f'RUNTIME_DIR={shlex.quote(str(runtime))}\nRUNTIME_IMAGE_PIN="$RUNTIME_DIR/runtime-image"\n'
        'RUNTIME_EXTRAS_PIN="$RUNTIME_DIR/runtime-extras-image"\nRUNTIME_EXTRAS_INTEGRITY="$RUNTIME_DIR/.runtime-extras-integrity"\n'
        f'HOST_KERNEL="$(uname -s)"\nHOST_UID="$(id -u)"\nEXTRAS_IMAGE_DIGEST="{constant}"\n' + _functions() + "\nruntime_extras_digest\n"
    )
    return subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30, env={**os.environ, "LC_ALL": "C"})


def test_the_wrapper_reads_the_attested_pin_and_it_wins_over_the_constant_of_the_release(tmp_path):
    _, runtime = _installed(tmp_path, *_extras_args())
    assert _digest(runtime).stdout == EXTRAS + "\n"
    assert _digest(runtime, constant=OTHER_DIGEST).stdout == EXTRAS + "\n"


def test_without_a_pin_the_constant_of_the_release_is_what_counts(tmp_path):
    _, runtime = _installed(tmp_path)
    assert _digest(runtime).stdout == "\n"
    assert _digest(runtime, constant=OTHER_DIGEST).stdout == OTHER_DIGEST + "\n"


@pytest.mark.parametrize("tamper", ["content", "pin_removed", "integrity_removed", "symlink", "noncanonical", "two_lines", "main_pin_removed"])
def test_a_pin_that_is_not_the_one_the_installer_wrote_is_refused_never_replaced_by_the_constant(tmp_path, tamper):
    _, runtime = _installed(tmp_path, *_extras_args())
    pin, integrity = runtime / "runtime-extras-image", runtime / ".runtime-extras-integrity"
    if tamper == "content":
        pin.write_text(f"ghcr.io/leopu00/jht@{OTHER_DIGEST}\n", encoding="utf-8")
    elif tamper == "pin_removed":
        pin.unlink()
    elif tamper == "integrity_removed":
        integrity.unlink()
    elif tamper == "symlink":
        target = tmp_path / "elsewhere"
        target.write_text(pin.read_text(encoding="utf-8"), encoding="utf-8")
        pin.unlink()
        pin.symlink_to(target)
    elif tamper == "noncanonical":
        pin.write_text("ghcr.io/someone/jht:latest\n", encoding="utf-8")
        integrity.write_text(f"runtime-extras-image={hashlib.sha256(pin.read_bytes()).hexdigest()}\n", encoding="utf-8")
    elif tamper == "two_lines":
        pin.write_text(EXTRAS_REF + "\n" + EXTRAS_REF + "\n", encoding="utf-8")
        integrity.write_text(f"runtime-extras-image={hashlib.sha256(pin.read_bytes()).hexdigest()}\n", encoding="utf-8")
    else:
        (runtime / "runtime-image").unlink()
    done = _digest(runtime, constant=OTHER_DIGEST)
    assert done.returncode != 0 and done.stdout == ""


def test_the_runtime_check_of_the_wrapper_stops_on_a_pin_it_cannot_attest(tmp_path):
    env, runtime = _installed(tmp_path, *_extras_args())
    wrapper = Path(env["JHT_BIN_DIR"]) / "jht"
    (runtime / "runtime-extras-image").write_text(f"ghcr.io/leopu00/jht@{OTHER_DIGEST}\n", encoding="utf-8")
    done = subprocess.run(["bash", str(wrapper), "up"], env={**env, "JHT_WRAPPER_PATH": str(wrapper)}, capture_output=True, text=True, timeout=30)
    assert done.returncode != 0
    log = tmp_path / "docker.log"
    assert not log.exists() or " compose " not in log.read_text(encoding="utf-8")


def test_the_installer_documents_the_option():
    text = INSTALLER.read_text(encoding="utf-8")
    assert "--extras-image-digest sha256:<64>" in text and "stage_runtime_extras_pin" in text
