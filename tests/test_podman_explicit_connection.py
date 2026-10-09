"""Every Podman call of the product names the JHT machine.

Without --connection (or CONTAINER_CONNECTION), Podman acts on its DEFAULT
connection. On a computer with two machines (ours next to another product's,
or podman-machine-default, which sees the whole of /Users on a Mac) a call
without it reports on, and acts on, the wrong machine.

The desktop's own engine check is covered by the Rust tests in podman.rs.
"""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# A direct call: "$podman_bin" where a command starts (line start, $( , if,
# !, && or ||), followed by its first argument. Passed as an argument to a
# function or to --podman-path it is not a call.
DIRECT = re.compile(
    r'(?:^|\$\(|\bif\s+|!\s+|&&\s+|\|\|\s+)\s*"\$podman_bin"\s+(?P<rest>\S[^\n]*)')


def unnamed_calls(text: str) -> tuple:
    lines = text.splitlines()
    found, total = [], 0
    for index, line in enumerate(lines):
        if line.lstrip().startswith("#"):
            continue
        for match in DIRECT.finditer(line):
            rest = match.group("rest")
            if rest.startswith(("\\", '"$compose_bin"')) or not re.match(r"[a-z-]", rest):
                continue
            total += 1
            ahead = " ".join(lines[index:index + 4])
            if rest.startswith('--connection "$PODMAN_MACHINE_NAME"') or rest.startswith("--version"):
                continue
            if rest.startswith("system connection "):
                continue  # list/restore of the user's default, never a container call
            if rest.startswith("machine ") and '"$PODMAN_MACHINE_NAME"' in ahead:
                continue  # machine subcommands take the machine by name
            found.append((index + 1, line.strip()))
    return found, total


def test_every_direct_podman_call_in_the_wrapper_names_the_jht_machine():
    found, total = unnamed_calls((ROOT / "scripts/jht-wrapper.sh").read_text(encoding="utf-8"))
    assert total >= 15, f"only {total} direct Podman calls seen: the search is broken"
    assert found == []


def test_the_scan_catches_a_call_on_the_default_connection():
    found, total = unnamed_calls(
        '  ids="$("$podman_bin" volume ls -q)"\n'
        '  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" volume ls -q\n'
        '  "$podman_bin" machine start --update-connection=false\n'
        '  podman_project_volume_name "$podman_bin" jht-broker-state\n')
    assert total == 3
    assert [line for line, _ in found] == [1, 3]


def test_compose_and_the_macos_docker_shim_carry_the_connection():
    wrapper = (ROOT / "scripts/jht-wrapper.sh").read_text(encoding="utf-8")
    assert 'CONTAINER_CONNECTION="$PODMAN_MACHINE_NAME"' in wrapper
    installer = (ROOT / "scripts/install.sh").read_text(encoding="utf-8")
    assert "printf \"exec '%s' --connection '%s' \\\"\\$@\\\"\\n\" \"$podman_bin\" \"$PODMAN_MACHINE_NAME\"" in installer


def test_the_windows_docker_shim_falls_back_to_the_jht_connection():
    enabler = (ROOT / "scripts/enable-podman-windows-runtime.ps1").read_text(encoding="utf-8")
    shim = enabler[enabler.index("function New-DockerShim"):enabler.index("\n}\n", enabler.index("function New-DockerShim"))]
    assert "[string]$MachineName = 'jht-podman'" in shim
    assert 'private const string MachineConnection = "$MachineName";' in shim
    assert 'GetEnvironmentVariable("CONTAINER_CONNECTION")' in shim
    assert 'start.EnvironmentVariables["CONTAINER_CONNECTION"] = MachineConnection;' in shim
    assert "New-DockerShim -Destination $shim -PodmanPath $Podman -MachineName $MachineName" in enabler
