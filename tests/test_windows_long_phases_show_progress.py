"""JHT-T318: the long phases of the Windows setup say what they do and that they are alive, and what Podman
says in passing is not an error.

Podman's `machine init` (a system image of several hundred MB), `machine start` and the image pull take
minutes, and the bridge captured their output: a person saw nothing until the end, and then Podman's stderr
(«Getting image source signatures», «your 131072x1 screen size is bogus») as the red error records of
PowerShell, with CategoryInfo and FullyQualifiedErrorId. At a terminal (JHT_MACHINE_OUTPUT=0) the setup now
says what it is doing, prints a line every few seconds while it waits, shows Podman's words as grey notes
and leaves out the terminal-size noise. The desktop app (JHT_MACHINE_OUTPUT=1) keeps its own protocol:
no wait lines, JHT_PULL for the layers.

The functions are read from the real scripts (the harness of test_windows_podman_wsl_branches) and run
against fake podman programs: off Windows under pwsh, on Windows under the shell JHT_TEST_SHELL names.
The wait lines come every second here (JHT_LIVE_WAIT_SECONDS), ten in the product.
"""
from __future__ import annotations

import re

import pytest

from test_windows_podman_wsl_branches import ENABLER, SCRIPTS, _fake, _run

BRIDGE = SCRIPTS / "podman-machine-bridge.ps1"
IMAGE = "ghcr.io/leopu00/jht@sha256:abc"

PODMAN_CASES = """  "machine init "*)
    sleep 3
    echo 'Looking up Podman Machine image at quay.io/podman/machine-os:6.0 to create VM'
    echo 'Getting image source signatures' >&2
    echo 'Copying blob sha256:dddddddddddd4444' >&2
    echo 'your 131072x1 screen size is bogus. expect trouble' >&2
    [ "$FAKE_EXIT" = 0 ] || { echo 'Error: machine init failed' >&2; exit "$FAKE_EXIT"; }
    echo 'Machine init complete' ;;
  "machine start "*)
    sleep 2
    echo 'Starting machine "jht-podman"'
    echo 'your 131072x1 screen size is bogus. expect trouble' >&2
    echo 'Machine "jht-podman" started successfully' ;;
  "machine list --format json") printf '%s' '[{"Name":"jht-podman","Running":true}]' ;;
  "machine ssh jht-podman "*)
    echo 'Created symlink /home/user/.config/systemd/user/default.target.wants/jht.service -> /home/user/.config/systemd/user/jht.service.' >&2
    echo 'daemon-reload done' >&2
    echo 'unit enabled'
    [ "$FAKE_EXIT" = 0 ] || { echo 'Error: ssh command failed' >&2; exit "$FAKE_EXIT"; } ;;
  "--connection jht-podman pull "*)
    echo 'Trying to pull ghcr.io/leopu00/jht@sha256:abc...' >&2
    echo 'Getting image source signatures' >&2
    sleep 2
    echo 'Copying blob sha256:aaaaaaaaaaaa1111' >&2
    echo 'Copying blob sha256:bbbbbbbbbbbb2222' >&2
    sleep 2
    echo 'Copying config sha256:cccccccccccc3333' >&2
    echo 'Writing manifest to image destination' >&2
    [ "$FAKE_EXIT" = 0 ] || { echo 'Error: unauthorized: authentication required' >&2; exit "$FAKE_EXIT"; } ;;"""

INIT_CALL = "Invoke-Checked $env:FAKE_PODMAN 'machine' 'init' '--update-connection=false' 'jht-podman'"
START_CALL = "Invoke-Checked $env:FAKE_PODMAN 'machine' 'start' '--update-connection=false' 'jht-podman'"
CAUGHT = "try { %s } catch { [Console]::Out.WriteLine('CAUGHT ' + $_.Exception.Message) }"
PULL_CALL = "Invoke-PodmanPull -PodmanPath $env:FAKE_PODMAN -Machine 'jht-podman' -Image $env:FAKE_IMAGE"

# what a person must never see of PowerShell's error records
RED_NOISE = ("CategoryInfo", "FullyQualifiedErrorId", "WriteErrorException", "Invoke-JhtPodmanMachine :")


@pytest.fixture(autouse=True)
def require_the_requested_engine(monkeypatch):
    # A missing native shell must fail, never turn these cases into a skip.
    monkeypatch.setenv("JHT_REQUIRE_WINDOWS_SHELLS", "1")


