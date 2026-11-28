"""The real POSIX installer explains PATH in the shell that launched it.

Reuse the fake provisioning server, its real Rust transport payload and its
source acquisition. No network, engine or privileged installation is used.
"""
import hashlib
import os
import re
import shlex
import subprocess
from pathlib import Path

import pytest

from test_vps_provisioning_sequence import Server, install, source  # noqa: F401

ROOT = Path(__file__).resolve().parents[1]
INSTALLERS = [ROOT / "scripts/install.sh", ROOT / "web/public/install.sh"]
PREFIX = "This terminal does not know jht yet. Paste this line here:"
NEXT = " && jht team chat assistente"
pytestmark = pytest.mark.skipif(os.name == "nt", reason="POSIX installer; native Windows uses install.ps1")


@pytest.fixture
def path_server(tmp_path):
    assert os.geteuid() != 0, "the fake fresh account needs a non-root test process"
    server = Server(tmp_path)
    server.pin()
    return server


def output(done):
    assert done.returncode == 0, done.stdout.decode() + done.stderr.decode()
    return re.sub(r"\x1b\[[0-9;]*m", "", done.stdout.decode())


def printed_export(text):
    """The export of the box the installer prints LAST (JHT-T352): one line to paste, which also opens the
    chat with the Assistente, and nothing printed after the box."""
    lines = [line.strip() for line in text.rstrip().splitlines()]
    assert lines.count(PREFIX) == 1, text
    box = lines[lines.index(PREFIX) - 1:]
    assert set(box[0]) == {"═"} and set(box[-1]) == {"═"}, "the box is the last thing printed"
    pasted = [line for line in box if line.startswith("export PATH=")]
    assert len(pasted) == 1 and pasted[0].endswith(NEXT), box
    assert "It is only for this terminal: the new ones find jht by themselves." in box, box
    return pasted[0][: -len(NEXT)]


def resolves_in_original_shell(server, text):
    env = {"PATH": server.remote_path, "HOME": str(server.home)}
    before = subprocess.run(["bash", "--noprofile", "--norc", "-c", "command -v jht"],
                            env=env, capture_output=True, text=True, timeout=10)
    assert before.returncode != 0, "the parent PATH must not already contain jht"
    command = printed_export(text)
    after = subprocess.run(["bash", "--noprofile", "--norc", "-c", command + "\ncommand -v jht"],
                           env=env, capture_output=True, text=True, timeout=10)
    assert after.returncode == 0, after.stderr
    assert after.stdout.strip() == str(server.home / ".local/bin/jht")


@pytest.mark.parametrize("installer", INSTALLERS, ids=["canonical", "public"])
def test_a_fresh_account_can_use_the_printed_command_in_the_already_open_shell(path_server, source, installer):
    text = output(install(path_server, source, installer=installer.read_bytes()))
    resolves_in_original_shell(path_server, text)


@pytest.mark.parametrize("installer", INSTALLERS, ids=["canonical", "public"])
def test_existing_path_configuration_is_kept_and_does_not_report_a_false_warning(path_server, source, installer):
    output(install(path_server, source, installer=installer.read_bytes()))
    files = [file for file in path_server.home.iterdir() if file.name in (".profile", ".bashrc", ".zshrc")]
    before = {file.name: file.read_bytes() for file in files}
    assert before
    text = output(install(path_server, source, installer=installer.read_bytes()))
    assert "No shell rc file was written" not in text
    assert {file.name: file.read_bytes() for file in files} == before
    resolves_in_original_shell(path_server, text)


def test_the_printed_export_handles_a_home_with_spaces(tmp_path, source):
    assert os.geteuid() != 0
    base = tmp_path / "home with spaces"
    base.mkdir()
    server = Server(base)
    server.pin()
    resolves_in_original_shell(server, output(install(server, source)))


