"""`jht help` is the long list of commands, and the short help sends the person to it: the wrappers must not
answer `jht help` with the short help (they did, so the way out of the short help led back to it)."""
from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
SH = (ROOT / "scripts" / "jht-wrapper.sh").read_text(encoding="utf-8")
PS1 = (ROOT / "scripts" / "jht-wrapper.ps1").read_text(encoding="utf-8")


def test_the_bash_wrapper_forwards_help_as_help_and_the_flags_as_the_short_help():
    assert re.search(r"^  -h\|--help\|''\)\n    serve_help_without_docker --help\n", SH, re.M)
    assert re.search(r"^  help\)\n(?:    #[^\n]*\n)?(?:    if \[ \"\${2:-}\" = setup \][^\n]*\n      setup_help\n      exit 0\n    fi\n)?    serve_help_without_docker help\n", SH, re.M)
    assert "-h|--help|help|''" not in SH


def test_the_powershell_wrapper_forwards_help_as_help_and_the_flags_as_the_short_help():
    assert re.search(r"\$_ -in @\('-h', '--help', ''\) \} \{\n    Invoke-HelpWithoutDocker '--help'\n", PS1)
    assert re.search(r"'help' \{\n(?:    #[^\n]*\n)?(?:    if \(\$Rest\.Count -eq 1 -and \$Rest\[0\] -ceq 'setup'\) \{\n      Write-SetupHelp\n      exit 0\n    \}\n)?    Invoke-HelpWithoutDocker 'help'\n", PS1)
    assert "'--help', 'help', ''" not in PS1


@pytest.mark.skipif(shutil.which("node") is None, reason="needs node")
def test_the_cli_answers_help_with_the_long_list_and_the_flag_with_the_short_one():
    run = lambda *args: subprocess.run(["node", str(ROOT / "cli" / "bin" / "jht.js"), *args], capture_output=True, text=True, timeout=60).stdout
    assert "Essential commands" in run("--help")
    long = run("help")
    # the long list is the grouped one: the groups, the commands, and the ones that live on the computer
    assert "Essential commands" not in long and "Every day:" in long and "Maintenance:" in long and "doctor" in long
    assert "up" in long.split("On your computer, outside the container:")[1]


def test_the_help_of_a_command_of_the_container_runs_without_a_terminal(tmp_path):
    """Retest Windows build13: `jht enrichment --help` came out empty with two «Failed to obtain TTY size» of Podman: the help
    went to the container with -it, and Podman sized the terminal of a help already over. A help needs no terminal."""
    body = re.search(r"^serve_help_without_docker\(\) \{\n.*?^\}\n", SH, re.S | re.M).group(0)
    fake = tmp_path / "bin"
    fake.mkdir()
    (fake / "docker").write_text(f'#!/bin/sh\necho "$*" >> "{tmp_path}/calls"\necho "Usage: jht enrichment"\n', encoding="utf-8")
    (fake / "docker").chmod(0o755)
    script = (f'export PATH="{fake}:$PATH"\nEXEC_FLAGS=-it\nJHT_HOST_TYPE=local\nATTESTED_CONTAINER_ID=jht\nNODE_ENTRY=/app/cli/bin/jht.js\n'
              "docker_reachable() { :; }\ncontainer_up() { :; }\n" + body + "serve_help_without_docker enrichment --help\n")
    done = subprocess.run(["bash", "-c", script], capture_output=True, text=True, timeout=30)
    assert done.returncode == 0 and "Usage: jht enrichment" in done.stdout, done.stderr
    assert (tmp_path / "calls").read_text(encoding="utf-8").splitlines() == [
        "exec -e JHT_HOST_TYPE=local jht node /app/cli/bin/jht.js enrichment --help"]
    ps = PS1.replace("\r\n", "\n")
    fn = re.search(r"^function Invoke-HelpWithoutDocker \{\n.*?^\}\n", ps, re.S | re.M).group(0)
    assert "& docker exec -e \"JHT_HOST_TYPE=$env:JHT_HOST_TYPE\" $Container node $NodeEntry @HelpArgs" in fn
    assert "ExecFlags" not in fn
