"""The Podman machine started by jht up or by the installer outlives the terminal it was started from.

On a Mac `podman machine start` leaves vfkit and gvproxy running, and they were in the session of the terminal the person ran
`jht up` or the installer from: closing that window (or the end of a `script -q` around the installer) sent them SIGHUP, and
the machine and the team stopped. The wrapper and the installer now start the machine through jht_detached_from_terminal, in a
session of its own with SIGHUP ignored. Here a fake podman leaves a process behind as vfkit does, the function runs at a
terminal, the terminal is closed, and the process must still be alive.
"""

from __future__ import annotations

import os
import re
import select
import signal
import subprocess
import sys
import time
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
WRAPPER = ROOT / "scripts" / "jht-wrapper.sh"
INSTALLER = ROOT / "scripts" / "install.sh"

pytestmark = pytest.mark.skipif(sys.platform == "win32", reason="the Podman machine of a Mac, started from a terminal")


def _function(source: str, name: str) -> str:
    match = re.search(rf"^{name}\(\) \{{\n.*?^\}}\n", source, re.S | re.M)
    assert match, name
    return match.group(0)


def _fake_podman(tmp_path: Path) -> Path:
    fake = tmp_path / "podman"
    # like vfkit: a process left running after `machine start` returns, with its output away from the caller's pipe
    fake.write_text(
        "#!/bin/bash\n"
        'if [ "$1 $2" = "machine start" ] || [ "$1 $2" = "machine init" ]; then\n'
        f'  sleep 300 >/dev/null 2>&1 </dev/null &\n'
        f'  printf "%s\\n" "$!" > {tmp_path}/vm.pid\n'
        "  exit 0\n"
        "fi\n"
        "exit 0\n",
        encoding="utf-8",
    )
    fake.chmod(0o755)
    return fake


def _alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # a zombie is not alive
    state = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(state) and not state.startswith("Z")


def _start_at_a_terminal_then_close_it(tmp_path: Path, script: str) -> int:
    pty = pytest.importorskip("pty")
    pid, fd = pty.fork()
    if pid == 0:
        os.execve("/bin/bash", ["bash", "-c", script], {"PATH": "/usr/bin:/bin", "HOME": str(tmp_path)})
    out = b""
    deadline = time.time() + 30
    while time.time() < deadline and b"STARTED" not in out:
        ready, _, _ = select.select([fd], [], [], 1)
        if ready:
            try:
                out += os.read(fd, 4096)
            except OSError:
                break
    assert b"STARTED" in out, out
    vm = int((tmp_path / "vm.pid").read_text().strip())
    assert _alive(vm)
    # the person closes the window: the terminal goes away and the shell's session gets its hang-up
    os.close(fd)
    try:
        os.kill(pid, signal.SIGHUP)
    except ProcessLookupError:
        pass
    os.waitpid(pid, 0)
    time.sleep(1)
    return vm


def _snippet(source: str, function: str, call: str, fake: Path) -> str:
    return (
        "err() { echo \"$*\" >&2; }\njht_machine_output() { return 1; }\njht_code_prefix() { :; }\njht_say() { :; }\n"
        + _function(source, "jht_detached_from_terminal")
        + (_function(source, function) if function else "")
        + f"PODMAN_MACHINE_NAME=jht-podman\n{call} {fake} && echo STARTED\nsleep 60\n"
    )


def test_the_machine_started_by_jht_up_outlives_the_terminal(tmp_path):
    fake = _fake_podman(tmp_path)
    source = WRAPPER.read_text(encoding="utf-8")
    vm = _start_at_a_terminal_then_close_it(tmp_path, _snippet(source, "start_jht_podman_machine", "start_jht_podman_machine", fake))
    try:
        assert _alive(vm), "the machine's process died with the terminal"
    finally:
        try:
            os.kill(vm, signal.SIGTERM)
        except ProcessLookupError:
            pass


def test_without_the_detachment_the_same_process_dies_with_the_terminal(tmp_path):
    """The counter-proof: the old call, straight from the terminal's session, loses the machine."""
    fake = _fake_podman(tmp_path)
    script = f"{fake} machine start jht-podman && echo STARTED\nsleep 60\n"
    vm = _start_at_a_terminal_then_close_it(tmp_path, script)
    try:
        assert not _alive(vm)
    finally:
        try:
            os.kill(vm, signal.SIGTERM)
        except ProcessLookupError:
            pass


def test_every_start_of_the_machine_goes_through_the_detachment():
    for script in (WRAPPER, INSTALLER):
        source = script.read_text(encoding="utf-8")
        assert "jht_detached_from_terminal() {" in source, script
        calls = [line for line in source.splitlines()
                 if re.search(r'"\$podman_bin" machine (start|init --now)\b', line) and not line.lstrip().startswith("#")]
        assert calls, script
        for line in calls:
            assert "jht_detached_from_terminal \"$podman_bin\" machine" in line, (script.name, line)


def test_the_detached_command_still_gives_its_exit_code_and_its_error(tmp_path):
    source = WRAPPER.read_text(encoding="utf-8")
    fake = tmp_path / "podman"
    fake.write_text("#!/bin/bash\necho 'Error: only one VM can be active at a time' >&2\nexit 125\n", encoding="utf-8")
    fake.chmod(0o755)
    script = _function(source, "jht_detached_from_terminal") + f'out="$(jht_detached_from_terminal {fake} machine start x 2>&1 >/dev/null)"; echo "rc=$? out=$out"\n'
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
    assert "rc=125 out=Error: only one VM can be active at a time" in done.stdout, done