def _case(tmp_path, body: str, *, machine_output: str, exit_code: int = 0):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(parents=True)
    _fake(bin_dir, "podman.exe", PODMAN_CASES)
    result, calls = _run(
        tmp_path, ENABLER, ["Invoke-Checked", "Write-JhtPhase", "Invoke-PodmanPull", "ConvertTo-JhtPullLine"], body,
        {
            "FAKE_PODMAN": str(bin_dir / "podman.exe"), "FAKE_EXIT": str(exit_code), "FAKE_IMAGE": IMAGE,
            "JHT_MACHINE_OUTPUT": machine_output, "JHT_LIVE_WAIT_SECONDS": "1",
            "USERPROFILE": r"C:\Users\someone-private", "USERNAME": "someone-private",
        },
    )
    return result, calls


def _waits(text: str, doing: str) -> list[str]:
    return re.findall(rf"^  \.\.\. still {re.escape(doing)} \((?:\d+:)?\d+:\d\d(?:, [^)]*)?\)\s*$", text, flags=re.MULTILINE)


def _words(result) -> str:
    return result.stdout.replace("\r\n", "\n")


def test_a_person_creating_the_machine_is_told_and_sees_the_wait_move(tmp_path):
    result, _ = _case(tmp_path, INIT_CALL, machine_output="0")
    out = _words(result)
    assert result.returncode == 0, out + result.stderr
    assert re.search(r"^  > Creating the Linux machine for Podman: .*several minutes\.\s*$", out, flags=re.MULTILINE), out
    assert len(_waits(out, "creating the Linux machine")) >= 2, out
    # Podman's own words come as grey notes, indented, after the wait
    assert "    Looking up Podman Machine image at quay.io/podman/machine-os:6.0 to create VM" in out
    assert "    Getting image source signatures" in out
    assert "    Machine init complete" in out


def test_podmans_stderr_is_not_an_error_record_and_the_bogus_screen_size_is_gone(tmp_path):
    for output in ("0", "1"):
        folder = tmp_path / f"output-{output}"
        folder.mkdir()
        result, _ = _case(folder, INIT_CALL, machine_output=output)
        everything = _words(result) + result.stderr
        assert result.returncode == 0, everything
        assert "Getting image source signatures" in everything
        assert "bogus" not in everything and "expect trouble" not in everything, everything
        for noise in RED_NOISE:
            assert noise not in everything, (output, everything)


def test_the_app_keeps_its_own_protocol_no_wait_lines_and_podmans_stdout_as_it_was(tmp_path):
    result, _ = _case(tmp_path, INIT_CALL, machine_output="1")
    out = _words(result)
    assert result.returncode == 0, out + result.stderr
    assert "still " not in out and "Creating the Linux machine" not in out, out
    assert "Looking up Podman Machine image at quay.io/podman/machine-os:6.0 to create VM" in out
    assert "Machine init complete" in out
    # what Podman said on stderr stays on stderr, as plain lines
    assert "podman: Getting image source signatures" in result.stderr.replace("\r\n", "\n")


def test_starting_the_machine_says_so_and_waits_visibly(tmp_path):
    result, _ = _case(tmp_path, START_CALL, machine_output="0")
    out = _words(result)
    assert result.returncode == 0, out + result.stderr
    assert "  > Starting the Linux machine (about a minute)." in out
    assert len(_waits(out, "starting the Linux machine")) >= 1, out
    assert "    Machine \"jht-podman\" started successfully" in out
    assert "bogus" not in out + result.stderr


def test_a_real_failure_keeps_podmans_reason_and_the_exit_code_in_plain_words(tmp_path):
    result, _ = _case(tmp_path, CAUGHT % INIT_CALL, machine_output="0", exit_code=125)
    out = _words(result)
    err = result.stderr.replace("\r\n", "\n")
    assert "CAUGHT Command failed (125):" in out, out + err
    assert "podman: Error: machine init failed" in err, err
    for noise in RED_NOISE:
        assert noise not in out + err, (noise, out + err)
    assert "bogus" not in out + err


def test_the_data_commands_are_not_decorated(tmp_path):
    body = "$rows = Invoke-JhtPodmanMachine -FilePath $env:FAKE_PODMAN -Arguments @('machine', 'list', '--format', 'json'); [Console]::Out.WriteLine('ROWS ' + ($rows -join ''))"
    result, _ = _case(tmp_path, body, machine_output="0")
    out = _words(result)
    assert result.returncode == 0, out + result.stderr
    assert 'ROWS [{"Name":"jht-podman","Running":true}]' in out
    assert "still " not in out and "  > " not in out


