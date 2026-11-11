"""`jht setup --help` and `jht setup -h` name the options of the setup, the ones for the API key included.

The setup runs in the container, so before the container is up the wrapper answers the help by itself. It answered with the generic
help of the host, which does not name `--api-key-file` or `--api-key-stdin`: a person who asks how to hand over a key without the
guided steps found nothing. The tests run the wrapper itself (a docker that records what it is asked, no container, no network) and
read what a person reads on the terminal; for Windows the function that prints it is run with pwsh when there is one.
"""

from __future__ import annotations

import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest

from test_cli_help_never_starts_docker import assert_no_docker_effect, make_docker_spy, run_wrapper

ROOT = Path(__file__).resolve().parents[1]
SH = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8").replace("\r\n", "\n")
PS = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8").replace("\r\n", "\n")
SETUP_JS = (ROOT / "cli" / "src" / "commands" / "setup.js").read_text(encoding="utf-8")

KEY_OPTIONS = ("--api-key-file <percorso>", "--api-key-stdin")


def _options_of_the_command() -> list[str]:
    return re.findall(r"\.option\('(--[a-z-]+)", SETUP_JS)


def _sh_text() -> str:
    return re.search(r"<<'JHTSETUPHELP'\n(.*?)\nJHTSETUPHELP\n", SH, re.S).group(1)


@pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")
@pytest.mark.parametrize("args", [["setup", "--help"], ["setup", "-h"], ["setup", "--non-interactive", "--help"]])
@pytest.mark.parametrize("container_running", [False, True])
def test_the_help_the_person_reads_names_the_key_options_and_starts_nothing(tmp_path, args, container_running):
    fake_bin, log = make_docker_spy(tmp_path, reachable=True, container_running=container_running)
    done = run_wrapper(args, fake_bin, tmp_path)
    assert done.returncode == 0, done.stderr
    assert done.stdout.startswith("Uso: jht setup"), done.stdout
    for option in KEY_OPTIONS:
        assert option in done.stdout, option
    assert "chiave.txt" in done.stdout
    assert_no_docker_effect(log)


@pytest.mark.skipif(os.name == "nt", reason="the bash wrapper is not run on Windows")
def test_the_help_of_the_other_commands_is_still_the_generic_one(tmp_path):
    fake_bin, log = make_docker_spy(tmp_path, reachable=False, container_running=False)
    done = run_wrapper(["up", "--help"], fake_bin, tmp_path)
    assert done.returncode == 0 and "jht up" in done.stdout and "--api-key-file" not in done.stdout


def test_the_help_names_every_option_of_the_command_and_no_other():
    named = set(re.findall(r"^  (--[a-z-]+)", _sh_text(), re.M))
    assert named == set(_options_of_the_command())


def test_both_wrappers_answer_setup_help_before_the_generic_one_and_with_the_same_text():
    assert re.search(r'if \[ "\$SUB" = setup \]; then\n\s+setup_help\n\s+exit 0\n\s+fi\n\s+if host_command_uses_local_help', SH)
    assert re.search(r"if \(\$Sub -ceq 'setup'\) \{\n\s+Write-SetupHelp\n\s+exit 0\n\s+\}\n\s+if \(Test-HostCommandUsesLocalHelp", PS)
    ps_text = re.search(r"function Write-SetupHelp \{\n.*?@'\n(.*?)\n'@\)", PS, re.S).group(1)
    assert ps_text == _sh_text()


def test_the_windows_help_prints_the_same_lines_when_pwsh_runs_it(tmp_path):
    shell = os.environ.get("JHT_TEST_SHELL") or "pwsh"
    if not shutil.which(shell):
        pytest.skip(f"{shell} not installed")
    function = re.search(r"^function Write-SetupHelp \{\n.*?^\}\n", PS, re.S | re.M).group(0)
    script = tmp_path / "help.ps1"
    script.write_text(function + "\nWrite-SetupHelp\n", encoding="utf-8")
    done = subprocess.run([shell, "-NoProfile", "-File", str(script)], text=True, capture_output=True, timeout=60)
    assert done.returncode == 0, done.stderr
    assert done.stdout.replace("\r\n", "\n").rstrip("\n") == _sh_text()
