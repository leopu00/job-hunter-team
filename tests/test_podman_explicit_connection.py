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


FUNCTION = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*\(\) \{")
NATIVE_GUARD = '[ "$PODMAN_RUNTIME_MODE" = "native" ] || return 0'


def _native_function(lines: list, index: int) -> bool:
    """The call sits in a function that returns first unless the mode is native."""
    start = next(i for i in range(index, -1, -1) if FUNCTION.match(lines[i]))
    return NATIVE_GUARD in [line.strip() for line in lines[start + 1:index]]


LINUX_BRANCH = 'if [ "$HOST_KERNEL" = "Linux" ]; then'


def _linux_only(lines: list, index: int) -> bool:
    """The call sits inside the branch that runs only on Linux (the enclosing blocks, walking
    outwards by indentation, include `if [ "$HOST_KERNEL" = "Linux" ]`) and in a function."""
    indent = len(lines[index]) - len(lines[index].lstrip())
    for i in range(index - 1, -1, -1):
        line = lines[i]
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        here = len(line) - len(line.lstrip())
        if FUNCTION.match(line):
            return False
        if here < indent:
            if line.strip() == LINUX_BRANCH:
                return True
            indent = here
    return False


def _in_function(name: str):
    """The call sits in the named function (the nearest function header above it)."""
    def proof(lines: list, index: int) -> bool:
        start = next((i for i in range(index, -1, -1) if FUNCTION.match(lines[i])), None)
        return start is not None and lines[start].startswith(f"{name}() {{")
    return proof


NATIVE_UNINSTALL_WHY = ("the uninstall of rootless Podman on Linux, where there is no machine: uninstall_machine calls it only "
                        "on Linux with Podman chosen, after unsetting CONTAINER_HOST and CONTAINER_CONNECTION")


# The calls that name no JHT machine on purpose, each by name: what the call
# starts with, the proof it must carry, and why. Any other call without the
# machine is still a failure, and an exception that no call uses fails too.
NAMED_EXCEPTIONS = {
    "machine-list": (
        "machine list ",
        lambda lines, index: True,
        "it lists the machines by name, and a list has no connection",
    ),
    "uninstall-machine-rm": (
        'machine rm --force "$name"',
        lambda lines, index: True,
        "the uninstall removes the machine it is told to by name (the standard one, or the one the installer created), "
        "and a `machine` command takes the machine as its argument: it has no --connection",
    ),
    "linux-unshare": (
        "unshare rm -rf -- ",
        _linux_only,
        "`podman unshare` enters the user namespace of the local Podman and has no remote form: "
        "it exists only for native Podman on Linux (the Linux branch), where there is no machine",
    ),
    "native-uninstall-containers": ("ps -aq --filter ", _in_function("uninstall_podman_native_ids"), NATIVE_UNINSTALL_WHY),
    "native-uninstall-network": ("network ls -q --filter ", _in_function("uninstall_podman_native_ids"), NATIVE_UNINSTALL_WHY),
    "native-uninstall-volumes": ("volume ls -q --filter ", _in_function("uninstall_podman_native_ids"), NATIVE_UNINSTALL_WHY),
    "native-rootless-probe": (
        "info --format '{{.Host.Security.Rootless}} {{.Host.ServiceIsRemote}}'",
        _native_function,
        "native Podman on Linux: there is no JHT machine to name",
    ),
}


def _statement(lines: list, index: int) -> str:
    """The call with all its continuation lines (each one ending in a backslash): the machine's name
    comes last, after however many options the call has."""
    end = index
    while end + 1 < len(lines) and lines[end].rstrip().endswith("\\"):
        end += 1
    return " ".join(lines[index:end + 1])


def unnamed_calls(text: str) -> tuple:
    lines = text.splitlines()
    found, total, used = [], 0, []
    for index, line in enumerate(lines):
        if line.lstrip().startswith("#"):
            continue
        for match in DIRECT.finditer(line):
            rest = match.group("rest")
            if rest.startswith(("\\", '"$compose_bin"')) or not re.match(r"[a-z-]", rest):
                continue
            total += 1
            ahead = _statement(lines, index)
            if rest.startswith('--connection "$PODMAN_MACHINE_NAME"') or rest.startswith("--version"):
                continue
            if rest.startswith("system connection "):
                continue  # list/restore of the user's default, never a container call
            if rest.startswith("machine ") and '"$PODMAN_MACHINE_NAME"' in ahead:
                continue  # machine subcommands take the machine by name
            named = [
                name for name, (prefix, proof, _) in NAMED_EXCEPTIONS.items()
                if rest.startswith(prefix) and proof(lines, index)
            ]
            if named:
                used.extend(named)
                continue
            found.append((index + 1, line.strip()))
    return found, total, used


def test_every_direct_podman_call_in_the_wrapper_names_the_jht_machine():
    found, total, used = unnamed_calls((ROOT / "scripts/jht-wrapper.sh").read_text(encoding="utf-8"))
    assert total >= 15, f"only {total} direct Podman calls seen: the search is broken"
    assert found == []
    # Every named exception is used exactly once: none is stale, none hides two calls.
    assert sorted(used) == sorted(NAMED_EXCEPTIONS)


def test_the_scan_catches_a_call_on_the_default_connection():
    found, total, _ = unnamed_calls(
        '  ids="$("$podman_bin" volume ls -q)"\n'
        '  "$podman_bin" --connection "$PODMAN_MACHINE_NAME" volume ls -q\n'
        '  "$podman_bin" machine start --update-connection=false\n'
        '  podman_project_volume_name "$podman_bin" jht-broker-state\n')
    assert total == 3
    assert [line for line, _ in found] == [1, 3]


def test_a_named_exception_holds_only_where_its_proof_holds():
    found, total, used = unnamed_calls(
        'probe() {\n'
        '  state="$("$podman_bin" info --format \'{{.Host.Security.Rootless}} {{.Host.ServiceIsRemote}}\')"\n'
        '}\n'
        'native() {\n'
        '  [ "$PODMAN_RUNTIME_MODE" = "native" ] || return 0\n'
        '  state="$("$podman_bin" info --format \'{{.Host.Security.Rootless}} {{.Host.ServiceIsRemote}}\')"\n'
        '}\n'
        '  if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then\n'
        '    true\n'
        '  fi\n'
        '  "$podman_bin" info >/dev/null 2>&1\n'
        '  if [ "$PODMAN_RUNTIME_MODE" = "machine" ]; then\n'
        '    true\n'
        '  else\n'
        '    "$podman_bin" info >/dev/null 2>&1\n'
        '  fi\n'
        '  "$podman_bin" machine rm --force "$OTHER_MACHINE"\n'
        '  "$podman_bin" machine rm --force "$name"\n')
    assert total == 6
    # Outside the native guard, a bare info anywhere (the native compose check
    # is the rootless probe now, not an exception), and a machine named by any
    # other variable: all still fail.
    assert [line for line, _ in found] == [2, 11, 15, 17]
    assert sorted(used) == ["native-rootless-probe", "uninstall-machine-rm"]


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
    assert 'Environment.SetEnvironmentVariable("CONTAINER_CONNECTION", MachineConnection);' in shim
    # The pwsh-compiled shim never reached podman through StartInfo's environment.
    assert "EnvironmentVariables" not in shim
    assert "New-DockerShim -Destination $shim -PodmanPath $Podman -MachineName $MachineName" in enabler


def test_a_call_with_many_options_names_the_machine_after_them():
    # machine init has the size and the two folders before the name: the whole statement counts
    call = (
        '    if ! "$podman_bin" machine init --now --update-connection=false \\\n'
        '      --cpus "$C" \\\n'
        '      --memory "$M" \\\n'
        '      --disk-size "$D" \\\n'
        '      --volume "$A:$A" \\\n'
        '      --volume "$B:$B" \\\n'
        '      "$PODMAN_MACHINE_NAME"; then\n'
    )
    assert unnamed_calls(call)[0] == []
    # and without the name it is still found, however long
    assert len(unnamed_calls(call.replace('      "$PODMAN_MACHINE_NAME"; then', '      true; then'))[0]) == 1


def test_the_unshare_exception_holds_only_in_the_linux_branch():
    inside = (
        'purge() {\n'
        '  if [ "$HOST_KERNEL" = "Linux" ]; then\n'
        '    if [ "$selection" = "podman" ]; then\n'
        '      "$podman_bin" unshare rm -rf -- "$dir" >/dev/null 2>&1 || true\n'
        '    fi\n'
        '  fi\n'
        '}\n')
    found, total, used = unnamed_calls(inside)
    assert (found, total, used) == ([], 1, ["linux-unshare"])
    after_fi = inside.replace('    fi\n  fi\n', '    fi\n  fi\n  "$podman_bin" unshare rm -rf -- "$dir"\n')
    assert [line for line, _ in unnamed_calls(after_fi)[0]] == [7]
    other_kernel = inside.replace('"Linux"', '"Darwin"')
    assert [line for line, _ in unnamed_calls(other_kernel)[0]] == [4]
    other_function = (
        'other() {\n  :\n}\n'
        '  if [ "$HOST_KERNEL" = "Linux" ]; then\n'
        'second() {\n'
        '  "$podman_bin" unshare rm -rf -- "$dir"\n'
        '}\n')
    assert [line for line, _ in unnamed_calls(other_function)[0]] == [6]