@pytest.mark.parametrize("wizard_exit", [0, 7])
@pytest.mark.parametrize("conditional", [False, True])
def test_the_last_instruction_follows_the_wizard_and_preserves_its_exit_code(tmp_path, wizard_exit, conditional):
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . {shlex.quote(str(INSTALLERS[0]))}\n'
        f'BIN_DIR={shlex.quote(str(tmp_path / "bin with spaces"))}; USE_DOCKER=1; RUNTIME_CHOICE=""; OS=linux\n'
        'keep_chosen_runtime() { :; }; header() { :; }; main_docker() { PATH_NEW_SHELL=1; PATH_READY=1; }\n'
        'refuse_foreign_bind_uid() { :; }; save_pairing_token() { :; }; run_host_setup() { :; }\n'
        'will_auto_onboard() { return 0; }\n'
        f'maybe_onboard() {{ printf "WIZARD_FINISHED\\n"; return {wizard_exit}; }}\n'
        + ('if main; then exit 0; else exit $?; fi\n' if conditional else 'main\n')
    )
    done = subprocess.run(["bash", "-c", script], env={**os.environ, "HOME": str(tmp_path), "NO_COLOR": "1"},
                          capture_output=True, text=True, timeout=10)
    assert done.returncode == wizard_exit, done.stdout + done.stderr
    if wizard_exit == 0:
        command = printed_export(done.stdout)
        assert done.stdout.index("WIZARD_FINISHED") < done.stdout.index(PREFIX)
        checked = subprocess.run(["bash", "-c", command + '\nprintf "%s" "$PATH"'],
                                 env={"PATH": "/usr/bin:/bin"}, capture_output=True, text=True, timeout=10)
        assert checked.returncode == 0
        assert checked.stdout.startswith(str(tmp_path / "bin with spaces") + ":")


@pytest.mark.parametrize("wizard_exit", [0, 7])
def test_a_shell_that_already_has_the_bin_folder_gets_no_export_line(tmp_path, wizard_exit):
    # Linux round of build6 (known defect #13): «~/.local/bin ist schon im PATH» and then «Führe in diesem Terminal aus:
    # export PATH=…». The terminal that launched the installer already finds `jht`: the last line is not printed.
    bin_dir = tmp_path / "bin with spaces"
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . {shlex.quote(str(INSTALLERS[0]))}\n'
        f'BIN_DIR={shlex.quote(str(bin_dir))}; USE_DOCKER=1; RUNTIME_CHOICE=""; OS=linux\n'
        'PATH="/usr/bin:$BIN_DIR:/bin"\n'
        'keep_chosen_runtime() { :; }; header() { :; }; main_docker() { PATH_READY=1; }\n'
        'refuse_foreign_bind_uid() { :; }; save_pairing_token() { :; }; run_host_setup() { :; }\n'
        'will_auto_onboard() { return 0; }\n'
        f'maybe_onboard() {{ printf "WIZARD_FINISHED\\n"; return {wizard_exit}; }}\n'
        'main\n'
    )
    done = subprocess.run(["bash", "-c", script], env={**os.environ, "HOME": str(tmp_path), "NO_COLOR": "1"},
                          capture_output=True, text=True, timeout=10)
    assert done.returncode == wizard_exit, done.stdout + done.stderr
    assert "WIZARD_FINISHED" in done.stdout
    assert PREFIX.strip() not in done.stdout and "export PATH=" not in done.stdout, done.stdout


def test_the_installer_pin_and_public_payload_match_the_canonical_bytes():
    # Security artifact guard: these are the actual payload bytes the app downloads.
    payload = INSTALLERS[0].read_bytes()
    assert INSTALLERS[1].read_bytes() == payload
    assert (ROOT / "desktop/src-tauri/installer.sha256").read_text().strip() == hashlib.sha256(payload).hexdigest()


def test_when_no_profile_was_written_the_box_says_new_terminals_will_not_find_jht(tmp_path):
    script = (
        f'JHT_INSTALLER_SOURCE_ONLY=1 . {shlex.quote(str(INSTALLERS[0]))}\n'
        f'BIN_DIR={shlex.quote(str(tmp_path / "bin"))}; USE_DOCKER=1; RUNTIME_CHOICE=""; OS=linux\n'
        'keep_chosen_runtime() { :; }; header() { :; }; main_docker() { PATH_READY=1; }\n'
        'refuse_foreign_bind_uid() { :; }; save_pairing_token() { :; }; run_host_setup() { :; }\n'
        'will_auto_onboard() { return 0; }\n'
        'maybe_onboard() { printf "WIZARD_FINISHED\\n"; return 0; }\n'
        'main\n'
    )
    done = subprocess.run(["bash", "-c", script], env={**os.environ, "HOME": str(tmp_path), "NO_COLOR": "1"},
                          capture_output=True, text=True, timeout=10)
    assert done.returncode == 0, done.stdout + done.stderr
    assert "new terminals will not find jht either" in done.stdout
    assert "the new ones find jht by themselves" not in done.stdout
    assert done.stdout.rstrip().endswith("═")
