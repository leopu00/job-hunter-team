"""`curl ... | bash`: after the wizard the installer gives the prompt back by itself.

The installer arrives on bash's stdin. `exec </dev/tty` in maybe_onboard replaced that stdin by the terminal, so bash went
on reading THE REST OF THE SCRIPT from the keyboard: the process stayed alive (state S+, fd 0 on the tty) until Ctrl-D, and
whatever the person typed was run by the installer's own shell (seen on a Linux laptop, installer of 5791bfb2d fetched from
the raw URL). The wizard needs the terminal for itself only: `jht setup </dev/tty`, one command, stdin of the script untouched.

The test is the real thing in miniature: a pseudo-terminal that is the controlling terminal of a bash fed THROUGH A PIPE
with the real maybe_onboard() and some commands after it. The installer must run to its end on its own.
"""
from __future__ import annotations

import os
import re
import select
import signal
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
INSTALLERS = (ROOT / "scripts" / "install.sh", ROOT / "web" / "public" / "install.sh")

pytestmark = pytest.mark.skipif(os.name == "nt", reason="needs a POSIX pseudo-terminal")


def function_source(text: str, name: str) -> str:
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", text, re.M | re.S)
    assert match, f"{name}() not found"
    return match.group(0)


def run_piped_installer(
    tmp_path: Path, installer: Path, *, wait: float = 15.0, wizard_exit: int = 0, strict: bool = False, path_ready: int = 1,
) -> tuple[str, str, int | None]:
    """Feed bash a script through a pipe, inside a pty. Returns (what the fake `jht setup` saw, markers, exit code).

    `wizard_exit` is the code the fake wizard ends with. `strict` runs the script as the real installer does (`set -euo pipefail`,
    `maybe_onboard` as its last command), so the script's own exit code is the one under test."""
    import pty

    source = installer.read_text(encoding="utf-8")
    out = tmp_path / "out.txt"
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir()
    jht = fake_bin / "jht"
    # The wizard's own view of its stdin: it must be the terminal, or `jht setup` could not ask anything.
    jht.write_text(
        '#!/bin/sh\nif [ -t 0 ]; then echo "setup-stdin=tty" >> "%s"; else echo "setup-stdin=not-a-tty" >> "%s"; fi\nexit %d\n'
        % (out, out, wizard_exit)
    )
    jht.chmod(0o755)
    lines = [
        "DRY_RUN=0; PAIRING_TOKEN=''; BIN_DIR='%s'; PATH_READY=%d" % (fake_bin, path_ready),
        'info() { echo "info: $*" >> \'%s\'; }; warn() { echo "warn: $*" >> \'%s\'; }' % (out, out),
        # the sentences are said in the person's language (tx, by installer_person_lang): the real ones
        function_source(source, "installer_person_lang"),
        next(line for line in source.splitlines() if line.startswith("tx() ")),
        function_source(source, "tty_can_be_opened"),
        function_source(source, "maybe_onboard"),
    ]
    if strict:
        lines = ["set -euo pipefail"] + lines + ["maybe_onboard", ""]
    else:
        lines += [
            "maybe_onboard",
            # What a real installer still has to do after the wizard: these lines must be read from the PIPE.
            "echo after-wizard >> '%s'" % out,
            "echo installer-done >> '%s'" % out,
            "",
        ]
    payload = "\n".join(lines)
    inner = tmp_path / "payload.sh"
    inner.write_text(payload, encoding="utf-8")
    pid, master = pty.fork()
    if pid == 0:
        os.environ.update({"PATH": f"{fake_bin}:/usr/bin:/bin", "JHT_SKIP_ONBOARD": "0", "HOME": str(tmp_path)})
        os.execvp("bash", ["bash", "-c", f"cat '{inner}' | bash"])
    deadline = time.time() + wait
    status = None
    seen = b""
    while time.time() < deadline:
        ready, _, _ = select.select([master], [], [], 0.2)
        if ready:
            try:
                seen += os.read(master, 4096)
            except OSError:
                pass
        done, st = os.waitpid(pid, os.WNOHANG)
        if done:
            status = os.waitstatus_to_exitcode(st)
            break
    if status is None:
        os.kill(pid, signal.SIGKILL)
        os.waitpid(pid, 0)
    os.close(master)
    return (out.read_text(encoding="utf-8") if out.exists() else ""), seen.decode("utf-8", "replace"), status


@pytest.mark.parametrize("installer", INSTALLERS, ids=lambda p: str(p.relative_to(ROOT)))
def test_the_piped_installer_runs_to_its_end_without_a_ctrl_d(tmp_path, installer):
    markers, screen, status = run_piped_installer(tmp_path, installer)
    assert status == 0, f"the installer did not end by itself (status {status}); markers: {markers!r}"
    assert markers.splitlines() == ["setup-stdin=tty", "after-wizard", "installer-done"], markers


@pytest.mark.parametrize("installer", INSTALLERS, ids=lambda p: str(p.relative_to(ROOT)))
def test_no_exec_redirect_of_the_installer_stdin_is_left(installer):
    for number, line in enumerate(installer.read_text(encoding="utf-8").splitlines(), 1):
        code = line.split("#", 1)[0]
        assert not re.search(r"\bexec\s*<", code), (installer.name, number, line)


def test_the_two_copies_are_the_same_file_and_the_app_digest_follows():
    import hashlib

    first, second = (p.read_bytes() for p in INSTALLERS)
    assert first == second
    digest = (ROOT / "desktop" / "src-tauri" / "installer.sha256").read_text(encoding="utf-8").strip()
    assert digest == hashlib.sha256(first).hexdigest()


@pytest.mark.parametrize("installer", INSTALLERS, ids=lambda p: str(p.relative_to(ROOT)))
@pytest.mark.parametrize("wizard_exit", (1, 130))
def test_a_wizard_that_stops_is_not_a_finished_install_and_the_installer_says_what_to_do_next(tmp_path, installer, wizard_exit):
    markers, screen, status = run_piped_installer(tmp_path, installer, wizard_exit=wizard_exit, strict=True)
    # the installer ends with the wizard's own non-zero code (it used to swallow it and end with 0)
    assert status == wizard_exit, f"status {status}; markers: {markers!r}"
    lines = markers.splitlines()
    assert lines[0] == "setup-stdin=tty"
    assert any(line.startswith("warn: ") and f"exit code {wizard_exit}" in line and "not set up yet" in line for line in lines), lines
    assert any(line == "info: Next step: run  jht setup  to finish the setup." for line in lines), lines


@pytest.mark.parametrize("installer", INSTALLERS, ids=lambda p: str(p.relative_to(ROOT)))
def test_the_next_step_names_the_full_path_when_jht_is_not_on_the_path_yet(tmp_path, installer):
    markers, _, status = run_piped_installer(tmp_path, installer, wizard_exit=1, strict=True, path_ready=0)
    assert status == 1
    assert any(line.startswith("info: Next step: run  ") and line.endswith("/bin/jht setup  to finish the setup.") for line in markers.splitlines()), markers


@pytest.mark.parametrize("installer", INSTALLERS, ids=lambda p: str(p.relative_to(ROOT)))
def test_a_wizard_that_finishes_leaves_exit_0_and_no_warning(tmp_path, installer):
    markers, _, status = run_piped_installer(tmp_path, installer, wizard_exit=0, strict=True)
    assert status == 0, markers
    assert markers.splitlines() == ["setup-stdin=tty"], markers