def test_the_image_pull_of_a_person_is_told_in_words_and_time_with_the_layers_started(tmp_path):
    result, _ = _case(tmp_path, PULL_CALL, machine_output="0")
    out = _words(result)
    assert result.returncode == 0, out + result.stderr
    assert "  > Downloading the Job Hunter Team runtime image: this can take several minutes." in out
    waits = _waits(out, "downloading the runtime image")
    assert len(waits) >= 2, out
    assert any("2 layers started" in line for line in waits), waits
    # JHT_PULL is the app's, never a person's
    assert "JHT_PULL" not in out, out


def test_the_image_pull_for_the_app_is_the_old_protocol_without_wait_lines(tmp_path):
    result, _ = _case(tmp_path, PULL_CALL, machine_output="1")
    out = _words(result)
    assert result.returncode == 0, out + result.stderr
    assert "still " not in out and "Downloading the Job Hunter Team" not in out, out
    assert "JHT_PULL Copying blob sha256:aaaaaaaaaaaa1111" in out
    assert "JHT_PULL Copying blob sha256:bbbbbbbbbbbb2222" in out


def test_a_failed_pull_still_leaves_its_cause_on_stderr_and_stops_the_wait_line(tmp_path):
    result, _ = _case(tmp_path, CAUGHT % PULL_CALL, machine_output="0", exit_code=1)
    out = _words(result)
    assert "CAUGHT Command failed (1):" in out, out + result.stderr
    assert "podman pull: Error: unauthorized: authentication required" in result.stderr.replace("\r\n", "\n")
    # nothing is printed by the timer once the pull has ended
    after = out.split("CAUGHT", 1)[1]
    assert "still " not in after, after


def test_the_wait_line_is_ascii_and_stops_with_the_command():
    source = BRIDGE.read_text(encoding="utf-8")
    block = source[source.index("JhtLiveWait"):source.index("function ConvertTo-JhtPodmanNativeArguments")]
    assert block.isascii()
    assert "Console.Out.WriteLine" in block and "stopped" in block


SSH_CALL = "$out = @(Invoke-JhtPodmanMachine -FilePath $env:FAKE_PODMAN -Arguments @('machine', 'ssh', 'jht-podman', 'systemctl --user enable jht')); [Console]::Out.WriteLine('OUT ' + ($out -join '|'))"


def test_what_a_command_in_the_machine_says_on_stderr_while_it_succeeds_is_a_grey_note_not_a_red_error(tmp_path):
    # «Created symlink» and «daemon-reload» came out as two red error blocks during the enabler
    result, _ = _case(tmp_path, SSH_CALL, machine_output="0")
    out = _words(result)
    assert result.returncode == 0, out + result.stderr
    assert "OUT unit enabled" in out, "the command's stdout is still handed back as data"
    assert "    Created symlink /home/user/.config/systemd/user/default.target.wants/jht.service" in out
    assert "    daemon-reload done" in out
    for noise in RED_NOISE:
        assert noise not in out + result.stderr, (noise, out + result.stderr)
    assert result.stderr.strip() == ""


def test_the_app_gets_the_same_words_as_plain_lines_on_stderr(tmp_path):
    result, _ = _case(tmp_path, SSH_CALL, machine_output="1")
    err = result.stderr.replace("\r\n", "\n")
    assert result.returncode == 0, _words(result) + err
    assert "podman: Created symlink" in err and "podman: daemon-reload done" in err
    for noise in RED_NOISE:
        assert noise not in _words(result) + err


def test_a_command_in_the_machine_that_fails_keeps_its_stderr_as_an_error_a_caller_can_hold_back(tmp_path):
    shown, _ = _case(tmp_path / "shown", SSH_CALL, machine_output="0", exit_code=3)
    assert "ssh command failed" in shown.stderr, shown.stdout + shown.stderr
    hidden_call = SSH_CALL.replace("'systemctl --user enable jht'))", "'systemctl --user enable jht') 2>$null)")
    hidden, _ = _case(tmp_path / "hidden", hidden_call, machine_output="0", exit_code=3)
    assert "ssh command failed" not in hidden.stderr, hidden.stdout + hidden.stderr
